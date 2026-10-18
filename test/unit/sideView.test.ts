import { describe, expect, it } from 'vitest';
import { Hint } from '../../src/core/hints';
import { LineMap, translateSource, wrap } from '../../src/core/sideView';

function hintFor(text: string, comment: string, translation: string): Hint {
    const start = text.indexOf(comment);
    if (start < 0) throw new Error(comment);
    return { start, end: start + comment.length, text: translation, via: 'location', sourceLanguage: 'en', parts: 1 };
}

describe('侧边译文视图：按原注释语法包装', () => {
    it('行注释每行加原标记，后续行保持缩进', () => {
        expect(wrap('// a\n    // b', '// 第一行\n// 第二行', '    ')).toBe('// 第一行\n    // 第二行');
        expect(wrap('/// doc', '/// 文档\n///\n/// 第二段', '  ')).toBe('/// 文档\n  ///\n  /// 第二段');
        expect(wrap('// x', '[MOCK] // 原样', '')).toBe('// [MOCK] // 原样');
    });

    it('块注释与文档注释保留 /* */、/** */ 结构', () => {
        expect(wrap('/* a */', '你好', '')).toBe('/* 你好 */');
        expect(wrap('/**\n   * a\n   */', '/**\n * 返回总和。\n *\n * @return 总和\n */', '  '))
            .toBe('/**\n   * 返回总和。\n   *\n   * @return 总和\n   */');
        expect(wrap('/*\n * a\n */', '[MOCK en->zh-CN] /*\n * 第一行\n * 第二行\n */', ''))
            .toBe('/*\n * [MOCK en->zh-CN]\n * 第一行\n * 第二行\n */');
    });

    it('空译文保持原样；CRLF 文件用 CRLF', () => {
        expect(wrap('// a', '//', '')).toBe('// a');
        expect(wrap('// a\r\n// b', '// 一\n// 二', '', '\r\n')).toBe('// 一\r\n// 二');
    });
});

describe('侧边译文视图：内容与行映射', () => {
    const SOURCE = [
        'class A {',            // 0
        '    /*',               // 1
        '     * Block.',        // 2
        '     */',              // 3
        '    void a() {}',      // 4
        '    // one',           // 5
        '    // two',           // 6
        '    void b() {} // tail', // 7
        '    /* untranslated */', // 8
        '}',                    // 9
        '',
    ].join('\n');

    const hints = [
        hintFor(SOURCE, '/*\n     * Block.\n     */', '/*\n * 第一行\n * 第二行\n * 第三行\n */'),
        hintFor(SOURCE, '// one\n    // two', '// 合并的译文'),
        hintFor(SOURCE, '// tail', '// 尾注释'),
    ];

    it('替换有译文的注释，代码行与没有译文的注释保持原样', () => {
        const { text } = translateSource(SOURCE, hints);
        expect(text.split('\n')).toEqual([
            'class A {',
            '    /*',
            '     * 第一行',
            '     * 第二行',
            '     * 第三行',
            '     */',
            '    void a() {}',
            '    // 合并的译文',
            '    void b() {} // 尾注释',
            '    /* untranslated */',
            '}',
            '',
        ]);
    });

    it('代码行双向一一对应，注释内部按比例对应', () => {
        const { text, lines } = translateSource(SOURCE, hints);
        const src = SOURCE.split('\n');
        const view = text.split('\n');
        for (const line of [0, 4, 7, 8, 9]) {
            expect(view[lines.toView(line)]).toBe(src[line].replace('// tail', '// 尾注释'));
            expect(lines.toSource(lines.toView(line))).toBe(line);
        }
        expect([1, 2, 3].map(l => lines.toView(l))).toEqual([1, 2, 3]);
        expect([1, 2, 3, 4, 5].map(l => lines.toSource(l))).toEqual([1, 2, 3, 3, 3]);
        expect([5, 6].map(l => lines.toView(l))).toEqual([7, 7]);
        expect(lines.toSource(7)).toBe(5);
    });

    it('没有译文时内容不变、映射为恒等', () => {
        const { text, lines } = translateSource(SOURCE, []);
        expect(text).toBe(SOURCE);
        expect(new LineMap([]).toView(5)).toBe(5);
        expect(lines.toSource(9)).toBe(9);
    });
});
