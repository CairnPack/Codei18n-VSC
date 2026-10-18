import { describe, expect, it } from 'vitest';
import { sha1, textHash } from '../../src/core/commentText';
import { group } from '../../src/core/commentGroups';
import { MappingIndex } from '../../src/core/mappingIndex';

/** 移植自 IDEA 插件 C1ReproTest："有译文却不显示"的四个根因，各自经由修复它的入口验证。 */
describe('C1 复现用例', () => {
    it('C1.1 同文异译：有 index.json 时按文件 + 位置分别命中', () => {
        const duplicates = '{"comments":{"id-a":{"en":"// Save","zh-CN":"保存"},"id-b":{"en":"// Save","zh-CN":"储存"}}}';
        const source = '// Save\nint a;\n// Save\nint b;\n';
        const hash = sha1(source);
        const th = textHash('// Save');
        const index = `{"version":"1","files":{"A.java":{"contentHash":"${hash}","language":"java","comments":[
 {"id":"id-a","range":{"startLine":1,"startCol":1,"endLine":1,"endCol":8},"type":"line","lang":"en","sourceKey":"en","textHash":"${th}","parts":1},
 {"id":"id-b","range":{"startLine":3,"startCol":1,"endLine":3,"endCol":8},"type":"line","lang":"en","sourceKey":"en","textHash":"${th}","parts":1}]}}}`;
        const dup = MappingIndex.parse(duplicates, '{}', index, '');
        const file = { relativePath: 'A.java', contentHash: hash, text: source };
        expect(dup.match(file, 0, 7, 1).text).toBe('保存');
        expect(dup.match(file, 15, 22, 1).text).toBe('储存');
    });

    it('C1.2 本地语言写的注释：显示语言为 en 时显示英文译文', () => {
        const local = '{"comments":{"id-zh":{"zh-CN":"// 计算余额","en":"// Calculate balance"}}}';
        expect(MappingIndex.parse(local, '{}', undefined, 'en').translation('// 计算余额')).toBe('// Calculate balance');
    });

    it('C1.4 连续行注释：按 §6.1 聚合成组再匹配，整组显示译文', () => {
        const merged = '{"comments":{"id-m":{"en":"// First line\\n// Second line","zh-CN":"// 第一行\\n// 第二行"}}}';
        const code = '    // First line\n    // Second line\n    void f() {}\n';
        const groups = group(code, [{ start: 4, end: 17 }, { start: 22, end: 36 }]);
        const m = MappingIndex.parse(merged, '{}', undefined, '');
        expect(groups.length).toBe(1);
        expect(m.match({ relativePath: 'B.java', contentHash: null, text: code }, 4, 36, 2).text).toBe('// 第一行\n// 第二行');
    });

    it('C1.5 语言码：设置里填 zh，mapping 中是 zh-CN', () => {
        const codes = '{"comments":{"id-c":{"en":"// Calculate","zh-CN":"// 计算"}}}';
        expect(MappingIndex.parse(codes, '{}', undefined, 'zh').translation('// Calculate')).toBeDefined();
    });
});
