# 第4章 结构体、枚举与模式匹配

> 本章学习 Rust 中组织数据的核心方式：结构体（struct）和枚举（enum），以及它们配合模式匹配（pattern matching）的强大用法。掌握这些内容后，你就能写出结构清晰的 Rust 代码。

---

## 4.1 结构体

### 4.1.1 定义与实例化

结构体使用 `struct` 关键字定义，将多个相关数据组合在一起：

```rust
// 定义结构体
struct User {
    active: bool,
    username: String,
    email: String,
    sign_in_count: u64,
}

fn main() {
    // 创建实例（所有字段必须初始化）
    let user1 = User {
        active: true,
        username: String::from("alice"),
        email: String::from("alice@example.com"),
        sign_in_count: 1,
    };

    // 访问字段
    println!("用户名: {}", user1.username);
    println!("邮箱: {}", user1.email);

    // 可变实例
    let mut user2 = User {
        active: true,
        username: String::from("bob"),
        email: String::from("bob@example.com"),
        sign_in_count: 1,
    };
    user2.email = String::from("bob@newdomain.com");  // 修改字段
}
```

### 4.1.2 字段初始化简写

当变量名与字段名相同时，可以使用简写：

```rust
fn build_user(email: String, username: String) -> User {
    User {
        active: true,
        username,  // 等同于 username: username
        email,     // 等同于 email: email
        sign_in_count: 1,
    }
}
```

### 4.1.3 结构体更新语法

使用 `..` 从另一个实例复制未显式设置的字段：

```rust
fn main() {
    let user1 = User {
        active: true,
        username: String::from("alice"),
        email: String::from("alice@example.com"),
        sign_in_count: 1,
    };

    let user2 = User {
        email: String::from("alice@new.com"),
        // username 和 sign_in_count 从 user1 移动过来
        ..user1  // 注意：username 被移动，user1 不能再使用
    };

    // println!("{}", user1.username);  // ❌ username 被移动
    println!("{}", user1.email);        // ✅ email 是 Copy 类型（不对，String 是 move）
    // 实际上 user1.email 也被移动了... 等等，user1.email 没有在 user2 中设置
    // 哦，..user1 会移动 username 和 sign_in_count
    // active 是 bool (Copy)，username 被移动，email 在 user2 中重新设置了
    // 所以 user1 部分失效
}
```

> ⚠️ 结构体更新语法会将未显式设置的字段从原实例 **move** 到新实例，导致原实例部分或全部失效。

### 4.1.4 元组结构体（Tuple Struct）

元组结构体是命名的元组，字段没有名称，通过索引访问：

```rust
struct Color(i32, i32, i32);
struct Point(i32, i32, i32);

fn main() {
    let black = Color(0, 0, 0);
    let origin = Point(0, 0, 0);

    println!("Color: ({}, {}, {})", black.0, black.1, black.2);

    // Color 和 Point 是不同的类型，即使内部结构相同
    // let p: Point = black;  // ❌ 类型不匹配
}
```

### 4.1.5 单元结构体（Unit-Like Struct）

没有任何字段的结构体，适用于需要在某种类型上实现 trait 但不需要存储数据：

```rust
struct AlwaysEqual;

fn main() {
    let subject = AlwaysEqual;
    // 单元结构体可用于标记类型、实现 trait 等
}
```

### 4.1.6 方法（Methods）

方法在 `impl` 块中定义，第一个参数总是 `self`（或其变体）：

```rust
#[derive(Debug)]
struct Rectangle {
    width: u32,
    height: u32,
}

impl Rectangle {
    // 方法：&self 借用
    fn area(&self) -> u32 {
        self.width * self.height
    }

    // 方法：&mut self 可变借用
    fn set_width(&mut self, width: u32) {
        self.width = width;
    }

    // 方法：self 获取所有权（较少使用）
    fn into_tuple(self) -> (u32, u32) {
        (self.width, self.height)
    }

    // 方法：多个参数
    fn can_hold(&self, other: &Rectangle) -> bool {
        self.width >= other.width && self.height >= other.height
    }
}

fn main() {
    let mut rect = Rectangle {
        width: 30,
        height: 50,
    };
    println!("面积: {}", rect.area());  // 1500
    println!("是否能容纳 (20x30): {}", rect.can_hold(&Rectangle {
        width: 20,
        height: 30,
    }));  // true

    rect.set_width(40);
    println!("修改后面积: {}", rect.area());  // 2000
}
```

### 4.1.7 关联函数（Associated Functions）

在 `impl` 块中没有 `self` 参数的函数称为关联函数（常作为构造函数）：

```rust
impl Rectangle {
    // 关联函数：String::from() 也是关联函数
    fn square(size: u32) -> Self {
        Self {
            width: size,
            height: size,
        }
    }
}

fn main() {
    let square = Rectangle::square(10);  // 使用 :: 语法调用
    println!("正方形面积: {}", square.area());
}
```

| 特性 | 方法 | 关联函数 |
|------|------|---------|
| 第一个参数 | `self` / `&self` / `&mut self` | 无 |
| 调用方式 | `实例.方法()` | `类型::函数()` |
| 典型用途 | 操作实例数据 | 构造函数、工具函数 |
| 示例 | `rect.area()` | `Rectangle::square(10)` |

### 4.1.8 多个 impl 块

一个结构体可以有多个 `impl` 块：

```rust
impl Rectangle {
    fn area(&self) -> u32 {
        self.width * self.height
    }
}

impl Rectangle {
    fn perimeter(&self) -> u32 {
        2 * (self.width + self.height)
    }
}
```

---

## 4.2 枚举

### 4.2.1 定义枚举

枚举（enum）允许你定义一组变体（variants），每个变体可以携带不同类型的数据：

```rust
enum IpAddrKind {
    V4,
    V6,
}

// 每个变体可以携带数据
enum IpAddr {
    V4(String),
    V6(String),
}

// 变体的数据类型可以不同
enum Message {
    Quit,                       // 无数据
    Move { x: i32, y: i32 },   // 匿名结构体
    Write(String),              // 字符串
    ChangeColor(i32, i32, i32), // 三个 i32
}

fn main() {
    let four = IpAddrKind::V4;
    let six = IpAddrKind::V6;

    let home = IpAddr::V4(String::from("127.0.0.1"));
    let loopback = IpAddr::V6(String::from("::1"));

    let msg = Message::Write(String::from("hello"));
    let msg2 = Message::Move { x: 10, y: 20 };
}
```

### 4.2.2 枚举的方法

枚举也可以定义方法：

```rust
impl Message {
    fn call(&self) {
        // 根据变体执行不同操作
        match self {
            Message::Quit => println!("退出"),
            Message::Move { x, y } => println!("移动到 ({x}, {y})"),
            Message::Write(text) => println!("写入: {text}"),
            Message::ChangeColor(r, g, b) => println!("变色: ({r}, {g}, {b})"),
        }
    }
}
```

### 4.2.3 枚举的内存布局

```rust
use std::mem;

fn main() {
    println!("Message 大小: {}", mem::size_of::<Message>());
    // 大小等于最大变体的大小 + 1 字节（判别值 tag）
    // Write(String) 是最大的，String 占 24 字节
    // 加上 1 字节 tag，对齐后可能是 32 字节
}
```

---

## 4.3 Option 与 Result

### 4.3.1 Option — 可选值枚举

Rust **没有** `null` 值，取而代之的是 `Option<T>` 枚举：

```rust
enum Option<T> {
    None,      // 无值
    Some(T),   // 有值
}

fn main() {
    let some_number = Some(5);          // Option<i32>
    let some_char = Some('a');          // Option<char>
    let absent_number: Option<i32> = None;  // 必须显式标注类型

    // Option<T> 不能直接与 T 运算
    let x: i8 = 5;
    let y: Option<i8> = Some(5);
    // let sum = x + y;  // ❌ 编译错误
}
```

> 💡 `Option<T>` 强制你处理空值情况，从根源上避免了**空指针异常**（Tony Hoare 称之为"十亿美元错误"）。

### 4.3.2 Result — 错误处理枚举

```rust
enum Result<T, E> {
    Ok(T),   // 成功
    Err(E),  // 失败
}

use std::fs::File;

fn main() {
    let file_result = File::open("hello.txt");

    let file = match file_result {
        Ok(file) => file,
        Err(error) => panic!("打开文件失败: {error}"),
    };
}
```

| 枚举 | 用途 | 变体 |
|------|------|------|
| `Option<T>` | 值可能存在或不存在 | `Some(T)` / `None` |
| `Result<T, E>` | 操作可能成功或失败 | `Ok(T)` / `Err(E)` |

第5章会详细讲解 `Result` 的错误处理方式。

---

## 4.4 match 与 if let

### 4.4.1 match 表达式

`match` 是 Rust 最强大的控制流运算符，类似于 C 的 `switch` 但更强大：

```rust
enum Coin {
    Penny,
    Nickel,
    Dime,
    Quarter,
}

fn value_in_cents(coin: Coin) -> u8 {
    match coin {
        Coin::Penny => {
            println!("幸运硬币！");
            1
        }
        Coin::Nickel => 5,
        Coin::Dime => 10,
        Coin::Quarter => 25,
    }
}
```

### 4.4.2 绑定值的模式

```rust
#[derive(Debug)]
enum UsState {
    Alabama,
    Alaska,
    // ... 其他州
}

enum Coin {
    Penny,
    Nickel,
    Dime,
    Quarter(UsState),
}

fn value_in_cents(coin: Coin) -> u8 {
    match coin {
        Coin::Penny => 1,
        Coin::Nickel => 5,
        Coin::Dime => 10,
        Coin::Quarter(state) => {
            println!("25 分硬币来自 {state:?}!");
            25
        }
    }
}
```

### 4.4.3 匹配 Option`<T>`

```rust
fn plus_one(x: Option<i32>) -> Option<i32> {
    match x {
        None => None,
        Some(i) => Some(i + 1),
    }
}

fn main() {
    let five = Some(5);
    let six = plus_one(five);
    let none = plus_one(None);

    println!("{:?}, {:?}, {:?}", five, six, none);
}
```

### 4.4.4 通配符与占位符

```rust
fn main() {
    let dice_roll = 9;

    match dice_roll {
        3 => println!("得 3：帽子加身！"),
        7 => println!("得 7：帽子被移除！"),
        other => println!("得 {other}：无事发生"),  // 通配符
    }

    // 或使用 _（忽略值，不绑定）
    match dice_roll {
        3 => println!("帽子加身！"),
        7 => println!("帽子被移除！"),
        _ => println!("无事发生"),  // 不使用值
    }

    // 如果什么都不想做：
    match dice_roll {
        3 => println!("帽子加身！"),
        7 => println!("帽子被移除！"),
        _ => (),  // 单元值，什么都不做
    }
}
```

### 4.4.5 if let 简洁匹配

当你只关心**一个**模式时，`if let` 比 `match` 更简洁：

```rust
fn main() {
    let config_max = Some(3u8);

    // match 写法
    match config_max {
        Some(max) => println!("最大值设为 {max}"),
        _ => (),
    }

    // if let 写法（更简洁）
    if let Some(max) = config_max {
        println!("最大值设为 {max}");
    }

    // if let 也可以搭配 else
    let mut count = 0;
    if let Coin::Quarter(state) = coin {
        println!("25分硬币来自 {state:?}!");
    } else {
        count += 1;
    }
}
```

| 特点 | `match` | `if let` |
|------|---------|----------|
| 穷尽性检查 | ✅ 必须覆盖所有分支 | ❌ 只检查一个模式 |
| 语法冗余度 | 高（所有分支都要写） | 低（只写关心的） |
| 适用场景 | 需要处理所有可能性 | 只关心一种情况 |
| else 分支 | `_ =>` | `if let ... else` |

---

## 4.5 模式匹配进阶

### 4.5.1 解构结构体

```rust
struct Point {
    x: i32,
    y: i32,
}

fn main() {
    let p = Point { x: 0, y: 7 };

    // let 解构
    let Point { x: a, y: b } = p;
    assert_eq!(0, a);
    assert_eq!(7, b);

    // 简写解构
    let Point { x, y } = p;
    assert_eq!(0, x);
    assert_eq!(7, y);

    // match 中解构
    match p {
        Point { x: 0, y } => println!("在 y 轴，y = {y}"),
        Point { x, y: 0 } => println!("在 x 轴，x = {x}"),
        Point { x, y } => println!("不在轴上: ({x}, {y})"),
    }
}
```

### 4.5.2 解构枚举与嵌套

```rust
enum Color {
    Rgb(i32, i32, i32),
    Hsv(i32, i32, i32),
}

enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
    ChangeColor(Color),
}

fn main() {
    let msg = Message::ChangeColor(Color::Hsv(0, 160, 255));

    match msg {
        Message::Quit => println!("Quit"),
        Message::Move { x, y } => println!("Move to ({x}, {y})"),
        Message::Write(text) => println!("Write: {text}"),
        Message::ChangeColor(Color::Rgb(r, g, b)) => {
            println!("RGB: {r}, {g}, {b}")
        }
        Message::ChangeColor(Color::Hsv(h, s, v)) => {
            println!("HSV: {h}, {s}, {v}")
        }
    }
}
```

### 4.5.3 解构元组和数组

```rust
fn main() {
    // 元组解构
    let tuple = (1, "hello", true);
    let (a, b, c) = tuple;
    println!("{a}, {b}, {c}");

    // 数组解构
    let arr = [1, 2, 3, 4, 5];
    let [first, second, .., last] = arr;
    println!("first: {first}, second: {second}, last: {last}");

    // 固定长度解构
    let [x, y, z] = [1, 2, 3];
    println!("{x}, {y}, {z}");
}
```

### 4.5.4 模式匹配守卫

```rust
fn main() {
    let num = Some(4);

    match num {
        Some(x) if x % 2 == 0 => println!("偶数: {x}"),
        Some(x) => println!("奇数: {x}"),
        None => (),
    }
}
```

### 4.5.5 @ 绑定

`@` 运算符在匹配时既测试值，又将其绑定到变量：

```rust
fn main() {
    let msg = Message::Move { x: 10, y: 30 };

    match msg {
        Message::Move { x: x_var @ 0..=10, y } => {
            println!("x 在 0~10 之间: {x_var}, y: {y}");
        }
        Message::Move { x, y } => {
            println!("其他位置: ({x}, {y})");
        }
        _ => (),
    }
}
```

### 4.5.6 范围匹配

```rust
fn main() {
    let x = 5;

    match x {
        1..=5 => println!("在 1 到 5 之间"),  // 包含 1 和 5
        _ => println!("其他"),
    }

    let c = 'c';
    match c {
        'a'..='z' => println!("小写字母"),
        'A'..='Z' => println!("大写字母"),
        _ => println!("其他字符"),
    }
}
```

### 4.5.7 | 多模式匹配

```rust
fn main() {
    let x = 2;

    match x {
        1 | 2 => println!("1 或 2"),
        3..=5 => println!("3 到 5"),
        _ => println!("其他"),
    }
}
```

### 4.5.8 忽略模式中的值

```rust
fn main() {
    // 完全忽略
    foo(3, 4);  // 只使用 y
    fn foo(_: i32, y: i32) {
        println!("y = {y}");
    }

    // 嵌套忽略
    let mut setting_value = Some(5);
    let new_setting_value = Some(10);

    match (setting_value, new_setting_value) {
        (Some(_), Some(_)) => {
            println!("已有值，不可覆盖");
        }
        _ => {
            setting_value = new_setting_value;
        }
    }

    // 忽略剩余部分
    struct Point3D {
        x: i32,
        y: i32,
        z: i32,
    }

    let origin = Point3D { x: 0, y: 0, z: 0 };
    match origin {
        Point3D { x, .. } => println!("x = {x}"),
    }
}
```

---

## 4.6 综合示例

将本章所学综合起来：

```rust
// 定义一个表示 IP 地址的类型
#[derive(Debug)]
enum IpAddr {
    V4(u8, u8, u8, u8),
    V6(String),
}

// 定义一个表示网络服务的结构体
#[derive(Debug)]
struct Service {
    name: String,
    ip: IpAddr,
    port: u16,
    status: ServiceStatus,
}

#[derive(Debug)]
enum ServiceStatus {
    Running,
    Stopped,
    Unknown,
}

impl Service {
    fn new(name: String, ip: IpAddr, port: u16) -> Self {
        Self {
            name,
            ip,
            port,
            status: ServiceStatus::Stopped,
        }
    }

    fn start(&mut self) {
        self.status = ServiceStatus::Running;
        println!("服务 {} 已启动", self.name);
    }

    fn stop(&mut self) {
        self.status = ServiceStatus::Stopped;
        println!("服务 {} 已停止", self.name);
    }

    fn describe(&self) -> String {
        let ip_str = match &self.ip {
            IpAddr::V4(a, b, c, d) => format!("{a}.{b}.{c}.{d}"),
            IpAddr::V6(addr) => addr.clone(),
        };
        let status_str = match self.status {
            ServiceStatus::Running => "运行中",
            ServiceStatus::Stopped => "已停止",
            ServiceStatus::Unknown => "未知",
        };
        format!(
            "{}: {}:{} [{}]",
            self.name, ip_str, self.port, status_str
        )
    }
}

fn main() {
    let mut web = Service::new(
        String::from("web-server"),
        IpAddr::V4(192, 168, 1, 1),
        8080,
    );

    web.start();
    println!("{}", web.describe());

    // 使用 if let 检查状态
    if let ServiceStatus::Running = web.status {
        println!("Web 服务正在运行中...");
    }

    web.stop();
}
```

---

## 4.7 本章小结

| 概念 | 要点 |
|------|------|
| **结构体** | 组合相关数据，可定义方法，字段初始化简写和更新语法 |
| **元组结构体** | 命名字段元组，通过索引访问 |
| **枚举** | 一组变体，每个变体可携带不同类型数据 |
| **Option/Result** | 分别解决空值和错误处理，无需 null |
| **match** | 穷尽性检查的分支控制，可解构、绑定、守卫 |
| **if let** | 单模式匹配的简洁语法 |
| **模式匹配** | 支持解构、守卫、@绑定、范围、多模式等 |

**下一步**：进入第 5 章，深入理解 Rust 的错误处理机制。

---

> 💡 **练习建议**：
> 1. 定义一个 `Shape` 枚举（Circle, Rectangle, Triangle），为每个变体实现 `area()` 方法
> 2. 用结构体表示学生成绩系统（Student, Course, Grade）
> 3. 用 `match` 实现一个简单的计算器（处理 `+`, `-`, `*`, `/` 操作符）
> 4. 在 [rustlings](https://github.com/rust-lang/rustlings) 中完成 `structs`, `enums`, `quiz1` 部分的练习
