# 第17章：系统编程

> 目标读者：掌握 Rust 基础语法、Unsafe Rust、FFI 概念的开发者

---

## 17.1 Rust 系统编程概述

系统编程是 Rust 的核心应用场景之一。Rust 提供了对操作系统底层能力的直接访问，同时保持内存安全。

| 系统编程领域 | Rust 优势 | 传统方案 |
|-------------|-----------|---------|
| 文件系统操作 | 安全错误处理（`Result`） | C `errno` 全局状态 |
| 进程管理 | 跨平台 API（`std::process`） | POSIX fork/exec |
| 网络编程 | 零抽象开销，async 支持 | C sockets |
| 内存映射 | 类型安全的 `mmap` | 裸指针操作 |
| C 互操作 | FFI 安全封装模式 | extern "C" 手动管理 |
| 信号处理 | 有限但安全的信号模型 | 信号处理器竞态风险 |

---

## 17.2 文件系统操作

### 17.2.1 标准库文件操作

```rust
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};

// 文件读写
fn file_read_write() -> io::Result<()> {
    // 写入文件
    let mut file = File::create("example.txt")?;
    file.write_all(b"Hello, 系统编程!\n")?;
    file.write_all("第二行内容\n".as_bytes())?;

    // 读取整个文件
    let content = fs::read_to_string("example.txt")?;
    println!("全文:\n{}", content);

    // 按行读取（大文件友好）
    let file = File::open("example.txt")?;
    let reader = BufReader::new(file);
    for (idx, line) in reader.lines().enumerate() {
        println!("第{}行: {}", idx + 1, line?);
    }

    // 读取二进制
    let bytes = fs::read("image.png")?;
    println!("图片大小: {} bytes", bytes.len());

    Ok(())
}

// 文件追加与随机写入
fn file_append() -> io::Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)  // 追加模式
        .open("log.txt")?;

    writeln!(file, "[{}] 日志信息", chrono::Local::now())?;
    Ok(())
}
```

### 17.2.2 目录遍历与操作

```rust
use std::fs;

// 递归遍历目录
fn visit_dirs(dir: &Path, depth: usize) -> io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let indent = "  ".repeat(depth);

            if path.is_dir() {
                println!("{}📁 {}", indent, path.file_name().unwrap().to_string_lossy());
                visit_dirs(&path, depth + 1)?;
            } else {
                let metadata = fs::metadata(&path)?;
                let size = metadata.len();
                println!("{}📄 {} ({} bytes)", indent, path.file_name().unwrap().to_string_lossy(), size);
            }
        }
    }
    Ok(())
}

// 创建/删除目录
fn dir_operations() -> io::Result<()> {
    // 创建单层目录
    fs::create_dir("new_dir")?;

    // 递归创建目录
    fs::create_dir_all("a/b/c/d")?;

    // 删除空目录
    fs::remove_dir("new_dir")?;

    // 递归删除
    fs::remove_dir_all("a")?;

    // 复制文件
    fs::copy("source.txt", "backup.txt")?;

    // 移动/重命名
    fs::rename("backup.txt", "moved.txt")?;

    // 删除文件
    fs::remove_file("log.txt")?;

    Ok(())
}
```

### 17.2.3 文件元数据

```rust
use std::fs;
use std::os::unix::fs::PermissionsExt;

fn file_metadata() -> io::Result<()> {
    let path = Path::new("example.txt");
    let metadata = fs::metadata(path)?;

    println!("文件类型: {:?}", metadata.file_type());
    println!("大小: {} bytes", metadata.len());
    println!("创建时间: {:?}", metadata.created());
    println!("修改时间: {:?}", metadata.modified());
    println!("只读: {}", metadata.permissions().readonly());

    // Unix 权限（仅在 Unix 系统可用）
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        println!("权限模式: {:o}", metadata.mode());
        println!("所有者 UID: {}", metadata.uid());
        println!("组 GID: {}", metadata.gid());
    }

    // 设置权限
    let mut perms = metadata.permissions();
    perms.set_readonly(true);
    fs::set_permissions(path, perms)?;

    // Unix: chmod 755
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms)?;
    }

    Ok(())
}
```

| 操作 | 函数 | 说明 |
|------|------|------|
| 读取文件 | `fs::read_to_string` / `fs::read` | 小文件一次性读取 |
| 写入文件 | `fs::write` | 覆盖写入 |
| 追加写入 | `OpenOptions::new().append(true)` | 文件末尾追加 |
| 目录创建 | `fs::create_dir` / `fs::create_dir_all` | 单层/递归创建 |
| 目录读取 | `fs::read_dir` | 迭代目录项 |
| 复制 | `fs::copy` | 文件复制 |
| 移动 | `fs::rename` | 文件移动/重命名 |
| 删除 | `fs::remove_file` / `fs::remove_dir_all` | 文件/目录删除 |
| 元数据 | `fs::metadata` | 获取文件信息 |

> **💡 提示**：处理大量文件时，使用 `fs::read_dir` 的迭代器模式而不是一次性收集所有条目，避免内存占用过高。对于跨平台路径操作，始终使用 `PathBuf` 和 `Path` 而不是字符串拼接。

---

## 17.3 进程管理

### 17.3.1 创建与管理子进程

```rust
use std::process::{Command, Stdio, Child, ExitStatus};
use std::io::{BufRead, BufReader, Write};

// 执行命令并获取输出
fn exec_cmd() -> io::Result<()> {
    let output = Command::new("ls")
        .args(["-la", "/"])
        .output()?;

    if output.status.success() {
        println!("stdout:\n{}", String::from_utf8_lossy(&output.stdout));
    } else {
        eprintln!("stderr:\n{}", String::from_utf8_lossy(&output.stderr));
    }

    Ok(())
}

// 管道输入输出（流水线处理）
fn pipe_commands() -> io::Result<()> {
    // grep -r "fn main" src/ | wc -l
    let grep = Command::new("grep")
        .args(["-r", "fn main", "src/"])
        .stdout(Stdio::piped())
        .spawn()?;

    let wc = Command::new("wc")
        .arg("-l")
        .stdin(grep.stdout.unwrap()) // 将 grep 的 stdout 连接到 wc 的 stdin
        .output()?;

    println!("匹配行数: {}", String::from_utf8_lossy(&wc.stdout).trim());
    Ok(())
}

// 流式读取实时输出
fn stream_output() -> io::Result<()> {
    let mut child = Command::new("ping")
        .args(["-c", "5", "127.0.0.1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // 逐行读取（实时输出）
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                println!("[输出] {}", line);
            }
        }
    }

    let status = child.wait()?;
    println!("子进程退出码: {:?}", status.code());
    Ok(())
}

// 交互式子进程（持续写入/读取）
fn interactive_process() -> io::Result<()> {
    let mut child = Command::new("python3")
        .args(["-c", r#"
while True:
    try:
        line = input()
        print(f"收到: {line}")
    except EOFError:
        break
"#])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;

    let stdin = child.stdin.as_mut().unwrap();
    let stdout = child.stdout.as_mut().unwrap();
    let mut reader = BufReader::new(stdout);

    // 发送数据
    writeln!(stdin, "Hello")?;
    writeln!(stdin, "World")?;
    writeln!(stdin, "Rust")?;
    drop(stdin); // 关闭 stdin，通知子进程结束

    // 读取响应
    for line in reader.lines() {
        println!("{}", line?);
    }

    child.wait()?;
    Ok(())
}
```

> **💡 提示**：使用 `Stdio::piped()` 建立父子进程间的通信管道。注意父进程需要及时读取子进程的 stdout，否则子进程可能因管道缓冲区满而阻塞。

### 17.3.2 获取进程信息

```rust
use std::process;

fn process_info() {
    // 当前进程 ID
    let pid = process::id();
    println!("当前进程 PID: {}", pid);

    // 命令行参数
    let args: Vec<String> = std::env::args().collect();
    println!("命令行参数: {:?}", args);

    // 环境变量
    for (key, value) in std::env::vars() {
        println!("{}={}", key, value);
    }

    // 当前工作目录
    let cwd = std::env::current_dir().unwrap();
    println!("工作目录: {}", cwd.display());

    // 设置环境变量（仅影响当前进程和子进程）
    std::env::set_var("MY_TOOL_CACHE", "/tmp/cache");
}

// 进程退出
fn graceful_exit() {
    // 正常退出
    std::process::exit(0); // 不会运行析构函数！

    // 更好的做法：使用 anyhow/thiserror 返回错误
    // 或者在 main 函数返回 Result
}

// 使用 atexit 或 Drop 做清理
struct TempDir {
    path: std::path::PathBuf,
}

impl Drop for TempDir {
    fn drop(&mut self) {
        if self.path.exists() {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}
```

> **⚠️ 注意**：`std::process::exit()` 不会运行任何析构函数。如果需要清理资源，请使用 `Result` 返回或 `Drop` + `?` 操作符，让 main 函数自然退出。

---

## 17.4 网络编程（TCP/UDP）

### 17.4.1 TCP 服务器

```rust
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

// 单线程 TCP 回声服务器
fn tcp_echo_server() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8080")?;
    println!("TCP 服务器监听于 127.0.0.1:8080");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                handle_client(stream);
            }
            Err(e) => {
                eprintln!("连接失败: {}", e);
            }
        }
    }
    Ok(())
}

fn handle_client(stream: TcpStream) {
    let peer_addr = stream.peer_addr().unwrap();
    println!("新客户端连接: {}", peer_addr);

    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut writer = stream;

    for line in reader.lines() {
        match line {
            Ok(line) => {
                if line.trim() == "quit" {
                    break;
                }
                let response = format!("Echo: {}\n", line);
                writer.write_all(response.as_bytes()).unwrap();
            }
            Err(e) => {
                eprintln!("读取错误: {}", e);
                break;
            }
        }
    }
    println!("客户端断开: {}", peer_addr);
}

// 多线程 TCP 服务器
fn tcp_multi_thread_server() -> std::io::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:8081")?;

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                // 每个连接一个线程
                thread::spawn(|| {
                    handle_client(stream);
                });
            }
            Err(e) => eprintln!("连接失败: {}", e),
        }
    }
    Ok(())
}
```

### 17.4.2 TCP 客户端

```rust
use std::io::{self, BufRead, BufReader, Write};
use std::net::TcpStream;

fn tcp_client() -> io::Result<()> {
    let mut stream = TcpStream::connect("127.0.0.1:8080")?;
    println!("已连接到服务器");

    // 设置读超时
    stream.set_read_timeout(Some(std::time::Duration::from_secs(5)))?;

    // 读取和写分离
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut writer = stream;

    // 发送消息
    writer.write_all(b"Hello Server\n")?;
    writer.write_all(b"quit\n")?;

    // 读取响应
    for line in reader.lines() {
        match line {
            Ok(msg) => println!("收到: {}", msg),
            Err(e) => {
                eprintln!("读取错误: {}", e);
                break;
            }
        }
    }

    Ok(())
}
```

### 17.4.3 UDP 通信

UDP 是无连接协议，适合低延迟或广播场景：

```rust
use std::net::UdpSocket;

fn udp_server() -> std::io::Result<()> {
    let socket = UdpSocket::bind("127.0.0.1:8080")?;
    println!("UDP 服务器监听于 127.0.0.1:8080");

    let mut buf = [0u8; 1024];

    loop {
        match socket.recv_from(&mut buf) {
            Ok((size, src)) => {
                let msg = String::from_utf8_lossy(&buf[..size]);
                println!("收到来自 {} 的消息: {}", src, msg);

                // 回声
                socket.send_to(&buf[..size], &src)?;
            }
            Err(e) => eprintln!("接收错误: {}", e),
        }
    }
}

fn udp_client() -> std::io::Result<()> {
    let socket = UdpSocket::bind("0.0.0.0:0")?; // 随机端口
    socket.connect("127.0.0.1:8080")?;

    let msg = b"Hello UDP Server";
    socket.send(msg)?;

    let mut buf = [0u8; 1024];
    let size = socket.recv(&mut buf)?;
    println!("回声: {}", String::from_utf8_lossy(&buf[..size]));

    Ok(())
}
```

### 17.4.4 异步 TCP 服务器（Tokio）

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
```

```rust
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:8080").await?;
    println!("异步 TCP 服务器监听于 127.0.0.1:8080");

    loop {
        let (mut stream, addr) = listener.accept().await?;
        println!("新连接: {}", addr);

        tokio::spawn(async move {
            let (reader, mut writer) = stream.split();
            let mut buf_reader = BufReader::new(reader);
            let mut line = String::new();

            loop {
                line.clear();
                match buf_reader.read_line(&mut line).await {
                    Ok(0) => break, // EOF
                    Ok(_) => {
                        let response = format!("Echo: {}", line);
                        if writer.write_all(response.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            println!("连接断开: {}", addr);
        });
    }
}
```

| 特性 | TCP | UDP |
|------|-----|-----|
| 连接 | 面向连接（三次握手） | 无连接 |
| 可靠性 | 可靠传输，顺序保证 | 不可靠，可能丢失/乱序 |
| 速度 | 较慢（有确认机制） | 快速 |
| 适用场景 | Web、数据库、文件传输 | DNS、视频流、游戏 |
| Rust 实现 | `TcpListener`, `TcpStream` | `UdpSocket` |

---

## 17.5 信号处理

### 17.5.1 基本信号处理

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-util = "0.7"
signal-hook = "0.3"
signal-hook-tokio = "0.3"
```

```rust
use signal_hook::consts::{SIGINT, SIGTERM, SIGHUP};
use signal_hook_tokio::Signals;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// 使用 signal-hook 处理信号
async fn signal_handler() -> Result<(), Box<dyn std::error::Error>> {
    let mut signals = Signals::new(&[SIGINT, SIGTERM, SIGHUP])?;
    let handle = signals.handle();

    println!("进程 PID: {}, 等待信号...", std::process::id());

    // 在 Tokio 任务中处理信号
    tokio::spawn(async move {
        for signal in &mut signals {
            match signal {
                SIGINT => {
                    println!("收到 SIGINT (Ctrl+C)");
                    // 执行清理操作
                    std::process::exit(0);
                }
                SIGTERM => {
                    println!("收到 SIGTERM");
                    std::process::exit(0);
                }
                SIGHUP => {
                    println!("收到 SIGHUP, 重新加载配置");
                    // 重新加载配置...
                }
                _ => unreachable!(),
            }
        }
    });

    // 主程序继续运行
    tokio::signal::ctrl_c().await?;
    handle.close();
    Ok(())
}

/// 使用 AtomicBool 实现优雅关闭
struct GracefulShutdown {
    should_shutdown: Arc<AtomicBool>,
}

impl GracefulShutdown {
    fn new() -> Self {
        let should_shutdown = Arc::new(AtomicBool::new(false));
        let flag = should_shutdown.clone();

        // 安装信号处理器
        signal_hook::flag::register(SIGINT, flag.clone()).unwrap();
        signal_hook::flag::register(SIGTERM, flag).unwrap();

        Self { should_shutdown }
    }

    fn is_shutdown_requested(&self) -> bool {
        self.should_shutdown.load(Ordering::Relaxed)
    }
}

// 使用示例
fn graceful_shutdown_example() {
    let shutdown = GracefulShutdown::new();

    loop {
        if shutdown.is_shutdown_requested() {
            println!("正在优雅关闭...");
            // 关闭数据库连接、保存状态等
            std::thread::sleep(std::time::Duration::from_secs(2));
            println!("已关闭");
            break;
        }
        // 正常处理...
        std::thread::sleep(std::time::Duration::from_secs(1));
        println!("运行中...");
    }
}
```

### 17.5.2 基于 Tokio 的优雅关闭

```rust
use tokio::signal;
use tokio_util::sync::CancellationToken;

async fn run_worker(token: CancellationToken) {
    loop {
        tokio::select! {
            _ = token.cancelled() => {
                println!("Worker 收到取消信号，正在退出");
                break;
            }
            _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                println!("Worker 运行中...");
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let token = CancellationToken::new();

    // 启动多个 worker
    let mut handles = vec![];
    for i in 0..3 {
        let token = token.clone();
        handles.push(tokio::spawn(async move {
            run_worker(token).await;
            println!("Worker {} 退出", i);
        }));
    }

    // 等待 Ctrl+C
    signal::ctrl_c().await?;
    println!("收到 Ctrl+C，正在优雅关闭...");

    // 发送取消信号
    token.cancel();

    // 等待所有 worker 完成（超时 5 秒）
    for handle in handles {
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            handle,
        )
        .await
        .unwrap_or_else(|_| {
            println!("Worker 超时强制退出");
            Ok(())
        })?;
    }

    println!("程序已优雅关闭");
    Ok(())
}
```

---

## 17.6 内存映射

内存映射文件（mmap）将文件内容映射到进程的虚拟地址空间，绕过了传统的 read/write 系统调用，**性能更高**。

### 17.6.1 使用 memmap2

```toml
[dependencies]
memmap2 = "0.9"
```

```rust
use memmap2::Mmap;
use std::fs::File;
use std::io::{Write, Result};

/// 内存映射读取（比 read_to_string 快 2-10 倍）
fn mmap_read(path: &str) -> Result<()> {
    let file = File::open(path)?;
    let mmap = unsafe { Mmap::map(&file)? };

    // 映射后的内存就像 byte slice
    println!("文件大小: {} bytes", mmap.len());

    // 按行处理
    for line in mmap.split(|&b| b == b'\n') {
        if !line.is_empty() {
            let text = String::from_utf8_lossy(line);
            process_line(&text);
        }
    }

    Ok(())
}

fn process_line(line: &str) {
    // 处理逻辑
}

/// 内存映射写入
fn mmap_write(path: &str) -> Result<()> {
    let file = File::create(path)?;

    // 预分配大小
    file.set_len(1024 * 1024)?; // 1MB

    let mut mmap = unsafe { memmap2::MmapMut::map_mut(&file)? };

    // 直接在内存中写入
    let data = b"Hello, Memory Mapped File!\n";
    mmap[..data.len()].copy_from_slice(data);

    // 刷新到磁盘
    mmap.flush()?;

    Ok(())
}
```

### 17.6.2 高效大文件处理

```rust
use memmap2::Mmap;
use std::fs::File;
use rayon::prelude::*;

/// 并行处理大文件（使用 mmap + rayon）
fn parallel_process_large_file(path: &str) -> Result<u64> {
    let file = File::open(path)?;
    let mmap = unsafe { Mmap::map(&file)? };
    let file_size = mmap.len();

    // 将文件分成多个 chunk 并行处理
    let num_chunks = rayon::current_num_threads();
    let chunk_size = file_size / num_chunks;

    let line_counts: Vec<u64> = (0..num_chunks)
        .into_par_iter()
        .map(|i| {
            let start = i * chunk_size;
            let end = if i == num_chunks - 1 {
                file_size
            } else {
                start + chunk_size
            };

            // 调整边界到完整的行
            let start = adjust_to_line_start(&mmap, start);
            let end = adjust_to_line_end(&mmap, end);

            // 统计行数
            mmap[start..end]
                .iter()
                .filter(|&&b| b == b'\n')
                .count() as u64
        })
        .collect();

    Ok(line_counts.iter().sum())
}

fn adjust_to_line_start(data: &[u8], pos: usize) -> usize {
    if pos == 0 {
        return 0;
    }
    // 回退到上一个换行符
    let mut p = pos;
    while p > 0 && data[p] != b'\n' {
        p -= 1;
    }
    if p == 0 { 0 } else { p + 1 }
}

fn adjust_to_line_end(data: &[u8], pos: usize) -> usize {
    if pos >= data.len() {
        return data.len();
    }
    // 前进到当前行的末尾
    let mut p = pos;
    while p < data.len() && data[p] != b'\n' {
        p += 1;
    }
    p.min(data.len())
}
```

| 操作方式 | 小文件 | 大文件（>1GB） | 随机访问 |
|----------|--------|----------------|----------|
| `read_to_string` | ✅ 简单 | ❌ 内存爆炸 | ❌ |
| `BufReader` | ✅ | ✅ 流式 | ❌ |
| `mmap` | ✅ | ✅ 按需分页 | ✅ 最快 |
| `seek/read` | ❌ 慢 | ✅ 流式 | ✅ |

> **💡 提示**：内存映射适合**大文件的随机访问**和**频繁读**场景。不适合频繁写入小文件（映射开销高）。`mmap` 函数用 `unsafe` 包裹是因为访问已删除文件或设备断开可能导致 SIGBUS。

---

## 17.7 与 C 互操作实战

### 17.7.1 调用 C 标准库

```rust
use std::ffi::{CString, CStr};
use std::os::raw::c_char;

// 声明外部 C 函数
extern "C" {
    fn strlen(s: *const c_char) -> usize;
    fn strcmp(s1: *const c_char, s2: *const c_char) -> i32;
    fn puts(s: *const c_char) -> i32;
}

fn call_c_stdlib() {
    let rust_str = "Hello from Rust!";
    let c_str = CString::new(rust_str).unwrap();

    unsafe {
        let len = strlen(c_str.as_ptr());
        println!("C strlen: {}", len);

        puts(c_str.as_ptr());

        let other = CString::new("Hello").unwrap();
        let cmp = strcmp(c_str.as_ptr(), other.as_ptr());
        println!("strcmp 结果: {}", cmp); // > 0
    }
}
```

### 17.7.2 构建 C 兼容的库

```rust
// libadd.rs — 编译为动态库供 C 调用
// 编译: rustc --crate-type cdylib libadd.rs

use std::ffi::CStr;
use std::os::raw::c_char;

/// C 兼容的加法函数
#[no_mangle]
pub extern "C" fn add(a: i32, b: i32) -> i32 {
    a + b
}

/// 接收 C 字符串并返回长度
#[no_mangle]
pub extern "C" fn string_length(s: *const c_char) -> i32 {
    if s.is_null() {
        return -1;
    }
    let c_str = unsafe { CStr::from_ptr(s) };
    match c_str.to_str() {
        Ok(rust_str) => rust_str.len() as i32,
        Err(_) => -1,
    }
}

/// 返回字符串（需 C 端释放）
#[no_mangle]
pub extern "C" fn greet(name: *const c_char) -> *mut c_char {
    let name = if name.is_null() {
        "World"
    } else {
        unsafe { CStr::from_ptr(name).to_str().unwrap_or("World") }
    };
    let greeting = format!("Hello, {}!", name);
    CString::new(greeting).unwrap().into_raw()
}

/// 释放 Rust 分配的字符串
#[no_mangle]
pub extern "C" fn free_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe { let _ = CString::from_raw(s); }
    }
}
```

```c
// main.c — C 端调用
#include <stdio.h>
#include <stdlib.h>

extern int add(int a, int b);
extern int string_length(const char *s);
extern char *greet(const char *name);
extern void free_string(char *s);

int main() {
    printf("add(3, 4) = %d\n", add(3, 4));
    printf("length('Hello') = %d\n", string_length("Hello"));

    char *msg = greet("Rust");
    printf("%s\n", msg);
    free_string(msg);

    return 0;
}
```

```bash
# 编译 Rust 库
rustc --crate-type cdylib libadd.rs -o libadd.so

# 编译 C 程序并链接
gcc main.c -L. -ladd -o main

# 运行
LD_LIBRARY_PATH=. ./main
```

### 17.7.3 使用 build.rs 自动绑定 C 库

```toml
[build-dependencies]
cc = "1"
```

```rust
// build.rs — 编译 C 源文件
fn main() {
    cc::Build::new()
        .file("src/native/helper.c")
        .include("src/native")
        .compile("helper");

    println!("cargo:rerun-if-changed=src/native/helper.c");
}
```

### 17.7.4 extern "C" 内存管理规则

| 场景 | 谁分配 | 谁释放 |
|------|--------|--------|
| Rust 调用 C 的 `malloc` | C | C |
| C 调用 Rust 的 `Box::into_raw` | Rust | Rust |
| Rust 分配字符串传给 C | Rust（`CString::into_raw`） | Rust（`CString::from_raw`） |
| C 分配字符串传给 Rust | C | C |

> **💡 提示**：跨 FFI 边界的**内存管理是最容易出错的地方**。一个黄金规则是：谁分配谁释放。如果必须跨边界传递堆内存，提供配套的 free/destroy 函数。

---

## 17.8 高级系统编程技术

### 17.8.1 文件描述符操作（Unix）

```rust
use std::os::unix::io::{AsRawFd, FromRawFd, RawFd};
use std::fs::File;

fn fd_operations() {
    let file = File::open("example.txt").unwrap();

    // 获取文件描述符
    let fd: RawFd = file.as_raw_fd();
    println!("文件描述符: {}", fd);

    // 复制文件描述符（dup）
    let new_fd = unsafe { libc::dup(fd) };
    if new_fd >= 0 {
        let new_file = unsafe { File::from_raw_fd(new_fd) };
        // new_file 现在拥有这个 fd
    }

    // 设置非阻塞
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL, 0);
        libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
    }
}
```

### 17.8.2 epoll / kqueue 事件循环

```rust
// 使用 mio 库实现跨平台事件循环
use mio::{Events, Interest, Poll, Token};
use mio::net::TcpListener;

fn event_loop() -> std::io::Result<()> {
    let mut poll = Poll::new()?;
    let mut events = Events::with_capacity(128);

    let addr = "127.0.0.1:8080".parse().unwrap();
    let mut listener = TcpListener::bind(addr)?;
    poll.registry().register(
        &mut listener,
        Token(0),
        Interest::READABLE,
    )?;

    loop {
        poll.poll(&mut events, None)?;

        for event in &events {
            match event.token() {
                Token(0) => {
                    let (_stream, addr) = listener.accept()?;
                    println!("新连接: {}", addr);
                }
                _ => {}
            }
        }
    }
}
```

---

## 17.9 本章小结

| 主题 | 核心要点 |
|------|----------|
| **文件系统** | `fs` 模块、目录遍历、元数据、跨平台路径 |
| **进程管理** | `Command` 管道、子进程 I/O、进程信息 |
| **TCP 网络** | 多线程服务器 vs 异步 Tokio、连接管理 |
| **UDP 网络** | 无连接通信、广播/组播场景 |
| **信号处理** | `signal-hook`、`CancellationToken`、优雅关闭 |
| **内存映射** | 大文件高性能读写、随机访问、并行处理 |
| **C 互操作** | FFI 声明、构建动态库、内存管理规则 |
| **事件驱动** | epoll/kqueue 封装、mio 库 |

> **💡 下一步**：掌握系统编程基础后，接下来学习第18章——测试与基准测试，确保你的系统级代码质量和性能。
