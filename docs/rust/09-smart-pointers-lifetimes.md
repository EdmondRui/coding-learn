# 第9章 智能指针与生命周期

> 本章面向已掌握 Rust 基础所有权和借用概念的开发者。你将深入学习 Box、Rc、Arc、RefCell 等智能指针的内部原理与使用场景，掌握生命周期标注的进阶用法、省略规则及 'static 生命周期的真正含义。

---

## 9.1 Box`<T>` — 堆分配的智能指针

### 9.1.1 基本用法

`Box<T>` 是最简单的智能指针，将值分配在堆上并在栈上保留指针。

```rust
let b = Box::new(5); // i32 在堆上
println!("{}", b);   // 自动解引用

// 递归类型必须用 Box 打破无限大小
#[derive(Debug)]
enum List<T> {
    Cons(T, Box<List<T>>),
    Nil,
}

let list = List::Cons(1, Box::new(List::Cons(2, Box::new(List::Nil))));
```

### 9.1.2 性能与适用场景

**何时使用 Box：**

| 场景 | 说明 |
|------|------|
| 递归数据类型 | 枚举/结构体引用自身 |
| 大型数据移动 | 避免栈上拷贝大对象 |
| 类型擦除 (Trait Object) | `Box<dyn Trait>` 实现动态分发 |
| 堆分配但拥有唯一所有权 | 其他语言中的"指针"语义 |

**Box vs 栈分配：**

```rust
// 栈分配 — 默认
let x: [u8; 1024] = [0; 1024]; // 1048576 字节在栈上

// 堆分配 — 显式
let y: Box<[u8; 1024]> = Box::new([0; 1024]); // 栈上只有指针
```

### 9.1.3 自定义 Box — Deref 与 Drop

Box 之所以"智能"在于它实现了 `Deref` 和 `Drop`：

```rust
let b = Box::new(42);

// Deref 使得 *b 自动解引用
let n: i32 = *b;

// Drop 在离开作用域时自动释放堆内存
// 等价于 C++ 的 RAII
```

> 💡 **提示**：`Box::new` 会在堆上分配，但如果你有一个很大的栈上数据且只需要移动一次指针，使用 `Box::new(large_data)` 时 large_data 先存在栈上再复制到堆。推荐用 `Box::new_uninit()` 或 `alloc::alloc` 直接操作堆。

---

## 9.2 Rc`<T>` — 引用计数智能指针

### 9.2.1 共享所有权

`Rc<T>`（Reference Counted）允许**单线程内**多个所有者共享数据，通过引用计数管理生命周期。

```rust
use std::rc::Rc;

let a = Rc::new(42);
let b = Rc::clone(&a); // 增加引用计数，不深拷贝
let c = Rc::clone(&a);

println!("ref count: {}", Rc::strong_count(&a)); // 3

drop(b);
println!("ref count after drop: {}", Rc::strong_count(&a)); // 2
```

### 9.2.2 共享不可变数据

```rust
use std::rc::Rc;

#[derive(Debug)]
struct Config {
    host: String,
    port: u16,
}

let config = Rc::new(Config {
    host: "localhost".into(),
    port: 8080,
});

let handler1 = |_| { let c = Rc::clone(&config); move || { /* use c */ } };
let handler2 = |_| { let c = Rc::clone(&config); move || { /* use c */ } };
```

### 9.2.3 Weak`<T>` — 弱引用

`Weak<T>` 用于解决**循环引用**导致的内存泄漏：

```rust
use std::rc::{Rc, Weak};

struct Node {
    value: i32,
    children: Vec<Rc<Node>>,
    parent: Weak<Node>, // 弱引用避免循环
}

let leaf = Rc::new(Node {
    value: 3,
    children: vec![],
    parent: Weak::new(),
});

let branch = Rc::new(Node {
    value: 5,
    children: vec![Rc::clone(&leaf)],
    parent: Weak::new(),
});

// 通过 Weak 升级访问
if let Some(parent) = leaf.parent.upgrade() {
    println!("parent: {}", parent.value);
} else {
    println!("parent dropped"); // 这里会执行
}
```

> 💡 **提示**：`Weak::upgrade()` 返回 `Option<Rc<T>>`，因为弱引用不保证目标还存活。这在**缓存**和**观察者模式**中非常有用。

---

## 9.3 Arc`<T>` — 原子引用计数

`Arc<T>`（Atomic Rc）是 `Rc` 的线程安全版本，内部使用**原子操作**维护引用计数。

```rust
use std::sync::Arc;
use std::thread;

let data = Arc::new(vec![1, 2, 3]);

let mut handles = vec![];
for i in 0..3 {
    let data = Arc::clone(&data);
    handles.push(thread::spawn(move || {
        println!("Thread {i}: {:?}", data);
    }));
}

for handle in handles {
    handle.join().unwrap();
}
```

**Rc vs Arc：**

| 特性 | Rc | Arc |
|------|-----|-----|
| 线程安全 | ❌ 非线程安全 | ✅ 线程安全 |
| 性能 | ✅ 更快（非原子操作） | ⚠️ 略慢（原子操作开销） |
| 适用场景 | 单线程共享 | 多线程共享 |
| Weak 支持 | ✅ `std::rc::Weak` | ✅ `std::sync::Weak` |

> 💡 **提示**：单线程中优先用 `Rc`，多线程中用 `Arc`。不要无脑用 `Arc` 替代 `Rc`，不必要的原子操作有性能损耗。

---

## 9.4 RefCell`<T>` 与内部可变性

### 9.4.1 运行时借用检查

`RefCell<T>` 将借用检查从**编译时推迟到运行时**，提供**内部可变性**（Interior Mutability）。

```rust
use std::cell::RefCell;

let data = RefCell::new(42);

// 运行时借用
{
    let mut borrowed = data.borrow_mut();
    *borrowed += 1;
} // 借用结束

// 不可变借用
println!("{}", data.borrow());
```

**违反运行时借用规则会 panic：**

```rust
let data = RefCell::new(42);
let borrowed = data.borrow_mut();
// let another = data.borrow_mut(); // ❌ 运行时 panic：already borrowed
drop(borrowed);
```

### 9.4.2 与 Rc 组合实现共享可变性

```rust
use std::cell::RefCell;
use std::rc::Rc;

type SharedData = Rc<RefCell<Vec<i32>>>;

let data: SharedData = Rc::new(RefCell::new(vec![]));

let a = Rc::clone(&data);
let b = Rc::clone(&data);

a.borrow_mut().push(1);
b.borrow_mut().push(2);

println!("{:?}", data.borrow()); // [1, 2]
```

### 9.4.3 Cell vs RefCell vs OnceCell

```rust
use std::cell::{Cell, RefCell, OnceCell};

// Cell — 适用于 Copy 类型，无需借用，直接 get/set
let cell = Cell::new(42);
cell.set(100);
println!("{}", cell.get()); // 100

// RefCell — 适用于非 Copy 类型，运行时借用检查
let refcell = RefCell::new(String::from("hello"));
refcell.borrow_mut().push_str(" world");
println!("{}", refcell.borrow());

// OnceCell — 单次初始化（类似 lazy_static 但更轻量）
// 需要 unstable 或 once_cell crate
// let once: OnceCell<Vec<i32>> = OnceCell::new();
// once.set(vec![1, 2, 3]).unwrap();
```

| 类型 | 适用类型 | 线程安全 | 特点 |
|------|----------|----------|------|
| `Cell<T>` | `Copy` | ❌ | 直接 get/set，零运行时开销 |
| `RefCell<T>` | 任意 | ❌ | 运行时借用检查，可能 panic |
| `OnceCell<T>` | 任意 | ✅ | 单次写入，不可变读取 |

> 💡 **提示**：优先尝试常规借用模式（`&` / `&mut`），只在无法满足编译器时才用 `RefCell`。`RefCell` 的运行时检查有少量开销且会导致 panic。

---

## 9.5 Cow — 写时克隆优化

`Cow<'a, B>`（Clone-on-Write）是一个**枚举**，返回借用或拥有的值：

```rust
pub enum Cow<'a, B>
where
    B: ToOwned + ?Sized,
{
    Borrowed(&'a B),
    Owned(<B as ToOwned>::Owned),
}
```

### 9.5.1 延迟克隆

```rust
use std::borrow::Cow;

fn normalize(input: &str) -> Cow<'_, str> {
    if input.contains(' ') {
        // 只在需要修改时分配
        Cow::Owned(input.replace(' ', "_"))
    } else {
        // 无需修改时直接借用
        Cow::Borrowed(input)
    }
}

let s1 = "hello_world";
let s2 = "hello world";

println!("{}", normalize(s1)); // 借用，无分配
println!("{}", normalize(s2)); // 分配新 String
```

### 9.5.2 在集合中优化

```rust
use std::borrow::Cow;

fn dedup_prefix<'a>(words: &'a [String]) -> Vec<Cow<'a, str>> {
    let mut result: Vec<Cow<'a, str>> = Vec::new();
    let mut last_prefix = String::new();

    for word in words {
        if word.starts_with(&last_prefix) {
            // 借用原字符串
            result.push(Cow::Borrowed(word.as_str()));
        } else {
            // 需要修改时克隆
            last_prefix = word.clone();
            result.push(Cow::Owned(word.clone()));
        }
    }
    result
}
```

> 💡 **提示**：`Cow` 在 API 设计中常用于"尽量借用，必要时克隆"的场景，减少不必要的内存分配。注意 `Cow<'_, str>` 是返回类型时常用模式。

---

## 9.6 生命周期标注进阶

### 9.6.1 结构体中的生命周期

```rust
struct Parser<'a> {
    content: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(content: &'a str) -> Self {
        Parser { content, pos: 0 }
    }

    fn remaining(&self) -> &'a str {
        &self.content[self.pos..]
    }
}
```

### 9.6.2 多个生命周期参数

```rust
// 两个不同的生命周期
fn longest_with_prefix<'a, 'b>(x: &'a str, y: &'a str, prefix: &'b str) -> String
where
    'a: 'b, // 'a 至少和 'b 一样长
{
    format!("{}{}", prefix, if x.len() > y.len() { x } else { y })
}

// 结构体中两个生命周期
struct Context<'a, 'b> {
    name: &'a str,
    data: &'b [u8],
}

impl<'a, 'b> Context<'a, 'b> {
    fn new(name: &'a str, data: &'b [u8]) -> Self {
        Context { name, data }
    }
}
```

### 9.6.3 生命周期约束（Bounds）

```rust
// 'a 必须存活到 'b 之后
fn require_lifetime<'a, 'b>(x: &'a str, y: &'b str)
where
    'a: 'b,   // 'a 活过 'b
    'b: 'a,   // 'b 活过 'a — 实际等价于 'a = 'b
{}

// 生命周期约束在泛型中
struct Wrapper<'a, T: 'a> {
    // T 中的所有引用必须至少存活 'a
    value: &'a T,
}

// 'static 约束
fn static_ref<T: 'static>(t: T) -> T {
    t // T 不包含短于 'static 的引用
}
```

---

## 9.7 生命周期省略规则

### 9.7.1 三条规则

Rust 编译器自动省略（elide）生命周期标注：

```rust
// 规则1：每个输入引用有自己的生命周期
// fn foo(x: &i32)        → fn foo<'a>(x: &'a i32)
// fn foo(x: &i32, y: &i32) → fn foo<'a, 'b>(x: &'a i32, y: &'b i32)

// 规则2：如果只有一个输入生命周期，它赋给所有输出
// fn first(x: &str) -> &str   → fn first<'a>(x: &'a str) -> &'a str

// 规则3：如果是方法且 &self，self 的生命周期赋给所有输出
// fn get(&self, idx: usize) -> &T → fn get<'a>(&'a self, idx: usize) -> &'a T
```

**违反省略规则的例子（必须显式标注）：**

```rust
// ❌ 两个输入，需要输出，无法推断
// fn cmp(x: &str, y: &str) -> &str  // 编译错误

// ✅ 显式标注
fn cmp<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

### 9.7.2 省略规则与泛型结合

```rust
// 方法场景
impl<T> Vec<T> {
    // 规则3：self 生命周期赋给返回值
    pub fn get(&self, index: usize) -> Option<&T> { /* ... */ }
}

// 高阶 trait bound（HRTB）
// 某些场景需要 for<'a> 标注
fn call_with_ref<F>(f: F)
where
    F: for<'a> Fn(&'a str) -> &'a str,
{
    f("hello");
}
```

> 💡 **提示**：90% 的情况省略规则足以应对。当你写编译器报错需要生命周期时，先尝试从函数签名推断从哪个参数借用的，再补全标注。

---

## 9.8 'static 生命周期

### 9.8.1 真正含义

`'static` **不是"程序运行期间都在"**，而是**引用存活到程序结束**或**不包含任何短生命周期的引用**。

```rust
// 'static 引用 — 存储在二进制文件的只读段
let s: &'static str = "hello world";

// 'static 约束 — 类型不包含短于 'static 的引用
fn print_static<T: 'static>(t: &T) {
    // T 可以安全地存活任意久
}

// ❌ 非 'static — 包含引用
let x = 42;
let y = &x;
// print_static(y); // 编译错误：y 的生命周期不够长
```

### 9.8.2 常见误解

```rust
// 误解1：'static 一定全局
// 'static 只是"足够长"的泛型约束
fn foo<T: 'static>(t: T) {}

// 以下可以工作：String 不包含引用，满足 'static
foo(String::from("hello"));

// 以下不行：&'a str 包含引用
let s = "hello";
// foo(s); // 编译错误：&'a str 中 'a 不是 'static

// 误解2：'static 导致内存泄漏
// 正确的 'static 引用保证程序不 crash，但不会泄漏
```

### 9.8.3 'static 在类型中的约束

```rust
use std::thread;

// thread::spawn 要求闭包为 'static
// 因为线程可能比创建它的函数活得久
fn spawn_task() {
    let data = vec![1, 2, 3];
    thread::spawn(move || {
        println!("{:?}", data); // move 拿走所有权
    });
}

// 或者使用 Arc 共享
fn spawn_task2(data: Arc<Vec<i32>>) {
    thread::spawn(move || {
        println!("{:?}", data);
    });
}
```

### 9.8.4 将 &str 转换到 'static

```rust
// 运行时创建的字符串无法自动 'static
let runtime_str = format!("hello {}", 42);
// let s: &'static str = &runtime_str; // ❌ 编译错误

// 方案1：泄漏为静态引用（最终会内存泄漏）
let leaked: &'static str = Box::leak(runtime_str.into_boxed_str());

// 方案2：使用 once_cell / lazy_static
// use once_cell::sync::Lazy;
// static CONFIG: Lazy<String> = Lazy::new(|| {
//     std::fs::read_to_string("config.toml").unwrap()
// });
```

> 💡 **提示**：`Box::leak` 可以产生 `'static` 引用，但会导致内存泄漏。`thread::spawn` 的 `'static` 约束最常用的满足方式是 `move` 闭包拿走所有权。

---

## 9.9 各智能指针对比总结

| 指针 | 所有权 | 可变性 | 线程安全 | 运行时开销 |
|------|--------|--------|----------|-----------|
| `Box<T>` | 唯一 | 有或无 | ✅ 可 Send | 最小（堆分配） |
| `Rc<T>` | 共享 | 不可变 | ❌ | 引用计数增减 |
| `Arc<T>` | 共享 | 不可变 | ✅ | 原子操作 |
| `RefCell<T>` | 唯一 | 运行时可变 | ❌ | 运行时借用检查 |
| `Rc<RefCell<T>>` | 共享 | 运行时可变 | ❌ | 两者之和 |
| `Arc<Mutex<T>>` | 共享 | 运行时可变 | ✅ | 加锁 + 原子 |
| `Cow<'a, T>` | 借用或拥有 | 不可变 | 取决于包装 | 按需克隆 |

### 实战决策树

1. **唯一所有权？** → `Box<T>`
2. **需要共享？** → **单线程？** → `Rc<T>`
3. **需要共享 + 多线程？** → `Arc<T>`
4. **需要修改共享数据？** → **单线程？** → `Rc<RefCell<T>>`
5. **需要修改 + 多线程？** → `Arc<Mutex<T>>` 或 `Arc<RwLock<T>>`
6. **大部分时间借用，偶尔需要拥有？** → `Cow<'a, T>`

> 💡 **提示**：`Arc<Mutex<T>>` 是 Rust 中实现"多线程共享可变状态"的默认方案。注意死锁风险，优先用 `RwLock` 在读多写少的场景。

---

**本章总结：**

| 主题 | 关键要点 |
|------|----------|
| Box | 堆分配，唯一所有权，递归类型 |
| Rc / Arc | 共享所有权，单线程/多线程，注意循环引用 |
| RefCell | 内部可变性，运行时借用检查 |
| Cow | 写时克隆，API 设计中优化借用 |
| 生命周期进阶 | 多参数、约束、子类型关系 |
| 省略规则 | 三条规则简化 90% 标注 |
| 'static | 真正含义：类型不包含短生命周期引用 |
