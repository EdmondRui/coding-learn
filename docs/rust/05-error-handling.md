# 第5章 错误处理

> 本章学习 Rust 的错误处理哲学与实践。Rust 将错误分为**可恢复错误**（recoverable）和**不可恢复错误**（unrecoverable），分别用 `Result<T, E>` 和 `panic!` 处理。掌握正确的错误处理方法是写出健壮 Rust 程序的关键。

---

## 5.1 错误处理哲学

### 5.1.1 Rust 的错误分类

Rust 没有异常机制（如 C++ 的 `try/catch` 或 Python 的 `try/except`），而是将错误分为两类：

| 错误类型 | 处理方式 | 使用场景 |
|----------|---------|---------|
| **可恢复错误** | `Result<T, E>` | 文件未找到、网络超时、解析失败 |
| **不可恢复错误** | `panic!` | 数组越界、除零、违反不变式 |

```rust
// 可恢复错误 — 调用者决定如何处理
fn read_file(path: &str) -> Result<String, std::io::Error> {
    std::fs::read_to_string(path)
}

// 不可恢复错误 — 程序应当立即终止
fn divide(a: i32, b: i32) -> i32 {
    if b == 0 {
        panic!("除数不能为零！");
    }
    a / b
}
```

> 💡 Rust 的设计理念：错误应该被显式处理，而不是像异常那样隐式传播。

### 5.1.2 与异常机制的对比

| 特性 | Rust `Result` | C++/Java 异常 |
|------|--------------|--------------|
| 类型安全 | ✅ 函数签名显式标注 | ❌ 可抛出任意类型 |
| 调用者必须处理 | ✅ 编译器强制 | ❌ 可能被忽略 |
| 性能开销 | ✅ 无运行时开销 | ❌ 栈展开有成本 |
| 控制流清晰度 | ✅ 显式 match | ❌ 可能跳转到任意位置 |

---

## 5.2 Result 与 ? 运算符

### 5.2.1 Result 类型

`Result<T, E>` 是标准库提供的一个枚举：

```rust
enum Result<T, E> {
    Ok(T),   // 成功，包含值
    Err(E),  // 失败，包含错误
}
```

### 5.2.2 使用 match 处理 Result

```rust
use std::fs::File;
use std::io::{self, Read};

fn read_username_from_file(path: &str) -> Result<String, io::Error> {
    let file_result = File::open(path);

    let mut file = match file_result {
        Ok(file) => file,
        Err(e) => return Err(e),
    };

    let mut username = String::new();
    match file.read_to_string(&mut username) {
        Ok(_) => Ok(username),
        Err(e) => Err(e),
    }
}
```

### 5.2.3 ? 运算符

`?` 运算符是 Rust 为简化错误传播提供的语法糖：

```rust
use std::fs::File;
use std::io::{self, Read};

fn read_username_from_file(path: &str) -> Result<String, io::Error> {
    let mut file = File::open(path)?;  // 如果 Err，提前返回
    let mut username = String::new();
    file.read_to_string(&mut username)?;
    Ok(username)
}

// 更简洁的写法：链式调用
fn read_username_chain(path: &str) -> Result<String, io::Error> {
    let mut username = String::new();
    File::open(path)?.read_to_string(&mut username)?;
    Ok(username)
}

// 最简写法：使用 std::fs::read_to_string
fn read_username_simple(path: &str) -> Result<String, io::Error> {
    std::fs::read_to_string(path)
}
```

> 💡 `?` 运算符的作用：如果 `Result` 是 `Ok`，解包出值；如果是 `Err`，将错误**转换后**返回。这个转换通过 `From<E>` trait 实现，所以不同的错误类型可以被自动转换为函数返回的类型。

### 5.2.4 ? 运算符的原理

```rust
// File::open(path)? 相当于：
let file = match File::open(path) {
    Ok(f) => f,
    Err(e) => return Err(From::from(e)),  // 自动错误类型转换
};
```

### 5.2.5 ? 与 main 函数

`main` 函数也可以返回 `Result`：

```rust
use std::error::Error;
use std::fs::File;

fn main() -> Result<(), Box<dyn Error>> {
    let _file = File::open("config.toml")?;
    Ok(())
}
```

---

## 5.3 自定义错误类型

### 5.3.1 实现 std::error::Error

```rust
use std::error::Error;
use std::fmt;

#[derive(Debug)]
struct MyError {
    details: String,
}

impl MyError {
    fn new(msg: &str) -> MyError {
        MyError {
            details: msg.to_string(),
        }
    }
}

impl fmt::Display for MyError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "MyError: {}", self.details)
    }
}

impl Error for MyError {
    fn description(&self) -> &str {
        &self.details
    }
}

// 使用自定义错误
fn do_something(flag: bool) -> Result<(), MyError> {
    if flag {
        Ok(())
    } else {
        Err(MyError::new("操作失败"))
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    do_something(false)?;
    Ok(())
}
```

### 5.3.2 枚举式自定义错误

实际项目中，通常用枚举表示多种错误类型：

```rust
use std::fmt;
use std::error::Error;

#[derive(Debug)]
enum DataError {
    NotFound(String),
    PermissionDenied,
    ParseError { field: String, value: String },
    IoError(std::io::Error),  // 包装其他错误
}

impl fmt::Display for DataError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            DataError::NotFound(id) => write!(f, "数据未找到: {id}"),
            DataError::PermissionDenied => write!(f, "权限不足"),
            DataError::ParseError { field, value } => {
                write!(f, "解析错误: 字段 '{field}' 的值 '{value}' 无效")
            }
            DataError::IoError(e) => write!(f, "IO 错误: {e}"),
        }
    }
}

impl Error for DataError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            DataError::IoError(e) => Some(e),
            _ => None,
        }
    }
}

// 实现 From trait 以便 ? 运算符自动转换
impl From<std::io::Error> for DataError {
    fn from(e: std::io::Error) -> Self {
        DataError::IoError(e)
    }
}
```

---

## 5.4 thiserror 与 anyhow

这两个是 Rust 生态中最流行的错误处理库，大幅简化了错误处理的代码。

### 5.4.1 thiserror — 定义库的错误类型

适用于**库开发者**，系统化地定义错误类型：

```toml
[dependencies]
thiserror = "2"
```

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum MyLibError {
    #[error("数据未找到: {0}")]
    NotFound(String),

    #[error("权限不足")]
    PermissionDenied,

    #[error("解析错误: {field}: {value}")]
    ParseError {
        field: String,
        value: String,
    },

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),  // 自动实现 From trait
}

// 使用 thiserror 后，不需要手动实现 Display、Error、From
fn read_config(path: &str) -> Result<String, MyLibError> {
    let content = std::fs::read_to_string(path)?;  // 自动转换
    if content.is_empty() {
        return Err(MyLibError::NotFound(path.to_string()));
    }
    Ok(content)
}
```

| 功能 | 手动实现 | thiserror |
|------|---------|-----------|
| `Display` | 手写 `fmt::Display` | `#[error("...")]` 自动生成 |
| `Error` trait | 手动 `impl Error` | `#[derive(Error)]` 自动生成 |
| `From` trait | 手动 `impl From<...>` | `#[from]` 自动生成 |
| 代码量 | 约 50 行 / 每种错误 | 仅需属性宏 |

### 5.4.2 anyhow — 简化应用层错误处理

适用于**应用程序开发者**，不需要关心具体错误类型：

```toml
[dependencies]
anyhow = "1"
```

```rust
use anyhow::{anyhow, Context, Result};

// 使用 anyhow::Result 替代 std::result::Result<_, Box<dyn Error>>
fn read_user_config() -> Result<String> {
    let path = "/etc/app/config.toml";
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("无法读取配置文件: {path}"))?;

    if content.is_empty() {
        return Err(anyhow!("配置文件为空: {path}"));
    }

    Ok(content)
}

fn process_data() -> Result<()> {
    let config = read_user_config()?;
    println!("配置文件内容: {config}");
    Ok(())
}

fn main() -> Result<()> {
    process_data()?;
    Ok(())
}
```

**anyhow 核心 API：**

| API | 用途 | 示例 |
|-----|------|------|
| `anyhow!()` | 创建任意错误 | `anyhow!("失败: {reason}")` |
| `bail!()` | 提前返回错误 | `bail!("条件不满足")` |
| `Context::context()` | 为错误添加上下文 | `err.context("读取失败")` |
| `Context::with_context()` | 惰性上下文 | `err.with_context(|| format!("..."))` |
| `Result<T>` | 类型别名 | `anyhow::Result<T>` ≡ `Result<T, anyhow::Error>` |

### 5.4.3 选择指南

| 场景 | 推荐 | 原因 |
|------|------|------|
| **库开发** | `thiserror` | 使用者需要知道具体错误类型 |
| **应用开发** | `anyhow` | 关注"发生了什么"，不关心具体类型 |
| **混合项目** | 两者都用 | 库用 thiserror，应用用 anyhow 包装 |
| **简单脚本** | `Box<dyn Error>` | 依赖最少，足够使用 |

```rust
// 最佳实践：库（thiserror）+ 应用（anyhow）
// lib.rs — 库代码
use thiserror::Error;

#[derive(Error, Debug)]
pub enum LibError {
    #[error("网络错误: {0}")]
    Network(String),
    #[error("解析错误")]
    Parse,
}

pub fn lib_function() -> Result<(), LibError> {
    // ...
    Ok(())
}

// main.rs — 应用代码
use anyhow::Result;

fn main() -> Result<()> {
    lib_function()?;  // LibError 自动转换为 anyhow::Error
    Ok(())
}
```

---

## 5.5 错误处理最佳实践

### 5.5.1 函数签名设计

```rust
// ❌ 坏实践：丢失错误信息
fn get_data() -> Option<String> {
    let data = std::fs::read_to_string("data.txt").ok()?;
    Some(data)
}

// ✅ 好实践：保留错误信息
fn get_data() -> Result<String, std::io::Error> {
    std::fs::read_to_string("data.txt")
}

// ✅ 对于复杂场景，使用自定义错误
fn get_data() -> Result<String, AppError> {
    let raw = std::fs::read_to_string("data.txt")?;
    let parsed = parse_data(&raw)?;
    Ok(parsed)
}
```

### 5.5.2 何时使用 unwrap / expect

`unwrap()` 和 `expect()` 在失败时会 `panic!`，应谨慎使用：

```rust
// ❌ 不要在生产代码中不加思考地使用 unwrap
let data = std::fs::read_to_string("config.txt").unwrap();

// ✅ 在以下场景可以接受：
// 1. 测试代码
#[test]
fn test_addition() {
    let result = "42".parse::<i32>().unwrap();
    assert_eq!(result, 42);
}

// 2. 程序启动时的配置加载（失败即退出）
fn load_config() -> Config {
    let content = std::fs::read_to_string("app.toml")
        .expect("应用配置文件 app.toml 不存在或无法读取");
    toml::from_str(&content)
        .expect("应用配置文件格式无效")
}

// 3. 已知不会失败的操作
let days = "Monday".parse::<String>().unwrap();  // 不会失败
```

### 5.5.3 提供有意义的上下文

```rust
use anyhow::{Context, Result};
use std::fs;

// ❌ 坏实践：抛出原始错误
fn read_score() -> Result<String> {
    fs::read_to_string("/data/score.txt")
        .map_err(|e| anyhow::anyhow!(e))
}

// ✅ 好实践：添加上下文
fn read_score() -> Result<String> {
    fs::read_to_string("/data/score.txt")
        .with_context(|| "读取成绩文件失败: /data/score.txt")
}
```

### 5.5.4 错误处理模式速查

| 模式 | 代码 | 说明 |
|------|------|------|
| 传播错误 | `foo()?` | 把错误交给调用者 |
| 提供默认值 | `foo().unwrap_or(default)` | 失败时用默认值 |
| 提供默认值（闭包） | `foo().unwrap_or_else(\|\| default())` | 惰性求值默认值 |
| 转换为 Option | `foo().ok()` | 丢失错误信息 |
| 记录日志并继续 | `if let Err(e) = foo() { log::error!("{e}"); }` | 不中断执行 |
| 重试 | `retry(foo)` | 自定义重试逻辑 |
| 包装错误 | `foo().map_err(\|e\| MyError::from(e))` | 错误类型转换 |
| 断言成功 | `foo().expect("消息")` | 失败即 panic |

### 5.5.5 错误类型转换

```rust
use std::fmt;
use std::error::Error;

#[derive(Debug)]
enum AppError {
    Io(std::io::Error),
    Parse(String),
}

// 实现 From 使 ? 运算符可以自动转换
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl fmt::Display for AppError { /* ... */ }
impl Error for AppError { /* ... */ }

fn read_and_parse(path: &str) -> Result<i32, AppError> {
    let content = std::fs::read_to_string(path)?;  // io::Error -> AppError
    content
        .trim()
        .parse::<i32>()
        .map_err(|e| AppError::Parse(e.to_string()))  // 手动转换
}
```

---

## 5.6 panic! 与 unwrap

### 5.6.1 panic! 宏

`panic!` 用于不可恢复的错误，它会打印错误信息、展开（unwind）栈并清理资源，然后退出程序：

```rust
fn main() {
    panic!("出现严重错误！");
    // 输出: thread 'main' panicked at src/main.rs:2:5:
    // 出现严重错误！
}
```

### 5.6.2 panic! 的两种行为

| 模式 | 设置方式 | 行为 |
|------|---------|------|
| **Unwind**（默认） | `panic = "unwind"` | 展开栈，调用析构函数，清理资源 |
| **Abort** | `panic = "abort"` | 直接终止，不清理（二进制更小） |

在 `Cargo.toml` 中设置：

```toml
[profile.release]
panic = "abort"  # 发布模式直接终止，减小体积
```

### 5.6.3 使用 assert!

```rust
fn main() {
    let a = 5;
    let b = 10;

    assert!(a < b, "a = {a} 应该小于 b = {b}");

    // assert_eq! 和 assert_ne!
    assert_eq!(a + b, 15);
    assert_ne!(a, b);

    // debug_assert! — 仅在 debug 模式下检查
    debug_assert!(a > 0);
}
```

### 5.6.4 使用 unreachable!

当编译器无法推断某段代码不可达时，用 `unreachable!` 明确标记：

```rust
fn process_status(status: u8) -> &'static str {
    match status {
        0 => "待处理",
        1 => "处理中",
        2 => "已完成",
        _ => unreachable!("状态值只能为 0, 1, 2，收到: {status}"),
    }
}
```

### 5.6.5 todo! 与 unimplemented!

开发阶段用于标记未完成的功能：

```rust
fn complex_calculation() -> f64 {
    todo!("复杂计算尚未实现")
}

fn main() {
    // complex_calculation();  // 调用会 panic
}
```

---

## 5.7 综合示例

一个完整的文件处理示例，展示各种错误处理技术的综合应用：

```rust
use std::fs;
use std::path::Path;
use thiserror::Error;

// 定义库错误类型
#[derive(Error, Debug)]
pub enum FileError {
    #[error("文件未找到: {0}")]
    NotFound(String),

    #[error("权限不足: {0}")]
    PermissionDenied(String),

    #[error("解析错误: {0}")]
    ParseError(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
}

// 核心业务函数
fn process_score_file(path: &str) -> Result<Vec<u32>, FileError> {
    let content = fs::read_to_string(path)?;

    let mut scores = Vec::new();
    for (line_num, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;  // 跳过空白和注释
        }
        let score: u32 = trimmed
            .parse()
            .map_err(|_| FileError::ParseError(
                format!("第 {} 行不是有效数字: '{trimmed}'", line_num + 1)
            ))?;
        scores.push(score);
    }

    Ok(scores)
}

fn calculate_average(scores: &[u32]) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }
    scores.iter().sum::<u32>() as f64 / scores.len() as f64
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    let path = args.get(1)
        .ok_or("用法: cargo run <文件路径>")?;

    if !Path::new(path).exists() {
        return Err(Box::new(FileError::NotFound(path.to_string())));
    }

    match process_score_file(path) {
        Ok(scores) => {
            println!("成功读取 {} 个成绩", scores.len());
            println!("平均分: {:.1}", calculate_average(&scores));

            if let Some(max) = scores.iter().max() {
                println!("最高分: {max}");
            }
            if let Some(min) = scores.iter().min() {
                println!("最低分: {min}");
            }
        }
        Err(e) => {
            eprintln!("处理文件失败: {e}");
            std::process::exit(1);
        }
    }

    Ok(())
}
```

---

## 5.8 本章小结

| 概念 | 要点 |
|------|------|
| **可恢复 vs 不可恢复** | `Result<T, E>` 处理可恢复错误，`panic!` 处理不可恢复错误 |
| **`?` 运算符** | 自动传播错误，支持类型转换 |
| **自定义错误** | 实现 `Display` + `Error` + `From`（或使用 thiserror） |
| **thiserror** | 库开发首选，派生宏定义错误类型 |
| **anyhow** | 应用开发首选，简化错误上下文 |
| **unwrap/expect** | 测试和"不会失败"的场景使用，否则避免 |
| **错误上下文** | `.context()` 为错误添加有意义的信息 |

**下一步**：进入第 6 章，学习 Rust 的特征（Traits）与泛型系统，这是实现多态和代码复用的核心工具。

---

> 💡 **练习建议**：
> 1. 将第 4 章的计算器程序改为返回 `Result` 而非直接 panic
> 2. 使用 `thiserror` 定义一个包含 3 种以上变体的错误枚举
> 3. 编写一个读取 JSON 配置文件的函数，使用 `anyhow` 提供丰富的错误上下文
> 4. 在 [rustlings](https://github.com/rust-lang/rustlings) 中完成 `errors` 部分的练习
