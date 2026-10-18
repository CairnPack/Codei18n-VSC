import { UNKNOWN } from './languageCodes';

/**
 * 译文文档注释的结构化视图，与具体语言插件无关：HTML/XML 标记被简化为简洁的显示文本，
 * 并标出引用、代码、标签与参数名。core 在译文中原样保留代码与标签，因此原文的文档语法同样适用于译文。
 * 移植自 IDEA 插件 DocMarkup，行为一一对应。
 */

export type Family = 'JAVADOC' | 'KDOC' | 'JSDOC' | 'DARTDOC' | 'CSHARP' | 'NONE';

/** PROSE 表示即使词法分析器会着色也必须保持普通文本的部分（如链接标签）。 */
export type Kind = 'REFERENCE' | 'CODE' | 'TAG' | 'PARAM_NAME' | 'PROSE';

export interface Span { start: number; end: number; kind: Kind }

/** `source[i]` 是显示字符 i 在原文中的偏移；合成文本为 -1。 */
export interface Result { display: string; spans: Span[]; source: number[] }

/** C# XML 文档结构的分节标签，使用显示语言。 */
interface Labels {
    param: string;
    typeParam: string;
    returns: string;
    exception: string;
    remarks: string;
    example: string;
    value: string;
    seeAlso: string;
}

function labelsOf(language: string | null | undefined, text: string): Labels {
    let code = language == null ? '' : language.toLowerCase();
    if (code === '' || code === UNKNOWN) code = guess(text);
    if (code.startsWith('zh')) {
        return { param: '参数', typeParam: '类型参数', returns: '返回', exception: '异常', remarks: '备注', example: '示例', value: '值', seeAlso: '另请参阅' };
    }
    if (code.startsWith('ja')) {
        return { param: '引数', typeParam: '型引数', returns: '戻り値', exception: '例外', remarks: '備考', example: '例', value: '値', seeAlso: '関連項目' };
    }
    if (code.startsWith('ko')) {
        return { param: '매개변수', typeParam: '형식 매개변수', returns: '반환', exception: '예외', remarks: '설명', example: '예제', value: '값', seeAlso: '참고' };
    }
    return { param: 'Parameter', typeParam: 'Type parameter', returns: 'Returns', exception: 'Throws', remarks: 'Remarks', example: 'Example', value: 'Value', seeAlso: 'See also' };
}

const HIRAGANA = /\p{Script=Hiragana}/u;
const KATAKANA = /\p{Script=Katakana}/u;
const HANGUL = /\p{Script=Hangul}/u;
const HAN = /\p{Script=Han}/u;

/** 按译文的文字猜语言：假名为 ja，谚文为 ko，仅有汉字为 zh，其余 en。 */
function guess(text: string): string {
    let han = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charAt(i);
        if (HIRAGANA.test(c) || KATAKANA.test(c)) return 'ja';
        if (HANGUL.test(c)) return 'ko';
        han = han || HAN.test(c);
    }
    return han ? 'zh' : 'en';
}

type Mode = 'NORMAL' | 'FENCE' | 'EXAMPLE' | 'RAW' | 'BRACE_CODE' | 'LINK_TARGET' | 'LINK_LABEL';
type Expect = 'NONE' | 'PARAM' | 'REFERENCE';

// Java 的 `$` 还匹配末尾行终止符之前；`\s` 仅为 [ \t\n\x0B\f\r]，与 JS 不同，故显式展开。
const EOL = '(?:\\r\\n|[\\n\\r\\u0085\\u2028\\u2029])?$';
const PREFIX = new RegExp('^(?:[ \\t]*(?:/\\*\\*+(?!/)|/\\*!?|//[/!]?|\\*(?=[ \\t]|' + EOL + '))?[ \\t]?)');
const BLOCK_TAG = new RegExp('^(?:@([A-Za-z][\\w-]*)(?=[ \\t\\n\\x0B\\f\\r\\[{:]|' + EOL + '))');
const PARAM_TOKEN = /^(?:\[[^\] \t\n\x0B\f\r]+\]|<[A-Za-z_$][\w$]*>|[A-Za-z_$][\w$.]*)/;
const REF_TOKEN = /^(?:(?:module:)?[A-Za-z_$#][\w$.#~]*(?:\([^)\n]*\))?)/;
const INLINE_TAG = /^(?:\{@([A-Za-z]+))/;
const REF_LINK = /^(?:\[(?:new )?[A-Za-z_$`][\w$.#`]*(?:\([^)\]\n]*\))?\])/;
const MARKUP_TAG = /^(?:<(\/?)([A-Za-z][A-Za-z0-9]*)((?:[ \t\n\x0B\f\r]+[^<>]*?)?)[ \t\n\x0B\f\r]*(\/?)>)/;
const ATTRIBUTE_SOURCE = '([\\w:-]+)[ \\t\\n\\x0B\\f\\r]*=[ \\t\\n\\x0B\\f\\r]*(?:"([^"]*)"|\'([^\']*)\')';
const ENTITY = /^(?:&(?:(lt|gt|amp|quot|apos|nbsp)|#(\d{1,6})|#[xX]([0-9a-fA-F]{1,6}));)/;
const CREF_PREFIX = /^[A-Z!]:/;

/** 分隔块的 HTML 标签；显示为换行（位于行首时丢弃）。 */
const HTML_BREAK = new Set(['p', 'br', 'hr', 'div', 'ul', 'ol', 'dl', 'dt', 'dd', 'table',
    'tr', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** 行内 HTML 格式标签；丢弃标签、保留内容。 */
const HTML_DROP = new Set(['b', 'i', 'em', 'strong', 'u', 's', 'small', 'big', 'sup', 'sub',
    'span', 'font', 'cite', 'dfn', 'abbr', 'img', 'center', 'thead', 'tbody', 'tfoot', 'th', 'td', 'caption']);
const HTML_CODE = new Set(['code', 'tt', 'kbd', 'samp']);

interface Hit {
    start: number;
    end: number;
    group: ArrayLike<string | undefined>;
}

/** 等价于 Java `matcher.region(start, end).lookingAt()`：区间外不可见，`$` 在区间末尾匹配。`re` 须以 `^` 锚定。 */
function lookingAt(re: RegExp, text: string, start: number, end: number): Hit | null {
    const m = re.exec(text.substring(start, end));
    if (!m) return null;
    return { start, end: start + m[0].length, group: m };
}

/** 文档语法族：优先按 PSI 语言 id，其次按文件名 / index.json 的语言 id。 */
export function family(languageId: string | null | undefined, fileName: string | null | undefined): Family {
    if (languageId != null) {
        const id = languageId.toLowerCase();
        switch (id) {
            case 'java': case 'groovy': return 'JAVADOC';
            case 'kotlin': return 'KDOC';
            case 'dart': return 'DARTDOC';
            case 'c#': case 'csharp': case 'cs': return 'CSHARP';
            default:
                if (id.includes('javascript') || id.includes('typescript') || id.includes('ecmascript')
                    || id.includes('jsx') || id === 'flow js') {
                    return 'JSDOC';
                }
        }
    }
    if (fileName == null) return 'NONE';
    const name = fileName.toLowerCase();
    const extension = name.substring(name.lastIndexOf('.') + 1);
    switch (extension) {
        case 'java': case 'groovy': return 'JAVADOC';
        case 'kt': case 'kts': return 'KDOC';
        case 'js': case 'jsx': case 'mjs': case 'cjs': case 'ts': case 'tsx': case 'mts': case 'cts': return 'JSDOC';
        case 'dart': return 'DARTDOC';
        case 'cs': return 'CSHARP';
        default: return 'NONE';
    }
}

/** 解析译文文档注释；`language` 决定 C# 分节标签（null 时按文字猜测）。 */
export function parse(family: Family, text: string, language: string | null | undefined): Result {
    if (family == null || family === 'NONE' || text.length === 0) {
        const identity: number[] = [];
        for (let i = 0; i < text.length; i++) identity.push(i);
        return { display: text, spans: [], source: identity };
    }
    return new Parser(family, text, labelsOf(language, text)).run();
}

function isSpace(c: string): boolean {
    return c === ' ' || c === '\t' || c === '\r' || c === '　';
}

/** 等价于 Java `Character.isWhitespace`（不含不换行空格 U+00A0 / U+2007 / U+202F）。 */
function isJavaWhitespace(code: number): boolean {
    return (code >= 9 && code <= 13) || (code >= 0x1c && code <= 0x20)
        || code === 0x1680 || (code >= 0x2000 && code <= 0x2006) || (code >= 0x2008 && code <= 0x200a)
        || code === 0x2028 || code === 0x2029 || code === 0x205f || code === 0x3000;
}

/** 等价于 Java `String.stripLeading`。 */
function stripLeading(s: string): string {
    let k = 0;
    while (k < s.length && isJavaWhitespace(s.charCodeAt(k))) k++;
    return s.substring(k);
}

function isUpperCase(c: string): boolean {
    return c !== c.toLowerCase() && c === c.toUpperCase();
}

function charsEqualIgnoreCase(a: string, b: string): boolean {
    if (a === b) return true;
    const ua = a.toUpperCase();
    const ub = b.toUpperCase();
    if (ua === ub) return true;
    return ua.toLowerCase() === ub.toLowerCase();
}

/** 等价于 Java `regionMatches(true, k, needle, 0, needle.length())` 的逐处查找，范围限定在 [from, end)。 */
function indexOfIgnoreCase(text: string, needle: string, from: number, end: number): number {
    for (let k = from; k + needle.length <= end; k++) {
        let match = true;
        for (let j = 0; j < needle.length; j++) {
            if (!charsEqualIgnoreCase(text.charAt(k + j), needle.charAt(j))) {
                match = false;
                break;
            }
        }
        if (match) return k;
    }
    return -1;
}

function attribute(attributes: string, name: string): string | null {
    const re = new RegExp(ATTRIBUTE_SOURCE, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(attributes)) !== null) {
        if (m[1].toLowerCase() === name.toLowerCase()) {
            return m[2] !== undefined ? m[2] : m[3];
        }
    }
    return null;
}

/** "T:System.String" → "System.String"。 */
function cref(value: string | null): string | null {
    return value == null ? null : value.replace(CREF_PREFIX, '');
}

class Parser {
    private readonly raw: string;
    private readonly family: Family;
    private readonly labels: Labels;
    private readonly markdown: boolean;
    private readonly html: boolean;
    private readonly xml: boolean;
    private readonly blockTags: boolean;
    private readonly inlineTags: boolean;
    private readonly refs: boolean;

    // 显示缓冲：每个字符一个原文偏移、种类和空行标志。
    private readonly out: string[] = [];
    private readonly source: number[] = [];
    private readonly kinds: (Kind | null)[] = [];
    private readonly ignorable: boolean[] = [];
    /** 每个显示行：该行删除过标记，若没有可见内容则整行丢弃。 */
    private readonly dirty: boolean[] = [false];
    private lineStart = 0;

    private mode: Mode = 'NORMAL';
    private closer = '';
    private fence = '';
    private preBrace = false;
    private exampleNext = false;
    private depth = 0;
    private textKind: Kind | null = null;
    private expect: Expect = 'NONE';
    private expectType = false;

    constructor(family: Family, raw: string, labels: Labels) {
        this.raw = raw;
        this.family = family;
        this.labels = labels;
        const markdownJavadoc = family === 'JAVADOC' && stripLeading(raw).startsWith('///');
        this.markdown = family === 'KDOC' || family === 'DARTDOC' || family === 'JSDOC' || markdownJavadoc;
        this.html = family === 'JAVADOC';
        this.xml = family === 'CSHARP';
        this.blockTags = family === 'JAVADOC' || family === 'KDOC' || family === 'JSDOC';
        this.inlineTags = family !== 'CSHARP';
        this.refs = family === 'KDOC' || family === 'DARTDOC' || markdownJavadoc;
    }

    run(): Result {
        const raw = this.raw;
        let pos = 0;
        while (true) {
            const newline = raw.indexOf('\n', pos);
            const lineEnd = newline < 0 ? raw.length : newline;
            const contentEnd = lineEnd > pos && raw.charAt(lineEnd - 1) === '\r' ? lineEnd - 1 : lineEnd;
            const prefix = lookingAt(PREFIX, raw, pos, contentEnd);
            const bodyStart = prefix ? prefix.end : pos;
            const bodyEnd = this.suffixStart(bodyStart, contentEnd);
            // 起始分隔符是可见内容；只有 " * " / "///" 之类的前缀可以随整行消失。
            const opener = raw.startsWith('/*', pos + this.countSpaces(pos, bodyStart));
            for (let k = pos; k < bodyStart; k++) this.emit(raw.charAt(k), k, null, !opener);
            this.line(bodyStart, bodyEnd);
            for (let k = bodyEnd; k < contentEnd; k++) this.emit(raw.charAt(k), k, null, false);
            for (let k = contentEnd; k < lineEnd; k++) this.emit(raw.charAt(k), k, null, true);
            if (newline < 0) break;
            this.emit('\n', newline, null, true);
            pos = newline + 1;
        }
        return this.finish();
    }

    private countSpaces(from: number, to: number): number {
        let n = 0;
        while (from + n < to && (this.raw.charAt(from + n) === ' ' || this.raw.charAt(from + n) === '\t')) n++;
        return n;
    }

    /** 结尾 `*` `/`（含两侧空白）的起点，没有则为 `end`。 */
    private suffixStart(start: number, end: number): number {
        const raw = this.raw;
        let j = end;
        while (j > start && isSpace(raw.charAt(j - 1))) j--;
        if (j - start < 2 || raw.charAt(j - 1) !== '/' || raw.charAt(j - 2) !== '*') return end;
        let k = j - 2;
        while (k > start && raw.charAt(k - 1) === '*') k--;
        while (k > start && isSpace(raw.charAt(k - 1))) k--;
        return k;
    }

    /** 一行注释正文（不含前后缀）。多行结构的状态跨行保留。 */
    private line(start: number, end: number): void {
        const trimmed = stripLeading(this.raw.substring(start, end));
        const lead = end - start - trimmed.length;
        this.expect = 'NONE';
        this.expectType = false;
        if (this.mode === 'FENCE') {
            this.copy(start, end, 'CODE');
            if (trimmed.startsWith(this.fence)) this.mode = 'NORMAL';
            return;
        }
        if (this.mode === 'EXAMPLE') {
            if (!lookingAt(BLOCK_TAG, trimmed, 0, trimmed.length)) {
                this.copy(start, end, 'CODE');
                return;
            }
            this.mode = 'NORMAL';
        }
        let i = start;
        if (this.mode === 'NORMAL' && this.markdown && (trimmed.startsWith('```') || trimmed.startsWith('~~~'))) {
            this.fence = trimmed.substring(0, 3);
            this.mode = 'FENCE';
            this.copy(start, end, 'CODE');
            return;
        }
        if (this.mode === 'NORMAL' && this.blockTags) {
            const tag = lookingAt(BLOCK_TAG, this.raw, start + lead, end);
            if (tag) {
                this.copy(start, start + lead, null);
                this.copy(tag.start, tag.end, 'TAG');
                i = tag.end;
                this.blockTag((tag.group[1] as string).toLowerCase());
            }
        }
        if (this.exampleNext) {
            this.exampleNext = false;
            this.copy(i, end, 'CODE'); // JSDoc @example：代码可紧跟在标签之后
            this.mode = 'EXAMPLE';
            return;
        }
        this.inline(i, end);
    }

    private blockTag(name: string): void {
        const js = this.family === 'JSDOC';
        switch (name) {
            case 'param': case 'property': case 'prop': case 'arg': case 'argument':
            case 'typeparam': case 'tparam': case 'template':
                this.expectType = js;
                this.expect = 'PARAM';
                break;
            case 'throws': case 'exception': case 'returns': case 'return': case 'type':
            case 'yields': case 'enum': case 'typedef':
                this.expectType = js;
                this.expect = js ? 'NONE' : name.startsWith('return') ? 'NONE' : 'REFERENCE';
                break;
            case 'see': case 'sample': case 'extends': case 'augments': case 'implements':
                this.expectType = js;
                this.expect = 'REFERENCE';
                break;
            case 'example':
                this.exampleNext = js;
                break;
            default:
                break;
        }
    }

    private inline(start: number, end: number): void {
        const raw = this.raw;
        let i = start;
        while (i < end) {
            switch (this.mode) {
                case 'RAW': i = this.rawCode(i, end); continue;
                case 'BRACE_CODE': i = this.braceCode(i, end); continue;
                case 'LINK_TARGET': i = this.linkTarget(i, end); continue;
                case 'LINK_LABEL': i = this.linkLabel(i, end); continue;
                default: break;
            }
            const c = raw.charAt(i);
            if (isSpace(c)) {
                this.copy(i, i + 1, this.textKind);
                i++;
                continue;
            }
            if (this.expectType && c === '{' && (i + 1 >= end || raw.charAt(i + 1) !== '@')) {
                const close = this.matchingBrace(i, end);
                if (close > i) {
                    this.copy(i, close + 1, 'REFERENCE');
                    i = close + 1;
                    this.expectType = false;
                    continue;
                }
            }
            this.expectType = false;
            if (this.expect !== 'NONE') {
                const expected = this.expect;
                this.expect = 'NONE';
                const token = lookingAt(expected === 'PARAM' ? PARAM_TOKEN : REF_TOKEN, raw, i, end);
                if (token && token.end > i) {
                    this.copy(i, token.end, expected === 'PARAM' ? 'PARAM_NAME' : 'REFERENCE');
                    i = token.end;
                    continue;
                }
            }
            let next = i;
            if (c === '`' && this.markdown) next = this.inlineCode(i, end);
            else if (c === '{' && this.inlineTags) next = this.inlineTag(i, end);
            else if (c === '[' && this.refs) next = this.reference(i, end);
            else if (c === '<' && (this.html || this.xml)) next = this.xml ? this.xmlTag(i, end) : this.htmlTag(i, end);
            else if (c === '&' && (this.html || this.xml)) next = this.entity(i, end, this.textKind);
            if (next > i) {
                i = next;
                continue;
            }
            this.copy(i, i + 1, this.textKind);
            i++;
        }
    }

    private matchingBrace(open: number, end: number): number {
        let level = 0;
        for (let k = open; k < end; k++) {
            const c = this.raw.charAt(k);
            if (c === '{') level++;
            else if (c === '}' && --level === 0) return k;
        }
        return -1;
    }

    /** Markdown 行内代码：一串反引号，由同一行内等长的反引号串闭合。 */
    private inlineCode(i: number, end: number): number {
        let run = 0;
        while (i + run < end && this.raw.charAt(i + run) === '`') run++;
        const close = this.raw.indexOf('`'.repeat(run), i + run);
        if (close < 0 || close + run > end) return i;
        this.copy(i, close + run, 'CODE');
        return close + run;
    }

    private inlineTag(i: number, end: number): number {
        const tag = lookingAt(INLINE_TAG, this.raw, i, end);
        if (!tag) return i;
        this.copy(i, tag.end, 'TAG');
        switch ((tag.group[1] as string).toLowerCase()) {
            case 'code': case 'literal':
                this.depth = 1;
                this.mode = 'BRACE_CODE';
                break;
            case 'link': case 'linkplain': case 'linkcode': case 'value': case 'see':
                this.mode = 'LINK_TARGET';
                break;
            default:
                this.mode = 'LINK_LABEL';
                break;
        }
        let k = tag.end;
        if (this.mode === 'BRACE_CODE' && k < end && this.raw.charAt(k) === ' ') {
            this.copy(k, k + 1, null);
            k++;
        }
        return k;
    }

    /** `{@code ...}` 的正文：原样保留到配平的右花括号，可跨多行。 */
    private braceCode(i: number, end: number): number {
        for (let k = i; k < end; k++) {
            const c = this.raw.charAt(k);
            if (c === '{') this.depth++;
            else if (c === '}' && --this.depth === 0) {
                this.copy(i, k, 'CODE');
                this.copy(k, k + 1, 'TAG');
                this.mode = 'NORMAL';
                return k + 1;
            }
        }
        this.copy(i, end, 'CODE');
        return end;
    }

    private linkTarget(i: number, end: number): number {
        let k = i;
        while (k < end && isSpace(this.raw.charAt(k))) k++;
        this.copy(i, k, null);
        if (k >= end) return end;
        if (this.raw.charAt(k) === '}') return this.closeTag(k);
        let parens = 0;
        const start = k;
        for (; k < end; k++) {
            const c = this.raw.charAt(k);
            if (c === '(') parens++;
            else if (c === ')') parens--;
            else if (c === '}' || c === '|' || (isSpace(c) && parens <= 0)) break;
        }
        this.copy(start, k, 'REFERENCE');
        this.mode = 'LINK_LABEL';
        return k;
    }

    private linkLabel(i: number, end: number): number {
        for (let k = i; k < end; k++) {
            const c = this.raw.charAt(k);
            if (c === '|') {
                this.copy(i, k, 'PROSE');
                this.copy(k, k + 1, 'TAG');
                return k + 1;
            }
            if (c === '}') {
                this.copy(i, k, 'PROSE');
                return this.closeTag(k);
            }
        }
        this.copy(i, end, 'PROSE');
        return end;
    }

    private closeTag(k: number): number {
        this.copy(k, k + 1, 'TAG');
        this.mode = 'NORMAL';
        return k + 1;
    }

    /** KDoc / Dartdoc / Markdown 版 Javadoc 的 `[ref]`；Markdown 链接 `[text](url)` 仍为普通文本。 */
    private reference(i: number, end: number): number {
        const ref = lookingAt(REF_LINK, this.raw, i, end);
        if (!ref || (ref.end < end && this.raw.charAt(ref.end) === '(')) return i;
        this.copy(i, ref.end, 'REFERENCE');
        return ref.end;
    }

    private htmlTag(i: number, end: number): number {
        const tag = lookingAt(MARKUP_TAG, this.raw, i, end);
        if (!tag) return i;
        const original = tag.group[2] as string;
        // Box<U>、Foo<I>：单个大写字母是类型参数而非 <u>/<i>（旧式 <P> 仍是 HTML）。
        if (original.length === 1 && isUpperCase(original.charAt(0)) && original.charAt(0) !== 'P') return i;
        const name = original.toLowerCase();
        const closing = (tag.group[1] as string).length > 0;
        const selfClosing = (tag.group[4] as string).length > 0;
        const next = tag.end;
        if (HTML_BREAK.has(name)) {
            return this.lineBreak(next, end);
        } else if (HTML_DROP.has(name)) {
            this.drop();
        } else if (HTML_CODE.has(name) || name === 'pre') {
            this.drop();
            if (closing || selfClosing) return next;
            this.startRaw('</' + name + '>');
            if (name === 'pre') {
                const brace = lookingAt(INLINE_TAG, this.raw, this.skipSpaces(next, end), end);
                if (brace && brace.group[1] === 'code') {
                    this.preBrace = true;
                    return brace.end;
                }
            }
        } else if (name === 'a') {
            this.drop();
            this.textKind = closing ? null : 'REFERENCE';
        } else if (name === 'li') {
            if (!closing) this.bullet();
            else this.drop();
        } else {
            return i;
        }
        return next;
    }

    private xmlTag(i: number, end: number): number {
        const tag = lookingAt(MARKUP_TAG, this.raw, i, end);
        if (!tag) return i;
        const name = (tag.group[2] as string).toLowerCase();
        const closing = (tag.group[1] as string).length > 0;
        const selfClosing = (tag.group[4] as string).length > 0;
        const attributes = tag.group[3] as string;
        const next = tag.end;
        switch (name) {
            case 'summary': case 'list': case 'listheader': case 'term': case 'description': case 'permission':
                this.drop();
                break;
            case 'para': case 'br':
                return this.lineBreak(next, end);
            case 'item':
                if (closing) this.drop();
                else this.bullet();
                break;
            case 'c': case 'code':
                this.drop();
                if (!closing && !selfClosing) this.startRaw('</' + (tag.group[2] as string) + '>');
                break;
            case 'param': case 'typeparam':
                if (closing) this.drop();
                else {
                    return this.label(name === 'param' ? this.labels.param : this.labels.typeParam,
                        attribute(attributes, 'name'), 'PARAM_NAME', next, end);
                }
                break;
            case 'returns': case 'value': case 'remarks': case 'example':
                if (closing) this.drop();
                else {
                    let text: string;
                    switch (name) {
                        case 'returns': text = this.labels.returns; break;
                        case 'value': text = this.labels.value; break;
                        case 'remarks': text = this.labels.remarks; break;
                        default: text = this.labels.example; break;
                    }
                    return this.label(text, null, null, next, end);
                }
                break;
            case 'exception':
                if (closing) this.drop();
                else return this.label(this.labels.exception, cref(attribute(attributes, 'cref')), 'REFERENCE', next, end);
                break;
            case 'seealso':
                if (closing) {
                    this.drop();
                    this.textKind = null;
                } else {
                    let target = cref(attribute(attributes, 'cref'));
                    if (target == null) target = attribute(attributes, 'href');
                    const after = this.label(this.labels.seeAlso, null, null, next, end);
                    if (selfClosing) {
                        if (target != null) this.insert(target, 'REFERENCE');
                    } else {
                        this.textKind = 'REFERENCE';
                    }
                    return after;
                }
                break;
            case 'see':
                if (closing) {
                    this.drop();
                    this.textKind = null;
                } else if (selfClosing) {
                    const word = attribute(attributes, 'langword');
                    if (word != null) {
                        this.insert(word, 'CODE');
                    } else {
                        let target = cref(attribute(attributes, 'cref'));
                        if (target == null) target = attribute(attributes, 'href');
                        if (target != null) this.insert(target, 'REFERENCE');
                        else this.drop();
                    }
                } else {
                    this.drop();
                    this.textKind = 'REFERENCE';
                }
                break;
            case 'paramref': case 'typeparamref': {
                const target = attribute(attributes, 'name');
                if (target != null) this.insert(target, 'REFERENCE');
                else this.drop();
                break;
            }
            case 'inheritdoc': case 'include':
                this.copy(i, next, 'TAG');
                break;
            default:
                return i;
        }
        return next;
    }

    /** 让 C# 分节独占一行："参数 a: …" / "返回: …"。 */
    private label(text: string, value: string | null, valueKind: Kind | null, next: number, end: number): number {
        if (this.hasContent()) this.newline();
        else this.drop();
        this.insert(text, 'TAG');
        if (value != null) {
            this.insert(' ', null);
            this.insert(value, valueKind);
        }
        this.insert(':', 'TAG');
        this.insert(' ', null);
        return this.skipSpaces(next, end);
    }

    private lineBreak(next: number, end: number): number {
        if (this.hasContent()) {
            this.newline();
            return this.skipSpaces(next, end);
        }
        this.drop();
        return next;
    }

    private bullet(): void {
        if (this.hasContent()) this.newline();
        else this.drop();
        this.insert('• ', null);
    }

    private skipSpaces(k: number, end: number): number {
        while (k < end && isSpace(this.raw.charAt(k))) k++;
        return k;
    }

    private startRaw(closingTag: string): void {
        this.closer = closingTag;
        this.mode = 'RAW';
    }

    /** `<code>`、`<pre>`、`<c>` 的内容：原样保留（解码实体）直到闭合标签。 */
    private rawCode(i: number, end: number): number {
        const raw = this.raw;
        const close = indexOfIgnoreCase(raw, this.closer, i, end);
        const stop = close < 0 ? end : close;
        let codeEnd = stop;
        if (close >= 0 && this.preBrace) {
            let k = stop;
            while (k > i && isSpace(raw.charAt(k - 1))) k--;
            if (k > i && raw.charAt(k - 1) === '}') codeEnd = k - 1; // <pre>{@code ...}</pre>
        }
        for (let k = i; k < codeEnd;) {
            const decoded = raw.charAt(k) === '&' ? this.entity(k, codeEnd, 'CODE') : k;
            if (decoded > k) {
                k = decoded;
            } else {
                this.copy(k, k + 1, 'CODE');
                k++;
            }
        }
        if (codeEnd < stop) this.copy(codeEnd + 1, stop, null);
        if (close < 0) return end;
        this.drop();
        this.mode = 'NORMAL';
        this.preBrace = false;
        return close + this.closer.length;
    }

    private entity(i: number, end: number, kind: Kind | null): number {
        const entity = lookingAt(ENTITY, this.raw, i, end);
        if (!entity) return i;
        let cp: number;
        if (entity.group[1] !== undefined) {
            switch (entity.group[1]) {
                case 'lt': cp = 0x3c; break;
                case 'gt': cp = 0x3e; break;
                case 'amp': cp = 0x26; break;
                case 'quot': cp = 0x22; break;
                case 'apos': cp = 0x27; break;
                default: cp = 0x20; break;
            }
        } else {
            cp = entity.group[2] !== undefined
                ? parseInt(entity.group[2], 10)
                : parseInt(entity.group[3] as string, 16);
            if (!(cp >= 0 && cp <= 0x10ffff) || cp === 0) return i;
        }
        this.insert(String.fromCodePoint(cp), kind);
        return entity.end;
    }

    // ---- 显示缓冲 ----

    private emit(c: string, src: number, kind: Kind | null, blank: boolean): void {
        this.source.push(src);
        this.kinds.push(kind);
        this.ignorable.push(blank);
        this.out.push(c);
        if (c === '\n') {
            this.dirty.push(false);
            this.lineStart = this.out.length;
        }
    }

    private copy(from: number, to: number, kind: Kind | null): void {
        for (let k = from; k < to; k++) this.emit(this.raw.charAt(k), k, kind, false);
    }

    private insert(text: string, kind: Kind | null): void {
        for (let k = 0; k < text.length; k++) this.emit(text.charAt(k), -1, kind, false);
    }

    private newline(): void {
        this.emit('\n', -1, null, true);
        this.drop();
    }

    private drop(): void {
        this.dirty[this.dirty.length - 1] = true;
    }

    private hasContent(): boolean {
        for (let k = this.lineStart; k < this.out.length; k++) {
            if (!this.ignorable[k] && !isSpace(this.out[k])) return true;
        }
        return false;
    }

    /** 丢弃因删除标记而空白的行，再把逐字符的种类转换为区间。 */
    private finish(): Result {
        const out = this.out;
        const display: string[] = [];
        const src: number[] = [];
        const kind: (Kind | null)[] = [];
        let n = 0;
        let line = 0;
        for (let start = 0; start <= out.length; line++) {
            const newline = out.indexOf('\n', start);
            const end = newline < 0 ? out.length : newline;
            let blank = this.dirty[line];
            for (let k = start; blank && k < end; k++) blank = this.ignorable[k] || isSpace(out[k]);
            if (!blank) {
                const stop = newline < 0 ? end : end + 1;
                for (let k = start; k < stop; k++) {
                    display.push(out[k]);
                    src[n] = this.source[k];
                    kind[n++] = this.kinds[k];
                }
            } else if (newline < 0 && n > 0 && display[n - 1] === '\n') {
                // 最后一行消失了：去掉通向它的换行（及 CR）。
                let cut = n - 1;
                if (cut > 0 && display[cut - 1] === '\r') cut--;
                display.length = cut;
                n = cut;
            }
            if (newline < 0) break;
            start = newline + 1;
        }
        const spans: Span[] = [];
        for (let k = 0; k < n;) {
            let j = k;
            while (j < n && kind[j] === kind[k]) j++;
            const kk = kind[k];
            if (kk !== null) spans.push({ start: k, end: j, kind: kk });
            k = j;
        }
        return { display: display.join(''), spans, source: src.slice(0, n) };
    }
}
