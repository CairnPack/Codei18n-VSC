import * as vscode from 'vscode';
import { TranslationController } from './controller';
import { ghostText } from './core/display';
import { t } from './l10n';
import { anchorOf, displayMode, DisplayMode, EditorPresenter, ghostSettings, hoverMarkdown, StatusBarPresenter, TranslationHoverProvider } from './presentation';
import { SideViewController, viewUri } from './sideView';
import { Grammars } from './treesitter/extractor';

export function activate(context: vscode.ExtensionContext): void {
    const grammars = new Grammars(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'web-tree-sitter.wasm').fsPath,
        name => vscode.Uri.joinPath(context.extensionUri, 'grammars', `tree-sitter-${name}.wasm`).fsPath,
    );
    const controller = new TranslationController(grammars);
    const sideView = new SideViewController(controller);
    const presenter = new EditorPresenter(controller);
    context.subscriptions.push(
        controller,
        sideView,
        presenter,
        new StatusBarPresenter(controller),
        vscode.languages.registerHoverProvider({ pattern: '**' }, new TranslationHoverProvider(controller)),
        vscode.commands.registerCommand('codei18n.toggle', toggleEnabled),
        vscode.commands.registerCommand('codei18n.switchDisplayMode', switchDisplayMode),
        vscode.commands.registerCommand('codei18n.reload', () => controller.reload()),
        vscode.commands.registerCommand('codei18n.toggleSideView', () => sideView.toggle()),
    );

    // 扩展拿不到装饰的渲染结果：测试模式下提供内部命令，返回当前计算出的提示列表。
    if (context.extensionMode === vscode.ExtensionMode.Test) {
        context.subscriptions.push(vscode.commands.registerCommand('codei18n._test.state', async (uri: string, waitIdle = true) => {
            if (waitIdle) await controller.idle();
            const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
            const result = document && controller.get(document.uri);
            if (!document || !result) return undefined;
            const settings = ghostSettings(document.uri);
            const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
            const plan = editor && presenter.plan(editor);
            return {
                root: result.root?.toString(),
                language: result.index?.language,
                error: result.error,
                version: result.version,
                reason: result.reason,
                display: plan && {
                    mode: plan.mode, ghost: plan.ghost,
                    hidden: plan.hidden.map(r => document.getText(r)),
                    labels: plan.labels.map(l => ({ line: l.position.line, character: l.position.character, text: l.text })),
                },
                hints: result.hints.map(h => ({
                    start: document.positionAt(h.start), end: document.positionAt(h.end),
                    anchorLine: anchorOf(document, h).line,
                    comment: document.getText().substring(h.start, h.end),
                    text: h.text, type: h.type, via: h.via, parts: h.parts, sourceLanguage: h.sourceLanguage,
                    ghost: settings.enabled ? ghostText(h.text, settings.maxLength) : '',
                    hover: hoverMarkdown(document, h, result.index?.language ?? '').value,
                })),
            };
        }));
        context.subscriptions.push(vscode.commands.registerCommand('codei18n._test.sideView', async (uri: string) => {
            await controller.idle();
            const view = viewUri(vscode.Uri.parse(uri));
            const snapshot = sideView.snapshot(view);
            return snapshot && { uri: view.toString(), text: snapshot.text, blocks: snapshot.lines.blocks };
        }));
    }
}

/**
 * 开关译文显示：改写当前生效的那一级 codei18n.enabled 设置。没有在工作区或文件夹级别设置过时改用户设置，
 * 不在项目里新建 .vscode/settings.json。
 */
async function toggleEnabled(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    await update('enabled', !vscode.workspace.getConfiguration('codei18n', uri).get<boolean>('enabled', true), uri);
}

/** 在行尾显示与替换显示之间切换，写入方式与 toggleEnabled 相同。 */
async function switchDisplayMode(): Promise<void> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const next: DisplayMode = (uri ? displayMode(uri) : 'ghost') === 'ghost' ? 'replace' : 'ghost';
    await update('display', next, uri);
    void vscode.window.setStatusBarMessage(t.displayMode(next), 3000);
}

/** 改写当前生效的那一级设置；没有在工作区或文件夹级别设置过时改用户设置。 */
async function update(key: string, value: unknown, uri: vscode.Uri | undefined): Promise<void> {
    const config = vscode.workspace.getConfiguration('codei18n', uri);
    const inspect = config.inspect(key);
    const target = inspect?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspect?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    await config.update(key, value, target);
}

export function deactivate(): void {}
