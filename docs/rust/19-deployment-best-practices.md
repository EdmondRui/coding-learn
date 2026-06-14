# 第19章：部署与最佳实践

> 目标读者：掌握 Rust 核心概念，有实际项目开发经验的开发者

---

## 19.1 概述

将 Rust 应用部署到生产环境涉及编译优化、容器化、日志监控等多个环节。本章涵盖从交叉编译到生产监控的完整流程，以及 Rust 项目的编码规范和架构最佳实践。

| 阶段 | 关注点 | 工具/技术 |
|------|--------|-----------|
| 构建 | 编译优化、二进制瘦身 | LTO, Strip, `opt-level` |
| 部署 | 容器化、交叉编译 | Docker, `cross`, musl |
| 运行 | 日志、监控、追踪 | tracing, OpenTelemetry |
| 诊断 | 性能分析、内存检查 | perf, flamegraph, valgrind |
| 规范 | 代码质量、架构 | Clippy, 模块化, 错误处理 |

---

## 19.2 交叉编译

### 19.2.1 目标平台

```bash
# 查看支持的目标
rustup target list | grep -E "(linux|darwin|windows)"

# 安装常用目标
rustup target add x86_64-unknown-linux-gnu    # Linux (glibc)
rustup target add x86_64-unknown-linux-musl   # Linux (静态 musl)
rustup target add aarch64-unknown-linux-gnu    # ARM64 Linux
rustup target add aarch64-apple-darwin         # Apple Silicon
rustup target add x86_64-apple-darwin          # Intel macOS
rustup target add x86_64-pc-windows-gnu        # Windows (GNU)
rustup target add x86_64-pc-windows-msvc       # Windows (MSVC)
```

### 19.2.2 使用 cross 工具

[cross](https://github.com/cross-rs/cross) 提供了零配置的交叉编译环境，自动处理链接器和系统库：

```toml
# Cross.toml（可选配置）
[build]
pre-build = ["dpkg --add-architecture arm64", "apt-get update"]

[target.aarch64-unknown-linux-gnu]
image = "cross:custom-aarch64"
```

```bash
# 安装 cross
cargo install cross

# 交叉编译到不同平台
cross build --release --target x86_64-unknown-linux-gnu
cross build --release --target aarch64-unknown-linux-gnu
cross build --release --target x86_64-pc-windows-gnu

# 测试
cross test --target x86_64-unknown-linux-gnu
```

### 19.2.3 静态链接（musl）

使用 musl 可以编译出完全静态的 Linux 二进制，不依赖任何系统库，在任何 Linux 上都能运行：

```toml
# .cargo/config.toml
[target.x86_64-unknown-linux-musl]
linker = "x86_64-linux-musl-gcc"
```

```bash
# 安装 musl 工具链
rustup target add x86_64-unknown-linux-musl

# 编译静态二进制
cargo build --release --target x86_64-unknown-linux-musl

# 确认是静态链接
file target/x86_64-unknown-linux-musl/release/myapp
# 输出: ELF ... statically linked
ldd target/x86_64-unknown-linux-musl/release/myapp
# 输出: not a dynamic executable
```

> **💡 提示**：使用 musl 编译的二进制体积会比 glibc 版本大一些（因为包含了所有库代码），但换来了绝对的便携性。对于 Docker 镜像部署特别有用——你可以使用 `scratch` 或 `alpine` 作为基础镜像。

---

## 19.3 Docker 容器化

### 19.3.1 多阶段构建

```dockerfile
# Dockerfile — 多阶段构建
# 阶段 1: 编译
FROM rust:1.80-slim-bookworm AS builder

WORKDIR /app

# 先只复制依赖文件，利用 Docker 缓存
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true

# 复制实际源码并编译
COPY src/ src/
RUN cargo build --release && \
    # 剥离符号表减小体积
    strip target/release/myapp

# 阶段 2: 运行（使用最小基础镜像）
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 从 builder 阶段复制编译产物
COPY --from=builder /app/target/release/myapp /usr/local/bin/

EXPOSE 8080

CMD ["myapp"]
```

### 19.3.2 极致精简（scratch 镜像）

```dockerfile
# Dockerfile.scratch — 完全静态二进制
FROM rust:1.80-slim-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release --target x86_64-unknown-linux-musl 2>/dev/null || true

COPY src/ src/
RUN cargo build --release --target x86_64-unknown-linux-musl && \
    strip target/x86_64-unknown-linux-musl/release/myapp

# 使用空镜像
FROM scratch

COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/myapp /myapp
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

EXPOSE 8080

ENTRYPOINT ["/myapp"]
```

```bash
# 构建镜像（需要先确保有 musl 编译产物）
docker build -t myapp:latest -f Dockerfile.scratch .

# 查看镜像大小
docker images myapp
# 通常只有 5-15MB！
```

### 19.3.3 Docker Compose 配置

```yaml
# docker-compose.yml
version: "3.9"

services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - RUST_LOG=info
      - DATABASE_URL=postgres://user:password@db:5432/mydb
      - REDIS_URL=redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: mydb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d mydb"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

---

## 19.4 发布构建优化

### 19.4.1 Cargo 配置优化

```toml
# Cargo.toml
[profile.release]
# 优化级别: 0=none, 1=minimal, 2=default, 3=aggressive
opt-level = 3

# 启用 LTO（链接时优化）
lto = "fat"           # "fat" = 全程序 LTO, "thin" = 更快的 LTO

# 代码生成单元：1 增加 LTO 效果但增加编译时间
codegen-units = 1

# 启用调试符号（方便分析，不影响运行速度）
debug = 1

# 剥离符号表
strip = true          # Cargo 1.79+ 内置支持

# 启用向量化指令
# target-cpu = "native"  # 为当前 CPU 优化（不跨平台）

# panic 处理方式：abort 减少二进制体积，但丢失 backtrace
panic = "abort"
```

### 19.4.2 二进制瘦身

```bash
# 1. Cargo 内置 strip（Cargo 1.79+）
cargo build --release
# Cargo.toml 中设置 strip = true

# 2. 手动 strip（进一步减小体积）
strip -s target/release/myapp

# 3. 使用 upx 压缩（启动时解压）
upx --best target/release/myapp

# 4. 检查二进制中的符号
nm -C target/release/myapp | wc -l

# 5. 查看二进制大小分布
cargo install cargo-bloat
cargo bloat --release
cargo bloat --release --crates   # 按 crate 查看
```

### 19.4.3 条件编译特性

```toml
# Cargo.toml
[features]
default = ["std"]
std = []
# 无标准库模式（极小二进制）
no_std = []

[profile.release-lto]
inherits = "release"
lto = "fat"
codegen-units = 1
strip = true
```

```toml
# .cargo/config.toml
[alias]
release-lto = "build --profile release-lto"
release-small = "build --release --target x86_64-unknown-linux-musl"
```

**优化效果对比：**

| 优化措施 | 二进制体积 | 影响 |
|---------|-----------|------|
| 默认 release | ~20MB | 基准 |
| + LTO | ~15MB (-25%) | 编译时间+50% |
| + Strip | ~10MB (-33%) | 丢失调试信息 |
| + Panic=abort | ~9MB (-10%) | 丢失 backtrace |
| + UPX 压缩 | ~3MB (-70%) | 启动解压开销 |
| + Musl 静态 | ~12MB | 可移植性 |

---

## 19.5 日志与监控（tracing）

### 19.5.1 tracing 框架简介

[tracing](https://github.com/tokio-rs/tracing) 是 Rust 生态中最主流的诊断框架，支持结构化日志、跨度（span）追踪和分布式上下文传递。

```toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
tracing-appender = "0.2"
```

```rust
use tracing::{info, warn, error, debug, trace, instrument};
use tracing_subscriber::{fmt, EnvFilter};

fn init_logging() {
    // 从 RUST_LOG 环境变量读取日志级别
    // 支持: error, warn, info, debug, trace
    // 也支持按模块: myapp=debug, tokio=info

    let format = fmt::format()
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true);

    fmt()
        .event_format(format)
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    info!("日志系统初始化完成");
}

// 使用 instrument 自动记录函数跨度
#[instrument]
fn process_order(order_id: u64, user_id: u64) -> Result<(), OrderError> {
    debug!("开始处理订单");

    let items = get_order_items(order_id)?;
    info!(items.count = items.len(), "获取到订单项");

    if items.is_empty() {
        warn!("订单为空");

        return Err(OrderError::EmptyOrder);
    }

    let total = calculate_total(&items);
    info!(%total, "订单计算完成");

    charge_user(user_id, total)?;

    info!("订单处理成功");
    Ok(())
}

#[instrument]
fn get_order_items(order_id: u64) -> Result<Vec<Item>, OrderError> {
    // 模拟查询
    Ok(vec![])
}

#[instrument]
fn calculate_total(items: &[Item]) -> f64 {
    items.iter().map(|i| i.price).sum()
}

#[instrument(skip(amount))]
fn charge_user(user_id: u64, amount: f64) -> Result<(), OrderError> {
    info!(%user_id, %amount, "执行扣款");
    Ok(())
}

#[derive(Debug)]
struct Item {
    name: String,
    price: f64,
}

#[derive(Debug)]
enum OrderError {
    EmptyOrder,
    PaymentFailed,
    ItemNotFound,
}

impl std::fmt::Display for OrderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::error::Error for OrderError {}
```

### 19.5.2 JSON 日志输出

```rust
use tracing_subscriber::fmt::format::Json;

fn init_json_logging() {
    // JSON 格式日志（适合日志收集系统如 ELK、Datadog）
    fmt()
        .event_format(Json::default())
        .with_env_filter(EnvFilter::from_default_env())
        .init();
}

// 输出示例:
// {"timestamp":"2024-06-14T10:30:00.123456Z","level":"INFO","fields":{"message":"服务启动","port":8080},"target":"myapp"}
// {"timestamp":"2024-06-14T10:30:01.654321Z","level":"ERROR","fields":{"message":"数据库连接失败","error":"connection refused"},"target":"myapp"}
```

### 19.5.3 文件日志与轮转

```rust
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::writer::MakeWriterExt;

fn init_file_logging() {
    // 按小时轮转的日志文件
    let file_appender = RollingFileAppender::new(
        Rotation::HOURLY,
        "/var/log/myapp",
        "app.log",
    );

    // stdout + 文件双重输出
    let stdout = std::io::stdout.with_max_level(tracing::Level::INFO);
    let file = file_appender.with_min_level(tracing::Level::DEBUG);

    fmt()
        .with_writer(stdout.and(file))
        .with_env_filter(EnvFilter::from_default_env())
        .init();
}
```

### 19.5.4 OpenTelemetry 集成

```toml
[dependencies]
opentelemetry = { version = "0.25", features = ["trace"] }
opentelemetry-otlp = "0.25"
tracing-opentelemetry = "0.28"
```

```rust
use opentelemetry::global;
use opentelemetry_otlp::WithExportConfig;
use tracing_subscriber::prelude::*;

fn init_opentelemetry() {
    // 配置 OTLP exporter（发送到 Jaeger、Tempo 等）
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint("http://localhost:4317"),
        )
        .install_batch(opentelemetry::runtime::Tokio)
        .expect("安装 OTLP tracer 失败");

    // 创建 OpenTelemetry 层
    let telemetry = tracing_opentelemetry::layer()
        .with_tracer(tracer);

    // 组合订阅者：JSON 输出 + OpenTelemetry
    let subscriber = tracing_subscriber::registry()
        .with(telemetry)
        .with(
            fmt::layer()
                .json()
                .with_target(true)
        );

    tracing::subscriber::set_global_default(subscriber)
        .expect("设置全局订阅者失败");
}
```

---

## 19.6 性能分析工具

### 19.6.1 perf（Linux）

```bash
# 安装 perf
sudo apt install linux-tools-common linux-tools-generic

# 编译时保留帧指针
RUSTFLAGS="-C force-frame-pointers=yes" cargo build --release

# 采样分析
sudo perf record --call-graph dwarf ./target/release/myapp

# 查看报告
sudo perf report

# 生成火焰图
sudo perf script | stackcollapse-perf.pl | flamegraph.pl > flamegraph.svg
```

### 19.6.2 火焰图

```bash
# 使用 inferno 生成火焰图
cargo install inferno

# 1. perf 采样
perf record -F 99 -g ./target/release/myapp
perf script > out.perf

# 2. 折叠堆栈
stackcollapse-perf.pl out.perf > out.folded

# 3. 生成火焰图
flamegraph.pl out.folded > flamegraph.svg

# 或者使用 cargo-flamegraph
cargo install flamegraph
cargo flamegraph --bin myapp

# 生成差分火焰图（对比两个版本）
flamegraph.pl out1.folded > before.svg
flamegraph.pl out2.folded > after.svg
```
```

### 19.6.3 内存分析

```bash
# 1. 使用 valgrind 检测内存泄漏
valgrind --tool=memcheck --leak-check=full ./target/release/myapp

# 2. 使用 heaptrack（更友好）
heaptrack ./target/release/myapp
heaptrack_gui heaptrack.myapp.*.gz

# 3. 使用 dhat（Rust 原生堆分析）
# 设置环境变量
DHAT=1 cargo run --release

# 4. 编译时启用内存分析
cargo build --release --features dhat-heap

# 内存分析结果解释:
# - total bytes: 总共分配的字节数
# - max bytes: 堆峰值
# - allocs: 分配次数
# - 热点调用栈: 哪些函数分配了最多内存
```

### 19.6.4 基准测试与回归检测

```bash
# 1. 使用 hyperfine 进行命令行基准测试
cargo install hyperfine

hyperfine --warmup 3 './target/release/myapp --input data.txt'
hyperfine --warmup 3 'myapp --input small.txt' 'myapp --input large.txt'

# 2. 保存基准结果以便对比
hyperfine --warmup 3 './target/release/myapp' --export-json benchmark.json

# 3. 对比两个版本的性能（CI 中有用）
# 先用旧代码
git checkout main
cargo build --release
hyperfine './target/release/myapp' --export-json base.json

# 再用新代码
git checkout feature-branch
cargo build --release
hyperfine './target/release/myapp' --export-json new.json

# 对比
jq -r '.results[0].mean' base.json   # 旧版平均时间
jq -r '.results[0].mean' new.json    # 新版平均时间
```

**性能分析工具一览：**

| 工具 | 用途 | 安装方式 |
|------|------|----------|
| `perf` | CPU 采样、热点分析 | Linux 内核工具 |
| `flamegraph` | 火焰图可视化 | `cargo install flamegraph` |
| `valgrind` | 内存泄漏/错误检测 | 系统包管理器 |
| `heaptrack` | 堆内存分析 | 系统包管理器 |
| `hyperfine` | 命令行基准测试 | `cargo install hyperfine` |
| `cargo-criterion` | 微基准报告 | `cargo install cargo-criterion` |

---

## 19.7 Rust 编码规范与 Clippy

### 19.7.1 Clippy 配置

```toml
# Cargo.toml
[lints.clippy]
# 强制级别
pedantic = "warn"
nursery = "warn"

# 允许特定 lint
cognitive_complexity = "allow"
too_many_arguments = "allow"
module_name_repetitions = "allow"

# 设为错误（阻止编译）
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
print_stdout = "deny"
```

```bash
# 运行 Clippy
cargo clippy -- -D warnings            # 所有警告视为错误
cargo clippy -- -W clippy::pedantic    # 启用 pedantic 级别
cargo clippy --fix                     # 自动修复
```

### 19.7.2 编码规范

```rust
// ========== 命名规范 ==========

// 类型使用 PascalCase
struct UserProfile;
enum HttpStatus { NotFound, Ok }

// 函数和方法使用 snake_case
fn calculate_total() {}
fn set_user_name() {}

// 常量使用 SCREAMING_SNAKE_CASE
const MAX_RETRY_COUNT: u32 = 3;
const DEFAULT_TIMEOUT_SECS: u64 = 30;

// ========== 错误处理规范 ==========

// 使用 thiserror 定义错误类型
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("用户 {0} 不存在")]
    NotFound(u64),

    #[error("验证失败: {0}")]
    Validation(String),

    #[error("数据库错误: {0}")]
    Database(#[from] sqlx::Error),

    #[error("内部错误: {0}")]
    Internal(String),
}

// 避免 unwrap/expect（使用 ? 或错误传播）
pub fn find_user(id: u64) -> Result`<User, AppError>` {
    let user = repository::find_user(id)
        .map_err(|e| AppError::Database(e))?;

    user.ok_or(AppError::NotFound(id))
}

// ========== 文档规范 ==========

/// 计算订单总价（包含税费和折扣）
///
/// # 参数
/// - `items`: 订单项列表
/// - `coupon_code`: 优惠券码（可选）
///
/// # 返回值
/// 返回包含各项费用的 `OrderSummary`
///
/// # 示例
/// ```
/// let items = vec![Item::new(100.0), Item::new(200.0)];
/// let summary = calculate_order_total(&items, None)?;
/// assert_eq!(summary.total, 330.0); // 包含 10% 税
/// ```
///
/// # 错误
/// - 如果优惠券无效，返回 `AppError::Validation`
pub fn calculate_order_total(
    items: &[Item],
    coupon_code: Option<&str>,
) -> Result`<OrderSummary, AppError>` {
    // 实现...
}
```

### 19.7.3 常用 Clippy Lint 分类

| 类别 | Lint 名称 | 说明 |
|------|-----------|------|
| **正确性** | `unwrap_used` | 禁止无检查的 unwrap |
| 正确性 | `expect_used` | 禁止无检查的 expect |
| 正确性 | `panic` | 禁止直接调用 panic! |
| 正确性 | `manual_assert` | 建议使用 assert! 替代 |
| **风格** | `pedantic` 组 | 严格的风格检查 |
| 风格 | `nursery` 组 | 实验性检查 |
| 风格 | `module_name_repetitions` | 模块名重复检查 |
| 风格 | `large_enum_variant` | 枚举变体大小差异过大 |
| **性能** | `needless_pass_by_value` | 避免不必要的值传递 |
| 性能 | `large_stack_frames` | 栈帧过大 |
| 性能 | `cloned_instead_of_copied` | 建议 Copy 替代 Clone |
| **复杂度** | `cognitive_complexity` | 函数认知复杂度 |
| 复杂度 | `too_many_arguments` | 函数参数过多（>7） |

### 19.7.4 格式化

```bash
# 格式化代码
cargo fmt

# 检查格式但不修改
cargo fmt --check

# 自定义格式化配置
# rustfmt.toml
cat > rustfmt.toml << 'EOF'
max_width = 100
tab_spaces = 4
edition = "2021"
use_small_heuristics = "Max"
EOF
```

---

## 19.8 项目架构最佳实践

### 19.8.1 模块组织模式

```
my_project/
├── Cargo.toml
├── src/
│   ├── main.rs              # 入口：初始化、配置加载、启动
│   ├── lib.rs               # 库根：重导出公共 API
│   ├── config.rs            # 配置管理
│   ├── error.rs             # 全局错误类型
│   ├── models/              # 数据模型
│   │   ├── mod.rs
│   │   ├── user.rs
│   │   └── order.rs
│   ├── repository/          # 数据访问层
│   │   ├── mod.rs
│   │   ├── user_repo.rs
│   │   └── order_repo.rs
│   ├── service/             # 业务逻辑层
│   │   ├── mod.rs
│   │   ├── user_service.rs
│   │   └── order_service.rs
│   ├── handler/             # HTTP 处理器
│   │   ├── mod.rs
│   │   ├── user_handler.rs
│   │   └── order_handler.rs
│   └── middleware/          # 中间件
│       ├── mod.rs
│       ├── auth.rs
│       └── logging.rs
├── tests/                   # 集成测试
│   ├── common/
│   │   └── mod.rs
│   ├── api_tests.rs
│   └── db_tests.rs
└── benches/                 # 基准测试
    └── benchmark.rs
```

### 19.8.2 分层架构模式

```rust
// ========== 1. 模型层 (Model) ==========
// src/models/user.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub name: String,
    pub email: String,
    pub password: String,
}

// ========== 2. 仓储层 (Repository) ==========
// src/repository/user_repo.rs
use crate::error::AppError;
use crate::models::User;

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn find_by_id(&self, id: i64) -> Result<Option`<User>`, AppError>;
    async fn find_by_email(&self, email: &str) -> Result<Option`<User>`, AppError>;
    async fn create(&self, user: &User) -> Result`<User, AppError>`;
    async fn update(&self, user: &User) -> Result`<User, AppError>`;
    async fn delete(&self, id: i64) -> Result<bool, AppError>;
}

// PostgreSQL 实现
pub struct PostgresUserRepository {
    pool: sqlx::PgPool,
}

#[async_trait]
impl UserRepository for PostgresUserRepository {
    async fn find_by_id(&self, id: i64) -> Result<Option`<User>`, AppError> {
        let user = sqlx::query_as::<_, User>(
            "SELECT id, name, email FROM users WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(user)
    }
    // ... 其他实现
}

// ========== 3. 服务层 (Service) ==========
// src/service/user_service.rs
use crate::error::AppError;
use crate::models::{User, CreateUserRequest};
use crate::repository::UserRepository;

pub struct UserService<R: UserRepository> {
    repo: R,
}

impl<R: UserRepository> UserService`<R>` {
    pub fn new(repo: R) -> Self { Self { repo } }

    pub async fn register(&self, req: CreateUserRequest) -> Result`<User, AppError>` {
        // 检查邮箱是否已注册
        if self.repo.find_by_email(&req.email).await?.is_some() {
            return Err(AppError::Validation("邮箱已被注册".into()));
        }

        // 密码哈希（使用 argon2）
        let hashed = hash_password(&req.password)?;

        let user = User {
            id: 0,
            name: req.name,
            email: req.email,
        };

        self.repo.create(&user).await
    }

    pub async fn get_profile(&self, user_id: i64) -> Result`<User, AppError>` {
        self.repo
            .find_by_id(user_id)
            .await?
            .ok_or(AppError::NotFound(format!("用户 {}", user_id)))
    }
}

// ========== 4. 处理器层 (Handler) ==========
// src/handler/user_handler.rs
use axum::{extract::State, Json};
use crate::service::UserService;
use crate::models::CreateUserRequest;

pub async fn register_user(
    State(service): State<Arc<UserService`<PostgresUserRepository>`>>,
    Json(req): Json`<CreateUserRequest>`,
) -> Result<Json`<User>`, AppError> {
    let user = service.register(req).await?;
    Ok(Json(user))
}
```

### 19.8.3 依赖注入模式

```rust
// src/main.rs
use std::sync::Arc;

#[derive(Clone)]
struct AppContainer {
    user_service: Arc<UserService`<PostgresUserRepository>`>,
    order_service: Arc<OrderService`<PostgresOrderRepository, PostgresUserRepository>`>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 初始化基础设施
    let pool = init_db_pool().await?;
    let redis = init_redis().await?;

    // 创建仓储实例
    let user_repo = PostgresUserRepository::new(pool.clone());
    let order_repo = PostgresOrderRepository::new(pool.clone());

    // 创建服务实例
    let app = AppContainer {
        user_service: Arc::new(UserService::new(user_repo)),
        order_service: Arc::new(OrderService::new(
            order_repo,
            user_repo,
        )),
    };

    // 构建路由
    let router = Router::new()
        .route("/api/users", post(register_user))
        .route("/api/orders", post(create_order))
        .with_state(app);

    // 启动服务
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router).await?;

    Ok(())
}
```

### 19.8.4 架构模式对比

| 模式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **分层架构** | 标准 CRUD 应用 | 关注点分离，测试性好 | 简单场景过于繁琐 |
| **CQRS** | 读写负载差异大的系统 | 独立扩展读写端 | 复杂度高 |
| **事件驱动** | 微服务、异步处理 | 松耦合，可扩展 | 最终一致性 |
| **六边形架构** | 需要多适配器的项目 | 核心与外部完全解耦 | 抽象层较多 |
| **整洁架构** | 大型长期维护项目 | 业务规则隔离 | 学习曲线陡峭 |

---

## 19.9 项目模板与脚手架

```bash
# 使用 cargo-generate 从模板创建项目
cargo install cargo-generate

# 使用官方模板
cargo generate --git https://github.com/rust-github/template.git

# 常用的 Rust 项目模板:
# - Axum 项目: https://github.com/joelparkerhenderson/axum-web
# - CLI 项目: https://github.com/clap-rs/clap-template
# - Tauri 桌面应用: cargo tauri init
```

---

## 19.10 部署检查清单

### 上线前检查

| 检查项 | 说明 |
|--------|------|
| **编译优化** | `opt-level = 3`, `lto = "fat"`, `codegen-units = 1` |
| **二进制瘦身** | `strip = true`, 考虑 UPX 压缩 |
| **安全扫描** | `cargo audit` 检查依赖漏洞 |
| **性能测试** | 运行 criterion 基准测试，确认无回归 |
| **集成测试** | 端到端测试通过 |
| **配置外部化** | 所有敏感信息通过环境变量注入 |
| **日志配置** | `RUST_LOG` 环境变量控制级别 |
| **健康检查** | 实现 `/health` 端点 |
| **优雅关闭** | 捕获 SIGTERM/SIGINT，等待处理中的请求 |
| **跨平台测试** | 在目标平台上测试（或使用 cross） |

```bash
# 安全审计
cargo install cargo-audit
cargo audit

# 依赖树分析（检查不必要的依赖）
cargo tree --edges normal

# 检查过时依赖
cargo install cargo-outdated
cargo outdated
```

### 运行时监控

```rust
// 健康检查端点
use axum::{Json, routing::get, Router};
use serde_json::json;
use std::time::Instant;

struct HealthCheck {
    start_time: Instant,
}

impl HealthCheck {
    fn new() -> Self {
        Self { start_time: Instant::now() }
    }

    async fn check(&self) -> Json<serde_json::Value> {
        Json(json!({
            "status": "ok",
            "uptime_secs": self.start_time.elapsed().as_secs(),
            "version": env!("CARGO_PKG_VERSION"),
            "timestamp": chrono::Utc::now().to_rfc3339(),
        }))
    }
}
```

### 回滚策略

```yaml
# docker-compose.rollback.yml
version: "3.9"
services:
  app:
    # 保留上一个版本的标签
    image: myapp:${VERSION:-latest}
    # 使用蓝绿部署
    deploy:
      replicas: 3
      update_config:
        order: start-first
        failure_action: rollback
        monitor: 30s
```

---

## 19.11 本章小结

| 主题 | 核心要点 |
|------|----------|
| **交叉编译** | 使用 `cross` 工具，musl 静态链接实现便携二进制 |
| **Docker 容器化** | 多阶段构建 + musl 静态编译 = 极致精简镜像 |
| **构建优化** | LTO, Strip, Panic=abort, UPX 压缩 |
| **日志监控** | `tracing` 结构化日志，JSON 格式，OpenTelemetry 集成 |
| **性能分析** | perf 采样、火焰图、valgrind 内存分析、hyperfine 基准 |
| **编码规范** | Clippy 强制执行，统一的错误处理和命名规范 |
| **项目架构** | 分层架构，依赖注入，仓储模式 |
| **部署检查** | 安全审计、健康检查、优雅关闭、蓝绿部署 |

> **💡 结语**：至此，Rust 从基础到实战的完整学习旅程已全部完成。从变量所有权到 Web 开发，从系统编程到容器化部署，你已经掌握了 Rust 生态的核心知识体系。持续编码、阅读优秀开源项目、参与社区讨论，是更进一步提升的最佳途径。
