import { isWhiteSpace } from './commentText';

/** 物理注释：文档文本中的 [start, end) 偏移（UTF-16）。 */
export interface Piece {
    readonly start: number;
    readonly end: number;
}

/** 行注释的标记：开头连续的 `/` 加紧随其后的一个可选 `!`；块注释返回 ""。 */
export function marker(text: string): string {
    if (text.length < 2 || text[0] !== '/' || text[1] !== '/') return '';
    let i = 0;
    while (i < text.length && text[i] === '/') i++;
    if (i < text.length && text[i] === '!') i++;
    return text.substring(0, i);
}

/**
 * 按 core 的规则（docs/index-format.md §6.1）合并相邻物理注释：标记相同、行号连续、起始列相同、
 * 各自独占一行的行注释合并为一组。`pieces` 必须按起始位置排序。
 */
export function group(text: string, pieces: readonly Piece[]): Piece[][] {
    const starts = lineStarts(text);
    const out: Piece[][] = [];
    for (let i = 0; i < pieces.length;) {
        const first = pieces[i];
        const current: Piece[] = [first];
        const mark = marker(text.substring(first.start, first.end));
        if (mark !== '' && ownLine(text, starts, first)) {
            for (let j = i + 1; j < pieces.length; j++) {
                const prev = current[current.length - 1];
                const next = pieces[j];
                if (mark !== marker(text.substring(next.start, next.end))
                    || line(starts, next.start) !== line(starts, prev.end) + 1
                    || column(starts, next.start) !== column(starts, first.start)
                    || !ownLine(text, starts, next)) break;
                current.push(next);
            }
        }
        out.push(current);
        i += current.length;
    }
    return out;
}

/** 每行起始偏移；行分隔符为 `\n`（`\r\n` 中的 `\r` 留在上一行末尾，不影响注释所在列）。 */
export function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
}

/** `offset` 所在的 0 起始行号。行注释末尾（`\n` 之前）的偏移仍属于该行。 */
export function line(starts: readonly number[], offset: number): number {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
}

/** `offset` 的 0 起始列（UTF-16 码元）。 */
export function column(starts: readonly number[], offset: number): number {
    return offset - starts[line(starts, offset)];
}

/** 1 起始行号与 UTF-16 列对应的偏移；超出文本时返回 -1。 */
export function offsetAt(starts: readonly number[], text: string, line1: number, col1: number): number {
    if (line1 < 1 || line1 > starts.length || col1 < 1) return -1;
    const lineEnd = line1 < starts.length ? starts[line1] - 1 : text.length;
    const offset = starts[line1 - 1] + col1 - 1;
    return offset <= lineEnd ? offset : -1;
}

function ownLine(text: string, starts: readonly number[], p: Piece): boolean {
    for (let i = starts[line(starts, p.start)]; i < p.start; i++) {
        if (!isWhiteSpace(text.charCodeAt(i))) return false;
    }
    return true;
}
