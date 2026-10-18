# tree-sitter 语法（WASM）

扩展用 [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) 0.26.13 在当前文档文本里定位注释。这里的 `.wasm` 由 `scripts/build-grammars.mjs` 编译，**C 源码与 core 使用的完全相同**，所以扩展与 core 对"注释在哪里"的理解一致（由一致性测试 `test/unit/treesitter.test.ts` 保证）。

| 文件 | 语法 | 源码来源（与 core 相同） | 上游版本 | ABI |
| --- | --- | --- | --- | --- |
| `tree-sitter-java.wasm` | Java | smacker `java/` | tree-sitter-java v0.21.0 | 14 |
| `tree-sitter-kotlin.wasm` | Kotlin | smacker `kotlin/` | fwcd/tree-sitter-kotlin 0.3.8 | 14 |
| `tree-sitter-c_sharp.wasm` | C# | smacker `csharp/` | tree-sitter-c-sharp v0.21.3 | 14 |
| `tree-sitter-javascript.wasm` | JavaScript、JSX | smacker `javascript/` | tree-sitter-javascript v0.21.4 | 14 |
| `tree-sitter-typescript.wasm` | TypeScript | smacker `typescript/typescript/` | tree-sitter-typescript v0.21.2 | 14 |
| `tree-sitter-tsx.wasm` | TSX | smacker `typescript/tsx/` | tree-sitter-typescript v0.21.2 | 14 |
| `tree-sitter-dart.wasm` | Dart | core `adapters/dart/grammar/` | UserNobody14/tree-sitter-dart `c8e7cbbd1589cc2ee1f9b5befa604dc7e953b0af` | 14 |

smacker 指 core 的 `go.mod` 依赖的 `github.com/smacker/go-tree-sitter v0.0.0-20240827094217-dd81d9e9be82`。各源文件的 sha256 与产物 sha256 记录在 `manifest.json`。

## 重新编译

```shell
# 1. core 目录中已下载 Go 依赖（go mod download），脚本从 Go 模块缓存读取 smacker 源码
# 2. 准备 wasi-sdk：设置 WASI_SDK_PATH，或运行一次 tree-sitter CLI 0.26 的 build --wasm 让它自动下载
npx tree-sitter-cli@0.26.13 build --wasm <任一语法目录>   # 只为下载 wasi-sdk，失败也没关系
# 3. 编译（CODEI18N_CORE_DIR 默认 ../Codei18n）
node scripts/build-grammars.mjs
```

脚本只改动 `#include` 路径（smacker 把上游的 `tree_sitter/parser.h` 等改成了相对路径）。`parser.h` 用 smacker 子包自带的那一份（Dart 用 core 目录中的拷贝，与 smacker 运行时逐字节相同）；`include/tree_sitter/alloc.h`、`array.h` 取自上游 tree-sitter-c-sharp v0.21.3 的 `src/tree_sitter/`（tree-sitter-kotlin 0.3.8 带的是同一份）。编译参数与 tree-sitter CLI 0.26 用 wasi-sdk 编译时相同（`-Os -fPIC -shared -nostdlib`，运行时提供 libc 符号）。

tree-sitter CLI 0.26.13 的 `build --wasm` 在 Windows 上会把语法 JSON 误当作链接参数，所以脚本直接调用 wasi-sdk 的 clang。

## 许可证

以下语法都以 MIT 许可证发布，随扩展分发的 `.wasm` 由它们的源码编译而来：

- tree-sitter-java — Copyright (c) 2017 Ayman Nadeem
- tree-sitter-kotlin — Copyright (c) 2019 fwcd
- tree-sitter-c-sharp — Copyright (c) 2014-2023 Max Brunsfeld, Damien Guard, Amaan Qureshi, and contributors
- tree-sitter-javascript — Copyright (c) 2014 Max Brunsfeld
- tree-sitter-typescript — Copyright (c) 2017 Max Brunsfeld
- tree-sitter-dart — Copyright (c) 2020-2023 UserNobody14 and others
- go-tree-sitter（smacker，源码打包方）— Copyright (c) 2019 Maxim Sukharev
- tree-sitter / web-tree-sitter（运行时与 `alloc.h`、`array.h`）— Copyright (c) 2018 Max Brunsfeld

MIT 许可证全文：

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
