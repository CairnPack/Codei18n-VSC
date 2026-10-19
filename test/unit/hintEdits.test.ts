import { describe, expect, it } from 'vitest';
import { Hint } from '../../src/core/hints';
import { shiftHints } from '../../src/core/hintEdits';

const hint = (start: number, end: number, text: string): Hint => ({ start, end, text, via: 'location', sourceLanguage: 'en', parts: 1 });

describe('编辑时调整已显示的译文', () => {
    // 文本："// a\ncode\n// b\n"：a 在 [0,4)，b 在 [10,14)
    const hints = [hint(0, 4, 'A'), hint(10, 14, 'B')];

    it('在注释之前插入：后面的译文平移，前面的不动', () => {
        expect(shiftHints(hints, [{ offset: 5, length: 0, text: 'xx' }]).map(h => [h.start, h.end, h.text])).toEqual([[0, 4, 'A'], [12, 16, 'B']]);
    });

    it('在注释开头之前紧挨着插入：不算编辑注释', () => {
        expect(shiftHints(hints, [{ offset: 10, length: 0, text: '  ' }]).map(h => h.start)).toEqual([0, 12]);
    });

    it('编辑注释内部或在注释末尾输入：撤下这条译文', () => {
        expect(shiftHints(hints, [{ offset: 2, length: 1, text: 'z' }]).map(h => h.text)).toEqual(['B']);
        expect(shiftHints(hints, [{ offset: 14, length: 0, text: '!' }]).map(h => h.text)).toEqual(['A']);
    });

    it('删除跨越注释：撤下；多处修改依次作用', () => {
        expect(shiftHints(hints, [{ offset: 3, length: 9, text: '' }])).toEqual([]);
        expect(shiftHints(hints, [{ offset: 12, length: 1, text: '' }, { offset: 0, length: 0, text: '\n' }]).map(h => [h.start, h.text]))
            .toEqual([[1, 'A']]);
    });
});
