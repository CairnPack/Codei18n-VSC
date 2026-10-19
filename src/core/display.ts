import { collapse } from './commentText';

/** 行首的注释标记（与 DocMarkup 的 PREFIX 相同）：缩进、`/**`、`/*`、`///`、`//!`、`//`、` * `，以及其后的一个空格。 */
export const PREFIX = /^[ \t]*(?:\/\*\*+(?!\/)|\/\*!?|\/\/[/!]?|\*(?=[ \t]|$))?[ \t]?/;
/** 行尾的块注释结束标记。 */
export const SUFFIX = /[ \t]*\*+\/[ \t]*$/;
/** 行尾孤立的块注释开始标记（例如 "译文 /*"）。 */
export const TRAILING_OPENER = /[ \t]+\/\*+!?[ \t]*$/;

/**
 * 去掉译文的注释语法，得到正文的各行：每行去掉一个开头标记和结尾的 `*\/`，
 * 去掉首尾的空行。行内其余内容（包括缩进）保持原样。
 */
export function commentBody(text: string): string[] {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => {
        let body = line.replace(PREFIX, '');
        if (body.trim() === '*/') return '';
        body = body.replace(SUFFIX, '').replace(TRAILING_OPENER, '');
        return body.replace(/[ \t]+$/, '');
    });
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
}

/**
 * 行尾幽灵文字：单行译文全文显示；多行译文或超过 `maxLength` 个字符时只显示开头并加 "…"。
 */
export function ghostText(translation: string, maxLength: number): string {
    const lines = commentBody(translation).map(collapse).filter(l => l !== '');
    if (lines.length === 0) return '';
    const chars = Array.from(lines[0]);
    const limit = Math.max(1, Math.floor(maxLength));
    if (chars.length > limit) return chars.slice(0, limit).join('').trimEnd() + '…';
    return lines.length > 1 ? lines[0] + ' …' : lines[0];
}
