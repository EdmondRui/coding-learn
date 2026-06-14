# 第16章：命令行工具开发

> 目标读者：掌握 Rust 基础语法、错误处理、模块化编程的开发者

---

## 16.1 为什么用 Rust 开发 CLI 工具

Rust 是构建命令行工具的绝佳语言：编译为原生二进制、无需运行时依赖、出色的跨平台支持、以及丰富的 CLI 生态。

| 优势 | 说明 |
|------|------|
| **绿色二进制** | 编译后单文件，无任何运行时依赖（对比 Node/Python） |
| **跨平台** | 轻松交叉编译到 Linux/macOS/Windows |
| **性能** | 处理大量数据或管道时接近 C 的性能 |
| **安全** | 内存安全保证了处理用户输入时无缓冲区溢出风险 |
| **生态** | clap、serde、colored、indicatif 等成熟库 |

**知名 Rust CLI 工具：**
- `bat` — `cat` 的替代（语法高亮）
- `ripgrep (rg)` — 超快的代码搜索
- `fd` — `find` 的替代
- `delta` — Git diff 查看器
- `dust` — 磁盘空间分析

---

## 16.2 项目结构与命令行参数解析（clap）

### 16.2.1 项目初始化

```toml
[package]
name = "mycli"
version = "0.1.0"
edition = "2021"

[dependencies]
clap = { version = "4", features = ["derive"] }  # 派生宏方式
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "2"
```

### 16.2.2 clap 派生宏方式

clap 提供了两种 API：Builder API 和 Derive API。推荐使用 Derive API，代码更简洁：

```rust
use clap::{Parser, Subcommand, Args};

/// 一个强大的 CLI 工具
#[derive(Parser)]
#[command(name = "mycli")]
#[command(version = "0.1.0")]
#[command(author = "Your Name")]
#[command(about = "这是一个示例 CLI 工具", long_about = None)]
struct Cli {
    /// 可选的配置文件路径
    #[arg(short = 'c', long = "config", default_value = "config.toml")]
    config: String,

    /// 是否启用详细输出（可多次叠加）
    #[arg(short = 'v', long = "verbose", action = clap::ArgAction::Count)]
    verbose: u8,

    /// 子命令
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// 初始化项目
    Init {
        /// 项目名称
        name: String,

        /// 项目模板
        #[arg(short = 't', long = "template", default_value = "default")]
        template: String,
    },

    /// 构建项目
    Build {
        /// 构建目标（release/debug）
        #[arg(short = 't', long = "type", default_value = "debug")]
        build_type: String,

        /// 是否并行构建
        #[arg(short = 'j', long = "jobs", default_value_t = 4)]
        jobs: u32,
    },

    /// 运行服务器
    Serve(ServeArgs),

    /// 列出所有项目
    List,
}

#[derive(Args)]
struct ServeArgs {
    /// 监听地址
    #[arg(short = 'a', long = "addr", default_value = "0.0.0.0")]
    addr: String,

    /// 监听端口
    #[arg(short = 'p', long = "port", default_value_t = 8080)]
    port: u16,

    /// 启用 TLS
    #[arg(long)]
    tls: bool,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // 处理 verbose 级别
    match cli.verbose {
        0 => eprintln!("普通模式"),
        1 => eprintln!("详细模式"),
        2 => eprintln!("非常详细模式"),
        _ => eprintln!("调试模式"),
    }

    match cli.command {
        Some(Commands::Init { name, template }) => {
            println!("初始化项目: {}, 模板: {}", name, template);
        }
        Some(Commands::Build { build_type, jobs }) => {
            println!("构建模式: {}, 并行数: {}", build_type, jobs);
        }
        Some(Commands::Serve(args)) => {
            let protocol = if args.tls { "https" } else { "http" };
            println!("启动服务: {}://{}:{}", protocol, args.addr, args.port);
        }
        Some(Commands::List) => {
            println!("列出所有项目...");
        }
        None => {
            println!("未指定子命令，使用 --help 查看帮助");
        }
    }

    Ok(())
}
```

**常用 clap 属性和字段：**

| 属性 | 用法 | 说明 |
|------|------|------|
| `#[arg(short, long)]` | `#[arg(short = 'c', long = "config")]` | 短/长选项名 |
| `#[arg(default_value = "...")]` | `#[arg(default_value = "8080")]` | 默认值 |
| `#[arg(default_value_t = 8080)]` | 类型化默认值 | 编译期类型安全 |
| `#[arg(required = true)]` | 必填参数 | 缺少时报错 |
| `#[arg(short, long, action = clap::ArgAction::Count)]` | 计数参数 | `-vvv` 调试级别 |
| `#[arg(env = "MYAPP_CONFIG")]` | 环境变量支持 | 从环境变量读取默认值 |
| `#[command(subcommand)]` | 子命令 | 嵌套命令结构 |
| `#[arg(value_parser = clap::value_parser!(u16).range(1..))]` | 值验证 | 范围/格式校验 |

### 16.2.3 环境变量与默认值

```rust
use clap::Parser;

#[derive(Parser)]
#[command(name = "server")]
struct ServerConfig {
    /// 监听地址（可从环境变量 SERVER_HOST 读取）
    #[arg(long, env = "SERVER_HOST", default_value = "0.0.0.0")]
    host: String,

    /// 监听端口
    #[arg(long, env = "SERVER_PORT", default_value_t = 8080)]
    port: u16,

    /// 数据库 URL
    #[arg(long, env = "DATABASE_URL")]
    database_url: String,
}
```

> **💡 提示**：为参数添加 `env` 属性后，clap 会自动从环境变量读取值（如果未通过命令行指定）。这对于 Docker 部署或 CI/CD 场景非常有用。

---

## 16.3 标准输入输出处理

Rust 的标准 I/O 通过 `std::io` 模块实现，支持管道输入、文件读写和终端交互。

### 16.3.1 管道数据读取

```rust
use std::io::{self, BufRead, Write};

/// 经典过滤器模式：从 stdin 读取，处理后输出到 stdout
fn pipe_filter() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();

    let mut writer = stdout.lock();
    let lines = stdin.lock().lines();

    for line in lines {
        if let Ok(line) = line {
            // 处理每行数据
            let processed = process_line(&line);
            writeln!(writer, "{}", processed)?;
        }
    }
    Ok(())
}

fn process_line(line: &str) -> String {
    // 去掉首尾空白、转大写
    line.trim().to_uppercase()
}

// 测试管道模式：
// $ echo "hello world" | mycli → HELLO WORLD
```

### 16.3.2 读取文件与标准输入

```rust
use std::io::{self, BufRead, Read};
use std::fs::File;
use std::path::PathBuf;

/// 支持文件路径参数，或从 stdin 读取
fn read_input(path: Option<PathBuf>) -> io::Result<String> {
    match path {
        Some(file_path) => {
            // 从文件读取
            let mut content = String::new();
            File::open(file_path)?.read_to_string(&mut content)?;
            Ok(content)
        }
        None => {
            // 从 stdin 读取（管道输入）
            let mut content = String::new();
            io::stdin().lock().read_to_string(&mut content)?;
            Ok(content)
        }
    }
}
```

### 16.3.3 交互式输入

```rust
use std::io::{self, Write};

fn interactive_prompt(prompt: &str) -> io::Result<String> {
    print!("{} ", prompt);
    io::stdout().flush()?; // 立即显示提示

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;

    Ok(input.trim().to_string())
}

fn confirm_action(prompt: &str) -> io::Result<bool> {
    loop {
        print!("{} [y/N]: ", prompt);
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        match input.trim().to_lowercase().as_str() {
            "y" | "yes" => return Ok(true),
            "n" | "no" | "" => return Ok(false),
            _ => println!("请输入 y 或 n"),
        }
    }
}
```

---

## 16.4 彩色终端输出

### 16.4.1 colored crate

```toml
[dependencies]
colored = "2"
```

```rust
use colored::*;

fn colored_output_examples() {
    // 基本颜色
    println!("{}", "红色文字".red());
    println!("{}", "绿色文字".green());
    println!("{}", "蓝色文字".blue());

    // 样式组合
    println!("{}", "粗体红色".red().bold());
    println!("{}", "绿色下划线".green().underline());
    println!("{}", "蓝色斜体背景".blue().italic().on_yellow());

    // 错误/警告/信息分级
    fn info(msg: &str)  { println!("{} {}", " INFO ".on_blue(), msg); }
    fn warn(msg: &str)  { println!("{} {}", " WARN ".on_yellow().black(), msg); }
    fn error(msg: &str) { println!("{} {}", "ERROR ".on_red(), msg); }

    info("系统正常运行");
    warn("磁盘空间不足 80%");
    error("连接数据库失败");

    // 条件着色
    fn grade_color(score: u32) -> ColoredString {
        match score {
            90..=100 => "A".green().bold(),
            80..=89 => "B".blue(),
            70..=79 => "C".yellow(),
            _ => "D".red(),
        }
    }

    println!("成绩: {}", grade_color(95));
}
```

### 16.4.2 console crate

`console` crate 功能更强大，支持终端尺寸检测、样式标记和用户输入：

```toml
[dependencies]
console = "0.15"
```

```rust
use console::{style, Emoji, Term, Color};

fn console_examples() {
    // 样式
    println!("{}", style("成功!").green().bright());
    println!("{}", style("失败!").red().bold());

    // Emoji（自动检测终端支持）
    println!("{} 处理完成", Emoji("✅", "OK"));
    println!("{} 任务失败", Emoji("❌", "FAIL"));

    // 终端尺寸
    let term = Term::stdout();
    if let Ok((width, height)) = term.size() {
        println!("终端尺寸: {}x{}", width, height);
    }

    // 读取密码（不回显）
    fn read_password() -> std::io::Result<String> {
        let term = Term::stdout();
        term.write_line("请输入密码:")?;
        let password = term.read_secure_line()?;
        Ok(password)
    }

    // 清除当前行
    term.clear_line().unwrap();
}
```

### 16.4.3 日志分级输出

```rust
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
enum LogLevel {
    Info,
    Warn,
    Error,
    Debug,
}

struct Logger {
    start_time: Instant,
}

impl Logger {
    fn new() -> Self {
        Self {
            start_time: Instant::now(),
        }
    }

    fn log(&self, level: LogLevel, msg: &str) {
        let elapsed = self.start_time.elapsed();
        let prefix = match level {
            LogLevel::Info  => format!("{}", " INFO ".on_cyan()),
            LogLevel::Warn  => format!("{}", " WARN ".on_yellow().black()),
            LogLevel::Error => format!("{}", "ERROR ".on_red().bold()),
            LogLevel::Debug => format!("{}", "DEBUG ".on_white().black()),
        };
        println!("[{:>6.2}s] {} {}", elapsed.as_secs_f64(), prefix, msg);
    }
}

// 使用示例
fn demo_logger() {
    let log = Logger::new();
    log.log(LogLevel::Info, "系统启动中...");
    std::thread::sleep(std::time::Duration::from_millis(500));
    log.log(LogLevel::Warn, "配置文件未找到，使用默认配置");
    log.log(LogLevel::Info, "系统启动完成");
}
```

---

## 16.5 进度条与交互式提示

### 16.5.1 indicatif 进度条

```toml
[dependencies]
indicatif = "0.17"
```

```rust
use indicatif::{ProgressBar, ProgressStyle, MultiProgress};
use std::time::Duration;

// 基本进度条
fn basic_progress() {
    let pb = ProgressBar::new(100);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta})")
            .unwrap()
            .progress_chars("#>-"),
    );

    for i in 0..100 {
        // 模拟耗时操作
        std::thread::sleep(Duration::from_millis(20));
        pb.inc(1);
        pb.set_message(format!("处理第 {} 项", i + 1));
    }
    pb.finish_with_message("完成!");
}

// 多进度条（并行下载场景）
fn multi_progress() {
    let mp = MultiProgress::new();

    let pb1 = mp.add(ProgressBar::new(50));
    pb1.set_style(ProgressStyle::default_bar()
        .template("{msg:20} [{bar:20.green/white}] {pos}/{len}")
        .unwrap());

    let pb2 = mp.add(ProgressBar::new(100));
    pb2.set_style(ProgressStyle::default_bar()
        .template("{msg:20} [{bar:20.blue/white}] {pos}/{len}")
        .unwrap());

    // 模拟并行任务
    std::thread::spawn(move || {
        for i in 0..50 {
            std::thread::sleep(Duration::from_millis(30));
            pb1.set_message(format!("文件 A"));
            pb1.inc(1);
        }
        pb1.finish_with_message("文件 A 完成");
    });

    std::thread::spawn(move || {
        for i in 0..100 {
            std::thread::sleep(Duration::from_millis(15));
            pb2.set_message(format!("文件 B"));
            pb2.inc(1);
        }
        pb2.finish_with_message("文件 B 完成");
    });

    mp.join_and_clear().unwrap();
}

// 不确定时长进度条（Spinner）
fn spinner_example() {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("{spinner:.green} {msg}")
            .unwrap(),
    );
    pb.set_message("正在处理...");

    for _ in 0..50 {
        std::thread::sleep(Duration::from_millis(50));
        pb.inc(1);
    }
    pb.finish_with_message("处理完成!");
}
```

### 16.5.2 inquire 交互式选择

```toml
[dependencies]
inquire = "0.7"
```

```rust
use inquire::{Text, Password, Select, Confirm, MultiSelect, CustomType, required};

fn interactive_cli() -> Result<(), Box<dyn std::error::Error>> {
    // 1. 文本输入（带验证）
    let name = Text::new("请输入项目名称:")
        .with_validator(|input: &str| {
            if input.len() >= 3 {
                Ok(())
            } else {
                Err("项目名称至少 3 个字符".into())
            }
        })
        .prompt()?;

    // 2. 密码输入
    let password = Password::new("请输入密码:")
        .with_display_toggle_enabled()
        .with_validator(required!())
        .prompt()?;

    // 3. 单选
    let framework = Select::new(
        "选择 Web 框架:",
        vec!["Axum", "Actix-web", "Rocket", "Warp"],
    ).prompt()?;

    // 4. 多选
    let features = MultiSelect::new(
        "选择特性:",
        vec!["CLI", "数据库", "缓存", "日志", "监控"],
    )
    .with_default(&[0, 1])
    .prompt()?;

    // 5. 确认
    let confirm = Confirm::new("确认创建项目?")
        .with_default(true)
        .prompt()?;

    // 6. 数字输入
    let port = CustomType::<u16>::new("端口号:")
        .with_default(8080)
        .with_error_message("请输入有效的端口号 (0-65535)")
        .prompt()?;

    println!(
        "项目: {}, 框架: {}, 端口: {}, 特性: {:?}",
        name, framework, port, features
    );

    Ok(())
}
```

---

## 16.6 配置文件管理

### 16.6.1 跨平台配置路径

```rust
use std::path::PathBuf;
use std::fs;

/// 获取跨平台的配置文件路径
fn config_dir() -> PathBuf {
    // Linux: ~/.config/mycli/
    // macOS: ~/Library/Application Support/com.mycli/
    // Windows: C:\Users\<user>\AppData\Roaming\mycli\
    let base = dirs::config_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
        .expect("无法确定配置目录");
    base.join("mycli")
}

fn ensure_config_dir() -> std::io::Result<PathBuf> {
    let dir = config_dir();
    fs::create_dir_all(&dir)?;
    Ok(dir)
}
```

```toml
[dependencies]
dirs = "5"
serde = { version = "1", features = ["derive"] }
toml = "0.8"
```

### 16.6.2 配置加载（支持多格式）

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(default = "default_host")]
    host: String,

    #[serde(default = "default_port")]
    port: u16,

    #[serde(default = "default_database")]
    database: DatabaseConfig,

    #[serde(default)]
    logging: LoggingConfig,

    #[serde(default)]
    features: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DatabaseConfig {
    #[serde(default = "default_db_url")]
    url: String,

    #[serde(default = "default_max_conn")]
    max_connections: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LoggingConfig {
    #[serde(default = "default_level")]
    level: String,

    #[serde(default = "default_true")]
    json_format: bool,
}

// 默认值函数
fn default_host() -> String { "0.0.0.0".into() }
fn default_port() -> u16 { 8080 }
fn default_db_url() -> String { "postgres://localhost/mydb".into() }
fn default_max_conn() -> u32 { 10 }
fn default_level() -> String { "info".into() }
fn default_true() -> bool { true }

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: default_db_url(),
            max_connections: default_max_conn(),
        }
    }
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_level(),
            json_format: default_true(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            database: DatabaseConfig::default(),
            logging: LoggingConfig::default(),
            features: Vec::new(),
        }
    }
}

impl AppConfig {
    /// 从文件加载配置，未找到时使用默认值
    fn load(path: &Path) -> Self {
        if path.exists() {
            let content = fs::read_to_string(path)
                .expect("读取配置文件失败");
            match path.extension().and_then(|e| e.to_str()) {
                Some("toml") => toml::from_str(&content).unwrap_or_default(),
                Some("yaml") | Some("yml") => {
                    serde_yaml::from_str(&content).unwrap_or_default()
                }
                Some("json") => serde_json::from_str(&content).unwrap_or_default(),
                _ => {
                    eprintln!("不支持的配置文件格式, 使用默认值");
                    AppConfig::default()
                }
            }
        } else {
            eprintln!("配置文件不存在, 使用默认值");
            AppConfig::default()
        }
    }

    /// 保存配置到文件
    fn save(&self, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = toml::to_string_pretty(self)?;
        fs::write(path, content)?;
        Ok(())
    }
}
```

> **💡 提示**：推荐使用 TOML 格式作为配置文件的默认格式，因为 Rust 社区的 Cargo.toml 已让开发者熟悉其语法。同时支持 JSON/YAML 作为兼容选项。

---

## 16.7 实战：构建完整 CLI 工具——文件搜索器

结合以上知识点，构建一个实用的文件搜索工具 `fsearch`：

```toml
[package]
name = "fsearch"
version = "0.1.0"
edition = "2021"

[dependencies]
clap = { version = "4", features = ["derive"] }
colored = "2"
indicatif = "0.17"
anyhow = "1"
walkdir = "2"
ignore = "0.4"
rayon = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### 核心实现

```rust
use anyhow::Result;
use clap::Parser;
use colored::*;
use ignore::WalkBuilder;
use indicatif::{ProgressBar, ProgressStyle};
use rayon::prelude::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

/// 高性能文件搜索工具
#[derive(Parser)]
#[command(name = "fsearch")]
#[command(version = "1.0.0")]
#[command(about = "快速搜索文件内容")]
struct Args {
    /// 搜索模式（支持 glob）
    pattern: String,

    /// 搜索目录
    #[arg(default_value = ".")]
    path: PathBuf,

    /// 文件扩展名过滤（如 rs,toml,md）
    #[arg(short = 'e', long = "ext")]
    ext: Option<String>,

    /// 排除目录
    #[arg(short = 'x', long = "exclude", default_value = "node_modules,target,.git")]
    exclude: String,

    /// 最大深度
    #[arg(short = 'd', long = "max-depth", default_value_t = 10)]
    max_depth: usize,

    /// JSON 格式输出
    #[arg(long)]
    json: bool,

    /// 最大结果数
    #[arg(short = 'n', long = "max-results", default_value_t = 100)]
    max_results: usize,

    /// 忽略大小写
    #[arg(short = 'i', long = "ignore-case")]
    ignore_case: bool,

    /// 线程数
    #[arg(short = 'j', long = "jobs", default_value_t = 4)]
    jobs: usize,
}

#[derive(Debug, serde::Serialize)]
struct SearchResult {
    path: String,
    line_number: usize,
    line_content: String,
    match_column: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let start = Instant::now();

    // 配置搜索
    let exclude_dirs: Vec<&str> = args.exclude.split(',').collect();
    let pattern = if args.ignore_case {
        args.pattern.to_lowercase()
    } else {
        args.pattern.clone()
    };

    // 构建文件遍历器
    let walker = WalkBuilder::new(&args.path)
        .max_depth(args.max_depth)
        .git_ignore(true)
        .add_custom_ignore_prefixes(&exclude_dirs)
        .build();

    // 收集文件
    let files: Vec<PathBuf> = walker
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|entry| {
            if let Some(ref ext) = args.ext {
                entry.path().extension()
                    .and_then(|e| e.to_str())
                    .map(|e| ext.split(',').any(|x| x.trim() == e))
                    .unwrap_or(false)
            } else {
                true
            }
        })
        .map(|entry| entry.into_path())
        .collect();

    // 进度条
    let pb = ProgressBar::new(files.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("[{elapsed_precise}] [{bar:30.cyan/blue}] {pos}/{len} 文件")
            .unwrap()
            .progress_chars("=> "),
    );
    pb.set_message("搜索中...");

    // 并发搜索（使用 rayon）
    let match_count = AtomicUsize::new(0);
    let results: Vec<SearchResult> = files
        .par_iter()
        .filter_map(|file| {
            let content = std::fs::read_to_string(file).ok()?;
            let results: Vec<SearchResult> = content
                .lines()
                .enumerate()
                .filter(|(_, line)| {
                    let check = if args.ignore_case {
                        line.to_lowercase()
                    } else {
                        line.to_string()
                    };
                    check.contains(&pattern)
                })
                .map(|(line_num, line)| {
                    let col = line.find(&pattern).unwrap_or(0);
                    SearchResult {
                        path: file.to_string_lossy().to_string(),
                        line_number: line_num + 1,
                        line_content: line.to_string(),
                        match_column: col,
                    }
                })
                .collect();

            pb.inc(1);

            let count = results.len();
            if match_count.fetch_add(count, Ordering::SeqCst) > args.max_results {
                None
            } else {
                Some(results)
            }
        })
        .flatten()
        .collect();

    pb.finish_with_message("搜索完成");

    // 输出结果
    let elapsed = start.elapsed();

    if args.json {
        let output = serde_json::json!({
            "results": results,
            "total": results.len(),
            "elapsed_secs": elapsed.as_secs_f64(),
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        for result in &results {
            println!(
                "{}:{}:{}  {}",
                result.path.blue(),
                result.line_number.to_string().yellow(),
                result.match_column.to_string().green(),
                result.line_content.trim()
            );
        }
        println!(
            "\n{} 共找到 {} 个匹配, 耗时: {:.2}s",
            "✓".green(),
            results.len(),
            elapsed.as_secs_f64()
        );
    }

    Ok(())
}
```

> **💡 提示**：上述文件搜索工具综合使用了以下技术：clap 参数解析（16.2）、colored 彩色输出（16.4）、indicatif 进度条（16.5）、walkdir 文件遍历、rayon 并行搜索。这种实战方式是巩固 CLI 开发技能的最佳路径。

---

## 16.8 CLI 程序测试

### 16.8.1 assert_cmd 测试 CLI

```toml
[dev-dependencies]
assert_cmd = "2"
predicates = "3"
```

```rust
#[cfg(test)]
mod tests {
    use assert_cmd::Command;
    use predicates::prelude::*;

    #[test]
    fn test_help_output() {
        let mut cmd = Command::cargo_bin("mycli").unwrap();
        cmd.arg("--help")
            .assert()
            .success()
            .stdout(predicate::str::contains("Usage"));
    }

    #[test]
    fn test_version_output() {
        let mut cmd = Command::cargo_bin("mycli").unwrap();
        cmd.arg("--version")
            .assert()
            .success()
            .stdout(predicate::str::contains("0.1.0"));
    }

    #[test]
    fn test_list_subcommand() {
        let mut cmd = Command::cargo_bin("mycli").unwrap();
        cmd.arg("list")
            .assert()
            .success()
            .stdout(predicate::str::contains("列出"));
    }

    #[test]
    fn test_invalid_args() {
        let mut cmd = Command::cargo_bin("mycli").unwrap();
        cmd.arg("--invalid-flag")
            .assert()
            .failure()
            .stderr(predicate::str::contains("error"));
    }
}
```

### 16.8.2 管道输入/输出测试

```rust
#[cfg(test)]
mod pipe_tests {
    use assert_cmd::Command;

    #[test]
    fn test_pipe_throughput() {
        let mut cmd = Command::cargo_bin("mycli").unwrap();
        cmd.write_stdin("hello\nworld\nrust\n")
            .assert()
            .success()
            .stdout("HELLO\nWORLD\nRUST\n");
    }
}
```

---

## 16.9 发布与分发

### 交叉编译

```bash
# 安装交叉编译工具链
rustup target add x86_64-unknown-linux-musl
rustup target add aarch64-apple-darwin
rustup target add x86_64-pc-windows-gnu

# 编译到 Linux（静态链接 musl，二进制可在任何 Linux 上运行）
cargo build --release --target x86_64-unknown-linux-musl

# 编译到 Windows
cargo build --release --target x86_64-pc-windows-gnu
```

### 发布到 cargo 仓库

```bash
# 检查发布前事项
cargo package

# 发布到 crates.io
cargo publish

# 安装
cargo install mycli
```

### Homebrew 分发（macOS/Linux）

```ruby
# Formula
class Mycli < Formula
  desc "A powerful CLI tool"
  homepage "https://github.com/user/mycli"
  url "https://github.com/user/mycli/releases/download/v0.1.0/mycli-v0.1.0-x86_64-apple-darwin.tar.gz"
  sha256 "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  version "0.1.0"

  def install
    bin.install "mycli"
  end
end
```

---

## 16.10 本章小结

| 主题 | 核心要点 |
|------|----------|
| **clap 参数解析** | Derive API 推荐，支持子命令、参数校验、环境变量 |
| **标准 I/O** | `std::io::{BufRead, Write}`，管道处理模式 |
| **彩色输出** | `colored` 简便，`console` 功能丰富，合理使用颜色 |
| **进度条** | `indicatif` 支持多进度条、Spinner、自定义样式 |
| **交互式提示** | `inquire` 提供文本/密码/选择/确认等丰富交互 |
| **配置文件** | 跨平台路径、多格式支持（TOML/YAML/JSON）、默认值合并 |
| **并发搜索** | `rayon` 并行 + `walkdir` 遍历 + `ignore` git 感知 |
| **测试** | `assert_cmd` 端到端测试 CLI 行为 |
| **分发** | 交叉编译、crates.io 发布、Homebrew |

> **💡 下一步**：掌握 CLI 开发后，接下来学习第17章——系统编程，深入 Rust 在文件系统、进程管理、网络编程等底层领域的应用。
