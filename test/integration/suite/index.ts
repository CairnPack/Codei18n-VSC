import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Mocha from 'mocha';

/** VS Code 扩展宿主加载的测试入口：运行本目录下所有 *.test.js。 */
export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: false, grep: process.env.MOCHA_GREP || undefined });
    for (const file of readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) mocha.addFile(join(__dirname, file));
    return new Promise((resolve, reject) => {
        mocha.run(failures => (failures > 0 ? reject(new Error(`${failures} 个集成测试失败`)) : resolve()));
    });
}
