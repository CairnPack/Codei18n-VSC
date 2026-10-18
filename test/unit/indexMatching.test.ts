import { describe, expect, it } from 'vitest';
import { legacy, sha1, textHash } from '../../src/core/commentText';
import { group, marker, Piece } from '../../src/core/commentGroups';
import { FileContext, Match, MappingIndex } from '../../src/core/mappingIndex';
import { scan } from '../../src/core/hints';

/** 移植自 IDEA 插件 IndexMatchingTest：index.json 匹配（C1/C2）、注释分组。 */

const MAPPINGS = `
{"version":"1.0","sourceLanguage":"en","targetLanguage":"zh-CN","comments":{
  "id-save-1":{"en":"// Save","zh-CN":"// 保存"},
  "id-save-2":{"en":"// Save","zh-CN":"// 储存"},
  "id-group":{"en":"// First line\\n// Second line","zh-CN":"// 第一行\\n// 第二行"},
  "id-zh":{"zh-CN":"// 计算余额","en":"// Calculate balance"},
  "id-ja":{"ja":"// 設定を読み込む","zh-CN":"// 读取设置","en":"// Load settings"}
}}
`;

/** 行：1 class，2 save-1，4 save-2，6-7 group，9 zh，11 ja。 */
const SOURCE = `class A {
    // Save
    void a() {}
    // Save
    void b() {}
    // First line
    // Second line
    void c() {}
    // 计算余额
    void d() {}
    // 設定を読み込む
    void e() {}
}
`;

function index(contentHash: string): string {
    return `
{"version":"1","files":{"src/A.java":{"contentHash":"${contentHash}","language":"java","comments":[
  {"id":"id-save-1","range":{"startLine":2,"startCol":5,"endLine":2,"endCol":12},"type":"line","lang":"en","sourceKey":"en","textHash":"${textHash('// Save')}","parts":1},
  {"id":"id-save-2","range":{"startLine":4,"startCol":5,"endLine":4,"endCol":12},"type":"line","lang":"en","sourceKey":"en","textHash":"${textHash('// Save')}","parts":1},
  {"id":"id-group","range":{"startLine":6,"startCol":5,"endLine":7,"endCol":19},"type":"line","lang":"en","sourceKey":"en","textHash":"${textHash('// First line\n// Second line')}","parts":2},
  {"id":"id-zh","range":{"startLine":9,"startCol":5,"endLine":9,"endCol":12},"type":"line","lang":"zh-Hans","sourceKey":"zh-CN","textHash":"${textHash('// 计算余额')}","parts":1},
  {"id":"id-ja","range":{"startLine":11,"startCol":5,"endLine":11,"endCol":15},"type":"line","lang":"ja","sourceKey":"ja","textHash":"${textHash('// 設定を読み込む')}","parts":1}
]}}}
`;
}

const hash = (s: string) => sha1(s);

function matchRaw(idx: MappingIndex, file: FileContext, comment: string, nth: number, parts: number): Match {
    let start = -1;
    for (let i = 0; i <= nth; i++) start = file.text.indexOf(comment, start + 1);
    if (start < 0) throw new Error(`comment not found: ${comment}`);
    return idx.match(file, start, start + comment.length, parts);
}

const match = (idx: MappingIndex, file: FileContext, comment: string, nth: number, parts: number) =>
    matchRaw(idx, file, comment, nth, parts).text;

function p(text: string, comment: string): Piece {
    const start = text.indexOf(comment);
    return { start, end: start + comment.length };
}

describe('注释分组（§6.1）', () => {
    it('与 core 规则一致', () => {
        const text = '// a\n// b\n    // c\nx(); // d\n// e\n/// f\n/// g\n/* h */\n/* i */\n';
        const pieces = ['// a', '// b', '// c', '// d', '// e', '/// f', '/// g', '/* h */', '/* i */'].map(c => p(text, c));
        // a+b；c（列不同）；d（行尾注释）；e（标记与 f 不同）；f+g；h；i
        expect(group(text, pieces).map(g => g.length)).toEqual([2, 1, 1, 1, 2, 1, 1]);
        expect(marker('/// x')).toBe('///');
        expect(marker('//! x')).toBe('//!');
        expect(marker('/* x */')).toBe('');
    });

    it('CRLF 文本中的 \\r 不影响列与行', () => {
        const text = '// a\r\n// b\r\nx();\r\n';
        expect(group(text, [p(text, '// a'), p(text, '// b')]).map(g => g.length)).toEqual([2]);
    });
});

describe('index.json 匹配', () => {
    const idx = MappingIndex.parse(MAPPINGS, '{}', index(hash(SOURCE)), '');
    const file: FileContext = { relativePath: 'src/A.java', contentHash: hash(SOURCE), text: SOURCE };

    it('C1.1 同文异译：按文件 + 位置各自命中；全局文本匹配仍保守', () => {
        expect(idx.hasLocations).toBe(true);
        expect(match(idx, file, '// Save', 0, 1)).toBe('// 保存');
        expect(match(idx, file, '// Save', 1, 1)).toBe('// 储存');
        expect(matchRaw(idx, file, '// Save', 0, 1).via).toBe('location');
        expect(idx.translation('// Save')).toBeUndefined();
    });

    it('C1.4 连续行注释：按 parts 作为一组匹配；单独的第一行不是条目', () => {
        const g = SOURCE.indexOf('// First line');
        const ge = SOURCE.indexOf('// Second line') + '// Second line'.length;
        expect(idx.match(file, g, ge, 2).text).toBe('// 第一行\n// 第二行');
        expect(idx.match(file, g, g + '// First line'.length, 1).found).toBe(false);
    });

    it('文件已修改：按 textHash 匹配，同文异译按出现顺序配对；次数不一致时取最近行，等距不显示', () => {
        const edited = '// inserted\n' + SOURCE;
        const changed: FileContext = { relativePath: 'src/A.java', contentHash: hash(edited), text: edited };
        const s0 = edited.indexOf('// Save');
        const s1 = edited.indexOf('// Save', s0 + 1);
        expect(idx.match(changed, s0, s0 + 7, 1, 0, 2).text).toBe('// 保存');
        expect(idx.match(changed, s0, s0 + 7, 1, 0, 2).via).toBe('textHash');
        expect(idx.match(changed, s1, s1 + 7, 1, 1, 2).text).toBe('// 储存');
        expect(idx.match(changed, s0, s0 + 7, 1, 0, 3).text).toBeUndefined();
        const eg = edited.indexOf('// First line');
        const ege = edited.indexOf('// Second line') + '// Second line'.length;
        expect(idx.match(changed, eg, ege, 2).text).toBe('// 第一行\n// 第二行');
    });

    it('有未保存修改（contentHash 为 null）时不按位置匹配', () => {
        const unsaved: FileContext = { relativePath: 'src/A.java', contentHash: null, text: SOURCE };
        expect(matchRaw(idx, unsaved, '// 設定を読み込む', 0, 1).via).toBe('textHash');
    });

    it('不在索引中的文件退回全局文本匹配', () => {
        const other: FileContext = { relativePath: 'src/B.java', contentHash: null, text: '// First line\n// Second line\n' };
        const m = idx.match(other, 0, other.text.length - 1, 2);
        expect(m.text).toBe('// 第一行\n// 第二行');
        expect(m.via).toBe('global');
    });

    it('不认识的主版本忽略索引；损坏的 index.json 报错；没有 index.json 与旧版本一样', () => {
        expect(MappingIndex.parse(MAPPINGS, '{}', '{"version":"2","files":{}}', '').hasLocations).toBe(false);
        expect(MappingIndex.parse(MAPPINGS, '{}', '{"version":"1.3","files":{}}', '').hasLocations).toBe(true);
        expect(() => MappingIndex.parse(MAPPINGS, '{}', '{broken', '')).toThrow();
        expect(MappingIndex.parse(MAPPINGS, '{}', undefined, '').hasLocations).toBe(false);
    });
});

describe('本地语言与语言码', () => {
    const idx = index(hash(SOURCE));
    const file: FileContext = { relativePath: 'src/A.java', contentHash: hash(SOURCE), text: SOURCE };

    it('C1.2 原文已是显示语言：找到条目但不显示', () => {
        const zh = MappingIndex.parse(MAPPINGS, '{}', idx, '');
        const self = matchRaw(zh, file, '// 计算余额', 0, 1);
        expect(self.found).toBe(true);
        expect(self.text).toBeUndefined();
        expect(match(MappingIndex.parse(MAPPINGS, '{}', idx, 'en'), file, '// 计算余额', 0, 1)).toBe('// Calculate balance');
        expect(match(zh, file, '// 設定を読み込む', 0, 1)).toBe('// 读取设置');
        expect(matchRaw(zh, file, '// 設定を読み込む', 0, 1).sourceLanguage).toBe('ja');
    });

    it('C1.5 设置里填 zh，mapping 中是 zh-CN', () => {
        const zhShort = MappingIndex.parse(MAPPINGS, '{}', idx, 'zh');
        expect(zhShort.language).toBe('zh');
        expect(match(zhShort, file, '// Save', 0, 1)).toBe('// 保存');
        expect(matchRaw(zhShort, file, '// 计算余额', 0, 1).text).toBeUndefined();
    });

    it('全局回退同样识别本地语言原文与等价语言码', () => {
        expect(MappingIndex.parse(MAPPINGS, '{}', undefined, 'en').translation('// 计算余额')).toBe('// Calculate balance');
        expect(MappingIndex.parse(MAPPINGS, '{}', undefined, 'zh').translation('// 設定を読み込む')).toBe('// 读取设置');
    });
});

describe('没有语法时只按位置（文件未修改）', () => {
    const idx = MappingIndex.parse(MAPPINGS, '{}', index(hash(SOURCE)), '');

    it('按 range 定位且 textHash 一致才显示', () => {
        const located = idx.located({ relativePath: 'src/A.java', contentHash: hash(SOURCE), text: SOURCE });
        // save-1、save-2、group、ja（zh 原文已是显示语言）
        expect(located.length).toBe(4);
        expect(SOURCE.substring(located[0].start, located[0].end)).toBe('// Save');
        expect(located[0].text).toBe('// 保存');
        expect(SOURCE.substring(located[2].start, located[2].end)).toBe('// First line\n    // Second line');
    });

    it('文件已修改或有未保存修改时不显示', () => {
        const edited = SOURCE.replace('// Save\n    void a', '// Sav!\n    void a');
        expect(idx.located({ relativePath: 'src/A.java', contentHash: hash(edited), text: edited }).length).toBe(0);
        expect(idx.located({ relativePath: 'src/A.java', contentHash: null, text: SOURCE }).length).toBe(0);
    });

    it('行列越界不报错', () => {
        const text = 'class A {}\n';
        const bad = MappingIndex.parse(MAPPINGS, '{}', index(hash(text)), '');
        expect(bad.located({ relativePath: 'src/A.java', contentHash: hash(text), text }).length).toBe(0);
    });
});

describe('scan（TranslationHint.scan 的移植）', () => {
    const pieces = (text: string) => {
        const out: Piece[] = [];
        const re = /\/\/[^\n]*/g;
        for (let m; (m = re.exec(text));) out.push({ start: m.index, end: m.index + m[0].length });
        return out;
    };

    it('整组只给一条译文，挂在组上；未修改文件全部按位置命中', () => {
        const idx = MappingIndex.parse(MAPPINGS, '{}', index(hash(SOURCE)), '');
        const hints = scan(idx, { relativePath: 'src/A.java', contentHash: hash(SOURCE), text: SOURCE }, pieces(SOURCE));
        expect(hints.map(h => h.text)).toEqual(['// 保存', '// 储存', '// 第一行\n// 第二行', '// 读取设置']);
        expect(hints.every(h => h.via === 'location')).toBe(true);
        expect(hints[2].parts).toBe(2);
        expect(SOURCE.substring(hints[2].start, hints[2].end)).toBe('// First line\n    // Second line');
    });

    it('插入行后按出现顺序配对', () => {
        const idx = MappingIndex.parse(MAPPINGS, '{}', index(hash(SOURCE)), '');
        const edited = '// inserted\n' + SOURCE;
        const hints = scan(idx, { relativePath: 'src/A.java', contentHash: null, text: edited }, pieces(edited));
        expect(hints.map(h => h.text)).toEqual(['// 保存', '// 储存', '// 第一行\n// 第二行', '// 读取设置']);
        expect(hints.every(h => h.via === 'textHash')).toBe(true);
    });

    it('整组匹配不上时退回逐条匹配（旧映射按行存储）', () => {
        const old = '{"comments":{"a":{"en":"// First line","zh-CN":"第一行"},"b":{"en":"// Second line","zh-CN":"第二行"}}}';
        const idx = MappingIndex.parse(old, '{}', undefined, '');
        const text = '    // First line\n    // Second line\n';
        expect(scan(idx, { relativePath: 'B.java', contentHash: null, text }, pieces(text)).map(h => h.text)).toEqual(['第一行', '第二行']);
    });

    it('pieces 为 null（没有语法）时只按位置', () => {
        const idx = MappingIndex.parse(MAPPINGS, '{}', index(hash(SOURCE)), '');
        expect(scan(idx, { relativePath: 'src/A.java', contentHash: hash(SOURCE), text: SOURCE }, null).length).toBe(4);
        expect(scan(idx, { relativePath: 'src/A.java', contentHash: null, text: SOURCE }, null).length).toBe(0);
    });
});

describe('MappingIndexTest（全局文本匹配与解析）', () => {
    const M = `
{"version":"1.0","sourceLanguage":"en","targetLanguage":"zh-CN","comments":{
  "id-a":{"en":"// Calculate account balance","zh-CN":"计算账户余额","ja":"口座残高を計算"},
  "id-b":{"en":"/* Multi\\n line */","zh-CN":"多行\\n译文"},
  "id-c":{"en":"/** Documentation */","zh-CN":"文档"}
}}`;

    it('全局匹配与显示语言优先级', () => {
        const idx = MappingIndex.parse(M, '{}', undefined, '');
        expect(idx.language).toBe('zh-CN');
        expect(idx.translation('// Calculate account balance')).toBe('计算账户余额');
        expect(idx.translation('//  Calculate  account\t balance\r\n')).toBe('计算账户余额');
        expect(idx.translation('/* Multi\r\n line */')).toBe('多行\n译文');
        expect(idx.translation('/** Documentation */')).toBe('文档');
        expect(idx.translation('// Calculate NEW account balance')).toBeUndefined();
        expect(idx.translation('// missing')).toBeUndefined();
        expect(MappingIndex.parse(M, '{"localLanguage":"ja"}', undefined, '').translation('// Calculate account balance')).toBe('口座残高を計算');
        expect(MappingIndex.parse(M, '{"localLanguage":"ja"}', undefined, 'zh-CN').translation('// Calculate account balance')).toBe('计算账户余额');
        expect(MappingIndex.parse(M, '{}', undefined, 'fr').translation('// Calculate account balance')).toBeUndefined();
        expect(MappingIndex.parse('﻿' + M, '﻿{}', undefined, '').translation('// Calculate account balance')).toBe('计算账户余额');
        expect(MappingIndex.parse('{"targetLanguage":"ja","comments":{}}', '{}', undefined, '').language).toBe('ja');
        expect(MappingIndex.parse('{"targetLanguage":"ja","comments":{}}', '{"localLanguage":"  "}', undefined, '').language).toBe('ja');
    });

    it('歧义与空译文', () => {
        expect(MappingIndex.parse('{"comments":null}', '{}', undefined, '').translation('x')).toBeUndefined();
        expect(MappingIndex.parse('{"comments":{"x":{"en":"same","zh-CN":"same"}}}', '{}', undefined, '').translation('same')).toBeUndefined();
        const duplicates = '{"comments":{"a":{"en":"// Save","zh-CN":"保存"},"b":{"en":"Save","zh-CN":"节省"}}}';
        expect(MappingIndex.parse(duplicates, '{}', undefined, '').translation('// Save')).toBeUndefined();
        expect(MappingIndex.parse(duplicates.replace('节省', '保存'), '{}', undefined, '').translation('// Save')).toBe('保存');
        expect(MappingIndex.parse(duplicates.replace('节省', ''), '{}', undefined, '').translation('// Save')).toBeUndefined();
        expect(MappingIndex.parse('{"comments":{"a":{"ja":"保存する","zh-CN":"保存"}}}', '{"sourceLanguage":"ja"}', undefined, '')
            .translation('// 保存する')).toBe('保存');
    });

    it('拒绝无效 JSON 与结构', () => {
        expect(() => MappingIndex.parse('{', '{}', undefined, '')).toThrow();
        expect(() => MappingIndex.parse('[]', '{}', undefined, '')).toThrow();
        expect(() => MappingIndex.parse('{"comments":[]}', '{}', undefined, '')).toThrow();
        expect(() => MappingIndex.parse('{"comments":{"a":{"en":42}}}', '{}', undefined, '')).toThrow();
        expect(() => MappingIndex.parse(M, '{"localLanguage":false}', undefined, '')).toThrow();
    });

    it('旧版归一化', () => {
        expect(legacy('// a　　b ')).toBe('a b');
        expect(legacy('/*  x\n\t y */')).toBe('x y');
    });
});
