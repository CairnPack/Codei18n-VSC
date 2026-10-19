import { marker } from './commentGroups';
import { commentBody } from './display';
import { Hint } from './hints';

/** 一段被替换的注释：原文第 srcStart..srcEnd 行对应译文视图的第 viewStart..viewEnd 行（0 起始，含两端）。 */
export interface LineBlock {
    readonly srcStart: number;
    readonly srcEnd: number;
    readonly viewStart: number;
    readonly viewEnd: number;
}

/** 原文与译文视图之间的行映射：注释之外的代码行一一对应，注释内部按比例对应。 */
export class LineMap {
    constructor(readonly blocks: readonly LineBlock[]) {}

    toView(line: number): number {
        return map(this.blocks, line, b => [b.srcStart, b.srcEnd], b => [b.viewStart, b.viewEnd]);
    }

    toSource(line: number): number {
        return map(this.blocks, line, b => [b.viewStart, b.viewEnd], b => [b.srcStart, b.srcEnd]);
    }
}

function map(blocks: readonly LineBlock[], line: number, from: (b: LineBlock) => number[], to: (b: LineBlock) => number[]): number {
    let delta = 0;
    for (const b of blocks) {
        const [fs, fe] = from(b);
        const [ts, te] = to(b);
        if (line < fs) break;
        if (line <= fe) return ts + Math.min(line - fs, te - ts);
        delta = te - fe;
    }
    return line + delta;
}

export interface TranslatedSource {
    readonly text: string;
    readonly lines: LineMap;
}

/**
 * 侧边译文视图的内容：把有译文的注释替换成译文，按原注释的语法包装
 * （行注释每行加原标记；块注释、文档注释保留 `/* *\/`、`/** *\/` 结构），没有译文的注释保持原样。
 * `hints` 必须按起始位置排序且互不重叠。
 */
export function translateSource(text: string, hints: readonly Hint[]): TranslatedSource {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const blocks: LineBlock[] = [];
    let out = '';
    let pos = 0;
    let srcLine = 0; // pos 所在的原文行
    let viewLine = 0; // out 末尾所在的视图行
    for (const h of hints) {
        if (h.start < pos || h.end > text.length) continue;
        const before = text.substring(pos, h.start);
        const beforeLines = countNewlines(before);
        out += before;
        srcLine += beforeLines;
        viewLine += beforeLines;
        const original = text.substring(h.start, h.end);
        const lineStart = text.lastIndexOf('\n', h.start - 1) + 1;
        const prefix = text.substring(lineStart, h.start);
        const indent = /^\s*$/.test(prefix) ? prefix : (/^[ \t]*/.exec(prefix)?.[0] ?? '');
        const replacement = wrap(original, h.text, indent, eol);
        const srcLines = countNewlines(original);
        const viewLines = countNewlines(replacement);
        blocks.push({ srcStart: srcLine, srcEnd: srcLine + srcLines, viewStart: viewLine, viewEnd: viewLine + viewLines });
        out += replacement;
        srcLine += srcLines;
        viewLine += viewLines;
        pos = h.end;
    }
    out += text.substring(pos);
    return { text: out, lines: new LineMap(blocks) };
}

/** 按原注释的语法包装译文；`indent` 是后续行的缩进。 */
export function wrap(original: string, translation: string, indent: string, eol = '\n'): string {
    const body = commentBody(translation);
    if (body.length === 0) return original;
    const mark = marker(original);
    if (mark !== '') return body.map((l, i) => (i > 0 ? indent : '') + mark + (l === '' ? '' : ' ' + l)).join(eol);
    const opener = /^\/\*[*!]*/.exec(original)?.[0] ?? '/*';
    const isDoc = opener.startsWith('/**') || opener.startsWith('/*!');
    if (body.length === 1 && !original.includes('\n')) return `${opener} ${body[0]} */`;
    const star = isDoc || /\n\s*\*/.test(original);
    const lines = body.map(l => indent + (star ? ' *' + (l === '' ? '' : ' ' + l) : '   ' + l).replace(/\s+$/, ''));
    return [opener, ...lines, indent + ' */'].join(eol);
}

function countNewlines(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    return n;
}
