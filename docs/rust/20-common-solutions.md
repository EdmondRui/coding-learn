# 第 20 章：常见技术解决方案

> 目标读者：掌握 Rust 基础，希望了解工程中常见技术问题解决方案的开发者。本章涵盖认证授权、限流、配置管理、日志、优雅关停等实战方案。

---

## 20.1 JWT 认证与授权

### 20.1.1 依赖与 Claims 定义

```toml
# Cargo.toml
[dependencies]
jsonwebtoken = "9"
serde = { version = "1", features = ["derive"] }
chrono = { version = "0.4", features = ["serde"] }
axum = "0.7"
tokio = { version = "1", features = ["full"] }
```

```rust
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use serde::{Deserialize, Serialize};
use chrono::{Utc, Duration};

/// JWT Claims 结构体
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    /// 用户 ID
    pub sub: String,
    /// 用户角色
    pub role: String,
    /// 过期时间（UNIX 时间戳）
    pub exp: usize,
    /// 签发时间
    pub iat: usize,
}

impl Claims {
    /// 创建新的 Claims，默认有效期 24 小时
    pub fn new(user_id: impl Into<String>, role: impl Into<String>) -> Self {
        let now = Utc::now();
        Self {
            sub: user_id.into(),
            role: role.into(),
            iat: now.timestamp() as usize,
            exp: (now + Duration::hours(24)).timestamp() as usize,
        }
    }
}
```

### 20.1.2 JWT 生成与验证

```rust
const SECRET: &str = "your-secret-key";

/// 生成 JWT Token
pub fn generate_token(claims: &Claims) -> Result<String, jsonwebtoken::errors::Error> {
    let header = Header::default();
    encode(&header, claims, &EncodingKey::from_secret(SECRET.as_bytes()))
}

/// 验证 JWT Token，返回 Claims
pub fn verify_token(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let validation = Validation::default();
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(SECRET.as_bytes()),
        &validation,
    )?;
    Ok(token_data.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwt_roundtrip() {
        let claims = Claims::new("user_123", "admin");
        let token = generate_token(&claims).unwrap();
        let verified = verify_token(&token).unwrap();
        assert_eq!(verified.sub, "user_123");
        assert_eq!(verified.role, "admin");
    }
}
```

### 20.1.3 Axum 中间件集成

```rust
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

/// 应用状态，持有 JWT 密钥
#[derive(Clone)]
pub struct AppState {
    pub jwt_secret: String,
}

/// JWT 认证中间件
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let token = match auth_header {
        Some(t) => t,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    match verify_token_with_key(token, &state.jwt_secret) {
        Ok(claims) => {
            // 将 Claims 注入请求扩展中，后续 handler 可提取
            request.extensions_mut().insert(claims);
            Ok(next.run(request).await)
        }
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}

/// 使用指定密钥验证 Token
pub fn verify_token_with_key(
    token: &str,
    secret: &str,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
}

/// 角色权限检查中间件
pub async fn require_role(
    required_role: &str,
    request: &Request,
) -> Result<(), StatusCode> {
    let claims = request
        .extensions()
        .get::<Claims>()
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if claims.role != required_role {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(())
}
```

---

## 20.2 限流（Rate Limiting）

### 20.2.1 令牌桶算法

```rust
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 令牌桶限流器
pub struct TokenBucket {
    /// 桶容量（最大令牌数）
    capacity: u32,
    /// 当前令牌数
    tokens: Mutex<u32>,
    /// 令牌生成速率（每秒补充数）
    refill_rate: u32,
    /// 上次补充时间
    last_refill: Mutex<Instant>,
}

impl TokenBucket {
    /// 创建令牌桶
    /// - capacity: 桶容量
    /// - refill_rate: 每秒补充令牌数
    pub fn new(capacity: u32, refill_rate: u32) -> Self {
        Self {
            capacity,
            tokens: Mutex::new(capacity),
            refill_rate,
            last_refill: Mutex::new(Instant::now()),
        }
    }

    /// 尝试获取一个令牌，返回是否允许
    pub fn try_acquire(&self) -> bool {
        self.refill();
        let mut tokens = self.tokens.lock().unwrap();
        if *tokens > 0 {
            *tokens -= 1;
            true
        } else {
            false
        }
    }

    /// 补充令牌
    fn refill(&self) {
        let mut last_refill = self.last_refill.lock().unwrap();
        let now = Instant::now();
        let elapsed = now.duration_since(*last_refill);
        let tokens_to_add = (elapsed.as_secs_f64() * self.refill_rate as f64) as u32;

        if tokens_to_add > 0 {
            let mut tokens = self.tokens.lock().unwrap();
            *tokens = (*tokens + tokens_to_add).min(self.capacity);
            *last_refill = now;
        }
    }
}

// 使用示例
fn main() {
    let bucket = TokenBucket::new(10, 5); // 容量 10，每秒补充 5 个

    for i in 0..15 {
        if bucket.try_acquire() {
            println!("请求 {} 允许", i + 1);
        } else {
            println!("请求 {} 被限流", i + 1);
        }
    }
}
```

### 20.2.2 滑动窗口限流

```rust
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Instant;

/// 滑动窗口限流器
pub struct SlidingWindow {
    /// 窗口大小（秒）
    window_size: f64,
    /// 窗口内最大请求数
    max_requests: u32,
    /// 请求时间戳队列
    timestamps: Mutex<VecDeque<Instant>>,
}

impl SlidingWindow {
    pub fn new(window_size_secs: f64, max_requests: u32) -> Self {
        Self {
            window_size: window_size_secs,
            max_requests,
            timestamps: Mutex::new(VecDeque::new()),
        }
    }

    /// 尝试请求，返回是否允许
    pub fn try_acquire(&self) -> bool {
        let now = Instant::now();
        let mut timestamps = self.timestamps.lock().unwrap();

        // 移除窗口外的旧时间戳
        let cutoff = now - std::time::Duration::from_secs_f64(self.window_size);
        while timestamps.front().map_or(false, |t| *t < cutoff) {
            timestamps.pop_front();
        }

        // 检查窗口内请求数
        if timestamps.len() < self.max_requests as usize {
            timestamps.push_back(now);
            true
        } else {
            false
        }
    }
}
```

### 20.2.3 Axum 限流中间件

```rust
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// 基于 IP 的限流状态
#[derive(Clone)]
pub struct RateLimitState {
    /// IP -> 限流器
    limiters: Arc<Mutex<HashMap<String, SlidingWindow>>>,
    /// 窗口大小（秒）
    window_size: f64,
    /// 窗口内最大请求数
    max_requests: u32,
}

impl RateLimitState {
    pub fn new(window_size: f64, max_requests: u32) -> Self {
        Self {
            limiters: Arc::new(Mutex::new(HashMap::new())),
            window_size,
            max_requests,
        }
    }

    /// 检查指定 IP 是否允许请求
    pub async fn check(&self, ip: &str) -> bool {
        let mut limiters = self.limiters.lock().await;
        let limiter = limiters
            .entry(ip.to_string())
            .or_insert_with(|| SlidingWindow::new(self.window_size, self.max_requests));
        limiter.try_acquire()
    }
}

/// Axum 限流中间件
pub async fn rate_limit_middleware(
    State(state): State<RateLimitState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 从请求中提取客户端 IP（简化示例）
    let ip = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");

    if state.check(ip).await {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::TOO_MANY_REQUESTS)
    }
}
```

---

## 20.3 配置管理

### 20.3.1 依赖与配置结构

```toml
[dependencies]
config = "0.14"
serde = { version = "1", features = ["derive"] }
dotenvy = "0.15"
```

```rust
use serde::Deserialize;

/// 应用配置
#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub log: LogConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RedisConfig {
    pub url: String,
    pub pool_size: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct LogConfig {
    pub level: String,
    pub format: String, // "json" | "text"
}
```

### 20.3.2 多环境配置加载

```rust
use config::{Config, Environment, File};
use std::env;

impl AppConfig {
    /// 加载配置，优先级：环境变量 > {RUN_MODE}.toml > default.toml
    pub fn load() -> Result<Self, config::ConfigError> {
        let run_mode = env::var("RUN_MODE").unwrap_or_else(|_| "development".into());

        let config = Config::builder()
            // 默认配置
            .add_source(File::with_name("config/default"))
            // 环境特定配置
            .add_source(File::with_name(&format!("config/{run_mode}")).required(false))
            // 环境变量覆盖（前缀 APP_，分隔符 __）
            .add_source(
                Environment::with_prefix("APP")
                    .separator("__")
                    .try_parsing(true),
            )
            .build()?;

        config.try_deserialize()
    }
}

// config/default.toml 示例：
// [server]
// host = "127.0.0.1"
// port = 8080
//
// [database]
// url = "postgres://localhost/myapp"
// max_connections = 10
// min_connections = 2
//
// [redis]
// url = "redis://localhost"
// pool_size = 5
//
// [log]
// level = "info"
// format = "text"

// config/production.toml 示例：
// [server]
// host = "0.0.0.0"
// port = 3000
//
// [database]
// max_connections = 50
//
// [log]
// level = "warn"
// format = "json"
```

### 20.3.3 环境变量与 .env 文件

```rust
/// 初始化 .env 文件（开发环境）
pub fn init_dotenv() {
    // 仅在开发环境加载 .env
    if env::var("RUN_MODE").unwrap_or_default() == "development" {
        let _ = dotenvy::dotenv();
    }
}

fn main() {
    init_dotenv();

    let config = AppConfig::load().expect("配置加载失败");
    println!("服务器地址: {}:{}", config.server.host, config.server.port);
    println!("日志级别: {}", config.log.level);
}
```

---

## 20.4 结构化日志

### 20.4.1 依赖与初始化

```toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
```

```rust
use tracing_subscriber::{
    fmt, EnvFilter,
    layer::SubscriberExt,
    util::SubscriberInitExt,
};

/// 初始化日志系统
pub fn init_tracing() {
    // 从环境变量 RUST_LOG 读取过滤级别，默认 info
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        // 根据环境选择格式
        .with(
            if std::env::var("LOG_FORMAT").unwrap_or_default() == "json" {
                fmt::layer().json().boxed()
            } else {
                fmt::layer().with_target(true).with_line_number(true).boxed()
            }
        )
        .init();
}
```

### 20.4.2 Span 追踪与结构化字段

```rust
use tracing::{info, warn, error, instrument, span, Level};

/// 使用 instrument 宏自动创建 span
#[instrument(skip(db), fields(user_id = %user_id))]
async fn get_user(db: &Database, user_id: &str) -> Result<User, AppError> {
    info!("开始查询用户");

    let user = db.find_user(user_id).await
        .inspect_err(|e| {
            error!(error = %e, "查询用户失败");
        })?;

    info!(name = %user.name, email = %user.email, "查询用户成功");
    Ok(user)
}

/// 手动创建 span
async fn process_order(order_id: &str) {
    let span = span!(Level::INFO, "process_order", order_id = %order_id);
    let _enter = span.enter();

    info!("开始处理订单");

    // 业务逻辑...
    match validate_order(order_id).await {
        Ok(_) => info!("订单验证通过"),
        Err(e) => warn!(error = %e, "订单验证失败"),
    }
}
```

### 20.4.3 日志文件输出

```toml
[dependencies]
tracing-appender = "0.2"
```

```rust
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// 初始化带文件输出的日志
pub fn init_tracing_with_file() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    // 按小时轮转日志文件
    let file_appender = RollingFileAppender::new(
        Rotation::HOURLY,
        "logs",
        "app.log",
    );

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(true)) // 控制台输出
        .with(fmt::layer().json().with_writer(file_appender)) // 文件输出（JSON 格式）
        .init();
}
```

---

## 20.5 优雅关停

### 20.5.1 tokio 信号处理

```rust
use tokio::signal;
use tokio::sync::broadcast;

/// 创建关停信号监听器
pub async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("无法监听 Ctrl+C");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("无法监听 SIGTERM")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => println!("收到 Ctrl+C 信号"),
        _ = terminate => println!("收到 SIGTERM 信号"),
    }
}
```

### 20.5.2 Axum 优雅关停

```rust
use axum::Router;
use std::net::SocketAddr;
use tokio::net::TcpListener;

pub async fn run_server(app: Router, addr: SocketAddr) {
    let listener = TcpListener::bind(addr).await.unwrap();
    println!("服务器启动: {}", addr);

    // axum::serve 内置优雅关停支持
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    println!("服务器已优雅关停");
}
```

### 20.5.3 连接排空与超时

```rust
use tokio::time::{timeout, Duration};
use tokio::sync::mpsc;

/// 优雅关停管理器
pub struct ShutdownManager {
    /// 关停信号发送端
    shutdown_tx: broadcast::Sender<()>,
    /// 任务完成信号
    done_rx: mpsc::Receiver<()>,
    /// 关停超时
    timeout_duration: Duration,
}

impl ShutdownManager {
    pub fn new(timeout_secs: u64) -> (Self, broadcast::Receiver<()>, mpsc::Sender<()>) {
        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        let (done_tx, done_rx) = mpsc::channel(1);

        let manager = Self {
            shutdown_tx,
            done_rx,
            timeout_duration: Duration::from_secs(timeout_secs),
        };

        (manager, shutdown_rx, done_tx)
    }

    /// 触发关停
    pub fn trigger_shutdown(&self) {
        let _ = self.shutdown_tx.send(());
    }

    /// 等待所有任务完成或超时
    pub async fn wait_for_completion(&mut self) {
        match timeout(self.timeout_duration, self.done_rx.recv()).await {
            Ok(_) => println!("所有任务已完成"),
            Err(_) => println!("关停超时，强制退出"),
        }
    }
}
```

---

## 20.6 健康检查

### 20.6.1 Liveness 与 Readiness Probe

```rust
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_secs: u64,
}

/// Liveness 探针——进程是否存活
pub async fn liveness() -> impl IntoResponse {
    Json(HealthResponse {
        status: "alive".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        uptime_secs: 0, // 实际项目中用全局计时器
    })
}

/// Readiness 探针——是否准备好接收流量
pub async fn readiness(State(state): State<AppState>) -> impl IntoResponse {
    // 检查关键依赖
    let db_ok = check_database(&state).await;
    let redis_ok = check_redis(&state).await;

    if db_ok && redis_ok {
        (StatusCode::OK, Json(HealthResponse {
            status: "ready".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            uptime_secs: 0,
        }))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(HealthResponse {
            status: "not_ready".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            uptime_secs: 0,
        }))
    }
}

async fn check_database(state: &AppState) -> bool {
    // 实际项目中执行简单查询如 SELECT 1
    true
}

async fn check_redis(state: &AppState) -> bool {
    // 实际项目中执行 PING
    true
}
```

### 20.6.2 路由注册

```rust
use axum::Router;
use axum::routing::get;

pub fn health_routes() -> Router<AppState> {
    Router::new()
        .route("/healthz", get(liveness))       // K8s liveness
        .route("/readyz", get(readiness))        // K8s readiness
}
```

---

## 20.7 文件上传与处理

### 20.7.1 依赖

```toml
[dependencies]
axum = { version = "0.7", features = ["multipart"] }
tokio = { version = "1", features = ["fs", "io-util"] }
uuid = { version = "1", features = ["v4"] }
```

### 20.7.2 Multipart 文件上传

```rust
use axum::{
    extract::Multipart,
    http::StatusCode,
};
use tokio::fs;
use uuid::Uuid;

/// 处理 multipart 文件上传
pub async fn upload_file(mut multipart: Multipart) -> Result<StatusCode, StatusCode> {
    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("unknown").to_string();
        let filename = field.file_name().unwrap_or("unnamed").to_string();
        let content_type = field.content_type().unwrap_or("application/octet-stream").to_string();

        // 生成唯一文件名防止冲突
        let unique_name = format!("{}_{}", Uuid::new_v4(), filename);
        let path = format!("uploads/{}", unique_name);

        // 流式写入文件，避免大文件占用内存
        let data = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
        fs::write(&path, &data).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        tracing::info!(
            name = %name,
            filename = %filename,
            content_type = %content_type,
            size = data.len(),
            "文件上传成功"
        );
    }

    Ok(StatusCode::OK)
}
```

### 20.7.3 大文件流式处理

```rust
use axum::body::StreamBody;
use axum::response::IntoResponse;
use tokio::io::AsyncWriteExt;

/// 大文件流式上传——逐块写入磁盘
pub async fn upload_large_file(mut multipart: Multipart) -> Result<StatusCode, StatusCode> {
    while let Ok(Some(field)) = multipart.next_field().await {
        let filename = field.file_name().unwrap_or("unnamed").to_string();
        let unique_name = format!("{}_{}", Uuid::new_v4(), filename);
        let path = format!("uploads/{}", unique_name);

        // 创建文件
        let mut file = fs::File::create(&path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // 逐块读取并写入
        let mut total_size: u64 = 0;
        let mut chunk_count = 0u32;

        // field 实现了 Stream，可以逐块读取
        use futures::StreamExt;
        let mut stream = field;

        while let Some(chunk) = stream.next().await {
            let data = chunk.map_err(|_| StatusCode::BAD_REQUEST)?;
            file.write_all(&data)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            total_size += data.len() as u64;
            chunk_count += 1;
        }

        file.flush().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        tracing::info!(
            filename = %filename,
            total_size = total_size,
            chunks = chunk_count,
            "大文件上传完成"
        );
    }

    Ok(StatusCode::OK)
}

/// 文件下载——流式响应
pub async fn download_file(path: &str) -> impl IntoResponse {
    match fs::File::open(path).await {
        Ok(file) => {
            use tokio_util::io::ReaderStream;
            let stream = ReaderStream::new(file);
            StreamBody::new(stream).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
```

---

## 20.8 分页与排序

### 20.8.1 分页参数类型

```rust
use serde::Deserialize;

/// 分页请求参数
#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    /// 页码（从 1 开始）
    pub page: Option<u32>,
    /// 每页数量
    pub page_size: Option<u32>,
    /// 游标（cursor-based 分页）
    pub cursor: Option<String>,
    /// 排序字段
    pub sort_by: Option<String>,
    /// 排序方向
    pub sort_order: Option<SortOrder>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum SortOrder {
    Asc,
    Desc,
}

impl Default for SortOrder {
    fn default() -> Self {
        SortOrder::Desc
    }
}

/// 分页响应
#[derive(Debug, serde::Serialize)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

/// 游标分页响应
#[derive(Debug, serde::Serialize)]
pub struct CursorResponse<T> {
    pub data: Vec<T>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}
```

### 20.8.2 SQLx 分页查询

```rust
use sqlx::{PgPool, FromRow, QueryBuilder, Postgres};

#[derive(Debug, FromRow, serde::Serialize)]
pub struct User {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub created_at: chrono::NaiveDateTime,
}

/// Offset 分页查询
pub async fn paginate_users(
    pool: &PgPool,
    params: &PaginationParams,
) -> Result<PaginatedResponse<User>, sqlx::Error> {
    let page = params.page.unwrap_or(1).max(1);
    let page_size = params.page_size.unwrap_or(20).min(100);
    let offset = (page - 1) * page_size;

    // 查询总数
    let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    // 查询数据
    let sort_by = params.sort_by.as_deref().unwrap_or("created_at");
    let sort_order = match params.sort_order.unwrap_or_default() {
        SortOrder::Asc => "ASC",
        SortOrder::Desc => "DESC",
    };

    // 注意：实际项目中应验证 sort_by 防止 SQL 注入
    let query = format!(
        "SELECT id, name, email, created_at FROM users ORDER BY {} {} LIMIT $1 OFFSET $2",
        sort_by, sort_order
    );

    let data = sqlx::query_as::<_, User>(&query)
        .bind(page_size as i64)
        .bind(offset as i64)
        .fetch_all(pool)
        .await?;

    let total_pages = ((total.0 as f64) / page_size as f64).ceil() as u32;

    Ok(PaginatedResponse {
        data,
        total: total.0 as u64,
        page,
        page_size,
        total_pages,
    })
}

/// Cursor 分页查询（更高效，适合大数据量）
pub async fn cursor_paginate_users(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: u32,
) -> Result<CursorResponse<User>, sqlx::Error> {
    let limit = limit.min(100);

    let data = if let Some(cursor) = cursor {
        // 解码游标（通常是 base64 编码的 ID）
        let last_id = cursor.parse::<i64>().unwrap_or(0);
        sqlx::query_as::<_, User>(
            "SELECT id, name, email, created_at FROM users WHERE id < $1 ORDER BY id DESC LIMIT $2"
        )
        .bind(last_id)
        .bind(limit as i64 + 1) // 多查一条判断是否有下一页
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, User>(
            "SELECT id, name, email, created_at FROM users ORDER BY id DESC LIMIT $1"
        )
        .bind(limit as i64 + 1)
        .fetch_all(pool)
        .await?
    };

    let has_more = data.len() > limit as usize;
    let data: Vec<User> = data.into_iter().take(limit as usize).collect();

    let next_cursor = data.last().map(|u| u.id.to_string());

    Ok(CursorResponse {
        data,
        next_cursor,
        has_more,
    })
}
```

---

## 20.9 缓存策略

### 20.9.1 moka 本地缓存

```toml
[dependencies]
moka = { version = "0.12", features = ["future"] }
```

```rust
use moka::future::Cache;
use std::sync::Arc;
use std::time::Duration;

/// 缓存服务
pub struct CacheService {
    /// 用户缓存（TTL 5 分钟，最大 10000 条）
    user_cache: Cache<String, User>,
}

impl CacheService {
    pub fn new() -> Self {
        let user_cache = Cache::builder()
            .time_to_live(Duration::from_secs(300))
            .max_capacity(10_000)
            .build();

        Self { user_cache }
    }

    /// 获取用户（缓存优先）
    pub async fn get_user(&self, db: &Database, user_id: &str) -> Result<User, AppError> {
        // 先查缓存
        if let Some(user) = self.user_cache.get(&user_id.to_string()).await {
            tracing::debug!(user_id = %user_id, "缓存命中");
            return Ok(user);
        }

        // 缓存未命中，查数据库
        tracing::debug!(user_id = %user_id, "缓存未命中");
        let user = db.find_user(user_id).await?;

        // 写入缓存
        self.user_cache.insert(user_id.to_string(), user.clone()).await;

        Ok(user)
    }

    /// 使缓存失效
    pub async fn invalidate_user(&self, user_id: &str) {
        self.user_cache.invalidate(&user_id.to_string()).await;
    }
}
```

### 20.9.2 Redis 缓存

```toml
[dependencies]
redis = { version = "0.25", features = ["tokio-comp", "connection-manager"] }
serde_json = "1"
```

```rust
use redis::AsyncCommands;

/// Redis 缓存服务
pub struct RedisCacheService {
    client: redis::Client,
}

impl RedisCacheService {
    pub fn new(url: &str) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(url)?;
        Ok(Self { client })
    }

    /// 获取缓存
    pub async fn get<T: serde::de::DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, AppError> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let value: Option<String> = conn.get(key).await?;

        match value {
            Some(json) => {
                let data: T = serde_json::from_str(&json)?;
                Ok(Some(data))
            }
            None => Ok(None),
        }
    }

    /// 设置缓存（带 TTL）
    pub async fn set<T: serde::Serialize>(
        &self,
        key: &str,
        value: &T,
        ttl_secs: u64,
    ) -> Result<(), AppError> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let json = serde_json::to_string(value)?;
        conn.set_ex(key, json, ttl_secs).await?;
        Ok(())
    }

    /// 删除缓存
    pub async fn delete(&self, key: &str) -> Result<(), AppError> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        conn.del(key).await?;
        Ok(())
    }
}
```

### 20.9.3 缓存穿透/击穿/雪崩防护

```rust
use std::sync::Arc;
use tokio::sync::Mutex;

/// 缓存防护包装器
pub struct SafeCache<T> {
    redis: RedisCacheService,
    /// 防止缓存击穿：同一 key 只允许一个请求回源
    loading_keys: Arc<Mutex<std::collections::HashSet<String>>>,
    /// 空值缓存 TTL（防穿透）
    null_cache_ttl: u64,
    /// 基础缓存 TTL
    base_ttl: u64,
    /// TTL 随机偏移范围（防雪崩）
    ttl_jitter: u64,
}

impl<T: serde::Serialize + serde::de::DeserializeOwned + Clone> SafeCache<T> {
    pub fn new(redis: RedisCacheService) -> Self {
        Self {
            redis,
            loading_keys: Arc::new(Mutex::new(std::collections::HashSet::new())),
            null_cache_ttl: 60,       // 空值缓存 60 秒
            base_ttl: 300,            // 基础 TTL 5 分钟
            ttl_jitter: 30,           // 随机偏移 0~30 秒
        }
    }

    /// 安全获取：防穿透 + 防击穿 + 防雪崩
    pub async fn get_or_load<F, Fut>(
        &self,
        key: &str,
        loader: F,
    ) -> Result<Option<T>, AppError>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Option<T>, AppError>>,
    {
        // 1. 查缓存
        if let Some(data) = self.redis.get::<T>(key).await? {
            return Ok(Some(data));
        }

        // 2. 防击穿：检查是否有其他请求正在加载
        {
            let mut loading = self.loading_keys.lock().await;
            if loading.contains(key) {
                // 等待并重试
                drop(loading);
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                return self.redis.get::<T>(key).await;
            }
            loading.insert(key.to_string());
        }

        // 3. 回源加载
        let result = loader().await;

        // 4. 写入缓存
        {
            let mut loading = self.loading_keys.lock().await;
            loading.remove(key);
        }

        match result? {
            Some(data) => {
                // 防雪崩：TTL 加随机偏移
                let jitter = rand_offset(self.ttl_jitter);
                self.redis.set(key, &data, self.base_ttl + jitter).await?;
                Ok(Some(data))
            }
            None => {
                // 防穿透：缓存空值
                self.redis.set::<String>(key, &"".into(), self.null_cache_ttl).await.ok();
                Ok(None)
            }
        }
    }
}

fn rand_offset(max: u64) -> u64 {
    use std::time::SystemTime;
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    (nanos as u64) % max
}
```

---

## 20.10 定时任务与调度

### 20.10.1 tokio 定时器

```rust
use tokio::time::{interval, Duration};

/// 简单定时任务
pub async fn periodic_task() {
    let mut interval = interval(Duration::from_secs(60));

    loop {
        interval.tick().await;
        tracing::info!("执行定时任务");

        if let Err(e) = do_cleanup().await {
            tracing::error!(error = %e, "定时任务执行失败");
        }
    }
}

async fn do_cleanup() -> Result<(), AppError> {
    // 清理过期数据等
    Ok(())
}
```

### 20.10.2 Cron 表达式调度

```toml
[dependencies]
cron = "0.12"
```

```rust
use cron::Schedule;
use std::time::Duration;
use tokio::time::sleep;
use chrono::Utc;

/// Cron 调度器
pub struct CronScheduler {
    tasks: Vec<CronTask>,
}

struct CronTask {
    /// Cron 表达式
    schedule: Schedule,
    /// 任务名称
    name: String,
}

impl CronScheduler {
    pub fn new() -> Self {
        Self { tasks: Vec::new() }
    }

    /// 添加 cron 任务
    pub fn add(&mut self, expression: &str, name: impl Into<String>) -> Result<(), cron::error::Error> {
        let schedule = expression.parse()?;
        self.tasks.push(CronTask {
            schedule,
            name: name.into(),
        });
        Ok(())
    }

    /// 启动调度器
    pub async fn run<F, Fut>(self, executor: F)
    where
        F: Fn(String) -> Fut + Clone + Send + 'static,
        Fut: std::future::Future<Output = Result<(), AppError>> + Send,
    {
        let mut handles = Vec::new();

        for task in self.tasks {
            let exec = executor.clone();
            let name = task.name.clone();

            let handle = tokio::spawn(async move {
                loop {
                    // 计算下次执行时间
                    let now = Utc::now();
                    let next = task.schedule.upcoming(Utc).next();

                    if let Some(next_time) = next {
                        let delay = (next_time - now)
                            .to_std()
                            .unwrap_or(Duration::from_secs(0));

                        sleep(delay).await;

                        tracing::info!(task = %name, "执行 cron 任务");
                        if let Err(e) = exec(name.clone()).await {
                            tracing::error!(task = %name, error = %e, "cron 任务执行失败");
                        }
                    } else {
                        sleep(Duration::from_secs(60)).await;
                    }
                }
            });

            handles.push(handle);
        }

        // 等待所有任务（通常不会结束）
        for handle in handles {
            let _ = handle.await;
        }
    }
}

// 使用示例
async fn run_scheduler() {
    let mut scheduler = CronScheduler::new();
    scheduler.add("0 0 * * * *", "每小时清理").unwrap();    // 每小时
    scheduler.add("0 0 3 * * * *", "每日统计").unwrap();    // 每天凌晨 3 点

    scheduler.run(|name| async move {
        match name.as_str() {
            "每小时清理" => do_cleanup().await,
            "每日统计" => do_stats().await,
            _ => Ok(()),
        }
    }).await;
}
```

### 20.10.3 延迟任务队列

```rust
use std::collections::BinaryHeap;
use std::cmp::Ordering;
use tokio::sync::Mutex;
use std::sync::Arc;
use tokio::time::{sleep_until, Instant};

/// 延迟任务
#[derive(Debug)]
struct DelayedTask {
    /// 执行时间
    execute_at: Instant,
    /// 任务 ID
    id: String,
    /// 任务描述
    description: String,
}

// BinaryHeap 是最大堆，我们需要最小堆（最早执行的在前面）
impl Ord for DelayedTask {
    fn cmp(&self, other: &Self) -> Ordering {
        other.execute_at.cmp(&self.execute_at) // 反转比较
    }
}

impl PartialOrd for DelayedTask {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for DelayedTask {
    fn eq(&self, other: &Self) -> bool {
        self.execute_at == other.execute_at
    }
}

impl Eq for DelayedTask {}

/// 延迟任务队列
pub struct DelayQueue {
    heap: Arc<Mutex<BinaryHeap<DelayedTask>>>,
}

impl DelayQueue {
    pub fn new() -> Self {
        Self {
            heap: Arc::new(Mutex::new(BinaryHeap::new())),
        }
    }

    /// 添加延迟任务
    pub async fn schedule(&self, delay: Duration, id: impl Into<String>, description: impl Into<String>) {
        let task = DelayedTask {
            execute_at: Instant::now() + delay,
            id: id.into(),
            description: description.into(),
        };
        self.heap.lock().await.push(task);
    }

    /// 启动消费者
    pub async fn run<F, Fut>(self, handler: F)
    where
        F: Fn(String, String) -> Fut + Clone + Send + 'static,
        Fut: std::future::Future<Output = Result<(), AppError>> + Send,
    {
        loop {
            let next_task = {
                let mut heap = self.heap.lock().await;
                heap.pop()
            };

            if let Some(task) = next_task {
                // 等待到执行时间
                sleep_until(task.execute_at).await;

                let handler = handler.clone();
                let id = task.id;
                let desc = task.description;

                if let Err(e) = handler(id, desc).await {
                    tracing::error!(error = %e, "延迟任务执行失败");
                }
            } else {
                // 队列为空，短暂等待
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
}
```

---

## 小结

| 方案 | 关键 crate/技术 | 适用场景 |
|------|----------------|---------|
| JWT 认证 | jsonwebtoken + Axum 中间件 | API 认证授权 |
| 限流 | 令牌桶/滑动窗口 + tower-governor | API 速率控制 |
| 配置管理 | config + serde + dotenvy | 多环境配置 |
| 结构化日志 | tracing + tracing-subscriber | 可观测性 |
| 优雅关停 | tokio signal + graceful shutdown | 生产部署 |
| 健康检查 | Axum liveness/readiness | K8s 部署 |
| 文件上传 | axum multipart + tokio fs | 文件处理 |
| 分页排序 | SQLx + cursor/offset | 列表查询 |
| 缓存策略 | moka + redis | 性能优化 |
| 定时调度 | tokio time + cron | 后台任务 |
