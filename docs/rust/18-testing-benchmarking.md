# 第18章：测试与基准测试

> 目标读者：掌握 Rust 基础语法、模块化编程的开发者

---

## 18.1 概述

Rust 内置了一流的测试支持，从单元测试到集成测试，从文档测试到基准测试，形成了完整的质量保障体系。

| 测试类型 | 用途 | 工具/框架 |
|----------|------|-----------|
| 单元测试 | 测试单个函数/模块 | 内置 `#[cfg(test)]` + `#[test]` |
| 集成测试 | 测试库的公开 API | `tests/` 目录 |
| 文档测试 | 确保文档示例正确 | `/// \`\`\`rust` 代码块 |
| Mock 测试 | 模拟外部依赖 | `mockall`, `mockito` |
| 属性测试 | 随机输入验证属性 | `proptest` |
| 基准测试 | 性能测量 | `criterion` 或内置 bencher |
| 模糊测试 | 自动发现崩溃输入 | `cargo-fuzz` |

---

## 18.2 单元测试与集成测试

### 18.2.1 单元测试

单元测试与源代码放在一起，使用 `#[cfg(test)]` 条件编译：

```rust
// src/lib.rs

/// 计算斐波那契数列
pub fn fibonacci(n: u32) -> u64 {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}

/// 带缓存的斐波那契计算
pub struct FibonacciCache {
    cache: Vec<u64>,
}

impl FibonacciCache {
    pub fn new() -> Self {
        Self { cache: vec![0, 1] }
    }

    pub fn get(&mut self, n: u32) -> u64 {
        let n = n as usize;
        while self.cache.len() <= n {
            let next = self.cache[self.cache.len() - 1]
                + self.cache[self.cache.len() - 2];
            self.cache.push(next);
        }
        self.cache[n]
    }
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fibonacci_base_cases() {
        assert_eq!(fibonacci(0), 0);
        assert_eq!(fibonacci(1), 1);
    }

    #[test]
    fn test_fibonacci_small_values() {
        assert_eq!(fibonacci(2), 1);
        assert_eq!(fibonacci(3), 2);
        assert_eq!(fibonacci(4), 3);
        assert_eq!(fibonacci(6), 8);
    }

    #[test]
    fn test_fibonacci_cache() {
        let mut fib = FibonacciCache::new();
        assert_eq!(fib.get(0), 0);
        assert_eq!(fib.get(1), 1);
        assert_eq!(fib.get(10), 55);
        assert_eq!(fib.get(20), 6765);
    }

    #[test]
    fn test_cache_performance() {
        let mut fib = FibonacciCache::new();
        let result = fib.get(90);
        // 检查结果非零且值合理
        assert!(result > 0);
        assert_eq!(result, 2880067194370816120);
    }
}
```

### 18.2.2 常用的断言宏

```rust
#[cfg(test)]
mod assertion_examples {
    #[test]
    fn basic_assertions() {
        // 基本断言
        assert!(true);
        assert!(1 + 1 == 2, "数学错误: 1+1 不等于 {}", 2);

        // 相等性断言
        assert_eq!(42, 42);
        assert_ne!(42, 43);

        // 浮点数比较（注意精度）
        assert!((0.1 + 0.2 - 0.3).abs() < f64::EPSILON);

        // 集合断言
        let v = vec![1, 2, 3];
        assert!(v.contains(&2), "集合应包含元素 2");
        assert_eq!(v.len(), 3);
    }

    #[test]
    fn string_assertions() {
        let msg = "Hello, Rust!";
        assert!(msg.starts_with("Hello"));
        assert!(msg.contains("Rust"));
        assert!(!msg.is_empty());
    }

    #[test]
    #[should_panic(expected = "除零错误")]
    fn test_panic() {
        divide(10, 0);
    }

    #[test]
    fn test_result() -> Result<(), String> {
        if 2 + 2 == 4 {
            Ok(())
        } else {
            Err("数学不一致".to_string())
        }
    }
}

fn divide(a: i32, b: i32) -> i32 {
    if b == 0 {
        panic!("除零错误");
    }
    a / b
}
```

| 宏 | 用途 | 失败时输出 |
|----|------|-----------|
| `assert!(expr)` | 布尔断言 | 仅显示表达式 |
| `assert_eq!(a, b)` | 相等断言 | 显示 `left: a, right: b` |
| `assert_ne!(a, b)` | 不等断言 | 显示两个值 |
| `assert!(expr, "msg {}", arg)` | 自定义错误消息 | 格式化消息 |
| `#[should_panic]` | 验证 panic | 匹配 panic 消息 |

### 18.2.3 集成测试

集成测试放在项目根目录的 `tests/` 目录下，每个文件是一个独立的 crate：

```
my_project/
├── Cargo.toml
├── src/
│   └── lib.rs
└── tests/
    ├── integration_test.rs
    └── api_test.rs
```

```rust
// tests/integration_test.rs
// 集成测试文件作为一个独立的 crate

// 导入被测试库
use my_project::fibonacci;

#[test]
fn test_fibonacci_integration() {
    // 测试公开 API
    assert_eq!(fibonacci(0), 0);
    assert_eq!(fibonacci(1), 1);
    assert_eq!(fibonacci(10), 55);
}

#[test]
fn test_fibonacci_large_values() {
    // 使用缓存版本
    let mut fib = my_project::FibonacciCache::new();
    assert_eq!(fib.get(50), 12586269025);
}
```

```rust
// tests/api_test.rs
mod common; // 共享模块

#[test]
fn test_api_health() {
    // 使用 common 中的辅助函数
}
```

```rust
// tests/common/mod.rs
// 共享的测试辅助函数（不会被当作独立测试文件执行）
pub fn setup_test_db() -> String {
    "test_db_connection".to_string()
}

pub fn teardown_test_db(conn: &str) {
    // 清理
}
```

> **💡 提示**：`tests/` 目录下的子目录中的 `.rs` 文件不会被当作独立的集成测试；它们被视为模块。只有 `tests/` 根目录下的 `.rs` 文件才是集成测试入口。

---

## 18.3 文档测试

Rust 允许在文档注释中嵌入代码示例，`cargo test` 会自动编译和运行它们：

```rust
/// 计算两个数的最大公约数 (GCD)
///
/// # 示例
///
/// ```
/// use my_project::gcd;
///
/// assert_eq!(gcd(12, 8), 4);
/// assert_eq!(gcd(17, 5), 1);
/// assert_eq!(gcd(0, 5), 5);
/// ```
///
/// # 错误处理
///
/// ```rust,should_panic
/// // 这个示例会 panic
/// my_project::gcd(1, 0);
/// ```
///
/// # 忽略编译的示例
///
/// ```rust,ignore
/// // 这里展示伪代码
/// let result = gcd(very_large_number, another_number);
/// ```
pub fn gcd(a: u64, b: u64) -> u64 {
    if b == 0 {
        a
    } else {
        gcd(b, a % b)
    }
}
```

**文档测试标记：**

| 标记 | 含义 |
|------|------|
| `\`\`\`rust` | 默认：编译并运行，预期成功 |
| `\`\`\`rust,ignore` | 不编译该示例 |
| `\`\`\`rust,should_panic` | 编译并运行，预期 panic |
| `\`\`\`rust,no_run` | 编译但不运行（用于无法终止的示例） |
| `\`\`\`rust,edition2018` | 指定 Rust 版本 |
| `\`\`\`rust,compile_fail` | 预期编译失败 |

```bash
# 只运行文档测试
cargo test --doc

# 运行所有测试
cargo test
```

> **💡 提示**：文档测试是确保 API 文档正确性的最佳方式。每当修改了代码，`cargo test` 会自动验证所有文档示例是否仍然可用。务必为公开 API 添加文档测试。

---

## 18.4 测试组织与约定

### 18.4.1 测试模块组织

```rust
// src/calculator.rs
pub fn add(a: i32, b: i32) -> i32 { a + b }
pub fn subtract(a: i32, b: i32) -> i32 { a - b }
pub fn multiply(a: i32, b: i32) -> i32 { a * b }
pub fn divide(a: i32, b: i32) -> Option<i32> {
    if b == 0 { None } else { Some(a / b) }
}

#[cfg(test)]
mod tests {
    use super::*;

    mod test_add {
        use super::*;

        #[test]
        fn positive_numbers() {
            assert_eq!(add(2, 3), 5);
        }

        #[test]
        fn negative_numbers() {
            assert_eq!(add(-2, -3), -5);
        }

        #[test]
        fn mixed_sign() {
            assert_eq!(add(-2, 3), 1);
        }
    }

    mod test_divide {
        use super::*;

        #[test]
        fn normal_division() {
            assert_eq!(divide(10, 2), Some(5));
        }

        #[test]
        fn division_by_zero() {
            assert_eq!(divide(10, 0), None);
        }
    }
}
```

### 18.4.2 测试标签（Test Attributes）

```rust
#[cfg(test)]
mod test_attributes {
    #[test]
    fn normal_test() {
        assert!(true);
    }

    #[test]
    #[ignore = "需要外部数据库，未配置 CI 环境"]
    fn expensive_test() {
        // 需要连接数据库
    }

    #[test]
    // 仅在 release 模式下运行
    #[cfg(not(debug_assertions))]
    fn release_only_test() {
        // 性能敏感测试
    }

    #[test]
    // 仅在特定平台运行
    #[cfg(target_os = "linux")]
    fn linux_specific_test() {
        // Linux 特有的测试
    }
}
```

```bash
# 运行所有测试（包括被忽略的）
cargo test -- --ignored

# 仅运行被忽略的测试
cargo test -- --include-ignored

# 运行名称匹配的测试
cargo test test_fibonacci

# 运行模块下的所有测试
cargo test tests::

# 使用过滤器
cargo test -- --test-threads=1     # 单线程运行
cargo test -- --nocapture          # 显示 println! 输出
cargo test -- --show-output        # 显示所有输出
```

### 18.4.3 测试夹具（Test Fixtures）

```rust
use std::sync::Once;

static INIT: Once = Once::new();

/// 全局初始化（所有测试运行前执行一次）
fn global_setup() {
    INIT.call_once(|| {
        println!("全局初始化：创建测试数据库、加载配置等");
    });
}

/// 测试用临时目录
struct TempDir {
    path: std::path::PathBuf,
}

impl TempDir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(name);
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod fixture_tests {
    use super::*;

    #[test]
    fn test_with_fixture() {
        global_setup();

        let tmp = TempDir::new("test_output");
        let file_path = tmp.path().join("result.txt");

        std::fs::write(&file_path, "test data").unwrap();
        assert!(file_path.exists());

        // TempDir 在作用域结束时自动清理
    }
}
```

---

## 18.5 Mock 与测试替身

### 18.5.1 mockall 库

```toml
[dev-dependencies]
mockall = "0.13"
```

```rust
// 要 mock 的 trait
use mockall::automock;

#[automock]
pub trait Database {
    fn query_user(&self, id: u64) -> Result<User, DbError>;
    fn save_user(&self, user: &User) -> Result<(), DbError>;
    fn is_connected(&self) -> bool;
}

#[derive(Debug, Clone, PartialEq)]
pub struct User {
    pub id: u64,
    pub name: String,
    pub email: String,
}

#[derive(Debug)]
pub enum DbError {
    NotFound,
    ConnectionError,
    Duplicate,
}

// 业务逻辑层
pub struct UserService<T: Database> {
    db: T,
}

impl<T: Database> UserService<T> {
    pub fn new(db: T) -> Self {
        Self { db }
    }

    pub fn get_user_name(&self, id: u64) -> Result<String, String> {
        match self.db.query_user(id) {
            Ok(user) => Ok(user.name),
            Err(DbError::NotFound) => Err("用户不存在".to_string()),
            Err(_) => Err("数据库错误".to_string()),
        }
    }

    pub fn register_user(&self, name: &str, email: &str) -> Result<User, String> {
        let user = User {
            id: 0,
            name: name.to_string(),
            email: email.to_string(),
        };

        self.db.save_user(&user).map(|_| user).map_err(|e| match e {
            DbError::Duplicate => "用户已存在".to_string(),
            _ => "保存失败".to_string(),
        })
    }
}

#[cfg(test)]
mod user_service_tests {
    use super::*;

    #[test]
    fn test_get_existing_user() {
        let mut mock_db = MockDatabase::new();

        // 设置期望：query_user(42) 返回 Ok(User{...})
        mock_db.expect_query_user()
            .with(predicate::eq(42))
            .times(1)
            .returning(|id| Ok(User {
                id,
                name: "Alice".to_string(),
                email: "alice@example.com".to_string(),
            }));

        let service = UserService::new(mock_db);
        let name = service.get_user_name(42).unwrap();
        assert_eq!(name, "Alice");
    }

    #[test]
    fn test_get_nonexistent_user() {
        let mut mock_db = MockDatabase::new();

        mock_db.expect_query_user()
            .with(predicate::eq(99))
            .times(1)
            .returning(|_| Err(DbError::NotFound));

        let service = UserService::new(mock_db);
        let result = service.get_user_name(99);
        assert_eq!(result, Err("用户不存在".to_string()));
    }

    #[test]
    fn test_register_user_duplicate() {
        let mut mock_db = MockDatabase::new();

        mock_db.expect_save_user()
            .times(1)
            .returning(|_| Err(DbError::Duplicate));

        let service = UserService::new(mock_db);
        let result = service.register_user("Bob", "bob@test.com");
        assert_eq!(result, Err("用户已存在".to_string()));
    }

    #[test]
    fn test_verify_call_order() {
        let mut mock_db = MockDatabase::new();

        // 验证调用顺序
        let mut seq = mockall::Sequence::new();

        mock_db.expect_query_user()
            .times(1)
            .in_sequence(&mut seq)
            .returning(|_| Ok(User {
                id: 1, name: "A".into(), email: "a@a.com".into(),
            }));

        mock_db.expect_query_user()
            .times(1)
            .in_sequence(&mut seq)
            .returning(|_| Ok(User {
                id: 2, name: "B".into(), email: "b@b.com".into(),
            }));

        let service = UserService::new(mock_db);
        let _ = service.get_user_name(1);
        let _ = service.get_user_name(2);
    }
}
```

### 18.5.2 mockito HTTP Mock

```toml
[dev-dependencies]
mockito = "1"
```

```rust
use mockito::Server;

#[cfg(test)]
mod http_client_tests {
    use super::*;
    use mockito::Server;

    struct HttpClient {
        base_url: String,
    }

    impl HttpClient {
        fn fetch_user(&self, id: u64) -> Result<String, String> {
            let url = format!("{}/api/users/{}", self.base_url, id);
            let response = reqwest::blocking::get(&url)
                .map_err(|e| format!("请求失败: {}", e))?;

            if response.status().is_success() {
                response.text().map_err(|e| format!("读取响应失败: {}", e))
            } else {
                Err(format!("HTTP {}", response.status()))
            }
        }
    }

    #[test]
    fn test_fetch_user_success() {
        let mut server = Server::new();

        // 设置 mock 端点
        let mock = server.mock("GET", "/api/users/42")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":42,"name":"Alice"}"#)
            .create();

        let client = HttpClient {
            base_url: server.url(),
        };

        let result = client.fetch_user(42).unwrap();
        assert!(result.contains("Alice"));

        // 验证 mock 被调用
        mock.assert();
    }

    #[test]
    fn test_fetch_user_not_found() {
        let mut server = Server::new();

        let mock = server.mock("GET", "/api/users/999")
            .with_status(404)
            .create();

        let client = HttpClient {
            base_url: server.url(),
        };

        let result = client.fetch_user(999);
        assert_eq!(result, Err("HTTP 404".to_string()));

        mock.assert();
    }
}
```

### 18.5.3 测试替身类型

| 类型 | 说明 | Rust 实现 |
|------|------|-----------|
| **Dummy** | 只传递，不实际使用 | `()` 或 `Default::default()` |
| **Fake** | 简化但可工作的实现 | 内存数据库替代真实数据库 |
| **Stub** | 返回固定值的实现 | Mock 对象的 `returning` |
| **Spy** | 记录调用信息的 Stub | `mockall` 的 `times().returning()` |
| **Mock** | 预设期望和行为的替身 | `mockall::automock` |

---

## 18.6 属性测试（proptest）

属性测试通过**随机生成大量输入**来验证代码属性，比手写测试用例覆盖更多边界情况。

### 18.6.1 基础使用

```toml
[dev-dependencies]
proptest = "1"
```

```rust
use proptest::prelude::*;

// 测试属性：反转反转等于原值
proptest! {
    #[test]
    fn reverse_reverse_is_identity(s: String) {
        let reversed: String = s.chars().rev().collect();
        let double_reversed: String = reversed.chars().rev().collect();
        prop_assert_eq!(s, double_reversed);
    }
}

// 测试排序算法
proptest! {
    #[test]
    fn sort_always_sorted(mut vec in proptest::collection::vec(0i32..1000, 0..100)) {
        vec.sort();
        // 验证排序后的数组是递增的
        for i in 0..vec.len().saturating_sub(1) {
            prop_assert!(vec[i] <= vec[i + 1], "排序失败: {:?}", vec);
        }
    }
}

// 自定义策略
fn valid_age() -> impl Strategy<Value = u8> {
    0u8..150u8
}

fn person_name() -> impl Strategy<Value = String> {
    "[a-zA-Z]{1,30}".prop_map(|s| s.to_string())
}

proptest! {
    #[test]
    fn age_should_not_cause_overflow(
        name in person_name(),
        age in valid_age(),
    ) {
        let person = Person { name, age };
        prop_assert!(person.age <= 150);

        // 如果年龄小于 18，不能是管理员
        if person.age < 18 {
            prop_assert!(!person.is_admin);
        }
    }
}

#[derive(Debug)]
struct Person {
    name: String,
    age: u8,
    is_admin: bool,
}
```

### 18.6.2 高级属性测试

```rust
use proptest::prelude::*;
use proptest::collection;

// 测试 Vec 相关属性
proptest! {
    // 测试 Vec 的 push 和 pop 属性
    #[test]
    fn vec_push_pop_behavior(
        mut initial in collection::vec(0i32..100, 0..50),
        push_val in 0i32..100,
    ) {
        let len_before = initial.len();
        initial.push(push_val);
        prop_assert_eq!(initial.len(), len_before + 1);

        let popped = initial.pop();
        prop_assert_eq!(popped, Some(push_val));
        prop_assert_eq!(initial.len(), len_before);
    }

    // 测试 HashMap 的 insert/get/remove
    #[test]
    fn hashmap_insert_remove(
        pairs in collection::hash_map("[a-z]{1,5}", 0i32..1000, 0..20),
    ) {
        use std::collections::HashMap;
        let mut map = HashMap::new();

        for (k, v) in &pairs {
            map.insert(k.clone(), *v);
        }

        prop_assert_eq!(map.len(), pairs.len());

        for (k, v) in &pairs {
            prop_assert_eq!(map.get(k), Some(v));
        }

        for (k, _) in &pairs {
            map.remove(k);
        }

        prop_assert!(map.is_empty());
    }
}

// 过滤不合法输入
proptest! {
    #[test]
    fn division_never_panics(
        a in -1000i32..1000,
        b in -1000i32..1000,
    ) {
        prop_assume!(b != 0); // 排除除零
        let result = a / b;
        // 验证除法属性
        prop_assert!((result * b - a).abs() < b.abs());
    }
}
```

### 18.6.3 测试配置

```rust
use proptest::prelude::*;
use proptest::test_runner::Config;

// 自定义测试配置
proptest! {
    #![proptest_config(Config {
        cases: 1000,             // 默认 256，增加测试轮数
        max_shrink_iters: 50000, // 最大化收缩尝试
        .. Config::default()
    })]

    #[test]
    fn thorough_test(v in 0u32..1000000) {
        // 更详尽的测试
        prop_assert!(v <= 1000000);
    }
}
```

| 特性 | 单元测试 | 属性测试 |
|------|---------|---------|
| 输入 | 人工指定 | 随机生成 |
| 覆盖度 | 依赖程序员脑补 | 自动探索边界 |
| 维护成本 | 低 | 中（需定义策略） |
| 发现缺陷 | 常见路径 | 边界/极端情况 |
| 可复现性 | 总是相同 | 可设置种子复现 |

---

## 18.7 基准测试（Criterion）

### 18.7.1 Criterion 基准测试

```toml
[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "sort_bench"
harness = false
```

```rust
// benches/sort_bench.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};

// 基准排序算法
fn sort_benchmark(c: &mut Criterion) {
    let mut group = c.benchmark_group("排序算法");

    for size in [100, 1000, 10000, 100000].iter() {
        // 准备数据
        let mut data: Vec<i32> = (0..*size).map(|_| rand::random()).collect();

        group.bench_with_input(
            BenchmarkId::new("标准库 sort", size),
            &data,
            |b, data| {
                b.iter(|| {
                    let mut v = data.clone();
                    v.sort();
                    black_box(v);
                });
            },
        );

        group.bench_with_input(
            BenchmarkId::new("冒泡排序", size),
            &data,
            |b, data| {
                b.iter(|| {
                    let mut v = data.clone();
                    bubble_sort(&mut v);
                    black_box(v);
                });
            },
        );
    }

    group.finish();
}

fn bubble_sort(arr: &mut [i32]) {
    let n = arr.len();
    for i in 0..n {
        for j in 0..n - 1 - i {
            if arr[j] > arr[j + 1] {
                arr.swap(j, j + 1);
            }
        }
    }
}

criterion_group!(benches, sort_benchmark);
criterion_main!(benches);
```

```bash
# 运行基准测试
cargo bench

# 比较两次基准测试结果
cargo bench -- --save-baseline base
# ... 改代码后 ...
cargo bench -- --baseline base
```

### 18.7.2 基准测试最佳实践

```rust
use criterion::{black_box, Criterion, BatchSize};

fn benchmark_best_practices(c: &mut Criterion) {
    // 1. 使用 black_box 防止编译器优化掉测试代码
    c.bench_function("black_box_example", |b| {
        b.iter(|| {
            let x = 42;
            let y = black_box(x);
            y * 2
        });
    });

    // 2. 使用 BatchSize 控制 setup 开销
    c.bench_function("with_setup", |b| {
        b.iter_batched(
            || {
                // setup：每次迭代前执行
                vec![0u8; 1024]
            },
            |mut data| {
                // benchmark：被测量的部分
                data.fill(42);
                black_box(data);
            },
            BatchSize::SmallInput,
        );
    });

    // 3. 比较不同实现
    let mut group = c.benchmark_group("比较实现");
    group.measurement_time(std::time::Duration::from_secs(10));

    group.bench_function("方法A", |b| b.iter(|| method_a(black_box(100))));
    group.bench_function("方法B", |b| b.iter(|| method_b(black_box(100))));

    group.finish();
}

fn method_a(n: u32) -> u64 {
    let mut sum = 0;
    for i in 1..=n {
        sum += i as u64;
    }
    sum
}

fn method_b(n: u32) -> u64 {
    (n as u64) * (n as u64 + 1) / 2
}
```

### 18.7.3 生成火焰图

```toml
[profile.release]
debug = 1  # 保留符号信息用于分析
```

```bash
# 安装火焰图生成工具
cargo install flamegraph

# 生成火焰图
cargo flamegraph --bin my_app

# 针对特定测试生成火焰图
cargo flamegraph --bench my_bench -- --bench
```

> **💡 提示**：Criterion 会自动生成 HTML 报告（`target/criterion/report/index.html`），并通过对比基线帮助你发现性能回归。建议将基线提交到 Git，每次变更后对比。

---

## 18.8 覆盖率与 CI 集成

### 18.8.1 代码覆盖率

```bash
# 安装 tarpaulin（Linux/macOS）
cargo install cargo-tarpaulin

# 运行覆盖率测试
cargo tarpaulin --out Html

# 指定目标覆盖率
cargo tarpaulin --out Html --ignore-tests --output-dir coverage
```

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  CARGO_TERM_COLOR: always

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: 安装 Rust 工具链
        uses: actions-rust-lang/setup-rust-toolchain@v1
        with:
          components: clippy, rustfmt

      - name: 代码格式化检查
        run: cargo fmt --check

      - name: Clippy 静态分析
        run: cargo clippy -- -D warnings

      - name: 运行测试
        run: cargo test --all-features

      - name: 文档测试
        run: cargo test --doc

  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: 安装 Rust
        uses: actions-rust-lang/setup-rust-toolchain@v1

      - name: 安装 tarpaulin
        run: cargo install cargo-tarpaulin

      - name: 生成覆盖率报告
        run: cargo tarpaulin --out Xml

      - name: 上传覆盖率
        uses: codecov/codecov-action@v3
        with:
          token: ${{ "{{" }} secrets.CODECOV_TOKEN }}
          files: ./cobertura.xml

  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: 安装 Rust
        uses: actions-rust-lang/setup-rust-toolchain@v1

      - name: 运行基准测试
        run: cargo bench
```

### 18.8.2 CI 质量门禁

```yaml
# 自定义质量门禁脚本
name: Quality Gate

on: [pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions-rust-lang/setup-rust-toolchain@v1

      - name: 编译检查（所有特性）
        run: cargo check --all-features --all-targets

      - name: 测试
        run: cargo test --all-features

      - name: 无警告编译
        run: cargo build --all-features 2>&1 | tee build.log
        # 如果包含 "warning" 则失败
        - run: "! grep -i warning build.log"

      - name: 最小依赖检查
        run: cargo tree --edges normal --no-default-features
```

---

## 18.9 测试策略与哲学

### 18.9.1 测试金字塔

```
        /\
       /  \          E2E 测试（少量）
      /    \
     / 集成 \        集成测试（适量）
    / 测试   \
   /__________\
  /  单元测试  \    单元测试（大量）
 /______________\
```

| 层级 | 速度 | 维护成本 | 定位问题的精确度 |
|------|------|---------|----------------|
| 单元测试 | 毫秒级 | 低 | 精确到函数 |
| 集成测试 | 秒级 | 中 | 精确到模块间 |
| E2E 测试 | 分钟级 | 高 | 系统整体行为 |

### 18.9.2 Rust 测试最佳实践

1. **每个公开函数至少一个单元测试**，覆盖正常路径和错误路径
2. **为每个模块创建对应的 `tests` 子模块**
3. **集成测试只测试公开 API 的行为**，而非内部实现细节
4. **使用属性测试覆盖边界情况**，补充手写用例的不足
5. **文档测试确保 API 示例始终可用**
6. **基准测试关注核心路径和热点函数**，每次重构后对比
7. **CI 中强制执行代码质量门禁**：测试通过 + Clippy 无警告 + 格式化检查

```rust
// 测试驱动开发 (TDD) 示例

// 1. 先写测试
#[cfg(test)]
mod tdd_example {
    use super::*;

    #[test]
    fn test_is_palindrome() {
        assert!(is_palindrome("racecar"));
        assert!(is_palindrome("a"));
        assert!(is_palindrome(""));
        assert!(!is_palindrome("hello"));
        assert!(is_palindrome("A man a plan a canal Panama"));
    }
}

// 2. 再实现
pub fn is_palindrome(s: &str) -> bool {
    let cleaned: String = s
        .chars()
        .filter(|c| c.is_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();

    cleaned == cleaned.chars().rev().collect::<String>()
}
```

---

## 18.10 本章小结

| 主题 | 核心要点 |
|------|----------|
| **单元测试** | `#[cfg(test)]` + `#[test]`，与源码同文件 |
| **集成测试** | `tests/` 目录，独立的 crate |
| **文档测试** | 文档中的代码示例，`cargo test` 自动验证 |
| **断言宏** | `assert!` / `assert_eq!` / `assert_ne!` / `#[should_panic]` |
| **Mock 测试** | `mockall` 模拟 trait，`mockito` 模拟 HTTP |
| **属性测试** | `proptest` 随机生成大量输入 |
| **基准测试** | `criterion` 精确测量性能，支持基线对比 |
| **覆盖率** | `tarpaulin` 生成 HTML 报告 |
| **CI 集成** | GitHub Actions，质量门禁，自动化测试 |
| **测试策略** | 金字塔模型，TDD，属性测试补充边界 |

> **💡 下一步**：掌握测试与基准测试后，接下来学习第19章——部署与最佳实践，了解如何将 Rust 项目打包、部署到生产环境，并遵循最佳编码规范。
