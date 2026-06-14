# 第3章 所有权与借用

> 本章是 Rust 学习的**最关键**章节。所有权（Ownership）是 Rust 最独特的特性，它让 Rust 在没有垃圾回收器（GC）的前提下保证内存安全。请务必仔细阅读并理解本章内容。

---

## 3.1 所有权规则

### 3.1.1 什么是所有权

所有权是 Rust 管理内存的一组规则，编译器在编译期进行检查。核心规则如下：

1. **每个值都有一个所有者（owner）**
2. **同一时间只有一个所有者**
3. **当所有者离开作用域，值被自动释放**

```rust
fn main() {
    {  // s 尚未声明
        let s = String::from("hello");  // s 进入作用域
        // 使用 s
    }  // 作用域结束，s 被自动释放（drop）
    // 此时 s 已不可访问
}
```

> 💡 Rust 通过 `Drop` trait 自动释放资源，相当于 C++ 的 RAII（资源获取即初始化）模式。

### 3.1.2 Move 语义

Rust 中，将一个值赋给另一个变量时，会发生 **move（所有权转移）**：

```rust
fn main() {
    let s1 = String::from("hello");
    let s2 = s1;  // s1 的所有权移动到 s2

    // println!("{s1}");  // 编译错误！s1 已失效
    println!("{s2}");  // 正确，s2 拥有数据
}
```

**内存示意图：**

```
移动前：           移动后：
s1                  s1 (已废弃)
├─ ptr ──→ "hello"  ├─ ptr ──→ (无效)
├─ len: 5           ├─ len: (无效)
└─ cap: 5           └─ cap: (无效)
                    s2
                    ├─ ptr ──→ "hello"
                    ├─ len: 5
                    └─ cap: 5
```

> ⚠️ **重要**：Rust **不会**进行"浅拷贝"（即复制指针）。移动后原变量被编译器标记为无效，避免了**双重释放**（double free）错误。

对于**标量类型**（如 `i32`、`bool`、`f64`），实现了 `Copy` trait 的类型不会发生 move，而是直接复制：

```rust
fn main() {
    let x = 5;
    let y = x;  // Copy，x 仍有效
    println!("x = {x}, y = {y}");  // ✅ 两者都可用

    let b = true;
    let c = b;
    println!("{b}, {c}");  // ✅
}
```

**实现了 `Copy` 的常见类型：**

| 类型 | 说明 |
|------|------|
| 所有整数类型 | `i32`, `u64`, `usize` 等 |
| 所有浮点类型 | `f32`, `f64` |
| 布尔类型 | `bool` |
| 字符类型 | `char` |
| 元组（仅包含 Copy 元素时） | `(i32, f64)` |
| 数组（仅包含 Copy 元素时） | `[i32; 3]` |

### 3.1.3 Clone 显式克隆

如果需要**深拷贝**堆上的数据，使用 `.clone()`：

```rust
fn main() {
    let s1 = String::from("hello");
    let s2 = s1.clone();  // 深拷贝堆数据

    println!("s1 = {s1}");  // ✅ s1 仍然有效
    println!("s2 = {s2}");  // ✅ s2 是独立拷贝
}
```

| 操作 | 行为 | 开销 |
|------|------|------|
| `let y = x`（`x: i32`） | Copy（栈上复制） | 极低 |
| `let y = x`（`x: String`） | Move（所有权转移） | 极低（仅移动指针） |
| `let y = x.clone()`（`x: String`） | Clone（堆上数据也复制） | 高（取决于数据大小） |

### 3.1.4 所有权与函数

将变量传递给函数也会发生所有权转移：

```rust
fn take_ownership(s: String) {
    println!("take_ownership: {s}");
}  // s 在此被 drop

fn make_copy(i: i32) {
    println!("make_copy: {i}");
}  // i 是 Copy 类型，无影响

fn main() {
    let s = String::from("hello");
    let n = 42;

    take_ownership(s);
    // println!("{s}");  // 编译错误！s 已被移动

    make_copy(n);
    println!("{n}");  // ✅ n 是 Copy 类型
}
```

**返回值也可以转移所有权：**

```rust
fn give_ownership() -> String {
    String::from("hello")  // 所有权转移给调用者
}

fn take_and_give(s: String) -> String {
    s  // 所有权再次转移
}

fn main() {
    let s1 = give_ownership();
    let s2 = take_and_give(s1);
    // println!("{s1}");  // 编译错误！
    println!("{s2}");  // ✅
}
```

---

## 3.2 引用与借用

为了避免频繁的所有权转移，Rust 提供了**引用**（reference）机制。

### 3.2.1 不可变引用（&T）

```rust
fn calculate_length(s: &String) -> usize {
    s.len()  // 借用 s，不获取所有权
}  // s 离开作用域，但不 drop 指向的数据

fn main() {
    let s1 = String::from("hello");
    let len = calculate_length(&s1);  // 传入引用

    println!("'{s1}' 的长度是 {len}");  // ✅ s1 仍可用
}
```

**引用规则：**
- 创建引用称为**借用**（borrowing）
- 引用不会获取所有权
- 引用离开作用域时，不会 drop 数据

### 3.2.2 可变引用（&mut T）

```rust
fn change(s: &mut String) {
    s.push_str(", world");
}

fn main() {
    let mut s = String::from("hello");
    change(&mut s);
    println!("{s}");  // hello, world
}
```

### 3.2.3 引用规则——数据竞争预防

Rust 在编译期通过以下规则防止数据竞争：

1. **同一时间只能有一个可变引用**
2. **可以有多个不可变引用**
3. **不能同时存在可变引用和不可变引用**

```rust
fn main() {
    let mut s = String::from("hello");

    let r1 = &s;
    let r2 = &s;     // ✅ 多个不可变引用
    // let r3 = &mut s;  // ❌ 编译错误！已有不可变引用
    println!("{r1}, {r2}");

    // 不可变引用不再使用后，可以创建可变引用
    let r3 = &mut s;  // ✅ 没问题
    println!("{r3}");
}
```

> 💡 **引用的作用域**：引用的作用域从声明处开始，到最后一次使用结束（NLL — Non-Lexical Lifetimes 机制）。这使得上面的代码合法——`r1` 和 `r2` 在 `println!` 后就不再被使用。

**悬垂引用（Dangling Reference）：**

Rust 编译器保证引用永远不会悬垂：

```rust
// fn dangle() -> &String {     // 编译错误！
//     let s = String::from("hello");
//     &s
// }  // s 被 drop，返回的引用指向无效内存

fn no_dangle() -> String {
    let s = String::from("hello");
    s  // 直接返回所有权，没问题
}
```

### 3.2.4 引用规则总结

| 场景 | 允许？ | 说明 |
|------|--------|------|
| 多个不可变引用（`&T`） | ✅ | 只读，无数据竞争 |
| 单个可变引用（`&mut T`） | ✅ | 独占写权限 |
| 同时存在不可变和可变引用 | ❌ | 可能导致数据竞争 |
| 多个可变引用 | ❌ | 编译错误 |
| 悬垂引用 | ❌ | 编译错误 |
| 引用离开作用域 drop 数据 | ❌ | 不会 drop，只是借用 |

---

## 3.3 生命周期标注

生命周期（lifetimes）是 Rust 用来确保引用始终有效的机制。

### 3.3.1 为什么需要生命周期

```rust
// 编译错误：缺少生命周期标注
// fn longest(x: &str, y: &str) -> &str {
//     if x.len() > y.len() { x } else { y }
// }
```

编译器无法知道返回的引用是 `x` 还是 `y`，因此无法确定返回值的生命周期。

### 3.3.2 生命周期注解语法

```rust
// 'a 是一个生命周期参数，表示所有引用的共同存活期
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

fn main() {
    let s1 = String::from("long");
    let result;
    {
        let s2 = String::from("short");
        result = longest(&s1, &s2);
        println!("较长的是: {result}");  // ✅ 在作用域内
    }
    // println!("较长的是: {result}");  // ❌ s2 已失效，result 引用也已无效
}
```

### 3.3.3 生命周期省略规则

Rust 编译器有一套**生命周期省略规则**，在很多常见场景中可以省略标注：

```rust
// 以下代码不需要显式生命周期注解
fn first_word(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or("")
}

// 输入生命周期
fn foo(x: &str) -> &str { x }  // 合法：编译器自动推断

// 方法中的生命周期
impl<'a> Struct<'a> {
    fn get(&self) -> &str { self.data }  // 合法：省略规则生效
}
```

**三条省略规则：**

1. 每个引用参数都有自己的生命周期参数
2. 如果只有一个输入生命周期参数，它被赋予所有输出生命周期参数
3. 如果有多个输入生命周期参数，但其中一个是 `&self` 或 `&mut self`（方法），`self` 的生命周期被赋予所有输出生命周期参数

### 3.3.4 结构体中的生命周期

```rust
struct Excerpt<'a> {
    part: &'a str,  // 结构体包含引用时必须标注生命周期
}

fn main() {
    let novel = String::from("Call me Ishmael. Some years ago...");
    let first_sentence = novel.split('.').next().expect("没有找到句子");
    let excerpt = Excerpt { part: first_sentence };

    println!("引用内容: {}", excerpt.part);
}
```

### 3.3.5 生命周期标注速查

| 语法 | 含义 |
|------|------|
| `&'a T` | T 的引用，至少存活 `'a` |
| `&'a mut T` | T 的可变引用，至少存活 `'a` |
| `T: 'a` | T 必须比 `'a` 存活得更久 |
| `fn f<'a>(x: &'a str)` | 函数有生命周期参数 `'a` |
| `struct S<'a>` | 结构体有生命周期参数 `'a` |

> 💡 **静态生命周期**：`'static` 表示引用在整个程序运行期间有效。字符串字面量就是 `&'static str` 类型。

---

## 3.4 所有权与函数实践

### 3.4.1 参数所有权模式

```rust
// 模式1：获取所有权（调用者放弃所有权）
fn consume(s: String) {
    println!("消费: {s}");
}  // s 被 drop

// 模式2：借用（调用者保留所有权）
fn borrow(s: &String) {
    println!("借用: {s}");
}

// 模式3：可变借用（调用者保留所有权，允许修改）
fn modify(s: &mut String) {
    s.push_str("!");
}

fn main() {
    let mut s = String::from("hello");

    borrow(&s);           // 只读借用
    modify(&mut s);       // 可变借用
    println!("{s}");      // hello!

    consume(s);           // 所有权转移
    // println!("{s}");   // 编译错误
}
```

### 3.4.2 返回所有权

```rust
// 有时需要返回传入的值，以便调用者能继续使用
fn process_string(s: String) -> String {
    // 处理 s...
    s  // 返回所有权
}

// 更常见的模式是使用引用
fn process_string_ref(s: &str) -> String {
    format!("处理: {s}")
}

fn main() {
    let s = String::from("data");
    let s = process_string(s);  // 重新获取所有权
    println!("{s}");

    let s2 = String::from("more data");
    let result = process_string_ref(&s2);
    println!("{s2}");     // ✅ 仍然拥有
    println!("{result}"); // ✅ 新字符串
}
```

---

## 3.5 切片（Slice）

切片是对集合中**连续一段元素**的引用，它没有所有权，也是一种引用类型。

### 3.5.1 字符串切片

```rust
fn main() {
    let s = String::from("hello world");

    let hello = &s[0..5];  // "hello"
    let world = &s[6..11]; // "world"

    println!("{hello} {world}");

    // 省略边界
    let s2 = &s[..5];   // 从开头到索引5: "hello"
    let s3 = &s[6..];   // 从索引6到结尾: "world"
    let s4 = &s[..];    // 整个字符串: "hello world"
}
```

**切片内存结构：**

```
s: String
├─ ptr ──→ "hello world"
├─ len: 11
└─ cap: 11

&s[0..5]: &str
├─ ptr ──→ "hello" (指向 s 内部的同一内存)
└─ len: 5
```

### 3.5.2 字符串切片的实际应用

```rust
// 传统方式（返回索引，不方便）
fn first_word_index(s: &String) -> usize {
    s.bytes()
        .position(|b| b == b' ')
        .unwrap_or(s.len())
}

// Rust 方式（返回切片，更安全）
fn first_word(s: &str) -> &str {
    // s.as_bytes().iter().position(|&b| b == b' ') ... 或者：
    s.split_whitespace().next().unwrap_or(s)
}

fn main() {
    let s = String::from("hello world");
    let word = first_word(&s);
    // s.clear();  // ❌ 编译错误！s 有不可变借用
    println!("第一个词: {word}");
}
```

> 💡 注意到 `first_word` 参数类型是 `&str` 而非 `&String`，这使其能同时接受 `&str` 和 `&String`（通过自动解引用）。

### 3.5.3 其他类型的切片

```rust
fn main() {
    let arr = [1, 2, 3, 4, 5, 6, 7, 8];

    let slice = &arr[2..5];       // &[i32] 类型: [3, 4, 5]
    let slice_mut = &mut arr[..]; // 可变切片: 整个数组

    println!("slice: {slice:?}");     // [3, 4, 5]
    println!("length: {}", slice.len()); // 3

    slice_mut[0] = 100;  // 修改原数组
    println!("arr: {arr:?}");  // [100, 2, 3, 4, 5, 6, 7, 8]
}
```

### 3.5.4 &str 与 &String 的关系

```rust
// &String 可以自动转换为 &str（Deref coercion）
fn takes_str(s: &str) {
    println!("{s}");
}

fn main() {
    let s = String::from("hello");
    takes_str(&s);   // &String 自动转为 &str ✅
    takes_str("hello");  // 字符串字面量 &str ✅

    // &str 是 &String 的"视图"，更通用
    // 函数参数尽量用 &str 而非 &String
}
```

| 特性 | `String` | `&str` | 切片 `&[T]` |
|------|----------|--------|-------------|
| 所有权 | 拥有 | 借用 | 借用 |
| 可变 | 可变（mut 时） | 不可变 | 可变/不可变 |
| 底层 | `Vec<u8>`（UTF-8 编码） | 两个指针（ptr + len） | 两个指针（ptr + len） |
| 适用函数参数 | 需要修改或拥有时 | 只读访问时 | 数组/向量只读访问 |

---

## 3.6 所有权核心思想总结

### 3.6.1 设计理念

```
程序安全 = 内存安全 + 并发安全
        ↕
    所有权系统
        ↕
    编译期检查（零运行时开销）
```

Rust 的所有权系统通过**编译期**的静态分析实现内存安全：
- 没有 GC 的运行时性能开销
- 没有手动内存管理的风险
- 编译器在出问题前就告诉你

### 3.6.2 常见面试问题

| 问题 | 答案 |
|------|------|
| 什么是 move？ | 所有权从一个变量转移到另一个变量，原变量失效 |
| Copy 和 Clone 的区别？ | Copy 是隐式的位复制（栈上），Clone 是显式的深拷贝（堆上） |
| 什么是借用？ | 通过引用使用值而不获取所有权 |
| 可变引用和不可变引用的限制？ | 同时只能有一个可变引用或多个不可变引用 |
| 什么是 NLL？ | Non-Lexical Lifetimes，引用作用域到最后一次使用结束 |
| 什么是悬垂引用？ | 指向已释放内存的引用，Rust 在编译期阻止 |

---

## 3.7 本章小结

本章是 Rust 学习的**基石**，我们学习了：

| 概念 | 核心要点 |
|------|---------|
| **所有权** | 三原则：每值一主、唯一所有者、作用域结束自动释放 |
| **Move 语义** | 赋值/传参时所有权转移，原变量失效 |
| **引用与借用** | `&T` 不可变借用，`&mut T` 可变借用，编译器防止数据竞争 |
| **生命周期** | `'a` 标注确保引用有效，编译器有三条省略规则 |
| **切片** | `&[T]` 和 `&str` 是对集合连续段的引用，无所有权 |

**下一步**：进入第 4 章，学习用结构体、枚举和模式匹配组织数据。

---

> 💡 **练习建议**：
> 1. 写一个 `String` 版本的 `reverse` 函数，传引用返回新字符串
> 2. 实现 `find_substring` 函数，返回第一个匹配位置的切片
> 3. 写一个函数接收 `&[i32]` 返回最大值和最小值的引用
> 4. 尝试在 [rustlings](https://github.com/rust-lang/rustlings) 中完成 `move_semantics` 和 `lifetimes` 部分的练习
