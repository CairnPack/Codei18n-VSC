import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * 用 @vscode/test-electron 启动真实的 VS Code 跑集成测试。
 * 每次把 test/fixtures/languages（由 scripts/sync-fixtures.mjs 从 IDEA 的 examples/languages 同步）复制成
 * out/workspace/languages 作为测试工程，测试会改写其中的 mappings.json，不影响夹具本身。
 *
 * 环境变量 VSCODE_VERSION：要测试的 VS Code 版本（默认 stable，CI 里还测 package.json 的最低版本）。
 */
async function main(): Promise<void> {
    const root = resolve(__dirname, '..', '..');
    const workspace = join(root, 'out', 'workspace', 'languages');
    rmSync(join(root, 'out', 'workspace'), { recursive: true, force: true });
    mkdirSync(workspace, { recursive: true });
    cpSync(join(root, 'test', 'fixtures', 'languages'), workspace, { recursive: true });
    const userData = join(root, '.vscode-test', 'user-data');
    rmSync(userData, { recursive: true, force: true });

    const code = await runTests({
        version: process.env.VSCODE_VERSION || 'stable',
        extensionDevelopmentPath: root,
        extensionTestsPath: join(__dirname, 'suite', 'index.js'),
        launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
            `--user-data-dir=${userData}`, '--disable-gpu'],
        extensionTestsEnv: { CODEI18N_FIXTURES: join(root, 'test', 'fixtures', 'languages'), MOCHA_GREP: process.env.MOCHA_GREP },
    });
    process.exit(code);
}

main().catch(err => {
    console.error('集成测试失败：', err);
    process.exit(1);
});
