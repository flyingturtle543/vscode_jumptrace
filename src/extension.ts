import * as vscode from 'vscode';
import path from 'path';
import { Logger } from './logger';
import { extractFileLocations, getActiveEditorFilePath, highlightLines, openFileAndJumpToLine } from './realize';
import { hash } from 'crypto';

class document {
    editor: vscode.TextEditor | undefined;
    document: vscode.TextDocument | undefined;
    light = false; 
    line : number | undefined;
    oldlines : number | undefined;
    path : string | undefined;
    targetRange : vscode.Range | undefined;
    update(line: number): vscode.Range {
        const targetPosition = new vscode.Position(line, 0);
        return new vscode.Range(targetPosition, targetPosition);
    }
}

class configuration{
    extensionConfig = vscode.workspace.getConfiguration('jumptrace');
    filepath = this.extensionConfig.get<string>('file_path', '');
    pathRegex = new RegExp(this.extensionConfig.get<string>('pathRegex'," "))
    skip = new RegExp(this.extensionConfig.get<string>('skip',"^ "));
    osName : string | undefined;
    isFeatureEnabled : boolean = true;
    isFeatureEnabled1 : boolean = true;
    intercept : boolean = true;
    state: boolean = true;
    error: boolean = false;
    colour = vscode.window.createTextEditorDecorationType({
        backgroundColor: this.extensionConfig.get<string>('highlightBackgroundColor', 'rgba(166, 250, 98, 0.3)'),
        overviewRulerColor: 'yellow',
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        isWholeLine: true });
}

let masterfile = new document();
let assistantfile = new document();
let config = new configuration();




interface FileLocationData {
    originalFileIndex: number; // 索引行
    highlightLineCount: number; //宽度
}

class hashtable{
   static  fileLocationsMap = new Map<string, Map<number, FileLocationData>>();
   static  currentActiveFileLocationMap: Map<number, FileLocationData> = new Map();
   static  locationData : FileLocationData | undefined;
}


export async function activate(context: vscode.ExtensionContext) {

    // 初始化日志模块
    Logger.initializeLogger("jumptrace");
    context.subscriptions.push({ dispose: () => Logger.dispose() });

    // 解析配置中的文件路径，替换 $workspaceFolder 为实际的工作区文件夹路径
    if (config.filepath.startsWith('$workspaceFolder')) {
    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
    if (workspaceFolder) {config.filepath = path.join(workspaceFolder.uri.fsPath, config.filepath.substring('$workspaceFolder'.length));}}
    // 获取操作系统类型
    if(config.pathRegex.source === " " || config.pathRegex.source === "")
    {
        const platform = process.platform;
        if (platform === 'win32') {
            config.osName = 'Windows';
            config.pathRegex = /^([A-Za-z]:[\/\\].*?):(\d+)$/;
        } else if (platform === 'darwin') {
            config.osName = 'macOS';
            config.pathRegex = /^([\/\\].*?):(\d+)$/;
        } else if (platform === 'linux') {
            config.osName = 'Linux';
            config.pathRegex = /^([\/\\].*?):(\d+)$/;
        } else {
            config.osName = 'unknown';
            config.pathRegex = /^(.*?):(\d+)$/;
        }
    }else{config.osName = 'user-defined';}
    Logger.log(`操作系统类型: ${config.osName}`);
   
    let toggleFeatureCommand = vscode.commands.registerCommand('jumptrace.close', async () => {
        
        try {
            config.intercept = true;
            config.isFeatureEnabled = true;
            config.isFeatureEnabled1 = true;
            config.state = true;
            if(masterfile.light){masterfile.editor!.setDecorations(config.colour, []);masterfile.light=false;}
            if(assistantfile.light){assistantfile.editor!.setDecorations(config.colour, []);assistantfile.light=false;}
            vscode.window.showInformationMessage('Mapping has been turned off')
            } finally {config.intercept = false;}
    })

    let toggleFeatureCommand1 = vscode.commands.registerCommand('jumptrace.switchover', async () => {
        try{
            config.intercept = true;
            config.state = !config.state;
            if(!config.state){config.isFeatureEnabled = false;vscode.window.showInformationMessage('Single mapping has been enabled');}
            else{config.isFeatureEnabled = false;config.isFeatureEnabled1=false;vscode.window.showInformationMessage('Double mapping has been activated');}

            if(hashtable.fileLocationsMap.size === 0){
                await extractFileLocations(config.filepath, hashtable.fileLocationsMap, config.pathRegex, config.skip); 
                masterfile.document = await vscode.workspace.openTextDocument(vscode.Uri.file(config.filepath));  
                masterfile.editor = await vscode.window.showTextDocument(masterfile.document, {
                preview: false,
                viewColumn: vscode.ViewColumn.Beside,});  
                assistantfile.editor = masterfile.editor;
            }       
            if(!masterfile.document){return}
            let editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(
                e => e.document.uri.fsPath === masterfile.editor?.document.uri.fsPath
            );
            if (!editor) {
                masterfile.editor = await vscode.window.showTextDocument(masterfile.document, {
                preview: false,
                viewColumn: vscode.ViewColumn.Beside,});  
            }

        }catch (error: any){vscode.window.showInformationMessage('config error}');config.error=true}
        finally{config.intercept = false;}
    });



    //主逻辑
    let selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection( async (event: vscode.TextEditorSelectionChangeEvent) => {
        if (config.isFeatureEnabled  || event.textEditor.document.uri.scheme !== 'file' || config.intercept || config.error) {return;}
        config.intercept = true;
        try {
            if (!(masterfile.editor === event.textEditor) && !(assistantfile.editor === event.textEditor)){
                assistantfile.editor=event.textEditor;
                assistantfile.path = getActiveEditorFilePath(config.osName!, assistantfile.editor.document.uri.fsPath)
                if(!assistantfile.path){return;}
                const oncemap =hashtable.fileLocationsMap.get(assistantfile.path)
                if(!oncemap){return;}
                hashtable.currentActiveFileLocationMap = oncemap;}  
            if(!assistantfile.editor || !masterfile.editor){return;}   
            if (masterfile.editor.selection.active.line === masterfile.oldlines && assistantfile.editor.selection.active.line === assistantfile.oldlines){return;}
            if(masterfile.light){masterfile.editor.setDecorations(config.colour, []);masterfile.light=false;}
            if(assistantfile.light){assistantfile.editor.setDecorations(config.colour, []);assistantfile.light=false;}
            if (assistantfile.oldlines !== assistantfile.editor.selection.active.line){
                assistantfile.oldlines = assistantfile.editor.selection.active.line;
                hashtable.locationData = hashtable.currentActiveFileLocationMap.get(assistantfile.editor.selection.active.line + 1);
                assistantfile.line = assistantfile.editor.selection.active.line;
                if(!hashtable.locationData){return;}
                masterfile.editor.revealRange(masterfile.update(hashtable.locationData!.originalFileIndex), vscode.TextEditorRevealType.InCenterIfOutsideViewport);}
            else if(!config.isFeatureEnabled1){
                masterfile.oldlines = masterfile.editor.selection.active.line;
                for (let i = masterfile.editor.selection.active.line; i >= 0; i--) { 
                    if(masterfile.editor.document.lineAt(i).text.match(config.skip)){continue;} 
                    let pathMatch = masterfile.editor.document.lineAt(i).text.match(config.pathRegex!);
                    if(pathMatch && pathMatch.length >= 3){
                        if(pathMatch[1] === assistantfile.path){hashtable.locationData = hashtable.currentActiveFileLocationMap.get(parseInt(pathMatch[2]));
                        assistantfile.line = parseFloat(pathMatch[2])-1;
                        assistantfile.editor.revealRange(assistantfile.update(assistantfile.line), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                        break;}
                        const onceeditor = await openFileAndJumpToLine(pathMatch[1], parseInt(pathMatch[2])-1)
                        if(!onceeditor){return;}
                        assistantfile.editor = onceeditor;
                        assistantfile.path = getActiveEditorFilePath(config.osName!, assistantfile.editor.document.uri.fsPath)
                        if(!assistantfile.path){return;}
                        Logger.log(assistantfile.path!)
                        let oncemap = hashtable.fileLocationsMap.get(pathMatch[1])
                        if(!oncemap){return;}
                        hashtable.currentActiveFileLocationMap = oncemap
                        hashtable.locationData = hashtable.currentActiveFileLocationMap.get(parseInt(pathMatch[2])); 
                        assistantfile.line = parseFloat(pathMatch[2])-1;
                        break;}
                    }
            }else{return;}

            masterfile.oldlines = masterfile.editor.selection.active.line;
            assistantfile.oldlines = assistantfile.editor.selection.active.line;
            highlightLines(assistantfile.editor,assistantfile.line!,1,config.colour)
            highlightLines(masterfile.editor, hashtable.locationData!.originalFileIndex,hashtable.locationData!.highlightLineCount,config.colour)
            masterfile.light=true;
            assistantfile.light=true;
        }catch{vscode.window.showInformationMessage('Execution failed')}
        finally{config.intercept = false;}
        
    });


    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        
        try{
            config.intercept = true;
            if (event.affectsConfiguration('jumptrace')) {
                let filepath = config.filepath;
                config = new configuration(); 
                if (config.filepath.startsWith('$workspaceFolder')) {
                    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
                    if (workspaceFolder) {config.filepath = path.join(workspaceFolder.uri.fsPath, config.filepath.substring('$workspaceFolder'.length));}
                }
                if(filepath!==config.filepath){
                    hashtable.fileLocationsMap.clear();
                    hashtable.currentActiveFileLocationMap.clear();}         

                if(config.pathRegex.source === " " || config.pathRegex.source === "") {
                    const platform = process.platform;
                    if (platform === 'win32') {
                        config.osName = 'Windows';
                        config.pathRegex = /^([A-Za-z]:[\/\\].*?):(\d+)$/;
                    } else if (platform === 'darwin') {
                        config.osName = 'macOS';
                        config.pathRegex = /^([\/\\].*?):(\d+)$/;
                    } else if (platform === 'linux') {
                        config.osName = 'Linux';
                        config.pathRegex = /^([\/\\].*?):(\d+)$/;
                    } else {
                        config.osName = 'unknown';
                        config.pathRegex = /^(.*?):(\d+)$/;
                    }
                } else {config.osName = 'user-defined';}

                config.colour.dispose();
                config.colour = vscode.window.createTextEditorDecorationType({
                    backgroundColor: config.extensionConfig.get<string>('highlightBackgroundColor', 'rgba(131, 247, 95, 0.3)'),
                    overviewRulerColor: 'yellow',
                    overviewRulerLane: vscode.OverviewRulerLane.Full,
                    isWholeLine: true});
                config.error=false;
            }
        }catch (error: any){vscode.window.showInformationMessage('config error}');config.error=true}
        finally{config.intercept = false;}
    }));




    context.subscriptions.push(toggleFeatureCommand, selectionChangeDisposable,toggleFeatureCommand1);
}


export function deactivate(){

    if(masterfile.light){masterfile.editor!.setDecorations(config.colour, []);masterfile.light=false;}
    if(assistantfile.light){assistantfile.editor!.setDecorations(config.colour, []);assistantfile.light=false;}
    if (config.colour) {config.colour.dispose();}
    hashtable.fileLocationsMap.clear();
    hashtable.currentActiveFileLocationMap.clear();

}








