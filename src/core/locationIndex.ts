/** 解析后的 `.codei18n/index.json`（docs/index-format.md，版本 1），不可变。 */

/** 1 起始行号，1 起始 UTF-16 列，结束位置不含。 */
export interface Range {
    readonly startLine: number;
    readonly startCol: number;
    readonly endLine: number;
    readonly endCol: number;
}

export interface Entry {
    readonly id: string;
    readonly range: Range;
    readonly type: string;
    readonly lang: string;
    readonly langSource: string;
    readonly sourceKey: string;
    readonly textHash: string;
    readonly parts: number;
}

export interface FileEntries {
    readonly contentHash: string;
    readonly language: string;
    readonly comments: readonly Entry[];
}

export class LocationIndex {
    private constructor(private readonly files: ReadonlyMap<string, FileEntries>) {}

    /**
     * 解析 index.json；主版本不认识时返回 null（调用方按没有索引处理）。
     * JSON 语法错误或结构错误时抛出异常。
     */
    static parse(json: string): LocationIndex | null {
        const root: unknown = JSON.parse(stripBom(json));
        if (!isObject(root)) throw new Error('index.json must be a JSON object');
        const version = str(root, 'version', '');
        const dot = version.indexOf('.');
        if ((dot < 0 ? version : version.substring(0, dot)) !== '1') return null;
        const files = new Map<string, FileEntries>();
        const fileElement = root['files'];
        if (isObject(fileElement)) {
            for (const [path, value] of Object.entries(fileElement)) {
                if (!isObject(value)) continue;
                const comments: Entry[] = [];
                const list = value['comments'];
                if (Array.isArray(list)) {
                    for (const item of list) {
                        if (!isObject(item)) continue;
                        const r = isObject(item['range']) ? item['range'] : {};
                        comments.push({
                            id: str(item, 'id', ''),
                            range: { startLine: int(r, 'startLine'), startCol: int(r, 'startCol'), endLine: int(r, 'endLine'), endCol: int(r, 'endCol') },
                            type: str(item, 'type', ''),
                            lang: str(item, 'lang', ''),
                            langSource: str(item, 'langSource', ''),
                            sourceKey: str(item, 'sourceKey', ''),
                            textHash: str(item, 'textHash', ''),
                            parts: Math.max(1, int(item, 'parts')),
                        });
                    }
                }
                files.set(path, { contentHash: str(value, 'contentHash', ''), language: str(value, 'language', ''), comments });
            }
        }
        return new LocationIndex(files);
    }

    /** `relativePath`（相对 .codei18n 所在目录，`/` 分隔）的条目；没有时返回 undefined。 */
    file(relativePath: string): FileEntries | undefined {
        return this.files.get(relativePath);
    }

    get fileCount(): number {
        return this.files.size;
    }
}

export function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.substring(1) : text;
}

export function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(o: Record<string, unknown>, key: string, fallback: string): string {
    const v = o[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return fallback;
}

function int(o: Record<string, unknown>, key: string): number {
    const v = o[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v, 10);
    return 0;
}
