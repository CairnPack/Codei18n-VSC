import { createHash } from 'node:crypto';

/** 文本归一化（docs/index-format.md §6.2）与旧版 ID 归一化（core/utils/id.go），与 core、IDEA 插件行为一致。 */

const OPEN_MARKERS = ['/**', '/*!', '/*', '///', '//!', '//'];

/**
 * Unicode White_Space，与 Go 的 unicode.IsSpace 完全一致。
 * JS 的 String.prototype.trim 与 \s 的定义不同（包含 U+FEFF、不含 U+0085），不能直接使用。
 */
export function isWhiteSpace(cp: number): boolean {
    switch (cp) {
        case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: case 0x20: case 0x85: case 0xa0:
        case 0x1680: case 0x2028: case 0x2029: case 0x202f: case 0x205f: case 0x3000:
            return true;
        default:
            return cp >= 0x2000 && cp <= 0x200a;
    }
}

/** 去掉首尾 White_Space。White_Space 都在 BMP 内，按 UTF-16 码元判断即可。 */
export function trim(s: string): string {
    let start = 0;
    let end = s.length;
    while (start < end && isWhiteSpace(s.charCodeAt(start))) start++;
    while (end > start && isWhiteSpace(s.charCodeAt(end - 1))) end--;
    return s.substring(start, end);
}

/** 把连续 White_Space 压缩为一个空格，并去掉首尾空白。 */
export function collapse(s: string): string {
    let out = '';
    let space = false;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (isWhiteSpace(c)) {
            space = true;
        } else {
            if (space && out.length > 0) out += ' ';
            space = false;
            out += s[i];
        }
    }
    return out;
}

/** §6.2 版本 1：逐行去掉一个开头标记 / 开头的 `*` / 结尾的 `*\/`，再用空格连接并压缩空白。 */
export function normalize(text: string): string {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const parts: string[] = [];
    for (const raw of lines) {
        let line = trim(raw);
        let stripped = false;
        for (const marker of OPEN_MARKERS) {
            if (line.startsWith(marker)) {
                line = line.substring(marker.length);
                stripped = true;
                break;
            }
        }
        if (!stripped && line.startsWith('*') && !line.startsWith('*/')) line = line.substring(1);
        if (line.endsWith('*/')) line = line.substring(0, line.length - 2);
        parts.push(line);
    }
    return collapse(parts.join(' '));
}

/** 归一化文本的 SHA-1，小写十六进制（index.json 的 textHash）。 */
export function textHash(text: string): string {
    return sha1(normalize(text));
}

/** 字符串按 UTF-8 编码、或原始字节的 SHA-1，小写十六进制。 */
export function sha1(data: string | Uint8Array): string {
    return createHash('sha1').update(data).digest('hex');
}

/** 旧版归一化：用于注释 ID 与全局文本匹配（core/utils/id.go）。 */
export function legacy(text: string): string {
    let value = trim(text);
    if (value.startsWith('//')) value = value.substring(2);
    if (value.startsWith('/*')) value = value.substring(2);
    if (value.endsWith('*/')) value = value.substring(0, value.length - 2);
    return collapse(value);
}
