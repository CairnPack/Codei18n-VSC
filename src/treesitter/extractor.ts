import { Language, Node, Parser, Point, Tree } from 'web-tree-sitter';
import { lineStarts, line as lineOf, Piece } from '../core/commentGroups';
import { GrammarName, LanguageSyntax } from '../core/commentSyntax';

/**
 * 懒加载 web-tree-sitter 运行时与各语言的 wasm 语法。`runtimeWasm` 是 web-tree-sitter.wasm 的路径，
 * `grammarPath(name)` 返回 tree-sitter-<name>.wasm 的路径（扩展里由 context.extensionUri 定位）。
 */
export class Grammars {
    private init: Promise<void> | undefined;
    private readonly languages = new Map<GrammarName, Promise<Language>>();

    constructor(private readonly runtimeWasm: string, private readonly grammarPath: (name: GrammarName) => string) {}

    language(name: GrammarName): Promise<Language> {
        let language = this.languages.get(name);
        if (!language) {
            language = this.ready().then(() => Language.load(this.grammarPath(name)));
            // 加载失败时不缓存，下次重试。
            language.catch(() => this.languages.delete(name));
            this.languages.set(name, language);
        }
        return language;
    }

    private ready(): Promise<void> {
        if (!this.init) {
            this.init = Parser.init({ locateFile: () => this.runtimeWasm });
            this.init.catch(() => { this.init = undefined; });
        }
        return this.init;
    }
}

/** 一次文本修改：修改前文本中 [line, character] 起长度为 `length` 的区间替换为 `text`（与 VS Code 的 contentChanges 相同）。 */
export interface TextChange {
    readonly startLine: number;
    readonly startCharacter: number;
    readonly endLine: number;
    readonly endCharacter: number;
    readonly text: string;
}

/**
 * 一个打开文档的语法树。修改时用 tree.edit 增量重新解析；只解析打开的文档。
 * 坐标全部是 UTF-16 码元（web-tree-sitter 对 JS 字符串按 UTF-16 解析）。
 */
export class ParsedDocument {
    private tree: Tree | null;
    private disposed = false;

    private constructor(private readonly parser: Parser, private readonly syntax: LanguageSyntax, private text: string) {
        this.tree = parser.parse(text);
    }

    static async create(grammars: Grammars, syntax: LanguageSyntax, text: string): Promise<ParsedDocument> {
        // language() 先完成运行时初始化，之后才能构造 Parser。
        const language = await grammars.language(syntax.grammar);
        const parser = new Parser();
        try {
            parser.setLanguage(language);
            return new ParsedDocument(parser, syntax, text);
        } catch (e) {
            parser.delete();
            throw e;
        }
    }

    get language(): GrammarName {
        return this.syntax.grammar;
    }

    /**
     * 更新到 `newText`。`changes` 按 VS Code 的顺序依次作用于旧文本；依次应用后与 `newText` 不一致
     * （或没有提供 changes）时整篇重新解析。
     */
    update(newText: string, changes?: readonly TextChange[]): void {
        if (this.disposed) return;
        if (newText === this.text) return;
        let incremental = changes !== undefined && changes.length > 0 && this.tree !== null;
        if (incremental) {
            let running = this.text;
            for (const change of changes!) {
                const starts = lineStarts(running);
                const startIndex = offset(starts, running, change.startLine, change.startCharacter);
                const oldEndIndex = offset(starts, running, change.endLine, change.endCharacter);
                if (startIndex < 0 || oldEndIndex < startIndex) {
                    incremental = false;
                    break;
                }
                const newEndIndex = startIndex + change.text.length;
                this.tree!.edit({
                    startIndex, oldEndIndex, newEndIndex,
                    startPosition: { row: change.startLine, column: change.startCharacter },
                    oldEndPosition: { row: change.endLine, column: change.endCharacter },
                    newEndPosition: endPoint(change.startLine, change.startCharacter, change.text),
                });
                running = running.substring(0, startIndex) + change.text + running.substring(oldEndIndex);
            }
            if (running !== newText) incremental = false;
        }
        const old = this.tree;
        this.tree = this.parser.parse(newText, incremental ? old : null);
        old?.delete();
        this.text = newText;
    }

    /**
     * 物理注释，按起始位置排序：捕获语言的注释节点（与 core adapter 的 query 相同），
     * 行注释去掉末尾的 \r/\n（core commentgroup.TrimLineEnd）。
     */
    pieces(): Piece[] {
        if (!this.tree) return [];
        const nodes = this.syntax.commentNodes;
        const out: Piece[] = [];
        const cursor = this.tree.walk();
        try {
            let descend = true;
            for (;;) {
                if (descend && nodes.includes(cursor.nodeType)) {
                    const start = cursor.startIndex;
                    let end = cursor.endIndex;
                    if (this.text.startsWith('//', start)) {
                        while (end > start && (this.text.charCodeAt(end - 1) === 10 || this.text.charCodeAt(end - 1) === 13)) end--;
                    }
                    out.push({ start, end });
                }
                if (descend && cursor.gotoFirstChild()) continue;
                if (cursor.gotoNextSibling()) {
                    descend = true;
                    continue;
                }
                if (!cursor.gotoParent()) break;
                descend = false;
            }
        } finally {
            cursor.delete();
        }
        out.sort((a, b) => a.start - b.start || a.end - b.end);
        return out;
    }

    /** 调试用：根节点。 */
    get rootNode(): Node | undefined {
        return this.tree?.rootNode;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.tree?.delete();
        this.tree = null;
        this.parser.delete();
    }
}

function offset(starts: readonly number[], text: string, line: number, character: number): number {
    if (line < 0 || line >= starts.length) return -1;
    const lineEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
    const value = starts[line] + character;
    return character >= 0 && value <= lineEnd ? value : -1;
}

function endPoint(row: number, column: number, inserted: string): Point {
    const starts = lineStarts(inserted);
    if (starts.length === 1) return { row, column: column + inserted.length };
    const last = lineOf(starts, inserted.length);
    return { row: row + last, column: inserted.length - starts[last] };
}
