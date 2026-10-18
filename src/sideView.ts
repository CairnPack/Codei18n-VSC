import * as vscode from 'vscode';
import { LineMap, translateSource } from './core/sideView';
import { TranslationController } from './controller';

export const SCHEME = 'codei18n';
/** 程序触发滚动后，在这段时间内忽略目标编辑器的滚动事件，避免两边来回同步。 */
const SYNC_WINDOW_MS = 300;

interface View {
    readonly source: vscode.Uri;
    lines: LineMap;
    text: string;
    readonly target: vscode.Disposable;
}

/**
 * 侧边译文视图（替代 IDEA 的"替换模式"）：自定义 scheme 的只读虚拟文档，内容是把注释替换成译文的源码，
 * 使用与原文件相同的 languageId；原文件修改后随之刷新；两边滚动时相同的代码行对齐。绝不写回磁盘。
 */
export class SideViewController implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly views = new Map<string, View>();
    private readonly changed = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [this.changed];
    /** 程序触发的滚动：目标编辑器与预期的首行，收到对应事件时不再反向同步。 */
    private readonly expected = new Map<vscode.TextEditor, { line: number; until: number; corrected: boolean }>();

    constructor(private readonly controller: TranslationController) {
        this.disposables.push(
            vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
            controller.onDidChange(uri => {
                const view = viewUri(uri);
                if (this.views.has(view.toString())) this.changed.fire(view);
            }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                if (doc.uri.scheme !== SCHEME) return;
                this.views.get(doc.uri.toString())?.target.dispose();
                this.views.delete(doc.uri.toString());
            }),
            vscode.window.onDidChangeTextEditorVisibleRanges(e => this.sync(e.textEditor, e.visibleRanges)),
        );
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        const source = sourceUri(uri);
        let view = this.views.get(uri.toString());
        if (!view) {
            view = { source, lines: new LineMap([]), text: '', target: this.controller.addTarget(source) };
            this.views.set(uri.toString(), view);
        }
        const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === source.toString());
        if (!document) return view.text;
        const { hints } = this.controller.get(source);
        const translated = translateSource(document.getText(), [...hints].sort((a, b) => a.start - b.start));
        view.text = translated.text;
        view.lines = translated.lines;
        return translated.text;
    }

    /** 打开或关闭当前文件的侧边译文视图（Ctrl+Alt+Shift+P）。 */
    async toggle(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const uri = editor.document.uri;
        if (uri.scheme === SCHEME) {
            await closeTabs(uri);
            return;
        }
        const view = viewUri(uri);
        if (vscode.window.visibleTextEditors.some(e => e.document.uri.toString() === view.toString())) {
            await closeTabs(view);
            return;
        }
        await this.open(editor);
    }

    async open(editor: vscode.TextEditor): Promise<vscode.TextEditor> {
        const view = viewUri(editor.document.uri);
        let document = await vscode.workspace.openTextDocument(view);
        if (document.languageId !== editor.document.languageId) {
            document = await vscode.languages.setTextDocumentLanguage(document, editor.document.languageId);
        }
        const shown = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
        this.sync(editor, editor.visibleRanges);
        return shown;
    }

    /** 测试用：视图的文本与行映射。 */
    snapshot(view: vscode.Uri): { text: string; lines: LineMap } | undefined {
        const v = this.views.get(view.toString());
        return v && { text: v.text, lines: v.lines };
    }

    private sync(editor: vscode.TextEditor, ranges: readonly vscode.Range[]): void {
        if (ranges.length === 0) return;
        const top = ranges[0].start.line;
        const pending = this.expected.get(editor);
        if (pending && Date.now() < pending.until) {
            // 程序触发的滚动：不反向同步。revealRange(AtTop) 可能停在目标行上方几行，校正一次。
            if (top !== pending.line && !pending.corrected) {
                pending.corrected = true;
                const adjusted = Math.max(0, pending.line + (pending.line - top));
                editor.revealRange(new vscode.Range(adjusted, 0, adjusted, 0), vscode.TextEditorRevealType.AtTop);
            }
            return;
        }
        this.expected.delete(editor);
        const uri = editor.document.uri;
        let other: vscode.Uri;
        let line: number;
        if (uri.scheme === SCHEME) {
            const view = this.views.get(uri.toString());
            if (!view) return;
            other = view.source;
            line = view.lines.toSource(top);
        } else {
            other = viewUri(uri);
            const view = this.views.get(other.toString());
            if (!view) return;
            line = view.lines.toView(top);
        }
        for (const target of vscode.window.visibleTextEditors) {
            if (target === editor || target.document.uri.toString() !== other.toString()) continue;
            if (target.visibleRanges[0]?.start.line === line) continue;
            this.expected.set(target, { line, until: Date.now() + SYNC_WINDOW_MS, corrected: false });
            target.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
        }
    }

    dispose(): void {
        for (const view of this.views.values()) view.target.dispose();
        this.views.clear();
        this.disposables.forEach(d => d.dispose());
    }
}

/** 源文件对应的视图 URI：路径保留原文件名（标题与语言识别），查询串是源文件 URI。 */
export function viewUri(source: vscode.Uri): vscode.Uri {
    return vscode.Uri.from({ scheme: SCHEME, path: source.path, query: source.toString() });
}

export function sourceUri(view: vscode.Uri): vscode.Uri {
    return vscode.Uri.parse(view.query);
}

async function closeTabs(uri: vscode.Uri): Promise<void> {
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs)
        .filter(t => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString());
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs);
}
