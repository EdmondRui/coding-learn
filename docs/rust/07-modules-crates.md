# 第7章 模块与包管理

> 本章学习 Rust 的代码组织系统：模块（module）、包（package）和 crate。掌握如何组织大型项目、管理依赖，以及使用 Cargo 的各项功能。

---

## 7.1 模块系统

### 7.1.1 模块的基本概念

Rust 的代码组织层次：

```
Package (包)
  ├── Crate (编译单元)
  │   ├── Module (模块)
  │   │   ├── Function (函数)
  │   │   ├── Struct (结构体)
  │   │   ├── Enum (枚举)
  │   │   ├── Trait (特征)
  │   │   └── Sub-module (子模块)
  │   └── ...
  └── ...
```

| 术语 | 说明 | 类比 |
|------|------|------|
| **Package** | 一个 `Cargo.toml` 定义的项目 | npm package |
| **Crate** | 编译的最小单元（lib 或 bin） | 一个编译目标 |
| **Module** | 代码的命名空间/组织单位 | 文件系统目录 |

### 7.1.2 定义模块

使用 `mod` 关键字定义模块：

```rust
// src/lib.rs 或 src/main.rs

mod front_of_house {
    mod hosting {
        fn add_to_waitlist() {}
        fn seat_at_table() {}
    }

    mod serving {
        fn take_order() {}
        fn serve_order() {}
        fn take_payment() {}
    }
}
```

### 7.1.3 模块树

上面定义的模块形成如下模块树：

```
crate
 └── front_of_house
     ├── hosting
     │   ├── add_to_waitlist
     │   └── seat_at_table
     └── serving
         ├── take_order
         ├── serve_order
         └── take_payment
```

### 7.1.4 路径（Paths）与可见性

引用模块中的项有两种路径方式：

```rust
mod front_of_house {
    pub mod hosting {
        pub fn add_to_waitlist() {}
        fn secret_recipe() {}  // 默认私有
    }
}

pub fn eat_at_restaurant() {
    // 绝对路径
    crate::front_of_house::hosting::add_to_waitlist();

    // 相对路径（以 self, super 或当前模块名开头）
    front_of_house::hosting::add_to_waitlist();
}
```

**可见性规则：**

| 可见性 | 语法 | 说明 |
|--------|------|------|
| 私有（默认） | 无修饰符 | 仅当前模块及其子模块可访问 |
| 公有 | `pub` | 所有模块可访问 |
| 受限 | `pub(crate)` | 仅当前 crate 内可见 |
| 受限 | `pub(super)` | 仅父模块可见 |
| 受限 | `pub(in path)` | 仅指定路径可见 |

```rust
pub mod outer {
    pub mod inner {
        // 仅在当前 crate 内可见
        pub(crate) fn crate_only() {}

        // 仅在父模块（outer）内可见
        pub(super) fn parent_only() {}

        // 仅在指定路径内可见
        pub(in crate::outer) fn restricted() {}
    }
}
```

### 7.1.5 super 与 self

```rust
mod parent {
    pub fn parent_fn() {}

    mod child {
        fn child_fn() {
            // super 指向父模块
            super::parent_fn();

            // self 指向当前模块
            // self::child_fn();  // 递归调用
        }
    }
}

fn main() {
    // 使用 super 从根模块（crate）访问
    // super::parent::parent_fn();  // 在根模块中，super 无效
    crate::parent::parent_fn();  // 绝对路径
}
```

---

## 7.2 文件系统与模块

### 7.2.1 单文件模块

当模块较小时，可以直接定义在同一个文件中：

```rust
// src/lib.rs
mod math {
    pub fn add(a: i32, b: i32) -> i32 { a + b }
    pub fn sub(a: i32, b: i32) -> i32 { a - b }
}

mod string_utils {
    pub fn capitalize(s: &str) -> String {
        s[..1].to_uppercase() + &s[1..]
    }
}
```

### 7.2.2 分离文件模块

**方式一：`mod.rs` 风格（Rust 2015 经典，仍支持）**

```
src/
├── lib.rs
└── front_of_house/
    ├── mod.rs
    └── hosting.rs
```

```rust
// src/lib.rs
mod front_of_house;  // 告诉编译器查找 front_of_house/mod.rs

// src/front_of_house/mod.rs
pub mod hosting;  // 告诉编译器查找 hosting.rs

pub fn eat_at_restaurant() {
    hosting::add_to_waitlist();
}

// src/front_of_house/hosting.rs
pub fn add_to_waitlist() {}
```

**方式二：模块名目录风格（Rust 2018 推荐，当前主流）**

```
src/
├── lib.rs
├── front_of_house.rs
└── front_of_house/
    └── hosting.rs
```

```rust
// src/lib.rs
pub mod front_of_house;  // 查找 front_of_house.rs 或 front_of_house/mod.rs

// src/front_of_house.rs
pub mod hosting;  // 查找 front_of_house/hosting.rs

// src/front_of_house/hosting.rs
pub fn add_to_waitlist() {}
```

> 💡 **建议**：新项目使用 Rust 2018 风格的模块组织（`模块名.rs` + `模块名/` 目录），更直观。

---

## 7.3 pub use 重新导出

`pub use` 可以将一个项从内部模块**重新导出**到外部，简化调用者的使用路径：

```rust
// 不使用 pub use
mod front_of_house {
    pub mod hosting {
        pub fn add_to_waitlist() {}
    }
}

fn main() {
    // 需要完整的路径
    crate::front_of_house::hosting::add_to_waitlist();
}
```

```rust
// 使用 pub use
mod front_of_house {
    pub mod hosting {
        pub fn add_to_waitlist() {}
    }
}

pub use crate::front_of_house::hosting;

fn main() {
    // 更简洁的调用
    hosting::add_to_waitlist();
}

// 外部使用者也可以直接 use my_crate::hosting;
```

**典型应用场景：**

```rust
// 标准库中的 std::io::Result 实际上是这样来的：
// pub use self::error::Result;

// 常见的库结构：
// src/lib.rs
mod models;
mod services;
mod utils;

// 对外暴露简洁的 API
pub use models::user::User;
pub use services::auth::AuthService;
pub use utils::validation::validate_email;
```

---

## 7.4 Crate 类型

### 7.4.1 二进制 Crate（Binary Crate）

```rust
// src/main.rs — 可执行程序入口
fn main() {
    println!("Hello, world!");
}
```

`Cargo.toml` 中：

```toml
[package]
name = "my_app"
version = "0.1.0"
edition = "2021"

# 默认就是 bin crate，也可以显式指定
[[bin]]
name = "my_app"
path = "src/main.rs"
```

### 7.4.2 库 Crate（Library Crate）

```rust
// src/lib.rs — 库的根模块
pub fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}

pub mod math;
pub mod network;
```

`Cargo.toml` 中：

```toml
[package]
name = "my_lib"
version = "0.1.0"
edition = "2021"

[lib]
name = "my_lib"
path = "src/lib.rs"
```

### 7.4.3 混合 Crate

一个 package 可以同时包含 `src/main.rs` 和 `src/lib.rs`：

```
my_project/
├── Cargo.toml
├── src/
│   ├── main.rs    # — 二进制入口
│   └── lib.rs     # — 库入口
```

```rust
// src/lib.rs
pub fn utility_function() {
    println!("库函数被调用");
}

// src/main.rs
use my_project::utility_function;

fn main() {
    utility_function();
    println!("主程序运行");
}
```

### 7.4.4 多二进制文件

```toml
[package]
name = "my_tools"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "server"
path = "src/bin/server.rs"

[[bin]]
name = "client"
path = "src/bin/client.rs"

[[bin]]
name = "cli"
path = "src/bin/cli.rs"
```

```
src/
├── lib.rs          # 共享的库代码
└── bin/
    ├── server.rs
    ├── client.rs
    └── cli.rs
```

运行特定二进制：

```bash
cargo run --bin server
cargo run --bin client
```

---

## 7.5 Cargo.toml 配置详解

### 7.5.1 基本配置

```toml
[package]
name = "my_project"          # 项目名（也是 crate 名）
version = "0.1.0"            # 语义化版本
edition = "2021"             # Rust 版本（2015 / 2018 / 2021 / 2024）
authors = ["Alice <alice@example.com>"]
description = "一个示例项目"
license = "MIT"
readme = "README.md"
homepage = "https://example.com/"
repository = "https://github.com/user/repo"
documentation = "https://docs.rs/my_project"
keywords = ["rust", "example"]
categories = ["command-line-utilities"]
```

### 7.5.2 Rust Edition 说明

| Edition | 发布年份 | 主要变化 |
|---------|---------|---------|
| 2015 | Rust 1.0 | 初始版本，`mod.rs` 模块风格 |
| 2018 | Rust 1.31 | NLL、模块路径简化、`impl Trait` |
| 2021 | Rust 1.56 | 闭包捕获改进、`IntoIterator`、新版 Cargo |
| 2024 | Rust 1.85 (计划) | 更多改进（写作时预览中） |

```toml
[package]
name = "my_project"
version = "0.1.0"
edition = "2021"  # 建议新项目使用 2021
```

### 7.5.3 依赖配置

```toml
[dependencies]
# 简单方式：从 crates.io 获取
serde = "1.0"

# 指定 features
serde = { version = "1.0", features = ["derive"] }

# 可选依赖
serde = { version = "1.0", optional = true }

# Git 依赖
tokio = { git = "https://github.com/tokio-rs/tokio", branch = "master" }

# 本地路径依赖
my_lib = { path = "../my_lib" }

# 禁止默认 features
regex = { version = "1", default-features = false, features = ["unicode"] }

[dev-dependencies]
# 仅在测试、示例、benchmarks 中使用的依赖
pretty_assertions = "1"

[build-dependencies]
# 构建脚本使用的依赖
cc = "1"
```

### 7.5.4 Feature 配置

```toml
[features]
# 定义 feature 开关
default = ["std"]
std = []
async = ["tokio"]
full = ["std", "async"]

# 条件依赖
[dependencies]
tokio = { version = "1", optional = true }
```

代码中使用：

```rust
// 在代码中检查 feature
#[cfg(feature = "async")]
fn async_function() {
    // ...
}

#[cfg(not(feature = "std"))]
fn no_std_function() {
    // ...
}
```

### 7.5.5 Profile 配置

```toml
[profile.dev]
opt-level = 0          # 优化级别，0-3
debug = true           # 调试信息
lto = false            # 链接时优化
overflow-checks = true # 整数溢出检查

[profile.release]
opt-level = 3          # 最高优化
debug = false          # 无调试信息
lto = true             # 链接时优化
codegen-units = 1      # 单代码生成单元（更优优化）
strip = "symbols"      # 去除符号表
overflow-checks = false # 关闭溢出检查（性能）
```

---

## 7.6 版本号与依赖管理

### 7.6.1 语义化版本控制（SemVer）

Rust 严格遵循 [SemVer 2.0](https://semver.org/)：

```
主版本.次版本.补丁版本
  ^      ^      ^
  |      |      └── 向后兼容的 bug 修复
  |      └───────── 向后兼容的新功能
  └─────────────── 不兼容的 API 变更
```

### 7.6.2 版本号指定方式

```toml
[dependencies]
# 精确版本
serde = "=1.2.3"
# 兼容：>=1.0.0, <2.0.0（默认的 ^ 语义）
serde = "1.0"         # 相当于 ^1.0.0
serde = "1.2"         # 相当于 ^1.2.0
serde = "^1.2.3"      # >=1.2.3, <2.0.0

# 兼容补丁：>=1.2.3, <1.3.0
serde = "~1.2.3"

# 范围
serde = ">=1.2, <1.5"

# 通配符
serde = "1.*"
serde = "*"           # 任何版本（不推荐）
```

### 7.6.3 Cargo.lock

`Cargo.lock` 文件记录了所有依赖的精确版本号，确保构建**可重现**：

- **二进制项目**：将 `Cargo.lock` 提交到版本控制 ✅
- **库项目**：通常不提交 `Cargo.lock`（开发库时在 `.gitignore` 中添加）

```bash
# 更新依赖
cargo update              # 更新补丁版本
cargo update -p serde     # 更新指定包

# 查看依赖树
cargo tree
cargo tree --duplicate    # 查看重复依赖
cargo tree -i serde       # 反向查看谁依赖了 serde
```

### 7.6.4 常见版本管理命令

```bash
# 添加依赖（Cargo 1.62+）
cargo add serde
cargo add serde --features derive
cargo add serde --dev         # dev-dependency
cargo add serde --build       # build-dependency
cargo add serde --optional    # optional dependency

# 移除依赖
cargo remove serde

# 升级依赖
cargo upgrade              # 需要 cargo-edit 插件
```

---

## 7.7 工作空间（Workspace）

### 7.7.1 什么是 Workspace

工作空间将多个相关的 package 组织在一起，共享一个 `Cargo.lock` 和 `target` 目录：

```
my_workspace/
├── Cargo.toml          # 工作空间根配置
├── Cargo.lock
├── api/
│   ├── Cargo.toml
│   └── src/
│       └── main.rs
├── core/
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
└── utils/
    ├── Cargo.toml
    └── src/
        └── lib.rs
```

### 7.7.2 配置 Workspace

```toml
# 根目录的 Cargo.toml
[workspace]
members = [
    "api",
    "core",
    "utils",
]

# 可选：排除某些目录
exclude = [
    "legacy"
]

# 可选：统一配置
[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["Alice <alice@example.com>"]

[workspace.dependencies]
serde = "1.0"
tokio = "1"
```

### 7.7.3 在子 package 中引用 workspace 配置

```toml
# api/Cargo.toml
[package]
name = "api"
version.workspace = true
edition.workspace = true

[dependencies]
# 引用 workspace 级别的依赖
serde.workspace = true
tokio.workspace = true
core = { path = "../core" }
utils = { path = "../utils" }
```

### 7.7.4 Workspace 命令

```bash
# 构建整个 workspace
cargo build --workspace

# 构建指定 package
cargo build -p api

# 运行测试（所有 crate）
cargo test --workspace

# 运行指定 crate 的测试
cargo test -p core

# 运行指定 binary
cargo run -p api

# 查看依赖树
cargo tree -p api
```

### 7.7.5 Workspace 的优势

| 优势 | 说明 |
|------|------|
| **共享编译缓存** | 所有 crates 共享 `target/` 目录，避免重复编译 |
| **统一依赖版本** | 所有 crates 共享 `Cargo.lock`，避免版本冲突 |
| **便捷管理** | 一次 `cargo build` 编译全部，`cargo test` 测试全部 |
| **内部依赖** | crates 之间可以通过 `path` 相互依赖，无需发布 |
| **统一配置** | 可以在 workspace 级别统一 edition、依赖版本 |

---

## 7.8 常用 Cargo 命令

### 7.8.1 构建与运行

| 命令 | 说明 |
|------|------|
| `cargo build` | 构建项目（debug 模式） |
| `cargo build --release` | 构建项目（release 模式，优化） |
| `cargo check` | 仅检查代码能否编译（比 build 快） |
| `cargo run` | 构建并运行 |
| `cargo run -- arg1 arg2` | 运行并传递参数 |
| `cargo watch -x run` | 文件变更时自动重跑（需安装 `cargo-watch`） |

### 7.8.2 测试

| 命令 | 说明 |
|------|------|
| `cargo test` | 运行所有测试 |
| `cargo test test_name` | 运行名称匹配的测试 |
| `cargo test -- --nocapture` | 显示测试中的 println 输出 |
| `cargo test -- --test-threads=1` | 单线程运行测试 |
| `cargo test --doc` | 运行文档测试（doc-test） |

### 7.8.3 代码质量

| 命令 | 说明 | 示例 |
|------|------|------|
| `cargo fmt` | 格式化代码 | `cargo fmt -- --check`（仅检查） |
| `cargo clippy` | 代码 lint | `cargo clippy -- -W clippy::pedantic` |
| `cargo fix` | 自动修复编译警告 | `cargo fix --edition`（升级 edition） |

### 7.8.4 文档

| 命令 | 说明 |
|------|------|
| `cargo doc` | 生成文档 |
| `cargo doc --open` | 生成文档并在浏览器打开 |
| `cargo doc --no-deps` | 仅生成当前 crate 的文档（不包括依赖） |
| `cargo doc -p my_crate` | 生成指定 crate 的文档 |

### 7.8.5 发布

| 命令 | 说明 |
|------|------|
| `cargo login` | 登录 crates.io |
| `cargo publish` | 发布当前 crate 到 crates.io |
| `cargo publish --dry-run` | 模拟发布（不实际推送） |
| `cargo yank --vers 1.0.1` | 撤回指定版本（标记为不可用） |
| `cargo owner --add github:user:team` | 添加 crate 所有者 |

### 7.8.6 其他实用命令

| 命令 | 说明 |
|------|------|
| `cargo tree` | 展示依赖树 |
| `cargo outdated` | 检查过时的依赖（需 `cargo-outdated`） |
| `cargo audit` | 检查依赖中的安全漏洞（需 `cargo-audit`） |
| `cargo udeps` | 查找未使用的依赖（需 `cargo-udeps`） |
| `cargo expand` | 展开宏（需 `cargo-expand`，对学习宏非常有帮助） |
| `cargo info` | 查看 crate 的详细信息（需 `cargo-info`） |

### 7.8.7 安装 Cargo 插件

```bash
# 安装常用的 cargo 扩展
cargo install cargo-watch
cargo install cargo-edit
cargo install cargo-outdated
cargo install cargo-audit
cargo install cargo-udeps
cargo install cargo-expand
cargo install cargo-info
```

---

## 7.9 综合示例

一个完整的多模块项目结构：

```
my_blog/
├── Cargo.toml
├── src/
│   ├── main.rs              # 二进制入口
│   ├── lib.rs                # 库入口
│   ├── config.rs             # 配置模块
│   ├── models/
│   │   ├── mod.rs
│   │   ├── post.rs
│   │   └── user.rs
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── posts.rs
│   │   └── users.rs
│   └── utils/
│       ├── mod.rs
│       ├── validation.rs
│       └── formatting.rs
└── tests/
    └── integration_test.rs
```

```toml
# Cargo.toml
[package]
name = "my_blog"
version = "0.1.0"
edition = "2021"
description = "一个简单的博客系统"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
axum = "0.7"
sqlx = { version = "0.8", features = ["runtime-tokio", "postgres"] }
tracing = "0.1"
tracing-subscriber = "0.3"
anyhow = "1"
thiserror = "2"

[dev-dependencies]
pretty_assertions = "1"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
```

```rust
// src/lib.rs — 重新导出公共 API
pub mod config;
pub mod models;
pub mod handlers;
pub mod utils;

// 重新导出常用类型
pub use config::AppConfig;
pub use models::post::Post;
pub use models::user::User;
pub use handlers::router;
```

```rust
// src/models/mod.rs
pub mod post;
pub mod user;
```

```rust
// src/models/post.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Post {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub author_id: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl Post {
    pub fn new(title: String, content: String, author_id: i64) -> Self {
        Self {
            id: 0, // 将由数据库分配
            title,
            content,
            author_id,
            created_at: chrono::Utc::now(),
        }
    }

    pub fn excerpt(&self, max_len: usize) -> &str {
        if self.content.len() <= max_len {
            &self.content
        } else {
            &self.content[..max_len]
        }
    }
}
```

```rust
// src/main.rs
use anyhow::Result;
use my_blog::AppConfig;
use tracing_subscriber::fmt;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    fmt::init();

    // 加载配置
    let config = AppConfig::from_env()?;
    tracing::info!("配置加载成功");

    // 启动服务
    let app = my_blog::router(config).await?;
    tracing::info!("服务已启动");

    Ok(())
}
```

---

## 7.10 本章小结

| 概念 | 要点 |
|------|------|
| **模块** | `mod` 定义，`pub` 控制可见性，文件系统组织 |
| **路径** | 绝对路径（`crate::`），相对路径（`self::`, `super::`） |
| **pub use** | 重新导出简化 API 接口 |
| **Crate** | bin crate（可执行），lib crate（库），可以混合 |
| **Cargo.toml** | 配置包名、版本、依赖、features、profile |
| **SemVer** | `^` `~` `*` 版本约束，`Cargo.lock` 锁定精确版本 |
| **Workspace** | 多 package 共享编译缓存和依赖版本 |
| **Cargo 命令** | build/test/fmt/clippy/doc/publish/tree 等 |

**下一步**：进入第 8 章，学习 Rust 的集合类型与迭代器。

---

> 💡 **练习建议**：
> 1. 创建一个包含 3 个模块的小项目（如 `utils/`, `models/`, `services/`）
> 2. 将上一步的项目改为 workspace 结构，分成 `core` 和 `api` 两个 crate
> 3. 使用 `cargo add` 添加 `serde` 依赖并尝试使用 `#[derive(Serialize)]`
> 4. 运行 `cargo tree` 查看依赖树，确认理解依赖关系
> 5. 在 [rustlings](https://github.com/rust-lang/rustlings) 中完成 `modules` 部分的练习
