import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalize, sha1, textHash } from '../../src/core/commentText';
import { canonical, equivalent } from '../../src/core/languageCodes';

/** 与 core、IDEA 插件共用的测试向量（test/testdata 从 core 的 docs/testdata 原样复制，见 scripts/check-vectors.mjs）。 */
const testdata = (name: string) => JSON.parse(readFileSync(join(__dirname, '../testdata', name), 'utf8'));

describe('共享测试向量', () => {
    const codes = testdata('language-codes.json') as { canonical: [string, string][]; equivalent: [string, string, boolean][] };
    const norm = testdata('text-normalization.json') as { cases: { input: string; normalized: string }[] };

    it.each(codes.canonical)('canonical(%j) = %j', (input, expected) => {
        expect(canonical(input)).toBe(expected);
    });

    it.each(codes.equivalent)('equivalent(%j, %j) = %j', (a, b, expected) => {
        expect(equivalent(a, b)).toBe(expected);
    });

    it('text-normalization.json 至少 10 条', () => {
        expect(norm.cases.length).toBeGreaterThanOrEqual(10);
    });

    it.each(norm.cases.map(c => [c.input, c.normalized]))('normalize(%j) = %j', (input, expected) => {
        expect(normalize(input)).toBe(expected);
    });

    it('textHash 是归一化文本的小写十六进制 SHA-1（与 core/index.TextHash 相同）', () => {
        expect(textHash('// Hello   world')).toBe(sha1('Hello world'));
        expect(sha1('Hello world')).toBe('7b502c3a1f48c8609ae212cdfb639dee39673f5e');
    });
});
