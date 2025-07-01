// src/logger.ts
import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | undefined;


    // 初始化日志模块
//Logger.initializeLogger("jumptrace");
//context.subscriptions.push({ dispose: () => Logger.dispose() });
export class Logger {
    /**
     * 初始化日志模块。必须在插件激活时调用一次。
     * @param channelName 日志通道的名称。
     */
    static initializeLogger(channelName: string) {
        initializeLogger(channelName);
    }

    /**
     * 打印一条信息到日志通道。
     * @param message 要打印的信息。
     * @param optionalParams 附加参数（会被转换为字符串并连接）。
     */
    static log(message: string, ...optionalParams: any[]) {
        log(message, ...optionalParams);
    }

    /**
     * 打印一条错误信息到日志通道。
     * @param message 错误信息。
     * @param error 错误对象（可选，会打印堆栈）。
     * @param optionalParams 附加参数。
     */
    static error(message: string, error?: any, ...optionalParams: any[]) {
        error(message, error, ...optionalParams);
    }

    /**
     * 显示日志通道。
     * @param preserveFocus 是否保留焦点在当前编辑器。
     */
    static show(preserveFocus: boolean = true) {
        show(preserveFocus);
    }

    /**
     * 清理日志通道。
     */
    static dispose() {
        dispose();
    }
}

/**
 * 初始化日志模块。必须在插件激活时调用一次。
 * @param channelName 日志通道的名称。
 */
export function initializeLogger(channelName: string) {
    if (!_channel) {
        _channel = vscode.window.createOutputChannel(channelName);
    }
}

/**
 * 打印一条信息到日志通道。
 * @param message 要打印的信息。
 * @param optionalParams 附加参数（会被转换为字符串并连接）。
 */
export function log(message: string, ...optionalParams: any[]) {
    if (!_channel) {
        console.warn('Logger not initialized. Falling back to console.');
        console.log(message, ...optionalParams);
        return;
    }
    const timestamp = new Date().toLocaleString();
    const formattedMessage = typeof message === 'string' ? message : JSON.stringify(message);
    const paramsString = optionalParams.map(param => {
        if (typeof param === 'object' && param !== null) {
            return JSON.stringify(param);
        }
        return String(param);
    }).join(' ');
    _channel.appendLine(`[${timestamp}] ${formattedMessage} ${paramsString}`.trim());
}

/**
 * 打印一条错误信息到日志通道。
 * @param message 错误信息。
 * @param error 错误对象（可选，会打印堆栈）。
 * @param optionalParams 附加参数。
 */
export function error(message: string, error?: any, ...optionalParams: any[]) {
    if (!_channel) {
        console.warn('Logger not initialized. Falling back to console.');
        console.error(message, error, ...optionalParams);
        return;
    }
    const timestamp = new Date().toLocaleString();
    _channel.appendLine(`[${timestamp}] 错误: ${message} ${optionalParams.map(String).join(' ')}`.trim());
    if (error && error.stack) {
        _channel.appendLine(error.stack);
    } else if (error) {
        _channel.appendLine(String(error));
    }
}

/**
 * 显示日志通道。
 * @param preserveFocus 是否保留焦点在当前编辑器。
 */
export function show(preserveFocus: boolean = true) {
    _channel?.show(preserveFocus);
}

/**
 * 清理日志通道。
 */
export function dispose() {
    _channel?.dispose();
    _channel = undefined;
}