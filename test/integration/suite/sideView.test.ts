import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { activate, expectedHints, open, resetSettings, sleep, state, waitFor, workspaceDir } from './helpers';

interface Block { srcStart: number; srcEnd: number; viewStart: number; viewEnd: number }
interface Snapshot { uri: string; text: string; blocks: Block[] }

function mapLine(blocks: Block[], line: number, toView: boolean): number {
    let delta = 0;
    for (const b of blocks) {
        const [fs, fe, ts, te] = toView ? [b.srcStart, b.srcEnd, b.viewStart, b.viewEnd] : [b.viewStart, b.viewEnd, b.srcStart, b.srcEnd];
        if (line < fs) break;
        if (line <= fe) return ts + Math.min(line - fs, te - ts);
        delta = te - fe;
    }
    return line + delta;
}

const snapshot = async (source: vscode.Uri) =>
    await vscode.commands.executeCommand<Snapshot | undefined>('codei18n._test.sideView', source.toString());

const viewEditor = () => vscode.window.visibleTextEditors.find(e => e.document.uri.scheme === 'codei18n');

/** 滚动停下后的首行（连续 300 ms 不变）。 */
async function settledTop(editor: vscode.TextEditor): Promise<number> {
    let last = -1;
    let stableSince = Date.now();
    for (const deadline = Date.now() + 10_000; Date.now() < deadline; await sleep(50)) {
        const top = editor.visibleRanges[0]?.start.line ?? -1;
        if (top !== last) {
            last = top;
            stableSince = Date.now();
        } else if (Date.now() - stableSince >= 300) {
            return top;
        }
    }
    return last;
}

async function closeAll(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

describe('侧边译文视图', () => {
    before(activate);
    afterEach(async () => {
        await closeAll();
        await resetSettings();
    });

    it('内容：注释替换为按原语法包装的译文，代码行对齐，语言相同，只读，随原文件刷新，可开关', async () => {
        const editor = await open('OrderService.java');
        const expected = expectedHints('OrderService.java');
        const st = await waitFor(() => state(editor.document), s => s?.hints.length === expected.length, '原文件译文');
        await vscode.commands.executeCommand('codei18n.toggleSideView');
        const view = await waitFor(async () => viewEditor(), e => !!e, '视图打开');
        assert.equal(view!.document.languageId, editor.document.languageId);
        assert.equal(editor.document.languageId, 'java');
        const snap = await waitFor(() => snapshot(editor.document.uri), s => !!s && s.text.includes('[MOCK en->zh-CN] Places a new order'), '视图内容');
        await waitFor(async () => view!.document.getText(), t => t === snap!.text, '编辑器中的视图文本');

        const src = editor.document.getText().split('\n');
        const out = snap!.text.split('\n');
        // 注释之外的代码行一一对齐
        const inComment = (line: number) => st!.hints.some(h => line >= h.start.line && line <= h.end.line);
        for (let line = 0; line < src.length; line++) {
            if (!inComment(line)) assert.equal(out[mapLine(snap!.blocks, line, true)], src[line], `第 ${line + 1} 行`);
        }
        // 有译文的注释不再出现原文；文档注释保留 /** */，行注释组每行带 //
        for (const h of st!.hints) {
            const replaced = out.slice(mapLine(snap!.blocks, h.start.line, true), mapLine(snap!.blocks, h.end.line, true) + 1).join('\n');
            assert.ok(replaced.includes('[MOCK en->zh-CN]'), replaced);
        }
        assert.match(snap!.text, /\/\*\*\n {5}\* \[MOCK en->zh-CN\] Places a new order for the given customer\.\n/);
        const group = st!.hints.find(h => h.parts > 1)!;
        const groupView = out.slice(mapLine(snap!.blocks, group.start.line, true), mapLine(snap!.blocks, group.end.line, true) + 1);
        assert.ok(groupView.length >= 2 && groupView.every(l => l.trim().startsWith('//')), groupView.join('\n'));
        // 字符串里的 // 原样保留
        assert.ok(snap!.text.includes('"https://example.com/orders// not a comment"'));

        // 只读：不能编辑，也不会写到磁盘
        const viewText = view!.document.getText();
        await vscode.window.showTextDocument(view!.document, view!.viewColumn);
        await vscode.commands.executeCommand('type', { text: 'typed by user' });
        await vscode.commands.executeCommand('deleteLeft');
        assert.equal(view!.document.getText(), viewText);
        assert.equal(view!.document.isDirty, false);

        // 原文件修改后视图随之刷新
        await editor.edit(b => b.insert(new vscode.Position(0, 0), '// 新加的一行\n'));
        await waitFor(async () => view!.document.getText(), t => t.startsWith('// 新加的一行\n'), '视图刷新');
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
        await vscode.commands.executeCommand('workbench.action.files.revert');
        await waitFor(async () => view!.document.getText(), t => !t.includes('新加的一行'), '还原后刷新');

        // 再次执行命令关闭视图
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
        await vscode.commands.executeCommand('codei18n.toggleSideView');
        await waitFor(async () => viewEditor(), e => !e, '视图关闭');
        const disk = readFileSync(join(workspaceDir(), 'OrderService.java'));
        assert.ok(disk.equals(readFileSync(join(process.env.CODEI18N_FIXTURES!, 'OrderService.java'))));
    });

    it('源文件的 languageId 与扩展名推断的不同时，视图仍随原文件刷新', async () => {
        const opened = await open('format.js');
        const count = expectedHints('format.js').length;
        const source = await vscode.languages.setTextDocumentLanguage(opened.document, 'plaintext');
        const editor = await vscode.window.showTextDocument(source);
        await waitFor(() => state(source), s => s?.hints.length === count, '原文件译文');
        await vscode.commands.executeCommand('codei18n.toggleSideView');
        const view = await waitFor(async () => viewEditor(), e => !!e && e.document.languageId === 'plaintext', '视图打开且语言相同');
        await waitFor(async () => view!.document.getText(), t => t.includes('[MOCK en->zh-CN]'), '视图内容');
        await editor.edit(b => b.insert(new vscode.Position(0, 0), '// 新加的一行\n'));
        await waitFor(async () => viewEditor()?.document.getText() ?? '', t => t.startsWith('// 新加的一行\n') && t.includes('[MOCK en->zh-CN]'), '视图刷新');
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    it('滚动同步：两边滚动时相同的代码行对齐（注释行数变化时按行映射）', async () => {
        const path = join(workspaceDir(), 'Long.java');
        const base = readFileSync(join(workspaceDir(), 'OrderService.java'), 'utf8');
        const filler = Array.from({ length: 400 }, (_, i) => `int filler${i} = ${i};`).join('\n');
        writeFileSync(path, `${base}\n${filler}\n${base}`);
        try {
            const editor = await open('Long.java');
            // 不在 index.json 中：按全局文本匹配
            await waitFor(() => state(editor.document), s => (s?.hints.length ?? 0) >= 4 && s!.hints.every(h => h.via === 'global'), '全局匹配');
            await vscode.commands.executeCommand('codei18n.toggleSideView');
            const view = await waitFor(async () => viewEditor(), e => !!e, '视图打开');
            const snap = await waitFor(() => snapshot(editor.document.uri), s => !!s && s.blocks.length >= 4, '视图内容');
            assert.ok(mapLine(snap!.blocks, 250, true) > 250, '块注释译文行数不同，映射应有偏移');

            // revealRange(AtTop) 可能停在请求行上方几行：以编辑器实际停下的首行为准
            editor.revealRange(new vscode.Range(250, 0, 250, 0), vscode.TextEditorRevealType.AtTop);
            const sourceTop = await settledTop(editor);
            assert.ok(sourceTop > 200, String(sourceTop));
            const target = mapLine(snap!.blocks, sourceTop, true);
            await waitFor(async () => view!.visibleRanges[0]?.start.line, line => line === target, '视图滚动到对应行');
            assert.equal(view!.document.lineAt(target).text, editor.document.lineAt(sourceTop).text);
            await sleep(800);
            assert.equal(await settledTop(editor), sourceTop, '不应来回同步');

            view!.revealRange(new vscode.Range(120, 0, 120, 0), vscode.TextEditorRevealType.AtTop);
            await sleep(400); // 等过同步窗口，视图停下后的首行
            const viewTop = await settledTop(view!);
            const back = mapLine(snap!.blocks, viewTop, false);
            await waitFor(async () => editor.visibleRanges[0]?.start.line, line => line === back, '原文件滚动到对应行');
        } finally {
            await closeAll();
            rmSync(path, { force: true });
        }
        assert.ok(!existsSync(path));
    });
});
