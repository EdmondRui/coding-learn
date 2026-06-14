# 第2章 基础语法与变量

> 本章面向已安装 Rust 的读者，系统讲解 Rust 的基础语法，包括变量声明、数据类型、函数、控制流、字符串和类型转换等核心概念。

---

## 2.1 变量声明

### 2.1.1 let 绑定

Rust 中变量使用 `let` 关键字声明，默认**不可变**（immutable）：

```rust
fn main() {
    let x = 5;
    // x = 6;  // 编译错误！不可变变量不能二次赋值
    println!("x = {x}");
}
```

> 💡 Rust 默认不可变的设计是为了安全——你不需要担心变量在无意中被修改。

### 2.1.2 mut 可变变量

在 `let` 后加 `mut` 关键字使变量可变：

```rust
fn main() {
    let mut y = 10;
    println!("y = {y}");
    y = 20;  // 正确
    println!("y = {y}");
}
```

### 2.1.3 常量（const）

常量使用 `const` 声明，**必须标注类型**，值必须在编译期已知：

```rust
const MAX_POINTS: u32 = 100_000;
const PI: f64 = 3.141592653589793;
const APP_NAME: &str = "My Rust App";
```

| 特性 | `let` | `let mut` | `const` |
|------|-------|-----------|---------|
| 可重新赋值 | ❌ | ✅ | ❌ |
| 编译期求值 | ❌ | ❌ | ✅ |
| 必须标注类型 | ❌（可推断） | ❌（可推断） | ✅ |
| 全局有效 | ❌ | ❌ | ✅ |
| 运行时存在 | ✅ | ✅ | ❌（内联） |

### 2.1.4 变量的遮蔽（Shadowing）

Rust 允许在同一作用域中重用变量名，这称为**遮蔽**：

```rust
fn main() {
    let x = 5;
    let x = x + 1;      // 遮蔽，x 现在是 6
    let x = x * 2;      // 遮蔽，x 现在是 12
    println!("x = {x}"); // 12

    // 遮蔽可以改变变量类型
    let spaces = "   ";         // &str 类型
    let spaces = spaces.len();  // usize 类型（遮蔽后类型改变）
    println!("Spaces: {spaces}"); // 3
}
```

> 💡 遮蔽与 `mut` 的区别：`mut` 是在同一变量上修改值，遮蔽是创建了一个全新的变量（可以改变类型）。

---

## 2.2 数据类型

Rust 是**静态类型**语言，编译时必须知道所有变量的类型。

### 2.2.1 标量类型（Scalar Types）

标量类型代表单个值，分为四类：

#### 整数类型

| 长度 | 有符号 | 无符号 | 范围 |
|------|--------|--------|------|
| 8-bit | `i8` | `u8` | -128~127 / 0~255 |
| 16-bit | `i16` | `u16` | -32768~32767 / 0~65535 |
| 32-bit | `i32` | `u32` | -2^31~2^31-1 / 0~2^32-1 |
| 64-bit | `i64` | `u64` | -2^63~2^63-1 / 0~2^64-1 |
| 128-bit | `i128` | `u128` | -2^127~2^127-1 / 0~2^128-1 |
| arch | `isize` | `usize` | 与指针宽度相同（32/64位） |

```rust
fn main() {
    let a: i8 = -128;
    let b: u32 = 42;
    let c = 100;          // 默认 i32
    let d: usize = 123;   // 用于数组索引

    // 数字字面量可以用下划线分隔以提升可读性
    let big: i64 = 1_000_000_000;
    // 进制前缀
    let hex = 0xff;       // 255
    let octal = 0o77;     // 63
    let binary = 0b1111;  // 15
    let byte = b'A';      // 65 (仅限 u8)
}
```

> ⚠️ **注意**：整数溢出在 Debug 模式下会 panic，在 Release 模式下会执行环绕（wrapping）运算。

#### 浮点类型

```rust
fn main() {
    let x = 2.0;    // 默认 f64（双精度）
    let y: f32 = 3.0; // 单精度

    // 浮点运算
    let sum = x + y as f64;
    let diff = x - 1.5;
    let product = x * 3.0;
    let quotient = x / 2.0;
    let remainder = x % 1.5;
}
```

| 类型 | 精度 | 字节数 | 用途 |
|------|------|--------|------|
| `f32` | 约 7 位小数 | 4 字节 | 图形处理、存储节省 |
| `f64` | 约 15-16 位小数 | 8 字节 | 通用计算（默认） |

#### 布尔类型

```rust
fn main() {
    let is_ok: bool = true;
    let is_fail = false;  // 类型推断为 bool

    // 与 C 不同，Rust 的布尔类型不能与整数互转
    // let n = true as i32;  // ✅ 但是可以使用 as 转换
}
```

#### 字符类型

```rust
fn main() {
    let c: char = 'z';
    let z: char = 'ℤ';
    let emoji: char = '😀'; // 单个 Unicode 标量值

    // char 占 4 字节，而非 1 字节
    println!("char size: {}", std::mem::size_of::<char>()); // 4
}
```

### 2.2.2 复合类型（Compound Types）

#### 元组（Tuple）

```rust
fn main() {
    // 创建元组
    let tup: (i32, f64, char) = (500, 6.4, 'a');

    // 模式匹配解构
    let (x, y, z) = tup;
    println!("x = {x}, y = {y}, z = {z}");

    // 通过索引访问
    let first = tup.0;  // 500
    let second = tup.1; // 6.4

    // 单元类型（空元组）
    let empty: () = ();
    // 函数不返回任何值时，隐式返回 ()
}
```

#### 数组（Array）

```rust
use std::mem;

fn main() {
    // 定长数组（长度在编译期确定）
    let arr: [i32; 5] = [1, 2, 3, 4, 5];
    let first = arr[0];  // 1

    // 使用相同值初始化
    let ones = [1; 5];  // [1, 1, 1, 1, 1]

    // 数组长度是类型的一部分
    // let _wrong: [i32; 3] = [1, 2, 3, 4];  // 编译错误

    // 越界访问在运行时 panic
    // let oops = arr[10];  // 💥 运行时 panic

    // 数组与切片的区别
    let slice: &[i32] = &arr[1..3];  // [2, 3]
    println!("Array size: {}", mem::size_of_val(&arr));  // 20 (5 * 4)
}
```

| 特性 | 数组 `[T; N]` | 元组 `(T1, T2, ...)` |
|------|---------------|---------------------|
| 元素类型 | 必须相同 | 可以不同 |
| 长度固定 | ✅（编译期） | ✅（编译期） |
| 访问方式 | 索引 `arr[i]` | 索引 `tup.0` 或解构 |
| 常用场景 | 已知长度的数据集合 | 返回多个值 |

---

## 2.3 函数定义与控制流

### 2.3.1 函数定义

```rust
// 函数命名使用 snake_case
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// 多参数函数
fn add(x: i32, y: i32) -> i32 {
    x + y  // 最后一个表达式被隐式返回（注意没有分号）
}

// 使用 return 提前返回
fn factorial(n: u64) -> u64 {
    if n == 0 {
        return 1;
    }
    n * factorial(n - 1)
}

fn main() {
    let msg = greet("Rust");
    println!("{msg}");
    println!("2 + 3 = {}", add(2, 3));
    println!("5! = {}", factorial(5));
}
```

> 💡 **表达式 vs 语句**：Rust 中，**语句**以分号结尾不返回值，**表达式**计算并返回值。函数体最后表达式的值作为返回值。

### 2.3.2 if/else 表达式

```rust
fn main() {
    let number = 7;

    // if 是表达式，可以用于赋值
    let desc = if number % 2 == 0 {
        "偶数"
    } else {
        "奇数"
    };
    println!("{number} 是{desc}");

    // 多条件
    let score = 85;
    let grade = if score >= 90 {
        "A"
    } else if score >= 80 {
        "B"
    } else if score >= 70 {
        "C"
    } else {
        "D"
    };
    println!("成绩等级: {grade}");
}
```

> ⚠️ **注意**：`if` 是表达式，各分支返回的类型必须一致。

### 2.3.3 循环

Rust 提供三种循环：`loop`、`while`、`for`。

#### loop — 无限循环

```rust
fn main() {
    let mut counter = 0;

    // loop 可以返回值
    let result = loop {
        counter += 1;
        if counter == 10 {
            break counter * 2;  // 带返回值跳出循环
        }
    };
    println!("结果: {result}"); // 20
}
```

#### while — 条件循环

```rust
fn main() {
    let mut number = 3;
    while number > 0 {
        println!("{number}...");
        number -= 1;
    }
    println!("发射！🚀");
}
```

#### for — 区间遍历

```rust
fn main() {
    // 遍历区间
    for i in 1..=5 {
        print!("{i} ");  // 1 2 3 4 5
    }
    println!();

    // 遍历数组
    let arr = [10, 20, 30, 40];
    for elem in arr {
        print!("{elem} ");
    }
    println!();

    // 带索引遍历
    for (index, value) in arr.iter().enumerate() {
        println!("arr[{index}] = {value}");
    }
}
```

#### 循环标签

```rust
fn main() {
    let mut count = 0;
    'outer: loop {
        'inner: loop {
            if count >= 5 {
                break 'outer;  // 跳出外层循环
            }
            count += 1;
            break 'inner;       // 跳出内层循环
        }
    }
    println!("count = {count}"); // 5
}
```

---

## 2.4 字符串

Rust 的字符串系统是语言中最具特色的部分之一，包含 `String` 和 `&str` 两种类型。

### 2.4.1 String vs &str

| 特性 | `String` | `&str` |
|------|---------|--------|
| 所有权 | 拥有数据 | 借用的引用 |
| 可变性 | 可变（push/pop） | 不可变 |
| 存储位置 | 堆上 | 字符串字面量在静态区，或指向 String 的堆 |
| 大小 | 3 个 word（ptr, len, cap） | 2 个 word（ptr, len） |
| 创建 | `String::from("hello")` | `"hello"` |
| 适用场景 | 需要修改或拥有字符串数据 | 只读访问、函数参数 |

```rust
fn main() {
    // 创建 String
    let mut s1 = String::from("你好");
    s1.push_str("，世界");  // 追加字符串
    s1.push('！');           // 追加字符
    println!("{s1}");

    // &str 字符串字面量
    let s2: &str = "Hello, world!";
    // s2.push_str("!");  // 编译错误！&str 不可变

    // 转换
    let s3: String = s2.to_string();   // &str -> String
    let s4: &str = &s1;                // String -> &str（通过借用）
}
```

### 2.4.2 字符串操作

```rust
fn main() {
    let mut s = String::new();

    // 追加
    s.push_str("Hello");
    s.push(' ');

    // 拼接
    let s1 = String::from("Hello, ");
    let s2 = String::from("world!");
    let s3 = s1 + &s2;  // s1 被移动，不能再使用
    println!("{s3}");

    // format! 宏（推荐方式，不获取所有权）
    let s4 = String::from("Hello");
    let s5 = String::from("Rust");
    let greeting = format!("{s4}, {s5}!");
    println!("{greeting}");  // Hello, Rust!
    // s4 和 s5 都仍然可用
}
```

### 2.4.3 字符串索引与切片

Rust 字符串不支持直接通过索引访问：

```rust
fn main() {
    let s = String::from("你好");

    // let c = s[0];  // 编译错误！String 不支持索引访问

    // 原因：Rust 字符串是 UTF-8 编码，"你" 占 3 字节
    // 直接索引可能返回不完整的字符

    // 切片（需要谨慎）
    let slice = &s[0..3];  // "你"（3 字节）
    println!("{slice}");

    // 如果切到字符中间会 panic
    // let bad = &s[0..2];  // 💥 panic!
}

// 正确的字符遍历方式
fn print_chars() {
    let s = "你好世界";
    for c in s.chars() {
        print!("{c} ");  // 你 好 世 界
    }
    println!();

    // 遍历字节
    for b in s.bytes() {
        print!("{b:02x} ");
    }
    // e4 bd a0 e5 a5 bd e4 b8 96 e7 95 8c
}
```

> 💡 **建议**：不要用索引操作字符串。需要遍历字符用 `.chars()`，需要操作子串用安全的 slice 方法（确保在字符边界）。

---

## 2.5 运算符与类型转换

### 2.5.1 算术运算符

```rust
fn main() {
    let a = 10;
    let b = 3;

    println!("加法: {}", a + b);     // 13
    println!("减法: {}", a - b);     // 7
    println!("乘法: {}", a * b);     // 30
    println!("除法: {}", a / b);     // 3（整数除法，截断取整）
    println!("取余: {}", a % b);     // 1

    // 浮点数除法
    println!("浮点除法: {}", 10.0 / 3.0);  // 3.333...
}
```

### 2.5.2 比较运算符

```rust
fn main() {
    let a = 10;
    let b = 20;

    println!("a == b: {}", a == b);  // false
    println!("a != b: {}", a != b);  // true
    println!("a < b: {}", a < b);    // true
    println!("a <= b: {}", a <= b);  // true
    println!("a > b: {}", a > b);    // false
    println!("a >= b: {}", a >= b);  // false
}
```

### 2.5.3 逻辑运算符

```rust
fn main() {
    let t = true;
    let f = false;

    println!("AND: {}", t && f);  // false
    println!("OR: {}", t || f);   // true
    println!("NOT: {}", !t);      // false
}
```

### 2.5.4 类型转换

Rust 使用 `as` 关键字进行显式类型转换：

```rust
fn main() {
    // 数值转换
    let a: i32 = 42;
    let b: i64 = a as i64;
    let c: f64 = a as f64;

    // 可能丢失精度的转换
    let large: f64 = 3.14159265;
    let truncated: i32 = large as i32;  // 3（截断小数）

    // 布尔转整数
    let is_true = true;
    println!("true as i32 = {}", is_true as i32);  // 1

    // 字符转 u8
    let byte = b'A' as u8;  // 65

    // 字符串转数字（使用 parse 方法）
    let num: i32 = "42".parse().expect("不是有效数字");
    let num2: f64 = "3.14".parse().unwrap();

    // 使用 turbofish 语法
    let num3 = "100".parse::<i32>().unwrap();
}
```

### 2.5.5 位运算符

```rust
fn main() {
    let a: u8 = 0b1010;  // 10
    let b: u8 = 0b1100;  // 12

    println!("a & b = {:04b}", a & b);   // 1000 (8)
    println!("a | b = {:04b}", a | b);   // 1110 (14)
    println!("a ^ b = {:04b}", a ^ b);   // 0110 (6)
    println!("!a    = {:04b}", !a);      // 11110101 (245)
    println!("a << 1 = {:04b}", a << 1); // 10100 (20)
    println!("a >> 1 = {:04b}", a >> 1); // 0101 (5)
}
```

---

## 2.6 注释

Rust 支持三种注释方式：

```rust
/// 文档注释：会生成文档（用于函数、结构体等）
/// # 示例
/// ```
/// let result = add(2, 3);
/// assert_eq!(result, 5);
/// ```
fn add(x: i32, y: i32) -> i32 {
    x + y
}

//! 内部文档注释：用于 crate 或模块级别（通常写在文件开头）
//! 这个 crate 包含了数学工具函数

// 普通行注释
fn main() {
    // 这是行内注释
    let x = 42; /* 块注释 */

    // 生成文档：cargo doc --open
    println!("add(2, 3) = {}", add(2, 3));
}
```

> 💡 `cargo doc --open` 会生成 HTML 文档并在浏览器中打开。编写良好的文档注释是 Rust 生态的惯例。

---

## 2.7 本章小结

本章我们学习了 Rust 的基础语法：

| 概念 | 要点 |
|------|------|
| **变量** | `let` 默认不可变，`mut` 可变，`const` 编译期常量，shadowing 机制 |
| **标量类型** | `i8`-`i128`、`u8`-`u128`、`f32`/`f64`、`bool`、`char` |
| **复合类型** | 元组 `()` 可存不同类型，数组 `[]` 存同类型定长集合 |
| **函数** | `fn` 关键字，最后一个表达式作为返回值 |
| **控制流** | `if` 是表达式，`loop`/`while`/`for` 三种循环 |
| **字符串** | `String` 拥有、可变；`&str` 借用、不可变；UTF-8 编码 |
| **类型转换** | 使用 `as` 或 `parse::<T>()` |

**下一步**：进入第 3 章，学习 Rust 最核心的概念——所有权与借用系统。

---

> 💡 **练习建议**：
> 1. 编写一个函数接收摄氏度并返回华氏度：`c_to_f(30.0) -> 86.0`
> 2. 使用 `for` 循环打印斐波那契数列的前 20 项
> 3. 编写一个反转字符串的函数（提示：`.chars().rev().collect()`）
> 4. 在 [rustlings](https://github.com/rust-lang/rustlings) 中完成 `variables` 和 `functions` 部分的练习
