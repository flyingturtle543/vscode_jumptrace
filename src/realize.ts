// realize.ts
import * as vscode from 'vscode';
import * as fs from 'fs';


/**
 * Interface for storing file location data.
 * 存储文件位置数据的接口。
 */
interface FileLocationData {
    originalFileIndex: number; // Line index in the configuration file. 配置文件的行索引。
    highlightLineCount: number; // Number of lines to highlight. 需要高亮的行数。
}


/**
 * Extracts file paths and line numbers from a specified configuration file and stores them in a Map.
 * 从指定文件中提取文件路径和行号信息，并存储到 Map 中。
 * @param configFilePath The path to the configuration file. 配置文件路径。
 * @param fileLocationsMap A Map to store file paths and their corresponding line data. 存储文件路径和行号的 Map。
 * @param pathRegex Regular expression used to match file paths and line numbers. 用于匹配文件路径和行号的正则表达式。
 * @param SkipRegExp Regular expression used to skip lines. 用于跳过行的正则表达式。
 */
export async function extractFileLocations(
    configFilePath: string,
    fileLocationsMap: Map<string, Map<number, FileLocationData>>,
    pathRegex: RegExp,
    SkipRegExp: RegExp,
): Promise<void> {

    if (!fs.existsSync(configFilePath)) {
        vscode.window.showErrorMessage(`Failed to read file: ${configFilePath}`);
        return;
    }

    try {
        const fileContent = await fs.promises.readFile(configFilePath, 'utf8');
        const lines = fileContent.split(/\r?\n/);

        let lastMatchedLineIndex = lines.length; // Tracks the index of the last line that matched the regex. 跟踪最后一个匹配到正则表达式的行的索引。
        // Iterate through the lines in reverse to correctly calculate highlightLineCount.
        // 反向遍历行，以便正确计算 highlightLineCount。
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.match(SkipRegExp)) { continue; } // Skip lines that match the skip regex. 跳过匹配跳过正则表达式的行。
            const pathMatch = line.match(pathRegex);

            if (pathMatch && pathMatch.length >= 3) {
                const filePath = pathMatch[1]; // Extracted file path. 提取的文件路径。
                const lineNumber = parseInt(pathMatch[2], 10); // Extracted line number. 提取的行号。

                let lineMap = fileLocationsMap.get(filePath);
                if (!lineMap) {
                    lineMap = new Map<number, FileLocationData>();
                    fileLocationsMap.set(filePath, lineMap);
                }

                // Store the line number, original file index, and highlight line count.
                // 存储行号、原始文件索引和高亮行数。
                lineMap.set(lineNumber, { originalFileIndex: i, highlightLineCount: lastMatchedLineIndex - i });
                lastMatchedLineIndex = i; // Update the last matched line index. 更新最后一个匹配到的行索引。
            } else {
                lastMatchedLineIndex = i; // If no match, the current line might be part of the previous entry's highlight range.
                                            // 如果没有匹配，当前行可能是前一个条目高亮范围的一部分。
            }
        }

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to read file: ${configFilePath} - ${error.message}`);
    }
}


/**
 * Normalizes file paths, primarily handling Windows drive letter casing and path separators.
 * 规范化文件路径，主要处理 Windows 盘符大小写和路径分隔符。
 * @param osName Operating system name, e.g., 'Windows' or 'Darwin'. 操作系统的名称，例如 'Windows' 或 'Darwin'。
 * @param filePath The original file path. 原始文件路径。
 * @returns The normalized file path, or undefined if it's not a valid path. 规范化后的文件路径，如果不是有效路径则返回 undefined。
 */
export function getActiveEditorFilePath(osName: string, filePath: string): string | undefined {

    if (!filePath) {
        return undefined;
    }

    const normalizedPath = filePath.replace(/\\/g, '/'); // Replace backslashes with forward slashes. 将反斜杠替换为正斜杠。

    if (osName === 'Windows') {
        const windowsPathRegex = /^([a-zA-Z]):(\/.*)$/;
        const match = normalizedPath.match(windowsPathRegex);
        if (match) {
            // Capitalize the drive letter for consistency on Windows.
            // 在 Windows 上将驱动器号大写以保持一致性。
            return match[1].toUpperCase() + ':' + match[2];
        }
    }

    return normalizedPath;
}


/**
 * Opens a file in a VS Code editor and jumps to a specified line.
 * 在 VS Code 编辑器中打开文件并跳转到指定行。
 * @param file The path to the file to open. 要打开的文件路径。
 * @param line The line number to jump to (0-indexed). 要跳转的行号（从0开始）。
 * @returns A promise that resolves to the opened TextEditor, or undefined if an error occurs.
 * 解析为已打开的 TextEditor 的 Promise，如果发生错误则为 undefined。
 */
export async function openFileAndJumpToLine(file: string, line: number): Promise<vscode.TextEditor | undefined> {

    try {
        const fileUri = vscode.Uri.file(file);

        // Attempt to get an already open document instance to avoid reopening.
        // 尝试获取已打开的文档实例，避免重复打开。
        let document: vscode.TextDocument;
        const openedDocuments = vscode.workspace.textDocuments;
        const existingDocument = openedDocuments.find(doc => doc.uri.fsPath === fileUri.fsPath);

        if (existingDocument) {
            document = existingDocument;
        } else {
            document = await vscode.workspace.openTextDocument(fileUri);
        }

        // Set the target position and range for the selection.
        // 设置选择的目标位置和范围。
        const targetPosition = new vscode.Position(line, 0);
        const targetRange = new vscode.Range(targetPosition, targetPosition);

        // Attempt to get an existing editor instance.
        // 尝试获取已有的编辑器实例。
        let editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(
            e => e.document.uri.fsPath === fileUri.fsPath
        );


        if (editor) {
            // If the editor is already open, update its selection and reveal the range.
            // 如果编辑器已打开，则更新其选择并显示范围。
            editor.selection = new vscode.Selection(targetPosition, targetPosition);
            editor.revealRange(targetRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            await vscode.window.showTextDocument(document, { viewColumn: editor.viewColumn, preserveFocus: false });
        } else {
            // If the editor is not open, open a new one and display it.
            // 如果编辑器未打开，则新开并显示。
            editor = await vscode.window.showTextDocument(document, {
                selection: targetRange,
                preview: false, // Do not open in preview mode. 不以预览模式打开。
                viewColumn: vscode.ViewColumn.One // Open in the first column. 在第一列打开。
            });
        }

        return editor;

    } catch (error: any) {
        vscode.window.showErrorMessage(`Cannot open file or jump: ${error.message}`);
        return undefined;
    }
}


/**
 * Highlights a specified range of lines in the editor.
 * 高亮显示指定区域的行。
 * @param editor The current text editor. 当前的文本编辑器。
 * @param startLine The starting line number (0-indexed). 起始行号（基于0）。
 * @param lineCount The number of lines to highlight. 需要高亮的行数。
 * @param decorationType The decoration type to use for highlighting. 用于高亮的装饰类型。
 * @returns A promise that resolves when highlighting is complete.
 * 高亮完成后解析的 Promise。
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
                range: line.range, // The range to apply the decoration to. 应用装饰的范围。
            });
        }
        editor.setDecorations(decorationType, decorations);
        return;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to highlight lines: ${error.message}`);
        return;
    }
}