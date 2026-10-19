import { legacy, textHash } from './commentText';
import { column, line, lineStarts, offsetAt } from './commentGroups';
import { Entry, FileEntries, isObject, LocationIndex, stripBom } from './locationIndex';
import { equivalent, findKey } from './languageCodes';

/** 正在匹配的文件：相对根目录的路径（`/` 分隔）、磁盘原始字节的 SHA-1（文档有未保存修改等情况为 null）、文档文本。 */
export interface FileContext {
    readonly relativePath: string;
    readonly contentHash: string | null;
    readonly text: string;
}

/** 命中方式：按位置、按 textHash、全局文本匹配。 */
export type MatchVia = 'location' | 'textHash' | 'global';

/**
 * 一组注释的匹配结果。`found` 表示找到了对应的映射条目；`text` 是要显示的译文，
 * 原文已经是显示语言等情况下为 undefined。
 */
export interface Match {
    readonly found: boolean;
    readonly text?: string;
    readonly via?: MatchVia;
    /** 原文所在的语言（规范码或 mappings 中的键），仅供诊断显示。 */
    readonly sourceLanguage?: string;
    /** index.json 中的注释类型（line/block/doc），全局匹配时没有。 */
    readonly type?: string;
}

/** 仅按 index.json 的范围定位到的译文，文档区间 [start, end)。 */
export interface Located {
    readonly start: number;
    readonly end: number;
    readonly text: string;
    readonly type: string;
    readonly sourceLanguage: string;
}

const NONE: Match = { found: false };

interface GlobalEntry {
    readonly text: string;
    readonly sourceKey: string;
}

/**
 * 一个 CodeI18n 根目录的不可变视图：mappings.json（ID → 语言 → 文本）、config.json，以及可选的 index.json。
 * 匹配优先级见 docs/index-format.md §9，行为与 IDEA 插件的 MappingIndex 一致：
 * 1. 有 index.json 且文件未修改：按起始位置与 parts 命中条目；
 * 2. 有 index.json 但文件已修改：在该文件的条目里按 textHash 与 parts 匹配；
 * 3. 保守的全局文本匹配（同一原文有不同译文时不显示）。
 */
export class MappingIndex {
    private constructor(
        readonly language: string,
        private readonly comments: ReadonlyMap<string, ReadonlyMap<string, string>>,
        private readonly global: ReadonlyMap<string, GlobalEntry>,
        private readonly locations: LocationIndex | null,
        /** index.json 存在但无法解析时的错误信息（此时只用 mappings.json）。 */
        readonly indexError?: string,
    ) {}

    /**
     * `index` 为 undefined 表示没有 index.json。主版本不认识或无法解析的 index.json 被忽略，只用 mappings.json
     * （docs/index-format.md §9.1）；无法解析的原因记在 indexError。mappings.json / config.json 无效时抛出异常。
     */
    static parse(mappings: string, config: string, index: string | undefined, languageOverride: string): MappingIndex {
        const data = object(JSON.parse(stripBom(mappings)), 'mappings');
        const settings = object(JSON.parse(stripBom(config)), 'config');
        const target = languageOverride.trim() === ''
            ? value(settings, 'localLanguage', value(data, 'targetLanguage', 'zh-CN'))
            : languageOverride.trim();
        const comments = new Map<string, Map<string, string>>();
        const element = data['comments'];
        if (element !== undefined && element !== null) {
            for (const [id, entry] of Object.entries(object(element, 'comments'))) {
                const languages = object(entry, `comment ${id}`);
                const texts = new Map<string, string>();
                for (const lang of Object.keys(languages)) texts.set(lang, value(languages, lang, ''));
                comments.set(id, texts);
            }
        }
        let locations: LocationIndex | null = null;
        let indexError: string | undefined;
        try {
            locations = index === undefined ? null : LocationIndex.parse(index);
        } catch (e) {
            indexError = e instanceof Error ? e.message : String(e);
        }
        return new MappingIndex(target, comments, globalIndex(comments, target), locations, indexError);
    }

    get hasLocations(): boolean {
        return this.locations !== null;
    }

    /** 映射条目数，供状态栏等诊断使用。 */
    get size(): number {
        return this.comments.size;
    }

    /** index.json 中 `relativePath` 的条目。 */
    fileEntries(relativePath: string): FileEntries | undefined {
        return this.locations?.file(relativePath);
    }

    /** 只做全局文本匹配（旧行为）。 */
    translation(comment: string): string | undefined {
        return this.global.get(legacy(comment))?.text;
    }

    /**
     * 匹配 `file.text` 中 [start, end) 处、由 `parts` 条物理注释组成的注释组。
     * `rank` 是该组在文件中 textHash 与 parts 都相同的组里的序号（0 起始），`total` 是这些组的数量（未知时为 -1）。
     * 文件已修改且索引中同 hash 的条目数量正好相同时按顺序配对，行号整体平移也不会错位。
     */
    match(file: FileContext, start: number, end: number, parts: number, rank = -1, total = -1): Match {
        const entries = this.locations?.file(file.relativePath);
        if (entries) {
            let entry: Entry | undefined;
            let via: MatchVia = 'location';
            if (file.contentHash !== null && file.contentHash === entries.contentHash) {
                const starts = startsOf(file.text);
                entry = lookup(entries).byPosition.get(`${line(starts, start) + 1}:${column(starts, start) + 1}:${parts}`);
            }
            if (!entry) {
                entry = byTextHash(entries, file.text, start, end, parts, rank, total);
                via = 'textHash';
            }
            if (entry) {
                return { found: true, text: this.translationFor(entry), via, sourceLanguage: sourceLanguage(entry), type: entry.type };
            }
        }
        const global = this.global.get(legacy(file.text.substring(start, end)));
        return global ? { found: true, text: global.text, via: 'global', sourceLanguage: global.sourceKey } : NONE;
    }

    /** 条目在显示语言下的译文；原文已经是显示语言、缺少译文或译文与原文相同时返回 undefined。 */
    translationFor(entry: Entry): string | undefined {
        const texts = this.comments.get(entry.id);
        if (!texts) return undefined;
        // 原文已经是显示语言：绝不把注释"翻译"成它自己。
        if (equivalent(entry.lang, this.language) || equivalent(entry.sourceKey, this.language)) return undefined;
        const key = findKey(texts, this.language);
        const text = key === undefined ? undefined : texts.get(key);
        if (text === undefined || text.trim() === '') return undefined;
        const original = texts.get(entry.sourceKey);
        if (original !== undefined && legacy(original) === legacy(text)) return undefined;
        return text;
    }

    /**
     * 只按 index.json 的范围定位译文，用于没有 tree-sitter 语法的文件（Go、Rust 等）：
     * 只在文件未修改（contentHash 一致）时使用，并且范围内的文本仍须有相同的 textHash。
     */
    located(file: FileContext): Located[] {
        const entries = this.locations?.file(file.relativePath);
        if (!entries || file.contentHash === null || file.contentHash !== entries.contentHash) return [];
        const text = file.text;
        const starts = lineStarts(text);
        const out: Located[] = [];
        for (const e of entries.comments) {
            const start = offsetAt(starts, text, e.range.startLine, e.range.startCol);
            const end = offsetAt(starts, text, e.range.endLine, e.range.endCol);
            if (start < 0 || end <= start) continue;
            if (textHash(text.substring(start, end)) !== e.textHash) continue; // 宁缺毋滥
            const translated = this.translationFor(e);
            if (translated !== undefined) out.push({ start, end, text: translated, type: e.type, sourceLanguage: sourceLanguage(e) });
        }
        return out;
    }
}

/**
 * 全局回退的反查表。显示语言以外的任何语言都可能是原文（用本地语言写的注释存在本地语言键下，C1.2）；
 * 重复原文的译文不一致（包括其中一条缺少译文）时视为有歧义，不显示。
 */
function globalIndex(comments: ReadonlyMap<string, ReadonlyMap<string, string>>, target: string): Map<string, GlobalEntry> {
    const values = new Map<string, GlobalEntry>();
    const ambiguous = new Set<string>();
    for (const texts of comments.values()) {
        const key0 = findKey(texts, target);
        const translated = key0 === undefined ? '' : texts.get(key0) ?? '';
        for (const [lang, original] of texts) {
            if (original.trim() === '' || equivalent(lang, target)) continue;
            const key = legacy(original);
            const previous = values.get(key);
            if (previous === undefined) values.set(key, { text: translated, sourceKey: lang });
            else if (previous.text !== translated) ambiguous.add(key);
        }
    }
    for (const key of ambiguous) values.delete(key);
    for (const [key, entry] of values) {
        if (key.trim() === '' || entry.text.trim() === '' || legacy(entry.text) === key) values.delete(key);
    }
    return values;
}

/** 文件内 textHash 与 parts 相同的条目：数量一致时按顺序配对，否则取行号最近的一条，距离相同则不匹配。 */
function byTextHash(entries: FileEntries, text: string, start: number, end: number, parts: number,
    rank: number, total: number): Entry | undefined {
    const hash = textHash(text.substring(start, end));
    const same = lookup(entries).byHash.get(`${hash}:${parts}`) ?? [];
    if (rank >= 0 && same.length === total && rank < same.length) return same[rank];
    const ln = line(startsOf(text), start) + 1;
    let best: Entry | undefined;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    let tie = false;
    for (const e of same) {
        const distance = Math.abs(e.range.startLine - ln);
        if (distance < bestDistance) {
            best = e;
            bestDistance = distance;
            tie = false;
        } else if (distance === bestDistance) {
            tie = true;
        }
    }
    return tie ? undefined : best;
}

interface Lookup {
    /** `startLine:startCol:parts` → 条目（第一个）。 */
    readonly byPosition: Map<string, Entry>;
    /** `textHash:parts` → 按起始位置排序的条目。 */
    readonly byHash: Map<string, Entry[]>;
}

const lookups = new WeakMap<FileEntries, Lookup>();

/** 文件条目的查找表，每个文件只建一次（大文件逐组匹配时避免平方级开销）。 */
function lookup(entries: FileEntries): Lookup {
    let result = lookups.get(entries);
    if (!result) {
        result = { byPosition: new Map(), byHash: new Map() };
        for (const e of entries.comments) {
            const position = `${e.range.startLine}:${e.range.startCol}:${e.parts}`;
            if (!result.byPosition.has(position)) result.byPosition.set(position, e);
            const key = `${e.textHash}:${e.parts}`;
            const list = result.byHash.get(key);
            if (list) list.push(e); else result.byHash.set(key, [e]);
        }
        for (const list of result.byHash.values()) {
            list.sort((a, b) => a.range.startLine - b.range.startLine || a.range.startCol - b.range.startCol);
        }
        lookups.set(entries, result);
    }
    return result;
}

let cachedText: string | undefined;
let cachedStarts: number[] = [];

/** 同一文本的行起始偏移只算一次（scan 对每组注释都要用）。 */
function startsOf(text: string): number[] {
    if (text !== cachedText) {
        cachedText = text;
        cachedStarts = lineStarts(text);
    }
    return cachedStarts;
}

function sourceLanguage(entry: Entry): string {
    return entry.lang !== '' && entry.lang !== 'unknown' ? entry.lang : entry.sourceKey;
}

function object(element: unknown, label: string): Record<string, unknown> {
    if (!isObject(element)) throw new Error(`${label} must be a JSON object`);
    return element;
}

/** IDEA 的 value()：null/缺失/空白返回默认值，非字符串报错。 */
function value(o: Record<string, unknown>, key: string, fallback: string): string {
    const v = o[key];
    if (v === undefined || v === null) return fallback;
    if (typeof v !== 'string') throw new Error(`${key} must be a string`);
    return v.trim() === '' ? fallback : v;
}
