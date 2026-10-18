import { describe, expect, it } from 'vitest';
import { escapeMarkdown, inlineCode, toMarkdown } from '../../src/core/docMarkdown';
import { commentBody, ghostText } from '../../src/core/display';

describe('悬停 Markdown', () => {
    it('Javadoc：{@link}、{@code}、@param', () => {
        const md = toMarkdown('/**\n * 返回 {@link Foo#bar(int) 结果}，见 {@code a < b}。\n * @param count 次数\n * @return 总和\n */', true, 'JAVADOC', 'zh-CN');
        expect(md).toBe('返回 `Foo#bar(int)` 结果，见 `a < b`。  \n**@param** `count` 次数  \n**@return** 总和');
    });

    it('Javadoc HTML：<code>、<p>、实体', () => {
        const md = toMarkdown('/**\n * 使用 <code>List&lt;String&gt;</code>。<p>第二段 &amp; 结束\n */', true, 'JAVADOC', 'zh-CN');
        expect(md).toBe('使用 `List<String>`。  \n第二段 \\& 结束');
    });

    it('KDoc 与 Dartdoc 的 [ref]，Markdown 行内代码原样保留', () => {
        expect(toMarkdown('/**\n * 添加 [quantity] 个 [sku] 商品，`x * 2`\n */', true, 'KDOC', 'zh-CN'))
            .toBe('添加 `quantity` 个 `sku` 商品，`x * 2`');
        expect(toMarkdown('/// 结果已包含 [taxRate]。', true, 'DARTDOC', 'zh-CN')).toBe('结果已包含 `taxRate`。');
    });

    it('JSDoc：{type} 与 @example 代码块', () => {
        const md = toMarkdown('/**\n * 格式化价格。\n * @param {number} cents 分\n * @example\n * format(100, "CNY")\n *   // ¥1.00\n */', true, 'JSDOC', 'zh-CN');
        expect(md).toBe('格式化价格。  \n**@param** `{number}` `cents` 分  \n**@example**\n\n```\nformat(100, "CNY")\n  // ¥1.00\n```');
    });

    it('译文自带的 ``` 代码块原样保留', () => {
        const md = toMarkdown('/**\n * 示例：\n * ```kotlin\n * val a = 1 * 2\n * ```\n */', true, 'KDOC', 'zh-CN');
        expect(md).toBe('示例：\n\n```kotlin\nval a = 1 * 2\n```');
    });

    it('C# XML 文档注释：去掉标签，标签名按显示语言本地化', () => {
        const text = '/// <summary>\n/// 向账本添加一笔记录。\n/// </summary>\n/// <param name="amount">记账金额。</param>\n/// <returns>新的余额。</returns>';
        expect(toMarkdown(text, true, 'CSHARP', 'zh-CN')).toBe('向账本添加一笔记录。  \n**参数** `amount`**:** 记账金额。  \n**返回:** 新的余额。');
        expect(toMarkdown(text, true, 'CSHARP', 'en')).toContain('**Parameter** `amount`**:**');
        expect(toMarkdown('/// <summary>見る <see cref="T:System.String"/></summary>', true, 'CSHARP', 'ja')).toBe('見る `System.String`');
    });

    it('普通注释：全部转义，保留换行', () => {
        expect(toMarkdown('// 第一行 *不是强调* [x](y)\n// <b>2</b> # 3', false, 'JAVADOC', 'zh-CN'))
            .toBe('第一行 \\*不是强调\\* \\[x\\]\\(y\\)  \n\\<b\\>2\\</b\\> \\# 3');
        expect(toMarkdown('/*\n * 块注释\n *\n * 第二段\n */', false, 'NONE', 'zh-CN')).toBe('块注释\n\n第二段');
    });

    it('行内代码的反引号围栏', () => {
        expect(inlineCode('a`b')).toBe('``a`b``');
        expect(inlineCode('`x`')).toBe('`` `x` ``');
        expect(escapeMarkdown('a_b*c')).toBe('a\\_b\\*c');
    });
});

describe('幽灵文字', () => {
    it('去掉注释语法，单行全文显示', () => {
        expect(ghostText('// 保存', 80)).toBe('保存');
        expect(ghostText('/* 你好 */', 80)).toBe('你好');
        expect(ghostText('/**\n * 返回总和。\n */', 80)).toBe('返回总和。');
    });

    it('多行或过长时只显示开头加 …', () => {
        expect(ghostText('// 第一行\n// 第二行', 80)).toBe('第一行 …');
        expect(ghostText('// ' + '很'.repeat(100), 10)).toBe('很'.repeat(10) + '…');
        expect(ghostText('[MOCK en->zh-CN] /*\n * Invoice model.\n */', 80)).toBe('[MOCK en->zh-CN] …');
        expect(ghostText('//', 80)).toBe('');
    });

    it('commentBody 保留正文缩进，去掉首尾空行', () => {
        expect(commentBody('/**\n *\n * a\n *   b\n */')).toEqual(['a', '  b']);
        expect(commentBody('/// x\n///\n/// y')).toEqual(['x', '', 'y']);
    });
});
