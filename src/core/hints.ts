import { textHash } from './commentText';
import { group, Piece } from './commentGroups';
import { FileContext, MappingIndex, MatchVia } from './mappingIndex';

/** 一条要显示的译文：注释（组）占据文档区间 [start, end)。 */
export interface Hint {
    readonly start: number;
    readonly end: number;
    readonly text: string;
    readonly via: MatchVia;
    readonly sourceLanguage: string;
    /** 物理注释条数。 */
    readonly parts: number;
    /** index.json 中的类型（line/block/doc）；全局匹配时为 undefined。 */
    readonly type?: string;
}

/**
 * 计算文件中所有注释的译文（移植自 IDEA 的 TranslationHint.scan）。
 *
 * - `pieces` 是 tree-sitter 找到的物理注释（按起始位置排序）。相邻行注释按 §6.1 分组后作为一条记录匹配；
 *   整组匹配不上时退回逐条匹配（兼容旧版 core 写出的按行映射）。
 * - `pieces` 为 null 表示该文件没有可用的语法（Go、Rust 等），只在文件未修改时按 index.json 的范围定位。
 */
export function scan(index: MappingIndex, context: FileContext, pieces: readonly Piece[] | null): Hint[] {
    if (pieces === null) {
        return index.located(context).map(l => ({
            start: l.start, end: l.end, text: l.text, via: 'location' as const,
            sourceLanguage: l.sourceLanguage, parts: 1, type: l.type,
        }));
    }
    const text = context.text;
    const groups = group(text, pieces);
    // 每组在 textHash 与 parts 都相同的组里的出现序号（按顺序配对相同的注释）。
    const keys = groups.map(g => `${g.length}:${textHash(text.substring(g[0].start, g[g.length - 1].end))}`);
    const totals = new Map<string, number>();
    for (const key of keys) totals.set(key, (totals.get(key) ?? 0) + 1);
    const seen = new Map<string, number>();
    const hints: Hint[] = [];
    groups.forEach((g, i) => {
        const key = keys[i];
        const rank = seen.get(key) ?? 0;
        seen.set(key, rank + 1);
        const start = g[0].start;
        const end = g[g.length - 1].end;
        const match = index.match(context, start, end, g.length, rank, totals.get(key) ?? -1);
        if (match.found) {
            if (match.text !== undefined) {
                hints.push({ start, end, text: match.text, via: match.via!, sourceLanguage: match.sourceLanguage ?? '', parts: g.length, type: match.type });
            }
            return;
        }
        if (g.length > 1) {
            for (const piece of g) {
                const single = index.match(context, piece.start, piece.end, 1);
                if (single.text !== undefined) {
                    hints.push({
                        start: piece.start, end: piece.end, text: single.text, via: single.via!,
                        sourceLanguage: single.sourceLanguage ?? '', parts: 1, type: single.type,
                    });
                }
            }
        }
    });
    return hints;
}
