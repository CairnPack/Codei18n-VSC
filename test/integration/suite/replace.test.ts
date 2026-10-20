import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { activate, expectedHints, open, resetSettings, SAMPLES, sleep, state, waitFor } from './helpers';

async function useReplace(): Promise<void> {
    await vscode.workspace.getConfiguration('codei18n').update('display', 'replace', vscode.ConfigurationTarget.Global);
}

/** 把光标放到第 `line` 行。 */
function moveTo(editor: vscode.TextEditor, line: number): void {
    const p = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(p, p);
}

describe('替换显示', () => {
    before(activate);
    afterEach(resetSettings);

    for (const name of SAMPLES) {
        it(`${name}：注释逐行换成译文，文档内容不变`, async () => {
            const editor = await open(name);
            // 光标放到最后一行（不是注释），以免露出某条注释的原文
            moveTo(editor, editor.document.lineCount - 1);
            await useReplace();
            const expected = expectedHints(name);
            const st = await waitFor(() => state(editor.document),
                s => s?.hints.length === expected.length && s.display?.mode === 'replace' && s.display.labels.length > 0, `${name} 的替换显示`);
            const display = st!.display!;
            assert.deepEqual(display.ghost, []);
            // 每条注释的每一行都被隐藏，且隐藏的只是注释本身
            for (const h of st!.hints) {
                for (let line = h.start.line; line <= h.end.line; line++) {
                    assert.ok(display.labels.some(l => l.line === line) || display.hidden.some(t => h.comment.includes(t)), `${name} 第 ${line + 1} 行`);
                }
            }
            for (const text of display.hidden) assert.ok(st!.hints.some(h => h.comment.includes(text)), `隐藏了注释以外的文字：${text}`);
            // 译文（去掉 [MOCK …] 前缀之外）出现在标签里
            const labels = display.labels.map(l => l.text).join('\n');
            assert.match(labels, /\[MOCK en->zh-CN\]/);
            // 只改显示，不改文档
            assert.equal(editor.document.isDirty, false);
            assert.equal(editor.document.getText(), readFileSync(editor.document.uri.fsPath, 'utf8'));
        });
    }

    it('光标进入注释时露出原文并改为行尾文字，离开后约 600 ms 换回译文', async () => {
        const editor = await open('OrderService.java');
        moveTo(editor, editor.document.lineCount - 1);
        await useReplace();
        const initial = await waitFor(() => state(editor.document), s => (s?.display?.labels.length ?? 0) > 0, '替换显示');
        const block = initial!.hints.find(h => h.type === 'block')!;
        const covers = (s: typeof initial) => s!.display!.labels.some(l => l.line >= block.start.line && l.line <= block.end.line);
        assert.ok(covers(initial));

        moveTo(editor, block.start.line + 1);
        const revealed = await waitFor(() => state(editor.document, false), s => !covers(s), '露出原文', 2000);
        assert.ok(revealed!.display!.ghost.some(g => g.line === block.end.line), JSON.stringify(revealed!.display!.ghost));
        // 其他注释仍是译文
        assert.ok(revealed!.display!.labels.length > 0);

        moveTo(editor, editor.document.lineCount - 1);
        await sleep(200);
        assert.ok(!covers(await state(editor.document, false)), '离开后立即换回了译文');
        const hiddenAgain = await waitFor(() => state(editor.document, false), s => covers(s), '换回译文', 3000);
        assert.deepEqual(hiddenAgain!.display!.ghost, []);
    });

    it('切换显示模式命令在行尾与替换之间切换', async () => {
        const editor = await open('cart.ts');
        await vscode.commands.executeCommand('codei18n.switchDisplayMode');
        assert.equal(vscode.workspace.getConfiguration('codei18n').get('display'), 'replace');
        await waitFor(() => state(editor.document), s => s?.display?.mode === 'replace', '替换模式');
        await vscode.commands.executeCommand('codei18n.switchDisplayMode');
        assert.equal(vscode.workspace.getConfiguration('codei18n').get('display'), 'ghost');
        const st = await waitFor(() => state(editor.document), s => s?.display?.mode === 'ghost', '行尾模式');
        assert.deepEqual(st!.display!.hidden, []);
        assert.ok(st!.display!.ghost.length > 0);
    });
});
