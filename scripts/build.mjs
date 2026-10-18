#!/usr/bin/env node
// esbuild 打包扩展：src/extension.ts → dist/extension.js（CommonJS，vscode 为外部模块）。
//   --production  压缩、不生成 sourcemap
//   --watch       监视模式
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
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('esbuild 监视中…');
} else {
    await esbuild.build(options);
    console.log(`已构建 dist/extension.js${production ? '（production）' : ''}`);
}
