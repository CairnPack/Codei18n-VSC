import { describe, expect, it } from 'vitest';
import { replaceSegments } from '../../src/core/replaceDisplay';

describe('替换显示：逐行替换注释', () => {
    it('行数相同：逐行对齐，保留缩进，标记沿用原注释', () => {
        const lines = ['    // a', '    // b'];
        expect(replaceSegments(lines, 4, 8, '// a\n    // b', '// 一\n// 二')).toEqual([
            { line: 0, start: 4, end: 8, label: '// 一' },
            { line: 1, start: 4, end: 8, label: '// 二' },
        ]);
    });

    it('块注释：续行从 * 开始隐藏，译文行沿用 * 前缀', () => {
        const lines = ['  /*', '   * a', '   */'];
        expect(replaceSegments(lines, 2, 5, '/*\n   * a\n   */', '/*\n * 甲\n */').map(s => [s.start, s.end, s.label])).toEqual([
            [2, 4, '/*'], [3, 6, '* 甲'], [3, 5, '*/'],
        ]);
    });

    it('译文行数较少：多出的原注释行隐藏后留空', () => {
        const lines = ['// a', '// b', '// c'];
        expect(replaceSegments(lines, 0, 4, '// a\n// b\n// c', '// 一句话').map(s => s.label)).toEqual(['// 一句话', '', '']);
    });

    it('译文行数较多：超出的行去掉标记后并入最后一行', () => {
        expect(replaceSegments(['// a'], 0, 4, '// a', '// 一\n// 二\n//\n// 三').map(s => s.label)).toEqual(['// 一 二 三']);
        expect(replaceSegments(['/** a */'], 0, 8, '/** a */', '/**\n * 返回总和。\n *\n * @return 总和\n */').map(s => s.label))
            .toEqual(['/** 返回总和。 @return 总和 */']);
        expect(replaceSegments(['/*', ' * a', ' */'], 0, 3, '/*\n * a\n */', '/*\n * 一\n * 二\n * 三\n */').map(s => s.label))
            .toEqual(['/*', '* 一', '* 二 三 */']);
    });

    it('CRLF 文件：原注释含 \r\n 时结果相同', () => {
        expect(replaceSegments(['/*', ' * a', ' */'], 0, 3, '/*\r\n * a\r\n */', '/*\n * 甲\n */').map(s => s.label)).toEqual(['/*', '* 甲', '*/']);
        expect(replaceSegments(['// a', '// b'], 0, 4, '// a\r\n// b', '// 一\r\n// 二').map(s => s.label)).toEqual(['// 一', '// 二']);
    });

    it('与代码同行的注释只隐藏注释部分', () => {
        const line = 'int x = 1; // count';
        expect(replaceSegments([line], 11, line.length, '// count', '// 计数')).toEqual([{ line: 0, start: 11, end: 19, label: '// 计数' }]);
        // 块注释之后还有代码
        const block = 'f(/* a */ 1);';
        expect(replaceSegments([block], 2, 9, '/* a */', '甲')).toEqual([{ line: 0, start: 2, end: 9, label: '/* 甲 */' }]);
    });
});
