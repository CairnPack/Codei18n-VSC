import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { activate, expectedHints, open, readJson, resetSettings, SAMPLES, state, waitFor, workspaceDir } from './helpers';

describe('幽灵文字、悬停与匹配（六种语言）', () => {
    before(activate);
    afterEach(resetSettings);

    for (const name of SAMPLES) {
        it(`${name}：块注释、行注释组、文档注释的精确译文，字符串里的 // 没有译文`, async () => {
            const editor = await open(name);
            const expected = expectedHints(name);
            const st = await waitFor(() => state(editor.document), s => s?.hints.length === expected.length, `${name} 的译文`);
            assert.deepEqual(
                st!.hints.map(h => ({ line: h.start.line, character: h.start.character, anchorLine: h.anchorLine, text: h.text, type: h.type, parts: h.parts })),
                expected.map(e => ({ line: e.line, character: e.character, anchorLine: e.anchorLine, text: e.text, type: e.type, parts: e.parts })));
            // 未修改的文件按位置命中
            assert.ok(st!.hints.every(h => h.via === 'location'), JSON.stringify(st!.hints.map(h => h.via)));
            assert.ok(st!.hints.some(h => h.type === 'block'), '缺少块注释');
            assert.ok(st!.hints.some(h => h.type === 'doc'), '缺少文档注释');
            const group = st!.hints.find(h => h.type === 'line' && h.parts > 1);
            assert.ok(group, '缺少行注释组');
            // 整组只有一条译文，挂在组的最后一行；多行译文的幽灵文字只显示开头
            assert.equal(group.anchorLine, group.end.line);
            assert.ok(group.anchorLine > group.start.line);
            assert.ok(group.ghost.endsWith('…'), group.ghost);
            assert.equal(st!.hints.filter(h => h.start.line <= group.end.line && h.end.line >= group.start.line).length, 1);
            // 字符串里的 // 不是注释
            const stringLine = editor.document.getText().split('\n').findIndex(l => l.includes('// not a comment'));
            assert.ok(stringLine >= 0);
            assert.ok(!st!.hints.some(h => h.start.line <= stringLine && h.anchorLine >= stringLine), '字符串里的 // 有了译文');
            // 悬停：完整译文 + 原语言与命中方式
            for (const h of st!.hints) {
                assert.match(h.hover, /Source: en · Matched by: position \(index\.json\)|原语言: en · 命中方式: 位置/);
            }
            assert.equal(st!.language, 'zh-CN');
        });
    }

    it('C# XML 文档注释：悬停去掉标签，按段落显示，标签名按显示语言本地化', async () => {
        const editor = await open('Ledger.cs');
        const st = await waitFor(() => state(editor.document), s => (s?.hints.length ?? 0) > 0, 'Ledger.cs');
        const doc = st!.hints.find(h => h.type === 'doc')!;
        // 正文中的标点按 Markdown 转义
        assert.ok(doc.hover.includes('**参数** `amount`**:** The amount to book\\.'), doc.hover);
        assert.ok(doc.hover.includes('**返回:** The new balance\\.'), doc.hover);
        assert.ok(!doc.hover.includes('summary'), doc.hover);
    });

    it('Javadoc / KDoc / JSDoc 的悬停渲染', async () => {
        const kt = await open('Inventory.kt');
        const ktDoc = (await waitFor(() => state(kt.document), s => (s?.hints.length ?? 0) > 0, 'kt'))!.hints.find(h => h.type === 'doc')!;
        assert.ok(ktDoc.hover.includes('`quantity`') && ktDoc.hover.includes('`sku`'), ktDoc.hover);
        assert.ok(ktDoc.hover.includes('**@param** `sku`'), ktDoc.hover);
        const js = await open('format.js');
        const jsDoc = (await waitFor(() => state(js.document), s => (s?.hints.length ?? 0) > 0, 'js'))!.hints.find(h => h.type === 'doc')!;
        assert.ok(jsDoc.hover.includes('**@param** `{number}` `cents`'), jsDoc.hover);
    });

    it('设置项：显示语言、幽灵文字、开关命令', async () => {
        const editor = await open('OrderService.java');
        const count = expectedHints('OrderService.java').length;
        await waitFor(() => state(editor.document), s => s?.hints.length === count, '初始译文');
        const config = vscode.workspace.getConfiguration('codei18n');
        // 显示语言 en：原文已是英文，不显示
        await config.update('language', 'en', vscode.ConfigurationTarget.Global);
        await waitFor(() => state(editor.document), s => s?.language === 'en' && s.hints.length === 0, '显示语言 en');
        await config.update('language', undefined, vscode.ConfigurationTarget.Global);
        await waitFor(() => state(editor.document), s => s?.hints.length === count, '恢复显示语言');
        // 关闭幽灵文字：仍有提示（悬停用），但不渲染幽灵文字
        await config.update('ghostText.enabled', false, vscode.ConfigurationTarget.Global);
        await waitFor(() => state(editor.document), s => s?.hints.length === count && s.hints.every(h => h.ghost === ''), '关闭幽灵文字');
        await config.update('ghostText.maxLength', 12, vscode.ConfigurationTarget.Global);
        await config.update('ghostText.enabled', undefined, vscode.ConfigurationTarget.Global);
        await waitFor(() => state(editor.document), s => !!s && s.hints.every(h => [...h.ghost].length <= 13 && h.ghost.endsWith('…')), '最大长度');
        // 开关命令（Ctrl+Alt+Shift+O）
        await vscode.commands.executeCommand('codei18n.toggle');
        assert.equal(vscode.workspace.getConfiguration('codei18n').get('enabled'), false);
        await waitFor(() => state(editor.document), s => s?.hints.length === 0, '关闭译文');
        await vscode.commands.executeCommand('codei18n.toggle');
        await waitFor(() => state(editor.document), s => s?.hints.length === count, '重新打开译文');
        // 开关写的是用户设置，不在项目里新建 .vscode/settings.json
        assert.ok(!existsSync(join(workspaceDir(), '.vscode')));
    });

    it('修改未保存的文档后，译文仍跟着注释走；编辑某条注释立即撤下它自己的译文', async () => {
        const editor = await open('Inventory.kt');
        const before = (await waitFor(() => state(editor.document), s => s?.hints.length === expectedHints('Inventory.kt').length, '初始'))!;
        await editor.edit(b => b.insert(new vscode.Position(0, 0), '// 新插入的一行\n\n'));
        // 立即：所有译文平移两行，没有丢失
        const now = (await state(editor.document, false))!;
        assert.deepEqual(now.hints.map(h => h.start.line), before.hints.map(h => h.start.line + 2));
        const after = await waitFor(() => state(editor.document), s => !!s && s.version === editor.document.version
            && s.hints.length === before.hints.length && s.hints.every(h => h.via === 'textHash'), '插入后重新匹配');
        assert.deepEqual(after!.hints.map(h => [h.start.line, h.text]), before.hints.map(h => [h.start.line + 2, h.text]));

        // 编辑行注释组的第一行：立即撤下这条译文，其他不动
        const group = after!.hints.find(h => h.parts > 1)!;
        await editor.edit(b => b.insert(new vscode.Position(group.start.line, group.start.character + 3), 'X'));
        const edited = (await state(editor.document, false))!;
        assert.equal(edited.hints.length, before.hints.length - 1);
        assert.ok(!edited.hints.some(h => h.text === group.text));
        const settled = await waitFor(() => state(editor.document), s => s?.version === editor.document.version, '编辑后');
        assert.deepEqual(settled!.hints.map(h => h.text), edited.hints.map(h => h.text));

        await vscode.commands.executeCommand('workbench.action.files.revert');
        await waitFor(() => state(editor.document), s => s?.hints.length === before.hints.length && s.hints.every(h => h.via === 'location'), '还原后');
    });

    it('外部改写 mappings.json 后自动刷新；改写中的无效 JSON 撤下译文，恢复后重新显示', async () => {
        const editor = await open('Inventory.kt');
        const count = expectedHints('Inventory.kt').length;
        await waitFor(() => state(editor.document), s => s?.hints.length === count, '初始');
        const path = join(workspaceDir(), '.codei18n', 'mappings.json');
        const original = readFileSync(path, 'utf8');
        const index = readJson('.codei18n', 'index.json');
        const block = index.files['Inventory.kt'].comments.find((c: { type: string }) => c.type === 'block');
        const mappings = JSON.parse(original);
        // 连原文一起改掉：仍能显示，证明是经 index.json 按位置匹配的
        mappings.comments[block.id] = { en: '/* changed original */', 'zh-CN': '外部改写的译文' };
        writeFileSync(path, JSON.stringify(mappings, null, 2));
        await waitFor(() => state(editor.document), s => !!s?.hints.some(h => h.text === '外部改写的译文'), '外部改写后刷新');

        writeFileSync(path, '{"comments":{"broken');
        const broken = await waitFor(() => state(editor.document), s => !!s?.error && s.hints.length === 0, '无效 JSON', 30_000);
        assert.match(broken!.error!, /JSON|Unexpected|Unterminated/i);
        writeFileSync(path, original);
        await waitFor(() => state(editor.document), s => !s?.error && s?.hints.length === count, '恢复后', 30_000);
    });

    it('改变文档的 languageId（VS Code 会先关闭再重新打开文档）后译文恢复，编辑后继续刷新', async () => {
        const editor = await open('cart.ts');
        const count = expectedHints('cart.ts').length;
        await waitFor(() => state(editor.document), s => s?.hints.length === count, '初始');
        const document = await vscode.languages.setTextDocumentLanguage(editor.document, 'plaintext');
        assert.equal(document.languageId, 'plaintext');
        await waitFor(() => state(document), s => s?.hints.length === count, 'languageId 改变后');
        const shown = await vscode.window.showTextDocument(document);
        await shown.edit(b => b.insert(new vscode.Position(0, 0), '\n'));
        await waitFor(() => state(document), s => s?.version === document.version && s.hints.length === count
            && s.hints.every(h => h.via === 'textHash'), '编辑后刷新');
        await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    it('index.json 无法解析时忽略它，只用 mappings.json，并提示一次', async () => {
        const editor = await open('OrderService.java');
        const count = expectedHints('OrderService.java').length;
        await waitFor(() => state(editor.document), s => s?.hints.length === count, '初始');
        const path = join(workspaceDir(), '.codei18n', 'index.json');
        const original = readFileSync(path, 'utf8');
        try {
            writeFileSync(path, '{"version":"1","files":');
            const degraded = await waitFor(() => state(editor.document), s => !!s && !s.error && s.hints.length > 0
                && s.hints.every(h => h.via === 'global'), '只用 mappings.json', 30_000);
            assert.ok(degraded!.hints.length > 0);
        } finally {
            writeFileSync(path, original);
        }
        await waitFor(() => state(editor.document), s => s?.hints.length === count && s.hints.every(h => h.via === 'location'), '恢复', 30_000);
    });

    it('不写入源码：样例文件与夹具逐字节相同', () => {
        for (const name of SAMPLES) {
            const fixture = readFileSync(join(process.env.CODEI18N_FIXTURES!, name));
            assert.ok(readFileSync(join(workspaceDir(), name)).equals(fixture), name);
        }
    });
});
