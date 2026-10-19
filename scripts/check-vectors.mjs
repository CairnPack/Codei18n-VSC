#!/usr/bin/env node
// 检查 test/testdata 中的共享测试向量与 core 仓库（docs/testdata）是否一致，不一致时以非零状态退出。
//
// 对照来源（按顺序）：
//   1. 环境变量 CODEI18N_CORE_DIR 指向的 core 仓库目录；
//   2. 聚合仓库中的兄弟目录 ../Codei18n（本仓库作为 Codei18n-All 的子模块检出时）；
//   3. GitHub 上 CairnPack/Codei18n 的 main 分支（可用 CODEI18N_CORE_REF 指定其他分支或 tag）。
// 比较前统一换行为 LF，避免 core.autocrlf 造成误报。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VECTORS = ['text-normalization.json', 'language-codes.json'];
const here = dirname(fileURLToPath(import.meta.url));
const local = join(here, '..', 'test', 'testdata');
const lf = s => s.replace(/\r\n/g, '\n');

const candidates = [process.env.CODEI18N_CORE_DIR, join(here, '..', '..', 'Codei18n')].filter(Boolean);
const coreDir = candidates.map(d => resolve(d)).find(d => existsSync(join(d, 'docs', 'testdata', VECTORS[0])));

async function upstream(name) {
    if (coreDir) return readFileSync(join(coreDir, 'docs', 'testdata', name), 'utf8');
    const ref = process.env.CODEI18N_CORE_REF || 'main';
    const url = `https://raw.githubusercontent.com/CairnPack/Codei18n/${ref}/docs/testdata/${name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`下载 ${url} 失败：HTTP ${res.status}`);
    return res.text();
}

let failed = false;
console.log(`对照来源：${coreDir ?? `github.com/CairnPack/Codei18n@${process.env.CODEI18N_CORE_REF || 'main'}`}`);
for (const name of VECTORS) {
    const mine = lf(readFileSync(join(local, name), 'utf8'));
    const theirs = lf(await upstream(name));
    if (mine === theirs) {
        console.log(`一致：${name}`);
    } else {
        failed = true;
        console.error(`不一致：test/testdata/${name} 与 core 的 docs/testdata/${name} 不同，请从 core 重新复制。`);
    }
}
process.exit(failed ? 1 : 0);
