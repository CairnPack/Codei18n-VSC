#!/usr/bin/env node
// esbuild 打包扩展：src/extension.ts → dist/extension.js（CommonJS，vscode 为外部模块）。
//   --production  压缩、不生成 sourcemap
//   --watch       监视模式
import { copyFileSync, mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const options = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['vscode'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'warning',
    // web-tree-sitter 同时提供 ESM 与 CJS；ESM 版依赖 import.meta.url，打包为 CJS 时必须用 CJS 版本。
    alias: { 'web-tree-sitter': './node_modules/web-tree-sitter/web-tree-sitter.cjs' },
};

// web-tree-sitter 运行时 wasm 随扩展发布，运行时用 context.extensionUri 定位。
mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'dist/web-tree-sitter.wasm');

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('esbuild 监视中…');
} else {
    await esbuild.build(options);
    console.log(`已构建 dist/extension.js${production ? '（production）' : ''}`);
}
