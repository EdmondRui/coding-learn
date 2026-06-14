# 第14章：Web 开发

> 目标读者：掌握 Rust 基础语法、特征与泛型、异步编程概念的开发者

---

## 14.1 为什么选择 Rust 做 Web 开发

Rust 在 Web 开发领域的优势在于其**高性能**、**内存安全**和**异步生态**。与 Go 或 Node.js 相比，Rust Web 服务拥有更低的延迟和更可控的内存占用，特别适合对性能敏感的场景。

| 特性 | Rust | Go | Node.js |
|------|------|-----|---------|
| 内存安全 | 编译期保证（无 GC） | GC（少量停顿） | GC（标记清除） |
| 吞吐量 | 极高 | 高 | 中等 |
| 启动速度 | 快（编译后） | 快 | 慢（JIT 预热） |
| 二进制体积 | 中等（~15MB） | 小（~10MB） | 大（+Node 运行时） |
| 学习曲线 | 陡峭 | 平缓 | 平缓 |

---

## 14.2 Axum 框架入门

[Axum](https://github.com/tokio-rs/axum) 是 Tokio 团队开发的 Web 框架，利用 Tower 中间件生态，是目前 Rust Web 社区最活跃的框架之一。

### 14.2.1 项目初始化

```toml
# Cargo.toml
[package]
name = "my-axum-app"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.8"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tower-http = { version = "0.6", features = ["cors", "trace"] }
tracing = "0.1"
tracing-subscriber = "0.3"
```

### 14.2.2 第一个 Axum 应用

```rust
use axum::{Router, routing::get, response::Json};
use serde::Serialize;
use std::net::SocketAddr;

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

#[tokio::main]
async fn main() {
    // 初始化日志
    tracing_subscriber::fmt::init();

    let app = Router::new()
        .route("/health", get(health));

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    tracing::info!("服务启动于 {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

```bash
$ cargo run
# 访问 http://localhost:3000/health
# 输出: {"status":"ok","version":"0.1.0"}
```

### 14.2.3 Router 与嵌套路由

Axum 的 `Router` 支持嵌套路由和状态共享：

```rust
use axum::{
    Router,
    routing::{get, post},
    extract::State,
};

// 应用状态
#[derive(Clone)]
struct AppState {
    db_url: String,
    max_connections: u32,
}

async fn list_users(State(state): State<AppState>) -> String {
    format!("连接数据库: {}, 最大连接数: {}", state.db_url, state.max_connections)
}

async fn create_user() -> String {
    "创建用户".to_string()
}

async fn get_user() -> String {
    "获取单个用户".to_string()
}

#[tokio::main]
async fn main() {
    let state = AppState {
        db_url: "postgres://localhost/mydb".to_string(),
        max_connections: 10,
    };

    // 定义 API v1 路由组
    let api_v1 = Router::new()
        .route("/users", get(list_users).post(create_user))
        .route("/users/:id", get(get_user));

    let app = Router::new()
        .nest("/api/v1", api_v1)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

| 方法 | HTTP 对应 | 用途 |
|------|-----------|------|
| `get(handler)` | `GET` | 查询资源 |
| `post(handler)` | `POST` | 创建资源 |
| `put(handler)` | `PUT` | 全量更新 |
| `patch(handler)` | `PATCH` | 部分更新 |
| `delete(handler)` | `DELETE` | 删除资源 |
| `any(handler)` | 所有方法 | 兜底处理器 |

> **💡 提示**：Axum 支持使用 `:param` 路径参数，通过 `Path` 提取器获取。多个路由之间的顺序不重要，Axum 会精确匹配。

---

## 14.3 路由、中间件与提取器

### 14.3.1 提取器（Extractor）

提取器是从 HTTP 请求中提取数据的方式。Axum 提供了一套强大的提取器系统：

```rust
use axum::{
    extract::{Path, Query, Json, Extension, Form, HeaderMap},
    http::{header, StatusCode, Method, Uri},
    response::IntoResponse,
};
use serde::Deserialize;
use std::collections::HashMap;

// 1. 路径参数
#[derive(Deserialize)]
struct UserPath {
    id: u64,
    resource: String,
}

async fn path_extract(Path((id, resource)): Path<(u64, String)>) -> String {
    format!("用户 {} 的资源: {}", id, resource)
}

// 2. 查询参数
#[derive(Deserialize)]
struct Pagination {
    page: Option<u32>,
    page_size: Option<u32>,
    sort: Option<String>,
}

async fn query_extract(Query(params): Query<Pagination>) -> String {
    let page = params.page.unwrap_or(1);
    let size = params.page_size.unwrap_or(20);
    format!("分页: 第{}页, 每页{}条", page, size)
}

// 3. JSON 请求体
#[derive(Deserialize)]
struct CreateUserRequest {
    name: String,
    email: String,
    age: Option<u8>,
}

async fn json_extract(Json(payload): Json<CreateUserRequest>) -> impl IntoResponse {
    // 使用 payload
    (StatusCode::CREATED, format!("创建用户: {}", payload.name))
}

// 4. 表单数据
#[derive(Deserialize)]
struct LoginForm {
    username: String,
    password: String,
}

async fn form_extract(Form(form): Form<LoginForm>) -> String {
    format!("登录用户: {}", form.username)
}

// 5. 请求头
async fn header_extract(headers: HeaderMap) -> String {
    let user_agent = headers
        .get("User-Agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");
    format!("User-Agent: {}", user_agent)
}
```

### 14.3.2 自定义提取器

实现 `FromRequestParts` 或 `FromRequest` trait 可以创建自定义提取器：

```rust
use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    async_trait,
};

struct AuthToken(String);

#[async_trait]
impl<S> FromRequestParts<S> for AuthToken
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get("Authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or((StatusCode::UNAUTHORIZED, "缺少 Authorization 头"))?;

        Ok(AuthToken(token.to_string()))
    }
}

async fn protected_handler(AuthToken(token): AuthToken) -> String {
    format!("认证通过, token: {}", token)
}
```

### 14.3.3 中间件（Middleware）

Axum 基于 Tower 提供中间件支持：

```rust
use axum::{
    Router,
    middleware::{self, Next},
    response::Response,
    http::Request,
};
use std::time::Instant;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;

// 自定义请求日志中间件
async fn request_logger<B>(req: Request<B>, next: Next<B>) -> Response {
    let start = Instant::now();
    let method = req.method().clone();
    let uri = req.uri().clone();

    let response = next.run(req).await;

    let duration = start.elapsed();
    info!("{} {} -> {} (耗时: {:?})", method, uri, response.status(), duration);

    response
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app = Router::new()
        .route("/", axum::routing::get(|| async { "Hello" }))
        // 中间件顺序: 后添加的先执行
        .layer(CorsLayer::permissive())  // CORS
        .layer(TraceLayer::new_for_http()) // Tower 追踪
        .layer(middleware::from_fn(request_logger)); // 自定义日志

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

> **💡 提示**：中间件的执行顺序是 **LIFO**（后添加的先执行）。上例中，请求处理流程为：`request_logger → TraceLayer → CORS → 处理器`。响应返回时反向执行。

**常用 Tower HTTP 中间件：**

| Crate | Feature | 说明 |
|-------|---------|------|
| `tower-http` | `cors` | 跨域资源共享 |
| `tower-http` | `trace` | 请求/响应日志追踪 |
| `tower-http` | `compression` | 响应体压缩 (gzip/brotli) |
| `tower-http` | `timeout` | 请求超时控制 |
| `tower-http` | `limit` | 请求体大小限制 |
| `tower-http` | `auth` | 基础认证中间件 |

---

## 14.4 响应构建

### 14.4.1 IntoResponse 特征

任何实现了 `IntoResponse` 的类型都可以作为 Axum 处理器的返回值：

```rust
use axum::{
    response::{Json, Html, IntoResponse, Redirect},
    http::StatusCode,
};
use serde_json::{Value, json};

// 1. 返回 JSON
fn json_response() -> Json<Value> {
    Json(json!({
        "success": true,
        "data": { "id": 1, "name": "Alice" }
    }))
}

// 2. 返回 HTML
fn html_response() -> Html<&'static str> {
    Html("<h1>Hello World</h1>")
}

// 3. 重定向
fn redirect_response() -> Redirect {
    Redirect::to("/login")
}

// 4. 组合响应（状态码 + JSON）
fn combined_response() -> (StatusCode, Json<Value>) {
    (
        StatusCode::CREATED,
        Json(json!({ "id": 42 })),
    )
}

// 5. Result 类型
fn fallible_handler() -> Result<Json<Value>, (StatusCode, String)> {
    Err((StatusCode::INTERNAL_SERVER_ERROR, "出错了".to_string()))
}
```

### 14.4.2 统一错误处理

```rust
use axum::{
    response::{IntoResponse, Response},
    http::StatusCode,
    Json,
};
use serde_json::json;
use std::fmt;

// 自定义应用错误
#[derive(Debug)]
enum AppError {
    NotFound(String),
    Unauthorized(String),
    Validation(String),
    Internal(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::NotFound(msg)
            | AppError::Unauthorized(msg)
            | AppError::Validation(msg)
            | AppError::Internal(msg) => write!(f, "{}", msg),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            AppError::Validation(msg) => (StatusCode::UNPROCESSABLE_ENTITY, msg.clone()),
            AppError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };

        (
            status,
            Json(json!({
                "error": {
                    "type": format!("{:?}", self),
                    "message": message
                }
            })),
        )
            .into_response()
    }
}

// 使用自定义错误
async fn get_user(id: u64) -> Result<Json<Value>, AppError> {
    if id == 0 {
        return Err(AppError::NotFound(format!("用户 {} 不存在", id)));
    }
    Ok(Json(json!({ "id": id, "name": "Alice" })))
}
```

---

## 14.5 Actix-web 框架对比

[Actix-web](https://actix.rs/) 是另一个广受欢迎的 Rust Web 框架，与 Axum 各有侧重：

| 对比维度 | Axum | Actix-web |
|----------|------|-----------|
| 底层运行时 | Tokio | Tokio（自 4.0 起） |
| 中间件生态 | Tower 生态（共享 gRPC/Tonic） | 自有中间件系统 |
| 提取器 | 基于 `FromRequestParts` / `FromRequest` | 基于 `FromRequest` |
| 路由 | 嵌套 Router + 状态共享 | 配置化路由（`web::resource`） |
| WebSocket | 通过 `axum::extract::ws` | 内置 `web::HttpResponse::streaming` |
| 性能 | 极高 | 顶级（曾蝉联 TechEmpower 榜首） |
| 学习曲线 | 中等（依赖 Tower 概念） | 较陡（Actor 模型背景） |

### Actix-web 示例

```rust
use actix_web::{web, App, HttpServer, Responder, HttpRequest};

async fn greet(req: HttpRequest) -> impl Responder {
    let name = req.match_info().get("name").unwrap_or("World");
    format!("Hello {}!", name)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .route("/", web::get().to(greet))
            .route("/{name}", web::get().to(greet))
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
```

> **💡 提示**：对于新项目，推荐优先考虑 Axum：它与 Tokio 生态的集成更紧密，社区活跃度增长更快，且 Tower 中间件可复用于 Tonic（gRPC）等其他场景。Actix-web 的 Actor 模型在特定场景仍有优势。

---

## 14.6 模板引擎

在服务端渲染场景中，模板引擎用于生成 HTML。Rust 生态中主要有 Tera 和 Askama 两种选择。

### 14.6.1 Tera（模板引擎）

Tera 是 Rust 版的 Jinja2/Django 模板引擎，语法非常接近 Python 开发者熟悉的模板语言。

```toml
[dependencies]
tera = "1"
serde = { version = "1", features = ["derive"] }
```

```rust
use axum::{
    response::Html,
    extract::State,
};
use tera::{Tera, Context};
use std::sync::Arc;

// Tera 引擎（线程安全）
struct TemplateEngine {
    tera: Tera,
}

fn init_templates() -> TemplateEngine {
    // 从目录加载所有模板
    let tera = Tera::new("templates/**/*.html").unwrap();
    TemplateEngine { tera }
}

// 模板上下文
#[derive(serde::Serialize)]
struct UserProfile {
    username: String,
    posts_count: u32,
    is_admin: bool,
}

async fn render_profile(
    State(engine): State<Arc<TemplateEngine>>,
) -> Html<String> {
    let user = UserProfile {
        username: "Alice".to_string(),
        posts_count: 42,
        is_admin: true,
    };

    let mut ctx = Context::new();
    ctx.insert("title", "用户主页");
    ctx.insert("user", &user);

    let html = engine.tera.render("profile.html", &ctx).unwrap();
    Html(html)
}
```

`templates/profile.html`:
```html
<!DOCTYPE html>
<html>
<head>
    <title>{{ "{{" }} title }}</title>
</head>
<body>
    <h1>欢迎, {{ "{{" }} user.username }}</h1>
    <p>文章数量: {{ "{{" }} user.posts_count }}</p>
    {% if user.is_admin %}
        <span class="badge">管理员</span>
    {% endif %}

    <h2>文章列表</h2>
    <ul>
    {% for post in posts %}
        <li>{{ "{{" }} post.title }} - {{ "{{" }} post.date | date(format="%Y-%m-%d") }}</li>
    {% else %}
        <li>暂无文章</li>
    {% endfor %}
    </ul>
</body>
</html>
```

**Tera 常用语法：**

| 语法 | 说明 |
|------|------|
| `&#123;&#123; variable &#125;&#125;` | 输出变量 |
| `{% if condition %}...{% endif %}` | 条件判断 |
| `{% for item in items %}...{% endfor %}` | 循环遍历 |
| `{% block name %}...{% endblock %}` | 模板继承块 |
| `{% extends "base.html" %}` | 继承模板 |
| `{% include "header.html" %}` | 包含子模板 |
| `&#123;&#123; value \| filter(args) &#125;&#125;` | 过滤器（如 `date`, `upper`, `length`） |

### 14.6.2 Askama（编译时模板）

Askama 在**编译期**生成类型安全的 Rust 代码，避免了运行时的模板解析开销。

```toml
[dependencies]
askama = "0.12"
```

```rust
use askama::Template;

#[derive(Template)]
#[template(path = "hello.html")]
struct HelloTemplate<'a> {
    name: &'a str,
    items: &'a [String],
}

// Askama 在编译时生成 render 方法
fn render_askama() -> String {
    let items = vec!["苹果".into(), "香蕉".into(), "橘子".into()];
    let template = HelloTemplate {
        name: "World",
        items: &items,
    };
    template.render().unwrap()
}
```

`templates/hello.html`:
```html
<h1>Hello, {{ "{{" }} name }}!</h1>
<ul>
{% for item in items %}
  <li>{{ "{{" }} item }}</li>
{% endfor %}
</ul>
```

| 对比 | Tera | Askama |
|------|------|--------|
| 渲染时机 | 运行时 | 编译时 |
| 类型安全 | 运行时类型检查 | 编译期类型检查 |
| 灵活性 | 高（可动态加载模板） | 中等（模板路径需预定义） |
| 性能 | 优秀（有缓存） | 最优（零运行时开销） |
| 适用场景 | 动态模板、定制化需求 | API 文档、固定格式输出 |

---

## 14.7 WebSocket 与 SSE

### 14.7.1 WebSocket（Axum）

```toml
[dependencies]
axum = { version = "0.8", features = ["ws"] }
futures-util = "0.3"
```

```rust
use axum::{
    extract::ws::{WebSocket, WebSocketUpgrade, Message},
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    // 发送欢迎消息
    let _ = socket.send(Message::Text("连接成功！".into())).await;

    // 双向通信循环
    while let Some(msg) = socket.recv().await {
        match msg {
            Ok(Message::Text(text)) => {
                let reply = format!("收到: {}", text);
                if socket.send(Message::Text(reply)).await.is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) => break,
            Err(_) => break,
            _ => {} // 忽略 Ping/Pong/Binary
        }
    }
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/ws", get(ws_handler));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

### 14.7.2 Server-Sent Events（SSE）

SSE 是单向推送技术（服务器→客户端），比 WebSocket 更轻量：

```rust
use axum::{
    response::sse::{Event, Sse},
    routing::get,
    Router,
};
use std::convert::Infallible;
use tokio_stream::wrappers::IntervalStream;
use tokio_stream::StreamExt;
use std::time::Duration;

async fn sse_handler() -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    // 每 5 秒发送一次事件
    let interval = tokio::time::interval(Duration::from_secs(5));
    let stream = IntervalStream::new(interval).map(|_| {
        Ok(Event::default()
            .data("心跳保持连接")
            .event("heartbeat"))
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive-text"),
    )
}
```

| 特性 | WebSocket | SSE |
|------|-----------|-----|
| 通信方向 | 双向 | 单向（服务器→客户端） |
| 协议 | `ws://` / `wss://` | 基于 HTTP |
| 浏览器支持 | 所有现代浏览器 | 除 IE 外都支持 |
| 自动重连 | 需手动实现 | 内置（EventSource API） |
| 二进制数据 | 支持 | 仅文本 |
| 适用场景 | 实时协作、游戏、聊天 | 通知推送、状态更新、日志流 |

---

## 14.8 认证与授权

### 14.8.1 JWT 认证

```toml
[dependencies]
jsonwebtoken = "9"
serde = { version = "1", features = ["derive"] }
chrono = { version = "0.4", features = ["serde"] }
```

```rust
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use serde::{Serialize, Deserialize};
use chrono::{Utc, Duration};

// JWT Claims
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,       // 主题（用户 ID）
    exp: usize,        // 过期时间戳
    iat: usize,        // 签发时间
    role: String,      // 角色
}

struct JwtConfig {
    secret: String,
    expiration_hours: i64,
}

impl JwtConfig {
    fn new(secret: &str) -> Self {
        Self {
            secret: secret.to_string(),
            expiration_hours: 24,
        }
    }

    fn create_token(&self, user_id: &str, role: &str) -> Result<String, jsonwebtoken::errors::Error> {
        let now = Utc::now();
        let claims = Claims {
            sub: user_id.to_string(),
            exp: (now + Duration::hours(self.expiration_hours)).timestamp() as usize,
            iat: now.timestamp() as usize,
            role: role.to_string(),
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
    }

    fn verify_token(&self, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::default(),
        )?;
        Ok(token_data.claims)
    }
}
```

### 14.8.2 在 Axum 中集成 JWT 中间件

```rust
use axum::{
    extract::{FromRequestParts, State},
    http::{request::Parts, StatusCode},
    response::IntoResponse,
    async_trait,
    Json,
};
use serde_json::json;

// JWT 提取器
#[async_trait]
impl<S> FromRequestParts<S> for Claims
where
    S: Send + Sync,
    JwtConfig: FromRef<S>,
{
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let jwt_config = JwtConfig::from_ref(state);

        let token = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or_else(|| {
                (StatusCode::UNAUTHORIZED, Json(json!({"error": "未提供认证令牌"})))
            })?;

        jwt_config.verify_token(token).map_err(|_| {
            (StatusCode::UNAUTHORIZED, Json(json!({"error": "令牌无效或已过期"})))
        })
    }
}

// 受保护的路由
async fn profile(claims: Claims) -> impl IntoResponse {
    Json(json!({
        "user_id": claims.sub,
        "role": claims.role
    }))
}

// 登录路由
async fn login(
    State(jwt): State<JwtConfig>,
    Json(creds): Json<LoginRequest>,
) -> impl IntoResponse {
    // 验证用户名密码（略）
    let token = jwt.create_token(&creds.username, "user").unwrap();
    Json(json!({ "token": token }))
}

#[derive(serde::Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}
```

> **💡 提示**：生产环境中应使用 HTTPS 传输令牌，考虑使用 refresh token 机制。JWT 的 secret 应通过环境变量注入，不要硬编码。

### 14.8.3 基于角色的访问控制（RBAC）

```rust
#[derive(Debug)]
enum Role {
    Admin,
    User,
    Guest,
}

impl Role {
    fn can_access(&self, resource: &str, action: &str) -> bool {
        match (self, resource, action) {
            (Role::Admin, _, _) => true,           // 管理员可做任何操作
            (Role::User, "posts", "read") => true,  // 用户可读文章
            (Role::User, "posts", "write") => true, // 用户可写文章
            (Role::User, "admin", _) => false,      // 用户不能访问管理界面
            (Role::Guest, "posts", "read") => true, // 访客只能读文章
            (Role::Guest, _, _) => false,
        }
    }
}

fn authorize(claims: &Claims, resource: &str, action: &str) -> Result<(), AppError> {
    let role = match claims.role.as_str() {
        "admin" => Role::Admin,
        "user" => Role::User,
        _ => Role::Guest,
    };

    if role.can_access(resource, action) {
        Ok(())
    } else {
        Err(AppError::Unauthorized("权限不足".to_string()))
    }
}
```

---

## 14.9 生产配置建议

```toml
[dependencies]
axum = { version = "0.8", features = ["macros"] }
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.6", features = [
    "cors",         // CORS
    "trace",        // 请求追踪
    "compression-gzip", // 响应压缩
    "timeout",      // 超时控制
    "limit",        // 请求体大小限制
] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

```rust
use tower_http::{
    cors::CorsLayer,
    trace::TraceLayer,
    compression::CompressionLayer,
    timeout::TimeoutLayer,
    limit::RequestBodyLimitLayer,
};
use std::time::Duration;

fn build_app() -> Router {
    Router::new()
        .route("/api/users", axum::routing::get(list_users))
        .route("/api/health", axum::routing::get(health))
        // 生产级中间件栈
        .layer(CompressionLayer::new())                  // 响应压缩
        .layer(TimeoutLayer::new(Duration::from_secs(30))) // 超时控制
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024)) // 请求体限制 10MB
        .layer(TraceLayer::new_for_http())               // 请求追踪
        .layer(CorsLayer::permissive())                  // CORS（开发时宽松）
}
```

---

## 14.10 本章小结

| 主题 | 核心要点 |
|------|----------|
| **Axum** | Tokio 生态，Tower 中间件，类型安全的路由和状态管理 |
| **Actix-web** | 高成熟度，Actor 模型可选，性能顶级 |
| **提取器** | `Path`, `Query`, `Json`, `Form`, `HeaderMap`, `Extension` |
| **中间件** | 基于 Tower，LIFO 执行顺序 |
| **模板引擎** | Tera（运行时灵活） vs Askama（编译时安全） |
| **WebSocket** | 全双工实时通信，适合聊天/协作/游戏 |
| **SSE** | 单向推送，适合通知/状态流 |
| **JWT 认证** | 无状态认证方式，需配合 HTTPS 使用 |
| **错误处理** | 自定义 Error 类型实现 `IntoResponse` |

> **💡 下一步**：掌握 Web 框架基础后，接下来学习第15章——数据库与缓存，了解如何为 Web 应用添加持久层和数据缓存能力。
