import * as vscode from 'vscode';
import { sha1 } from './core/commentText';
import { commentType, syntaxForFile } from './core/commentSyntax';
import { Hint, scan } from './core/hints';
import { shiftHints } from './core/hintEdits';
import { MappingIndex } from './core/mappingIndex';
import { DataFileSystem, MappingRepository } from './core/repository';
import { Grammars, ParsedDocument, TextChange } from './treesitter/extractor';
import { t } from './l10n';

const DEBOUNCE_MS = 350;
/** 大于 2 MiB 的源码不处理（与 IDEA 一致，按字符数计）。 */
export const MAX_DOCUMENT_LENGTH = 2 * 1024 * 1024;

/** 一个文档当前的匹配结果。 */
export interface DocumentTranslations {
    /** 所属 CodeI18n 根目录（含 .codei18n 的目录）；不在任何根目录下时为 undefined。 */
    readonly root?: vscode.Uri;
    readonly index?: MappingIndex;
    readonly error?: string;
    /** 不影响显示的问题（例如 index.json 无法解析、已忽略），同样只提示一次。 */
    readonly warning?: string;
    /** 按起始位置排序；`type` 已补全为 line/block/doc。 */
    readonly hints: readonly Hint[];
    /** 计算时的文档版本。 */
    readonly version: number;
    /** 没有译文的原因，仅供诊断。 */
    readonly reason?: 'disabled' | 'no-folder' | 'no-root' | 'no-mappings' | 'too-large';
}

interface DocState {
    parsed?: Promise<ParsedDocument | undefined>;
    result: DocumentTranslations;
    generation: number;
}

const EMPTY: DocumentTranslations = { hints: [], version: -1 };
const decoder = new TextDecoder('utf-8', { fatal: true });

/** vscode.workspace.fs 上的 DataFileSystem；路径是 URI 字符串。 */
const workspaceFs: DataFileSystem = {
    async stat(path) {
        try {
            const s = await vscode.workspace.fs.stat(vscode.Uri.parse(path));
            return (s.type & vscode.FileType.File) !== 0 ? { mtime: s.mtime, size: s.size } : undefined;
        } catch {
            return undefined;
        }
    },
    read: path => Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.parse(path))),
};

/**
 * 协调刷新：找到每个打开文档的 .codei18n 根目录、读取缓存、用 tree-sitter 提取注释并匹配。
 * 编辑时立即撤下被编辑注释的译文，停止输入约 350 ms 后重新匹配。只读：从不写入任何文件。
 */
export class TranslationController implements vscode.Disposable {
    private readonly states = new Map<string, DocState>();
    private readonly repository = new MappingRepository(workspaceFs);
    private readonly changed = new vscode.EventEmitter<vscode.Uri>();
    /** 某个文档的译文变化（含清空）。 */
    readonly onDidChange = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [this.changed];
    private readonly reported = new Map<string, string>();
    private readonly extraTargets = new Set<string>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private pending = new Set<string>();
    private running: Promise<void> = Promise.resolve();
    private busy = 0;
    private readonly idleWaiters: (() => void)[] = [];

    constructor(private readonly grammars: Grammars) {
        const watcher = vscode.workspace.createFileSystemWatcher('**/.codei18n/{mappings,index,config}.json');
        const dataChanged = (uri: vscode.Uri) => {
            // <root>/.codei18n/<file>.json → <root>
            this.repository.invalidate(vscode.Uri.joinPath(uri, '..', '..').toString());
            this.scheduleAll();
        };
        const dirWatcher = vscode.workspace.createFileSystemWatcher('**/.codei18n');
        this.disposables.push(
            watcher, dirWatcher,
            watcher.onDidChange(dataChanged), watcher.onDidCreate(dataChanged), watcher.onDidDelete(dataChanged),
            dirWatcher.onDidCreate(() => this.reload()), dirWatcher.onDidDelete(() => this.reload()),
            vscode.workspace.onDidChangeTextDocument(e => this.documentChanged(e)),
            vscode.workspace.onDidSaveTextDocument(d => this.schedule(d.uri)),
            vscode.workspace.onDidCloseTextDocument(d => this.forget(d.uri)),
            // 改变 languageId 时 VS Code 先关闭再重新打开同一个文档：重新打开后要再算一次。
            vscode.workspace.onDidOpenTextDocument(d => {
                if (this.targets().some(t => t.uri.toString() === d.uri.toString())) this.schedule(d.uri);
            }),
            vscode.window.onDidChangeVisibleTextEditors(() => this.scheduleAll()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('codei18n')) this.scheduleAll();
            }),
        );
        this.scheduleAll();
    }

    /** 文档当前的译文（没有时为空）。 */
    get(uri: vscode.Uri): DocumentTranslations {
        return this.states.get(uri.toString())?.result ?? EMPTY;
    }

    /** 强制重新读取所有缓存。 */
    reload(): void {
        this.repository.invalidate();
        this.scheduleAll();
    }

    /** 除可见编辑器外也要计算译文的文档（例如打开了侧边译文视图的源文件）。 */
    addTarget(uri: vscode.Uri): vscode.Disposable {
        const key = uri.toString();
        this.extraTargets.add(key);
        this.schedule(uri);
        return new vscode.Disposable(() => this.extraTargets.delete(key));
    }

    /** 测试用：等到没有待处理的刷新。 */
    async idle(): Promise<void> {
        while (this.timer !== undefined || this.busy > 0) {
            await new Promise<void>(resolve => this.idleWaiters.push(resolve));
        }
    }

    schedule(uri: vscode.Uri): void {
        this.pending.add(uri.toString());
        this.arm();
    }

    scheduleAll(): void {
        for (const doc of this.targets()) this.pending.add(doc.uri.toString());
        // 不再可见的文档保留结果但不再刷新；没有目标时也要触发一次，以便清空。
        this.arm();
    }

    private arm(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const uris = this.pending;
            this.pending = new Set();
            this.busy++;
            this.running = this.running.then(() => this.refresh(uris)).catch(e => console.error('[CodeI18n]', e)).finally(() => {
                this.busy--;
                this.notifyIdle();
            });
        }, DEBOUNCE_MS);
    }

    private notifyIdle(): void {
        if (this.timer !== undefined || this.busy > 0) return;
        for (const resolve of this.idleWaiters.splice(0)) resolve();
    }

    private targets(): vscode.TextDocument[] {
        const docs = new Map<string, vscode.TextDocument>();
        for (const editor of vscode.window.visibleTextEditors) docs.set(editor.document.uri.toString(), editor.document);
        for (const doc of vscode.workspace.textDocuments) {
            if (this.extraTargets.has(doc.uri.toString())) docs.set(doc.uri.toString(), doc);
        }
        return [...docs.values()].filter(d => !d.isClosed && d.uri.scheme !== 'codei18n');
    }

    private async refresh(uris: Set<string>): Promise<void> {
        const targets = this.targets().filter(d => uris.has(d.uri.toString()));
        const errors = new Map<string, string>();
        const roots = new Set<string>();
        for (const doc of targets) {
            const result = await this.compute(doc);
            if (result === undefined) continue; // 文档在计算期间又被修改，等待下一次刷新
            if (result.root) roots.add(result.root.toString());
            if (result.root && result.error) errors.set(result.root.toString(), t.loadError(result.root.fsPath, result.error));
            else if (result.root && result.warning) errors.set(result.root.toString(), `CodeI18n: ${result.root.fsPath}: ${result.warning}`);
            this.publish(doc.uri, result);
        }
        this.report(errors, roots);
    }

    private publish(uri: vscode.Uri, result: DocumentTranslations): void {
        const state = this.state(uri);
        state.result = result;
        this.changed.fire(uri);
    }

    private state(uri: vscode.Uri): DocState {
        const key = uri.toString();
        let state = this.states.get(key);
        if (!state) {
            state = { result: EMPTY, generation: 0 };
            this.states.set(key, state);
        }
        return state;
    }

    /** 计算一个文档的译文；文档在此期间被修改时返回 undefined。 */
    private async compute(doc: vscode.TextDocument): Promise<DocumentTranslations | undefined> {
        const version = doc.version;
        const state = this.state(doc.uri);
        const generation = ++state.generation;
        const stale = () => doc.isClosed || doc.version !== version || state.generation !== generation;
        const config = vscode.workspace.getConfiguration('codei18n', doc.uri);
        if (!config.get<boolean>('enabled', true)) return { hints: [], version, reason: 'disabled' };
        const folder = outermostFolder(doc.uri);
        if (!folder) return { hints: [], version, reason: 'no-folder' };
        const root = await findRoot(doc.uri, folder);
        if (stale()) return undefined;
        if (!root) return { hints: [], version, reason: 'no-root' };
        let index: MappingIndex | undefined;
        try {
            index = await this.repository.load(root.toString(), config.get<string>('language', '') ?? '');
        } catch (e) {
            return { root, hints: [], version, error: e instanceof Error ? e.message : String(e) };
        }
        if (stale()) return undefined;
        if (!index) return { root, hints: [], version, reason: 'no-mappings' };
        const text = doc.getText();
        if (text.length > MAX_DOCUMENT_LENGTH) return { root, index, hints: [], version, reason: 'too-large' };
        const contentHash = doc.isDirty ? null : await diskHash(doc.uri, text);
        if (stale()) return undefined;
        const syntax = syntaxForFile(doc.uri.path);
        let pieces = null;
        if (syntax) {
            const parsed = await this.parsed(doc, state);
            if (stale()) return undefined;
            if (parsed) {
                parsed.update(text);
                pieces = parsed.pieces();
            }
        }
        const relativePath = doc.uri.path.substring(root.path.replace(/\/$/, '').length + 1);
        const hints = scan(index, { relativePath, contentHash, text }, pieces).map(h => h.type
            ? h
            : { ...h, type: syntax ? commentType(text.substring(h.start, h.end), syntax) : undefined });
        return { root, index, hints, version, warning: index.indexError && t.indexIgnored(index.indexError) };
    }

    private parsed(doc: vscode.TextDocument, state: DocState): Promise<ParsedDocument | undefined> {
        if (!state.parsed) {
            const syntax = syntaxForFile(doc.uri.path)!;
            const parsed: Promise<ParsedDocument | undefined> = ParsedDocument.create(this.grammars, syntax, doc.getText()).catch(e => {
                // 语法加载失败时本次只按位置匹配（文件未修改时），不报错；下次刷新再试。
                console.error('[CodeI18n] tree-sitter', e);
                if (state.parsed === parsed) state.parsed = undefined;
                return undefined;
            });
            state.parsed = parsed;
        }
        return state.parsed;
    }

    private documentChanged(e: vscode.TextDocumentChangeEvent): void {
        const key = e.document.uri.toString();
        const state = this.states.get(key);
        if (e.contentChanges.length === 0) return;
        if (!state) {
            // 还没有结果（例如 languageId 改变后重新打开）：可见时安排一次计算。
            if (this.targets().some(t => t.uri.toString() === key)) this.schedule(e.document.uri);
            return;
        }
        // 语法树增量编辑：在下一次匹配时增量重新解析。
        const changes: TextChange[] = e.contentChanges.map(c => ({
            startLine: c.range.start.line, startCharacter: c.range.start.character,
            endLine: c.range.end.line, endCharacter: c.range.end.character, text: c.text,
            offset: c.rangeOffset, length: c.rangeLength,
        }));
        void state.parsed?.then(p => p?.applyChanges(changes));
        const hints = shiftHints(state.result.hints, e.contentChanges.map(c => ({ offset: c.rangeOffset, length: c.rangeLength, text: c.text })));
        state.generation++; // 进行中的计算作废
        state.result = { ...state.result, hints, version: e.document.version };
        this.changed.fire(e.document.uri);
        this.schedule(e.document.uri);
    }

    private forget(uri: vscode.Uri): void {
        const key = uri.toString();
        const state = this.states.get(key);
        if (!state) return;
        this.states.delete(key);
        void state.parsed?.then(p => p?.dispose());
        this.changed.fire(uri);
    }

    /** 同一根目录的同一错误只提示一次；恢复后再出错会再次提示（与 IDEA 一致）。 */
    private report(errors: Map<string, string>, roots: Set<string>): void {
        for (const [root, message] of errors) {
            if (this.reported.get(root) === message) continue;
            this.reported.set(root, message);
            void vscode.window.showWarningMessage(message);
        }
        for (const root of roots) if (!errors.has(root)) this.reported.delete(root);
    }

    dispose(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        for (const state of this.states.values()) void state.parsed?.then(p => p?.dispose());
        this.states.clear();
        this.disposables.forEach(d => d.dispose());
    }
}

/**
 * 包含该文件的最外层工作区文件夹。多根工作区里文件夹可能嵌套（例如 /repo 与 /repo/packages/app），
 * 以最外层为边界，才能找到外层文件夹里的 .codei18n。
 */
function outermostFolder(file: vscode.Uri): vscode.Uri | undefined {
    const path = comparable(file.path);
    let best: vscode.Uri | undefined;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const uri = folder.uri;
        if (uri.scheme !== file.scheme || uri.authority !== file.authority) continue;
        const base = comparable(uri.path.replace(/\/$/, ''));
        if (!path.startsWith(base + '/')) continue;
        if (!best || base.length < best.path.replace(/\/$/, '').length) best = uri;
    }
    return best;
}

/** 从文件所在目录向上找最近的含 .codei18n 目录的目录，不越过工作区文件夹。 */
export async function findRoot(file: vscode.Uri, folder: vscode.Uri): Promise<vscode.Uri | undefined> {
    const base = comparable(folder.path.replace(/\/$/, ''));
    let dir = vscode.Uri.joinPath(file, '..');
    for (;;) {
        const path = comparable(dir.path);
        if (path !== base && !path.startsWith(base + '/')) return undefined;
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, '.codei18n'));
            if ((stat.type & vscode.FileType.Directory) !== 0) return dir;
        } catch {
            // 不存在
        }
        if (path === base || dir.path === '/' || /^\/[A-Za-z]:\/?$/.test(dir.path)) return undefined;
        dir = vscode.Uri.joinPath(dir, '..');
    }
}

/** Windows 上路径不区分大小写（盘符尤其常见大小写不一致）。 */
function comparable(path: string): string {
    return process.platform === 'win32' ? path.toLowerCase() : path;
}

/**
 * 磁盘原始字节的 SHA-1，仅当编辑器文本正是这些字节（UTF-8 解码后相同）时返回；否则返回 null。
 * 例如切换分支后编辑器还没重新载入，磁盘内容已不是编辑器里的文本，这时不能按位置匹配。
 */
async function diskHash(uri: vscode.Uri, text: string): Promise<string | null> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_DOCUMENT_LENGTH * 4) return null;
        const bytes = await vscode.workspace.fs.readFile(uri);
        return decoder.decode(bytes) === text ? sha1(bytes) : null;
    } catch {
        return null;
    }
}
