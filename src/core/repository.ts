import { MappingIndex } from './mappingIndex';

/** 文件元数据；文件不存在时为 undefined。 */
export interface FileStat {
    readonly mtime: number;
    readonly size: number;
}

/** 仓库用到的最小文件系统接口（扩展里由 vscode.workspace.fs 实现，单测里用内存实现）。路径用 `/` 分隔。 */
export interface DataFileSystem {
    stat(path: string): Promise<FileStat | undefined>;
    read(path: string): Promise<Uint8Array>;
}

export const MAX_JSON_BYTES = 32 * 1024 * 1024;

/** JSON 超过 32 MiB 等无法恢复的错误。 */
export class DataFileError extends Error {}

interface DataFiles {
    readonly mappings: FileStat;
    readonly config: FileStat | undefined;
    readonly index: FileStat | undefined;
}

interface Cached {
    readonly revision: number;
    readonly files: DataFiles;
    readonly language: string;
    readonly index: MappingIndex;
}

export const mappingsPath = (root: string) => `${root}/.codei18n/mappings.json`;
export const configPath = (root: string) => `${root}/.codei18n/config.json`;
export const indexPath = (root: string) => `${root}/.codei18n/index.json`;

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * 按根目录缓存解析后的 MappingIndex（移植自 IDEA 的 MappingRepository）。
 * CLI 原地改写 JSON 时可能读到不完整的内容：短暂重试，文件稳定后仍无效才报错，且绝不继续使用旧快照。
 */
export class MappingRepository {
    private readonly cache = new Map<string, Cached>();
    private readonly revisions = new Map<string, number>();
    private epoch = 0;
    private readonly pending = new Map<string, Promise<MappingIndex | undefined>>();

    constructor(
        private readonly fs: DataFileSystem,
        private readonly retryDelayMs = 250,
        private readonly attempts = 4,
        private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
    ) {}

    /** `root` 的解析结果；没有 mappings.json 时为 undefined。无法解析时抛出异常。同一根目录的并发调用合并为一次。 */
    load(root: string, language: string): Promise<MappingIndex | undefined> {
        const key = `${root}\u0000${language}\u0000${this.revision(root)}`;
        let promise = this.pending.get(key);
        if (!promise) {
            promise = this.loadNow(root, language).finally(() => this.pending.delete(key));
            this.pending.set(key, promise);
        }
        return promise;
    }

    /** 丢弃一个根目录的缓存，例如其 .codei18n 下的文件变化后。 */
    invalidate(root?: string): void {
        if (root === undefined) {
            this.epoch++;
            this.cache.clear();
            return;
        }
        this.revisions.set(root, (this.revisions.get(root) ?? 0) + 1);
        this.cache.delete(root);
    }

    /** 只保留仍有打开文件的根目录。 */
    retain(roots: Iterable<string>): void {
        const keep = new Set(roots);
        for (const root of [...this.cache.keys()]) if (!keep.has(root)) this.cache.delete(root);
    }

    private revision(root: string): number {
        return this.epoch + (this.revisions.get(root) ?? 0);
    }

    private async loadNow(root: string, language: string): Promise<MappingIndex | undefined> {
        for (let attempt = 1; ; attempt++) {
            const revision = this.revision(root);
            const files = await this.fingerprints(root);
            if (!files) {
                this.cache.delete(root);
                return undefined;
            }
            const previous = this.cache.get(root);
            if (previous && previous.revision === revision && previous.language === language && sameFiles(previous.files, files)) {
                return previous.index;
            }
            this.cache.delete(root); // 改写出错后不能继续提供旧快照。
            try {
                const index = await this.parse(root, files, language);
                if (revision === this.revision(root)) this.cache.set(root, { revision, files, language, index });
                return index;
            } catch (e) {
                if (e instanceof DataFileError) throw e;
                // CLI 原地改写：只有文件稳定后仍然无效才报错。
                if (attempt >= this.attempts || await this.settled(root, files)) throw e;
            }
        }
    }

    private async parse(root: string, files: DataFiles, language: string): Promise<MappingIndex> {
        const mappings = await this.text(mappingsPath(root));
        const config = files.config ? await this.text(configPath(root)) : '{}';
        const index = files.index ? await this.text(indexPath(root)) : undefined;
        return MappingIndex.parse(mappings, config, index, language);
    }

    private async text(path: string): Promise<string> {
        const bytes = await this.fs.read(path);
        if (bytes.length > MAX_JSON_BYTES) throw new DataFileError(`CodeI18n JSON exceeds 32 MiB: ${path}`);
        return decoder.decode(bytes);
    }

    private async settled(root: string, before: DataFiles): Promise<boolean> {
        await this.sleep(this.retryDelayMs);
        const after = await this.fingerprints(root);
        return after !== undefined && sameFiles(before, after);
    }

    private async fingerprints(root: string): Promise<DataFiles | undefined> {
        const mappings = await this.fs.stat(mappingsPath(root));
        if (!mappings) return undefined;
        const config = await this.fs.stat(configPath(root));
        const index = await this.fs.stat(indexPath(root));
        for (const [path, stat] of [[mappingsPath(root), mappings], [configPath(root), config], [indexPath(root), index]] as const) {
            if (stat && stat.size > MAX_JSON_BYTES) throw new DataFileError(`CodeI18n JSON exceeds 32 MiB: ${path}`);
        }
        return { mappings, config, index };
    }
}

function sameStat(a: FileStat | undefined, b: FileStat | undefined): boolean {
    return a === b || (a !== undefined && b !== undefined && a.mtime === b.mtime && a.size === b.size);
}

function sameFiles(a: DataFiles, b: DataFiles): boolean {
    return sameStat(a.mappings, b.mappings) && sameStat(a.config, b.config) && sameStat(a.index, b.index);
}
