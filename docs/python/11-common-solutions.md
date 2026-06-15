# 第 11 章：常见技术解决方案

> 目标读者：有 Python 基础、需要快速查找 Web 开发、数据处理中常见技术方案的开发者。本章提供开箱即用的代码模板和最佳实践。

---

## 11.1 JWT 认证与授权

JWT（JSON Web Token）是目前最流行的无状态认证方案之一。它由三部分组成：Header、Payload、Signature，通过 Base64URL 编码后用 `.` 连接。

### 11.1.1 PyJWT 生成与验证

```python
import jwt
from datetime import datetime, timedelta, timezone
from typing import Any

# 密钥配置（生产环境应从环境变量读取）
SECRET_KEY = "your-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


def create_access_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """生成 JWT access token"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_access_token(token: str) -> dict[str, Any]:
    """验证并解码 JWT token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token 已过期")
    except jwt.InvalidTokenError:
        raise ValueError("无效的 Token")


# 使用示例
if __name__ == "__main__":
    token = create_access_token({"sub": "user_123", "role": "admin"})
    print(f"生成的 Token: {token[:50]}...")

    payload = verify_access_token(token)
    print(f"解析结果: {payload}")
```

### 11.1.2 FastAPI 集成

```python
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from datetime import datetime, timezone, timedelta
from typing import Any

app = FastAPI(title="JWT Auth Demo")
security = HTTPBearer(auto_error=False)

SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"


def create_token(data: dict[str, Any]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=1)
    return jwt.encode({**data, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict[str, Any]:
    """从请求头提取并验证 JWT"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少认证信息",
        )
    try:
        payload = jwt.decode(
            credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 已过期",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的 Token",
        )


@app.post("/login")
def login(username: str, password: str):
    """模拟登录接口"""
    # 实际项目中这里应该验证用户名密码
    if username == "admin" and password == "secret":
        token = create_token({"sub": username, "role": "admin"})
        return {"access_token": token, "token_type": "bearer"}
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")


@app.get("/me")
def read_current_user(user: dict[str, Any] = Depends(get_current_user)):
    """获取当前用户信息"""
    return {"user": user["sub"], "role": user.get("role")}
```

### 11.1.3 权限装饰器

```python
from functools import wraps
from fastapi import HTTPException, status
from typing import Any, Callable


def require_role(*allowed_roles: str) -> Callable:
    """角色权限验证装饰器"""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 从依赖注入中获取当前用户
            user = kwargs.get("current_user") or kwargs.get("user")
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="未认证",
                )
            if user.get("role") not in allowed_roles:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"需要 {'/'.join(allowed_roles)} 权限",
                )
            return func(*args, **kwargs)
        return wrapper
    return decorator


# 使用示例
from fastapi import APIRouter

router = APIRouter()


@router.get("/admin/dashboard")
@require_role("admin")
def admin_dashboard(current_user: dict[str, Any] = Depends(get_current_user)):
    return {"message": f"欢迎管理员 {current_user['sub']}"}


@router.get("/analytics")
@require_role("admin", "analyst")
def view_analytics(current_user: dict[str, Any] = Depends(get_current_user)):
    return {"message": "分析数据仅供管理员和数据分析师查看"}
```

**要点总结：**
- JWT 的 `exp`（过期时间）和 `iat`（签发时间）是标准字段，务必包含
- 生产环境密钥使用 `os.urandom(32).hex()` 生成，通过环境变量注入
- 权限校验建议使用 FastAPI 依赖注入体系而非装饰器，以保持类型提示完整

---

## 11.2 限流（Rate Limiting）

限流是保护 API 不被滥用的核心手段。常见算法包括令牌桶、滑动窗口和漏桶。

### 11.2.1 令牌桶算法

```python
import time
import threading
from collections import deque


class TokenBucket:
    """令牌桶限流器"""

    def __init__(self, rate: float, burst: int):
        """
        rate: 令牌生成速率（个/秒）
        burst: 桶容量（最大突发请求数）
        """
        self.rate = rate
        self.burst = burst
        self.tokens = burst  # 初始满桶
        self.last_refill = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        """补充令牌"""
        now = time.monotonic()
        elapsed = now - self.last_refill
        new_tokens = elapsed * self.rate
        self.tokens = min(self.burst, self.tokens + new_tokens)
        self.last_refill = now

    def consume(self, tokens: int = 1) -> bool:
        """消费令牌，成功返回 True，失败（被限流）返回 False"""
        with self._lock:
            self._refill()
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False


# 使用示例
bucket = TokenBucket(rate=5, burst=10)  # 每秒 5 个，最多突发 10 个

for i in range(20):
    allowed = bucket.consume()
    print(f"请求 {i + 1}: {'✅ 通过' if allowed else '❌ 限流'} [{time.strftime('%H:%M:%S')}]")
    time.sleep(0.05)
```

### 11.2.2 滑动窗口算法

```python
import time
from collections import deque


class SlidingWindow:
    """滑动窗口限流器"""

    def __init__(self, window_size: float, max_requests: int):
        """
        window_size: 窗口大小（秒）
        max_requests: 窗口内允许的最大请求数
        """
        self.window_size = window_size
        self.max_requests = max_requests
        self.requests: deque[float] = deque()

    def allow(self) -> bool:
        """判断当前请求是否允许通过"""
        now = time.monotonic()
        # 移除窗口外的旧请求
        while self.requests and self.requests[0] < now - self.window_size:
            self.requests.popleft()

        if len(self.requests) < self.max_requests:
            self.requests.append(now)
            return True
        return False


# 使用示例
limiter = SlidingWindow(window_size=10, max_requests=3)  # 10 秒内最多 3 次

for i in range(10):
    allowed = limiter.allow()
    print(f"请求 {i + 1}: {'✅' if allowed else '❌'} 窗口内请求数: {len(limiter.requests)}")
    time.sleep(1)
```

### 11.2.3 FastAPI 集成 slowapi

```python
from fastapi import FastAPI, Request
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# 创建限流器
limiter = Limiter(
    key_func=get_remote_address,  # 基于客户端 IP 限流
    default_limits=["100/minute"],  # 全局默认限制
)

app = FastAPI(title="Rate Limiting Demo")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


@app.get("/unlimited")
def unlimited():
    """不限流接口"""
    return {"message": "This endpoint has no rate limit"}


@app.get("/limited")
@limiter.limit("5/minute")  # 每分钟 5 次
def limited(request: Request):
    return {"message": "This endpoint is limited to 5 requests per minute"}


@app.get("/tiered")
@limiter.limit("10/minute;100/hour")  # 多层级限流
def tiered(request: Request):
    return {"message": "10/min and 100/hour limits apply"}
```

**要点总结：**
- 令牌桶允许突发流量，适合大部分 API 场景
- 滑动窗口精度更高，适合严格的频率控制
- slowapi 基于 `limits` 库实现，支持 Redis 后端做分布式限流

---

## 11.3 配置管理

配置管理是应用的基础设施层，好的配置方案让应用在不同环境中无缝切换。

### 11.3.1 pydantic-settings 基础

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, PostgresDsn, RedisDsn
from typing import Optional


class AppConfig(BaseSettings):
    """应用配置 —— 自动从环境变量读取"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # 应用基础
    app_name: str = Field(default="MyApp", alias="APP_NAME")
    debug: bool = Field(default=False, alias="DEBUG")
    secret_key: str = Field(default="change-me", alias="SECRET_KEY")

    # 数据库
    database_url: PostgresDsn = Field(alias="DATABASE_URL")
    redis_url: Optional[RedisDsn] = Field(default=None, alias="REDIS_URL")

    # 第三方
    sentry_dsn: Optional[str] = Field(default=None, alias="SENTRY_DSN")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # 计算字段
    @property
    def is_production(self) -> bool:
        return not self.debug


# 使用示例
config = AppConfig()  # 自动读取 .env 和系统环境变量
print(f"应用: {config.app_name}, 生产环境: {config.is_production}")
print(f"数据库: {config.database_url}")
```

### 11.3.2 .env 文件与多环境配置

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import ClassVar


class BaseConfig(BaseSettings):
    """基础配置"""

    model_config = SettingsConfigDict(env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MyApp"
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"


class DevConfig(BaseConfig):
    """开发环境"""

    model_config = SettingsConfigDict(env_file=".env.dev")

    debug: bool = True
    database_url: str = "sqlite:///dev.db"
    log_level: str = "DEBUG"


class ProdConfig(BaseConfig):
    """生产环境"""

    model_config = SettingsConfigDict(env_file=".env.prod", env_file_encoding="utf-8")

    debug: bool = False
    database_url: str = Field(alias="DATABASE_URL")
    sentry_dsn: str = Field(alias="SENTRY_DSN")
    log_level: str = "INFO"


class TestConfig(BaseConfig):
    """测试环境"""

    model_config = SettingsConfigDict(env_file=None)

    debug: bool = True
    database_url: str = "sqlite:///test.db"
    log_level: str = "DEBUG"


# 工厂函数 —— 根据环境返回对应配置
def load_config(env: str | None = None) -> BaseConfig:
    import os

    env = env or os.getenv("APP_ENV", "development")
    configs = {
        "development": DevConfig,
        "production": ProdConfig,
        "testing": TestConfig,
    }
    config_cls = configs.get(env, DevConfig)
    return config_cls()  # type: ignore


# 使用示例
config = load_config("development")
print(f"环境: {'开发' if config.debug else '生产'}")
print(f"数据库: {config.database_url}")

# 优先级：环境变量 > .env 文件 > 默认值
```

### 11.3.3 配置校验与惰性加载

```python
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from functools import lru_cache


class DatabaseConfig(BaseSettings):
    """数据库相关配置 —— 独立的子配置"""

    host: str = Field(default="localhost", alias="DB_HOST")
    port: int = Field(default=5432, alias="DB_PORT", ge=1, le=65535)
    user: str = Field(alias="DB_USER")
    password: str = Field(alias="DB_PASSWORD")
    database: str = Field(alias="DB_NAME")

    @field_validator("host")
    @classmethod
    def validate_host(cls, v: str) -> str:
        if v == "localhost":
            return v  # 允许本地
        if not v.replace(".", "").replace("-", "").isalnum():
            raise ValueError("无效的数据库主机名")
        return v

    @property
    def url(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"


# 惰性加载配置，避免每次 import 都读取环境变量
@lru_cache
def get_db_config() -> DatabaseConfig:
    return DatabaseConfig()


# 使用示例
db = get_db_config()
print(f"数据库 URL: {db.url}")
```

**要点总结：**
- `pydantic-settings` 自动从环境变量和 `.env` 文件读取配置
- 环境变量优先级高于 `.env` 文件，适合 Docker/K8s 部署
- 使用 `@lru_cache` 实现配置的惰性单例加载

---

## 11.4 结构化日志

结构化日志让日志可搜索、可分析，是生产环境的标配。`structlog` 和 `loguru` 是两个主流选择。

### 11.4.1 structlog 配置

```python
import structlog
import logging
import sys


def setup_structlog(env: str = "development") -> None:
    """配置 structlog"""

    timestamper = structlog.processors.TimeStamper(fmt="iso")

    processors = [
        structlog.contextvars.merge_contextvars,  # 支持上下文变量
        structlog.stdlib.add_log_level,            # 添加日志级别
        structlog.stdlib.add_logger_name,          # 添加日志器名称
        timestamper,                               # 添加时间戳
        structlog.dev.ConsoleRenderer(),           # 开发环境：彩色控制台输出
    ]

    if env == "production":
        processors = [
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            timestamper,
            structlog.processors.format_exc_info,  # 异常堆栈
            structlog.processors.JSONRenderer(),   # 生产环境：JSON 格式
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


# 初始化配置
setup_structlog(env="development")
logger = structlog.get_logger()


# 使用示例
logger.info("服务启动", port=8000, env="dev")
logger.warning("数据库连接池不足", pool_size=5, active_connections=8)

try:
    1 / 0
except ZeroDivisionError:
    logger.exception("发生除零错误", operation="division")
```

### 11.4.2 上下文日志

```python
import structlog
from contextvars import ContextVar

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")
user_id_ctx: ContextVar[str] = ContextVar("user_id", default="")

logger = structlog.get_logger()


class RequestLogger:
    """请求级别上下文日志"""

    def __init__(self, request_id: str, user_id: str = ""):
        self.request_id = request_id
        self.user_id = user_id

    def __enter__(self):
        # 绑定上下文变量
        request_id_ctx.set(self.request_id)
        user_id_ctx.set(self.user_id)
        structlog.contextvars.bind_contextvars(
            request_id=self.request_id,
            user_id=self.user_id,
        )
        logger.info("请求开始")
        return self

    def __exit__(self, *args):
        logger.info("请求结束")
        structlog.contextvars.unbind_contextvars("request_id", "user_id")


# 使用示例
with RequestLogger(request_id="req_abc123", user_id="user_456"):
    logger.info("查询用户信息")
    logger.info("查询数据库", query="SELECT * FROM users", duration_ms=12.3)
    # 所有日志自动携带 request_id 和 user_id
```

### 11.4.3 loguru 使用

```python
from loguru import logger
import sys
import json


# 移除默认处理器并添加自定义
logger.remove()

# 控制台输出
logger.add(
    sys.stdout,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan> - <level>{message}</level>",
    level="DEBUG",
    colorize=True,
)

# JSON 文件输出（用于生产日志分析）
logger.add(
    "logs/app_{time:YYYY-MM-DD}.json",
    format=lambda record: json.dumps({
        "timestamp": record["time"].isoformat(),
        "level": record["level"].name,
        "module": record["name"],
        "line": record["line"],
        "message": record["message"],
        "extra": record["extra"],
    }),
    rotation="100 MB",    # 按大小轮转
    retention="30 days",  # 保留 30 天
    compression="gz",     # 压缩旧日志
    level="INFO",
)


# 使用示例
logger.info("系统启动", extra={"version": "1.0.0", "pid": 1234})

# 绑定额外上下文
with logger.contextualize(request_id="req_789", user_ip="192.168.1.1"):
    logger.info("处理请求")
    logger.warning("请求耗时过长", extra={"duration_ms": 2500})
```

**要点总结：**
- 开发环境使用彩色可读输出，生产环境使用 JSON 格式方便日志收集
- `structlog.contextvars` 支持在异步代码中正确传递上下文
- `loguru` 的 `rotation` 和 `retention` 参数简化了日志管理

---

## 11.5 后台任务

后台任务处理是 Web 应用的常见需求，从简单的 asyncio 任务到分布式任务队列各有适用场景。

### 11.5.1 FastAPI + asyncio 后台任务

```python
import asyncio
from fastapi import FastAPI, BackgroundTasks
from typing import Any

app = FastAPI(title="Background Tasks Demo")


# ---- 方式一：FastAPI BackgroundTasks（轻量级，异步但阻塞共享事件循环） ----
def send_email(email: str, message: str) -> None:
    """模拟发送邮件"""
    import time
    time.sleep(2)  # 模拟 IO
    print(f"邮件已发送至 {email}: {message}")


@app.post("/notify")
async def notify(email: str, background_tasks: BackgroundTasks):
    """后台发送通知"""
    background_tasks.add_task(send_email, email, "欢迎使用本服务！")
    return {"message": "通知已加入后台队列"}


# ---- 方式二：asyncio.create_task（真正的异步后台任务） ----
class BackgroundProcessor:
    """异步后台处理器"""

    def __init__(self):
        self._tasks: dict[str, asyncio.Task] = {}

    async def start_worker(self, task_id: str, data: Any) -> None:
        """长期运行的后台任务"""
        try:
            for i in range(5):
                await asyncio.sleep(1)  # 模拟处理
                print(f"[{task_id}] 处理进度: {i + 1}/5, 数据: {data}")
        except asyncio.CancelledError:
            print(f"[{task_id}] 任务被取消")
            raise

    def launch(self, task_id: str, data: Any) -> None:
        """启动后台任务"""
        task = asyncio.create_task(self.start_worker(task_id, data))
        self._tasks[task_id] = task

    def cancel(self, task_id: str) -> bool:
        """取消任务"""
        task = self._tasks.get(task_id)
        if task and not task.done():
            task.cancel()
            return True
        return False

    async def shutdown(self) -> None:
        """优雅关闭所有后台任务"""
        for task in self._tasks.values():
            if not task.done():
                task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)


processor = BackgroundProcessor()


@app.on_event("startup")
async def startup():
    processor.launch("task_1", {"type": "data_sync"})


@app.on_event("shutdown")
async def shutdown():
    await processor.shutdown()


@app.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str):
    if processor.cancel(task_id):
        return {"message": f"任务 {task_id} 已取消"}
    return {"message": f"任务 {task_id} 不存在或已完成"}
```

### 11.5.2 Celery 配置与使用

```python
# tasks.py —— Celery 任务定义
from celery import Celery
from celery.signals import task_failure, task_success
import logging

logger = logging.getLogger(__name__)

# 创建 Celery 实例
celery_app = Celery(
    "worker",
    broker="redis://localhost:6379/0",      # 消息代理
    backend="redis://localhost:6379/1",      # 结果后端
)

# Celery 配置
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,         # 跟踪任务开始状态
    task_acks_late=True,             # 任务完成后才确认
    worker_prefetch_multiplier=1,    # 每次只取一个任务
)


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_email_task(self, recipient: str, subject: str, body: str) -> dict:
    """发送邮件（可重试）"""
    try:
        # 实际的邮件发送逻辑
        logger.info(f"发送邮件至 {recipient}: {subject}")
        # simulate_send(recipient, subject, body)
        return {"status": "sent", "recipient": recipient}
    except ConnectionError as exc:
        raise self.retry(exc=exc)


@celery_app.task
def generate_report(report_type: str, user_id: int) -> str:
    """生成报告 —— 耗时任务"""
    import time
    time.sleep(5)  # 模拟计算
    logger.info(f"报告已生成: {report_type} for user {user_id}")
    return f"/reports/{report_type}_{user_id}.pdf"


# ---- 信号监听 ----
@task_success.connect(sender=send_email_task)
def on_task_success(sender=None, **kwargs):
    result = kwargs.get("result")
    logger.info(f"任务成功: {result}")


@task_failure.connect(sender=send_email_task)
def on_task_failure(sender=None, **kwargs):
    exc = kwargs.get("exception")
    logger.error(f"任务失败: {exc}")
```

```python
# main.py —— FastAPI 中调用 Celery 任务
from fastapi import FastAPI
from tasks import send_email_task, generate_report
from celery.result import AsyncResult

app = FastAPI()


@app.post("/send-email")
async def send_email(recipient: str, subject: str, body: str):
    """提交异步邮件任务"""
    task = send_email_task.delay(recipient, subject, body)
    return {"task_id": task.id, "status": "queued"}


@app.post("/generate-report")
async def create_report(report_type: str, user_id: int):
    """提交报告生成任务"""
    task = generate_report.delay(report_type, user_id)
    return {"task_id": task.id, "status": "processing"}


@app.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    """查询任务状态"""
    result = AsyncResult(task_id)
    return {
        "task_id": task_id,
        "status": result.status,       # PENDING, STARTED, SUCCESS, FAILURE, RETRY
        "result": result.result if result.ready() else None,
    }
```

### 11.5.3 arq 轻量异步任务

```python
# worker.py —— arq 异步任务队列
"""
arq 基于 redis，适合 asyncio 应用。
安装: pip install arq
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from arq import create_pool
from arq.connections import RedisSettings
from arq.worker import Worker

REDIS_SETTINGS = RedisSettings(host="localhost", port=6379)


# ---- 任务函数 ----
async def send_webhook(ctx: dict, url: str, payload: dict) -> dict:
    """发送 webhook 通知"""
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, timeout=10)
        return {"status_code": resp.status_code, "url": url}


async def process_image(ctx: dict, image_path: str, output_format: str = "webp") -> str:
    """异步处理图片"""
    await asyncio.sleep(2)  # 模拟处理
    output_path = f"/processed/{image_path.split('/')[-1]}.{output_format}"
    return output_path


async def cleanup_temp_files(ctx: dict) -> bool:
    """清理临时文件（定时任务）"""
    print(f"[{datetime.now()}] 清理临时文件...")
    await asyncio.sleep(0.5)
    return True


# ---- Worker 配置 ----
class WorkerSettings:
    """arq worker 配置"""
    functions = [send_webhook, process_image, cleanup_temp_files]
    redis_settings = REDIS_SETTINGS
    max_jobs = 10               # 并发任务数
    job_timeout = 300           # 任务超时（秒）
    keep_result_seconds = 3600  # 结果保留时间


# ---- 客户端使用 ----
async def submit_jobs():
    pool = await create_pool(REDIS_SETTINGS)

    # 提交任务
    job = await pool.enqueue_job("send_webhook", "https://example.com/hook", {"event": "order_placed"})
    print(f"提交任务: {job.job_id}")

    # 定时任务（每分钟执行）
    await pool.enqueue_job("cleanup_temp_files", _defer_until=datetime.utcnow())

    await pool.close()


# 运行 worker: python -m arq worker.WorkerSettings
```

**要点总结：**
- 简单场景用 `BackgroundTasks` 或 `asyncio.create_task`
- 需要可靠性、重试、分布式时用 Celery
- 纯异步项目优先考虑 arq，资源占用远小于 Celery

---

## 11.6 文件处理

文件处理涵盖上传、流式读取、大文件分片和批处理等场景。

### 11.6.1 FastAPI 文件上传

```python
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse
import aiofiles
import os
from pathlib import Path

app = FastAPI(title="File Upload Demo")
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


@app.post("/upload/single")
async def upload_single(file: UploadFile = File(...)):
    """单文件上传"""
    # 安全检查：限制文件大小（100MB）
    contents = await file.read()
    if len(contents) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文件大小不能超过 100MB")

    file_path = UPLOAD_DIR / file.filename
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(contents)

    return {
        "filename": file.filename,
        "size": len(contents),
        "content_type": file.content_type,
    }


@app.post("/upload/multiple")
async def upload_multiple(files: list[UploadFile] = File(...)):
    """多文件上传"""
    results = []
    for file in files:
        content = await file.read()
        file_path = UPLOAD_DIR / file.filename
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)
        results.append({
            "filename": file.filename,
            "size": len(content),
        })
    return {"files": results, "count": len(results)}


@app.post("/upload/with-metadata")
async def upload_with_metadata(
    file: UploadFile = File(...),
    category: str = Form(...),
    tags: str = Form(""),
):
    """带元数据的文件上传"""
    content = await file.read()
    file_path = UPLOAD_DIR / f"{category}_{file.filename}"
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    return {
        "filename": file.filename,
        "category": category,
        "tags": tags.split(",") if tags else [],
        "size": len(content),
    }
```

### 11.6.2 流式处理大文件

```python
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
import aiofiles
import io
import csv
from typing import AsyncGenerator

app = FastAPI(title="Streaming Demo")


# ---- 流式写入 ----
@app.post("/upload/stream")
async def upload_stream(file: UploadFile = File(...)):
    """流式写入大文件，避免内存暴涨"""
    file_path = f"./uploads/{file.filename}"
    chunk_size = 64 * 1024  # 64KB

    async with aiofiles.open(file_path, "wb") as f:
        total = 0
        while chunk := await file.read(chunk_size):
            await f.write(chunk)
            total += len(chunk)

    return {"filename": file.filename, "total_bytes": total}


# ---- 流式读取 ----
async def file_generator(file_path: str, chunk_size: int = 64 * 1024) -> AsyncGenerator[bytes, None]:
    """文件流式生成器"""
    async with aiofiles.open(file_path, "rb") as f:
        while chunk := await f.read(chunk_size):
            yield chunk


@app.get("/download/{filename}")
async def download_file(filename: str):
    """流式下载"""
    file_path = f"./uploads/{filename}"
    return StreamingResponse(
        file_generator(file_path),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---- 流式 CSV 处理 ----
@app.post("/upload/csv-stream")
async def process_csv_stream(file: UploadFile = File(...)):
    """流式处理 CSV，逐行读取不加载全部到内存"""
    import csv

    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode()))

    stats = {"total_rows": 0, "columns": [], "sample": []}
    for i, row in enumerate(reader):
        if i == 0:
            stats["columns"] = list(row.keys())
        if i < 3:
            stats["sample"].append(row)
        stats["total_rows"] += 1

    return stats
```

### 11.6.3 大文件分片上传

```python
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import aiofiles
import os
import json
from pathlib import Path

app = FastAPI(title="Chunked Upload")
UPLOAD_DIR = Path("./uploads/chunks")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CHUNK_DIR = Path("./uploads/temp_chunks")
CHUNK_DIR.mkdir(exist_ok=True)


@app.post("/upload/init")
async def init_upload(filename: str = Form(...), total_chunks: int = Form(...)):
    """初始化分片上传"""
    upload_id = f"{os.urandom(8).hex()}_{filename}"
    chunk_meta = {
        "upload_id": upload_id,
        "filename": filename,
        "total_chunks": total_chunks,
        "received_chunks": [],
    }

    meta_path = CHUNK_DIR / f"{upload_id}.meta"
    async with aiofiles.open(meta_path, "w") as f:
        await f.write(json.dumps(chunk_meta))

    return {"upload_id": upload_id, "chunk_size": 5 * 1024 * 1024}  # 5MB


@app.post("/upload/chunk")
async def upload_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
):
    """上传一个分片"""
    # 保存分片
    chunk_path = CHUNK_DIR / f"{upload_id}_chunk_{chunk_index}"
    content = await file.read()
    async with aiofiles.open(chunk_path, "wb") as f:
        await f.write(content)

    # 更新元数据
    meta_path = CHUNK_DIR / f"{upload_id}.meta"
    async with aiofiles.open(meta_path, "r") as f:
        meta = json.loads(await f.read())

    meta["received_chunks"].append(chunk_index)
    async with aiofiles.open(meta_path, "w") as f:
        await f.write(json.dumps(meta))

    progress = len(meta["received_chunks"]) / meta["total_chunks"] * 100
    return {
        "chunk_index": chunk_index,
        "received": len(meta["received_chunks"]),
        "total": meta["total_chunks"],
        "progress_percent": round(progress, 1),
    }


@app.post("/upload/complete")
async def complete_upload(upload_id: str = Form(...)):
    """合并所有分片"""
    meta_path = CHUNK_DIR / f"{upload_id}.meta"
    async with aiofiles.open(meta_path, "r") as f:
        meta = json.loads(await f.read())

    if len(meta["received_chunks"]) != meta["total_chunks"]:
        missing = set(range(meta["total_chunks"])) - set(meta["received_chunks"])
        raise HTTPException(
            status_code=400,
            detail=f"缺少分片: {sorted(missing)}",
        )

    # 按序合并
    output_path = UPLOAD_DIR / meta["filename"]
    async with aiofiles.open(output_path, "wb") as out_f:
        for i in range(meta["total_chunks"]):
            chunk_path = CHUNK_DIR / f"{upload_id}_chunk_{i}"
            async with aiofiles.open(chunk_path, "rb") as in_f:
                while chunk := await in_f.read(64 * 1024):
                    await out_f.write(chunk)
            os.unlink(chunk_path)  # 删除分片

    # 删除元数据
    os.unlink(meta_path)

    return {
        "filename": meta["filename"],
        "size": os.path.getsize(output_path),
        "chunks": meta["total_chunks"],
    }
```

### 11.6.4 pandas 批处理

```python
import pandas as pd
from pathlib import Path
from typing import Generator
import numpy as np


class BatchFileProcessor:
    """大批量文件批处理器"""

    def __init__(self, chunk_size: int = 10000):
        self.chunk_size = chunk_size
        self.stats = {"total_rows": 0, "processed_files": 0}

    def read_csv_chunks(self, file_path: str) -> Generator[pd.DataFrame, None, None]:
        """分块读取 CSV，逐块处理避免内存溢出"""
        for chunk in pd.read_csv(
            file_path,
            chunksize=self.chunk_size,
            dtype_backend="numpy_nullable",  # 节省内存
        ):
            yield chunk

    def process_large_csv(self, input_path: str, output_path: str) -> dict:
        """处理大 CSV 文件并写入结果"""
        first_chunk = True
        total_processed = 0

        for chunk in self.read_csv_chunks(input_path):
            # 数据清洗
            chunk = self._clean_data(chunk)

            # 数据转换
            chunk = self._transform_data(chunk)

            # 追加写入（避免一次性写入整个 DataFrame）
            chunk.to_csv(
                output_path,
                mode="w" if first_chunk else "a",
                header=first_chunk,
                index=False,
            )
            first_chunk = False
            total_processed += len(chunk)

        return {
            "input_file": input_path,
            "output_file": output_path,
            "total_rows": total_processed,
        }

    def _clean_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """数据清洗"""
        # 去除完全空行
        df = df.dropna(how="all")

        # 去除重复行
        df = df.drop_duplicates()

        # 填充缺失值
        for col in df.select_dtypes(include=[np.number]).columns:
            df[col] = df[col].fillna(0)

        return df

    def _transform_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """数据转换"""
        # 示例：日期标准化
        date_cols = df.select_dtypes(include=["datetime64"]).columns
        for col in date_cols:
            df[col] = pd.to_datetime(df[col], errors="coerce")

        return df

    def merge_files(self, file_paths: list[str], output_path: str) -> dict:
        """合并多个文件"""
        merged = []
        for path in file_paths:
            for chunk in self.read_csv_chunks(path):
                merged.append(chunk)
                self.stats["total_rows"] += len(chunk)

        if merged:
            result = pd.concat(merged, ignore_index=True)
            result.to_csv(output_path, index=False)

        return {
            "merged_files": len(file_paths),
            "output_rows": self.stats["total_rows"],
            "output": output_path,
        }


# 使用示例
if __name__ == "__main__":
    processor = BatchFileProcessor(chunk_size=5000)
    result = processor.process_large_csv("large_input.csv", "cleaned_output.csv")
    print(f"处理完成: {result}")
```

**要点总结：**
- 文件上传务必做大小校验和类型校验
- 大文件流式处理使用 `async for chunk in file.read(chunk_size)` 避免内存问题
- pandas 分块处理（`chunksize` 参数）是处理 GB 级数据的标准方式

---

## 11.7 分页与排序

分页是列表接口的标配，常见的实现方式有 offset-based 和 cursor-based 两种。

### 11.7.1 FastAPI 分页（Offset-based）

```python
from fastapi import FastAPI, Query
from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Sequence

app = FastAPI(title="Pagination Demo")

# 模拟数据
MOCK_ITEMS = [{"id": i, "title": f"Item {i}", "created_at": f"2024-01-{i % 30 + 1:02d}"} for i in range(1, 1001)]

T = TypeVar("T")


# ---- 通用分页模型 ----
class PaginationParams(BaseModel):
    """分页参数"""
    page: int = Field(default=1, ge=1, description="页码")
    size: int = Field(default=20, ge=1, le=100, description="每页条数")

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


class Page(BaseModel, Generic[T]):
    """通用分页响应"""
    items: list[T]
    total: int
    page: int
    size: int
    pages: int

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    @property
    def has_prev(self) -> bool:
        return self.page > 1


@app.get("/items")
def list_items(
    page: int = Query(1, ge=1, description="页码"),
    size: int = Query(20, ge=1, le=100, description="每页条数"),
    sort_by: str = Query("id", regex="^(id|title|created_at)$", description="排序字段"),
    sort_order: str = Query("asc", regex="^(asc|desc)$", description="排序方向"),
) -> Page:
    """分页+排序查询接口"""
    # 排序
    items = sorted(
        MOCK_ITEMS,
        key=lambda x: x.get(sort_by, ""),
        reverse=(sort_order == "desc"),
    )

    # 分页
    offset = (page - 1) * size
    page_items = items[offset: offset + size]

    return Page(
        items=page_items,
        total=len(items),
        page=page,
        size=size,
        pages=-(-len(items) // size),  # 向上取整
    )
```

### 11.7.2 高级分页封装

```python
from fastapi import FastAPI, Query, Depends
from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Sequence, Any

app = FastAPI(title="Advanced Pagination")

T = TypeVar("T")


# ---- 排序支持 ----
class SortParams(BaseModel):
    """排序参数"""
    sort_by: str = Field(default="id", description="排序字段")
    sort_order: str = Field(default="asc", pattern="^(asc|desc)$", description="排序方向")


class PaginatedParams(BaseModel):
    """完整的分页+排序参数"""
    page: int = Field(default=1, ge=1)
    size: int = Field(default=20, ge=1, le=100)
    sort_by: str = Field(default="id")
    sort_order: str = Field(default="asc", pattern="^(asc|desc)$")


class PaginatedResponse(BaseModel, Generic[T]):
    """分页响应模型"""
    items: list[T]
    total: int
    page: int
    size: int
    pages: int
    has_next: bool = False
    has_prev: bool = False


def paginate(
    items: Sequence[Any],
    params: PaginatedParams,
    total: int | None = None,
) -> PaginatedResponse:
    """通用分页工具函数"""
    total = total or len(items)
    pages = -(-total // params.size)  # 向上取整

    return PaginatedResponse(
        items=items,
        total=total,
        page=params.page,
        size=params.size,
        pages=pages,
        has_next=params.page < pages,
        has_prev=params.page > 1,
    )


# ---- SQLAlchemy 集成 ----
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession


async def paginated_query(
    db: AsyncSession,
    stmt,
    params: PaginatedParams,
    count_stmt=None,
) -> PaginatedResponse:
    """基于 SQLAlchemy 的异步分页查询"""
    # 计算总数
    count = count_stmt or select(func.count()).select_from(stmt.subquery())
    total_result = await db.execute(count)
    total = total_result.scalar()

    # 排序
    order_col = getattr(stmt.c, params.sort_by, None)
    if order_col is not None:
        order_func = order_col.asc if params.sort_order == "asc" else order_col.desc
        stmt = stmt.order_by(order_func())

    # 分页
    stmt = stmt.offset((params.page - 1) * params.size).limit(params.size)
    result = await db.execute(stmt)
    items = result.scalars().all()

    return paginate(items, params, total=total)


# 使用示例
@app.get("/posts")
def list_posts(params: PaginatedParams = Depends()):
    """分页查询帖子"""
    mock_posts = [
        {"id": i, "title": f"Post {i}", "views": 1000 - i}
        for i in range(1, 101)
    ]

    # 排序
    reverse = params.sort_order == "desc"
    sorted_posts = sorted(
        mock_posts,
        key=lambda x: x.get(params.sort_by, 0),
        reverse=reverse,
    )

    return paginate(sorted_posts, params)
```

### 11.7.3 Cursor-based Pagination

```python
from fastapi import FastAPI, Query
from pydantic import BaseModel, Field
from typing import Generic, TypeVar, Sequence, Optional
import base64

app = FastAPI(title="Cursor Pagination Demo")

T = TypeVar("T")


# ---- 游标分页 ----
class CursorParams(BaseModel):
    """游标分页参数"""
    cursor: Optional[str] = Field(default=None, description="游标（上一页最后一条的编码）")
    limit: int = Field(default=20, ge=1, le=100, description="每页条数")


class CursorPage(BaseModel, Generic[T]):
    """游标分页响应"""
    items: list[T]
    next_cursor: Optional[str] = Field(description="下一页游标")
    has_more: bool = False


def encode_cursor(value: str | int) -> str:
    """编码游标"""
    return base64.urlsafe_b64encode(str(value).encode()).decode()


def decode_cursor(cursor: str) -> str:
    """解码游标"""
    try:
        return base64.urlsafe_b64decode(cursor.encode()).decode()
    except Exception:
        raise ValueError("无效的游标")


# ---- 模拟数据 ----
MOCK_POSTS = [
    {"id": i, "title": f"Post {i}", "created_at": f"2024-06-{i % 30 + 1:02d}T00:00:00Z"}
    for i in range(1, 1001)
]


@app.get("/posts/cursor")
def list_posts_cursor(
    cursor: Optional[str] = Query(None, description="上一页的最后一条 id"),
    limit: int = Query(20, ge=1, le=100),
):
    """基于游标的分页"""
    # 解码游标
    start_id = int(decode_cursor(cursor)) if cursor else 0

    # 查询：WHERE id > cursor ORDER BY id LIMIT limit+1
    filtered = [p for p in MOCK_POSTS if p["id"] > start_id]
    page = filtered[: limit + 1]

    has_more = len(page) > limit
    items = page[:limit]
    next_cursor = encode_cursor(items[-1]["id"]) if items else None

    return CursorPage(
        items=items,
        next_cursor=next_cursor,
        has_more=has_more,
    )


# ---- SQLAlchemy 游标分页 ----
async def cursor_paginated_query(
    db_session,
    model,
    cursor_column,
    cursor_value: str | None,
    limit: int = 20,
    **filters,
):
    """SQLAlchemy 游标分页示例"""
    from sqlalchemy import select

    stmt = select(model).filter_by(**filters)

    if cursor_value:
        decoded = decode_cursor(cursor_value)
        stmt = stmt.where(cursor_column > decoded)

    # 多取一条以判断是否有下一页
    stmt = stmt.order_by(cursor_column).limit(limit + 1)
    result = await db_session.execute(stmt)
    rows = result.scalars().all()

    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = encode_cursor(getattr(items[-1], cursor_column.name)) if items else None

    return items, next_cursor, has_more
```

**要点总结：**
- Offset 分页简单直观，适合数据量不大的场景（< 10 万条）
- Cursor 分页性能稳定（`WHERE id > $cursor` 可使用索引），适合大数据量或实时数据
- 游标分页不支持随机跳页，适合"加载更多"场景

---

## 11.8 缓存策略

合理的缓存策略能显著提升系统性能，同时要注意缓存一致性、穿透和雪崩等问题。

### 11.8.1 functools.lru_cache

```python
from functools import lru_cache
import time


@lru_cache(maxsize=128)
def expensive_computation(n: int) -> int:
    """模拟耗时计算，结果被缓存"""
    print(f"计算 fibonacci({n})...")
    time.sleep(0.1)  # 模拟计算开销
    if n < 2:
        return n
    return expensive_computation(n - 1) + expensive_computation(n - 2)


# 使用示例
print(expensive_computation(10))  # 首次计算
print(expensive_computation(10))  # 命中缓存
print(expensive_computation(11))  # 部分命中缓存（n-1=10 已缓存）
print(expensive_computation(20))  # 大量缓存命中

# 查看缓存统计
print(f"缓存信息: {expensive_computation.cache_info()}")
# CacheInfo(hits=127, misses=21, maxsize=128, currsize=21)

# 清理缓存
expensive_computation.cache_clear()
```

### 11.8.2 cachetools 高级缓存

```python
from cachetools import cached, TTLCache, LRUCache, LFUCache
from cachetools.keys import hashkey
import time


# ---- TTL 缓存（常用） ----
@cached(cache=TTLCache(maxsize=100, ttl=60))
def get_user_name(user_id: int) -> str:
    """模拟数据库查询，结果缓存 60 秒"""
    print(f"查询数据库: user_id={user_id}")
    time.sleep(0.5)
    return f"User_{user_id}"


print(get_user_name(1))  # 查库
print(get_user_name(1))  # 命中缓存
time.sleep(0.1)
print(get_user_name(1))  # 仍然命中


# ---- 自定义缓存键 ----
def make_cache_key(func, *args, **kwargs):
    """自定义缓存键生成"""
    return hashkey(*args, frozenset(kwargs.items()))


@cached(cache=LRUCache(maxsize=50), key=make_cache_key)
def fetch_user_profile(user_id: int, include_email: bool = False) -> dict:
    """获取用户信息"""
    print(f"获取用户 {user_id} 信息 (email={'是' if include_email else '否'})")
    time.sleep(0.3)
    return {
        "id": user_id,
        "name": f"User_{user_id}",
        **({"email": f"user{user_id}@example.com"} if include_email else {}),
    }


# ---- 不同缓存策略对比 ----
class CacheDemo:
    """展示不同缓存策略的行为"""

    def __init__(self):
        self.ttl_cache = TTLCache(maxsize=10, ttl=5)    # 5 秒过期
        self.lru_cache = LRUCache(maxsize=3)             # 最近最少使用，保留 3 个
        self.lfu_cache = LFUCache(maxsize=3)             # 最不经常使用，保留 3 个

    def ttl_example(self):
        print("--- TTL Cache ---")
        self.ttl_cache["a"] = 1
        print(f"a = {self.ttl_cache['a']}")  # 有效
        time.sleep(6)
        # print(self.ttl_cache['a'])  # KeyError: 已过期

    def lru_example(self):
        print("--- LRU Cache ---")
        for k in "abcde":
            self.lru_cache[k] = k.upper()
        print(f"LRU keys: {list(self.lru_cache.keys())}")  # c, d, e（a, b 被淘汰）


# ---- 异步缓存支持 ----
from cachetools import cached
import asyncio


class AsyncTTLCache(TTLCache):
    """支持异步的 TTL 缓存"""
    pass


async def fetch_data(url: str) -> str:
    """模拟异步 HTTP 请求"""
    await asyncio.sleep(0.5)
    return f"Response from {url}"


# 手动缓存异步函数
_async_cache: dict[str, tuple[float, str]] = {}
_async_cache_ttl = 30


async def get_cached(url: str) -> str:
    """带缓存的异步请求"""
    import time
    now = time.time()
    if url in _async_cache:
        timestamp, data = _async_cache[url]
        if now - timestamp < _async_cache_ttl:
            print(f"[缓存命中] {url}")
            return data
    print(f"[发起请求] {url}")
    data = await fetch_data(url)
    _async_cache[url] = (now, data)
    return data
```

### 11.8.3 Redis 缓存

```python
import json
from typing import Any, Optional
import redis.asyncio as aioredis
from functools import wraps


class RedisCache:
    """Redis 缓存封装"""

    def __init__(self, redis_url: str = "redis://localhost:6379/0"):
        self.redis_url = redis_url
        self._client: Optional[aioredis.Redis] = None

    async def get_client(self) -> aioredis.Redis:
        if self._client is None:
            self._client = aioredis.from_url(
                self.redis_url,
                decode_responses=True,  # 自动解码为 str
            )
        return self._client

    async def get(self, key: str) -> Any | None:
        """获取缓存"""
        client = await self.get_client()
        data = await client.get(key)
        if data:
            return json.loads(data)
        return None

    async def set(
        self,
        key: str,
        value: Any,
        ttl: int = 300,
    ) -> bool:
        """设置缓存"""
        client = await self.get_client()
        return await client.setex(key, ttl, json.dumps(value, default=str))

    async def delete(self, key: str) -> bool:
        """删除缓存"""
        client = await self.get_client()
        return bool(await client.delete(key))

    async def clear_pattern(self, pattern: str) -> int:
        """批量清理（如 clear_pattern("user:*")）"""
        client = await self.get_client()
        keys = await client.keys(pattern)
        if keys:
            return await client.delete(*keys)
        return 0

    async def close(self):
        if self._client:
            await self._client.close()


# ---- FastAPI Redis 缓存装饰器 ----
from fastapi import Request
from hashlib import md5


def redis_cache(ttl: int = 300):
    """Redis 缓存装饰器（用于 FastAPI 路由）"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # 解析请求对象以生成缓存键
            request = kwargs.get("request")
            if not request:
                return await func(*args, **kwargs)

            # 生成缓存键
            key = f"cache:{func.__name__}:{request.url.path}:{md5(str(request.query_params).encode()).hexdigest()}"

            # 尝试从 Redis 获取
            cache = RedisCache()
            cached = await cache.get(key)
            if cached is not None:
                return cached

            # 执行原函数
            result = await func(*args, **kwargs)

            # 写入缓存
            await cache.set(key, result, ttl=ttl)
            return result
        return wrapper
    return decorator


# 使用示例
@redis_cache(ttl=120)
async def get_expensive_data(request: Request):
    """这个接口的结果会被缓存 120 秒"""
    await asyncio.sleep(2)  # 模拟耗时
    return {"data": "expensive computation result"}
```

### 11.8.4 缓存穿透防护

```python
# ---- 布隆过滤器（Bloom Filter）防止缓存穿透 ----
import hashlib
from typing import Callable


class BloomFilter:
    """简单布隆过滤器实现"""

    def __init__(self, size: int = 100000, hash_count: int = 3):
        self.size = size
        self.hash_count = hash_count
        self.bit_array = 0  # 使用整数位运算模拟位数组

    def _hashes(self, item: str) -> list[int]:
        """生成多个哈希值"""
        result = []
        for i in range(self.hash_count):
            h = hashlib.md5(f"{item}:{i}".encode()).hexdigest()
            result.append(int(h, 16) % self.size)
        return result

    def add(self, item: str) -> None:
        for h in self._hashes(item):
            self.bit_array |= 1 << h

    def contains(self, item: str) -> bool:
        for h in self._hashes(item):
            if not (self.bit_array & (1 << h)):
                return False
        return True


# ---- 缓存穿透防护示例 ----
class SafeCache:
    """带有穿透防护的缓存"""

    def __init__(self):
        self.bloom = BloomFilter()
        self.redis_cache = RedisCache()
        # 预热：加载已知用户 ID
        for uid in range(1, 1001):
            self.bloom.add(f"user:{uid}")

    async def get_user(self, user_id: int) -> dict | None:
        """安全获取用户信息"""
        key = f"user:{user_id}"

        # 1. 布隆过滤器快速判断
        if not self.bloom.contains(key):
            return None  # 肯定不存在，直接返回

        # 2. 查缓存
        cached = await self.redis_cache.get(key)
        if cached is not None:
            return cached

        # 3. 查数据库
        user = await self._query_db(user_id)

        # 4. 缓存结果（即使是空值也缓存短暂时间，防止穿透）
        cache_ttl = 60 if user else 10  # 空值缓存更短
        await self.redis_cache.set(key, user, ttl=cache_ttl)
        return user

    async def _query_db(self, user_id: int) -> dict | None:
        """模拟数据库查询"""
        # 实际项目中这是数据库查询
        if user_id <= 1000:
            return {"id": user_id, "name": f"User_{user_id}"}
        return None


# ---- 缓存雪崩防护 ----
class CacheAvalancheProtection:
    """缓存雪崩防护：缓存的 TTL 添加随机偏移"""

    @staticmethod
    def get_random_ttl(base_ttl: int = 300, jitter: float = 0.1) -> int:
        """在基础 TTL 上增加 ±10% 的随机偏移"""
        import random
        return int(base_ttl * (1 + random.uniform(-jitter, jitter)))

    async def set_with_jitter(self, cache: RedisCache, key: str, value: Any, base_ttl: int = 300):
        """设置带随机 TTL 的缓存"""
        ttl = self.get_random_ttl(base_ttl)
        await cache.set(key, value, ttl=ttl)
```

**要点总结：**
- `lru_cache` 适合无状态的计算密集型函数的缓存
- `cachetools` 提供了 TTL、LRU、LFU 等多种策略
- Redis 缓存是分布式缓存的标准方案，注意 key 的设计规范
- 布隆过滤器 + 短暂缓存空值是防穿透的经典组合
- 缓存 TTL 加随机偏移量可有效防止缓存雪崩

---

## 11.9 定时任务与调度

定时任务在数据同步、报表生成、清理维护等场景广泛使用。

### 11.9.1 APScheduler 集成

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from datetime import datetime, timedelta
import asyncio


# ---- 任务函数 ----
async def report_generator():
    """定时生成报表"""
    print(f"[{datetime.now()}] 生成日报告...")


async def data_cleanup():
    """清理过期数据"""
    print(f"[{datetime.now()}] 清理 30 天前的数据...")


async def health_check():
    """健康检查"""
    print(f"[{datetime.now()}] 运行健康检查...")


async def send_weekly_digest():
    """发送周报"""
    print(f"[{datetime.now()}] 发送周报邮件...")


# ---- 调度器配置 ----
async def main():
    scheduler = AsyncIOScheduler()

    # 添加任务
    scheduler.add_job(
        report_generator,
        trigger=CronTrigger(hour=2, minute=0),  # 每天凌晨 2:00
        id="daily_report",
        name="每日报表生成",
        replace_existing=True,
    )

    scheduler.add_job(
        data_cleanup,
        trigger=CronTrigger(day=1, hour=3, minute=0),  # 每月 1 号凌晨 3:00
        id="monthly_cleanup",
        name="月度数据清理",
    )

    scheduler.add_job(
        health_check,
        trigger=IntervalTrigger(minutes=5),  # 每 5 分钟
        id="health_check",
        name="健康检查",
    )

    scheduler.add_job(
        send_weekly_digest,
        trigger=CronTrigger(day_of_week="mon", hour=9, minute=0),  # 每周一上午 9:00
        id="weekly_digest",
        name="周报发送",
    )

    scheduler.add_job(
        lambda: print(f"[{datetime.now()}] 一次性任务执行"),
        trigger=DateTrigger(run_date=datetime.now() + timedelta(seconds=10)),
        id="one_off",
        name="一次性延时任务",
    )

    scheduler.start()
    print("定时调度器已启动")
    print("任务列表:")
    scheduler.print_jobs()

    # 保持运行
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        scheduler.shutdown(wait=False)


# 运行: asyncio.run(main())


# ---- FastAPI 集成 ----
from contextlib import asynccontextmanager
from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI 生命周期管理 APScheduler"""
    scheduler = AsyncIOScheduler()

    scheduler.add_job(
        health_check,
        trigger=IntervalTrigger(minutes=5),
        id="health_check",
    )

    scheduler.start()
    app.state.scheduler = scheduler

    yield

    scheduler.shutdown(wait=False)


app = FastAPI(lifespan=lifespan)


@app.get("/scheduler/status")
async def scheduler_status():
    """查看调度器状态"""
    scheduler: AsyncIOScheduler = app.state.scheduler
    jobs = [
        {
            "id": job.id,
            "name": job.name,
            "next_run": str(job.next_run_time),
            "trigger": str(job.trigger),
        }
        for job in scheduler.get_jobs()
    ]
    return {
        "running": scheduler.running,
        "jobs": jobs,
    }
```

### 11.9.2 Celery Beat 周期性任务

```python
# celery_config.py
from celery import Celery
from celery.schedules import crontab

celery_app = Celery(
    "tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)

celery_app.conf.beat_schedule = {
    # 每 30 分钟同步一次数据
    "sync-external-data": {
        "task": "tasks.sync_external_data",
        "schedule": 1800.0,  # 秒为单位
        "options": {"queue": "default"},
    },
    # 每天凌晨 2 点生成报表
    "generate-daily-report": {
        "task": "tasks.generate_daily_report",
        "schedule": crontab(hour=2, minute=0),
        "args": ("daily",),
    },
    # 每周一上午 9 点发送周报
    "send-weekly-digest": {
        "task": "tasks.send_weekly_digest",
        "schedule": crontab(hour=9, minute=0, day_of_week=1),
    },
    # 每月 1 号清理数据
    "monthly-cleanup": {
        "task": "tasks.cleanup_old_data",
        "schedule": crontab(day_of_month=1, hour=3, minute=0),
    },
}
```

```python
# tasks.py
from celery_config import celery_app
import logging

logger = logging.getLogger(__name__)


@celery_app.task
def sync_external_data():
    """同步外部数据"""
    logger.info("开始同步外部数据...")
    # 实际的同步逻辑
    return "sync completed"


@celery_app.task
def generate_daily_report(report_type: str) -> str:
    """生成日报表"""
    logger.info(f"生成 {report_type} 报表...")
    import time
    time.sleep(2)
    return f"/reports/{report_type}_report.pdf"


@celery_app.task
def send_weekly_digest() -> dict:
    """发送周报"""
    logger.info("生成并发送周报...")
    return {"status": "sent", "recipients": 150}


@celery_app.task
def cleanup_old_data() -> int:
    """清理过期数据"""
    logger.info("清理过期数据...")
    return 1024  # 清理的数据量（KB）


"""
启动方式:
  1. 启动 worker:   celery -A tasks worker --loglevel=info
  2. 启动 beat:     celery -A tasks beat --loglevel=info
  3. 合并启动:      celery -A tasks worker --beat --loglevel=info
"""
```

### 11.9.3 轻量 cron 方案

```python
import asyncio
import schedule  # pip install schedule
import time
from datetime import datetime
from threading import Thread


# ---- 基于 schedule 库 ----
class LightweightScheduler:
    """轻量级定时任务调度器"""

    def __init__(self):
        self._running = False

    def start(self):
        """在单独线程中启动调度器"""
        self._running = True
        thread = Thread(target=self._run, daemon=True)
        thread.start()

    def _run(self):
        """调度器主循环"""
        while self._running:
            schedule.run_pending()
            time.sleep(1)

    def stop(self):
        self._running = False


# 定义任务
def backup_database():
    print(f"[{datetime.now()}] 备份数据库...")


def send_reminders():
    print(f"[{datetime.now()}] 发送提醒邮件...")


def check_system_health():
    print(f"[{datetime.now()}] 系统健康检查...")


# 配置任务
schedule.every().day.at("03:00").do(backup_database)
schedule.every().hour.do(check_system_health)
schedule.every().monday.at("09:00").do(send_reminders)
schedule.every(30).minutes.do(lambda: print("每 30 分钟任务"))

# 启动调度器（单独线程）
scheduler = LightweightScheduler()
scheduler.start()


# ---- 基于 asyncio 的纯异步方案 ----
async def cron_task(name: str, interval: int, coro):
    """简单的异步定时任务运行器"""
    while True:
        await coro()
        await asyncio.sleep(interval)


async def async_health_check():
    print(f"[{datetime.now()}] 异步健康检查...")
    await asyncio.sleep(0.5)


async def async_data_sync():
    print(f"[{datetime.now()}] 异步数据同步...")
    await asyncio.sleep(2)


async def run_async_scheduler():
    """运行多个定时任务"""
    tasks = [
        cron_task("health", 300, async_health_check),     # 每 5 分钟
        cron_task("sync", 3600, async_data_sync),         # 每小时
    ]
    await asyncio.gather(*tasks)


# 使用 asyncio 运行
# asyncio.run(run_async_scheduler())
```

**要点总结：**
- APScheduler 功能最全，支持多种触发器，推荐用在复杂调度场景
- Celery Beat 适合已经有 Celery 基础设施的项目
- 简单场景用 `schedule` 库或纯 asyncio 循环就足够了
- 生产环境务必添加任务监控和失败告警

---

## 11.10 数据验证与序列化

Pydantic v2 是 Python 生态中最强大的数据验证库，底层用 Rust 实现，性能大幅提升。

### 11.10.1 Pydantic v2 基础

```python
from pydantic import BaseModel, Field, EmailStr, HttpUrl, field_validator
from datetime import datetime
from typing import Optional
from enum import Enum


class UserRole(str, Enum):
    ADMIN = "admin"
    USER = "user"
    MODERATOR = "moderator"


class Address(BaseModel):
    """嵌套模型"""
    city: str = Field(..., min_length=1, max_length=100)
    street: str
    zip_code: str = Field(..., pattern=r"^\d{5}(-\d{4})?$")


class UserCreate(BaseModel):
    """用户创建请求"""

    model_config = {
        "str_strip_whitespace": True,                    # 自动去除首尾空格
        "str_min_length": 1,                             # 字符串最小长度
        "validate_default": True,                        # 校验默认值
        "extra": "forbid",                               # 禁止额外字段
    }

    username: str = Field(
        ...,
        min_length=3,
        max_length=32,
        pattern=r"^[a-zA-Z0-9_]+$",
        description="用户名，字母数字下划线",
    )
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    age: int = Field(..., ge=0, le=150)
    role: UserRole = Field(default=UserRole.USER)
    address: Optional[Address] = None
    website: Optional[HttpUrl] = None
    tags: list[str] = Field(default_factory=list, max_length=10)
    created_at: datetime = Field(default_factory=datetime.now)

    # ---- 自定义验证器 ----
    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        """密码强度校验"""
        if not any(c.isupper() for c in v):
            raise ValueError("密码必须包含大写字母")
        if not any(c.isdigit() for c in v):
            raise ValueError("密码必须包含数字")
        return v

    @field_validator("tags")
    @classmethod
    def unique_tags(cls, v: list[str]) -> list[str]:
        """标签去重"""
        seen = set()
        result = []
        for tag in v:
            if tag.lower() not in seen:
                seen.add(tag.lower())
                result.append(tag)
        return result


# 使用示例
try:
    user = UserCreate(
        username="john_doe",
        email="john@example.com",
        password="SecurePass1",
        age=25,
        address={"city": "Beijing", "street": "Chang'an Ave", "zip_code": "100000"},
        tags=["python", "web", "python"],  # 重复的会被去重
    )
    print(f"验证通过: {user.model_dump_json(indent=2)}")
except Exception as e:
    print(f"验证失败: {e}")
```

### 11.10.2 高级验证器

```python
from pydantic import (
    BaseModel,
    Field,
    model_validator,
    field_validator,
    ValidationInfo,
)
from typing import Any
from datetime import date


class ReservationCreate(BaseModel):
    """预订请求 —— 包含字段间交叉验证"""

    check_in: date
    check_out: date
    guests: int = Field(..., ge=1, le=10)
    room_type: str

    # ---- 模型级验证器 ----
    @model_validator(mode="before")
    @classmethod
    def validate_dates(cls, data: Any) -> Any:
        """在字段验证之前做预处理"""
        if isinstance(data, dict):
            # 自动格式化日期字符串
            for key in ("check_in", "check_out"):
                if isinstance(data.get(key), str):
                    data[key] = data[key].replace("/", "-")
        return data

    @model_validator(mode="after")
    def check_dates_consistency(self) -> "ReservationCreate":
        """字段全部验证完成后做交叉校验"""
        if self.check_out <= self.check_in:
            raise ValueError("离店日期必须在入住日期之后")
        if (self.check_out - self.check_in).days > 30:
            raise ValueError("最长预订不超过 30 天")
        return self

    @field_validator("room_type")
    @classmethod
    def validate_room_type(cls, v: str, info: ValidationInfo) -> str:
        """使用 ValidationInfo 访问其他字段"""
        allowed = ["single", "double", "suite", "deluxe"]
        if v.lower() not in allowed:
            raise ValueError(f"房间类型必须为: {', '.join(allowed)}")
        return v.lower()


# ---- 带上下文的验证 ----
from typing import Any


class OrderItem(BaseModel):
    """订单项"""
    product_id: str
    quantity: int = Field(..., ge=1)
    unit_price: float = Field(..., gt=0)

    @field_validator("quantity")
    @classmethod
    def check_stock(cls, v: int, info: ValidationInfo) -> int:
        """模拟库存检查（需要上下文）"""
        # 实际项目中通过 info.data 获取其他字段值
        return v


class OrderCreate(BaseModel):
    """创建订单"""

    items: list[OrderItem] = Field(..., min_length=1)

    @model_validator(mode="after")
    def validate_order(self) -> "OrderCreate":
        """订单级校验"""
        # 检查重复商品
        product_ids = [item.product_id for item in self.items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("订单中包含重复商品")
        return self

    @property
    def total_amount(self) -> float:
        return sum(item.quantity * item.unit_price for item in self.items)


# 使用示例
order = OrderCreate(
    items=[
        OrderItem(product_id="P001", quantity=2, unit_price=99.9),
        OrderItem(product_id="P002", quantity=1, unit_price=199.9),
    ]
)
print(f"订单总金额: ¥{order.total_amount}")
```

### 11.10.3 序列化配置

```python
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime, date
from typing import Optional
from decimal import Decimal
import json
from enum import Enum


class Status(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Product(BaseModel):
    """产品模型 —— 序列化配置演示"""

    model_config = ConfigDict(
        # 序列化配置
        use_enum_values=True,              # 序列化时使用枚举值而非名称
        validate_assignment=True,          # 赋值时验证
        frozen=False,                       # 不可变（设为 True 则为不可变）
        str_strip_whitespace=True,
        # 序列化别名
        populate_by_name=True,             # 允许通过字段名或别名赋值
    )

    id: int
    name: str = Field(..., max_length=200)
    description: Optional[str] = Field(default=None, alias="desc")
    price: Decimal = Field(..., max_digits=10, decimal_places=2)
    status: Status = Field(default=Status.PENDING)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    # ---- 自定义序列化 ----
    @field_serializer("price")
    def serialize_price(self, value: Decimal) -> str:
        """价格序列化为字符串"""
        return f"¥{value:.2f}"

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: Optional[datetime]) -> Optional[str]:
        """日期序列化为 ISO 格式"""
        if value is None:
            return None
        return value.isoformat()

    @field_serializer("status")
    def serialize_status(self, value: Status) -> str:
        """状态序列化"""
        return value.value  # 即使 use_enum_values=False 也输出值


# ---- 序列化控制 ----
class UserResponse(BaseModel):
    """用户响应 —— 控制哪些字段暴露"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    role: str
    # 敏感字段不包含在模型中，就不会被序列化


class User(BaseModel):
    """内部用户模型"""
    id: int
    username: str
    email: str
    password_hash: str
    role: str
    ssn: str  # 敏感信息


def to_user_response(user: User) -> UserResponse:
    """安全转换：只暴露需要的字段"""
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role,
    )


# ---- 排除策略 ----
class AuditLog(BaseModel):
    """审计日志"""

    model_config = ConfigDict(
        # 序列化排除策略
        json_encoders={
            datetime: lambda v: v.isoformat(),
        },
    )

    id: int
    action: str
    user_id: int
    timestamp: datetime = Field(default_factory=datetime.now)
    _internal_note: str = "internal only"  # 下划线开头的字段默认不序列化
    sensitive_token: str = Field(default="", exclude=True)  # 显式排除


# 使用示例
product = Product(
    id=1,
    name="Python 编程指南",
    desc="一本好书",
    price=Decimal("79.90"),
    status=Status.APPROVED,
)
print(f"JSON 输出:")
print(json.dumps(json.loads(product.model_dump_json()), indent=2, ensure_ascii=False))
```

### 11.10.4 FastAPI 集成

```python
from fastapi import FastAPI, HTTPException, Query, Path
from pydantic import BaseModel, Field, EmailStr
from typing import Annotated

app = FastAPI(title="Pydantic v2 Demo")


# ---- 请求体 ----
class CreateItemRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    price: float = Field(..., gt=0, description="价格（元）")
    in_stock: bool = True


class ItemResponse(BaseModel):
    id: int
    name: str
    price: float
    in_stock: bool

    model_config = {"from_attributes": True}


# ---- 查询参数 ----
class SearchParams(BaseModel):
    """用 Pydantic 模型定义查询参数"""
    q: str = Field(default="", max_length=100)
    page: int = Field(default=1, ge=1)
    size: int = Field(default=20, ge=1, le=100)
    sort: str = Field(default="id", pattern=r"^(id|name|price|created_at)$")


# ---- 响应模型 ----
@app.post("/items", response_model=ItemResponse, status_code=201)
async def create_item(item: CreateItemRequest):
    """创建商品（输入验证 + 输出序列化）"""
    # 模拟创建
    return ItemResponse(id=1, **item.model_dump())


@app.get("/items")
async def list_items(params: Annotated[SearchParams, Query()]):
    """查询商品列表"""
    return {
        "params": params.model_dump(),
        "results": [],
    }


@app.get("/items/{item_id}")
async def get_item(
    item_id: Annotated[int, Path(ge=1)],
    include_details: Annotated[bool, Query()] = False,
):
    """获取商品详情"""
    # 模拟返回
    item_dict = {"id": item_id, "name": f"Item {item_id}", "price": 99.9, "in_stock": True}
    return ItemResponse(**item_dict)
```

**要点总结：**
- Pydantic v2 使用 Rust 核心 `pydantic-core`，性能比 v1 提升 5-50 倍
- `model_validator(mode="before")` 做预处理，`mode="after"` 做交叉校验
- `field_serializer` 和 `model_config` 的 `json_encoders` 控制序列化输出
- `exclude=True` 和 `_private` 字段可用于隐藏敏感信息
- FastAPI + Pydantic v2 的组合为 API 开发提供了开箱即用的验证和文档
