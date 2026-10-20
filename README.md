# CodeI18n for VS Code

读取项目 `.codei18n` 翻译缓存，在 VS Code 里显示源码注释的译文：**行尾幽灵文字或替换显示 + 悬停 + 侧边译文视图**。与 [CodeI18n IDEA 插件](https://github.com/CairnPack/Codei18n-IDEA) 的作用相同——只读取已有缓存，不修改源码、不调用 CLI 或翻译服务、不读写任何令牌。

支持 Kotlin、Java、TypeScript（含 TSX）、JavaScript（含 JSX）、Dart、C#。Go、Rust 等没有内置语法的文件，在文件未修改时按 `index.json` 的位置显示译文。

## 安装

只通过 GitHub Release 分发 VSIX，不上 VS Code Marketplace 和 Open VSX。

1. 在 [Releases](https://github.com/CairnPack/Codei18n-VSC/releases) 下载 `codei18n-vscode-<版本>.vsix`（正式版），或滚动预发布 `nightly` 中的每日构建。可用同目录的 `.sha256` 校验：`sha256sum -c codei18n-vscode-<版本>.vsix.sha256`。
2. VS Code 命令面板 → **Extensions: Install from VSIX…**，选择该文件；或命令行 `code --install-extension codei18n-vscode-<版本>.vsix`。
3. 打开含 `.codei18n` 的项目与源码文件。

需要 VS Code **1.105** 或更高版本。扩展在 Remote（WSL / SSH / Dev Containers）中运行于文件所在一侧，支持未受信任的工作区（只读 JSON，不执行任何代码）。

## 显示形式

VS Code 没有 IDEA 那样的块级 inlay（不能在注释下方插入多行虚拟文字），所以用以下几种方式互补。编辑器内的显示由 `codei18n.display` 选择，`CodeI18n: Switch CodeI18n Display Mode` 命令在两者之间切换：

- **行尾幽灵文字**（`ghost`，默认）：译文显示在注释（组）最后一行的行尾，颜色跟随主题（`editorInlayHint.foreground`）。不进入文档内容，不影响复制和 diff。单行译文全文显示；多行译文或超过最大长度时只显示开头并加 `…`。
- **替换显示**（`replace`，对应 IDEA 的“替换显示”）：把注释文字隐藏，在原位逐行显示按原注释语法包装的译文（行注释沿用原标记，块注释、文档注释保留 `/* */`、`/** */` 结构，缩进和注释前后的代码保持不变）。**只改显示，不改文档**：文件内容、保存、复制、搜索、Git diff 都还是原注释。光标所在行碰到的注释露出原文，译文暂时改为行尾幽灵文字；光标离开约 0.6 秒后换回译文。点击译文即可把光标移进原注释。颜色为 `codei18n.replaceForeground`（默认接近 Dark+/Light+ 的注释色，可在 `workbench.colorCustomizations` 中修改）。
- **悬停**：鼠标停在有译文的注释上时显示完整译文。文档注释按语言渲染——Javadoc 的 `{@link}`、`{@code}`、`@param`，KDoc 与 Dartdoc 的 `[引用]`，JSDoc/TSDoc 的 `{类型}` 与 `@example` 代码块；C# XML 文档注释去掉标签按段落显示（`<summary>` 正文、“参数 x: …”、“返回: …”，标签名按显示语言本地化）。代码与引用显示为代码样式，其余文字全部转义，不会被误当作 Markdown。底部小字显示原语言与命中方式（位置 / textHash / 全局），方便排查。
- **侧边译文视图**：`Ctrl+Alt+Shift+P` 在旁边打开只读虚拟文档，内容是把注释替换成译文的源码，语言与原文件相同（保留语法高亮）。译文按原注释的语法包装：行注释每行加原标记，块注释、文档注释保留 `/* */`、`/** */` 或 `///` 结构，没有译文的注释保持原样。两边滚动时相同的代码行对齐（注释行数变化时按行映射）；原文件修改后视图随之刷新。虚拟文档绝不写回磁盘。

状态栏在有 `.codei18n` 的文件上显示当前显示语言和命中数量，点击打开设置；加载出错时显示警告，同一错误只通知一次。

## 数据文件与显示语言

`.codei18n/` 下扩展读取三个文件（由 [CodeI18n CLI](https://github.com/CairnPack/Codei18n) 生成）：

- `config.json`：`{"sourceLanguage":"en","localLanguage":"zh-CN"}`；
- `mappings.json`：注释 ID → 语言 → 文本；
- `index.json`（可选，`codei18n map update` 生成）：每条注释的位置、类型、原语言、文本哈希等，格式见 core 仓库的 `docs/index-format.md`。

扩展从源码所在目录向上查找最近的 `.codei18n`，不越过包含该文件的最外层工作区文件夹，支持嵌套根目录与多根工作区（包括互相嵌套的工作区文件夹）。显示语言优先级：设置 `codei18n.language` → config 的 `localLanguage` → mappings 的 `targetLanguage` → `zh-CN`。

生成或更新缓存：

```shell
codei18n init --provider <provider>
codei18n map update
codei18n translate
```

## 匹配规则

与 IDEA 插件一致，以 core 的 `docs/index-format.md` 为准。扩展用 tree-sitter（WASM，与 core 同源的语法）从**当前编辑器文本**中找出注释，按 §6.1 把连续行注释合并成组，再按以下优先级匹配：

1. **按位置精确匹配**：文档没有未保存修改、磁盘内容正是编辑器里的文本、且其 SHA-1 等于 `index.json` 的 `contentHash` 时，按“起始行列 + 物理注释条数”命中条目，按条目 ID 取译文。原文相同、译文不同的两条注释因此能各自显示正确的译文。
2. **按 textHash 匹配**：文件与索引不一致或有未保存修改时，只在该文件的条目里按归一化文本的 `textHash`（及条数）匹配。同一文本出现多次且次数与索引一致时按出现顺序配对，否则取行号最近的一条，距离相同则不显示。所以插入、删除代码行后译文仍跟着注释走。
3. **全局文本匹配**：没有 `index.json`、文件不在索引里或上面都没命中时，按归一化文本在 `mappings.json` 里反查。同一原文对应多个不同译文、或部分记录缺少译文时视为有歧义，不显示。

其他规则：

- **连续行注释组**：标记相同（`//`、`///`、`//!` 互不相同）、行号连续、起始列相同、各自独占一行的行注释合并为一组，整组只显示一条译文，挂在组的最后一行；整组匹配不上时退回逐条匹配（兼容旧映射）。
- **原语言**：用 `sourceKey` 取原文、用显示语言的等价键取译文。原文已经是显示语言、缺少译文、或译文与原文相同时都不显示。
- **语言码等价**：`zh`、`zh-CN`、`zh-SG`、`zh-Hans` 等价，`zh-TW`、`zh-HK`、`zh-Hant` 等价；`en-US` 与 `en` 等价（与 core 共享测试向量）。
- **编辑**：编辑某条注释时立即撤下它自己的译文，其他译文不动；停止输入约 350 ms 后重新匹配（tree-sitter 增量解析）。字符串里的 `//`、`/*` 不是注释。
- **切换分支**：磁盘内容与编辑器文本不一致时（例如编辑器还没重新载入）不按位置匹配，只按 textHash 匹配，避免把译文挂到别的注释下面。
- 注释语法按**文件扩展名**选择，不依赖 VS Code 的 languageId，没装 Kotlin、Dart 扩展时也能工作。
- 扩展不自行计算注释 ID，视为不透明字符串。

## 设置项

全部可以按资源（工作区、文件夹）设置。

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `codei18n.enabled` | `true` | 显示译文 |
| `codei18n.language` | `""` | 显示语言，如 `zh-CN`、`zh-TW`、`ja`；留空跟随项目配置 |
| `codei18n.display` | `ghost` | 编辑器内的显示方式：`ghost` 行尾幽灵文字，`replace` 替换显示 |
| `codei18n.ghostText.enabled` | `true` | 行尾模式下显示行尾幽灵文字 |
| `codei18n.ghostText.maxLength` | `80` | 幽灵文字最大字符数，超出或多行时截断加 `…` |
| `codei18n.hover.enabled` | `true` | 悬停显示完整译文 |

## 命令与快捷键

沿用 IDEA 插件的快捷键：

| 命令 | 快捷键 | 说明 |
| --- | --- | --- |
| CodeI18n: Show CodeI18n Translations | `Ctrl+Alt+Shift+O` | 开关译文显示（也在编辑器右键菜单中）。改写当前生效的那一级 `codei18n.enabled`；没有在工作区设置过时改用户设置，不会在项目里新建 `.vscode/settings.json` |
| CodeI18n: Open CodeI18n Translation View to the Side | `Ctrl+Alt+Shift+P` | 打开或关闭侧边译文视图 |
| CodeI18n: Switch CodeI18n Display Mode | — | 在行尾显示与替换显示之间切换（写入方式与开关命令相同）。IDEA 的 `Ctrl+Alt+Shift+P` 在这里已用于侧边视图，所以不设默认快捷键 |
| CodeI18n: Reload CodeI18n Translations | — | 强制重新读取所有缓存 |

快捷键可在 Keyboard Shortcuts 中修改。

## 自动刷新

监视 `**/.codei18n/{mappings,index,config}.json`，变化后防抖刷新。CLI 原地改写时读到不完整的 JSON 会短暂重试，文件稳定后仍无效才提示，并撤下该根目录的译文；文件恢复后自动重新显示。

## 边界与已知限制

- 幽灵文字只显示译文的**首行**（多行时加 `…`），完整译文看悬停、替换显示或侧边视图；不做语法高亮。
- 替换显示不能增删行：译文行数少于原注释时多出的行留空，多于原注释时超出部分并入最后一行。隐藏原文借助装饰样式注入 `display: none`，这不是 VS Code 公开承诺的行为，已在 1.105 与 1.142 上验证；自动换行仍按原文长度计算。
- 大于 2 MiB 的源码不处理；大于 32 MiB 的 JSON 拒绝加载并提示；`index.json` 主版本不认识或无法解析时忽略整个文件，只用 `mappings.json`（无法解析时提示一次；IDEA 插件此时会撤下全部译文，这里按 `docs/index-format.md` §9.1 处理）。
- Go、Rust 等没有内置语法的文件只在未修改时按位置显示；文件有修改时不显示。
- 侧边视图的标签名与原文件相同（虚拟文档，scheme 为 `codei18n`）。
- 不支持 Web 版 VS Code（vscode.dev）与虚拟工作区。
- 不能在 VS Code 里编辑译文或纠正原语言（请用 CodeI18n Desktop）。

## 构建与测试

需要 Node.js 22。

```shell
npm ci
npm run lint            # ESLint + 类型检查
npm test                # 单测（vitest）
npm run test:integration  # 集成测试：下载并启动真实的 VS Code（默认 stable）
VSCODE_VERSION=1.105.0 npm run test:integration   # 最低版本
npm run package         # 打出 codei18n-vscode-<版本>.vsix
```

Linux 上集成测试需要显示服务器，可用 `xvfb-run -a npm run test:integration`。

单测覆盖：

- 与 core、IDEA 插件共用的测试向量（`test/testdata/text-normalization.json`、`language-codes.json`，从 core 原样复制；`npm run check:vectors` 检查是否与 core 一致）；
- 从 IDEA 插件移植的 `IndexMatchingTest`、`C1ReproTest`、`MappingIndexTest`、`DocMarkupTest` 用例；
- **一致性测试**：对 `test/fixtures/languages` 中每个未修改的样例文件，“tree-sitter 提取 + §6.1 合并 + §6.2 归一化”的结果与该工程 `index.json` 的 `range`、`parts`、`type`、`textHash` 逐条完全相同；
- 侧边视图的内容与行映射、编辑时译文的平移与撤下、缓存的重试与失效。

集成测试（`@vscode/test-electron`）把 `test/fixtures/languages` 复制为测试工程，六种语言逐个打开，断言块注释、行注释组（只有一条译文，挂在最后一行）、文档注释的精确译文以及字符串里的 `//` 没有译文；修改未保存文档后译文仍跟着注释走；外部改写 `mappings.json` 后自动刷新；侧边视图的内容与滚动同步；替换显示的隐藏范围与原位译文、光标进出时的露出与换回、文档内容不变；设置项与开关命令；不写入源码。扩展拿不到装饰的渲染结果，所以只在测试模式下注册内部命令 `codei18n._test.state`，返回当前计算出的提示和编辑器绘制的装饰。

`test/fixtures/languages` 是 IDEA 插件 `examples/languages` 的拷贝，用 `npm run sync:fixtures -- --ref origin/main` 从聚合仓库中的兄弟目录同步（`CODEI18N_IDEA_DIR` 可指定 IDEA 仓库位置），`--check` 只检查。

tree-sitter 语法的 `.wasm` 用与 core 完全相同的 C 源码编译，来源、重新编译方法与许可证见 [`grammars/README.md`](grammars/README.md)。

## 发布

- `.github/workflows/ci.yml`：PR 与 push 时在 Windows、Ubuntu 上对 VS Code 1.105.0 与 stable 跑 lint、单测、集成测试，并检查共享向量与测试夹具。
- `.github/workflows/nightly.yml`：每天比较默认分支 HEAD 与 `nightly` tag，不同才构建，发布为滚动预发布（版本形如 `0.1.1-nightly.20261019.42`），成功后再移动 tag。
- `.github/workflows/release.yml`：推送 `v*` tag（须与 `package.json` 版本一致）时构建并发布正式 Release，附件为 `.vsix` 与 `.sha256`。

## 许可证

MIT，见 [LICENSE](LICENSE)。随扩展分发的 tree-sitter 语法与运行时同为 MIT，见 [`grammars/README.md`](grammars/README.md)。
