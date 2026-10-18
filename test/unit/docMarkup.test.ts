import { describe, expect, it } from 'vitest';
import { Family, family, parse } from '../../src/core/docMarkup';

/** 移植自 IDEA 插件 DocMarkupTest：各文档语法族的译文注释结构化渲染（C3）。 */

/** 把显示文本连同区间标成 ⟦K|text⟧：R 引用、C 代码、T 标签、P 参数名、S 显式普通文本。 */
function annotate(fam: Family, raw: string): string {
    const result = parse(fam, raw, 'zh-CN');
    let out = '';
    let at = 0;
    for (const span of result.spans) {
        let k: string;
        switch (span.kind) {
            case 'REFERENCE': k = 'R'; break;
            case 'CODE': k = 'C'; break;
            case 'TAG': k = 'T'; break;
            case 'PARAM_NAME': k = 'P'; break;
            default: k = 'S'; break;
        }
        out += result.display.substring(at, span.start) + '⟦' + k + '|' + result.display.substring(span.start, span.end) + '⟧';
        at = span.end;
    }
    return out + result.display.substring(at);
}

const CSHARP = '/// <summary>\n/// 把 <paramref name="a"/> 加到 <c>b</c>，参见 <see cref="T:System.Math"/>。\n'
    + '/// </summary>\n/// <param name="a">第一个数</param>\n/// <returns>和，或 <see langword="null"/>。</returns>\n'
    + '/// <exception cref="T:System.OverflowException">溢出时。</exception>\n/// <remarks>\n'
    + '/// <para>第一段。</para><para>第二段 &amp; <see cref="M:A.B(System.Int32)">B 方法</see>。</para>\n/// </remarks>';

describe('DocMarkup', () => {
    it('families', () => {
        expect(family('JAVA', 'A.java')).toBe('JAVADOC');
        expect(family('kotlin', null)).toBe('KDOC');
        expect(family('TypeScript JSX', null)).toBe('JSDOC');
        expect(family('ECMAScript 6', null)).toBe('JSDOC');
        expect(family('C#', null)).toBe('CSHARP');
        // 没有语言插件时文件是纯文本：回退到扩展名。
        expect(family('TEXT', 'lib/src/a.dart')).toBe('DARTDOC');
        expect(family(null, 'src/Calc.cs')).toBe('CSHARP');
        expect(family(null, 'web/app.mts')).toBe('JSDOC');
        expect(family(null, 'README')).toBe('NONE');
    });

    it('javadoc', () => {
        const raw = '/**\n * 返回 {@code sum} 的值。\n * @param a 第一个 {@link Number}\n */';
        expect(annotate('JAVADOC', raw)).toBe(
            '/**\n * 返回 ⟦T|{@code⟧ ⟦C|sum⟧⟦T|}⟧ 的值。\n * ⟦T|@param⟧ ⟦P|a⟧ 第一个 ⟦T|{@link⟧ ⟦R|Number⟧⟦T|}⟧\n */');
        // 不带分隔符的正文、标签，以及代码中的嵌套花括号。
        expect(annotate('JAVADOC', '见 {@linkplain java.util.List 列表} 与 {@code Map<K, {V}>}\n'
            + '@throws IOException 读取失败\n@return 总和')).toBe(
            '见 ⟦T|{@linkplain⟧ ⟦R|java.util.List⟧⟦S| 列表⟧⟦T|}⟧ 与 ⟦T|{@code⟧ ⟦C|Map<K, {V}>⟧⟦T|}⟧\n'
            + '⟦T|@throws⟧ ⟦R|IOException⟧ 读取失败\n⟦T|@return⟧ 总和');
        // 跨行的 {@code} 保持前缀为普通文本。
        expect(annotate('JAVADOC', '/**\n * {@code a(\n * b)} 完成\n */')).toBe(
            '/**\n * ⟦T|{@code⟧ ⟦C|a(⟧\n * ⟦C|b)⟧⟦T|}⟧ 完成\n */');
        // Java 23 Markdown 文档注释。
        expect(annotate('JAVADOC', '/// 参见 [String#length()] 与 `[x]`')).toBe(
            '/// 参见 ⟦R|[String#length()]⟧ 与 ⟦C|`[x]`⟧');
    });

    it('javadocHtml', () => {
        const raw = '/**\n * 计算总和。\n * <p>\n * 使用 <code>a[0]</code> 和 <b>粗体</b>，a &lt; b。<br>第二行\n'
            + ' * <pre>{@code\n * int x = a[0]; // {@link X}\n * }</pre>\n'
            + ' * <ul><li>甲</li><li>乙</li></ul>\n'
            + ' * @throws IllegalStateException 状态错误\n * @see String#length()\n * @param <T> 元素类型\n */';
        expect(annotate('JAVADOC', raw)).toBe(
            '/**\n * 计算总和。\n * 使用 ⟦C|a[0]⟧ 和 粗体，a < b。\n第二行\n * ⟦C|int x = a[0]; // {@link X}⟧\n'
            + ' * • 甲\n• 乙\n'
            + ' * ⟦T|@throws⟧ ⟦R|IllegalStateException⟧ 状态错误\n * ⟦T|@see⟧ ⟦R|String#length()⟧\n'
            + ' * ⟦T|@param⟧ ⟦P|<T>⟧ 元素类型\n */');
        const result = parse('JAVADOC', raw, 'zh-CN');
        expect(result.source[result.display.indexOf('a[0]')]).toBe(raw.indexOf('a[0]'));
        expect(result.source[result.display.indexOf('<')]).toBe(-1); // 解码出的实体是合成的
        // <a href> 的文字是引用；不是 HTML 的泛型尖括号保持原样。
        expect(annotate('JAVADOC', '见 <a href="https://x">文档</a>，List<String> 不变')).toBe(
            '见 ⟦R|文档⟧，List<String> 不变');
        expect(annotate('JAVADOC', '返回 Box<U> 或 Foo<I>；旧式<P>段落')).toBe('返回 Box<U> 或 Foo<I>；旧式\n段落');
        expect(annotate('KDOC', '<pre> 不在 Javadoc 外部生效')).toBe('<pre> 不在 Javadoc 外部生效');
    });

    it('kdoc', () => {
        const raw = '/**\n * 从缓存解析 [versions]，参见 [Foo.bar]。\n * `code [notALink]` 与 [链接](https://x.y)\n'
            + ' * ```kotlin\n * val x = list[0] // [x]\n * ```\n * @param value 输入值\n * @property name 名称\n'
            + ' * @return 结果\n * @throws IllegalStateException 失败时\n * @sample com.example.sampleFoo\n */';
        expect(annotate('KDOC', raw)).toBe(
            '/**\n * 从缓存解析 ⟦R|[versions]⟧，参见 ⟦R|[Foo.bar]⟧。\n * ⟦C|`code [notALink]`⟧ 与 [链接](https://x.y)\n'
            + ' * ⟦C|```kotlin⟧\n * ⟦C|val x = list[0] // [x]⟧\n * ⟦C|```⟧\n * ⟦T|@param⟧ ⟦P|value⟧ 输入值\n'
            + ' * ⟦T|@property⟧ ⟦P|name⟧ 名称\n * ⟦T|@return⟧ 结果\n * ⟦T|@throws⟧ ⟦R|IllegalStateException⟧ 失败时\n'
            + ' * ⟦T|@sample⟧ ⟦R|com.example.sampleFoo⟧\n */');
        expect(annotate('KDOC', '``a ` [b]`` 与 [c]')).toBe('⟦C|``a ` [b]``⟧ 与 ⟦R|[c]⟧');
    });

    it('jsdoc', () => {
        const raw = '/**\n * 把两个数相加，见 {@link Calculator#add | 加法}。\n * @param {number} a 第一个数\n'
            + ' * @param {number} [b=0] 第二个数\n * @returns {number} 两数之和\n * @remarks 使用 `a + b` 计算。\n'
            + ' * @example\n * add(1, 2); // {@link x} [y]\n * @throws {RangeError} 溢出时\n */';
        expect(annotate('JSDOC', raw)).toBe(
            '/**\n * 把两个数相加，见 ⟦T|{@link⟧ ⟦R|Calculator#add⟧⟦S| ⟧⟦T||⟧⟦S| 加法⟧⟦T|}⟧。\n'
            + ' * ⟦T|@param⟧ ⟦R|{number}⟧ ⟦P|a⟧ 第一个数\n * ⟦T|@param⟧ ⟦R|{number}⟧ ⟦P|[b=0]⟧ 第二个数\n'
            + ' * ⟦T|@returns⟧ ⟦R|{number}⟧ 两数之和\n * ⟦T|@remarks⟧ 使用 ⟦C|`a + b`⟧ 计算。\n'
            + ' * ⟦T|@example⟧\n * ⟦C|add(1, 2); // {@link x} [y]⟧\n * ⟦T|@throws⟧ ⟦R|{RangeError}⟧ 溢出时\n */');
        expect(annotate('JSDOC', '@param options 选项，类型为 {@link Options|配置}')).toBe(
            '⟦T|@param⟧ ⟦P|options⟧ 选项，类型为 ⟦T|{@link⟧ ⟦R|Options⟧⟦T||⟧⟦S|配置⟧⟦T|}⟧');
    });

    it('dartdoc', () => {
        const raw = '/// 返回 [Foo] 的副本，参见 [new Bar]。\n/// 使用 `list[0]` 访问。\n///\n/// ```dart\n/// var x = [1, 2];\n/// ```';
        expect(annotate('DARTDOC', raw)).toBe(
            '/// 返回 ⟦R|[Foo]⟧ 的副本，参见 ⟦R|[new Bar]⟧。\n/// 使用 ⟦C|`list[0]`⟧ 访问。\n///\n'
            + '/// ⟦C|```dart⟧\n/// ⟦C|var x = [1, 2];⟧\n/// ⟦C|```⟧');
        // Dartdoc 没有 @标签：@ 符号保持为普通文本。
        expect(annotate('DARTDOC', '/// 发送到 @param 不是标签')).toBe('/// 发送到 @param 不是标签');
    });

    it('csharp', () => {
        expect(annotate('CSHARP', CSHARP)).toBe(
            '/// 把 ⟦R|a⟧ 加到 ⟦C|b⟧，参见 ⟦R|System.Math⟧。\n/// ⟦T|参数⟧ ⟦P|a⟧⟦T|:⟧ 第一个数\n'
            + '/// ⟦T|返回:⟧ 和，或 ⟦C|null⟧。\n/// ⟦T|异常⟧ ⟦R|System.OverflowException⟧⟦T|:⟧ 溢出时。\n'
            + '/// ⟦T|备注:⟧ \n/// 第一段。\n第二段 & ⟦R|B 方法⟧。');
        const english = parse('CSHARP', '/// <param name="a">The first.</param>\n/// <returns>Sum.</returns>', 'en').display;
        expect(english).toBe('/// Parameter a: The first.\n/// Returns: Sum.');
        // 没有指定语言时，标签跟随译文的文字。
        expect(parse('CSHARP', '/// <returns>合計を返す。</returns>', null).display).toBe('/// 戻り値: 合計を返す。');
        // <code> 块原样保留内容，包括形似 XML 的文本。
        expect(annotate('CSHARP', '/// <example>\n/// <code>\n/// var x = a&lt;b&gt;(c);\n/// </code>\n/// </example>')).toBe(
            '/// ⟦T|示例:⟧ \n/// ⟦C|var x = a<b>(c);⟧');
    });

    it('crlf', () => {
        const families: Family[] = ['JAVADOC', 'KDOC', 'JSDOC', 'DARTDOC', 'CSHARP', 'NONE'];
        for (const fam of families) {
            const raw = fam === 'CSHARP' ? CSHARP
                : '/**\n * 说明 <p> {@code x} [y] `z`\n * <pre>\n * a[0]\n * </pre>\n * @param v 值\n */';
            const crlf = raw.replace(/\n/g, '\r\n');
            expect(annotate(fam, crlf).replace(/\r/g, '')).toBe(annotate(fam, raw));
            const result = parse(fam, crlf, 'zh-CN');
            expect(result.source.length).toBe(result.display.length);
            for (let i = 0; i < result.display.length; i++) {
                const source = result.source[i];
                if (source >= 0 && crlf.charAt(source) !== result.display.charAt(i)) throw new Error('source map ' + i);
            }
        }
    });

    it('untouched', () => {
        const plain = '普通注释 [x] <p> {@code y}';
        const result = parse('NONE', plain, 'zh-CN');
        expect(result.display).toBe(plain);
        expect(result.spans.length).toBe(0);
        expect(parse('JAVADOC', '', null).display).toBe('');
    });
});
