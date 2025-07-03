// extension.ts
import * as vscode from 'vscode';
import path from 'path';
import { extractFileLocations, getActiveEditorFilePath, highlightLines, openFileAndJumpToLine } from './realize';
import { hash } from 'crypto'; // Although imported, 'hash' is not used in the provided code.

/**
 * Represents an editor document and its associated state for highlighting.
 * 表示一个编辑器文档及其关联的高亮状态。
 */
class DocumentState {
    editor: vscode.TextEditor | undefined; // The VS Code text editor instance. VS Code 文本编辑器实例。
    document: vscode.TextDocument | undefined; // The VS Code text document instance. VS Code 文本文档实例。
    isHighlighted = false; // Flag indicating if lines are currently highlighted. 标记当前行是否高亮。
    currentLineNumber: number | undefined; // The currently active line number. 当前活动行号。
    previousLineNumber: number | undefined; // The previously active line number. 上一个活动行号。
    filePath: string | undefined; // The normalized file path. 规范化的文件路径。
    targetRange: vscode.Range | undefined; // The range for selection/revealing. 用于选择/显示的范围。

    /**
     * Updates the target range based on a new line number.
     * 根据新的行号更新目标范围。
     * @param line The new line number (0-indexed). 新的行号（从0开始）。
     * @returns The updated VS Code Range. 更新后的 VS Code 范围。
     */
    updateRange(line: number): vscode.Range {
        const targetPosition = new vscode.Position(line, 0);
        return new vscode.Range(targetPosition, targetPosition);
    }
}

/**
 * Manages the extension's configuration settings.
 * 管理扩展的配置设置。
 */
class ExtensionConfiguration {
    private extensionConfig = vscode.workspace.getConfiguration('jumptrace'); // VS Code configuration for 'jumptrace'. 'jumptrace' 的 VS Code 配置。
    filePath = this.extensionConfig.get<string>('file_path', ''); // Path to the configuration file. 配置文件的路径。
    pathRegex = new RegExp(this.extensionConfig.get<string>('pathRegex', " ")); // Regular expression for matching file paths and lines. 用于匹配文件路径和行的正则表达式。
    skipRegex = new RegExp(this.extensionConfig.get<string>('skip', "^ ")); // Regular expression for skipping lines. 用于跳过行的正则表达式。
    osName: string | undefined; // Operating system name. 操作系统名称。
    isSingleMappingEnabled: boolean = true; // Controls single mapping feature (e.g., source to config). 控制单向映射功能（例如，源文件到配置文件）。
    isDoubleMappingEnabled: boolean = true; // Controls double mapping feature (e.g., bidirectional). 控制双向映射功能（例如，双向映射）。
    isInterceptingEvents: boolean = true; // Flag to prevent re-entrant calls during event handling. 标志，用于防止事件处理期间的重入调用。
    isDoubleMappingActive: boolean = true; // True if double mapping is the active mode, false for single mapping. 如果双向映射是活动模式，则为 True，单向映射为 False。
    hasConfigurationError: boolean = false; // Flag for configuration-related errors. 配置相关错误的标志。
    highlightDecorationType: vscode.TextEditorDecorationType; // Decoration type for highlighting lines. 用于高亮行的装饰类型。

    constructor() {
        // Initialize the highlight decoration type with user-defined or default color.
        // 使用用户定义或默认颜色初始化高亮装饰类型。
        this.highlightDecorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: this.extensionConfig.get<string>('highlightBackgroundColor', 'rgba(166, 250, 98, 0.3)'),
            overviewRulerColor: 'yellow',
            overviewRulerLane: vscode.OverviewRulerLane.Full,
            isWholeLine: true
        });
    }

    /**
     * Disposes the decoration type to release resources.
     * 释放装饰类型以释放资源。
     */
    disposeDecorationType() {
        this.highlightDecorationType.dispose();
    }
}

// Global instances for managing document states and configuration.
// 用于管理文档状态和配置的全局实例。
let masterFileState = new DocumentState(); // State for the "master" file (e.g., config file). “主”文件（例如配置文件）的状态。
let assistantFileState = new DocumentState(); // State for the "assistant" file (e.g., source file). “辅助”文件（例如源文件）的状态。
let extensionConfig = new ExtensionConfiguration(); // Global configuration instance. 全局配置实例。


/**
 * Interface for file location data, used within the hash table.
 * 文件位置数据的接口，在哈希表中使用。
 */
interface FileLocationData {
    originalFileIndex: number; // Index line in the master file. 主文件中的索引行。
    highlightLineCount: number; // Number of lines to highlight. 需要高亮的行数。
}

/**
 * Manages the file location data using static Maps.
 * 使用静态 Map 管理文件位置数据。
 */
class FileLocationCache {
    // A Map where keys are file paths and values are another Map mapping line numbers to FileLocationData.
    // 一个 Map，其中键是文件路径，值是另一个将行号映射到 FileLocationData 的 Map。
    static fileLocationsMap = new Map<string, Map<number, FileLocationData>>();
    // The Map for the currently active file, derived from fileLocationsMap.
    // 当前活动文件的 Map，从 fileLocationsMap 派生。
    static currentActiveFileLocationMap: Map<number, FileLocationData> = new Map();
    static locationData: FileLocationData | undefined; // Data for the currently selected location. 当前选定位置的数据。
}


/**
 * Activates the VS Code extension. This function is called when the extension is activated.
 * 激活 VS Code 扩展。当扩展被激活时调用此函数。
 * @param context The extension context provided by VS Code. 由 VS Code 提供的扩展上下文。
 */
export async function activate(context: vscode.ExtensionContext) {


    // Resolve the configuration file path: replace $workspaceFolder with the actual workspace folder path.
    // 解析配置文件路径：将 $workspaceFolder 替换为实际的工作区文件夹路径。
    if (extensionConfig.filePath.startsWith('$workspaceFolder')) {
        const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
        if (workspaceFolder) {
            extensionConfig.filePath = path.join(workspaceFolder.uri.fsPath, extensionConfig.filePath.substring('$workspaceFolder'.length));
        }
    }

    // Determine the operating system and set the default regex if not user-defined.
    // 确定操作系统并设置默认正则表达式（如果用户未定义）。
    if (extensionConfig.pathRegex.source === " " || extensionConfig.pathRegex.source === "") {
        const platform = process.platform;
        if (platform === 'win32') {
            extensionConfig.osName = 'Windows';
            extensionConfig.pathRegex = /^([A-Za-z]:[\/\\].*?):(\d+)$/;
        } else if (platform === 'darwin') {
            extensionConfig.osName = 'macOS';
            extensionConfig.pathRegex = /^([\/\\].*?):(\d+)$/;
        } else if (platform === 'linux') {
            extensionConfig.osName = 'Linux';
            extensionConfig.pathRegex = /^([\/\\].*?):(\d+)$/;
        } else {
            extensionConfig.osName = 'unknown';
            extensionConfig.pathRegex = /^(.*?):(\d+)$/;
        }
    } else {
        extensionConfig.osName = 'user-defined'; // User has provided a custom regex. 用户提供了自定义正则表达式。
    }

    // Register command to turn off mapping features.
    // 注册关闭映射功能的命令。
    let toggleOffMappingCommand = vscode.commands.registerCommand('jumptrace.close', async () => {
        try {
            extensionConfig.isInterceptingEvents = true; // Prevent other events during this operation. 在此操作期间阻止其他事件。
            extensionConfig.isSingleMappingEnabled = true; // Re-enable single mapping default. 重新启用单向映射默认设置。
            extensionConfig.isDoubleMappingEnabled = true; // Re-enable double mapping default. 重新启用双向映射默认设置。
            extensionConfig.isDoubleMappingActive = true; // Set mapping as default active. 将开关状态设为默认。

            // Clear highlights if active.
            // 如果高亮处于活动状态，则清除高亮。
            if (masterFileState.isHighlighted && masterFileState.editor) { masterFileState.editor.setDecorations(extensionConfig.highlightDecorationType, []); masterFileState.isHighlighted = false; }
            if (assistantFileState.isHighlighted && assistantFileState.editor) { assistantFileState.editor.setDecorations(extensionConfig.highlightDecorationType, []); assistantFileState.isHighlighted = false; }
            vscode.window.showInformationMessage('Mapping has been turned off'); // Inform the user. 通知用户。
        } finally {
            extensionConfig.isInterceptingEvents = false; // Allow events again. 再次允许事件。
        }
    });

    // Register command to switch between single and double mapping modes.
    // 注册在单向和双向映射模式之间切换的命令。
    let toggleMappingModeCommand = vscode.commands.registerCommand('jumptrace.switchover', async () => {
        try {
            extensionConfig.isInterceptingEvents = true; // Prevent other events. 阻止其他事件。
            extensionConfig.isDoubleMappingActive = !extensionConfig.isDoubleMappingActive; // Toggle the mode. 切换模式。

            if (!extensionConfig.isDoubleMappingActive) {
                extensionConfig.isSingleMappingEnabled = false; // Enable single mapping. 启用单向映射。
                vscode.window.showInformationMessage('Single mapping has been enabled');
            } else {
                extensionConfig.isSingleMappingEnabled = false; // Enable single mapping. 启用单向映射。
                extensionConfig.isDoubleMappingEnabled = false; // Enable double mapping. 启用双向映射。
                vscode.window.showInformationMessage('Double mapping has been activated');
            }

            // If the map is empty, extract file locations and open the master file.
            // 如果 map 为空，则提取文件位置并打开主文件。
            if (FileLocationCache.fileLocationsMap.size === 0) {
                await extractFileLocations(extensionConfig.filePath, FileLocationCache.fileLocationsMap, extensionConfig.pathRegex, extensionConfig.skipRegex);
                masterFileState.document = await vscode.workspace.openTextDocument(vscode.Uri.file(extensionConfig.filePath));
                masterFileState.editor = await vscode.window.showTextDocument(masterFileState.document, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Beside, // Open beside the current editor. 在当前编辑器旁边打开。
                });
                assistantFileState.editor = masterFileState.editor; // Initially, assistant editor is the same as master. 初始时，辅助编辑器与主编辑器相同。
            }

            if (!masterFileState.document || !masterFileState.editor) { return; } // If master document is not available, exit. 如果主文档不可用，则退出。

            // Ensure the master file editor is visible.
            // 确保主文件编辑器可见。
            let editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(
                e => {
                    if (!masterFileState.editor) {return false;}
                    return e.document.uri.fsPath === masterFileState.editor.document.uri.fsPath;}
            );
            if (!editor) {
                masterFileState.editor = await vscode.window.showTextDocument(masterFileState.document, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Beside,
                });
            }

        } catch (error: any) {
            vscode.window.showInformationMessage('Configuration error: ' + error.message);
            extensionConfig.hasConfigurationError = true;
        } finally {
            extensionConfig.isInterceptingEvents = false; // Allow events again. 再次允许事件。
        }
    });


    // Main logic: Handle text editor selection changes.
    // 主逻辑：处理文本编辑器选择更改。
    let selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(async (event: vscode.TextEditorSelectionChangeEvent) => {
        // Exit if features are disabled, not a file URI, or intercepting events, or there's a configuration error.
        // 如果功能被禁用、不是文件 URI、正在拦截事件或存在配置错误，则退出。
        if (extensionConfig.isSingleMappingEnabled || event.textEditor.document.uri.scheme !== 'file' || extensionConfig.isInterceptingEvents || extensionConfig.hasConfigurationError) { return; }
        extensionConfig.isInterceptingEvents = true; // Start intercepting events to prevent re-entrancy. 开始拦截事件以防止重入。
        try {
            // If the active editor is neither the master nor the assistant, set it as the assistant.
            // 如果活动编辑器既不是主编辑器也不是辅助编辑器，则将其设置为辅助编辑器。
            if (!(masterFileState.editor === event.textEditor) && !(assistantFileState.editor === event.textEditor)) {
                assistantFileState.editor = event.textEditor;
                assistantFileState.filePath = getActiveEditorFilePath(extensionConfig.osName!, assistantFileState.editor.document.uri.fsPath);
                if (!assistantFileState.filePath) { return; } // If path cannot be normalized, exit. 如果路径无法规范化，则退出。
                const fileMap = FileLocationCache.fileLocationsMap.get(assistantFileState.filePath);
                if (!fileMap) { return; } // If no mapping data for this file, exit. 如果此文件没有映射数据，则退出。
                FileLocationCache.currentActiveFileLocationMap = fileMap;
            }

            if (!assistantFileState.editor || !masterFileState.editor) { return; } // Ensure both editors are available. 确保两个编辑器都可用。

            // If the selection hasn't changed in both editors, do nothing.
            // 如果两个编辑器的选择都没有改变，则不执行任何操作。
            if (masterFileState.editor.selection.active.line === masterFileState.previousLineNumber && assistantFileState.editor.selection.active.line === assistantFileState.previousLineNumber) { return; }

            // Clear previous highlights.
            // 清除以前的高亮。
            if (masterFileState.isHighlighted) { masterFileState.editor.setDecorations(extensionConfig.highlightDecorationType, []); masterFileState.isHighlighted = false; }
            if (assistantFileState.isHighlighted) { assistantFileState.editor.setDecorations(extensionConfig.highlightDecorationType, []); assistantFileState.isHighlighted = false; }

            // Logic for when the assistant file (source file) selection changes.
            // 当辅助文件（源文件）选择改变时的逻辑。
            if (assistantFileState.previousLineNumber !== assistantFileState.editor.selection.active.line) {
                assistantFileState.previousLineNumber = assistantFileState.editor.selection.active.line;
                // Get the location data for the selected line in the assistant file.
                // 获取辅助文件中选定行的位置数据。
                FileLocationCache.locationData = FileLocationCache.currentActiveFileLocationMap.get(assistantFileState.editor.selection.active.line + 1);
                assistantFileState.currentLineNumber = assistantFileState.editor.selection.active.line;
                if (!FileLocationCache.locationData) { return; } // No mapping for this line, exit. 此行无映射，退出。
                // Reveal the corresponding line in the master file.
                // 显示主文件中的对应行。
                masterFileState.editor.revealRange(masterFileState.updateRange(FileLocationCache.locationData.originalFileIndex), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            }
            // Logic for when the master file (config file) selection changes in double mapping mode.
            // 双向映射模式下，当主文件（配置文件）选择改变时的逻辑。
            else if (!extensionConfig.isDoubleMappingEnabled) {
                masterFileState.previousLineNumber = masterFileState.editor.selection.active.line;
                // Search upwards in the master file for a matching path.
                // 在主文件中向上搜索匹配的路径。
                for (let i = masterFileState.editor.selection.active.line; i >= 0; i--) {
                    if (masterFileState.editor.document.lineAt(i).text.match(extensionConfig.skipRegex)) { continue; } // Skip lines. 跳过行。
                    let pathMatch = masterFileState.editor.document.lineAt(i).text.match(extensionConfig.pathRegex);
                    if (pathMatch && pathMatch.length >= 3) {
                        // If the path matches the current assistant file.
                        // 如果路径与当前辅助文件匹配。
                        if (pathMatch[1] === assistantFileState.filePath) {
                            FileLocationCache.locationData = FileLocationCache.currentActiveFileLocationMap.get(parseInt(pathMatch[2]));
                            assistantFileState.currentLineNumber = parseFloat(pathMatch[2]) - 1;
                            assistantFileState.editor.revealRange(assistantFileState.updateRange(assistantFileState.currentLineNumber), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
                            break; // Found a match, break the loop. 找到匹配项，跳出循环。
                        }
                        // If a different file path is found, open it in the assistant editor.
                        // 如果找到不同的文件路径，则在辅助编辑器中打开它。
                        const newAssistantEditor = await openFileAndJumpToLine(pathMatch[1], parseInt(pathMatch[2]) - 1);
                        if (!newAssistantEditor) { return; } // Failed to open file, exit. 打开文件失败，退出。
                        assistantFileState.editor = newAssistantEditor;
                        assistantFileState.filePath = getActiveEditorFilePath(extensionConfig.osName!, assistantFileState.editor.document.uri.fsPath);
                        if (!assistantFileState.filePath) { return; }
                        let newFileMap = FileLocationCache.fileLocationsMap.get(pathMatch[1]);
                        if (!newFileMap) { return; }
                        FileLocationCache.currentActiveFileLocationMap = newFileMap;
                        FileLocationCache.locationData = FileLocationCache.currentActiveFileLocationMap.get(parseInt(pathMatch[2]));
                        assistantFileState.currentLineNumber = parseFloat(pathMatch[2]) - 1;
                        break; // Found a match, break the loop. 找到匹配项，跳出循环。
                    }
                }
            } else { return; } // No relevant selection change. 没有相关的选择更改。

            // Update previous line numbers for both editors.
            // 更新两个编辑器的上一个行号。
            masterFileState.previousLineNumber = masterFileState.editor.selection.active.line;
            assistantFileState.previousLineNumber = assistantFileState.editor.selection.active.line;

            // Apply highlights to both editors.
            // 对两个编辑器应用高亮。
            if (!FileLocationCache.locationData || !assistantFileState.currentLineNumber)  { return; } // No mapping for this line, exit. 此行无映射，退出
            highlightLines(assistantFileState.editor, assistantFileState.currentLineNumber, 1, extensionConfig.highlightDecorationType);
            highlightLines(masterFileState.editor, FileLocationCache.locationData.originalFileIndex, FileLocationCache.locationData.highlightLineCount, extensionConfig.highlightDecorationType);
            masterFileState.isHighlighted = true;
            assistantFileState.isHighlighted = true;
        } catch (error: any) {
            vscode.window.showInformationMessage('Execution failed: ' + error.message);
        } finally {
            extensionConfig.isInterceptingEvents = false; // Stop intercepting events. 停止拦截事件。
        }

    });


    // Register listener for configuration changes.
    // 注册配置更改的监听器。
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        try {
            extensionConfig.isInterceptingEvents = true; // Prevent events during config update. 在配置更新期间阻止事件。
            if (event.affectsConfiguration('jumptrace')) {
                let oldFilePath = extensionConfig.filePath; // Store old file path to check if map needs clearing. 存储旧文件路径以检查是否需要清除 map。
                extensionConfig.disposeDecorationType(); // Dispose old decoration type. 释放旧的装饰类型。
                extensionConfig = new ExtensionConfiguration(); // Recreate config to load new settings. 重新创建配置以加载新设置。

                // Re-resolve workspace folder path for the config file.
                // 重新解析配置文件的工作区文件夹路径。
                if (extensionConfig.filePath.startsWith('$workspaceFolder')) {
                    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
                    if (workspaceFolder) {
                        extensionConfig.filePath = path.join(workspaceFolder.uri.fsPath, extensionConfig.filePath.substring('$workspaceFolder'.length));
                    }
                }
                // Clear the file location map if the config file path has changed.
                // 如果配置文件路径已更改，则清除文件位置 map。
                if (oldFilePath !== extensionConfig.filePath) {
                    FileLocationCache.fileLocationsMap.clear();
                    FileLocationCache.currentActiveFileLocationMap.clear();
                }

                // Re-determine OS-specific regex if not user-defined.
                // 如果用户未定义，则重新确定特定于操作系统的正则表达式。
                if (extensionConfig.pathRegex.source === " " || extensionConfig.pathRegex.source === "") {
                    const platform = process.platform;
                    if (platform === 'win32') {
                        extensionConfig.osName = 'Windows';
                        extensionConfig.pathRegex = /^([A-Za-z]:[\/\\].*?):(\d+)$/;
                    } else if (platform === 'darwin') {
                        extensionConfig.osName = 'macOS';
                        extensionConfig.pathRegex = /^([\/\\].*?):(\d+)$/;
                    } else if (platform === 'linux') {
                        extensionConfig.osName = 'Linux';
                        extensionConfig.pathRegex = /^([\/\\].*?):(\d+)$/;
                    } else {
                        extensionConfig.osName = 'unknown';
                        extensionConfig.pathRegex = /^(.*?):(\d+)$/;
                    }
                } else {
                    extensionConfig.osName = 'user-defined';
                }

                // Reset error flag.
                // 重置错误标志。
                extensionConfig.hasConfigurationError = false;
            }
        } catch (error: any) {
            vscode.window.showInformationMessage('Configuration error: ' + error.message);
            extensionConfig.hasConfigurationError = true;
        } finally {
            extensionConfig.isInterceptingEvents = false; // Allow events again. 再次允许事件。
        }
    }));


    // Add all disposables to the context.
    // 将所有可释放对象添加到上下文中。
    context.subscriptions.push(toggleOffMappingCommand, selectionChangeDisposable, toggleMappingModeCommand);
}

/**
 * Deactivates the VS Code extension. This function is called when the extension is deactivated.
 * 停用 VS Code 扩展。当扩展被停用时调用此函数。
 */
export function deactivate() {
    // Clear any active highlights.
    // 清除任何活动高亮。
    if (masterFileState.isHighlighted && masterFileState.editor) { masterFileState.editor.setDecorations(extensionConfig.highlightDecorationType, []); masterFileState.isHighlighted = false; }
    if (assistantFileState.isHighlighted && assistantFileState.editor) { assistantFileState.editor.setDecorations(extensionConfig.highlightDecorationType, []); assistantFileState.isHighlighted = false; }

    // Dispose the decoration type to release resources.
    // 释放装饰类型以释放资源。
    if (extensionConfig.highlightDecorationType) { extensionConfig.highlightDecorationType.dispose(); }

    // Clear cached file location data.
    // 清除缓存的文件位置数据。
    FileLocationCache.fileLocationsMap.clear();
    FileLocationCache.currentActiveFileLocationMap.clear();
}