# 第11章 异步编程

> 本章面向已掌握 Rust 并发基础（第10章）的开发者。你将学习 async/await 语法、Future 模型、tokio 运行时以及异步 I/O 编程，理解 Rust 异步生态的核心概念与最佳实践。

---

## 11.1 async/await 语法

### 11.1.1 基本概念

Rust 的异步编程基于 **协作式调度**（Cooperative Scheduling），任务主动让出执行权，而非被抢占。

```rust
use std::time::Duration;

// async fn 返回一个 Future
async fn hello() -> String {
    // 模拟异步等待
    tokio::time::sleep(Duration::from_millis(100)).await;
    String::from("Hello, async!")
}

// 使用 tokio 运行时执行
#[tokio::main]
async fn main() {
    let result = hello().await;
    println!("{result}");
}
```

### 11.1.2 async 块与闭包

```rust
use tokio::time::{sleep, Duration};

// async 块
let future = async {
    sleep(Duration::from_millis(10)).await;
    42
};

let result = future.await;

// async 闭包（Nightly / 手动实现）
let closure = |x: i32| async move {
    sleep(Duration::from_millis(10)).await;
    x * 2
};

let result = closure(21).await; // 42
```

### 11.1.3 async 的生命周期

```rust
// async fn 的返回值自动包含输入引用生命周期
async fn read_line<'a>(buffer: &'a mut String) -> &'a str {
    // 异步读取...
    buffer.as_str()
}

// 等价于：
// fn read_line<'a>(buffer: &'a mut String) -> impl Future<Output = &'a str> + 'a
```

**借用跨越 await 点：**

```rust
async fn process() {
    let mut data = vec![1, 2, 3];

    // 不可变借用跨越 await 是可的
    let read = &data;
    println!("{read:?}");
    some_async_fn().await;

    // ❌ 可变借用不能跨越 await（如果存在其他引用）
    // let write = &mut data;
    // some_async_fn().await; // 编译错误
    // write.push(4);
}

async fn some_async_fn() {}
```

> 💡 **提示**：跨越 `.await` 点的借用会进入生成的状态机。如果持有借用时调用了其他 Future，可能会导致生命周期冲突。使用 `Box::pin` 或重新组织代码来解决。

---

## 11.2 Future 与执行器

### 11.2.1 Future trait

```rust
use std::pin::Pin;
use std::task::{Context, Poll};

pub trait Future {
    type Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output>;
}

// Poll 枚举
pub enum Poll<T> {
    Ready(T),
    Pending,
}
```

### 11.2.2 手动实现 Future

```rust
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

struct Delay {
    when: Instant,
}

impl Delay {
    fn new(dur: Duration) -> Self {
        Delay { when: Instant::now() + dur }
    }
}

impl Future for Delay {
    type Output = &'static str;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if Instant::now() >= self.when {
            Poll::Ready("timeout")
        } else {
            // 注册 waker，当时间到时唤醒
            let waker = cx.waker().clone();
            let when = self.when;
            std::thread::spawn(move || {
                let now = Instant::now();
                if now < when {
                    std::thread::sleep(when - now);
                }
                waker.wake(); // 通知执行器重新 poll
            });
            Poll::Pending
        }
    }
}
```

### 11.2.3 执行器与 Waker

```rust
// 简化的单线程执行器（教学用）
use std::collections::VecDeque;
use std::future::Future;
use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

struct SimpleExecutor {
    tasks: VecDeque<Box<dyn Future<Output = ()> + Unpin>>,
}

impl SimpleExecutor {
    fn new() -> Self {
        SimpleExecutor { tasks: VecDeque::new() }
    }

    fn spawn(&mut self, future: Box<dyn Future<Output = ()> + Unpin>) {
        self.tasks.push_back(future);
    }

    fn run_all(&mut self) {
        while let Some(mut task) = self.tasks.pop_front() {
            // 创建虚拟 waker
            let waker = dummy_waker();
            let mut cx = Context::from_waker(&waker);

            match Pin::new(&mut task).poll(&mut cx) {
                Poll::Ready(()) => {} // 任务完成
                Poll::Pending => {
                    // 重新放回队列（简化版，实际要等待唤醒）
                    self.tasks.push_back(task);
                }
            }
        }
    }
}

fn dummy_waker() -> Waker {
    // 实际实现需要定义 vtable
    unimplemented!("生产环境请使用 tokio 或 async-std")
}
```

> 💡 **提示**：绝大多数开发者不需要自己实现 Future 或执行器。`tokio` 提供了成熟的高性能运行时。理解 poll 机制有助于调试异步性能问题。

---

## 11.3 tokio 运行时

### 11.3.1 运行时创建

```rust
use tokio;

// 方式1：宏（推荐）
#[tokio::main]
async fn main() {
    // 默认创建多线程运行时（线程数 = CPU 核数）
}

// #[tokio::main(flavor = "current_thread")]  // 单线程运行时

// 方式2：手动创建运行时
fn main() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        println!("在运行时中执行");
    });
}

// 方式3：自定义运行时配置
fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all() // 启用 I/O、时间、信号
        .build()
        .unwrap();
    rt.block_on(async {});
}
```

### 11.3.2 Task 与 Spawn

```rust
use tokio::task;
use std::time::Duration;

#[tokio::main]
async fn main() {
    // spawn 在后台运行任务
    let handle = tokio::spawn(async {
        tokio::time::sleep(Duration::from_secs(1)).await;
        42
    });

    // 可以同时运行多个任务
    let handle2 = tokio::spawn(async {
        "hello from task 2"
    });

    let result = handle.await.unwrap();
    let result2 = handle2.await.unwrap();

    println!("{result} {result2}");
}

// 在同步代码中使用 block_on
fn sync_wrapper() {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        42
    });
    println!("{result}");
}
```

### 11.3.3 tokio::select! 宏

```rust
use tokio::time::{sleep, Duration};

#[tokio::main]
async fn main() {
    tokio::select! {
        val = async_fn1() => {
            println!("fn1 完成: {val}");
        }
        val = async_fn2() => {
            println!("fn2 完成: {val}");
        }
        _ = tokio::time::sleep(Duration::from_secs(2)) => {
            println!("超时！");
        }
    }
}

async fn async_fn1() -> i32 {
    sleep(Duration::from_secs(1)).await;
    1
}

async fn async_fn2() -> i32 {
    sleep(Duration::from_secs(3)).await;
    2
}
```

### 11.3.4 tokio::join! 宏

```rust
use tokio::time::{sleep, Duration};

#[tokio::main]
async fn main() {
    // join! 等待所有 futures 完成
    let (a, b, c) = tokio::join!(
        async { 1 },
        async { 2 },
        async { 3 },
    );
    println!("{a} {b} {c}");

    // try_join! — 任一失败则立即返回错误
    let result: Result<(i32, i32), _> = tokio::try_join!(
        async { Ok::<_, String>(1) },
        async { Err::<i32, String>("failed".into()) },
    );
    assert!(result.is_err());
}
```

| 宏 | 行为 | 返回 |
|-----|------|------|
| `join!` | 等待所有完成 | `(T1, T2, ...)` |
| `try_join!` | 全部成功或首个错误 | `Result<(T1, T2, ...), E>` |
| `select!` | 首个完成 | 匹配分支 |
| `select_biased!` | 按优先级 select | 匹配分支 |

> 💡 **提示**：`select!` 宏中未选中的分支会被**丢弃**（其 Future 被 drop）。如果它们获取了资源（如锁），需谨慎处理。

---

## 11.4 异步 I/O 与网络

### 11.4.1 异步文件读写

```rust
use tokio::fs::File;
use tokio::io::{self, AsyncReadExt, AsyncWriteExt};

#[tokio::main]
async fn main() -> io::Result<()> {
    // 写入文件
    let mut file = File::create("hello.txt").await?;
    file.write_all(b"Hello, async world!").await?;

    // 读取文件
    let mut file = File::open("hello.txt").await?;
    let mut buf = String::new();
    file.read_to_string(&mut buf).await?;
    println!("{buf}");

    // 或使用 read_to_end
    // let mut buf = Vec::new();
    // file.read_to_end(&mut buf).await?;

    Ok(())
}
```

### 11.4.2 TCP 服务器

```rust
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let listener = TcpListener::bind("127.0.0.1:8080").await?;
    println!("服务器监听在 8080 端口");

    loop {
        let (mut socket, addr) = listener.accept().await?;
        println!("新连接: {addr}");

        // 每个连接一个任务
        tokio::spawn(async move {
            let mut buf = [0; 1024];

            // 读取并回显
            loop {
                match socket.read(&mut buf).await {
                    Ok(0) => break, // 连接关闭
                    Ok(n) => {
                        if let Err(e) = socket.write_all(&buf[..n]).await {
                            eprintln!("写入错误: {e}");
                            break;
                        }
                    }
                    Err(e) => {
                        eprintln!("读取错误: {e}");
                        break;
                    }
                }
            }
        });
    }
}
```

### 11.4.3 TCP 客户端

```rust
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut stream = TcpStream::connect("127.0.0.1:8080").await?;

    // 发送数据
    stream.write_all(b"Hello from client!").await?;

    // 读取响应
    let mut buf = vec![0u8; 1024];
    let n = stream.read(&mut buf).await?;
    println!("收到: {}", String::from_utf8_lossy(&buf[..n]));

    Ok(())
}
```

### 11.4.4 UDP 通信

```rust
use tokio::net::UdpSocket;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let socket = UdpSocket::bind("0.0.0.0:8888").await?;
    socket.connect("127.0.0.1:8889").await?;

    let mut buf = vec![0u8; 1024];

    // 发送
    socket.send(b"Hello UDP").await?;

    // 接收
    let n = socket.recv(&mut buf).await?;
    println!("收到: {}", String::from_utf8_lossy(&buf[..n]));

    Ok(())
}
```

### 11.4.5 异步 HTTP 请求

```rust
// 使用 reqwest crate
// Cargo.toml: reqwest = { version = "0.12", features = ["json"] }

use std::collections::HashMap;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // GET 请求
    let resp = reqwest::get("https://httpbin.org/ip")
        .await?
        .json::<HashMap<String, String>>()
        .await?;
    println!("{resp:?}");

    // POST 请求
    let client = reqwest::Client::new();
    let resp = client
        .post("https://httpbin.org/post")
        .json(&serde_json::json!({
            "name": "Rust",
            "version": 2024
        }))
        .send()
        .await?;

    println!("状态码: {}", resp.status());

    Ok(())
}
```

> 💡 **提示**：使用 `reqwest` + `tokio` 是 Rust 异步 HTTP 客户端的事实标准。服务器端框架推荐 `axum`（基于 tokio/tower）或 `actix-web`。

---

## 11.5 Stream 与异步迭代

### 11.5.1 Stream Trait

`Stream` 是 Rust 对异步迭代的抽象，类似于同步中的 `Iterator`：

```rust
pub trait Stream {
    type Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>>;

    fn size_hint(&self) -> (usize, Option<usize>) { (0, None) }
}
```

### 11.5.2 使用 Stream

```rust
use tokio_stream::StreamExt; // 提供 .next() 等适配器
use tokio_stream as stream;

#[tokio::main]
async fn main() {
    // 从迭代器创建流
    let mut s = stream::iter(0..10);

    while let Some(val) = s.next().await {
        print!("{val} "); // 0 1 2 ... 9
    }
    println!();

    // 或者使用 stream! 宏
    let mut s = stream! {
        for i in 0..5 {
            yield i * 2;
        }
    };
    while let Some(val) = s.next().await {
        print!("{val} "); // 0 2 4 6 8
    }
}
```

### 11.5.3 Stream 适配器

```rust
use tokio_stream::StreamExt;
use tokio_stream as stream;

#[tokio::main]
async fn main() {
    let s = stream::iter(1..=10);

    // map + filter + collect
    let result: Vec<_> = s
        .filter(|x| x % 2 == 0)
        .map(|x| x * 10)
        .collect()
        .await;

    assert_eq!(result, vec![20, 40, 60, 80, 100]);
}
```

### 11.5.4 异步流生成器

```rust
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;

#[tokio::main]
async fn main() {
    let (tx, rx) = mpsc::channel(32);
    let mut stream = ReceiverStream::new(rx);

    // 生产者
    tokio::spawn(async move {
        for i in 0..10 {
            tx.send(i).await.unwrap();
        }
    });

    // 消费者
    while let Some(val) = stream.next().await {
        println!("收到: {val}");
    }
}
```

**Stream 适配器对比（来自 `StreamExt`）：**

| 方法 | 同步等效 | 说明 |
|------|----------|------|
| `next()` | `next()` | 获取下一个元素 |
| `map()` | `map()` | 映射转换 |
| `filter()` | `filter()` | 过滤 |
| `fold()` | `fold()` | 归约 |
| `collect()` | `collect()` | 收集到集合 |
| `chunks()` | — | 批次收集 |
| `throttle(d)` | — | 限速 |
| `timeout(d)` | — | 超时 |

> 💡 **提示**：`tokio_stream` 是 tokio 生态中的流处理库。更复杂的流处理（如窗口、连接）可以看 `futures` crate 中的 `StreamExt`。

---

## 11.6 异步错误处理

### 11.6.1 在 async 中传播错误

```rust
use tokio::fs::File;
use tokio::io::{self, AsyncReadExt};

// 方式1：返回 Result
async fn read_config() -> io::Result<String> {
    let mut file = File::open("config.toml").await?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).await?;
    Ok(contents)
}

// 方式2：自定义错误类型
#[derive(Debug)]
enum AppError {
    Io(io::Error),
    Parse(String),
}

impl From<io::Error> for AppError {
    fn from(e: io::Error) -> Self {
        AppError::Io(e)
    }
}

async fn process_config() -> Result<String, AppError> {
    let content = read_config().await?;
    if content.is_empty() {
        return Err(AppError::Parse("empty config".into()));
    }
    Ok(content)
}
```

### 11.6.2 TryStream 处理流错误

```rust
use tokio_stream::StreamExt;

async fn process_items() -> Result<(), Box<dyn std::error::Error>> {
    let items = vec![Ok(1), Ok(2), Err("bad"), Ok(4)];

    // 使用 try_for_each 处理可能错误的流
    let stream = tokio_stream::iter(items);

    stream
        .map(|item| item.map_err(|e| AppError::from(e)))
        .try_for_each(|item| async move {
            println!("处理: {item}");
            Ok::<_, AppError>(())
        })
        .await?;

    Ok(())
}
```

### 11.6.3 超时与取消

```rust
use tokio::time::{timeout, Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 超时保护
    let result = timeout(Duration::from_secs(5), async {
        // 可能长时间运行的操作
        tokio::time::sleep(Duration::from_secs(10)).await;
        42
    })
    .await;

    match result {
        Ok(val) => println!("完成: {val}"),
        Err(_) => println!("操作超时！"),
    }

    // 优雅关闭（通过 CancellationToken）
    let (tx, mut rx) = tokio::sync::oneshot::channel();

    let worker = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => {
                    println!("收到取消信号，清理中...");
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(1)) => {
                    println!("工作中...");
                }
            }
        }
    });

    // 发送取消信号
    tokio::time::sleep(Duration::from_secs(3)).await;
    tx.send(()).unwrap();
    worker.await.unwrap();

    Ok(())
}
```

### 11.6.4 异步编程常见陷阱

```rust
// ❌ 陷阱1：阻塞运行时线程
use std::time::Duration;

async fn bad_example() {
    // std::thread::sleep 会阻塞整个线程！
    // std::thread::sleep(Duration::from_secs(1));

    // ✅ 应该用 tokio 的异步 sleep
    tokio::time::sleep(Duration::from_secs(1)).await;
}

// ❌ 陷阱2：持有 MutexGuard 跨越 await
use std::sync::Mutex;

async fn bad_mutex() {
    let data = Mutex::new(42);
    let guard = data.lock().unwrap();
    // some_async_fn().await; // ❌ MutexGuard 不是 Send
    drop(guard); // ✅ 先释放锁再 await
    some_async_fn().await;
}

// ✅ 陷阱2 修复：使用 tokio::sync::Mutex
use tokio::sync::Mutex as TokioMutex;

async fn good_mutex() {
    let data = TokioMutex::new(42);
    let guard = data.lock().await;
    some_async_fn().await; // ✅ tokio::sync::MutexGuard 是 Send
    drop(guard);
}

// ❌ 陷阱3：select! 分支中 drop 资源
async fn select_with_resource_drop() {
    let (tx, rx) = tokio::sync::oneshot::channel();
    tokio::select! {
        _ = rx => {
            // tx 被 drop... 可能意外
        }
        _ = tokio::time::sleep(Duration::from_secs(1)) => {
            // 这里 rx 被 drop，tx 端的 send 会失败
        }
    }
}

// ❌ 陷阱4：大 future 在栈上
async fn big_future_on_stack() {
    let large_data = [0u8; 1024 * 1024]; // 1MB，危险！
    // 这个 async 块的状态机非常大
    tokio::time::sleep(Duration::from_secs(1)).await;
    println!("{}", large_data[0]);
}
// ✅ 修复：使用 Box::pin 将大 future 移到堆上
// let pinned = Box::pin(big_future_on_stack());

async fn some_async_fn() {}
```

> 💡 **提示**：`tokio::sync::Mutex` 和 `std::sync::Mutex` 的选择原则：临界区非常短（仅修改几个字节）用 `std::sync::Mutex`；临界区包含 `.await` 操作时用 `tokio::sync::Mutex`。

---

## 11.7 异步生态速览

| Crate | 用途 | 说明 |
|-------|------|------|
| `tokio` | 异步运行时 | 事实标准，支持 I/O、时间、同步 |
| `async-std` | 异步运行时 | API 接近 std，生态较小 |
| `smol` | 轻量运行时 | 小且快，适合嵌入式 |
| `axum` | Web 框架 | 基于 tokio，模块化设计 |
| `actix-web` | Web 框架 | Actor 模型，性能极佳 |
| `reqwest` | HTTP 客户端 | 支持 async/await |
| `quinn` | QUIC/HTTP3 | 基于 quinn-implement 的原生 QUIC |
| `sqlx` | 异步数据库 | 编译时 SQL 检查 |
| `sea-orm` | ORM | 异步 ORM 框架 |
| `futures` | 异步工具 | StreamExt, FutureExt 等 |

---

**本章总结：**

| 主题 | 关键要点 |
|------|----------|
| async/await | 语法糖，生成状态机 Future |
| Future | poll 驱动，惰性计算 |
| tokio 运行时 | 多线程/单线程，spawn/join/select |
| 异步 I/O | File、TcpStream、UdpSocket |
| Stream | 异步迭代，适配器链 |
| 错误处理 | ? 操作符，超时，取消 |
| 陷阱 | 阻塞线程、持锁 await、大栈 Future |
