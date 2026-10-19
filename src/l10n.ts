import * as vscode from 'vscode';

/** 界面文字：VS Code 显示语言为中文时用中文，否则用英文。 */
const ZH = {
    sourceLanguage: '原语言',
    matchedBy: '命中方式',
    via: { location: '位置（index.json）', textHash: 'textHash（index.json）', global: '全局文本' },
    statusTooltip: (language: string, count: number) => `CodeI18n：显示语言 ${language}，当前文件命中 ${count} 条译文。点击打开设置。`,
    statusDisabled: 'CodeI18n 译文已关闭。点击打开设置。',
    loadError: (root: string, message: string) => `无法加载 CodeI18n 译文：${root}：${message}`,
    statusError: (message: string) => `CodeI18n 加载出错：${message}`,
    sideViewTitle: (name: string) => `${name}（译文）`,
    noRoot: '当前文件不在含 .codei18n 的项目中。',
    indexIgnored: (message: string) => `index.json 无法解析，已忽略，只用 mappings.json 匹配（${message}）`,
};

const EN: typeof ZH = {
    sourceLanguage: 'Source',
    matchedBy: 'Matched by',
    via: { location: 'position (index.json)', textHash: 'textHash (index.json)', global: 'global text' },
    statusTooltip: (language, count) => `CodeI18n: display language ${language}, ${count} translations in this file. Click to open settings.`,
    statusDisabled: 'CodeI18n translations are off. Click to open settings.',
    loadError: (root, message) => `Cannot load CodeI18n translations: ${root}: ${message}`,
    statusError: message => `CodeI18n failed to load: ${message}`,
    sideViewTitle: name => `${name} (translated)`,
    noRoot: 'This file is not in a project with a .codei18n directory.',
    indexIgnored: message => `index.json cannot be parsed and is ignored; matching uses mappings.json only (${message})`,
};

export const t: typeof ZH = vscode.env.language.toLowerCase().startsWith('zh') ? ZH : EN;
