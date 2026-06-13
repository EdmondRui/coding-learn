# Python 数据库高级操作

> 适用人群：掌握 Python 基础、熟悉基础 SQL 的开发者
> 核心主题：ORM 进阶、异步数据库、连接池、迁移与查询优化

---

## 1. SQLAlchemy 2.0 核心进阶

SQLAlchemy 2.0 是一次重大版本更新，统一了查询接口，全面拥抱 `asyncio`，并为声明式映射引入了更 Pythonic 的写法。

### 1.1 声明式映射（Declarative Mapping）

2.0 版推荐的声明式写法不再需要 `declarative_base()`，而是直接继承 `DeclarativeBase`：

```python
from sqlalchemy import create_engine, String, Integer, DateTime, ForeignKey, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from datetime import datetime
from typing import Optional


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(default=True)

    # 双向关系
    posts: Mapped[list["Post"]] = relationship(back_populates="author", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"User(id={self.id}, name={self.name!r})"


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(128))
    body: Mapped[str] = mapped_column(Text)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    author: Mapped["User"] = relationship(back_populates="posts")
```

**核心变化**：`Mapped[T]` 类型注解替代了旧版 `Column` 的字符串声明，mypy/pyright 可以获得完整的类型推断。

### 1.2 Dataclass 映射

如果你更喜欢 `dataclass` 风格，SQLAlchemy 2.0 提供了 `MappedAsDataclass` 混入类：

```python
from sqlalchemy.orm import MappedAsDataclass


class User(MappedAsDataclass, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True, init=False)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    email: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow, init=False)
    is_active: Mapped[bool] = mapped_column(default=True, init=False)

    posts: Mapped[list["Post"]] = relationship(back_populates="author", default_factory=list, init=False)
```

声明之后，`User(name="alice", email="a@b.com")` 可以直接以关键字参数构造，**无需**调用 `session.add()` 前先构造（但持久化仍需 session）。

### 1.3 关系加载策略

关系加载方式直接影响查询性能。SQLAlchemy 支持以下加载策略：

| 策略 | 特点 | 适用场景 |
|------|------|----------|
| `lazy=True` | 首次访问时发出 SQL | 小数据量，不确定是否使用关系 |
| `selectin` | 通过 `WHERE pk IN (...)` 批量加载 | 多数场景下的最优选择 |
| `subquery` | 通过子查询一次加载 | 需要对关系进行排序/分页时 |
| `joined` | LEFT JOIN 一次性加载 | 确信一定会访问关系时 |

**配置方式**（三种等价写法）：

```python
# 1. 在 relationship 定义时指定
class User(Base):
    __tablename__ = "users"
    # ...
    posts: Mapped[list["Post"]] = relationship(back_populates="author", lazy="selectin")

# 2. 在查询时动态指定
from sqlalchemy.orm import selectinload

stmt = select(User).options(selectinload(User.posts))
users = session.execute(stmt).scalars().all()
# 访问 user.posts 时不再触发额外 SQL

# 3. 全局配置 Session
from sqlalchemy.orm import Session

session = Session(engine, expire_on_commit=False)
```

**实践建议**：不要将 `lazy` 硬编码在模型里。在 repository / DAO 层使用 `options()` 按需指定，保持模型定义纯粹。

### 1.4 异步引擎（Async Engine）

SQLAlchemy 2.0 的异步支持通过 `create_async_engine` 和 `AsyncSession` 实现，底层依赖 `greenlet` 和 `anyio`：

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

# URI 前缀必须改为 async driver
ASYNC_DB_URL = "postgresql+asyncpg://user:pass@localhost:5432/mydb"

async_engine = create_async_engine(ASYNC_DB_URL, echo=False, pool_size=10)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)


async def get_user_by_id(user_id: int) -> User | None:
    async with AsyncSessionLocal() as session:
        stmt = select(User).where(User.id == user_id)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()


async def create_user(name: str, email: str) -> User:
    async with AsyncSessionLocal() as session:
        user = User(name=name, email=email)
        session.add(user)
        await session.commit()
        await session.refresh(user)  # 获取数据库端生成的值
        return user
```

> ⚠️ **注意**：异步 session 中的 `scalars()`、`execute()` 等都需要 `await`。模型定义本身与同步版本完全一致。

---

## 2. 异步数据库驱动

### 2.1 主流异步驱动选型

| 数据库 | 异步驱动 | 底层库 | 特点 |
|--------|----------|--------|------|
| PostgreSQL | `asyncpg` | 纯 Python + C 扩展 | 性能极高，独立于 SQLAlchemy |
| MySQL / MariaDB | `aiomysql` / `asyncmy` | pymysql / C 扩展 | `asyncmy` 性能更优 |
| SQLite | `aiosqlite` | 标准库 `sqlite3` 封装 | 单文件，适合开发/测试 |

### 2.2 连接池配置

无论使用哪种驱动，连接池都是异步编程的关键配置：

```python
from sqlalchemy.ext.asyncio import create_async_engine

engine = create_async_engine(
    "postgresql+asyncpg://user:pass@localhost:5432/mydb",
    echo=False,
    pool_size=20,          # 池中维持的连接数
    max_overflow=10,        # 池满后额外创建的上限
    pool_timeout=30,        # 等待池连接的超时秒数
    pool_recycle=1800,      # 连接最大存活时间（秒），防止 DB 断开
    pool_pre_ping=True,     # 每次取连接前 ping 检测健康
)
```

**关键参数解读**：
- `pool_size` + `max_overflow` = **数据库侧允许的最大连接数**
- `pool_recycle` 建议设为 **小于数据库 `wait_timeout`** 的值（MySQL 默认 28800 秒，建议 3600）
- `pool_pre_ping=True` 在连接复用前执行轻量 `SELECT 1`，避免使用已断开的连接

### 2.3 异步事务管理

```python
async def transfer_funds(session: AsyncSession, from_id: int, to_id: int, amount: float) -> None:
    async with session.begin():  # 自动 commit / rollback
        sender = await session.get(User, from_id, with_for_update=True)
        receiver = await session.get(User, to_id, with_for_update=True)

        if sender.balance < amount:
            raise ValueError("余额不足")

        sender.balance -= amount
        receiver.balance += amount
```

`session.begin()` 是 2.0 推荐的上下文管理器写法。异常时会自动 `rollback`，正常退出时 `commit`。

### 2.4 不使用 ORM 的原生异步查询

有时 ORM 的开销是多余的，可以直接使用底层 async driver：

```python
import asyncpg
from typing import AsyncGenerator

DATABASE_URL = "postgresql://user:pass@localhost:5432/mydb"


async def fetch_many() -> AsyncGenerator[dict, None]:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # 预处理语句，避免 SQL 注入
        stmt = await conn.prepare("SELECT id, name, email FROM users WHERE is_active = $1")
        # 游标式逐行读取，适合大数据量
        async for row in stmt.cursor(True):
            yield dict(row)
    finally:
        await conn.close()
```

当查询逻辑简单、不需要 ORM 的 identity map 和 dirty tracking 时，原生驱动性能更好，延迟更低。

---

## 3. 连接池与性能

### 3.1 连接池原理

数据库连接池维护一组 TCP 连接，应用程序从中**借出**使用，用后**归还**，避免为每个请求创建/销毁连接的高昂成本。SQLAlchemy 默认使用 `QueuePool`，内部基于 `threading.Condition` 实现。

基本生命周期：

```
应用请求连接 → 池有空闲 → 直接返回
              → 池已满且未达上限 → 创建新连接
              → 池已满且达上限 → 阻塞等待 (pool_timeout)
              → 超时 → 抛出 TimeoutError
```

### 3.2 池大小调优

最佳连接数的计算没有银弹，但有一个经验公式：

> **连接数 = (CPU 核数 × 2) + 有效磁盘数**

对于 IO 密集型的 Web 应用，这个值通常偏小。更实际的方法是通过**负载测试**找到拐点。

```python
# 使用不同的 pool_size 做对比测试
for pool_size in [5, 10, 20, 50]:
    engine = create_async_engine(
        DB_URL,
        pool_size=pool_size,
        max_overflow=pool_size // 2,  # 通常为 pool_size 的 50%
    )
    # 运行压测，记录 TPS 和 P99 延迟
```

**重要原则**：
- 连接数并非越多越好。超过 PostgreSQL 的 `max_connections`（默认 100）后，性能急剧下降。
- 每个 Web worker 进程应有独立的连接池，避免多进程共享同一池。
- 使用 `uvicorn` 等 ASGI 服务器时，注意 `workers > 1` 会启动多进程。

### 3.3 连接泄漏检测

连接泄漏的典型表现：应用运行一段时间后，数据库连接耗尽，请求超时。

```python
from sqlalchemy import event
from sqlalchemy.engine import Engine
import weakref
import traceback

# 全局追踪：记录每个连接的创建堆栈
_connections = weakref.WeakSet()


@event.listens_for(Engine, "connect")
def on_connect(dbapi_connection, connection_record):
    _connections.add(dbapi_connection)
    connection_record.info["traceback"] = "".join(
        traceback.format_stack()[-10:-1]
    )


@event.listens_for(Engine, "checkout")
def on_checkout(dbapi_connection, connection_record, connection_proxy):
    if dbapi_connection not in _connections:
        print(f"[WARN] 连接泄漏检测: {connection_record.info.get('traceback')}")
```

更简单的方式：设置 `pool_size` 并在代码关键路径上打印 `engine.pool.status()`：

```python
print(engine.pool.status())
# 输出: Pool(size=10, overflow=2, checkedin=8, checkedout=4)
```

如果 `checkedout` 持续增长且不回落，说明存在泄漏。

### 3.4 长事务处理

长事务会持有连接、锁资源和 MVCC 快照，是数据库性能的常见杀手。

```python
# ❌ 避免：在事务中做耗时操作
async with session.begin():
    user = await session.get(User, user_id)
    user.name = new_name
    await call_slow_external_api()  # 长事务！
    await session.flush()

# ✅ 推荐：先提交事务，再做外部调用
async with session.begin():
    user = await session.get(User, user_id)
    user.name = new_name

await call_slow_external_api()
# 此时事务已结束，连接已归还
```

**识别长事务**（PostgreSQL）：

```sql
-- 查看运行超过 5 秒的事务
SELECT pid, now() - xact_start AS duration, state, query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
   OR (state = 'active' AND now() - xact_start > interval '5 seconds')
ORDER BY duration DESC;
```

---

## 4. 数据库迁移（Alembic 进阶）

### 4.1 初始化与基本配置

```bash
alembic init alembic
```

编辑 `alembic.ini`：

```ini
sqlalchemy.url = postgresql+asyncpg://user:pass@localhost:5432/mydb
```

编辑 `alembic/env.py`，指向你的模型：

```python
from myapp.models import Base

target_metadata = Base.metadata
```

### 4.2 编写自定义迁移脚本

Alembic 自动生成的脚本可以满足大部分场景，但以下情况需要手动干预：

```python
"""add user roles enum

Revision ID: a1b2c3d4e5f6
Revises: previous_revision
Create Date: 2026-06-12 10:00:00
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "a1b2c3d4e5f6"
down_revision = "previous_revision"


def upgrade() -> None:
    # 创建枚举类型
    op.execute("CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer')")

    # 添加列（使用 postgresql 方言的 USING 转换）
    op.add_column("users", sa.Column("role", sa.String(32), nullable=True))
    op.execute("UPDATE users SET role = 'viewer'")
    op.alter_column("users", "role", nullable=False, type_=sa.Enum("admin", "editor", "viewer", name="user_role"))
    op.execute("ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::user_role")

    # 创建索引
    op.create_index("idx_users_role", "users", ["role"])


def downgrade() -> None:
    op.drop_index("idx_users_role")
    op.drop_column("users", "role")
    op.execute("DROP TYPE user_role")
```

### 4.3 数据迁移 vs 结构迁移

| 类型 | 内容 | 自动生成 | 回滚 |
|------|------|----------|------|
| **结构迁移** | DDL — 建表、加列、加索引 | ✅ | ✅ |
| **数据迁移** | DML — 数据清洗、格式转换 | ❌ | 需手动写 |

**数据迁移示例**：将用户名从全名改为名/姓分离

```python
"""split full_name into first_name and last_name

Revision ID: b2c3d4e5f6a1
"""
import sqlalchemy as sa
from alembic import op


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(64), nullable=True))

    # 数据迁移：分割已有的 full_name
    connection = op.get_bind()
    connection.execute(
        sa.text("""
            UPDATE users
            SET first_name = SPLIT_PART(full_name, ' ', 1),
                last_name = SUBSTRING(full_name FROM POSITION(' ' IN full_name) + 1)
            WHERE full_name IS NOT NULL
        """)
    )

    op.alter_column("users", "first_name", nullable=False)
    op.alter_column("users", "last_name", nullable=False)
    op.drop_column("users", "full_name")


def downgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(128)))
    connection = op.get_bind()
    connection.execute(
        sa.text("UPDATE users SET full_name = first_name || ' ' || last_name")
    )
    op.drop_column("users", "first_name")
    op.drop_column("users", "last_name")
```

> 数据迁移**不可逆**的情况很常见（如删除列时数据丢失），务必在 `downgrade()` 中做好注释。

### 4.4 多环境管理

通过 Alembic 的 `-x` 参数传递自定义选项：

```python
# alembic/env.py
import os

ENVIRON = os.getenv("ALEMBIC_ENV", "development")

if ENVIRON == "production":
    from myapp.config_prod import DB_URL
elif ENVIRON == "staging":
    from myapp.config_staging import DB_URL
else:
    from myapp.config_dev import DB_URL  # SQLite 本地开发

config.set_main_option("sqlalchemy.url", DB_URL)
```

执行时指定环境：

```bash
ALEMBIC_ENV=production alembic upgrade head
ALEMBIC_ENV=development alembic upgrade head
```

---

## 5. 查询优化

### 5.1 索引策略

**三种常见索引及适用场景**：

```sql
-- B-tree 索引（默认）：适合精确匹配和范围查询
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_created ON users (created_at DESC);

-- 复合索引：最左前缀原则，将选择性高的列放在前面
CREATE INDEX idx_users_role_created ON users (role, created_at DESC);

-- 部分索引：只索引满足条件的行，节约空间
CREATE INDEX idx_active_users ON users (created_at) WHERE is_active = TRUE;

-- 覆盖索引（PostgreSQL）：通过 INCLUDE 避免回表
CREATE INDEX idx_users_email_cover ON users (email) INCLUDE (name, avatar_url);
```

**用 EXPLAIN 验证索引是否被使用**：

```sql
EXPLAIN ANALYZE
SELECT id, name, email FROM users
WHERE email = 'alice@example.com' AND is_active = TRUE;
```

在 Python 中自动获取执行计划：

```python
from sqlalchemy import text


async def explain(session, stmt):
    """获取查询执行计划"""
    raw_sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    result = await session.execute(text(f"EXPLAIN ANALYZE {raw_sql}"))
    for row in result:
        print(row[0])
```

### 5.2 慢查询分析

**步骤一：开启数据库慢查询日志**

```ini
# postgresql.conf
log_min_duration_statement = 200    # 记录超过 200ms 的查询
log_duration = on
log_statement = 'ddl'
```

```ini
# my.cnf for MySQL
slow_query_log = ON
long_query_time = 0.2
slow_query_log_file = /var/log/mysql/slow.log
```

**步骤二：SQLAlchemy 端记录慢查询**

```python
import logging
from time import perf_counter
from sqlalchemy import event
from sqlalchemy.engine import Engine


@event.listens_for(Engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    conn.info.setdefault("query_start_time", []).append(perf_counter())


@event.listens_for(Engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    total = perf_counter() - conn.info["query_start_time"].pop()
    if total > 0.5:  # 超过 500ms 认为是慢查询
        logging.warning(
            "慢查询 (%.2fs): %s\n参数: %s", total, statement[:200], parameters
        )
```

### 5.3 N+1 问题

N+1 问题是 ORM 最常见的性能陷阱：查询主记录的 1 条 SQL 之后，又为每条记录的关联数据发出 N 条 SQL。

```python
# ❌ N+1：循环中访问关系触发反复查询
users = session.execute(select(User)).scalars().all()
for user in users:
    print(user.name, [post.title for post in user.posts])  # 每个 user 触发一次 SQL!

# ✅ 方案一：selectinload（推荐）
from sqlalchemy.orm import selectinload

stmt = select(User).options(selectinload(User.posts))
users = session.execute(stmt).scalars().all()

# ✅ 方案二：joindload（使用 JOIN）
from sqlalchemy.orm import joinedload

stmt = select(User).options(joinedload(User.posts))
# 注意：joinedload 会改变结果集的去重逻辑，通常配合 distinct() 使用

# ✅ 方案三：手动批量加载
users = session.execute(select(User)).scalars().all()
user_ids = [u.id for u in users]
posts = session.execute(
    select(Post).where(Post.user_id.in_(user_ids))
).scalars().all()
# 手动分组
from itertools import groupby
grouped = {uid: list(grp) for uid, grp in groupby(posts, key=lambda p: p.user_id)}
for user in users:
    user._cached_posts = grouped.get(user.id, [])
```

**检测 N+1**：开启 SQLAlchemy 的 `echo=True` 或使用 `carotte` / `sqlalchemy-watch` 等第三方工具自动统计查询次数。

### 5.4 批量操作优化

逐条插入在 ORM 中是非常慢的：

```python
# ❌ 逐条插入（慢！）
for i in range(1000):
    session.add(User(name=f"user_{i}", email=f"user_{i}@test.com"))
session.commit()
# 发出 1000 次 INSERT + 1 次 COMMIT

# ✅ 批量插入（快 10-50x）
session.add_all([
    User(name=f"user_{i}", email=f"user_{i}@test.com")
    for i in range(1000)
])
session.commit()
# 发出 1 次批量 INSERT + 1 次 COMMIT

# ✅ 使用 bulk_insert_mappings（最快，但跳过 ORM 事件）
from sqlalchemy.dialects.postgresql import insert as pg_insert

bulk_data = [
    {"name": f"user_{i}", "email": f"user_{i}@test.com", "is_active": True}
    for i in range(1000)
]
session.execute(pg_insert(User), bulk_data)
session.commit()
# 不走 ORM 生命周期，适合纯数据导入
```

**批量更新与删除**：

```python
# 批量更新 —— 使用一条 UPDATE 替代多次 session.get + 赋值
session.execute(
    update(User).where(User.is_active == False).values(is_active=True)
)

# 批量删除 —— 使用 WHERE IN 替代逐条 delete
session.execute(
    delete(User).where(User.id.in_([1, 2, 3]))
)

session.commit()
```

### 5.5 分页优化

**传统 offset/limit 分页的问题**：越往后翻越慢，因为数据库需要扫描并丢弃之前的行。

```python
# ❌ 深翻页问题
for page in range(1, 1001):
    stmt = select(Post).order_by(Post.id).offset(page * 20).limit(20)
    # 第 1000 页需要扫描 20000 行后再丢掉 19980 行
```

**优化方案**：

```python
# ✅ 方案一：keyset pagination（游标分页）
async def get_posts_cursor(session, last_id: int = 0, limit: int = 20):
    stmt = (
        select(Post)
        .where(Post.id > last_id)       # 利用 B-tree 索引直接定位
        .order_by(Post.id)
        .limit(limit)
    )
    result = await session.execute(stmt)
    posts = result.scalars().all()
    next_cursor = posts[-1].id if posts else None
    return posts, next_cursor

# 调用方式
page1, cursor = await get_posts_cursor(session, last_id=0)
page2, cursor = await get_posts_cursor(session, last_id=cursor)

# ✅ 方案二：基于时间戳的分页
stmt = (
    select(Post)
    .where(Post.created_at < cursor_timestamp)
    .order_by(Post.created_at.desc())
    .limit(20)
)
```

**Keyset pagination 的限制**：
- 无法直接跳转到任意页（如"第 100 页"）
- 不适合需要随机翻页的 UI（如后台管理列表）
- 对排序字段要求唯一（或组合唯一），否则会丢失数据

对于需要随机跳转的场景，可以使用 **覆盖索引 + SEARCH 优化**：

```sql
-- 建立覆盖索引让 offset 扫描只走索引，不回表
CREATE INDEX idx_posts_page ON posts (id) INCLUDE (title, created_at);
```

---

## 实战：综合示例

将上述知识点整合为一个异步数据访问层：

```python
from typing import Protocol
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession


class Repository[T](Protocol):
    """通用仓储接口"""

    async def get(self, id: int) -> T | None: ...

    async def list(self, **filters) -> list[T]: ...

    async def create(self, **data) -> T: ...

    async def update(self, id: int, **data) -> T | None: ...

    async def delete(self, id: int) -> bool: ...


class UserRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, user_id: int) -> User | None:
        return await self.session.get(User, user_id)

    async def list_active(self, offset: int = 0, limit: int = 20) -> list[User]:
        stmt = (
            select(User)
            .where(User.is_active == True)
            .options(selectinload(User.posts))
            .order_by(User.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(self, name: str, email: str) -> User:
        user = User(name=name, email=email)
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return user

    async def bulk_deactivate(self, user_ids: list[int]) -> int:
        result = await self.session.execute(
            update(User)
            .where(User.id.in_(user_ids))
            .values(is_active=False)
        )
        await self.session.commit()
        return result.rowcount
```

---

## 推荐工具与阅读

| 工具 | 用途 |
|------|------|
| `alembic` | 数据库迁移 |
| `sqlalchemy-cache` | ORM 查询缓存 |
| `sqlacodegen` | 从已有数据库生成 ORM 模型 |
| `sanic/dev/slow-query-detector` | 慢查询告警 |
| `pg_stat_statements` / `performance_schema` | 数据库内部统计 |

> 在生产环境中，**永远不要信任 ORM 自动生成的 SQL**。始终用 `echo=True` 或数据库日志确认实际执行的查询。对于关键路径，手写 SQL 配合原生驱动往往是更可控的选择。
