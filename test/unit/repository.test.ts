import { describe, expect, it } from 'vitest';
import { DataFileError, DataFileSystem, FileStat, MappingRepository, MAX_JSON_BYTES } from '../../src/core/repository';

/** 移植自 IDEA 插件 MappingIndexTest 中 MappingRepository 的部分。 */

const MAPPINGS = `
{"version":"1.0","sourceLanguage":"en","targetLanguage":"zh-CN","comments":{
  "id-a":{"en":"// Calculate account balance","zh-CN":"计算账户余额","ja":"口座残高を計算"}
}}`;
const KEY = '// Calculate account balance';

class MemoryFs implements DataFileSystem {
    readonly files = new Map<string, { data: Uint8Array; mtime: number; size?: number }>();
    reads = 0;
    private clock = 1;

    write(path: string, text: string | Uint8Array, mtime?: number): void {
        const data = typeof text === 'string' ? new TextEncoder().encode(text) : text;
        this.files.set(path, { data, mtime: mtime ?? this.clock++ });
    }

    /** 改写内容但保持大小与时间戳不变（元数据看不出变化）。 */
    replaceKeepingMetadata(path: string, text: string): void {
        const old = this.files.get(path)!;
        const data = new TextEncoder().encode(text);
        if (data.length !== old.data.length) throw new Error('replacement must keep the size');
        this.files.set(path, { data, mtime: old.mtime });
    }

    async stat(path: string): Promise<FileStat | undefined> {
        const f = this.files.get(path);
        return f && { mtime: f.mtime, size: f.size ?? f.data.length };
    }

    async read(path: string): Promise<Uint8Array> {
        this.reads++;
        const f = this.files.get(path);
        if (!f) throw new Error(`ENOENT ${path}`);
        return f.data;
    }
}

const noSleep = () => Promise.resolve();

describe('MappingRepository', () => {
    it('没有 mappings.json 时为 undefined；读取、缓存、invalidate 后重新读取', async () => {
        const fs = new MemoryFs();
        const repo = new MappingRepository(fs, 0, 4, noSleep);
        expect(await repo.load('/p', '')).toBeUndefined();
        fs.write('/p/.codei18n/mappings.json', MAPPINGS);
        const first = await repo.load('/p', '');
        expect(first!.translation(KEY)).toBe('计算账户余额');
        expect(await repo.load('/p', '')).toBe(first);
        fs.replaceKeepingMetadata('/p/.codei18n/mappings.json', MAPPINGS.replace('计算账户余额', '核算账户余额'));
        expect((await repo.load('/p', ''))!.translation(KEY)).toBe('计算账户余额');
        repo.invalidate('/p');
        expect((await repo.load('/p', ''))!.translation(KEY)).toBe('核算账户余额');
    });

    it('语言设置、config.json 与元数据变化都会重新解析', async () => {
        const fs = new MemoryFs();
        const repo = new MappingRepository(fs, 0, 4, noSleep);
        fs.write('/p/.codei18n/mappings.json', MAPPINGS);
        expect((await repo.load('/p', 'ja'))!.translation(KEY)).toBe('口座残高を計算');
        fs.write('/p/.codei18n/config.json', '{"localLanguage":"ja"}');
        expect((await repo.load('/p', ''))!.language).toBe('ja');
        fs.write('/p/.codei18n/mappings.json', MAPPINGS.replace('口座残高を計算', '更新済み'));
        expect((await repo.load('/p', ''))!.translation(KEY)).toBe('更新済み');
        fs.files.delete('/p/.codei18n/mappings.json');
        expect(await repo.load('/p', '')).toBeUndefined();
    });

    it('只 invalidate 一个根目录时其他根目录仍命中缓存；retain 之外的根目录重新读取', async () => {
        const fs = new MemoryFs();
        const repo = new MappingRepository(fs, 0, 4, noSleep);
        fs.write('/p/.codei18n/mappings.json', MAPPINGS);
        fs.write('/p/m/.codei18n/mappings.json', MAPPINGS);
        const outer = await repo.load('/p', 'zh-CN');
        await repo.load('/p/m', 'zh-CN');
        fs.replaceKeepingMetadata('/p/.codei18n/mappings.json', MAPPINGS.replace('计算账户余额', '核算账户余额'));
        fs.replaceKeepingMetadata('/p/m/.codei18n/mappings.json', MAPPINGS.replace('计算账户余额', '嵌套账户余额'));
        repo.invalidate('/p/m');
        expect(await repo.load('/p', 'zh-CN')).toBe(outer);
        expect((await repo.load('/p/m', 'zh-CN'))!.translation(KEY)).toBe('嵌套账户余额');
        repo.invalidate('/p');
        expect((await repo.load('/p', 'zh-CN'))!.translation(KEY)).toBe('核算账户余额');
        repo.retain(['/p']);
        fs.replaceKeepingMetadata('/p/m/.codei18n/mappings.json', MAPPINGS);
        expect((await repo.load('/p/m', 'zh-CN'))!.translation(KEY)).toBe('计算账户余额');
    });

    it('读到改写中的不完整 JSON（含截断的多字节字符）时重试', async () => {
        const fs = new MemoryFs();
        let sleeps = 0;
        const complete = new TextEncoder().encode(MAPPINGS);
        const cut = new TextEncoder().encode(MAPPINGS.substring(0, MAPPINGS.indexOf('计算'))).length + 1;
        for (const partial of [new TextEncoder().encode('{"comments":{"a":'), complete.slice(0, cut)]) {
            fs.write('/p/.codei18n/mappings.json', partial);
            const repo = new MappingRepository(fs, 0, 4, async () => {
                sleeps++;
                fs.write('/p/.codei18n/mappings.json', complete); // 写入方在等待期间完成
            });
            expect((await repo.load('/p', 'zh-CN'))!.translation(KEY)).toBe('计算账户余额');
        }
        expect(sleeps).toBe(2);
    });

    it('文件稳定后仍然无效才报错，且不再提供旧快照', async () => {
        const fs = new MemoryFs();
        const repo = new MappingRepository(fs, 0, 4, noSleep);
        fs.write('/p/.codei18n/mappings.json', MAPPINGS);
        await repo.load('/p', '');
        fs.write('/p/.codei18n/mappings.json', '{broken');
        await expect(repo.load('/p', '')).rejects.toThrow();
        const truncated = new TextEncoder().encode(MAPPINGS).slice(0, 60);
        fs.write('/p/.codei18n/mappings.json', truncated);
        await expect(repo.load('/p', '')).rejects.toThrow();
        fs.write('/p/.codei18n/mappings.json', MAPPINGS);
        expect((await repo.load('/p', ''))!.translation(KEY)).toBe('计算账户余额');
    });

    it('超过 32 MiB 的 JSON 拒绝加载，不读取内容', async () => {
        const fs = new MemoryFs();
        const repo = new MappingRepository(fs, 0, 4, noSleep);
        fs.write('/p/.codei18n/mappings.json', MAPPINGS);
        fs.files.get('/p/.codei18n/mappings.json')!.size = MAX_JSON_BYTES + 1;
        await expect(repo.load('/p', '')).rejects.toBeInstanceOf(DataFileError);
        expect(fs.reads).toBe(0);
    });

    it('不认识主版本的 index.json 被忽略，只用 mappings.json', async () => {
        const fs = new MemoryFs();
        const repo = new MappingRepository(fs, 0, 4, noSleep);
        fs.write('/p/.codei18n/mappings.json', MAPPINGS);
        fs.write('/p/.codei18n/index.json', '{"version":"2","files":{}}');
        const index = await repo.load('/p', '');
        expect(index!.hasLocations).toBe(false);
        expect(index!.translation(KEY)).toBe('计算账户余额');
    });
});
