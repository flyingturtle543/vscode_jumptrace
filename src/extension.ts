import * as vscode from 'vscode';
import path from 'path';
import { Logger } from './logger';
import { extractFileLocations, getActiveEditorFilePath, highlightLines, openFileAndJumpToLine } from './realize';

export let isProgrammaticSelectionChange = false; // 程序性选区变化标志
export function setIsProgrammaticSelectionChange(value: boolean) {
    isProgrammaticSelectionChange = value;
}

class document {
    editor: vscode.TextEditor | undefined;
    light = false; 
    line : number | undefined;
    oldlines : number | undefined;
    path : string | undefined;
}

class configuration{
    extensionConfig = vscode.workspace.getConfiguration('jumptrace');
    filepath = this.extensionConfig.get<string>('file_path', '');
    osName : string | undefined;
    pathRegex : RegExp | undefined;
    isFeatureEnabled : boolean = true;
    isFeatureEnabled1 : boolean = true;
    colour = vscode.window.createTextEditorDecorationType({
        backgroundColor: this.extensionConfig.get<string>('highlightBackgroundColor', 'rgba(131, 247, 95, 0.3)'),
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
    Logger.log(`操作系统类型: ${config.osName}`);
    //创建哈希表
    extractFileLocations(config.filepath, hashtable.fileLocationsMap, config.pathRegex, /^ /);
    //获取编辑器
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(config.filepath));
    masterfile.editor = await vscode.window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
    });
    assistantfile.editor = masterfile.editor;
    //开关
    let toggleFeatureCommand = vscode.commands.registerCommand('jumptrace.open', () => {
        config.isFeatureEnabled = !config.isFeatureEnabled;
        Logger.log(`打开主文件映射`);
    });
    let toggleFeatureCommand1 = vscode.commands.registerCommand('jumptrace.Reverse_opening', () => {
        config.isFeatureEnabled1 = !config.isFeatureEnabled1;
        Logger.log(`打开副文件映射`);
    });

    //主逻辑
    let selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection( async (event: vscode.TextEditorSelectionChangeEvent) => {
        if (config.isFeatureEnabled  || event.textEditor.document.uri.scheme !== 'file' || isProgrammaticSelectionChange) {return;}
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
        //更新数据
        if (assistantfile.oldlines !== assistantfile.editor.selection.active.line){
            hashtable.locationData = hashtable.currentActiveFileLocationMap.get(assistantfile.editor.selection.active.line + 1);
            assistantfile.line = assistantfile.editor.selection.active.line;}
        else if(!config.isFeatureEnabled1){
            for (let i = masterfile.editor.selection.active.line; i >= 0; i--) { 
                if(masterfile.editor.document.lineAt(i).text.match(/^ /)){continue;} 
                let pathMatch = masterfile.editor.document.lineAt(i).text.match(config.pathRegex!);
                if(pathMatch && pathMatch.length >= 3){
                    if(pathMatch[1] === assistantfile.path){hashtable.locationData = hashtable.currentActiveFileLocationMap.get(parseInt(pathMatch[2]));
                    assistantfile.line = parseFloat(pathMatch[2])-1;break;}
                    const onceeditor = await openFileAndJumpToLine(pathMatch[1], parseInt(pathMatch[2])-1)
                    if(!onceeditor){return;}
                    assistantfile.editor = onceeditor;
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

    });
    context.subscriptions.push(toggleFeatureCommand, selectionChangeDisposable,toggleFeatureCommand1);
}


export function deactivate(){

    if(masterfile.light){masterfile.editor!.setDecorations(config.colour, []);masterfile.light=false;}
    if(assistantfile.light){assistantfile.editor!.setDecorations(config.colour, []);assistantfile.light=false;}
    if (config.colour) {config.colour.dispose();}
    hashtable.fileLocationsMap.clear();
    hashtable.currentActiveFileLocationMap.clear();

}








