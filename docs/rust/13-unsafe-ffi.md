# 第13章 Unsafe Rust 与 FFI

> 本章面向已掌握 Rust 核心概念和生命周期机制的开发者。你将学习 Unsafe Rust 的五大超能力、原始指针操作、与 C 语言交互的 FFI 技术、bindgen 自动绑定生成，以及如何在 unsafe 代码中维护内存安全。

---

## 13.1 Unsafe 五大能力

### 13.1.1 概述

`unsafe` 关键字开启了 Rust 中的**五种额外能力**，它们绕过了编译器的安全检查：

```rust
unsafe {
    // 1. 解引用原始指针
    let ptr = 0x1234 as *const i32;
    let val = *ptr; // unsafe

    // 2. 调用 unsafe 函数
    unsafe_fn();

    // 3. 访问/修改可变静态变量
    static mut COUNTER: u32 = 0;
    COUNTER += 1;

    // 4. 实现 unsafe trait
    // 在 impl 块中

    // 5. 访问 union 的字段
    // let u = MyUnion { i: 42 };
    // println!("{}", u.i); // unsafe
}

unsafe fn unsafe_fn() {
    println!("This is unsafe!");
}
```

### 13.1.2 Unsafe 不是"关闭安全检查"

```rust
// 误解：unsafe 会关掉所有检查
unsafe {
    let v = vec![1, 2, 3];
    // &v[100] // 仍然会 panic（边界检查仍在！）
}

// 正确理解：unsafe 只能做那五件事
// 其他的安全检查（借用、类型检查）仍然生效
```

### 13.1.3 Safe 与 Unsafe 的契约

```rust
// Safe 函数必须保证调用者的安全
// Unsafe 函数要求调用者满足前置条件

/// # Safety
/// - `ptr` 必须对齐且指向已初始化的 i32
/// - `ptr` 必须在其生命周期内有效
unsafe fn read_value(ptr: *const i32) -> i32 {
    *ptr
}

// Safe 包装 —— 封装 Unsafe 实现
fn safe_read(ptr: *const i32) -> Option<i32> {
    if ptr.is_null() {
        return None;
    }
    // ptr 非空但不一定有效，这里只是示例
    Some(unsafe { *ptr })
}
```

> 💡 **提示**：编写 unsafe 函数时，必须在文档注释中用 `# Safety` 标注调用者需要保证的前提条件。这既是好习惯，也是 clippy 建议的做法。

---

## 13.2 原始指针操作

### 13.2.1 `*const T` 与 `*mut T`

原始指针与引用/智能指针的区别：

```rust
let mut x = 42;
let ref_x = &x;                    // &i32: 保证有效且对齐
let raw_const = &x as *const i32;  // *const i32: 无保证
let raw_mut = &mut x as *mut i32;  // *mut i32: 无保证

// 原始指针的特点：
// 1. 可以忽略借用规则（多个 *mut 同时存在）
// 2. 可以为 null
// 3. 可以指向无效内存
// 4. 不自动实现 Send/Sync
// 5. 没有生命周期标注
let null_ptr: *const i32 = std::ptr::null();
let null_mut: *mut i32 = std::ptr::null_mut();

assert!(null_ptr.is_null());
```

### 13.2.2 指针运算

```rust
let arr = [1, 2, 3, 4, 5];
let ptr = arr.as_ptr();

unsafe {
    // 指针偏移
    let second = *ptr.add(1);
    assert_eq!(second, 2);

    // 偏移（可负）
    let fourth = *ptr.add(3);
    assert_eq!(fourth, 4);

    // offset 方法（可检查是否越界）
    // ptr.offset(10); // 未定义行为！越界了
}
```

### 13.2.3 类型转换（指针 cast）

```rust
// 指针类型转换
let x: i32 = 42;
let ptr: *const i32 = &x as *const i32;
let ptr_void: *const std::ffi::c_void = ptr as *const std::ffi::c_void;

// 整数转指针（常用于裸机/OS 开发）
let addr: usize = 0x7ffe_0000_0000;
let ptr = addr as *const u8;

// unsafe { *ptr }; // 很可能 SIGSEGV — 地址无效

// 指针别名（transmute）
let bytes: [u8; 4] = unsafe { std::mem::transmute(42i32) };
assert_eq!(bytes, [42, 0, 0, 0]);
```

### 13.2.4 std::ptr 工具函数

```rust
use std::ptr;

// write — 覆盖写入（不 drop 旧值）
let mut x = 42;
let p = &mut x as *mut i32;
unsafe {
    ptr::write(p, 100);
}
assert_eq!(x, 100);

// swap — 交换两个指针指向的值
let mut a = 1;
let mut b = 2;
unsafe {
    ptr::swap(&mut a, &mut b);
}
assert_eq!(a, 2);
assert_eq!(b, 1);

// replace — 替换并返回旧值
let mut v = vec![1, 2, 3];
let old = unsafe {
    ptr::replace(&mut v, vec![4, 5, 6])
};
assert_eq!(old, vec![1, 2, 3]);

// read — 从指针读取（复制比特位）
let v = 42u64;
let p = &v as *const u64;
let low_u32: u32 = unsafe { ptr::read(p as *const u32) };
// Warning: 小端序机器上 low_u32 = 42

// 零值初始化
let zeroed: u64 = unsafe { std::mem::zeroed() };
assert_eq!(zeroed, 0);
```

**ptr 工具函数对比：**

| 函数 | 作用 | 与正常操作的区别 |
|------|------|-----------------|
| `read(p)` | 从 p 读值 | 不检查所有权，比特拷贝 |
| `write(p, v)` | 向 p 写值 | 不 drop 旧值 |
| `swap(p, q)` | 交换两个值 | 等价于 `std::mem::swap` |
| `replace(p, v)` | 替换并返回旧值 | 等价于 `std::mem::replace` |
| `drop_in_place(p)` | 原地 drop | 带 Drop 检查 |

> 💡 **提示**：使用 `ptr::read` 和 `ptr::write` 要非常小心所有权问题。它们产生的是**比特拷贝**，可能导致双 free 或泄漏。通常只用于实现 `ManuallyDrop` 配合的底层数据结构。

### 13.2.5 NonNull`<T>` — 非空指针

```rust
use std::ptr::NonNull;

// NonNull 保证指针不为 null，且自动实现 Send/Sync（如果 T: Send/Sync）
let mut val = 42;
let nn = NonNull::new(&mut val as *mut i32).unwrap();

unsafe {
    *nn.as_ptr() = 100;
}
assert_eq!(val, 100);

// NonNull 常用于 FFI 和集合类型
struct MyCollection<T> {
    items: NonNull<T>,
    len: usize,
    cap: usize,
}
```

---

## 13.3 调用 C 函数（FFI）

### 13.3.1 extern 块声明

```rust
use std::ffi::CStr;
use std::os::raw::c_int;

// 声明外部 C 函数
extern "C" {
    fn strlen(s: *const std::ffi::c_char) -> usize;
    fn abs(x: c_int) -> c_int;
    fn atoi(s: *const std::ffi::c_char) -> c_int;
}

fn safe_strlen(s: &str) -> usize {
    let c_str = std::ffi::CString::new(s).expect("CString::new failed");
    unsafe { strlen(c_str.as_ptr()) }
}
```

### 13.3.2 调用约定

| 约定名 | 说明 | 适用场景 |
|--------|------|----------|
| `"C"` | C 语言 ABI | 大多数 C 库 |
| `"stdcall"` | Win32 API | Windows 系统调用 |
| `"fastcall"` | 寄存器传参 | 特定平台优化 |
| `"system"` | 平台默认 | macOS/Linux/Windows 自适应 |
| `"rust"` | Rust 原生 | Rust 内部互操作 |

### 13.3.3 C 回调函数

```rust
use std::ffi::c_void;

// 接受 C 回调
extern "C" {
    fn qsort(
        base: *mut c_void,
        num: usize,
        size: usize,
        compar: Option<unsafe extern "C" fn(*const c_void, *const c_void) -> i32>,
    );
}

// 定义 C 兼容的比较函数
unsafe extern "C" fn compare_i32(a: *const c_void, b: *const c_void) -> i32 {
    let a = *(a as *const i32);
    let b = *(b as *const i32);
    a.cmp(&b) as i32
}

fn main() {
    let mut numbers = vec![3, 1, 4, 1, 5, 9, 2, 6];
    unsafe {
        qsort(
            numbers.as_mut_ptr() as *mut c_void,
            numbers.len(),
            std::mem::size_of::<i32>(),
            Some(compare_i32),
        );
    }
    println!("{:?}", numbers); // [1, 1, 2, 3, 4, 5, 6, 9]
}
```

### 13.3.4 C 结构体互操作

```rust
use std::os::raw::c_char;

// C 结构体（需要 #[repr(C)] 确保布局一致）
#[repr(C)]
#[derive(Debug)]
struct Point {
    x: f64,
    y: f64,
}

// 包含指针的结构体
#[repr(C)]
struct Person {
    name: *const c_char,
    age: i32,
}

extern "C" {
    fn create_point(x: f64, y: f64) -> Point;
    fn point_distance(p1: *const Point, p2: *const Point) -> f64;
}

fn main() {
    let p = unsafe { create_point(10.0, 20.0) };
    println!("Point: {:?}", p);

    // 在 Rust 端创建 C 兼容结构体
    let name = std::ffi::CString::new("Alice").unwrap();
    let person = Person {
        name: name.as_ptr(),
        age: 30,
    };
    // 函数接受 &Person 但需要 C 布局
    // unsafe { some_c_function(&person as *const Person) };
}
```

### 13.3.5 CString 与 CStr

```rust
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

// Rust -> C：创建以 \0 结尾的字符串
let rust_str = "Hello, FFI!";
let c_str = CString::new(rust_str).expect("contains null byte");
let ptr: *const c_char = c_str.as_ptr();

// C -> Rust：读取 C 字符串
// 假设从 C 函数返回了 *const c_char
unsafe {
    let c_s = CStr::from_ptr(ptr);
    let rust_string = c_s.to_str().unwrap();
    println!("从 C 读取: {}", rust_string);
}

// 注意事项
// 1. CString::new 会检查内部是否有 \0（因为 C 字符串以 \0 终止）
// 2. CStr 是借用，不拥有内存
// 3. 记得释放 C 分配的内存（按照库的约定）
```

> 💡 **提示**：FFI 中的字符串处理极易出错。`CString::new` 如果输入包含内部 `\0` 会返回 `Err`。从 C 返回的 `*const c_char` 必须确保指针有效以及释放策略正确。

---

## 13.4 bindgen 自动绑定生成

### 13.4.1 bindgen 概述

[bindgen](https://rust-lang.github.io/rust-bindgen/) 从 C/C++ 头文件自动生成 Rust FFI 绑定。

```bash
# 安装
cargo install bindgen-cli

# 基本使用
bindgen input.h -o output.rs

# 带参数
bindgen input.h \
    --no-layout-tests \
    --no-prepend-enum-name \
    --size_t-is-usize \
    -o bindings.rs
```

### 13.4.2 在 build.rs 中使用

```toml
# Cargo.toml
[build-dependencies]
bindgen = "0.70"
```

```rust
// build.rs
use std::env;
use std::path::PathBuf;

fn main() {
    // 告诉 Cargo 如果头文件改变则重新运行
    println!("cargo:rerun-if-changed=wrapper.h");

    let bindings = bindgen::Builder::default()
        .header("wrapper.h") // 包含所有需要的头文件
        .clang_arg("-I./include") // 额外的 include 路径
        .allowlist_function("my_lib_.*") // 只暴露特定函数
        .allowlist_type("MyType") // 只暴露特定类型
        .generate()
        .expect("Unable to generate bindings");

    let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .expect("Couldn't write bindings!");
}
```

```rust
// src/lib.rs
include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
```

### 13.4.3 wrapper.h 示例

```c
// wrapper.h — 包含所有需要绑定的 C 头文件
#include "my_lib.h"
#include "my_structs.h"

// 也可以手动定义需要的类型
typedef struct {
    double x;
    double y;
} Point;

// bindgen 会为所有可见的类型生成绑定
```

### 13.4.4 bindgen 配置选项

```rust
// build.rs 中的高级配置
let bindings = bindgen::Builder::default()
    .header("wrapper.h")
    // 类型映射
    .type_alias("size_t", "usize")
    // 将某些类型替换为 Rust 原生类型
    .rustified_enum("MyEnum")
    // 为 struct 生成 Copy + Clone
    .derive_default(true)
    .derive_debug(true)
    .derive_hash(true)
    // 布局测试（验证布局匹配）
    .layout_tests(true)
    // 只在nightly上可用的功能
    .rust_target(bindgen::RustTarget::stable_2021_10)
    // 函数重命名
    .translate_enum_integer_values(true)
    // 只生成特定前缀的绑定
    .allowlist_function("my_lib_.*")
    .blocklist_function("internal_.*")
    .generate()
    .expect("Failed to generate bindings");
```

> 💡 **提示**：`bindgen` 生成的是 raw FFI 绑定，通常还需要一层 safe wrapper 才能真正用在 Rust 项目中。`allowlist` 和 `blocklist` 能有效控制生成的内容大小。

---

## 13.5 Unsafe 抽象封装

### 13.5.1 安全包装模式

```rust
/// 一个安全的原始指针包装器
/// 保证：永远指向有效的、已初始化的 i32
struct SafePtr {
    ptr: *mut i32,
}

// 注意：我们手动保证线程安全
unsafe impl Send for SafePtr {}
unsafe impl Sync for SafePtr {}

impl SafePtr {
    /// 从已有的有效指针创建
    /// # Safety
    /// ptr 必须指向有效的已初始化 i32
    unsafe fn new(ptr: *mut i32) -> Self {
        SafePtr { ptr }
    }

    /// 分配并初始化
    fn allocate(value: i32) -> Self {
        let ptr = Box::into_raw(Box::new(value));
        SafePtr { ptr }
    }

    fn get(&self) -> &i32 {
        unsafe { &*self.ptr }
    }

    fn set(&mut self, value: i32) {
        unsafe { *self.ptr = value; }
    }
}

impl Drop for SafePtr {
    fn drop(&mut self) {
        // 安全：ptr 始终由 Box::into_raw 创建
        unsafe {
            drop(Box::from_raw(self.ptr));
        }
    }
}
```

### 13.5.2 自定义 Vec 实现

```rust
use std::alloc::{self, Layout};
use std::ptr::{self, NonNull};

struct MyVec<T> {
    ptr: NonNull<T>,
    len: usize,
    capacity: usize,
}

impl<T> MyVec<T> {
    fn new() -> Self {
        // 零容量时不需要分配
        MyVec {
            ptr: NonNull::dangling(),
            len: 0,
            capacity: 0,
        }
    }

    fn push(&mut self, elem: T) {
        if self.len == self.capacity {
            self.grow();
        }
        unsafe {
            ptr::write(self.ptr.as_ptr().add(self.len), elem);
        }
        self.len += 1;
    }

    fn pop(&mut self) -> Option<T> {
        if self.len == 0 {
            return None;
        }
        self.len -= 1;
        unsafe {
            Some(ptr::read(self.ptr.as_ptr().add(self.len)))
        }
    }

    fn grow(&mut self) {
        let (new_cap, layout) = if self.capacity == 0 {
            (1, Layout::array::<T>(1).unwrap())
        } else {
            let new_cap = self.capacity * 2;
            let layout = Layout::array::<T>(new_cap).unwrap();
            (new_cap, layout)
        };

        // 注意：这里简化了 realloc 逻辑
        let new_ptr = if self.capacity == 0 {
            unsafe { alloc::alloc(layout) }
        } else {
            let old_layout = Layout::array::<T>(self.capacity).unwrap();
            unsafe {
                alloc::realloc(
                    self.ptr.as_ptr() as *mut u8,
                    old_layout,
                    layout.size(),
                )
            }
        };

        self.ptr = match NonNull::new(new_ptr as *mut T) {
            Some(p) => p,
            None => alloc::handle_alloc_error(layout),
        };
        self.capacity = new_cap;
    }
}

impl<T> Drop for MyVec<T> {
    fn drop(&mut self) {
        if self.capacity != 0 {
            // drop 所有元素
            for i in 0..self.len {
                unsafe {
                    ptr::drop_in_place(self.ptr.as_ptr().add(i));
                }
            }
            let layout = Layout::array::<T>(self.capacity).unwrap();
            unsafe {
                alloc::dealloc(self.ptr.as_ptr() as *mut u8, layout);
            }
        }
    }
}
```

### 13.5.3 安全抽象的原则

```rust
/// 安全抽象必须满足：
/// 1. Safe API 的参数类型都是合法的
/// 2. 函数的不变量由实现保证
/// 3. 所有 unsafe 块都有正确的前提条件

// 坏的安全抽象 — 暴露了未定义行为
mod bad_abstraction {
    pub fn transmute_i32_to_bool(x: i32) -> bool {
        // 非零 i32 不一定是合法的 bool！
        unsafe { std::mem::transmute(x) }
    }
}

// 好的安全抽象
mod good_abstraction {
    pub fn transmute_i32_to_bool(x: i32) -> bool {
        if x == 0 { false } else { true }
    }
}
```

> 💡 **提示**：安全抽象的黄金法则：**Safe 函数不应导致未定义行为，无论调用者如何调用**。你必须确保 unsafe 块中的所有前提条件都通过 safe API 得到满足。

---

## 13.6 内存安全保证

### 13.6.1 未定义行为（UB）列表

Rust 将以下行为视为**未定义行为**，即使出现在 unsafe 块中也是 UB：

| UB 类别 | 示例 |
|---------|------|
| 数据竞争 | 两个线程同时读写同一内存 |
| 解引用无效指针 | 空指针、悬空指针、未对齐指针 |
| 违反指针别名规则 | 对同一内存同时有 `&` 和 `&mut` |
| 读取未初始化内存 | `std::mem::uninitialized` |
| 无效的 bool 值 | 不是 0 或 1 的字节作为 bool |
| 无效的枚举判别式 | 枚举值不在合法范围内 |
| 越界指针运算 | pointer.add 超出对象边界 |
| 违反 Rust 类型布局 | 错误的 transmute |
| 释放后使用 | 引用已释放的内存 |
| 释放非配对的分配器 | Rust alloc 分配，C free 释放 |

### 13.6.2 常见 Unsafe 陷阱

```rust
// 陷阱1：悬空指针
fn dangling_pointer() -> &'static i32 {
    let x = 42;
    &x // x 离开作用域后无效
}

// 陷阱2：创建指向未初始化内存的引用
fn uninit_ref() {
    let uninit: *mut i32 = std::mem::align_of::<i32>() as *mut i32;
    // unsafe { &*uninit }; // UB — 未初始化
}

// 陷阱3：多个可变引用
fn multiple_mut() {
    let mut x = 42;
    let p1: *mut i32 = &mut x;
    let p2: *mut i32 = &mut x;
    unsafe {
        *p1 = 1;
        *p2 = 2; // UB — 违反了别名规则
    }
}

// 陷阱4：错误的对齐
#[repr(packed)]
struct Packed {
    x: u8,
    y: u32, // 可能未对齐
}
fn packed_ub() {
    let p = Packed { x: 0, y: 42 };
    // let _ = &p.y; // 可以（引用包装是安全的）
    // unsafe { *(std::ptr::addr_of!(p.y) as *const u32) };
    // UB：可能未对齐的 u32 读取
}
```

### 13.6.3 Miri — UB 检测工具

```bash
# Miri 是一个 Rust 的 MIR（中间表示）解释器
# 可以检测大多数 UB：

# 安装
rustup +nightly component add miri

# 运行检测
cargo +nightly miri run
cargo +nightly miri test
```

```rust
// Miri 能检测到的常见问题：
fn miri_catch_these() {
    // 1. 越界内存访问
    let v = vec![1, 2, 3];
    unsafe {
        let _ = *v.as_ptr().add(10); // Miri 报错
    }

    // 2. 未初始化内存读取
    let bytes: [u8; 4] = unsafe { std::mem::zeroed() };
    // Miri 能跟踪哪些字节已初始化

    // 3. 指针 provenance（来源混淆）
    let arr = [0u8; 10];
    let ptr = &arr[0] as *const u8;
    unsafe {
        let _ = *ptr.add(100); // 超出分配范围
    }
}
```

### 13.6.4 Unsafe 代码审查清单

| 检查项 | 说明 |
|--------|------|
| 指针有效性 | null？dangling？aligned？ |
| 生命周期 | 引用不会超过指向数据的生命周期 |
| 别名规则 | 没有同时存在 `&` 和 `&mut` |
| 初始化 | 内存已完全初始化（符合类型要求） |
| 类型布局 | `#[repr(C)]` 匹配，transmute 合法 |
| 数据竞争 | 原子操作/锁正确使用 |
| Drop 完整性 | 析构函数正确释放资源 |
| 分配器配对 | 分配/释放使用相同分配器 |
| FFI 边界 | 调用约定、类型大小、对齐一致 |
| Panic 安全 | unsafe 块不会导致 panic 后的 UB |

> 💡 **提示**：编写任何 unsafe 代码后，都应该用 Miri 运行测试。如果条件允许，使用 `loom` crate 测试并发场景下的内存模型。

---

## 13.7 实用 FFI 模式

### 13.7.1 错误处理

```rust
use std::ffi::{CStr, CString};
use std::os::raw::c_int;

// C 风格错误处理：返回错误码
extern "C" {
    fn c_library_init() -> c_int; // 返回 0 表示成功
}

fn safe_init() -> Result<(), String> {
    let ret = unsafe { c_library_init() };
    if ret == 0 {
        Ok(())
    } else {
        Err(format!("初始化失败，错误码: {}", ret))
    }
}

// 或者通过 errno
extern "C" {
    fn c_library_do_something() -> c_int;
    fn c_library_get_error() -> *const std::ffi::c_char;
}

fn do_something() -> Result<(), String> {
    let ret = unsafe { c_library_do_something() };
    if ret == 0 {
        Ok(())
    } else {
        let err_ptr = unsafe { c_library_get_error() };
        if err_ptr.is_null() {
            Err("未知错误".into())
        } else {
            let err_msg = unsafe { CStr::from_ptr(err_ptr) };
            Err(err_msg.to_str().unwrap_or("invalid utf-8").into())
        }
    }
}
```

### 13.7.2 资源管理

```rust
use std::marker::PhantomData;
use std::ops::Deref;

// RAII 包装 C 资源
extern "C" {
    fn db_connect(url: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn db_query(db: *mut std::ffi::c_void, query: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn db_free_result(result: *mut std::ffi::c_void);
    fn db_close(db: *mut std::ffi::c_void);
}

struct Database {
    inner: *mut std::ffi::c_void,
}

impl Database {
    fn connect(url: &str) -> Result<Self, String> {
        let c_url = CString::new(url).unwrap();
        let inner = unsafe { db_connect(c_url.as_ptr()) };
        if inner.is_null() {
            Err("连接失败".into())
        } else {
            Ok(Database { inner })
        }
    }

    fn query(&self, sql: &str) -> Result<QueryResult, String> {
        let c_sql = CString::new(sql).unwrap();
        let result = unsafe { db_query(self.inner, c_sql.as_ptr()) };
        if result.is_null() {
            Err("查询失败".into())
        } else {
            Ok(QueryResult { inner: result })
        }
    }
}

impl Drop for Database {
    fn drop(&mut self) {
        unsafe { db_close(self.inner); }
    }
}

struct QueryResult {
    inner: *mut std::ffi::c_void,
}

impl Drop for QueryResult {
    fn drop(&mut self) {
        unsafe { db_free_result(self.inner); }
    }
}
```

### 13.7.3 线程安全与 FFI

```rust
// C 库的句柄可能不是 Send/Sync
struct CHandle {
    ptr: *mut std::ffi::c_void,
}

// 如果 C 库的 API 是线程安全的
unsafe impl Send for CHandle {}
unsafe impl Sync for CHandle {}

// 如果 C 库不是线程安全的，用 Mutex 保护
use std::sync::Mutex;

struct SafeHandle {
    inner: Mutex<*mut std::ffi::c_void>,
}

impl SafeHandle {
    fn new(ptr: *mut std::ffi::c_void) -> Self {
        SafeHandle { inner: Mutex::new(ptr) }
    }

    fn with<F, R>(&self, f: F) -> R
    where
        F: FnOnce(*mut std::ffi::c_void) -> R,
    {
        let guard = self.inner.lock().unwrap();
        f(*guard)
    }
}
```

> 💡 **提示**：FFI 封装的核心模式：**私有字段（raw pointer）+ Safe API + Drop + 适当的 Send/Sync**。永远不要让 raw pointer 泄漏到 safe 代码中。

---

## 13.8 常见 FFI 工具对比

| Crate | 用途 | 说明 |
|-------|------|------|
| `bindgen` | 自动生成绑定 | 从 C/C++ 头文件生成 |
| `cbindgen` | Rust -> C 头文件 | 导出 Rust 函数给 C 用 |
| `cc` | 编译 C 代码 | build.rs 中编译 C 源文件 |
| `pkg-config` | 查找系统库 | 定位已安装的 C 库 |
| `libc` | C 类型定义 | 平台相关的 C 类型 |
| `windows-sys` | Windows API | Windows 系统调用 |

---

**本章总结：**

| 主题 | 关键要点 |
|------|----------|
| Unsafe 五大能力 | 解引用原始指针、调 unsafe 函数、变静态变量、实现 unsafe trait、访问 union 字段 |
| 原始指针 | `*const T`/`*mut T`，无保障，可 null，可忽略借用规则 |
| FFI | `extern "C"` 块，`#[repr(C)]` 结构体，`CString`/`CStr` |
| bindgen | 从 C 头文件自动生成绑定，build.rs 中集成 |
| 安全抽象 | Raw pointer + Safe API + Drop + Send/Sync |
| UB 检测 | Miri 是主要工具，审查清单确保安全 |
| 错误处理 | C 返回码/errno -> Rust `Result` 转换 |
