# 第10章 并发编程

> 本章面向已掌握 Rust 所有权和类型系统的开发者。你将学习 Rust 中线程创建与管理、消息传递、共享状态并发、原子类型操作以及 Send/Sync 特质，掌握构建安全高效并发程序的模式。

---

## 10.1 线程创建与管理（std::thread）

### 10.1.1 基础线程

```rust
use std::thread;
use std::time::Duration;

// 创建线程
let handle = thread::spawn(|| {
    for i in 1..10 {
        println!("子线程: {i}");
        thread::sleep(Duration::from_millis(1));
    }
});

for i in 1..5 {
    println!("主线程: {i}");
    thread::sleep(Duration::from_millis(1));
}

// 等待子线程结束
handle.join().unwrap();
```

### 10.1.2 move 闭包与所有权转移

```rust
use std::thread;

let data = vec![1, 2, 3];

// move 关键字的必要性：线程可能比当前作用域长寿
let handle = thread::spawn(move || {
    println!("{:?}", data);
    // data 的所有权被移动到子线程
});

// println!("{:?}", data); // ❌ 编译错误：data 已被 move

handle.join().unwrap();
```

### 10.1.3 线程 Builder

```rust
use std::thread;

// 通过 Builder 设置线程属性
let builder = thread::Builder::new()
    .name("worker-1".into())
    .stack_size(1024 * 1024); // 1MB 栈空间

let handle = builder.spawn(|| {
    println!("自定义线程: {:?}", thread::current().name());
}).expect("创建线程失败");

handle.join().unwrap();
```

### 10.1.4 线程本地存储（TLS）

```rust
use std::cell::RefCell;

thread_local! {
    static COUNTER: RefCell<u32> = RefCell::new(0);
}

// 每个线程有独立的 COUNTER 实例
let handles: Vec<_> = (0..5).map(|i| {
    thread::spawn(move || {
        COUNTER.with(|c| {
            *c.borrow_mut() = i;
            println!("Thread {i}: counter = {}", c.borrow());
        });
    })
}).collect();

for h in handles {
    h.join().unwrap();
}
```

> 💡 **提示**：线程的创建和销毁有开销，对于大量短期任务考虑使用线程池（如 `rayon` crate）。线程 Builder 的 `stack_size` 在嵌入式或资源受限环境需要精心调整。

---

## 10.2 通道（mpsc）

### 10.2.1 基本用法

`std::sync::mpsc` 提供**多生产者、单消费者**（Multiple Producer, Single Consumer）通道：

```rust
use std::sync::mpsc;
use std::thread;

let (tx, rx) = mpsc::channel();

thread::spawn(move || {
    tx.send("Hello from thread").unwrap();
});

let received = rx.recv().unwrap();
println!("{received}");
```

### 10.2.2 多生产者模式

```rust
use std::sync::mpsc;
use std::thread;

let (tx, rx) = mpsc::channel();

// 多生产者：克隆发送端
let tx1 = tx.clone();
let tx2 = tx.clone();

thread::spawn(move || {
    tx1.send("消息来自生产者1").unwrap();
});

thread::spawn(move || {
    tx2.send("消息来自生产者2").unwrap();
});

// 接收所有消息
for received in rx {
    println!("{received}");
}
```

### 10.2.3 同步通道

```rust
use std::sync::mpsc;

// 同步通道：缓冲区大小为 3
let (tx, rx) = mpsc::sync_channel(3);

thread::spawn(move || {
    for i in 0..10 {
        // 当缓冲区满时 send 会阻塞
        tx.send(i).unwrap();
        println!("发送: {i}");
    }
});

// 消费速度慢，观察阻塞
thread::sleep(std::time::Duration::from_secs(1));
for received in rx {
    println!("接收: {received}");
}
```

### 10.2.4 通道最佳实践

```rust
use std::sync::mpsc;
use std::thread;

// 模式：发送复杂类型
#[derive(Debug)]
enum Command {
    Print(String),
    Add(i32, i32),
    Quit,
}

let (tx, rx) = mpsc::channel();

let worker = thread::spawn(move || {
    for cmd in rx {
        match cmd {
            Command::Print(s) => println!("打印: {s}"),
            Command::Add(a, b) => println!("求和: {}", a + b),
            Command::Quit => {
                println!("工人退出");
                break;
            }
        }
    }
});

tx.send(Command::Print("Hello".into())).unwrap();
tx.send(Command::Add(3, 4)).unwrap();
tx.send(Command::Quit).unwrap();

worker.join().unwrap();
```

**通道方法对比：**

| 方法 | 异步/同步 | 返回 | 说明 |
|------|-----------|------|------|
| `recv()` | 阻塞 | `Result<T, RecvError>` | 等待直到有消息 |
| `try_recv()` | 非阻塞 | `Result<T, TryRecvError>` | 立刻返回 |
| `recv_timeout(d)` | 限时阻塞 | `Result<T, RecvTimeoutError>` | 超时返回错误 |
| `iter()` | 阻塞遍历 | `IntoIter<T>` | for 循环接收 |

> 💡 **提示**：`mpsc` 的发送端在 `drop` 后接收端 `recv()` 返回 `Err(RecvError)`，这是优雅通知消费者结束的常用方法。`crossbeam-channel` 是第三方更强大的通道库。

---

## 10.3 Mutex 与 RwLock

### 10.3.1 Mutex`<T>` — 互斥锁

```rust
use std::sync::Mutex;
use std::thread;

let counter = Mutex::new(0);
let mut handles = vec![];

for _ in 0..10 {
    let counter = &counter;
    handles.push(thread::spawn(move || {
        let mut num = counter.lock().unwrap();
        *num += 1;
    }));
    // ❌ 编译错误：counter 的借用问题
}
```

正确的做法是使用 `Arc<Mutex<T>>`：

```rust
use std::sync::{Arc, Mutex};
use std::thread;

let counter = Arc::new(Mutex::new(0));
let mut handles = vec![];

for _ in 0..10 {
    let counter = Arc::clone(&counter);
    handles.push(thread::spawn(move || {
        let mut num = counter.lock().unwrap();
        *num += 1;
    }));
}

for handle in handles {
    handle.join().unwrap();
}

println!("结果: {}", *counter.lock().unwrap()); // 10
```

### 10.3.2 中毒（Poisoning）

当一个线程在持有锁时 panic，Mutex 会进入**中毒状态**：

```rust
use std::sync::Mutex;

let mtx = Mutex::new(42);

let handle = std::thread::spawn(move || {
    let _guard = mtx.lock().unwrap();
    panic!("线程 panic"); // 锁被持有着 panic
});

assert!(handle.join().is_err());

// 尝试重新获取锁
// lock().unwrap() 会 panic（因为出错了）
// lock().unwrap_or_else(|poison| poison.into_inner()) 可以恢复
```

### 10.3.3 RwLock`<T>` — 读写锁

```rust
use std::sync::{Arc, RwLock};
use std::thread;

let data = Arc::new(RwLock::new(vec![1, 2, 3]));

let readers: Vec<_> = (0..5)
    .map(|i| {
        let data = Arc::clone(&data);
        thread::spawn(move || {
            let read = data.read().unwrap();
            println!("读者 {i}: {:?}", *read);
            // 多个读者可以同时读
        })
    })
    .collect();

let writer = {
    let data = Arc::clone(&data);
    thread::spawn(move || {
        let mut write = data.write().unwrap();
        write.push(4);
        println!("写者写入");
        // 写时阻塞所有读者
    })
};

for r in readers {
    r.join().unwrap();
}
writer.join().unwrap();
```

**Mutex vs RwLock：**

| 特性 | Mutex | RwLock |
|------|-------|--------|
| 读读并发 | ❌（串行） | ✅（并行） |
| 读写并发 | ❌ | ❌ |
| 写写并发 | ❌ | ❌ |
| 适用场景 | 写操作频繁 | 读多写少 |
| 性能特点 | 简单，无额外开销 | 读多写少时优势大 |

> 💡 **提示**：读多写少场景优先考虑 `RwLock`。但 `RwLock` 内部实现更复杂，短临界区时 `Mutex` 反而可能更快。用基准测试验证。

### 10.3.4 持有锁的注意事项

```rust
use std::sync::{Arc, Mutex};

// ❌ 错误：持有锁时调用可能阻塞的操作
let mtx = Arc::new(Mutex::new(0));
let guard = mtx.lock().unwrap();
// thread::sleep(Duration::from_secs(1)); // ❌ 尽量不要这样做

// ✅ 正确：缩小锁的作用域
{
    let mut guard = mtx.lock().unwrap();
    *guard += 1;
} // 锁在这里释放

// ✅ 正确：使用块表达式限定范围
let val = {
    let guard = mtx.lock().unwrap();
    *guard + 1
}; // 锁释放
```

---

## 10.4 Arc 与原子类型

### 10.4.1 原子类型概述

`std::sync::atomic` 提供了无需锁的并发原语：

```rust
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;

// 原子计数器 — 零开销（Lock-Free）
let counter = Arc::new(AtomicI32::new(0));
let mut handles = vec![];

for _ in 0..10 {
    let counter = Arc::clone(&counter);
    handles.push(thread::spawn(move || {
        // 原子的加一操作
        counter.fetch_add(1, Ordering::SeqCst);
    }));
}

for handle in handles {
    handle.join().unwrap();
}

println!("最终计数: {}", counter.load(Ordering::SeqCst)); // 10
```

### 10.4.2 内存顺序（Ordering）

```rust
use std::sync::atomic::Ordering;

// Relaxed — 仅保证原子性，不保证顺序
// 适用于计数器等不需要同步的场景
x.fetch_add(1, Ordering::Relaxed);

// Acquire / Release
// Acquire：防止后续读写重排序到此 load 之前
// Release：防止前序读写重排序到此 store 之后
// 典型的自旋锁模式
flag.store(true, Ordering::Release);
while !flag.load(Ordering::Acquire) {}

// SeqCst — 最严格，全局一致性（默认推荐）
// 所有线程看到相同顺序
y.store(42, Ordering::SeqCst);
```

| Ordering | 保证 | 性能 |
|----------|------|------|
| `Relaxed` | 仅原子性 | 最快 |
| `Acquire`/`Release` | 成对同步 | 中等 |
| `AcqRel` | Acquire + Release | 中等 |
| `SeqCst` | 全局一致性 | 最慢 |

> 💡 **提示**：不熟悉内存模型时默认用 `Ordering::SeqCst`。当性能敏感且你理解 Happens-Before 关系时再使用更弱的排序。

### 10.4.3 常见原子类型

```rust
use std::sync::atomic::*;
use std::sync::atomic::Ordering::*;

// 标志位
let flag = AtomicBool::new(false);
flag.store(true, Relaxed);
let val = flag.load(Relaxed);

// 计数器
let counter = AtomicU64::new(0);
let prev = counter.fetch_add(1, SeqCst);
let prev = counter.fetch_sub(1, SeqCst);

// CAS — Compare-and-Swap
let num = AtomicI32::new(10);
num.compare_exchange(10, 20, SeqCst, SeqCst).unwrap();
// compare_exchange_weak：用于循环中的 CAS（spurious failure 时重试）
```

### 10.4.4 Arc 内部原理

`Arc<T>` 内部使用 `AtomicUsize` 管理引用计数：

```rust
// Arc 的简化结构
struct ArcInner<T> {
    strong_count: atomic::AtomicUsize,
    weak_count: atomic::AtomicUsize,
    data: T,
}

// clone 时 strong_count.fetch_add(1, Relaxed)
// drop 时 strong_count.fetch_sub(1, Release)
// 当 strong_count 降为 0 时释放 data
```

> 💡 **提示**：`Arc::make_mut` 提供了**写时克隆**（Copy-on-Write）的支持，当引用计数 > 1 时克隆内部数据再修改。

---

## 10.5 Send 与 Sync Trait

### 10.5.1 定义

```rust
// Send：类型 T 的所有权可以在线程间转移
pub unsafe trait Send {}

// Sync：类型 T 的引用 &T 可以在线程间共享
pub unsafe trait Sync {}
```

### 10.5.2 自动推导与手动实现

```rust
// 大多数类型自动实现 Send/Sync
let x = 42;     // i32: Send + Sync
let s = String::from("hello"); // String: Send + Sync

// 以下类型不是 Send：
use std::rc::Rc;
let r = Rc::new(42);
// thread::spawn(move || { println!("{:?}", r); }); // ❌ Rc 不是 Send

// 以下类型不是 Sync：
use std::cell::RefCell;
let cell = RefCell::new(42);
// thread::spawn(|| { let _ = &cell; }); // ❌ RefCell 不是 Sync
```

**常见类型的 Send/Sync 实现：**

| 类型 | Send | Sync | 原因 |
|------|------|------|------|
| `i32`, `bool`, `f64` | ✅ | ✅ | 原生类型 |
| `Box<T>` | 当 `T: Send` | 当 `T: Sync` | 委托给 T |
| `Rc<T>` | ❌ | ❌ | 非原子引用计数 |
| `Arc<T>` | 当 `T: Send + Sync` | 当 `T: Send + Sync` | 原子计数 |
| `RefCell<T>` | ✅ | ❌ | 运行时借用检查非线程安全 |
| `Mutex<T>` | ✅ | ✅ | 内部同步 |
| `*const T` | ❌ | ❌ | 原始指针 |
| `*mut T` | ❌ | ❌ | 原始指针 |

### 10.5.3 不安全实现 Send/Sync

```rust
// 仅在你明确知道类型是线程安全时使用
struct MyPtr(*mut i32);

// 声明 MyPtr 可以在线程间移动
unsafe impl Send for MyPtr {}
// 声明 MyPtr 可以在线程间共享
unsafe impl Sync for MyPtr {}
```

> 💡 **提示**：99% 的情况不需要手动实现 Send/Sync。如果需要，说明设计可能有问题。类型中不要包含 `Rc`、`RefCell`、裸指针等并发不安全组件。

---

## 10.6 并发模式与最佳实践

### 10.6.1 不安全的全局可变状态

```rust
use std::sync::Mutex;

// ❌ 避免：裸全局可变
// static mut COUNTER: u32 = 0; // unsaf

// ✅ 推荐：Mutex 保护的全局
static COUNTER: Mutex<u32> = Mutex::new(0);

// 或者使用原子类型
static ATOMIC_COUNTER: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);
```

### 10.6.2 Actor 模式（通过通道）

```rust
use std::sync::mpsc;
use std::thread;

// Actor：封装状态和行为
struct CounterActor {
    receiver: mpsc::Receiver<CounterMsg>,
    count: u32,
}

enum CounterMsg {
    Increment,
    GetValue(mpsc::Sender<u32>),
}

impl CounterActor {
    fn new(receiver: mpsc::Receiver<CounterMsg>) -> Self {
        CounterActor { receiver, count: 0 }
    }

    fn run(&mut self) {
        for msg in &self.receiver {
            match msg {
                CounterMsg::Increment => self.count += 1,
                CounterMsg::GetValue(sender) => {
                    let _ = sender.send(self.count);
                }
            }
        }
    }
}

fn main() {
    let (tx, rx) = mpsc::channel();
    let mut actor = CounterActor::new(rx);

    let actor_thread = thread::spawn(move || {
        actor.run();
    });

    tx.send(CounterMsg::Increment).unwrap();
    tx.send(CounterMsg::Increment).unwrap();
    tx.send(CounterMsg::Increment).unwrap();

    let (resp_tx, resp_rx) = mpsc::channel();
    tx.send(CounterMsg::GetValue(resp_tx)).unwrap();

    println!("Actor count: {}", resp_rx.recv().unwrap());
    // ...
}
```

### 10.6.3 工作窃取（Work Stealing） 与 Rayon

```rust
// 使用 rayon crate 简化并行迭代
// Cargo.toml: rayon = "1"

use rayon::prelude::*;

fn sum_of_squares(input: &[i64]) -> i64 {
    input.par_iter() // 并行迭代器
         .map(|&i| i * i)
         .sum()
}

// 自定义线程池
use rayon::ThreadPoolBuilder;

let pool = ThreadPoolBuilder::new()
    .num_threads(4)
    .build()
    .unwrap();

pool.install(|| {
    let result: Vec<_> = (0..1000)
        .into_par_iter()
        .filter(|x| x % 2 == 0)
        .collect();
    println!("count: {}", result.len());
});
```

### 10.6.4 避免死锁

```rust
use std::sync::{Arc, Mutex};

// ❌ 可能死锁的情况
let a = Arc::new(Mutex::new(0));
let b = Arc::new(Mutex::new(0));

// 线程 1
let a1 = Arc::clone(&a);
let b1 = Arc::clone(&b);
let t1 = thread::spawn(move || {
    let _guard_a = a1.lock().unwrap();
    thread::sleep(std::time::Duration::from_millis(10));
    let _guard_b = b1.lock().unwrap(); // 可能死锁
});

// ✅ 避免死锁：固定加锁顺序
// 所有线程都先锁 a 再锁 b，就不会死锁
fn lock_in_order(l1: &Mutex<i32>, l2: &Mutex<i32>) {
    let _g1 = l1.lock().unwrap();
    let _g2 = l2.lock().unwrap();
}
```

### 10.6.5 并发性能调优清单

| 策略 | 说明 |
|------|------|
| 减少锁粒度 | 用多个分片锁替代全局锁 |
| 读写分离 | 读多写少用 RwLock |
| 无锁数据结构 | 用原子类型和 CAS 操作 |
| 避免伪共享 | 缓存行对齐（`#[repr(align(64))]`） |
| 任务粒度适中 | 太细→线程切换开销，太粗→并行度低 |
| 使用线程池 | 避免频繁创建销毁线程 |

```rust
// 伪共享示例（性能优化）
#[repr(align(64))] // 确保在不同缓存行
struct AlignedCounter {
    value: u64,
}

// 分片计数器
struct ShardedCounter {
    shards: Vec<Mutex<u64>>,
}

impl ShardedCounter {
    fn new(num_shards: usize) -> Self {
        let mut shards = Vec::with_capacity(num_shards);
        for _ in 0..num_shards {
            shards.push(Mutex::new(0));
        }
        ShardedCounter { shards }
    }

    fn increment(&self, key: u64) {
        let idx = key as usize % self.shards.len();
        let mut guard = self.shards[idx].lock().unwrap();
        *guard += 1;
    }
}
```

### 10.6.6 第三方并发库速览

| Crate | 用途 |
|-------|------|
| `rayon` | 数据并行（并行迭代器） |
| `crossbeam` | 无锁队列、通道、原子操作 |
| `tokio` | 异步运行时（见第11章） |
| `dashmap` | 高并发 HashMap |
| `parking_lot` | 更快的 Mutex/RwLock |
| `flume` | 更快的 mpsc 通道 |

> 💡 **提示**：在大多数场景下，先尝试用 `rayon` 实现数据并行，这是最简单安全的方式。当需要更精细控制时再用原生线程和 `Mutex`。

---

**本章总结：**

| 主题 | 关键要点 |
|------|----------|
| 线程管理 | `std::thread::spawn`，move 闭包，join |
| 通道 mpsc | 多生产者单消费者，同步/异步通道 |
| Mutex / RwLock | 共享可变状态，注意死锁和中毒 |
| 原子类型 | Lock-Free 计数器，Ordering 内存顺序 |
| Send / Sync | 并发安全标记，自动推导 |
| 并发模式 | Actor 模式，工作窃取，分片策略 |
| 最佳实践 | 避免死锁，减少锁粒度，考虑第三方库 |
