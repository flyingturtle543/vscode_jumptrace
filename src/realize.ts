import * as vscode from 'vscode';
import * as fs from 'fs';
import { setIsProgrammaticSelectionChange } from './extension';

/**
 * 存储文件位置数据的接口。
 */
interface FileLocationData {
    originalFileIndex: number; // 行索引
    highlightLineCount: number; // 宽度
}


/**
 * 从指定文件中提取文件路径和行号信息，并存储到 Map 中。
 * @param configFilePath 配置文件路径。
 * @param fileLocationsMap 存储文件路径和行号的 Map。
 * @param pathRegex 用于匹配文件路径和行号的正则表达式。
 */
export async function extractFileLocations(
    configFilePath: string,
    fileLocationsMap: Map<string, Map<number, FileLocationData>>,
    pathRegex: RegExp,
    SkipRegExp: RegExp,
): Promise<void> {

    if (!fs.existsSync(configFilePath)) {
        vscode.window.showErrorMessage(`文件未找到: ${configFilePath}`);
        return;
    }

    try {
        const fileContent = await fs.promises.readFile(configFilePath, 'utf8');
        const lines = fileContent.split(/\r?\n/);

        let lastMatchedLineIndex = lines.length;
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.match(SkipRegExp)) { continue; }
            const pathMatch = line.match(pathRegex);

            if (pathMatch && pathMatch.length >= 3) {
                const filePath = pathMatch[1];
                const lineNumber = parseInt(pathMatch[2], 10);

                let lineMap = fileLocationsMap.get(filePath);
                if (!lineMap) {
                    lineMap = new Map<number, FileLocationData>();
                    fileLocationsMap.set(filePath, lineMap);}
                lineMap.set(lineNumber, { originalFileIndex: i, highlightLineCount: lastMatchedLineIndex - i });

                lastMatchedLineIndex = i;
            } else {lastMatchedLineIndex = i;}
        }

    } catch (error: any) {
        vscode.window.showErrorMessage(`读取文件失败: ${configFilePath} - ${error.message}`);
    }
}



/**
 * 规范化文件路径，主要处理 Windows 盘符大小写和路径分隔符。
 * @param osName 操作系统的名称，例如 'Windows' 或 'Darwin'。
 * @param filePath 原始文件路径。
 * @returns 规范化后的文件路径，如果不是有效路径则返回 undefined。
 */
export function getActiveEditorFilePath(osName: string,filePath: string): string | undefined {
    
    if (!filePath) {
        return undefined;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');

    if (osName === 'Windows') {
        const windowsPathRegex = /^([a-zA-Z]):(\/.*)$/;
        const match = normalizedPath.match(windowsPathRegex);
        if (match) {
            return match[1].toUpperCase() + ':' + match[2];
        }
    }

    return normalizedPath;
}


export async function openFileAndJumpToLine(file:string, y: number): Promise<vscode.TextEditor | undefined> 
{
    setIsProgrammaticSelectionChange(true);
    try
    {
        const fileUri = vscode.Uri.file(file);

        // 尝试获取已打开的文档实例，避免重复打开
        let document: vscode.TextDocument;
        const openedDocuments = vscode.workspace.textDocuments;
        const existingDocument = openedDocuments.find(doc => doc.uri.fsPath === fileUri.fsPath);

        if (existingDocument) {document = existingDocument;} 
        else {document = await vscode.workspace.openTextDocument(fileUri)}

        // 定位到指定行
        const targetPosition = new vscode.Position(y, 0);
        const targetRange = new vscode.Range(targetPosition, targetPosition);

        // 尝试获取已有的编辑器实例
        let editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(
            e => e.document.uri.fsPath === fileUri.fsPath
        );


        if (editor) {
            editor.selection = new vscode.Selection(targetPosition, targetPosition); 
            editor.revealRange(targetRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, preserveFocus: false });
        } else{
            // 如果编辑器未打开，则新开并显示
            editor = await vscode. window.showTextDocument(document, {
                selection: targetRange, 
                preview: false, 
                viewColumn: vscode.ViewColumn.One 
            });
        }

        return editor;

    } catch (error: any)
    {
        vscode.window.showErrorMessage(`无法打开文件或跳转: ${error.message}`);
        return undefined;
    } finally {
        setTimeout(() => {
            setIsProgrammaticSelectionChange(false);
        }, 0); // 0ms 延迟
    }
}


/**
 * 高亮显示指定区域的行。
 * @param editor 当前的文本编辑器。
 * @param startLine 起始行号（基于0）。
 * @param lineCount 需要高亮的行数。
 * @param decorationType 用于高亮的装饰类型。
 * @returns 返回高亮装饰类型。
 */
export async function highlightLines(
    editor: vscode.TextEditor,
    startLine: number,
    lineCount: number,
    decorationType: vscode.TextEditorDecorationType
): Promise<void> {
    try {
        const decorations: vscode.DecorationOptions[] = [];
        for (let i = startLine; i < startLine + lineCount; i++) {
            const line = editor.document.lineAt(i);
            decorations.push({
                range: line.range,
            });
        }
        editor.setDecorations(decorationType, decorations);
        return ;
    } catch (error: any) {
        vscode.window.showErrorMessage(`高亮行失败: ${error.message}`);
        return ;
    }
}