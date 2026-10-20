import { PREFIX } from './display';
import { wrap } from './sideView';

/** 替换显示中的一段：隐藏第 `line` 行（相对注释起始行）的 [start, end) 列，并在 start 处显示 `label`。 */
export interface Segment {
    readonly line: number;
    readonly start: number;
    readonly end: number;
    readonly label: string;
}

/**
 * 替换显示：把注释逐行换成按原注释语法包装的译文（见 sideView 的 `wrap`）。VS Code 不能增删显示的行，
 * 所以每行只隐藏注释部分（保留缩进和注释前后的代码），再在原位显示一行译文：
 * 译文行数不多于原注释时从上往下对齐，多出的原注释行留空；多于原注释时，超出的行并入最后一行。
 *
 * `lines` 是注释所在的各行（不含换行符），`startChar` 是注释在第一行的起始列，`endChar` 是在最后一行的结束列。
 */
export function replaceSegments(lines: readonly string[], startChar: number, endChar: number, original: string, translation: string): Segment[] {
    const wrapped = wrap(original, translation, '').split('\n').map(l => l.trim());
    const n = lines.length;
    if (n === 0) return [];
    const labels = wrapped.slice(0, n);
    if (wrapped.length > n) {
        const rest = wrapped.slice(n).map(l => l.replace(PREFIX, '').trim()).filter(l => l !== '');
        labels[n - 1] = [wrapped[n - 1], ...rest].filter(l => l !== '').join(' ');
    }
    return lines.map((text, i) => {
        const start = i === 0 ? startChar : firstNonWhitespace(text);
        const end = i === n - 1 ? endChar : text.length;
        return { line: i, start, end: Math.max(start, end), label: labels[i] ?? '' };
    });
}

function firstNonWhitespace(text: string): number {
    const m = /\S/.exec(text);
    return m ? m.index : text.length;
}
