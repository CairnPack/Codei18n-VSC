import { describe, expect, it } from 'vitest';
import { sha1, textHash } from '../../src/core/commentText';
import { Piece } from '../../src/core/commentGroups';
import { scan } from '../../src/core/hints';
import { MappingIndex } from '../../src/core/mappingIndex';
import { replaceSegments } from '../../src/core/replaceDisplay';

/** 接近 2 MiB 上限、4000 条注释的文件：匹配不能是平方级（曾实测 14–28 s）。 */
describe('大文件匹配的性能', () => {
    const COUNT = 4000;
    const filler = 'x'.repeat(400);
    const lines: string[] = [];
    const comments: Record<string, Record<string, string>> = {};
    const entries: object[] = [];
    for (let i = 0; i < COUNT; i++) {
        const comment = `// comment number ${i}`;
        lines.push(comment, `val v${i} = "${filler}"`);
        comments[`id-${i}`] = { en: comment, 'zh-CN': `// 第 ${i} 条注释` };
        entries.push({ id: `id-${i}`, range: { startLine: 2 * i + 1, startCol: 1, endLine: 2 * i + 1, endCol: comment.length + 1 },
            type: 'line', lang: 'en', sourceKey: 'en', textHash: textHash(comment), parts: 1 });
    }
    const text = lines.join('\n') + '\n';
    const index = MappingIndex.parse(JSON.stringify({ comments }), '{}',
        JSON.stringify({ version: '1', files: { 'Big.kt': { contentHash: sha1(text), language: 'kotlin', comments: entries } } }), '');
    const pieces: Piece[] = [];
    for (let at = text.indexOf('//'); at >= 0; at = text.indexOf('//', at + 1)) {
        pieces.push({ start: at, end: text.indexOf('\n', at) });
        at = text.indexOf('\n', at);
    }

    it.each([['位置', sha1(text)], ['textHash', null]] as const)('%s匹配在 3 秒内完成', (_, contentHash) => {
        expect(text.length).toBeGreaterThan(1_500_000);
        const started = performance.now();
        const hints = scan(index, { relativePath: 'Big.kt', contentHash, text }, pieces);
        const elapsed = performance.now() - started;
        expect(hints.length).toBe(COUNT);
        expect(hints[COUNT - 1].text).toBe(`// 第 ${COUNT - 1} 条注释`);
        expect(elapsed).toBeLessThan(3000);
    });
});

/** 替换显示在每次光标进出注释时都会重新计算所有注释的分段。 */
describe('替换显示分段的性能', () => {
    it('4000 条三行块注释在 500 ms 内完成', () => {
        const lines = ['    /*', '     * comment body that is long enough to matter', '     */'];
        const original = lines.join('\n').trimStart();
        const started = performance.now();
        let count = 0;
        for (let i = 0; i < 4000; i++) count += replaceSegments(lines, 4, 7, original, `/*\n * 第 ${i} 条注释\n */`).length;
        expect(count).toBe(12000);
        expect(performance.now() - started).toBeLessThan(500);
    });
});
