import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sha1 } from '../../src/core/commentText';
import { GrammarName, syntaxForFile } from '../../src/core/commentSyntax';
import { records } from '../../src/core/records';
import { Grammars, ParsedDocument } from '../../src/treesitter/extractor';

const ROOT = join(__dirname, '..', '..');
const grammars = new Grammars(join(ROOT, 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
    name => join(ROOT, 'grammars', `tree-sitter-${name}.wasm`));
const FIXTURES = join(ROOT, 'test', 'fixtures', 'languages');
const docs: ParsedDocument[] = [];
afterAll(() => docs.forEach(d => d.dispose()));

async function parse(fileName: string, text: string): Promise<ParsedDocument> {
    const doc = await ParsedDocument.create(grammars, syntaxForFile(fileName)!, text);
    docs.push(doc);
    return doc;
}

describe('§3 一致性测试：tree-sitter 提取 + §6.1 合并 + §6.2 归一化 与 index.json 逐条相同', () => {
    const index = JSON.parse(readFileSync(join(FIXTURES, '.codei18n', 'index.json'), 'utf8'));
    const samples = readdirSync(FIXTURES).filter(n => syntaxForFile(n));

    it('六种语言的样例都在', () => {
        expect(new Set(samples.map(n => syntaxForFile(n)!.grammar)))
            .toEqual(new Set(['kotlin', 'java', 'typescript', 'javascript', 'dart', 'c_sharp']));
    });

    it.each(samples)('%s', async name => {
        const bytes = readFileSync(join(FIXTURES, name));
        const entry = index.files[name];
        expect(entry, `${name} 不在 index.json 中`).toBeDefined();
        // 样例未修改：磁盘字节与索引的 contentHash 一致（.gitattributes 固定为 LF）。
        expect(sha1(bytes)).toBe(entry.contentHash);
        const text = bytes.toString('utf8');
        const doc = await parse(name, text);
        const actual = records(text, doc.pieces(), syntaxForFile(name)!)
            .map(r => ({ range: r.range, parts: r.parts, type: r.type, textHash: r.textHash }));
        const expected = entry.comments.map((c: { range: unknown; parts: number; type: string; textHash: string }) =>
            ({ range: c.range, parts: c.parts, type: c.type, textHash: c.textHash }));
        expect(actual).toEqual(expected);
    });
});

describe('tree-sitter 提取', () => {
    const all: [GrammarName, string, string][] = [
        ['java', 'A.java', 'class A { String s = "// no"; /* 块 */ }\n// 行\n'],
        ['kotlin', 'A.kt', 'val s = "// no" /* 块 */\n// 行\n'],
        ['c_sharp', 'A.cs', 'class A { string s = "// no"; /* 块 */ }\n// 行\n'],
        ['javascript', 'a.jsx', 'const s = "// no"; /* 块 */ const e = <div>{/* jsx */}</div>;\n// 行\n'],
        ['typescript', 'a.mts', 'const s: string = "// no"; /* 块 */\n// 行\n'],
        ['tsx', 'a.tsx', 'const s = "// no"; /* 块 */ const e = <div />;\n// 行\n'],
        ['dart', 'a.dart', 'var s = "// no"; /* 块 /* 嵌套 */ */\n// 行\n'],
    ];

    it.each(all)('%s：字符串里的 // 不是注释，块注释与行注释都能找到', async (grammar, file, text) => {
        expect(syntaxForFile(file)!.grammar).toBe(grammar);
        const doc = await parse(file, text);
        const found = doc.pieces().map(p => text.substring(p.start, p.end));
        expect(found.filter(t => t.includes('// no'))).toEqual([]);
        expect(found).toContain('// 行');
        expect(found.some(t => t.startsWith('/* 块'))).toBe(true);
    });

    it('UTF-16 坐标：非 ASCII 文本后的注释位置正确', async () => {
        const text = 'class 甲 { String s = "你好😀"; // 注释😀尾\n}\n';
        const doc = await parse('B.java', text);
        const [piece] = doc.pieces();
        expect(text.substring(piece.start, piece.end)).toBe('// 注释😀尾');
    });

    it('CRLF：行注释不含行尾的 \\r', async () => {
        const text = '// a\r\n// b\r\nclass C {}\r\n';
        const doc = await parse('C.java', text);
        expect(doc.pieces().map(p => text.substring(p.start, p.end))).toEqual(['// a', '// b']);
    });

    it('增量解析与整篇解析的结果相同', async () => {
        let text = readFileSync(join(FIXTURES, 'Inventory.kt'), 'utf8');
        const doc = await parse('Inventory.kt', text);
        const byOffset = await parse('Inventory.kt', text); // 用 VS Code 的 rangeOffset / rangeLength
        const edits = [
            { line: 0, ch: 0, endLine: 0, endCh: 0, text: '// 新增的第一行 😀\n' },
            { line: 9, ch: 4, endLine: 9, endCh: 7, text: '/** 文档\n     * 第二行' },
            { line: 3, ch: 0, endLine: 5, endCh: 0, text: '' },
            { line: 2, ch: 0, endLine: 2, endCh: 0, text: 'val x = "// 不是注释 😀" // 尾注释\n' },
        ];
        for (const e of edits) {
            const lines = text.split('\n');
            const at = (l: number, c: number) => lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + c;
            const next = text.substring(0, at(e.line, e.ch)) + e.text + text.substring(at(e.endLine, e.endCh));
            const change = { startLine: e.line, startCharacter: e.ch, endLine: e.endLine, endCharacter: e.endCh, text: e.text };
            doc.update(next, [change]);
            byOffset.applyChanges([{ ...change, offset: at(e.line, e.ch), length: at(e.endLine, e.endCh) - at(e.line, e.ch) }]);
            byOffset.update(next);
            text = next;
            const fresh = await parse('Inventory.kt', text);
            expect(doc.pieces()).toEqual(fresh.pieces());
            expect(byOffset.pieces()).toEqual(fresh.pieces());
        }
    });

    it('changes 与新文本对不上时退回整篇解析', async () => {
        const doc = await parse('D.java', '// a\nclass D {}\n');
        const text = '// b\n// c\nclass D {}\n';
        doc.update(text, [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0, text: 'x' }]);
        expect(doc.pieces().map(p => text.substring(p.start, p.end))).toEqual(['// b', '// c']);
    });
});
