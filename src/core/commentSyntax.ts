import { marker } from './commentGroups';

/** 扩展支持 tree-sitter 提取的语法（与 grammars/tree-sitter-<name>.wasm 对应）。 */
export type GrammarName = 'java' | 'kotlin' | 'c_sharp' | 'javascript' | 'typescript' | 'tsx' | 'dart';

export interface LanguageSyntax {
    readonly grammar: GrammarName;
    /** 物理注释的语法节点类型，与 core 各 adapter 的 query 相同。 */
    readonly commentNodes: readonly string[];
    /** 该语言视为文档注释的行注释标记（docs/index-format.md §6.3）。 */
    readonly docLineMarkers: readonly string[];
    /** 该语言视为文档注释的块注释前缀；`/**\/` 永远不是文档注释。 */
    readonly docBlockPrefixes: readonly string[];
}

const JAVA: LanguageSyntax = { grammar: 'java', commentNodes: ['line_comment', 'block_comment'], docLineMarkers: [], docBlockPrefixes: ['/**'] };
const KOTLIN: LanguageSyntax = { grammar: 'kotlin', commentNodes: ['line_comment', 'multiline_comment'], docLineMarkers: [], docBlockPrefixes: ['/**'] };
const CSHARP: LanguageSyntax = { grammar: 'c_sharp', commentNodes: ['comment'], docLineMarkers: ['///'], docBlockPrefixes: ['/**'] };
// TS/JS 的 `///` 三斜线指令不是文档注释。
const JAVASCRIPT: LanguageSyntax = { grammar: 'javascript', commentNodes: ['comment'], docLineMarkers: [], docBlockPrefixes: ['/**'] };
const TYPESCRIPT: LanguageSyntax = { ...JAVASCRIPT, grammar: 'typescript' };
const TSX: LanguageSyntax = { ...JAVASCRIPT, grammar: 'tsx' };
// Dart 语法把 `////`、`/**\/` 也归为 documentation_comment，类型一律按原文判定。
const DART: LanguageSyntax = { grammar: 'dart', commentNodes: ['comment', 'documentation_comment'], docLineMarkers: ['///'], docBlockPrefixes: ['/**'] };

/** 扩展名 → 语法，与 core 的 adapters/registry.go 一致（.jsx 用 javascript 语法）。 */
const BY_EXTENSION: Record<string, LanguageSyntax> = {
    '.java': JAVA,
    '.kt': KOTLIN, '.kts': KOTLIN,
    '.cs': CSHARP,
    '.js': JAVASCRIPT, '.mjs': JAVASCRIPT, '.cjs': JAVASCRIPT, '.jsx': JAVASCRIPT,
    '.ts': TYPESCRIPT, '.mts': TYPESCRIPT, '.cts': TYPESCRIPT,
    '.tsx': TSX,
    '.dart': DART,
};

/** 按文件名的扩展名选语法（不依赖编辑器的 languageId）；没有语法时返回 undefined。 */
export function syntaxForFile(fileName: string): LanguageSyntax | undefined {
    const slash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
    const base = fileName.substring(slash + 1);
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const ext = base.substring(dot).toLowerCase();
    return Object.prototype.hasOwnProperty.call(BY_EXTENSION, ext) ? BY_EXTENSION[ext] : undefined;
}

/** 注释记录的类型（line/block/doc），与 core commentgroup.commentType 相同。`text` 是第一条物理注释的原文。 */
export function commentType(text: string, syntax: LanguageSyntax): 'line' | 'block' | 'doc' {
    const mark = marker(text);
    if (mark !== '') return syntax.docLineMarkers.includes(mark) ? 'doc' : 'line';
    if (text.startsWith('/**/')) return 'block';
    return syntax.docBlockPrefixes.some(p => text.startsWith(p)) ? 'doc' : 'block';
}
