import * as vscode from 'vscode';
import { ghostText } from './core/display';
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

/** 行尾幽灵文字：一个 after 装饰类型，颜色用主题的内嵌提示前景色。 */
export class GhostTextPresenter implements vscode.Disposable {
    private readonly type = vscode.window.createTextEditorDecorationType({
        after: { color: new vscode.ThemeColor('editorInlayHint.foreground'), margin: '0 0 0 1.5em', fontStyle: 'italic' },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    private readonly disposables: vscode.Disposable[] = [this.type];

    constructor(private readonly controller: TranslationController) {
        this.disposables.push(
            controller.onDidChange(uri => this.render(uri)),
            vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(e => this.renderEditor(e))),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('codei18n')) vscode.window.visibleTextEditors.forEach(ed => this.renderEditor(ed));
            }),
        );
    }

    private render(uri: vscode.Uri): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri.toString()) this.renderEditor(editor);
        }
    }

    private renderEditor(editor: vscode.TextEditor): void {
        const document = editor.document;
        const settings = ghostSettings(document.uri);
        const { hints } = this.controller.get(document.uri);
        if (!settings.enabled || hints.length === 0) {
            editor.setDecorations(this.type, []);
            return;
        }
        // 同一行有多条译文（例如块注释后接行尾注释）时合并显示。
        const byLine = new Map<number, string[]>();
        for (const hint of hints) {
            if (hint.end > document.getText().length) continue;
            const text = ghostText(hint.text, settings.maxLength);
            if (text === '') continue;
            const line = anchorOf(document, hint).line;
            byLine.set(line, [...(byLine.get(line) ?? []), text]);
        }
        editor.setDecorations(this.type, [...byLine].map(([line, texts]) => {
            const end = document.lineAt(line).range.end;
            return { range: new vscode.Range(end, end), renderOptions: { after: { contentText: texts.join('  ') } } };
        }));
    }

    dispose(): void {
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
