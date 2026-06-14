# 第6章 特征与泛型

> 本章学习 Rust 实现多态和代码复用的两大核心机制：**泛型**（Generics）和**特征**（Traits）。Trait 类似于其他语言中的接口（Interface），但功能更强大。泛型让你编写可以作用于多种类型的代码。

---

## 6.1 Trait 的定义与实现

### 6.1.1 什么是 Trait

Trait 告诉 Rust 编译器：某个类型具有哪些**行为**（方法）。它定义了不同类型之间共享的功能。

```rust
// 定义一个 Trait
trait Summary {
    fn summarize(&self) -> String;  // 只有方法签名，没有实现
}
```

### 6.1.2 为类型实现 Trait

```rust
struct Article {
    title: String,
    author: String,
    content: String,
}

struct Tweet {
    username: String,
    content: String,
    retweet_count: u64,
}

// 为 Article 实现 Summary trait
impl Summary for Article {
    fn summarize(&self) -> String {
        format!("《{}》by {}", self.title, self.author)
    }
}

// 为 Tweet 实现 Summary trait
impl Summary for Tweet {
    fn summarize(&self) -> String {
        format!("{}: {}", self.username, self.content)
    }
}

fn main() {
    let article = Article {
        title: "Rust 入门".into(),
        author: "Alice".into(),
        content: "详细的 Rust 入门教程...".into(),
    };

    let tweet = Tweet {
        username: "@bob".into(),
        content: "学习了 Rust 的所有权！".into(),
        retweet_count: 42,
    };

    println!("文章摘要: {}", article.summarize());
    println!("推文摘要: {}", tweet.summarize());
}
```

### 6.1.3 Trait 实现规则

- trait 和类型**至少有一个**在当前 crate 中定义（孤儿规则）
- 可以为外部类型实现外部 trait 吗？不可以——孤儿规则禁止

> ⚠️ **孤儿规则**（Orphan Rule）：只有当 trait 或类型至少有一个在当前 crate 中时，才能为该类型实现该 trait。这防止了不同 crate 之间实现冲突。

---

## 6.2 泛型函数与泛型结构体

### 6.2.1 泛型函数

```rust
// 不使用泛型：需要为每种类型重复实现
fn largest_i32(list: &[i32]) -> &i32 {
    let mut largest = &list[0];
    for item in list {
        if item > largest {
            largest = item;
        }
    }
    largest
}

fn largest_char(list: &[char]) -> &char {
    let mut largest = &list[0];
    for item in list {
        if item > largest {
            largest = item;
        }
    }
    largest
}

// 使用泛型：一份代码适用于多种类型
fn largest<T: std::cmp::PartialOrd>(list: &[T]) -> &T {
    let mut largest = &list[0];
    for item in list {
        if item > largest {
            largest = item;
        }
    }
    largest
}

fn main() {
    let numbers = vec![34, 50, 25, 100, 65];
    let chars = vec!['y', 'm', 'a', 'q'];

    println!("最大数字: {}", largest(&numbers));
    println!("最大字符: {}", largest(&chars));
}
```

### 6.2.2 泛型结构体

```rust
// 单泛型参数
struct Point<T> {
    x: T,
    y: T,
}

impl<T> Point<T> {
    fn x(&self) -> &T {
        &self.x
    }
}

// 为特定类型实现方法
impl Point<f64> {
    fn distance_from_origin(&self) -> f64 {
        (self.x.powi(2) + self.y.powi(2)).sqrt()
    }
}

// 多泛型参数
struct MultiPoint<T, U> {
    x: T,
    y: U,
}

impl<T, U> MultiPoint<T, U> {
    fn mixup<V, W>(self, other: MultiPoint<V, W>) -> MultiPoint<T, W> {
        MultiPoint {
            x: self.x,
            y: other.y,
        }
    }
}

fn main() {
    let int_point = Point { x: 5, y: 10 };
    let float_point = Point { x: 1.0, y: 4.0 };

    // float_point 有 distance_from_origin，int_point 没有
    println!("距离原点: {}", float_point.distance_from_origin());

    let p1 = MultiPoint { x: 5, y: 10.4 };
    let p2 = MultiPoint { x: "Hello", y: 'c' };
    let p3 = p1.mixup(p2);
    println!("p3.x = {}, p3.y = {}", p3.x, p3.y);  // 5, c
}
```

### 6.2.3 泛型枚举

```rust
// Option<T> 和 Result<T, E> 都是泛型枚举
enum Option<T> {
    Some(T),
    None,
}

enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

### 6.2.4 泛型的性能

Rust 的泛型是**零成本抽象**——编译器为每个使用泛型的具体类型生成专用代码（单态化，monomorphization）：

```rust
let integer = Some(5);
let float = Some(5.0);

// 编译后相当于：
// enum Option_i32 { Some(i32), None }
// enum Option_f64 { Some(f64), None }
```

> 💡 单态化让泛型的运行时性能与手写的具体类型代码相同，但代价是编译后的二进制体积可能增大。

---

## 6.3 Trait 约束（Bounds）

### 6.3.1 基本约束

```rust
// 方式一：泛型参数后加冒号
fn notify<T: Summary>(item: &T) {
    println!("最新消息: {}", item.summarize());
}

// 方式二：使用 where 子句（更清晰，尤其多约束时）
fn notify_where<T>(item: &T)
where
    T: Summary,
{
    println!("最新消息: {}", item.summarize());
}

// 多个约束
fn multi_bound<T: Summary + Display>(item: &T) {
    println!("{}", item.summarize());
}

fn multi_bound_where<T>(item: &T)
where
    T: Summary + Display,
{
    println!("{}", item.summarize());
}
```

### 6.3.2 使用 impl Trait 语法

当只有一个泛型参数且作为函数参数时，`impl Trait` 语法更简洁：

```rust
// 等价于 fn notify<T: Summary>(item: &T)
fn notify(item: &impl Summary) {
    println!("最新消息: {}", item.summarize());
}

// impl Trait 用于返回值
fn returns_summarizable() -> impl Summary {
    Tweet {
        username: "horse_ebooks".into(),
        content: "当然，正如你可能会猜到，他们...".into(),
        retweet_count: 0,
    }
}
```

### 6.3.3 约束与条件实现

```rust
use std::fmt::Display;

struct Pair<T> {
    x: T,
    y: T,
}

// 所有 Pair<T> 都有的方法
impl<T> Pair<T> {
    fn new(x: T, y: T) -> Self {
        Self { x, y }
    }
}

// 仅当 T 实现了 Display + PartialOrd 时才有的方法
impl<T: Display + PartialOrd> Pair<T> {
    fn cmp_display(&self) {
        if self.x >= self.y {
            println!("最大的 x: {}", self.x);
        } else {
            println!("最大的 y: {}", self.y);
        }
    }
}
```

### 6.3.4 通过 Trait Bound 有条件地实现方法

```rust
// blanket implementation：为所有实现了 Display 的类型实现 ToString
// 标准库中的实际代码
impl<T: Display> ToString for T {
    // --snip--
}
```

---

## 6.4 常用 Trait

### 6.4.1 Debug — 格式化输出

```rust
#[derive(Debug)]
struct Person {
    name: String,
    age: u32,
}

fn main() {
    let p = Person {
        name: "Alice".into(),
        age: 30,
    };
    println!("{:?}", p);    // Person { name: "Alice", age: 30 }
    println!("{:#?}", p);   // 美化输出
}
```

### 6.4.2 Clone 与 Copy

```rust
#[derive(Clone, Copy, Debug)]
struct Record {
    id: u32,
    score: f64,
}

fn main() {
    let r1 = Record { id: 1, score: 95.5 };
    let r2 = r1;  // Copy，r1 仍然有效
    let r3 = r1.clone();  // 显式克隆
    println!("{:?}, {:?}, {:?}", r1, r2, r3);
}
```

> ⚠️ `Copy` 要求所有字段都实现了 `Copy`。`Clone` 要求所有字段都实现了 `Clone`。派生宏在字段不满足条件时会编译报错。

### 6.4.3 Eq 与 PartialEq

```rust
#[derive(Debug, PartialEq)]
struct Point {
    x: i32,
    y: i32,
}

fn main() {
    let p1 = Point { x: 1, y: 2 };
    let p2 = Point { x: 1, y: 2 };
    println!("p1 == p2: {}", p1 == p2);  // true

    // Eq 表示严格相等（数学上的等价关系）
    // PartialEq 允许浮点 NaN != NaN 这种不满足自反性的情况
}
```

### 6.4.4 Ord 与 PartialOrd

```rust
#[derive(Debug, PartialEq, PartialOrd)]
struct Version {
    major: u32,
    minor: u32,
    patch: u32,
}

fn main() {
    let v1 = Version { major: 1, minor: 2, patch: 0 };
    let v2 = Version { major: 1, minor: 3, patch: 0 };
    println!("v1 < v2: {}", v1 < v2);  // true
}
```

### 6.4.5 From 与 Into

```rust
#[derive(Debug)]
struct Number {
    value: i32,
}

// 实现 From 后自动获得 Into
impl From<i32> for Number {
    fn from(value: i32) -> Self {
        Number { value }
    }
}

fn main() {
    let num = Number::from(42);
    println!("{:?}", num);

    let num2: Number = 100.into();  // 通过 Into
    println!("{:?}", num2);

    // 常用场景：&str -> String
    let s: String = "hello".into();
}
```

### 6.4.6 Display — 用户友好输出

```rust
use std::fmt;

#[derive(Debug)]
struct Person {
    name: String,
    age: u32,
}

impl fmt::Display for Person {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{} ({}岁)", self.name, self.age)
    }
}

fn main() {
    let p = Person {
        name: "Alice".into(),
        age: 30,
    };
    println!("{}", p);           // Alice (30岁)  — Display
    println!("{:?}", p);         // Person { name: "Alice", age: 30 } — Debug
}
```

### 6.4.7 Default — 默认值

```rust
#[derive(Default, Debug)]
struct Config {
    host: String,
    port: u16,
    debug: bool,
}

fn main() {
    let config = Config::default();
    println!("{:?}", config);
    // Config { host: "", port: 0, debug: false }
}
```

### 6.4.8 常用 Trait 速查表

| Trait | 用途 | 派生宏 | 备注 |
|-------|------|--------|------|
| `Debug` | 调试输出 `{:?}` | `#[derive(Debug)]` | 几乎所有类型都应实现 |
| `Clone` | 显式深拷贝 `.clone()` | `#[derive(Clone)]` | 堆上数据需要 |
| `Copy` | 隐式位复制（栈） | `#[derive(Copy)]` | 仅栈上类型 |
| `PartialEq` | 相等比较 `==` | `#[derive(PartialEq)]` | 浮点类型有特殊行为 |
| `Eq` | 严格相等 | `#[derive(Eq)]` | 需要 PartialEq 父 trait |
| `PartialOrd` | 偏序比较 `<` `>` | `#[derive(PartialOrd)]` | 需要 PartialEq |
| `Ord` | 全序比较 | `#[derive(Ord)]` | 需要 Eq + PartialOrd |
| `Hash` | 哈希计算 | `#[derive(Hash)]` | 用于 HashMap key |
| `Default` | 默认值 `::default()` | `#[derive(Default)]` | 所有字段必须有默认值 |
| `Display` | 格式化输出 `{}` | ❌ 手动实现 | 用于用户展示 |
| `From`/`Into` | 类型转换 | ❌ 手动或 thiserror | 实现 From 自动得 Into |
| `Deref` | 解引用 `*v` | ❌ 手动 | 智能指针使用 |

---

## 6.5 关联类型与默认方法

### 6.5.1 关联类型（Associated Types）

关联类型是 trait 内部的**类型占位符**，在实现时指定具体类型：

```rust
// 关联类型 vs 泛型的区别：
// 泛型：一个类型可以实现多次（针对不同泛型参数）
// 关联类型：一个类型只能实现一次

// 标准库中的 Iterator trait 使用了关联类型
pub trait Iterator {
    type Item;  // 关联类型

    fn next(&mut self) -> Option<Self::Item>;
}

// 实现 Iterator
struct Counter {
    count: u32,
    max: u32,
}

impl Counter {
    fn new(max: u32) -> Self {
        Counter { count: 0, max }
    }
}

impl Iterator for Counter {
    type Item = u32;  // 指定关联类型

    fn next(&mut self) -> Option<Self::Item> {
        if self.count < self.max {
            self.count += 1;
            Some(self.count)
        } else {
            None
        }
    }
}

fn main() {
    let mut counter = Counter::new(3);
    while let Some(val) = counter.next() {
        println!("{}", val);  // 1, 2, 3
    }
}
```

**泛型 vs 关联类型：**

| 特性 | 泛型参数 | 关联类型 |
|------|---------|----------|
| 一个类型可实现次数 | 多次（不同泛型参数） | 一次 |
| 语义清晰度 | 较低（多参数时混乱） | 较高（类型自说明） |
| 典型应用 | 需要灵活组合 | 一个类型只有一种"输出" |
| 示例 | `From<T>` | `Iterator::Item` |

### 6.5.2 默认方法（Default Methods）

Trait 方法可以有**默认实现**：

```rust
trait Summary {
    fn summarize(&self) -> String {
        String::from("（阅读更多...）")
    }
}

// 可以不实现 summarize
struct NewsAlert {
    headline: String,
}

impl Summary for NewsAlert {}  // 使用默认实现

struct Article {
    title: String,
    author: String,
}

impl Summary for Article {
    fn summarize(&self) -> String {
        format!("《{}》by {}", self.title, self.author)
    }
}

fn main() {
    let alert = NewsAlert {
        headline: "重大新闻！".into(),
    };
    let article = Article {
        title: "Rust 入门".into(),
        author: "Alice".into(),
    };

    println!("{}", alert.summarize());   // （阅读更多...）
    println!("{}", article.summarize()); // 《Rust 入门》by Alice
}
```

### 6.5.3 默认方法中调用其他方法

```rust
trait Summary {
    fn author(&self) -> String;

    // 默认方法可以调用没有默认实现的方法
    fn summarize(&self) -> String {
        format!("（作者: {}）", self.author())
    }
}

impl Summary for Tweet {
    fn author(&self) -> String {
        self.username.clone()
    }
    // summarize 使用默认实现
}
```

### 6.5.4 可重载运算符

Rust 的运算符（`+`、`-`、`*` 等）也是通过 trait 实现的：

```rust
use std::ops::Add;

#[derive(Debug, PartialEq)]
struct Point {
    x: i32,
    y: i32,
}

impl Add for Point {
    type Output = Point;

    fn add(self, other: Point) -> Point {
        Point {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
}

fn main() {
    let p1 = Point { x: 1, y: 0 };
    let p2 = Point { x: 2, y: 3 };
    let p3 = p1 + p2;  // 使用 + 运算符
    assert_eq!(p3, Point { x: 3, y: 3 });
}
```

### 6.5.5 Trait 继承（Supertraits）

一个 trait 可以依赖另一个 trait：

```rust
trait Printable: std::fmt::Display {
    fn print(&self) {
        println!("{}", self);  // 使用 Display trait 的方法
    }
}

struct Person {
    name: String,
}

impl std::fmt::Display for Person {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "Person: {}", self.name)
    }
}

impl Printable for Person {}  // 因为已经实现了 Display

fn main() {
    let p = Person { name: "Alice".into() };
    p.print();  // Person: Alice
}
```

---

## 6.6 综合示例

一个完整的图形面积计算系统：

```rust
use std::fmt;

// 定义核心 Trait
trait Shape {
    fn area(&self) -> f64;
    fn perimeter(&self) -> f64;

    // 默认方法
    fn description(&self) -> String {
        format!(
            "面积: {:.2}, 周长: {:.2}",
            self.area(),
            self.perimeter()
        )
    }
}

// 结构体
struct Circle {
    radius: f64,
}

struct Rectangle {
    width: f64,
    height: f64,
}

struct Triangle {
    a: f64,
    b: f64,
    c: f64,
}

// 实现 Shape
impl Shape for Circle {
    fn area(&self) -> f64 {
        std::f64::consts::PI * self.radius * self.radius
    }

    fn perimeter(&self) -> f64 {
        2.0 * std::f64::consts::PI * self.radius
    }
}

impl Shape for Rectangle {
    fn area(&self) -> f64 {
        self.width * self.height
    }

    fn perimeter(&self) -> f64 {
        2.0 * (self.width + self.height)
    }
}

impl Shape for Triangle {
    fn area(&self) -> f64 {
        let s = (self.a + self.b + self.c) / 2.0;
        (s * (s - self.a) * (s - self.b) * (s - self.c)).sqrt()
    }

    fn perimeter(&self) -> f64 {
        self.a + self.b + self.c
    }
}

// Display 实现
impl fmt::Display for Circle {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "圆形 (半径: {})", self.radius)
    }
}

impl fmt::Display for Rectangle {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "矩形 ({} x {})", self.width, self.height)
    }
}

impl fmt::Display for Triangle {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "三角形 (边: {}, {}, {})", self.a, self.b, self.c)
    }
}

// 泛型函数：打印所有形状的信息（静态分发）
fn print_shape_info<T: Shape + fmt::Display>(shape: &T) {
    println!("形状: {}", shape);
    println!("  {}", shape.description());
}

// 使用 Trait 对象（Box<dyn Shape>）—— 动态分发
fn print_all_shapes(shapes: &[Box<dyn Shape>]) {
    for (i, shape) in shapes.iter().enumerate() {
        println!("#{}: {}", i + 1, shape.description());
    }
}

fn main() {
    let circle = Circle { radius: 5.0 };
    let rect = Rectangle {
        width: 4.0,
        height: 6.0,
    };
    let tri = Triangle {
        a: 3.0,
        b: 4.0,
        c: 5.0,
    };

    // 静态分发（编译期确定类型）
    print_shape_info(&circle);
    print_shape_info(&rect);
    print_shape_info(&tri);

    // 动态分发（运行期确定类型）
    let shapes: Vec<Box<dyn Shape>> = vec![
        Box::new(Circle { radius: 3.0 }),
        Box::new(Rectangle {
            width: 2.0,
            height: 8.0,
        }),
    ];
    print_all_shapes(&shapes);
}
```

---

## 6.7 静态分发 vs 动态分发

| 特性 | 静态分发（泛型） | 动态分发（Trait 对象） |
|------|-----------------|----------------------|
| 语法 | `fn foo<T: Trait>(t: &T)` | `fn foo(t: &dyn Trait)` |
| 分发时机 | 编译期（单态化） | 运行期（虚表） |
| 性能 | 零成本，可内联 | 有虚表查找开销 |
| 二进制大小 | 较大（代码膨胀） | 较小 |
| 适用场景 | 知道具体类型，追求极致性能 | 类型在运行时变化，需要异构集合 |
| 异构集合 | ❌ | ✅ `Vec<Box<dyn Trait>>` |

```rust
// 静态分发
fn process_static<T: Shape>(shape: &T) {
    println!("Area: {}", shape.area());
}

// 动态分发
fn process_dynamic(shape: &dyn Shape) {
    println!("Area: {}", shape.area());
}

// 异构集合——只能用动态分发
fn process_many(shapes: &[Box<dyn Shape>]) {
    for shape in shapes {
        println!("Area: {}", shape.area());
    }
}
```

### 6.7.1 Trait 对象的限制

```rust
// ❌ 以下 trait 不能用作 trait 对象
// trait 的方法返回 Self 类型
trait CloneTrait {
    fn clone_self(&self) -> Self;  // ❌
}

// trait 有泛型参数
trait GenericTrait<T> {  // ❌
    fn method(&self, t: T);
}

// ✅ 以下 trait 可以用作 trait 对象
trait SimpleTrait {
    fn method(&self);  // ✅ 没有泛型，没有 Self
}

// 可以使用 Sized bound 来限制
// dyn Trait 默认是 !Sized 的
```

---

## 6.8 本章小结

| 概念 | 要点 |
|------|------|
| **Trait** | Rust 中的"接口"，定义共享行为 |
| **泛型** | 编译期单态化，零成本抽象 |
| **Trait Bound** | 约束泛型类型必须实现某些 trait |
| **impl Trait** | 简化单泛型参数的语法糖 |
| **派生宏** | `#[derive(Debug, Clone, PartialEq)]` 自动实现常用 trait |
| **关联类型** | Trait 内部的类型占位符，如 `Iterator::Item` |
| **默认方法** | Trait 方法可以有默认实现 |
| **静态 vs 动态分发** | 泛型用静态分发；`dyn Trait` 用动态分发 |

**下一步**：进入第 7 章，学习 Rust 的模块系统和包管理工具 Cargo。

---

> 💡 **练习建议**：
> 1. 定义一个 `Vehicle` trait（`speed()`, `fuel_type()`），为 `Car` 和 `Bicycle` 实现它
> 2. 写一个泛型函数 `find_max`，接收 `&[T]` 返回最大值的引用
> 3. 尝试为自定义类型实现 `From<&str>`，使其能从字符串转换
> 4. 在 [rustlings](https://github.com/rust-lang/rustlings) 中完成 `traits` 和 `generics` 部分的练习
