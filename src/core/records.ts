import { normalize, sha1 } from './commentText';
import { column, group, line, lineStarts, Piece } from './commentGroups';
import { commentType, LanguageSyntax } from './commentSyntax';
import { Range } from './locationIndex';

/** 与 core 写入 index.json 的注释记录对应的字段（docs/index-format.md §5）。 */
export interface CommentRecord {
    readonly start: number;
    readonly end: number;
    readonly range: Range;
    readonly type: 'line' | 'block' | 'doc';
    readonly textHash: string;
    readonly parts: number;
}

/**
 * 把物理注释按 §6.1 合并成记录，丢弃归一化后为空的记录（core 不写入索引），
 * 计算 range（1 起始行号、UTF-16 列）、type 与 textHash。
 */
export function records(text: string, pieces: readonly Piece[], syntax: LanguageSyntax): CommentRecord[] {
    const starts = lineStarts(text);
    const out: CommentRecord[] = [];
    for (const g of group(text, pieces)) {
        const joined = g.map(p => text.substring(p.start, p.end)).join('\n');
        const normalized = normalize(joined);
        if (normalized === '') continue;
        const start = g[0].start;
        const end = g[g.length - 1].end;
        out.push({
            start, end,
            range: { startLine: line(starts, start) + 1, startCol: column(starts, start) + 1, endLine: line(starts, end) + 1, endCol: column(starts, end) + 1 },
            type: commentType(text.substring(g[0].start, g[0].end), syntax),
            textHash: sha1(normalized),
            parts: g.length,
        });
    }
    return out;
}
