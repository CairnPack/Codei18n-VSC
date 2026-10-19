import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

export interface HintState {
    start: vscode.Position;
    end: vscode.Position;
    anchorLine: number;
    comment: string;
    text: string;
    type?: string;
    via: string;
    parts: number;
    sourceLanguage: string;
    ghost: string;
    hover: string;
}

export interface DocState {
    root?: string;
    language?: string;
    error?: string;
    version: number;
    hints: HintState[];
}

export const SAMPLES = ['Inventory.kt', 'OrderService.java', 'cart.ts', 'format.js', 'invoice.dart', 'Ledger.cs'];

export function workspaceDir(): string {
    return vscode.workspace.workspaceFolders![0].uri.fsPath;
}

export function readJson(...path: string[]): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return JSON.parse(readFileSync(join(workspaceDir(), ...path), 'utf8'));
}

export async function activate(): Promise<void> {
    const extension = vscode.extensions.getExtension('cairnpack.codei18n-vscode');
    assert.ok(extension, '找不到扩展');
    await extension.activate();
}

export async function open(name: string): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspaceDir(), name)));
    return vscode.window.showTextDocument(document, { preview: false });
}

/** 测试模式内部命令返回的当前提示列表。`waitIdle` 为 false 时不等待刷新完成（用于断言编辑后的即时行为）。 */
export async function state(document: vscode.TextDocument, waitIdle = true): Promise<DocState | undefined> {
    return vscode.commands.executeCommand<DocState | undefined>('codei18n._test.state', document.uri.toString(), waitIdle);
}

/** 反复读取直到满足条件；超时则用最后一次的结果报错。 */
export async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 20_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let value = await read();
    while (!ok(value)) {
        if (Date.now() > deadline) assert.fail(`等待超时：${what}\n最后一次：${JSON.stringify(value, null, 1).substring(0, 3000)}`);
        await new Promise(r => setTimeout(r, 100));
        value = await read();
    }
    return value;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

/** 按 index.json + mappings.json 计算某个样例文件应当显示的译文。 */
export function expectedHints(name: string): { line: number; character: number; anchorLine: number; text: string; type: string; parts: number }[] {
    const index = readJson('.codei18n', 'index.json');
    const mappings = readJson('.codei18n', 'mappings.json');
    return index.files[name].comments
        .filter((c: { id: string }) => (mappings.comments[c.id]?.['zh-CN'] ?? '').trim() !== '')
        .map((c: { id: string; type: string; parts: number; range: { startLine: number; startCol: number; endLine: number } }) => ({
            line: c.range.startLine - 1, character: c.range.startCol - 1, anchorLine: c.range.endLine - 1,
            text: mappings.comments[c.id]['zh-CN'], type: c.type, parts: c.parts,
        }));
}

export async function resetSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration('codei18n');
    for (const key of ['enabled', 'language', 'ghostText.enabled', 'ghostText.maxLength', 'hover.enabled']) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
}
