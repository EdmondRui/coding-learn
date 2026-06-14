# 第1章 入门与环境搭建

> 本章面向零基础读者，帮助你了解 Rust 的核心特点、搭建开发环境、编写第一个程序，并熟悉 Rust 生态中的常用工具。

---

## 1.1 Rust 简介

### 1.1.1 Rust 是什么

Rust 是一门**系统级编程语言**，由 Mozilla 研究院设计，2015 年发布 1.0 稳定版。它融合了 C/C++ 的性能优势与现代化的语言特性，旨在提供**内存安全**、**零成本抽象**和**无畏并发**的编程体验。

### 1.1.2 Rust 的核心特点

| 特点 | 说明 | 对比传统语言 |
|------|------|-------------|
| **内存安全** | 编译时通过所有权系统保证内存安全，无需 GC | C/C++ 需手动管理，Java/Go 依赖 GC |
| **零成本抽象** | 高级抽象在编译期被消除，运行时无额外开销 | C++ 类似，但 Rust 保证无隐运行时成本 |
| **无畏并发** | 类型系统在编译期消除数据竞争 | C 的 pthreads 需开发者自行保证 |
| **模式匹配** | 强大的 `match` 表达式和模式解构 | 比 C 的 switch 更灵活、更安全 |
| **trait 系统** | 基于 trait 的泛型和多态，无虚表开销 | 类似 Haskell 的 typeclass |

> 💡 **业界评价**：Stack Overflow 开发者调查中，Rust 连续多年被评为"最受喜爱语言"。

### 1.1.3 Rust 与 C/C++ 的直观对比

```c
// C 语言：手动管理内存
char* greet(const char* name) {
    char* msg = malloc(50);
    sprintf(msg, "Hello, %s!", name);
    return msg;  // 调用者必须 free()
}
```

```cpp
// C++：智能指针缓解问题，但仍存在悬垂指针风险
std::string greet(const std::string& name) {
    return "Hello, " + name + "!";  // 可能抛出异常
}
```

```rust
// Rust：所有权系统在编译期保证安全
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}  // 无需手动释放，离开作用域自动回收
```

### 1.1.4 适用场景

Rust 广泛应用于以下领域：

- **系统编程**：操作系统内核、驱动开发（如 Redox OS）
- **Web 开发**：高性能后端（Actix-Web、Axum）、WebAssembly
- **命令行工具**：替代 Python/Node.js 脚本（ripgrep、fd、bat）
- **嵌入式开发**：资源受限设备（Tock OS、ESP32）
- **网络服务**：代理、负载均衡（Pingora 用于 Cloudflare）
- **游戏引擎**：Bevy、Amethyst
- **区块链**：Solana、Polkadot、Near

---

## 1.2 安装 Rust

### 1.2.1 rustup 安装

Rust 官方推荐使用 **rustup** 工具链管理器进行安装。

**macOS / Linux：**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Windows：**

从 [https://rustup.rs](https://rustup.rs) 下载安装程序并运行。

安装过程会询问配置选项，通常选择默认（option `1`）即可。

安装完成后，重新打开终端或运行以下命令使环境变量生效：

```bash
source "$HOME/.cargo/env"
```

### 1.2.2 验证安装

```bash
# 查看 Rust 编译器版本
rustc --version
# 输出示例: rustc 1.84.0 (9fc6b4312 2025-01-30)

# 查看 Cargo 包管理器版本
cargo --version
# 输出示例: cargo 1.84.0 (66221abde 2024-11-20)

# 查看 rustup 版本
rustup --version
```

### 1.2.3 工具链管理

```bash
# 查看已安装的工具链
rustup show

# 安装 nightly 版本
rustup install nightly

# 切换默认工具链
rustup default nightly
rustup default stable

# 更新所有工具链
rustup update

# 卸载 Rust
rustup self uninstall
```

### 1.2.4 Rust 工具链组件

| 组件 | 用途 | 安装方式 |
|------|------|----------|
| `rustc` | Rust 编译器 | rustup 自带 |
| `cargo` | 包管理器与构建工具 | rustup 自带 |
| `rustfmt` | 代码格式化 | `rustup component add rustfmt` |
| `clippy` | 代码 lint 工具 | `rustup component add clippy` |
| `rust-analyzer` | LSP 语言服务器 | 单独安装（见 IDE 配置） |
| `rustdoc` | 文档生成器 | rustup 自带 |
| `rust-src` | 标准库源码 | `rustup component add rust-src` |
| `rustc-dev` | 开发 Rust 编译器插件 | `rustup component add rustc-dev` |

> 💡 **建议**：安装后立即执行 `rustup component add rustfmt clippy`，这两个工具在日常开发中非常实用。

---

## 1.3 Hello World 与 Cargo

### 1.3.1 第一个 Rust 程序

创建一个新的目录并编写第一个 Rust 程序：

```bash
mkdir hello_rust
cd hello_rust
```

创建 `main.rs` 文件：

```rust
fn main() {
    println!("Hello, 世界!");
}
```

编译并运行：

```bash
rustc main.rs
./main
# 输出: Hello, 世界!
```

### 1.3.2 使用 Cargo 创建项目

Cargo 是 Rust 的包管理器和构建系统，类似于 Node.js 的 npm 或 Go 的 go mod。

```bash
# 创建二进制项目
cargo new hello_cargo
cd hello_cargo

# 目录结构
# hello_cargo/
# ├── Cargo.toml    # 项目配置文件
# └── src/
#     └── main.rs   # 源代码入口
```

**Cargo.toml** 的内容：

```toml
[package]
name = "hello_cargo"
version = "0.1.0"
edition = "2021"
description = "我的第一个 Rust 项目"

[dependencies]
```

**src/main.rs** 的内容：

```rust
fn main() {
    println!("Hello, Cargo!");
}
```

### 1.3.3 Cargo 常用命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `cargo new` | 创建新项目 | `cargo new my_app` |
| `cargo build` | 编译项目（调试模式） | `cargo build` |
| `cargo build --release` | 编译项目（发布模式，带优化） | `cargo build --release` |
| `cargo run` | 编译并运行 | `cargo run` |
| `cargo check` | 检查代码能否通过编译（速度快于 build） | `cargo check` |
| `cargo test` | 运行测试 | `cargo test` |
| `cargo fmt` | 格式化代码 | `cargo fmt` |
| `cargo clippy` | 代码 lint 检查 | `cargo clippy` |
| `cargo doc` | 生成文档 | `cargo doc --open` |
| `cargo clean` | 清理 build 产物 | `cargo clean` |

### 1.3.4 Debug 与 Release 模式的区别

| 特性 | `cargo build` (Debug) | `cargo build --release` |
|------|----------------------|-------------------------|
| 优化级别 | 0（无优化） | 3（最大优化） |
| 编译速度 | 快 | 慢 |
| 运行速度 | 慢 | 快 |
| 调试信息 | 完整 | 有限 |
| 产物位置 | `target/debug/` | `target/release/` |

> 💡 **开发习惯**：日常开发用 `cargo check` 快速验证语法，用 `cargo build` 生成可执行文件调试，最终发布时使用 `cargo build --release`。

---

## 1.4 IDE 配置

### 1.4.1 VS Code 配置

VS Code 是目前最流行的 Rust 开发环境。

**安装步骤：**

1. 安装 VS Code
2. 安装 **rust-analyzer** 扩展（关键）
3. （可选）安装以下扩展：
   - **Even Better TOML** — TOML 语法高亮
   - **crates** — Cargo.toml 依赖版本管理
   - **CodeLLDB** — 调试器支持
   - **Error Lens** — 内联错误显示

**VS Code 配置建议（`.vscode/settings.json`）：**

```json
{
  "rust-analyzer.checkOnSave": true,
  "rust-analyzer.cargo.allFeatures": true,
  "editor.formatOnSave": true,
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  }
}
```

### 1.4.2 CLion + IntelliJ Rust

JetBrains CLion 配合 IntelliJ Rust 插件提供优秀的 Rust 支持。

- **CLion**：专业 C/C++ IDE，需付费（学生可免费）
- **IntelliJ IDEA + Rust 插件**：免费替代方案
- **RustRover**：JetBrains 专为 Rust 推出的 IDE（2024 年新发布）

### 1.4.3 其他编辑器

| 编辑器 | 支持方式 | 评价 |
|--------|---------|------|
| **Vim/NeoVim** | rust-analyzer + coc.nvim / LSP | 需要配置较多 |
| **Emacs** | rustic + lsp-mode | 功能完善 |
| **Helix** | 内置 LSP 支持 | 开箱即用，新兴编辑器 |
| **Zed** | 内置 Rust 支持 | 性能极佳，macOS 优先 |

> 💡 **新手推荐**：VS Code + rust-analyzer 是最低上手门槛的配置方案。

---

## 1.5 Rust 生态系统概览

### 1.5.1 crates.io — 包注册中心

[crates.io](https://crates.io/) 是 Rust 官方的包托管平台，类似于 npmjs.com 或 PyPI。

```bash
# 搜索包
cargo search serde

# 查看包信息
cargo search --limit 1 serde
```

在 `Cargo.toml` 中添加依赖：

```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
```

### 1.5.2 docs.rs — 文档托管

[docs.rs](https://docs.rs/) 自动为 crates.io 上的每个包生成文档。

- 访问 `https://docs.rs/包名` 即可查看文档
- 支持版本切换
- 提供源码链接和搜索功能

### 1.5.3 rustlings — 交互式学习

[rustlings](https://github.com/rust-lang/rustlings) 是官方推荐的交互式学习工具，包含 100+ 个小练习。

```bash
# 安装 rustlings
cargo install rustlings

# 启动练习
rustlings
```

### 1.5.4 常用第三方库速览

| 类别 | 库名 | 说明 |
|------|------|------|
| **序列化** | serde | 最流行的序列化框架 |
| **HTTP 客户端** | reqwest | 高层次的 HTTP 客户端 |
| **HTTP 服务端** | axum / actix-web | 主流 Web 框架 |
| **异步运行时** | tokio | 事实标准的异步运行时 |
| **数据库驱动** | sqlx / diesel | 异步/同步 ORM |
| **错误处理** | anyhow / thiserror | 简化错误处理 |
| **日志** | tracing / log | 日志与追踪 |
| **CLI 解析** | clap | 命令行参数解析 |
| **测试** | rstest | 增强版测试框架 |

### 1.5.5 学习资源

| 资源 | 地址 | 适合人群 |
|------|------|----------|
| **The Rust Book**（官方书） | [doc.rust-lang.org/book](https://doc.rust-lang.org/book/) | 所有人 |
| **Rust 圣经**（中文） | [course.rs](https://course.rs/) | 中文学习者 |
| **Rust by Example** | [doc.rust-lang.org/stable/rust-by-example](https://doc.rust-lang.org/stable/rust-by-example/) | 边做边学 |
| **Rustlings** | [github.com/rust-lang/rustlings](https://github.com/rust-lang/rustlings) | 动手实践 |
| **Rust 语言圣经**（Rusty Book） | [rusty.course.rs](https://rusty.course.rs/) | 深入进阶 |
| **标准库文档** | [doc.rust-lang.org/std](https://doc.rust-lang.org/std/) | 查 API |

### 1.5.6 社区资源

- **Reddit**：[r/rust](https://reddit.com/r/rust)
- **Discord**：[Rust Discord Server](https://discord.gg/rust-lang)
- **Rust 中文社区**：[rust.cc](https://rust.cc/)
- **This Week in Rust**：每周 Rust 社区周报
- **Rust 官方论坛**：[users.rust-lang.org](https://users.rust-lang.org/)

---

## 1.6 本章小结

本章我们完成了以下目标：

1. ✅ 了解 Rust 的核心特点：内存安全、零成本抽象、无畏并发
2. ✅ 使用 rustup 成功安装 Rust 工具链
3. ✅ 编写并运行了第一个 Rust 程序
4. ✅ 学习了 Cargo 的基本用法
5. ✅ 配置了 VS Code + rust-analyzer 开发环境
6. ✅ 了解了 Rust 生态中的重要工具和资源

**下一步**：进入第 2 章，学习 Rust 的基础语法和变量系统。

---

> 💡 **练习建议**：
> 1. 在 [rustlings](https://github.com/rust-lang/rustlings) 中完成 `intro` 部分的练习
> 2. 尝试用 `cargo new` 创建自己的项目，修改 `main.rs` 打印更多内容
> 3. 运行 `cargo fmt` 和 `cargo clippy` 体验 Rust 的代码工具链
