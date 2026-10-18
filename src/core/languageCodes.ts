import { trim } from './commentText';

/** BCP 47 规范化与等价判断，与 core/langcode、IDEA 插件 LanguageCodes 一致（docs/index-format.md §8）。 */

export const UNKNOWN = 'unknown';

const ALIASES: Record<string, string> = {
    zho: 'zh', chi: 'zh', cmn: 'zh',
    eng: 'en', jpn: 'ja', kor: 'ko',
    deu: 'de', ger: 'de', fra: 'fr', fre: 'fr',
    spa: 'es', rus: 'ru',
    iw: 'he', in: 'id', ji: 'yi',
};

/** 中文为 zh-Hans / zh-Hant，其余为小写主语言子标签；空串仍为空串，und/unknown 为 unknown。 */
export function canonical(code: string | null | undefined): string {
    if (code == null) return '';
    const trimmed = trim(code);
    if (trimmed === '') return '';
    const parts = trimmed.replace(/_/g, '-').split('-');
    let lang = parts[0].toLowerCase();
    if (lang === 'und' || lang === UNKNOWN) return UNKNOWN;
    lang = Object.prototype.hasOwnProperty.call(ALIASES, lang) ? ALIASES[lang] : lang;
    if (lang !== 'zh') return lang;
    for (let i = 1; i < parts.length; i++) {
        switch (parts[i].toLowerCase()) {
            case 'hant': case 'tw': case 'hk': case 'mo':
                return 'zh-Hant';
        }
    }
    return 'zh-Hans';
}

/** 二者都非空且规范化后相等。 */
export function equivalent(a: string | null | undefined, b: string | null | undefined): boolean {
    const ca = canonical(a);
    return ca !== '' && ca === canonical(b);
}

/** `map` 中与 `code` 对应的键：先按原写法，再找等价的键；找不到返回 undefined。 */
export function findKey(map: ReadonlyMap<string, unknown> | undefined, code: string | undefined): string | undefined {
    if (!map || code == null) return undefined;
    if (map.has(code)) return code;
    for (const key of map.keys()) if (equivalent(key, code)) return key;
    return undefined;
}
