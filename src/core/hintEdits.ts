import { Hint } from './hints';

/** 一次文本替换：修改前文本中 [offset, offset + length) 替换为 `text`。 */
export interface OffsetChange {
    readonly offset: number;
    readonly length: number;
    readonly text: string;
}

/**
 * 编辑后立即调整已显示的译文：被修改的注释（修改区间与注释相交，或在注释末尾输入）撤下自己的译文，
 * 其他译文按偏移平移、保持不动。changes 按 VS Code 给出的顺序依次作用。
 */
export function shiftHints(hints: readonly Hint[], changes: readonly OffsetChange[]): Hint[] {
    let current = hints.slice();
    for (const change of changes) {
        const changeEnd = change.offset + change.length;
        const delta = change.text.length - change.length;
        const next: Hint[] = [];
        for (const h of current) {
            if (change.offset <= h.end && changeEnd > h.start) continue; // 编辑到了这条注释
            next.push(changeEnd <= h.start ? { ...h, start: h.start + delta, end: h.end + delta } : h);
        }
        current = next;
    }
    return current;
}
