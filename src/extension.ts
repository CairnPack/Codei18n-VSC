import * as vscode from 'vscode';
import { TranslationController } from './controller';
import { ghostText } from './core/display';
import { anchorOf, ghostSettings, GhostTextPresenter, hoverMarkdown, StatusBarPresenter, TranslationHoverProvider } from './presentation';
import { SideViewController, viewUri } from './sideView';
import { Grammars } from './treesitter/extractor';

export function activate(context: vscode.ExtensionContext): void {
    const grammars = new Grammars(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'web-tree-sitter.wasm').fsPath,
        name => vscode.Uri.joinPath(context.extensionUri, 'grammars', `tree-sitter-${name}.wasm`).fsPath,
    );
    const controller = new TranslationController(grammars);
    const sideView = new SideViewController(controller);
    context.subscriptions.push(
        controller,
        sideView,
        new GhostTextPresenter(controller),
        new StatusBarPresenter(controller),
        vscode.languages.registerHoverProvider({ pattern: '**' }, new TranslationHoverProvider(controller)),
        vscode.commands.registerCommand('codei18n.toggle', toggleEnabled),
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
            return {
                root: result.root?.toString(),
                language: result.index?.language,
                error: result.error,
                version: result.version,
                reason: result.reason,
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
    const config = vscode.workspace.getConfiguration('codei18n', uri);
    const inspect = config.inspect<boolean>('enabled');
    const target = inspect?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspect?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    await config.update('enabled', !config.get<boolean>('enabled', true), target);
}

export function deactivate(): void {}
