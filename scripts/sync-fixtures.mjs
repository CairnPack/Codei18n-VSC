#!/usr/bin/env node
// 把 IDEA 插件仓库的 examples/languages（六种语言的样例与 CLI 生成的 .codei18n）同步到 test/fixtures/languages。
// 一致性测试与集成测试都使用这份拷贝。
//
//   node scripts/sync-fixtures.mjs [--ref <git 引用>] [--check]
//
// 从 IDEA 仓库的 git 对象读取（默认 HEAD，可用 --ref origin/main 等指定），不依赖其工作区内容；
// 跳过 .codei18n/cache/。--check 只比较，不一致时以非零状态退出。
// IDEA 仓库位置：环境变量 CODEI18N_IDEA_DIR，默认聚合仓库中的兄弟目录 ../Codei18n-IDEA。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const target = join(repo, 'test', 'fixtures', 'languages');
const ideaDir = resolve(process.env.CODEI18N_IDEA_DIR || join(repo, '..', 'Codei18n-IDEA'));
const args = process.argv.slice(2);
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'HEAD';
const check = args.includes('--check');
const PREFIX = 'examples/languages/';

const git = (...a) => execFileSync('git', ['-C', ideaDir, ...a], { maxBuffer: 64 * 1024 * 1024 });
const names = git('ls-tree', '-r', '--name-only', ref, '--', PREFIX).toString('utf8').split('\n')
    .filter(n => n.startsWith(PREFIX) && !n.includes('/.codei18n/cache/'));
if (names.length === 0) throw new Error(`${ideaDir} 的 ${ref} 中没有 ${PREFIX}`);
const sha = git('rev-parse', ref).toString('utf8').trim();

const wanted = new Map(names.map(n => [n.substring(PREFIX.length), git('show', `${ref}:${n}`)]));

function listLocal(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) listLocal(path, out); else out.push(relative(target, path).split(sep).join('/'));
    }
    return out;
}

const local = listLocal(target).filter(n => n !== 'SOURCE');
const stale = local.filter(n => !wanted.has(n));
const changed = [...wanted].filter(([n, data]) => !existsSync(join(target, n)) || !readFileSync(join(target, n)).equals(data)).map(([n]) => n);

if (check) {
    if (stale.length || changed.length) {
        console.error(`test/fixtures/languages 与 IDEA ${ref}（${sha.substring(0, 7)}）不一致：${[...changed, ...stale].join(', ')}`);
        process.exit(1);
    }
    console.log(`test/fixtures/languages 与 IDEA ${ref}（${sha.substring(0, 7)}）一致`);
} else {
    for (const n of stale) rmSync(join(target, n));
    for (const [n, data] of wanted) {
        mkdirSync(dirname(join(target, n)), { recursive: true });
        writeFileSync(join(target, n), data);
    }
    writeFileSync(join(target, 'SOURCE'), `CairnPack/Codei18n-IDEA ${sha} examples/languages\n`);
    console.log(`已从 IDEA ${ref}（${sha.substring(0, 7)}）同步 ${wanted.size} 个文件，更新 ${changed.length}，删除 ${stale.length}`);
}
