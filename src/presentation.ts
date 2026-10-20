import * as vscode from 'vscode';
import { ghostText } from './core/display';
import { replaceSegments } from './core/replaceDisplay';
import { toMarkdown } from './core/docMarkdown';
import { family } from './core/docMarkup';
import { Hint } from './core/hints';
import { MatchVia } from './core/mappingIndex';
import { TranslationController } from './controller';
import { t } from './l10n';

/** 译文在编辑器中的位置：幽灵文字挂在注释（组）最后一行的行尾。 */
export function anchorOf(document: vscode.TextDocument, hint: Hint): vscode.Position {
    return document.lineAt(document.positionAt(hint.end).line).range.end;
}

/** 幽灵文字设置（按资源）。 */
export function ghostSettings(uri: vscode.Uri): { enabled: boolean; maxLength: number } {
    const config = vscode.workspace.getConfiguration('codei18n', uri);
    return { enabled: config.get<boolean>('ghostText.enabled', true), maxLength: config.get<number>('ghostText.maxLength', 80) };
}

/** 悬停内容：完整译文（文档注释按语言渲染）+ 底部小字的原语言与命中方式。 */
export function hoverMarkdown(document: vscode.TextDocument, hint: Hint, language: string): vscode.MarkdownString {
    const doc = hint.type === 'doc';
    const body = toMarkdown(hint.text, doc, family(null, document.uri.path), language);
    const md = new vscode.MarkdownString(undefined, true);
    md.supportHtml = true;
    md.isTrusted = false;
    md.appendMarkdown(body);
    md.appendMarkdown(`\n\n---\n\n<small>CodeI18n · ${t.sourceLanguage}: ${escapeHtml(hint.sourceLanguage || '?')} · ${t.matchedBy}: ${t.via[hint.via as MatchVia]}</small>`);
    return md;
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** 显示模式：行尾幽灵文字、替换原注释。 */
export type DisplayMode = 'ghost' | 'replace';

export function displayMode(uri: vscode.Uri): DisplayMode {
    const mode = vscode.workspace.getConfiguration('codei18n', uri).get<string>('display', 'ghost');
    return mode === 'replace' ? mode : 'ghost';
}

/** 替换显示时，光标离开注释后多久重新换回译文（与 IDEA 一致）。 */
const REHIDE_MS = 600;

/** 编辑器中实际绘制的内容，供测试读取。 */
export interface RenderPlan {
    readonly mode: DisplayMode;
    readonly ghost: readonly { line: number; text: string }[];
    readonly hidden: readonly vscode.Range[];
    readonly labels: readonly { position: vscode.Position; text: string }[];
}

/**
 * 编辑器装饰：
 * - 行尾模式：注释（组）最后一行的行尾显示幽灵文字；
 * - 替换模式：隐藏注释文字并在原位显示译文（textDecoration 注入 `display: none`，文档内容不变）。
 *   光标所在行碰到的注释露出原文，译文暂时改为行尾幽灵文字；光标离开约 600 ms 后换回译文。
 */
export class EditorPresenter implements vscode.Disposable {
    private readonly ghostType = vscode.window.createTextEditorDecorationType({
        after: { color: new vscode.ThemeColor('editorInlayHint.foreground'), margin: '0 0 0 1.5em', fontStyle: 'italic' },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    private readonly hideType = vscode.window.createTextEditorDecorationType({
        textDecoration: 'none; display: none;',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    private readonly labelType = vscode.window.createTextEditorDecorationType({
        before: { color: new vscode.ThemeColor('codei18n.replaceForeground') },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    private readonly disposables: vscode.Disposable[] = [this.ghostType, this.hideType, this.labelType];
    /** 每个编辑器中露出原文的注释（按起始偏移）。 */
    private readonly revealed = new Map<vscode.TextEditor, Set<number>>();
    private readonly timers = new Map<vscode.TextEditor, ReturnType<typeof setTimeout>>();
    private readonly plans = new Map<vscode.TextEditor, RenderPlan>();

    constructor(private readonly controller: TranslationController) {
        this.disposables.push(
            controller.onDidChange(uri => this.render(uri)),
            vscode.window.onDidChangeVisibleTextEditors(editors => {
                this.prune(editors);
                editors.forEach(e => this.renderEditor(e));
            }),
            vscode.window.onDidChangeTextEditorSelection(e => this.selectionChanged(e.textEditor)),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('codei18n')) vscode.window.visibleTextEditors.forEach(ed => this.renderEditor(ed));
            }),
        );
    }

    /** 测试用：编辑器当前绘制的内容。 */
    plan(editor: vscode.TextEditor): RenderPlan | undefined {
        return this.plans.get(editor);
    }

    private render(uri: vscode.Uri): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri.toString()) this.renderEditor(editor);
        }
    }

    private renderEditor(editor: vscode.TextEditor): void {
        const document = editor.document;
        const mode = displayMode(document.uri);
        const settings = ghostSettings(document.uri);
        const length = document.getText().length; // getText 每次都会重新拼接整篇文本，只取一次
        const hints = this.controller.get(document.uri).hints.filter(h => h.end <= length);
        const ghosts: Hint[] = [];
        const replaced: Hint[] = [];
        if (mode === 'ghost') {
            if (settings.enabled) ghosts.push(...hints);
        } else {
            const shown = new Set([...(this.revealed.get(editor) ?? []), ...this.touched(editor, hints)]);
            for (const h of hints) (shown.has(h.start) ? ghosts : replaced).push(h);
        }

        // 同一行有多条译文（例如块注释后接行尾注释）时合并显示。
        const byLine = new Map<number, string[]>();
        for (const hint of ghosts) {
            const text = ghostText(hint.text, settings.maxLength);
            if (text === '') continue;
            const line = anchorOf(document, hint).line;
            byLine.set(line, [...(byLine.get(line) ?? []), text]);
        }
        const ghost = [...byLine].map(([line, texts]) => ({ line, text: texts.join('  ') }));
        editor.setDecorations(this.ghostType, ghost.map(({ line, text }) => {
            const end = document.lineAt(line).range.end;
            return { range: new vscode.Range(end, end), renderOptions: { after: { contentText: text } } };
        }));

        const hidden: vscode.Range[] = [];
        const labels: { position: vscode.Position; text: string }[] = [];
        for (const hint of replaced) {
            const start = document.positionAt(hint.start);
            const end = document.positionAt(hint.end);
            const lines: string[] = [];
            for (let l = start.line; l <= end.line; l++) lines.push(document.lineAt(l).text);
            const original = document.getText(new vscode.Range(start, end));
            for (const s of replaceSegments(lines, start.character, end.character, original, hint.text)) {
                const line = start.line + s.line;
                if (s.end > s.start) hidden.push(new vscode.Range(line, s.start, line, s.end));
                if (s.label !== '') labels.push({ position: new vscode.Position(line, s.start), text: s.label });
            }
        }
        editor.setDecorations(this.hideType, hidden);
        editor.setDecorations(this.labelType, labels.map(({ position, text }) => ({
            range: new vscode.Range(position, position), renderOptions: { before: { contentText: text } },
        })));
        this.plans.set(editor, { mode, ghost, hidden, labels });
    }

    /** 替换模式：光标进入注释时立即露出原文；离开后稍等再换回译文，避免光标经过时闪烁。 */
    private selectionChanged(editor: vscode.TextEditor): void {
        if (displayMode(editor.document.uri) !== 'replace') return;
        const touched = this.touched(editor, this.controller.get(editor.document.uri).hints);
        const shown = this.revealed.get(editor) ?? new Set<number>();
        if ([...touched].some(s => !shown.has(s))) {
            this.revealed.set(editor, new Set([...shown, ...touched]));
            this.renderEditor(editor);
        }
        if ([...shown].some(s => !touched.has(s))) {
            clearTimeout(this.timers.get(editor));
            this.timers.set(editor, setTimeout(() => {
                this.timers.delete(editor);
                this.revealed.set(editor, this.touched(editor, this.controller.get(editor.document.uri).hints));
                this.renderEditor(editor);
            }, REHIDE_MS));
        }
    }

    /** 与任一选区所在行相交的注释。 */
    private touched(editor: vscode.TextEditor, hints: readonly Hint[]): Set<number> {
        const document = editor.document;
        const out = new Set<number>();
        for (const h of hints) {
            const first = document.positionAt(h.start).line;
            const last = document.positionAt(h.end).line;
            if (editor.selections.some(s => s.start.line <= last && s.end.line >= first)) out.add(h.start);
        }
        return out;
    }

    private prune(visible: readonly vscode.TextEditor[]): void {
        for (const editor of [...this.plans.keys()]) {
            if (visible.includes(editor)) continue;
            this.plans.delete(editor);
            this.revealed.delete(editor);
            clearTimeout(this.timers.get(editor));
            this.timers.delete(editor);
        }
    }

    dispose(): void {
        this.timers.forEach(t => clearTimeout(t));
        this.disposables.forEach(d => d.dispose());
    }
}

/** 悬停在有译文的注释上时显示完整译文。 */
export class TranslationHoverProvider implements vscode.HoverProvider {
    constructor(private readonly controller: TranslationController) {}

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        if (!vscode.workspace.getConfiguration('codei18n', document.uri).get<boolean>('hover.enabled', true)) return undefined;
        const result = this.controller.get(document.uri);
        if (result.version !== document.version || !result.index) return undefined;
        const offset = document.offsetAt(position);
        const hint = result.hints.find(h => offset >= h.start && offset <= h.end);
        if (!hint) return undefined;
        const range = new vscode.Range(document.positionAt(hint.start), document.positionAt(hint.end));
        return new vscode.Hover(hoverMarkdown(document, hint, result.index.language), range);
    }
}

/** 状态栏：有 .codei18n 的文件上显示显示语言与命中数量；加载出错时显示警告。点击打开设置。 */
export class StatusBarPresenter implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem('codei18n.status', vscode.StatusBarAlignment.Right, 100);
    private readonly disposables: vscode.Disposable[] = [this.item];

    constructor(private readonly controller: TranslationController) {
        this.item.name = 'CodeI18n';
        this.item.command = { title: 'CodeI18n', command: 'workbench.action.openSettings', arguments: ['@ext:cairnpack.codei18n-vscode'] };
        this.disposables.push(
            controller.onDidChange(uri => {
                if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) this.update();
            }),
            vscode.window.onDidChangeActiveTextEditor(() => this.update()),
        );
        this.update();
    }

    private update(): void {
        const editor = vscode.window.activeTextEditor;
        const result = editor && this.controller.get(editor.document.uri);
        if (!editor || !result?.root) {
            const enabled = editor && vscode.workspace.getConfiguration('codei18n', editor.document.uri).get<boolean>('enabled', true);
            if (editor && enabled === false) {
                this.item.text = '$(eye-closed) CodeI18n';
                this.item.tooltip = t.statusDisabled;
                this.item.backgroundColor = undefined;
                this.item.show();
            } else {
                this.item.hide();
            }
            return;
        }
        if (result.error) {
            this.item.text = '$(warning) CodeI18n';
            this.item.tooltip = t.statusError(result.error);
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            const language = result.index?.language ?? '';
            this.item.text = `$(globe) ${language} · ${result.hints.length}`;
            this.item.tooltip = t.statusTooltip(language, result.hints.length);
            this.item.backgroundColor = undefined;
        }
        this.item.show();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
