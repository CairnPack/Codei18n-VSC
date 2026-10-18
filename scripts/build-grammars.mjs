#!/usr/bin/env node
// 用与 core 完全相同的 tree-sitter 语法 C 源码编译 grammars/*.wasm（供 web-tree-sitter 加载）。
//
// 源码来源：
//   - Java、Kotlin、C#、JavaScript、TypeScript、TSX：core 依赖的 github.com/smacker/go-tree-sitter
//     （版本从 core 的 go.mod 读取，源码取自 Go 模块缓存，需要先在 core 目录执行过 go mod download）；
//   - Dart：core 仓库 adapters/dart/grammar（tree-sitter-dart @c8e7cbbd，ABI 14）。
// parser.c / scanner.c 只把 include 路径改成 tree_sitter/…；parser.h 用同目录 smacker 的版本，
// alloc.h / array.h 取自 grammars/include（上游 tree-sitter-c-sharp v0.21.3 的 src/tree_sitter，
// smacker 的 Kotlin、C# 语法版本所带的同一份头文件）。
//
// 编译器：wasi-sdk 的 clang。按顺序查找 WASI_SDK_PATH、%LOCALAPPDATA%/tree-sitter/wasi-sdk、
// ~/.cache/tree-sitter/wasi-sdk（tree-sitter CLI 0.26 的 build --wasm 会自动下载到这里）。
// 编译参数与 tree-sitter CLI 0.26 的 wasi-sdk 路径一致。
//
// 环境变量：CODEI18N_CORE_DIR（默认 ../Codei18n）、SMACKER_DIR（直接指定 smacker 模块目录）。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const out = join(repo, 'grammars');
const coreDir = resolve(process.env.CODEI18N_CORE_DIR || join(repo, '..', 'Codei18n'));

function smackerDir() {
    if (process.env.SMACKER_DIR) return resolve(process.env.SMACKER_DIR);
    const goMod = readFileSync(join(coreDir, 'go.mod'), 'utf8');
    const version = /github\.com\/smacker\/go-tree-sitter\s+(\S+)/.exec(goMod)?.[1];
    if (!version) throw new Error('core 的 go.mod 中找不到 github.com/smacker/go-tree-sitter');
    const modCache = execFileSync('go', ['env', 'GOMODCACHE'], { encoding: 'utf8' }).trim();
    return join(modCache, 'github.com', 'smacker', `go-tree-sitter@${version}`);
}

function clang() {
    const roots = [process.env.WASI_SDK_PATH,
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'tree-sitter', 'wasi-sdk'),
        join(homedir(), '.cache', 'tree-sitter', 'wasi-sdk')].filter(Boolean);
    for (const root of roots) {
        for (const exe of ['clang.exe', 'clang']) {
            const path = join(root, 'bin', exe);
            if (existsSync(path)) return path;
        }
    }
    throw new Error('找不到 wasi-sdk。设置 WASI_SDK_PATH，或运行一次 `npx tree-sitter-cli@0.26.13 build --wasm <任一语法目录>` 让 CLI 自动下载。');
}

const smacker = smackerDir();
const GRAMMARS = [
    { name: 'java', symbol: 'java', dir: join(smacker, 'java'), files: ['parser.c'] },
    { name: 'kotlin', symbol: 'kotlin', dir: join(smacker, 'kotlin'), files: ['parser.c', 'scanner.c'] },
    { name: 'c_sharp', symbol: 'c_sharp', dir: join(smacker, 'csharp'), files: ['parser.c', 'scanner.c'] },
    { name: 'javascript', symbol: 'javascript', dir: join(smacker, 'javascript'), files: ['parser.c', 'scanner.c'] },
    { name: 'typescript', symbol: 'typescript', dir: join(smacker, 'typescript', 'typescript'), files: ['parser.c', 'scanner.c', 'scanner.h'] },
    { name: 'tsx', symbol: 'tsx', dir: join(smacker, 'typescript', 'tsx'), files: ['parser.c', 'scanner.c', 'scanner.h'] },
    { name: 'dart', symbol: 'dart', dir: join(coreDir, 'adapters', 'dart', 'grammar'), files: ['parser.c', 'scanner.c'] },
];

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const cc = clang();
const ccVersion = execFileSync(cc, ['--version'], { encoding: 'utf8' }).split('\n')[0].trim();
const work = mkdtempSync(join(tmpdir(), 'codei18n-grammars-'));
const manifest = { generator: 'scripts/build-grammars.mjs', compiler: ccVersion, smacker: 'go-tree-sitter@' + smacker.split('go-tree-sitter@').pop(), grammars: {} };
mkdirSync(out, { recursive: true });

try {
    for (const g of GRAMMARS) {
        const src = join(work, g.name, 'src');
        mkdirSync(join(src, 'tree_sitter'), { recursive: true });
        const sources = {};
        for (const file of g.files) {
            const raw = readFileSync(join(g.dir, file));
            sources[file] = sha256(raw);
            const text = raw.toString('latin1')
                .replace(/#include "parser\.h"/g, '#include "tree_sitter/parser.h"')
                .replace(/#include "\.\.\/(alloc|array)\.h"/g, '#include "tree_sitter/$1.h"');
            writeFileSync(join(src, file), text, 'latin1');
        }
        // core 编译时用的 parser.h：smacker 子包自带的那一份（Dart 用 core 目录中的拷贝）。
        copyFileSync(join(g.dir, 'parser.h'), join(src, 'tree_sitter', 'parser.h'));
        for (const h of ['alloc.h', 'array.h']) copyFileSync(join(out, 'include', 'tree_sitter', h), join(src, 'tree_sitter', h));
        const target = join(out, `tree-sitter-${g.name}.wasm`);
        const args = ['-o', target, '-fPIC', '-shared', '-Os',
            `-Wl,--export=tree_sitter_${g.symbol}`, '-Wl,--allow-undefined', '-Wl,--no-entry',
            '-nostdlib', '-fno-exceptions', '-fvisibility=hidden', '-I', src,
            ...g.files.filter(f => f.endsWith('.c')).map(f => join(src, f))];
        execFileSync(cc, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const wasm = readFileSync(target);
        const source = g.dir.startsWith(coreDir)
            ? 'core:' + relative(coreDir, g.dir).split(sep).join('/')
            : 'smacker:' + relative(smacker, g.dir).split(sep).join('/');
        manifest.grammars[g.name] = { source, sources, wasmSha256: sha256(wasm), bytes: wasm.length };
        console.log(`已编译 grammars/tree-sitter-${g.name}.wasm（${(wasm.length / 1024).toFixed(0)} KiB）`);
    }
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally {
    rmSync(work, { recursive: true, force: true });
}
