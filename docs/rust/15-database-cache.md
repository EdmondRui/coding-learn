# 第15章：数据库与缓存

> 目标读者：掌握 Rust 基础语法、特征与泛型、异步编程概念的开发者

---

## 15.1 概述

Rust 的数据库生态覆盖了关系型数据库和 NoSQL 的各类场景。本章将深入 SQLx、Diesel、SeaORM 三大 ORM/驱动方案，以及 Redis 客户端的使用，涵盖连接池管理、迁移工具和缓存策略。

| 库 | 类型 | 特点 | 适用场景 |
|---|------|------|----------|
| **SQLx** | 异步 SQL 驱动 | 编译期检查 SQL，纯 Rust，无 ORM 绑定 | 需要精细控制 SQL 的项目 |
| **Diesel** | ORM / 查询构建器 | 类型安全，编译期验证，同步 | 传统 CRUD 应用，代码生成友好 |
| **SeaORM** | 异步 ORM | 兼容 SQLx/Diesel，迁移内置，ActiveRecord 风格 | 快速原型，需要 Schema 迁移的项目 |
| **redis-rs** | Redis 客户端 | 同步/异步双支持，连接池 | 缓存、消息队列、Session 存储 |
| **MongoDB** | 官方驱动 | `mongodb` crate，BSON 类型系统 | 文档数据库场景 |

---

## 15.2 SQLx 与数据库交互

[SQLx](https://github.com/launchbadge/sqlx) 是一个纯 Rust 的异步 SQL 工具包，支持 PostgreSQL、MySQL、SQLite。

### 15.2.1 环境准备

```toml
[dependencies]
sqlx = { version = "0.8", features = [
    "runtime-tokio",
    "tls-rustls",
    "postgres",      # 数据库驱动（按需选择）
    # "mysql",
    # "sqlite",
    "chrono",        # 时间类型支持
    "uuid",          # UUID 支持
] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
anyhow = "1"        # 错误处理
dotenvy = "0.15"    # .env 加载
```

```
# .env
DATABASE_URL=postgres://user:password@localhost:5432/mydb
```

### 15.2.2 连接池配置

```rust
use sqlx::postgres::PgPoolOptions;
use std::time::Duration;

#[derive(Clone)]
struct AppState {
    db: sqlx::PgPool,
}

async fn init_db_pool() -> Result<sqlx::PgPool, sqlx::Error> {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL 环境变量未设置");

    let pool = PgPoolOptions::new()
        .max_connections(20)                   // 最大连接数
        .min_connections(5)                    // 最小空闲连接
        .acquire_timeout(Duration::from_secs(5)) // 获取连接超时
        .max_lifetime(Duration::from_secs(1800)) // 连接最大存活时间
        .idle_timeout(Duration::from_secs(600))  // 空闲超时
        .connect(&database_url)
        .await?;

    // 验证连接
    sqlx::query("SELECT 1").execute(&pool).await?;
    println!("数据库连接成功");

    Ok(pool)
}
```

**连接池参数调优建议：**

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `max_connections` | CPU × 2 + 磁盘数 | 避免数据库过载 |
| `min_connections` | 5~10 | 应对突发流量 |
| `acquire_timeout` | 3~10 秒 | 防止请求无限等待 |
| `max_lifetime` | 30 分钟 | 防止连接被网络设备断开 |
| `idle_timeout` | 10 分钟 | 回收空闲连接资源 |

### 15.2.3 SQL 查询与映射

```rust
use sqlx::FromRow;
use serde::{Deserialize, Serialize};
use chrono::NaiveDateTime;

// 数据库行 → Rust 结构体（编译期检查字段名）
#[derive(Debug, FromRow, Serialize, Deserialize)]
struct User {
    id: i64,
    name: String,
    email: String,
    age: Option<i32>,
    created_at: NaiveDateTime,
}

struct CreateUser {
    name: String,
    email: String,
    age: Option<i32>,
}

// 查询多条记录
async fn list_users(pool: &sqlx::PgPool) -> Result<Vec<User>, sqlx::Error> {
    let users = sqlx::query_as::<_, User>(
        "SELECT id, name, email, age, created_at FROM users WHERE age > $1 ORDER BY id"
    )
    .bind(18)  // 参数绑定（$1, $2, ...）
    .fetch_all(pool)
    .await?;

    Ok(users)
}

// 查询单条记录
async fn get_user(pool: &sqlx::PgPool, user_id: i64) -> Result<Option<User>, sqlx::Error> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, name, email, age, created_at FROM users WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

// 插入并获取自增 ID
async fn create_user(pool: &sqlx::PgPool, input: CreateUser) -> Result<User, sqlx::Error> {
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (name, email, age)
        VALUES ($1, $2, $3)
        RETURNING id, name, email, age, created_at
        "#
    )
    .bind(&input.name)
    .bind(&input.email)
    .bind(input.age)
    .fetch_one(pool)
    .await?;

    Ok(user)
}

// 更新与删除
async fn update_user_email(pool: &sqlx::PgPool, id: i64, email: &str) -> Result<u64, sqlx::Error> {
    let rows = sqlx::query("UPDATE users SET email = $1 WHERE id = $2")
        .bind(email)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();

    Ok(rows)
}

async fn delete_user(pool: &sqlx::PgPool, id: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}
```

### 15.2.4 事务处理

```rust
async fn transfer_money(
    pool: &sqlx::PgPool,
    from_id: i64,
    to_id: i64,
    amount: f64,
) -> Result<(), sqlx::Error> {
    // 开始事务
    let mut tx = pool.begin().await?;

    // 扣减转出账户
    sqlx::query(
        "UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1"
    )
    .bind(amount)
    .bind(from_id)
    .execute(&mut *tx)
    .await?;

    // 增加转入账户
    sqlx::query(
        "UPDATE accounts SET balance = balance + $1 WHERE id = $2"
    )
    .bind(amount)
    .bind(to_id)
    .execute(&mut *tx)
    .await?;

    // 提交事务（若出错则自动回滚）
    tx.commit().await?;

    Ok(())
}
```

> **💡 提示**：SQLx 还有一个杀手级功能——**编译期 SQL 检查**。启用 `query!` 宏后，SQL 语句在编译时就会检查语法和类型，无需运行时测试就能发现 SQL 错误。需安装 `sqlx-cli`。

```bash
# 安装 SQLx CLI（用于迁移和编译时检查）
cargo install sqlx-cli

# 创建迁移
sqlx migrate add create_users_table

# 运行迁移
sqlx migrate run
```

---

## 15.3 Diesel ORM

[Diesel](https://diesel.rs/) 是 Rust 最成熟的 ORM 框架，提供了类型安全的查询构建器和编译时检查。

### 15.3.1 项目配置

```toml
[dependencies]
diesel = { version = "2.2", features = ["postgres", "r2d2", "chrono"] }
diesel_migrations = "2.2"
r2d2 = "0.8"
dotenvy = "0.15"
```

```bash
# 安装 Diesel CLI
cargo install diesel_cli --no-default-features --features postgres

# 初始化 Diesel（创建 migrations 目录和 diesel.toml）
diesel setup

# 创建迁移
diesel migration generate create_users

# 运行迁移
diesel migration run
```

### 15.3.2 Schema 与模型定义

```rust
// src/schema.rs（由 diesel CLI 自动生成）
// @generated automatically by Diesel CLI

diesel::table! {
    users (id) {
        id -> Int8,
        name -> Varchar,
        email -> Varchar,
        age -> Nullable<Int4>,
        created_at -> Timestamp,
    }
}

diesel::table! {
    posts (id) {
        id -> Int8,
        user_id -> Int8,
        title -> Varchar,
        body -> Text,
        published -> Bool,
        created_at -> Timestamp,
    }
}
```

```rust
// src/models.rs
use chrono::NaiveDateTime;
use diesel::prelude::*;

#[derive(Queryable, Selectable, Debug)]
#[diesel(table_name = crate::schema::users)]
#[diesel(check_for_backend(diesel::pg::Pg))]
struct User {
    pub id: i64,
    pub name: String,
    pub email: String,
    pub age: Option<i32>,
    pub created_at: NaiveDateTime,
}

// 插入用结构体
#[derive(Insertable)]
#[diesel(table_name = crate::schema::users)]
struct NewUser<'a> {
    pub name: &'a str,
    pub email: &'a str,
    pub age: Option<i32>,
}

// 更新用结构体
#[derive(AsChangeset)]
#[diesel(table_name = crate::schema::users)]
struct UpdateUser<'a> {
    pub name: Option<&'a str>,
    pub email: Option<&'a str>,
    pub age: Option<i32>,
}
```

### 15.3.3 增删改查

```rust
use diesel::prelude::*;
use diesel::r2d2::{self, ConnectionManager};

type DbPool = r2d2::Pool<ConnectionManager<PgConnection>>;

// 初始化连接池
fn init_pool() -> DbPool {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL 必须设置");
    let manager = ConnectionManager::<PgConnection>::new(database_url);
    r2d2::Pool::builder()
        .max_size(20)
        .build(manager)
        .expect("创建连接池失败")
}

// 查 - 单条
fn find_user(pool: &DbPool, user_id: i64) -> QueryResult<User> {
    use crate::schema::users::dsl::*;
    let mut conn = pool.get()?;
    users.filter(id.eq(user_id)).first(&mut conn)
}

// 查 - 条件过滤
fn find_adults(pool: &DbPool, min_age: i32) -> QueryResult<Vec<User>> {
    use crate::schema::users::dsl::*;
    let mut conn = pool.get()?;
    users
        .filter(age.is_not_null())
        .filter(age.ge(min_age))
        .order(id.asc())
        .load(&mut conn)
}

// 增
fn create_user(pool: &DbPool, name: &str, email: &str, age: Option<i32>) -> QueryResult<User> {
    use crate::schema::users::dsl::*;
    let mut conn = pool.get()?;
    let new_user = NewUser { name, email, age };
    diesel::insert_into(users)
        .values(&new_user)
        .returning(User::as_returning())
        .get_result(&mut conn)
}

// 改
fn update_user_email(pool: &DbPool, user_id: i64, new_email: &str) -> QueryResult<User> {
    use crate::schema::users::dsl::*;
    let mut conn = pool.get()?;
    diesel::update(users.filter(id.eq(user_id)))
        .set(email.eq(new_email))
        .returning(User::as_returning())
        .get_result(&mut conn)
}

// 删
fn delete_user(pool: &DbPool, user_id: i64) -> QueryResult<usize> {
    use crate::schema::users::dsl::*;
    let mut conn = pool.get()?;
    diesel::delete(users.filter(id.eq(user_id)))
        .execute(&mut conn)
}
```

### 15.3.4 Diesel 对比 SQLx

| 对比维度 | Diesel | SQLx |
|----------|--------|------|
| 性质 | ORM + 查询构建器 | SQL 驱动 + 查询宏 |
| 异步支持 | 实验性（2.x async） | 原生异步 |
| SQL 控制 | 通过构建器，自动生成 | 手写原始 SQL |
| 编译期检查 | Schema 变更后需重新编译 | `query!` 宏连接数据库检查 |
| 学习曲线 | 陡峭（需要了解 DSL 和生命周期） | 中等 |
| 迁移工具 | 内置 CLI | 内置 CLI |
| 连接池 | r2d2（需额外配置） | 内置连接池 |

---

## 15.4 SeaORM 框架

[SeaORM](https://www.sea-ql.org/SeaORM/) 是一个异步 ORM，使用 ActiveRecord 风格，底层支持 SQLx 和 Diesel 的迁移引擎。

### 15.4.1 项目配置

```toml
[dependencies]
sea-orm = { version = "1", features = [
    "sqlx-postgres", "runtime-tokio-rustls", "macros"
] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
```

```bash
# 安装 SeaORM CLI
cargo install sea-orm-cli

# 从数据库生成实体代码
sea-orm-cli generate entity -o src/entity

# 创建迁移
sea-orm-cli migrate generate create_users_table
```

### 15.4.2 实体定义

```rust
// src/entity/user.rs
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub name: String,
    pub email: String,
    pub age: Option<i32>,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::post::Entity")]
    Post,
}

impl ActiveModelBehavior for ActiveModel {}
```

### 15.4.3 基本操作

```rust
use sea_orm::*;
use entity::{user, post};

// 初始化数据库连接
async fn init_db() -> Result<DatabaseConnection, DbErr> {
    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL 未设置");
    Database::connect(db_url).await
}

// CRUD 操作
async fn crud_examples(db: &DatabaseConnection) -> Result<(), DbErr> {
    // 1. 插入
    let new_user = user::ActiveModel {
        name: Set("Alice".to_owned()),
        email: Set("alice@example.com".to_owned()),
        age: Set(Some(28)),
        ..Default::default()
    };
    let user = new_user.insert(db).await?;
    println!("创建用户 ID: {}", user.id);

    // 2. 查询
    let user = user::Entity::find_by_id(user.id)
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound("用户不存在".into()))?;
    println!("查询用户: {}", user.name);

    // 3. 更新
    let mut active: user::ActiveModel = user.into();
    active.email = Set("new-email@example.com".to_owned());
    let updated = active.update(db).await?;

    // 4. 条件查询
    let adults = user::Entity::find()
        .filter(user::Column::Age.is_not_null())
        .filter(user::Column::Age.gte(18))
        .order_by_asc(user::Column::Id)
        .all(db)
        .await?;

    // 5. 分页
    let page = 1;
    let per_page = 10;
    let paginator = user::Entity::find()
        .order_by_asc(user::Column::Id)
        .paginate(db, per_page);
    let total_pages = paginator.num_pages().await?;
    let users_page = paginator.fetch_page(page - 1).await?;

    // 6. 删除
    user::Entity::delete_by_id(updated.id)
        .exec(db)
        .await?;

    Ok(())
}

// 事务
async fn transactional_insert(db: &DatabaseConnection) -> Result<(), DbErr> {
    let txn = db.begin().await?;

    let user = user::ActiveModel {
        name: Set("Bob".to_owned()),
        email: Set("bob@example.com".to_owned()),
        ..Default::default()
    };
    user.insert(&txn).await?;

    txn.commit().await?;
    Ok(())
}
```

---

## 15.5 Redis 客户端（redis-rs）

[redis-rs](https://github.com/redis-rs/redis-rs) 是 Rust 的官方 Redis 客户端，支持同步和异步操作。

### 15.5.1 基础配置

```toml
[dependencies]
redis = { version = "0.27", features = ["tokio-comp", "connection-manager"] }
```

```rust
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use std::time::Duration;

// 异步连接管理器（自动重连，连接池管理）
async fn init_redis() -> Result<ConnectionManager, redis::RedisError> {
    let client = redis::Client::open("redis://127.0.0.1:6379/")?;
    let manager = ConnectionManager::new(client).await?;
    Ok(manager)
}
```

### 15.5.2 常用操作

```rust
use redis::AsyncCommands;

async fn redis_operations(conn: &mut ConnectionManager) -> Result<(), redis::RedisError> {
    // 1. 字符串 (String)
    conn.set("key", "value").await?;
    let val: String = conn.get("key").await?;

    // 设置过期时间
    conn.set_ex("session:token:abc", "user_id_123", 3600).await?; // 1小时过期

    // 2. 列表 (List)
    conn.rpush("queue", "job1").await?;
    conn.rpush("queue", "job2").await?;
    let job: Option<String> = conn.lpop("queue", None).await?;

    // 3. 集合 (Set)
    conn.sadd("tags:rust", "async").await?;
    conn.sadd("tags:rust", "web").await?;
    let members: Vec<String> = conn.smembers("tags:rust").await?;

    // 4. 哈希 (Hash)
    conn.hset("user:100", "name", "Alice").await?;
    conn.hset("user:100", "age", 28).await?;
    let name: String = conn.hget("user:100", "name").await?;

    // 5. 有序集合 (Sorted Set)
    conn.zadd("leaderboard", "player1", 100.0).await?;
    conn.zadd("leaderboard", "player2", 200.0).await?;
    let top: Vec<String> = conn.zrevrange("leaderboard", 0, 9).await?;

    // 6. 原子递增
    let count: i64 = conn.incr("page_views", 1).await?;

    // 7. 批量操作（Pipeline）
    // 使用 pipeline 减少网络往返
    redis::pipe()
        .set("key1", "value1")
        .set("key2", "value2")
        .incr("counter", 1)
        .expire("key1", 60)
        .query_async(conn)
        .await?;

    Ok(())
}
```

### 15.5.3 分布式锁

```rust
use redis::AsyncCommands;
use uuid::Uuid;
use std::time::Duration;

/// 基于 Redis 的分布式锁
async fn acquire_lock(
    conn: &mut ConnectionManager,
    lock_name: &str,
    ttl_secs: u64,
) -> Result<Option<String>, redis::RedisError> {
    let lock_key = format!("lock:{}", lock_name);
    let lock_value = Uuid::new_v4().to_string();

    // SET NX EX：仅在键不存在时设置，并附带过期时间
    let acquired: bool = conn
        .set_nx(lock_key.clone(), &lock_value)
        .await?;

    if acquired {
        conn.expire(lock_key, ttl_secs as i64).await?;
        Ok(Some(lock_value))
    } else {
        Ok(None)
    }
}

async fn release_lock(
    conn: &mut ConnectionManager,
    lock_name: &str,
    lock_value: &str,
) -> Result<(), redis::RedisError> {
    let lock_key = format!("lock:{}", lock_name);

    // 使用 Lua 脚本确保原子性：只删除自己持有的锁
    let script = redis::Script::new(
        r#"
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
        "#,
    );

    script.key(lock_key).arg(lock_value).invoke_async(conn).await?;
    Ok(())
}
```

> **💡 提示**：分布式锁要特别注意锁的超时时间（TTL）设置。持有锁的业务操作时间应远小于 TTL。对于无法预知执行时间的操作，可考虑使用 Redlock 算法或 etcd 替代方案。

---

## 15.6 连接池管理与调优

### 15.6.1 多数据源架构

```rust
#[derive(Clone)]
struct MultiDbState {
    // 读写主库
    primary: sqlx::PgPool,
    // 只读从库（多个做负载均衡）
    replicas: Vec<sqlx::PgPool>,
    // Redis 缓存
    redis: redis::aio::ConnectionManager,
}

impl MultiDbState {
    fn get_replica(&self) -> &sqlx::PgPool {
        use std::time::{SystemTime, UNIX_EPOCH};
        let idx = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as usize
            % self.replicas.len();
        &self.replicas[idx]
    }
}
```

### 15.6.2 连接池监控指标

```rust
use sqlx::PgPool;
use std::time::Instant;

struct PoolMetrics {
    pool: PgPool,
    snapshot_time: Instant,
}

impl PoolMetrics {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            snapshot_time: Instant::now(),
        }
    }

    fn report(&self) -> PoolStats {
        let options = self.pool.options();
        PoolStats {
            max_size: options.max_connections(),
            min_size: options.min_connections(),
            acquired: self.pool.size() as u32,          // 当前活跃连接
            idle: self.pool.num_idle() as u32,          // 空闲连接数
            // connection_timeout: options.acquire_timeout(),
        }
    }
}

#[derive(Debug)]
struct PoolStats {
    max_size: u32,
    min_size: u32,
    acquired: u32,
    idle: u32,
}
```

---

## 15.7 数据库迁移

### 15.7.1 SQLx 迁移

```bash
# 创建迁移
sqlx migrate add create_users_table

# 生成的文件: migrations/20240101000001_create_users_table.sql
```

```sql
-- migrations/20240101000001_create_users_table.sql
-- up: 应用迁移
CREATE TABLE users (
    id       BIGSERIAL PRIMARY KEY,
    name     VARCHAR(255) NOT NULL,
    email    VARCHAR(255) NOT NULL UNIQUE,
    age      INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- down: 回滚迁移
DROP TABLE IF EXISTS users;
```

```rust
// 代码中运行迁移
use sqlx::migrate::Migrator;
use std::path::Path;

async fn run_migrations(pool: &sqlx::PgPool) {
    let migrator = Migrator::new(Path::new("./migrations"))
        .await
        .expect("加载迁移文件失败");

    migrator.run(pool).await.expect("运行迁移失败");
    println!("数据库迁移完成");
}
```

### 15.7.2 迁移最佳实践

| 原则 | 说明 |
|------|------|
| **单向向前** | 迁移文件一旦提交就不应修改，新的变更新建文件 |
| **幂等运行** | 确保迁移可以安全地重复运行（使用 `IF NOT EXISTS`） |
| **小而专一** | 每个迁移只做一件事，便于回滚和定位问题 |
| **数据迁移分离** | Schema 变更与数据迁移分开文件 |
| **生产前测试** | 迁移必须在 staging 环境验证后再上生产 |

---

## 15.8 缓存策略

### 15.8.1 旁路缓存（Cache-Aside）

```rust
use serde::{Serialize, Deserialize};

// 缓存旁路模式：先查缓存，未命中则查 DB 并回填
async fn get_user_cached(
    db: &sqlx::PgPool,
    redis: &mut redis::aio::ConnectionManager,
    user_id: i64,
) -> Result<User, AppError> {
    let cache_key = format!("user:{}", user_id);

    // 1. 尝试从缓存获取
    let cached: Option<String> = redis.get(&cache_key).await.unwrap_or(None);
    if let Some(json_str) = cached {
        let user: User = serde_json::from_str(&json_str).unwrap();
        return Ok(user);
    }

    // 2. 缓存未命中，查数据库
    let user = get_user_from_db(db, user_id).await?;

    // 3. 回填缓存（设置 TTL）
    let json_str = serde_json::to_string(&user).unwrap();
    let _: () = redis.set_ex(&cache_key, json_str, 3600).await.unwrap();

    Ok(user)
}
```

### 15.8.2 缓存穿透/击穿/雪崩

```rust
// 缓存穿透防护：布隆过滤器或缓存空值
async fn get_user_with_null_guard(
    db: &sqlx::PgPool,
    redis: &mut redis::aio::ConnectionManager,
    user_id: i64,
) -> Result<Option<User>, AppError> {
    let cache_key = format!("user:{}", user_id);

    // 1. 查缓存
    if let Some(user) = get_from_cache::<User>(redis, &cache_key).await? {
        return Ok(Some(user));
    }

    // 2. 检查是否是已知不存在的键（缓存空值标记）
    let null_key = format!("null:{}", cache_key);
    if redis.exists(&null_key).await.unwrap_or(false) {
        return Ok(None);
    }

    // 3. 查数据库（加互斥锁防止缓存击穿）
    let lock_key = format!("lock:{}", user_id);
    let _guard = acquire_lock(redis, &lock_key, 10).await?;

    // 双重检查
    if let Some(user) = get_from_cache::<User>(redis, &cache_key).await? {
        return Ok(Some(user));
    }

    match get_user_from_db(db, user_id).await? {
        Some(user) => {
            set_cache(redis, &cache_key, &user, 3600).await?;
            Ok(Some(user))
        }
        None => {
            // 缓存空值（短 TTL，防止穿透）
            let _: () = redis.set_ex(&null_key, "1", 120).await.unwrap();
            Ok(None)
        }
    }
}
```

**缓存问题及解决方案：**

| 问题 | 现象 | 解决方案 |
|------|------|----------|
| **穿透** | 查询不存在的数据，每次都穿透到 DB | 缓存空值 / 布隆过滤器 |
| **击穿** | 热点 key 过期，大量请求同时打到 DB | 互斥锁 / 热点 key 永不过期 + 异步更新 |
| **雪崩** | 大量 key 同一时间过期，DB 压力暴增 | 过期时间加随机值 / 多级缓存 |
| **一致性** | DB 更新后缓存仍是旧数据 | Cache-Aside + 延迟双删 / CDC |
| **大 Key** | 单个 value 过大（>10KB） | 拆分存储 / 压缩后存储 |

### 15.8.3 使用 TTL 随机化防雪崩

```rust
use rand::Rng;

fn compute_ttl(base_ttl: u64) -> u64 {
    // 基础 TTL ± 20% 随机偏移
    let offset = (base_ttl as f64 * 0.2) as u64;
    let random_offset = rand::thread_rng().gen_range(0..=offset);
    base_ttl + random_offset
}

// 设置缓存时使用随机 TTL
async fn set_cache_with_jitter<T: Serialize>(
    redis: &mut redis::aio::ConnectionManager,
    key: &str,
    value: &T,
    base_ttl: u64,
) -> Result<(), redis::RedisError> {
    let json_str = serde_json::to_string(value).unwrap();
    let ttl = compute_ttl(base_ttl);
    redis.set_ex(key, json_str, ttl as i64).await?;
    Ok(())
}
```

---

## 15.9 数据库类型映射

| Rust 类型 | PostgreSQL | MySQL | SQLite |
|-----------|-----------|-------|--------|
| `i32` | `INTEGER` | `INT` | `INTEGER` |
| `i64` | `BIGINT` | `BIGINT` | `INTEGER` |
| `f64` | `DOUBLE PRECISION` | `DOUBLE` | `REAL` |
| `String` | `VARCHAR` / `TEXT` | `VARCHAR` / `TEXT` | `TEXT` |
| `bool` | `BOOLEAN` | `TINYINT(1)` | `INTEGER` |
| `Vec<u8>` | `BYTEA` | `BLOB` | `BLOB` |
| `chrono::NaiveDateTime` | `TIMESTAMP` | `DATETIME` | `TEXT` |
| `chrono::DateTime<Utc>` | `TIMESTAMPTZ` | `DATETIME` | `TEXT` |
| `uuid::Uuid` | `UUID` | `VARCHAR(36)` | `TEXT` |
| `serde_json::Value` | `JSONB` | `JSON` | `TEXT` |
| `Option<T>` | `T`（可为 NULL） | `T`（可为 NULL） | `T`（可为 NULL） |

---

## 15.10 本章小结

| 库 | 最佳使用场景 |
|---|-------------|
| **SQLx** | 需要异步、编译期 SQL 检查、精确控制 SQL 的项目 |
| **Diesel** | 传统 CRUD 应用，偏好类型安全查询构建器 |
| **SeaORM** | 需要迁移工具、ActiveRecord 风格的快速开发 |
| **redis-rs** | 缓存、Session 存储、消息队列、分布式锁 |
| **连接池** | 按 CPU 核数、数据库规格合理配置，做好监控 |
| **缓存策略** | Cache-Aside 为主流，注意穿透/击穿/雪崩防护 |
| **迁移** | 单向向前，小而专一，生产前充分测试 |

> **💡 下一步**：掌握数据库与缓存技术后，接下来学习第16章——命令行工具开发，用 Rust 构建高效实用的 CLI 程序。
