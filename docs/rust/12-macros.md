# 第12章 宏与元编程

> 本章面向已掌握 Rust 类型系统和泛型的开发者。你将学习声明宏（macro_rules!）和过程宏（派生宏、属性宏、函数式宏）的编写方法，理解 Rust 元编程的核心思想与生态工具。

---

## 12.1 声明宏（macro_rules!）

### 12.1.1 基础语法

`macro_rules!` 通过**模式匹配**将输入代码转换为输出代码（**结构化替换**而非文本替换）：

```rust
macro_rules! say_hello {
    // 匹配模式 => 展开代码
    () => {
        println!("Hello!");
    };
    ($name:expr) => {
        println!("Hello, {}!", $name);
    };
}

fn main() {
    say_hello!();
    say_hello!("Alice");
}
```

### 12.1.2 片段类型说明符

| 片段符 | 匹配项 | 示例 |
|--------|--------|------|
| `expr` | 表达式 | `1 + 2`, `foo()` |
| `stmt` | 语句 | `let x = 1;` |
| `pat` | 模式 | `Some(x)`, `_` |
| `ty` | 类型 | `Vec<i32>`, `&str` |
| `ident` | 标识符 | `foo`, `my_var` |
| `path` | 路径 | `std::collections::HashMap` |
| `literal` | 字面量 | `42`, `"hello"`, `true` |
| `tt` | Token树（最通用） | 任意 token 序列 |
| `item` | 项 | 函数、结构体、impl 等 |

### 12.1.3 重复匹配

```rust
// 使用 $(...),* $(...),+ $(...)? 模式
macro_rules! vec2 {
    ( $( $x:expr ),* ) => {
        {
            let mut temp_vec = Vec::new();
            $(
                temp_vec.push($x);
            )*
            temp_vec
        }
    };
}

let v = vec2!(1, 2, 3);
assert_eq!(v, vec![1, 2, 3]);

// 尾部分隔符支持
macro_rules! build_map {
    ( $( $key:expr => $val:expr ),* $(,)? ) => {{ "{{" }}
        let mut map = std::collections::HashMap::new();
        $(
            map.insert($key, $val);
        )*
        map
    }};
}

let m = build_map!("a" => 1, "b" => 2,);
assert_eq!(m["a"], 1);
```

### 12.1.4 模式匹配与重载

```rust
macro_rules! calculate {
    (eval $e:expr) => {
        println!("{} = {}", stringify!($e), $e);
    };

    // 递归模式
    (eval $e:expr, $(eval $rest:expr),+) => {
        calculate!(eval $e);
        calculate!($(eval $rest),+);
    };
}

fn main() {
    calculate!(eval 1 + 2);
    calculate!(eval 3 * 4, eval 5 + 6);
}
```

### 12.1.5 递归宏与深度限制

```rust
macro_rules! sum {
    // 基础情形
    ($x:expr) => ($x);
    // 递归情形
    ($x:expr, $($rest:expr),+) => ($x + sum!($($rest),+));
}

let total = sum!(1, 2, 3, 4, 5);
assert_eq!(total, 15);

// 默认递归深度 128，可通过 #![recursion_limit = "256"] 调整
```

### 12.1.6 常用声明宏示例

```rust
// 断言近似相等（用于浮点测试）
macro_rules! assert_approx_eq {
    ($a:expr, $b:expr) => {{ "{{" }}
        let a = $a;
        let b = $b;
        let epsilon = 1e-10;
        assert!(
            (a - b).abs() < epsilon,
            "assertion failed: `{a}` != `{b}` (diff: {})",
            (a - b).abs()
        );
    }};
}

// 创建枚举的便捷宏
macro_rules! simple_enum {
    ($(#[$meta:meta])* $vis:vis enum $name:ident {
        $($variant:ident $(= $val:expr)?,)*
    }) => {
        $(#[$meta])*
        $vis enum $name {
            $($variant $(= $val)?,)*
        }
    };
}

simple_enum! {
    #[derive(Debug, Clone, Copy)]
    pub enum Color {
        Red = 0,
        Green = 1,
        Blue = 2,
    }
}
```

> 💡 **提示**：`macro_rules!` 是基于**模式匹配**的卫生宏（Hygienic Macros）。注意变量名冲突问题 — 宏内部的变量不会污染调用者的作用域。

---

## 12.2 过程宏（Procedural Macros）

### 12.2.1 三种类型

```rust
// 1. 派生宏（Derive Macro）— 最常用
#[derive(Debug, Clone, MyDerive)]
struct Point { x: i32, y: i32 }

// 2. 属性宏（Attribute Macro）
#[route(GET, "/users")]
fn list_users() { /* ... */ }

// 3. 函数式宏（Function-like Macro）
sql!("SELECT * FROM users WHERE id = ?");
```

### 12.2.2 派生宏实现

过程宏需要在独立的 crate 中定义，以 `proc_macro` crate 类型：

```toml
# Cargo.toml
[lib]
proc-macro = true

[dependencies]
# 通常需要这两个库
proc-macro2 = "1"
quote = "1"
syn = { version = "2", features = ["full"] }
```

```rust
// my_macros/src/lib.rs
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

#[proc_macro_derive(HelloMacro)]
pub fn hello_macro_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;

    let expanded = quote! {
        impl HelloMacro for #name {
            fn hello_macro() {
                println!("Hello from {}!", stringify!(#name));
            }
        }
    };

    TokenStream::from(expanded)
}

pub trait HelloMacro {
    fn hello_macro();
}
```

### 12.2.3 属性宏实现

```rust
// my_macros/src/lib.rs
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, ItemFn};

#[proc_macro_attribute]
pub fn log_call(args: TokenStream, input: TokenStream) -> TokenStream {
    let _args = args; // 属性参数
    let func = parse_macro_input!(input as ItemFn);
    let func_name = &func.sig.ident;

    let expanded = quote! {
        fn #func_name() {
            println!("[LOG] 调用函数: {}", stringify!(#func_name));
            let _ = || #func_name(); // 保持原函数体
        }
    };

    // 注意：这里简化了，实际应提取原函数体
    TokenStream::from(expanded)
}
```

### 12.3.4 函数式宏实现

```rust
// my_macros/src/lib.rs
use proc_macro::TokenStream;
use quote::quote;

// 简化版 SQL 宏
#[proc_macro]
pub fn sql(input: TokenStream) -> TokenStream {
    let sql_str = input.to_string();
    // 简单验证 SQL 语法（实际项目不会这样做）
    assert!(!sql_str.is_empty(), "SQL cannot be empty");
    assert!(
        sql_str.to_uppercase().starts_with("SELECT"),
        "Only SELECT is supported"
    );

    let expanded = quote! {
        {
            println!("[SQL] {}", #sql_str);
            // 实际会返回 PreparedStatement 等
        }
    };

    TokenStream::from(expanded)
}
```

> 💡 **提示**：过程宏的核心工作流程：**输入 TokenStream → 解析为 AST（syn） → 转换 → 生成代码（quote） → 输出 TokenStream**。

---

## 12.3 syn 与 quote 生态

### 12.3.1 syn — 解析 TokenStream 为 AST

```rust
use syn::{
    parse_macro_input, DeriveInput, Data, Fields, Lit, Meta,
    Token, punctuated::Punctuated,
};
use quote::quote;

// 解析结构体字段
fn extract_fields(input: &DeriveInput) -> Vec<&syn::Field> {
    match &input.data {
        Data::Struct(data) => {
            match &data.fields {
                Fields::Named(fields) => {
                    fields.named.iter().collect()
                }
                Fields::Unnamed(fields) => {
                    fields.unnamed.iter().collect()
                }
                Fields::Unit => vec![],
            }
        }
        _ => vec![],
    }
}

// 解析属性参数
fn parse_meta_args(attrs: &[syn::Attribute]) -> Vec<String> {
    attrs
        .iter()
        .filter_map(|attr| {
            if attr.path().is_ident("my_attr") {
                attr.parse_args::<Lit>().ok().map(|lit| match lit {
                    Lit::Str(s) => s.value(),
                    _ => String::new(),
                })
            } else {
                None
            }
        })
        .collect()
}
```

### 12.3.2 quote — 生成 TokenStream

```rust
use quote::quote;

// 基本用法
let name = "world";
let tokens = quote! {
    println!("Hello, {}!", #name);
};

// 重复生成
let fields = vec!["x", "y", "z"];
let tokens = quote! {
    struct Point {
        #( #fields: f64, )*
    }
};
// 展开为：
// struct Point { x: f64, y: f64, z: f64, }

// 条件生成
let has_debug = true;
let tokens = quote! {
    #[derive(Clone #(, Debug)?)]
    struct MyType;
};
```

### 12.3.3 完整示例：自定义 Builder 派生宏

```rust
// 一个完整的 Builder 派生宏（简化版）
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput, Data, Fields};

#[proc_macro_derive(Builder)]
pub fn builder_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let builder_name = syn::Ident::new(&format!("{}Builder", name), name.span());

    let fields = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(fields) => &fields.named,
            _ => panic!("Builder only supports named fields"),
        },
        _ => panic!("Builder only supports structs"),
    };

    let field_names: Vec<_> = fields.iter().map(|f| &f.ident).collect();
    let field_types: Vec<_> = fields.iter().map(|f| &f.ty).collect();
    let field_option_types: Vec<_> = field_types
        .iter()
        .map(|ty| quote! { Option<#ty> })
        .collect();

    let builder_fields = field_names.iter().zip(field_option_types.iter()).map(|(name, ty)| {
        quote! { #name: #ty }
    });

    let builder_defaults = field_names.iter().map(|name| {
        quote! { #name: None }
    });

    let setter_methods = field_names.iter().map(|name| {
        quote! {
            pub fn #name(mut self, value: impl Into<#field_types>) -> Self {
                self.#name = Some(value.into());
                self
            }
        }
    });

    let build_assignments = field_names.iter().map(|name| {
        quote! {
            #name: self.#name
                .ok_or_else(|| format!("{} is missing", stringify!(#name)))?
        }
    });

    let expanded = quote! {
        impl #name {
            pub fn builder() -> #builder_name {
                #builder_name::default()
            }
        }

        struct #builder_name {
            #( #builder_fields, )*
        }

        impl Default for #builder_name {
            fn default() -> Self {
                #builder_name {
                    #( #builder_defaults, )*
                }
            }
        }

        impl #builder_name {
            #( #setter_methods )*

            pub fn build(self) -> Result<#name, String> {
                Ok(#name {
                    #( #build_assignments, )*
                })
            }
        }
    };

    TokenStream::from(expanded)
}
```

---

## 12.4 常用派生宏实现模式

### 12.4.1 字段迭代

```rust
// 生成访问所有字段的方法
#[proc_macro_derive(Fields)]
pub fn fields_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;

    let fields: Vec<_> = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(fields) => fields.named.iter().collect(),
            _ => panic!("Expected named fields"),
        },
        _ => panic!("Expected a struct"),
    };

    let field_names: Vec<_> = fields.iter().map(|f| f.ident.as_ref().unwrap()).collect();
    let field_types: Vec<_> = fields.iter().map(|f| &f.ty).collect();

    let to_vec_match_arms = field_names.iter().map(|name| {
        quote! {
            Self::#name => &self.#name
        }
    });

    let expanded = quote! {
        impl #name {
            pub fn field_names() -> &'static [&'static str] {
                &[ #( stringify!(#field_names) ),* ]
            }

            pub fn field_types() -> &'static [&'static str] {
                &[ #( stringify!(#field_types) ),* ]
            }
        }
    };

    TokenStream::from(expanded)
}
```

### 12.4.2 从元数据中提取命名

```rust
use syn::Meta;

fn extract_rename(attrs: &[syn::Attribute]) -> Option<String> {
    attrs.iter().find_map(|attr| {
        if !attr.path().is_ident("rename") {
            return None;
        }

        match &attr.meta {
            Meta::NameValue(nv) => {
                if let syn::Expr::Lit(lit) = &nv.value {
                    if let syn::Lit::Str(s) = &lit.lit {
                        return Some(s.value());
                    }
                }
                None
            }
            _ => None,
        }
    })
}
```

---

## 12.5 宏的调试与最佳实践

### 12.5.1 调试技巧

```rust
// 方法1：使用 log_syntax! 查看宏展开过程
// 需要在编译时开启
#![feature(log_syntax)]

macro_rules! debug_macro {
    ($($tokens:tt)*) => {
        log_syntax!("debug_macro invoked");
        $($tokens)*
    };
}

// 方法2：使用 `cargo expand` 查看展开结果
// 安装: cargo install cargo-expand
// 使用: cargo expand
// 会展开所有宏调用，展示生成的 Rust 代码

// 方法3：在 macro 中嵌入编译错误
macro_rules! assert_type {
    ($x:expr, $ty:ty) => {
        {
            let _: $ty = $x;
        }
    };
}
```

### 12.5.2 宏中的编译错误

```rust
use proc_macro::TokenStream;
use syn::{parse_macro_input, DeriveInput, Error};

#[proc_macro_derive(MyTrait)]
pub fn my_trait_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    // 验证只应用于枚举
    if matches!(input.data, syn::Data::Struct(_)) {
        return Error::new(
            input.ident.span(),
            "MyTrait can only be derived for enums",
        )
        .to_compile_error()
        .into();
    }

    // 正常展开...
    TokenStream::new()
}
```

### 12.5.3 卫生性（Hygiene）注意事项

```rust
macro_rules! hygiene_demo {
    ($val:expr) => {
        let x = $val; // 宏内部的 x
        println!("内部 x = {x}");
    };
}

fn main() {
    let x = 100;
    hygiene_demo!(42); // 内部 x = 42
    println!("外部 x = {x}"); // 外部 x = 100 — 不受影响
}

// 但是 token 标识符可能冲突
macro_rules! use_temp_var {
    () => {
        let temp = 1; // 可能和外部冲突
        // 用 __temp 或生成唯一 ID
    };
}
```

### 12.5.4 宏设计指南

| 原则 | 说明 |
|------|------|
| **匹配模式清晰** | 避免过于复杂的模式匹配 |
| **错误信息友好** | 在宏中提供有意义的编译错误 |
| **文档完善** | 写清楚宏的调用语法和效果 |
| **导出必要项** | 如果宏依赖辅助类型/函数，一并导出 |
| **最小惊奇原则** | 语法尽量符合 Rust 习惯 |
| **避免过度抽象** | 能写函数就别写宏 |

> 💡 **提示**：宏是元编程的**最后手段**。优先用泛型、trait 和函数解决问题。只有在需要语法扩展时才用宏。

---

## 12.6 高级模式与生态

### 12.6.1 混合宏与函数

```rust
// 宏作为函数调用的语法糖
macro_rules! json_parse {
    ($json:expr) => {
        serde_json::from_str::<serde_json::Value>($json)
    };
}

// 宏生成带额外检查的调用
macro_rules! checked {
    ($e:expr) => {{ "{{" }}
        let result = $e;
        assert!(!result.is_empty(), "result was empty");
        result
    }};
}
```

### 12.6.2 生态 Crates

| Crate | 用途 | 说明 |
|-------|------|------|
| `syn` | 解析 TokenStream | 过程宏的解析基础 |
| `quote` | 生成 TokenStream | 用模板生成代码 |
| `proc-macro2` | 跨编译器的 TokenStream | syn/quote 的基础 |
| `proc_macro_error` | 友好错误信息 | 改进过程宏错误报告 |
| `darling` | 属性解析 | 简化属性宏参数提取 |
| `manyhow` | 错误处理 | 简化过程宏错误处理 |
| `macro_rules_attribute` | 混合宏 | 用声明宏包装属性宏 |

### 12.6.3 darling 简化属性解析

```rust
// 使用 darling crate 简化属性宏的参数解析
use darling::{FromDeriveInput, FromField};
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

#[derive(FromDeriveInput, Default)]
#[darling(default, attributes(my_attr))]
struct MyOpts {
    name: Option<String>,
    debug: bool,
    #[darling(default)]
    skip: bool,
}

#[proc_macro_derive(MyMacro, attributes(my_attr))]
pub fn my_macro_derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let opts = MyOpts::from_derive_input(&input).unwrap();

    let name = if let Some(name) = opts.name {
        quote! { #name }
    } else {
        let ident = &input.ident;
        quote! { stringify!(#ident) }
    };

    let expanded = quote! {
        impl #input.ident {
            pub fn get_name() -> &'static str {
                #name
            }
        }
    };

    TokenStream::from(expanded)
}
```

### 12.6.4 宏中的条件编译

```rust
macro_rules! platform_fn {
    ($name:ident, $body:expr) => {
        #[cfg(not(target_arch = "wasm32"))]
        fn $name() {
            $body
        }

        #[cfg(target_arch = "wasm32")]
        fn $name() {
            // wasm 上的替代实现
            println!("wasm stub: {}", stringify!($name));
        }
    };
}

platform_fn!(native_only, {
    println!("Running natively");
});
```

---

## 12.7 宏性能考量

| 宏类型 | 编译时间影响 | 运行时性能 |
|--------|-------------|-----------|
| `macro_rules!` | 中等 | 零开销（展开后是普通代码） |
| 派生宏 | 较大（需编译过程宏 crate） | 零开销 |
| 属性宏 | 较大 | 零开销 |
| 函数式宏 | 较大 | 零开销 |

> 💡 **提示**：所有宏在编译后都消失，**运行时没有性能开销**。但过程宏需要在编译期做较多工作（解析 & 生成代码），会显著增加编译时间。大型宏库（如 `serde`、`diesel`）是编译时间的主要来源之一。

---

**本章总结：**

| 主题 | 关键要点 |
|------|----------|
| 声明宏 | macro_rules! 模式匹配，片段类型符，重复 |
| 过程宏 | 派生/属性/函数式三种，独立 crate |
| syn/quote | 解析 TokenStream 和生成代码的工具 |
| 调试 | cargo expand, log_syntax, 错误传播 |
| 最佳实践 | 优先函数/泛型，宏是最后手段 |
| darling | 简化属性宏参数解析 |
| 性能 | 编译期有开销，运行时零成本 |
