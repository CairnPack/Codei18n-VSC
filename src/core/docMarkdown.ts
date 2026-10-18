import { PREFIX, SUFFIX, TRAILING_OPENER } from './display';
import { Family, Kind, parse } from './docMarkup';

/**
 * 把译文渲染成悬停用的 Markdown。文档注释先用 DocMarkup 按语言解析（Javadoc、KDoc、JSDoc、Dartdoc、C# XML），
 * 代码与引用渲染为行内代码或代码块；其余文字全部转义，不会被当作 Markdown 误解析。
 */
export function toMarkdown(translation: string, doc: boolean, family: Family, language: string): string {
    // 与 IDEA 一样把带注释语法的译文交给 DocMarkup，再逐行去掉不属于代码的注释前缀与 `*\/`。
    const text = translation.replace(/\r\n?/g, '\n');
    const markup = doc && family !== 'NONE'
        ? parse(family, text, language)
        : { display: text, spans: [] as { start: number; end: number; kind: Kind }[] };
    const kinds: (Kind | null)[] = new Array(markup.display.length).fill(null);
    for (const s of markup.spans) kinds.fill(s.kind, s.start, s.end);

    let lines: { text: string; kinds: (Kind | null)[] }[] = [];
    let offset = 0;
    for (const raw of markup.display.split('\n')) {
        let line = raw;
        let lineKinds = kinds.slice(offset, offset + raw.length);
        offset += raw.length + 1;
        const prefix = PREFIX.exec(line)![0].length;
        if (lineKinds.slice(0, prefix).every(k => k !== 'CODE')) {
            line = line.substring(prefix);
            lineKinds = lineKinds.slice(prefix);
        }
        const suffix = SUFFIX.exec(line) ?? TRAILING_OPENER.exec(line);
        if (suffix && lineKinds.slice(suffix.index).every(k => k !== 'CODE')) {
            line = line.substring(0, suffix.index);
            lineKinds = lineKinds.slice(0, suffix.index);
        }
        if (line.trim() === '*/') line = '';
        lines.push({ text: line, kinds: lineKinds });
    }
    while (lines.length > 0 && lines[0].text.trim() === '') lines = lines.slice(1);
    while (lines.length > 0 && lines[lines.length - 1].text.trim() === '') lines = lines.slice(0, -1);

    // 段落块：普通文字行、空行、代码块。普通行之间用硬换行，其余之间空一行。
    const chunks: { kind: 'text' | 'blank' | 'block'; text: string }[] = [];
    // 译文自带的 ``` / ~~~ 代码块：只接受合法的开头行，输出时由这里重新生成足够长的围栏，
    // 译文里的围栏写法不会把后面的文字（或底部信息）吞进代码块，也不会让代码块提前结束。
    let fence: { char: string; length: number; info: string } | undefined;
    let fenced: string[] = [];
    let block: string[] = []; // 整行都是代码（JSDoc @example、跨行 {@code}）的连续行
    const flushBlock = () => {
        if (block.length === 0) return;
        chunks.push({ kind: 'block', text: codeBlock(dedent(block), '') });
        block = [];
    };
    const flushFence = () => {
        chunks.push({ kind: 'block', text: codeBlock(fenced, fence!.info) });
        fence = undefined;
        fenced = [];
    };

    for (const line of lines) {
        const trimmed = line.text.trim();
        const allCode = trimmed !== '' && [...line.text].every((c, i) => line.kinds[i] === 'CODE' || c.trim() === '');
        if (fence !== undefined) {
            const close = /^(`+|~+)\s*$/.exec(trimmed);
            if (close && close[1][0] === fence.char && close[1].length >= fence.length) flushFence();
            else fenced.push(line.text);
            continue;
        }
        const open = allCode ? /^(`{3,}|~{3,})([^`]*)$/.exec(trimmed) : null;
        if (open) {
            flushBlock();
            fence = { char: open[1][0], length: open[1].length, info: open[2].trim() };
            continue;
        }
        if (allCode && !isInlineCode(trimmed)) {
            block.push(line.text);
            continue;
        }
        flushBlock();
        chunks.push(trimmed === '' ? { kind: 'blank', text: '' } : { kind: 'text', text: renderLine(line.text, line.kinds) });
    }
    flushBlock();
    if (fence !== undefined) flushFence();

    let markdown = '';
    let prev: string | undefined;
    for (const chunk of chunks) {
        if (chunk.kind === 'blank') {
            prev = 'blank';
            continue;
        }
        if (prev !== undefined) markdown += prev === 'text' && chunk.kind === 'text' ? '  \n' : '\n\n';
        markdown += chunk.text;
        prev = chunk.kind;
    }
    return markdown;
}

/** 转义 Markdown 中有特殊含义的 ASCII 标点。 */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, '\\$&');
}

/** 行内代码：反引号围栏比内容中最长的反引号串多一个。 */
export function inlineCode(text: string): string {
    const ticks = '`'.repeat(longestRun(text, '`') + 1);
    const pad = text.startsWith('`') || text.endsWith('`') || (text.startsWith(' ') && text.endsWith(' ')) ? ' ' : '';
    return `${ticks}${pad}${text}${pad}${ticks}`;
}

function renderLine(text: string, kinds: (Kind | null)[]): string {
    let out = '';
    const start = text.length - text.trimStart().length;
    let dropped = false;
    for (let i = start; i < text.length;) {
        let j = i;
        while (j < text.length && kinds[j] === kinds[i]) j++;
        let run = text.substring(i, j);
        // 去掉的行内标签（{@link 等）后面的空白一起去掉，避免出现双空格。
        if (dropped && kinds[i] === null) run = run.replace(/^[ \t]+/, '');
        const rendered = renderRun(run, kinds[i]);
        dropped = kinds[i] === 'TAG' && rendered === '';
        out += rendered;
        i = j;
    }
    return out.trimEnd();
}

function renderRun(text: string, kind: Kind | null): string {
    switch (kind) {
        case 'CODE':
            // 一律重新包成行内代码：Markdown 行内代码（`x`）先去掉外层反引号。不原样输出，
            // 否则 {@code `a` <img …> `b`} 这类内容会把中间的 HTML / Markdown 漏出代码样式。
            return codeWithSpaces(stripInlineTicks(text));
        case 'REFERENCE': {
            const inner = /^\[[^\]]+]$/.test(text) ? text.substring(1, text.length - 1) : text; // KDoc/Dartdoc 的 [ref]
            return codeWithSpaces(inner);
        }
        case 'PARAM_NAME':
            return codeWithSpaces(text);
        case 'TAG':
            // 行内标签的定界符（{@link、{@code、}、|）不显示；块标签（@param）与 C# 段落标签加粗。
            if (/^\{@/.test(text) || /^[}|]+$/.test(text.trim())) return '';
            return text.trim() === '' ? text : text.replace(/\S(?:.*\S)?/, m => `**${escapeMarkdown(m)}**`);
        default:
            return escapeMarkdown(text);
    }
}

/** 包成行内代码，保留两侧的空格（在代码样式之外）。 */
function codeWithSpaces(text: string): string {
    const core = text.trim();
    if (core === '') return text;
    const lead = text.substring(0, text.indexOf(core));
    const trail = text.substring(text.indexOf(core) + core.length);
    return lead + inlineCode(core) + trail;
}

/** `x` / ``x`` → x（只去掉首尾成对、且中间不再出现同样长度反引号串的外层）。 */
function stripInlineTicks(text: string): string {
    const core = text.trim();
    const m = /^(`+)([\s\S]*?[^`])\1$/.exec(core);
    if (!m || m[2].includes(m[1])) return text;
    const inner = m[2].length > 1 && m[2].startsWith(' ') && m[2].endsWith(' ') ? m[2].slice(1, -1) : m[2];
    return text.replace(core, inner);
}

/** 代码块：围栏用比内容中最长反引号串更长的反引号；信息串只保留安全字符。 */
function codeBlock(lines: string[], info: string): string {
    const body = lines.join('\n');
    const ticks = '`'.repeat(Math.max(3, longestRun(body, '`') + 1));
    const lang = /^[\w+#.-]+/.exec(info)?.[0] ?? '';
    return `${ticks}${lang}\n${body}\n${ticks}`;
}

function isInlineCode(text: string): boolean {
    const m = /^(`+)[\s\S]*[^`]\1$/.exec(text) ?? /^(`+)[^`]\1$/.exec(text);
    return m !== null;
}

function longestRun(text: string, ch: string): number {
    let best = 0;
    let run = 0;
    for (const c of text) {
        run = c === ch ? run + 1 : 0;
        best = Math.max(best, run);
    }
    return best;
}

function dedent(lines: string[]): string[] {
    const indent = Math.min(...lines.filter(l => l.trim() !== '').map(l => l.length - l.trimStart().length));
    return lines.map(l => l.substring(Math.min(indent, l.length - l.trimStart().length)));
}
