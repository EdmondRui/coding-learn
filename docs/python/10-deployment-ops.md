# Python 部署与运维

## 1. Docker 容器化

### 1.1 多阶段构建

多阶段构建（Multi-stage Build）是 Docker 最重要的优化手段之一。它允许在单个 Dockerfile 中使用多个 `FROM` 指令，每个阶段可以基于不同的基础镜像，只有最后一个阶段的产物会保留在最终镜像中。

```dockerfile
# === Stage 1: 构建阶段 ===
FROM python:3.12-slim AS builder

# 安装系统编译依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先只复制依赖文件，利用 Docker 层缓存
COPY pyproject.toml poetry.lock ./

# 安装项目依赖到独立目录
RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-dev --no-interaction

# 复制源码
COPY . .

# 编译任何需要 C 扩展的包
RUN python -m compileall -q .

# === Stage 2: 运行阶段 ===
FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 只从 builder 阶段复制 site-packages 和源码
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /app /app

# 创建非 root 用户
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app && \
    chown -R app:app /app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["gunicorn", "app.main:app", "-c", "gunicorn.conf.py"]
```

### 1.2 uv 集成（极速依赖管理）

[uv](https://github.com/astral-sh/uv) 是 Ruff 作者出品的新一代 Python 包管理器，速度比 pip 快 10-100 倍。用它构建镜像可以显著缩短 CI 时间。

```dockerfile
# 使用 uv 的极速构建
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# uv 支持 pip 风格的 requirements.txt
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

COPY . .
```

如果使用 `uv` 的 `uv.lock` 锁定文件，可以搭配 `pyproject.toml` 实现可复现构建：

```dockerfile
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-cache

COPY . .

CMD ["uv", "run", "gunicorn", "app.main:app"]
```

### 1.3 镜像瘦身最佳实践

| 策略 | 效果 | 做法 |
|------|------|------|
| 选择 slim/distroless 基础镜像 | 减少 200-500MB | `python:3.12-slim` 或 `gcr.io/distroless/python3` |
| 多阶段构建 | 减少 50-80% | builder + runtime 分离 |
| 清理包管理器缓存 | 减少 50-100MB | `rm -rf /var/lib/apt/lists/*` |
| 合并 RUN 层 | 减少层数 | 用 `&&` 串接命令 |
| `--no-cache-dir` | 减少 30-60MB | pip install 时添加 |
| 删除 .pyc / .pyo | 减少 10-20% | `find . -name '*.pyc' -delete` |
| 删除测试/文档 | 减少 10-30MB | 只复制必要文件 |

综合示例——极致瘦身版：

```dockerfile
FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM gcr.io/distroless/python3-debian12

WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .

EXPOSE 8000
CMD ["gunicorn", "app.main:app", "-b", "0.0.0.0:8000"]
```

> **注意：** distroless 镜像不包含 shell、curl 等工具。如果要用 HEALTHCHECK，需要在 runtime 阶段基于 slim 镜像，或者用 `grpc_health_probe` 等替代方案。

### 1.4 docker-compose 编排

一个典型的生产级 `docker-compose.yml`，包含应用、PostgreSQL、Redis、Nginx 反向代理：

```yaml
version: "3.9"

x-logging: &default-logging
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: myapp:${APP_VERSION:-latest}
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/myapp
      - REDIS_URL=redis://redis:6379/0
      - SECRET_KEY=${SECRET_KEY}
    env_file:
      - .env.production
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    logging: *default-logging

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging: *default-logging

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - app
    logging: *default-logging

volumes:
  pgdata:
  redisdata:
```

### 1.5 健康检查

Docker 原生健康检查配合 **graceful shutdown** 是生产部署的基石。下面是一个 Python 健康检查端点实现：

```python
# app/health.py
import time
import logging
from dataclasses import dataclass, asdict
from typing import Dict, Any

logger = logging.getLogger(__name__)


@dataclass
class HealthStatus:
    status: str  # "healthy" | "unhealthy" | "degraded"
    version: str
    uptime_seconds: float
    db_connected: bool
    redis_connected: bool
    last_check: float


class HealthChecker:
    def __init__(self, app_version: str = "unknown"):
        self._start_time = time.time()
        self._version = app_version
        self._db_ok = False
        self._redis_ok = False

    def set_db_status(self, ok: bool) -> None:
        self._db_ok = ok

    def set_redis_status(self, ok: bool) -> None:
        self._redis_ok = ok

    def check(self) -> Dict[str, Any]:
        if self._db_ok and self._redis_ok:
            status = "healthy"
        elif not self._db_ok and not self._redis_ok:
            status = "unhealthy"
        else:
            status = "degraded"

        result = HealthStatus(
            status=status,
            version=self._version,
            uptime_seconds=time.time() - self._start_time,
            db_connected=self._db_ok,
            redis_connected=self._redis_ok,
            last_check=time.time(),
        )
        return asdict(result)


# 在 FastAPI 中挂载
# @app.get("/healthz")
# async def healthz(checker: HealthChecker = Depends(get_checker)):
#     result = checker.check()
#     if result["status"] == "unhealthy":
#         raise HTTPException(status_code=503, detail=result)
#     return result
```

---

## 2. WSGI / ASGI 服务器

### 2.1 Gunicorn 配置

Gunicorn 是 Python 最成熟的 WSGI 服务器，支持多种 Worker 类型。生产配置文件示例：

```python
# gunicorn.conf.py
import multiprocessing
import os

# 核心配置
bind = "0.0.0.0:8000"
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = "uvicorn.workers.UvicornWorker"

# Worker 配置
worker_connections = 1000
max_requests = 10000
max_requests_jitter = 2000
timeout = 120
graceful_timeout = 30
keepalive = 5

# 超时配置
# timeout 是 worker 处理单个请求的最大秒数
# graceful_timeout 是收到重启信号后等待 worker 完成当前请求的时间
# keepalive 是 HTTP keep-alive 连接的超时时间

# 日志配置
accesslog = "-"  # stdout
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(L)s'

# 进程配置
pidfile = "/var/run/gunicorn.pid"
umask = 0o007
user = "app"
group = "app"

# 预加载应用（减少重启时间，但会占用更多内存）
preload_app = True

# 重启配置
reload = False  # 生产环境禁止热重载
reload_extra_files = []


def on_starting(server):
    """服务启动时的钩子"""
    server.log.info("Gunicorn starting up")


def when_ready(server):
    """worker 准备就绪时的钩子"""
    server.log.info("Gunicorn ready to serve")


def on_exit(server):
    """服务退出时的钩子"""
    server.log.info("Gunicorn shutting down")


def worker_int(worker):
    """worker 收到 INT 信号时触发"""
    worker.log.info("Worker received SIGINT")


def worker_abort(worker):
    """worker 超时被终止时触发"""
    worker.log.warning("Worker timeout / aborted")
```

### 2.2 Worker 类型选择

| Worker 类型 | 适用场景 | 依赖 | 特点 |
|-------------|----------|------|------|
| `sync` | 简单 WSGI 应用 | 无 | 每个请求一个进程，适合 IO 密集型 |
| `gevent` | 高并发 WSGI | `gevent` | 协程模型，轻量级上下文切换 |
| `uvicorn` | ASGI 应用（FastAPI） | `uvicorn` | 兼容 WSGI，支持 WebSocket |
| `uvicorn.workers.UvicornWorker` | 生产推荐 | `uvicorn` | 自动配置 ASGI 参数 |
| `aiohttp.worker.GunicornWebWorker` | aiohttp 应用 | `aiohttp` | 原生异步支持 |

```bash
# 根据 CPU 核心数自动计算 worker 数量
# 公式：2 * CPU_CORES + 1
# 使用 gevent 时，每个 worker 可以处理数百个并发连接
gunicorn app.main:app \
    --worker-class gevent \
    --worker-connections 1000 \
    --workers 9 \
    --bind 0.0.0.0:8000

# ASGI 模式（推荐用于 FastAPI / Django Channels）
gunicorn app.main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers 9 \
    --bind 0.0.0.0:8000
```

### 2.3 Uvicorn 直接部署

对于纯 ASGI 应用，可以直接用 Uvicorn 部署，无需 Gunicorn：

```bash
# 基础部署
uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 4 \
    --loop uvloop \
    --http httptools \
    --log-level info

# Unix socket 模式（配合 Nginx）
uvicorn app.main:app \
    --uds /tmp/uvicorn.sock \
    --workers 4
```

Uvicorn 的生产级启动脚本（含 Graceful Shutdown）：

```python
# run.py —— 生产级 Uvicorn 启动器
import asyncio
import signal
import logging
from uvicorn import Config, Server

logger = logging.getLogger("uvicorn.error")


class GracefulServer(Server):
    """支持优雅关闭的 Uvicorn Server"""

    async def shutdown(self, sockets=None):
        logger.info("收到关闭信号，正在优雅关闭...")
        # 停止接受新连接
        for s in self.servers:
            s.close()
        # 等待现有请求完成
        for s in self.servers:
            await s.wait_closed()
        logger.info("所有连接已关闭")


async def main():
    config = Config(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        workers=4,
        loop="uvloop",
        http="httptools",
        log_level="info",
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
    server = GracefulServer(config)

    # 注册信号处理器
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(server.shutdown()))

    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
```

### 2.4 Daphne（Django Channels）

Daphne 是 Django Channels 官方推荐的 ASGI 服务器：

```bash
# 安装
pip install daphne channels

# 启动
daphne -b 0.0.0.0 -p 8000 myproject.asgi:application

# 多进程模式（需搭配 runworker）
daphne -b 0.0.0.0 -p 8000 --proxy-headers myproject.asgi:application
```

### 2.5 性能调优清单

```yaml
# 性能调优建议清单

操作系统层面:
  - ulimit -n 65535       # 增大文件描述符限制
  - net.core.somaxconn=4096  # 增大 TCP 半连接队列
  - net.ipv4.tcp_tw_reuse=1  # 开启 TIME_WAIT 复用

Gunicorn/Uvicorn 层面:
  - workers=2*CPU+1       # worker 数量
  - max_requests=10000    # 防内存泄漏，定期重启 worker
  - worker_class=uvicorn  # ASGI 用 UvicornWorker
  - keepalive=5           # 保持连接

应用层面:
  - 使用 asyncio + uvloop 替代 sync workers
  - 数据库连接池（SQLAlchemy pool_size=10, max_overflow=20）
  - Redis 连接池（block=True, max_connections=50）
  - 缓存热数据（使用 Redis / Memcached）

Nginx 层面:
  - proxy_buffering on
  - proxy_buffers 8 16k
  - client_max_body_size 100m
  - gzip on
```

---

## 3. CI/CD 流水线

### 3.1 GitHub Actions 完整流水线

一个包含测试、构建、部署三阶段的 CI/CD 配置，支持蓝绿部署策略：

```yaml
# .github/workflows/deploy.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
    tags: ["v*"]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}
  APP_NAME: myapp

jobs:
  test:
    name: 🔬 Test
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v3
        with:
          enable-cache: true
          cache-dependency-glob: "uv.lock"

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: uv sync --frozen --group dev

      - name: Lint & Type check
        run: |
          uv run ruff check .
          uv run mypy .

      - name: Run tests with coverage
        run: uv run pytest --cov --cov-report=xml --cov-report=term
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/testdb
          REDIS_URL: redis://localhost:6379/0
          SECRET_KEY: test-key

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage.xml
          fail_ci_if_error: false

  build:
    name: 🐳 Build & Push
    runs-on: ubuntu-latest
    needs: [test]
    if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')
    outputs:
      image_tag: ${{ steps.meta.outputs.tags }}

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=sha,prefix={{branch}}-,format=short
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: 🚀 Deploy
    runs-on: ubuntu-latest
    needs: [build]
    if: github.ref == 'refs/heads/main'
    environment: production

    steps:
      - name: Deploy to production
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            set -e

            # 拉取最新镜像
            docker pull ${{ needs.build.outputs.image_tag }}

            # 蓝绿部署
            BLUE_CONTAINER=$(docker ps -q -f name=${APP_NAME}-blue) || true
            GREEN_CONTAINER=$(docker ps -q -f name=${APP_NAME}-green) || true

            # 确定目标版本
            if [ -n "$BLUE_CONTAINER" ] && [ -z "$GREEN_CONTAINER" ]; then
              TARGET="green"
              PREV="blue"
            elif [ -n "$GREEN_CONTAINER" ] && [ -z "$BLUE_CONTAINER" ]; then
              TARGET="blue"
              PREV="green"
            else
              TARGET="blue"
              PREV=""
            fi

            echo "🚀 部署到 $TARGET"

            # 启动新版本
            docker run -d \
              --name ${APP_NAME}-${TARGET} \
              --network host \
              --restart unless-stopped \
              -e DATABASE_URL="${{ secrets.DATABASE_URL }}" \
              -e REDIS_URL="${{ secrets.REDIS_URL }}" \
              -e SECRET_KEY="${{ secrets.SECRET_KEY }}" \
              ${{ needs.build.outputs.image_tag }}

            # 等待就绪
            echo "⏳ 等待健康检查..."
            for i in {1..30}; do
              if curl -sf http://localhost:8000/healthz > /dev/null 2>&1; then
                echo "✅ 新版本就绪！"
                break
              fi
              sleep 2
            done

            # 切换流量
            # ... (更新 Nginx / LB 配置指向新版本)

            # 停止旧版本
            if [ -n "$PREV" ]; then
              echo "🛑 停止旧版本: $PREV"
              docker stop ${APP_NAME}-${PREV} || true
              docker rm ${APP_NAME}-${PREV} || true
            fi

            # 清理旧镜像
            docker image prune -af --filter "until=24h"
```

### 3.2 环境变量管理

不要将密钥写在代码或 CI 配置中。使用 GitHub Environments + Secrets 进行分级管理：

```yaml
# .github/workflows/deploy.yml 片段
# 每个 environment 可以定义独立的 secrets
jobs:
  deploy-staging:
    environment: staging
    steps:
      - name: Deploy
        run: ./deploy.sh
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          SECRET_KEY: ${{ secrets.SECRET_KEY }}

  deploy-production:
    environment:
      name: production
      url: https://example.com
    steps:
      - name: Deploy
        run: ./deploy.sh
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          SECRET_KEY: ${{ secrets.SECRET_KEY }}
```

本地开发的密钥管理方案：

```bash
# .env 文件（不要提交到 git）
# 使用 python-dotenv 加载
DATABASE_URL=postgresql://user:pass@localhost:5432/myapp
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=dev-secret-key-change-in-production
SENTRY_DSN=
```

```python
# config.py —— 密钥加载
import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 环境感知配置
    environment: str = "development"
    debug: bool = False

    # 数据库
    database_url: str
    redis_url: str

    # 密钥
    secret_key: str
    sentry_dsn: str = ""

    # API
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = ["*"]

    # 限流
    rate_limit_per_minute: int = 60

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False,
    }


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

---

## 4. 进程管理

### 4.1 Systemd 服务

对于裸机或 VM 部署，systemd 是最通用的进程管理方案：

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=MyApp Python Service
After=network.target postgresql.service redis.service
Wants=postgresql.service redis.service

[Service]
Type=notify
User=app
Group=app
WorkingDirectory=/opt/myapp

# 启动命令
ExecStart=/opt/myapp/.venv/bin/gunicorn app.main:app -c gunicorn.conf.py
ExecReload=/bin/kill -s HUP $MAINPID

# 停止与重启策略
TimeoutStopSec=30
KillMode=mixed
Restart=on-failure
RestartSec=5

# 安全限制
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/myapp /var/log/myapp
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# 文件描述符限制
LimitNOFILE=65536
LimitNPROC=4096

# 内存限制（可选）
MemoryMax=2G
MemoryHigh=1.5G

# OOM 评分
OOMScoreAdjust=-500

[Install]
WantedBy=multi-user.target
```

```bash
# 部署命令
sudo systemctl daemon-reload
sudo systemctl enable --now myapp
sudo systemctl status myapp

# 日常管理
sudo systemctl start|stop|restart|reload myapp
sudo journalctl -u myapp -f  # 实时查看日志
sudo journalctl -u myapp --since "1 hour ago"  # 最近一小时日志
```

### 4.2 Supervisor

Supervisor 是经典的 Python 进程管理工具，适合管理多个 worker 进程：

```ini
# /etc/supervisor/conf.d/myapp.conf
[program:myapp]
command=/opt/myapp/.venv/bin/gunicorn app.main:app -c gunicorn.conf.py
directory=/opt/myapp
user=app
autostart=true
autorestart=true
startsecs=5
startretries=3
stopwaitsecs=30
stopsignal=TERM

# 环境变量
environment=
    PATH="/opt/myapp/.venv/bin:%(ENV_PATH)s",
    DATABASE_URL="postgresql://user:pass@localhost:5432/myapp",
    REDIS_URL="redis://localhost:6379/0",
    SECRET_KEY="%(ENV_SECRET_KEY)s"

# 日志
stdout_logfile=/var/log/myapp/access.log
stdout_logfile_maxbytes=50MB
stdout_logfile_backups=7
stderr_logfile=/var/log/myapp/error.log
stderr_logfile_maxbytes=50MB
stderr_logfile_backups=7

# 进程数量（多 worker 场景）
process_name=%(program_name)s_%(process_num)02d
numprocs=1

[group:myapp]
programs=myapp
```

```bash
# Supervisor 管理命令
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status
sudo supervisorctl start|stop|restart myapp
sudo supervisorctl tail -f myapp  # 查看日志
```

### 4.3 信号处理与优雅关闭

HTTP 服务器的优雅关闭核心步骤：
1. 停止接受新请求（关闭监听 socket）
2. 等待正在处理的请求完成（带超时）
3. 关闭数据库连接池、Redis 连接等资源
4. 退出进程

```python
# app/shutdown.py —— 优雅关闭的实现
import asyncio
import signal
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from elasticapm.contrib.starlette import make_apm_client
from prometheus_client import Counter

logger = logging.getLogger(__name__)

# Prometheus 指标
shutdown_counter = Counter("app_shutdown_total", "Total shutdown events")


class GracefulShutdown:
    def __init__(self, timeout: int = 30):
        self._timeout = timeout
        self._shutdown_event = asyncio.Event()

    async def wait_for_shutdown(self) -> None:
        """等待关闭信号"""
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(
                sig, lambda: asyncio.create_task(self._trigger_shutdown())
            )
        logger.info("等待关闭信号...")
        await self._shutdown_event.wait()

    async def _trigger_shutdown(self) -> None:
        shutdown_counter.inc()
        logger.warning("收到关闭信号，开始优雅关闭...")
        self._shutdown_event.set()

    async def shutdown_resources(self, db_pool, redis_pool) -> None:
        """带超时的资源清理"""
        try:
            async with asyncio.timeout(self._timeout):
                logger.info("关闭数据库连接池...")
                if db_pool:
                    await db_pool.close()

                logger.info("关闭 Redis 连接池...")
                if redis_pool:
                    await redis_pool.close()

                logger.info("所有资源已释放")
        except asyncio.TimeoutError:
            logger.error("资源清理超时，强制退出")


# FastAPI lifespan 示例
@asynccontextmanager
async def lifespan(app) -> AsyncGenerator[None, None]:
    """FastAPI 应用生命周期管理"""
    db_pool = await create_db_pool()
    redis_pool = await create_redis_pool()

    shutdown_handler = GracefulShutdown(timeout=30)

    async def shutdown():
        await shutdown_handler.shutdown_resources(db_pool, redis_pool)

    yield {"db": db_pool, "redis": redis_pool}
    await shutdown()
```

### 4.4 日志收集

结构化日志（JSON 格式）是生产环境中对接日志系统的前提：

```python
# app/logging_config.py —— 结构化日志配置
import json
import logging
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """输出 JSON 格式的日志，便于 Logstash / Loki 等系统采集"""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "service": "myapp",
        }

        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id
        if hasattr(record, "user_id"):
            log_entry["user_id"] = record.user_id
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
            }

        return json.dumps(log_entry, ensure_ascii=False)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    # 减少第三方库的噪音
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


# 使用方式——在应用入口调用
# from app.logging_config import setup_logging
# setup_logging()
```

日志输出效果：

```json
{"timestamp": "2026-06-12T10:30:00.123456+00:00", "level": "ERROR", "logger": "app.routes.users", "message": "数据库连接失败", "module": "users", "function": "get_user", "line": 42, "service": "myapp", "request_id": "abc-123-def", "exception": {"type": "OperationalError", "message": "could not connect to server"}}
```

---

## 5. 监控与可观测性

### 5.1 Prometheus 指标导出

```python
# app/metrics.py —— 自定义 Prometheus 指标
from prometheus_client import Counter, Histogram, Gauge, generate_latest
from prometheus_client import REGISTRY, CONTENT_TYPE_LATEST
import time
from functools import wraps
from typing import Callable

# === HTTP 相关指标 ===
http_requests_total = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)

http_request_duration_seconds = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

http_in_flight_requests = Gauge(
    "http_in_flight_requests",
    "Current number of HTTP requests in flight",
    ["method"],
)

# === 业务指标 ===
active_users = Gauge("active_users", "Currently active users")
total_orders = Counter("total_orders", "Total orders placed")
db_query_duration = Histogram(
    "db_query_duration_seconds",
    "Database query duration",
    ["query_type"],
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0),
)

# === 系统指标 ===
worker_count = Gauge("worker_count", "Number of active workers")


def track_request_metrics(func: Callable) -> Callable:
    """装饰器：自动记录 HTTP 请求指标"""

    @wraps(func)
    async def wrapper(request, *args, **kwargs):
        method = request.method
        endpoint = request.url.path

        http_in_flight_requests.labels(method=method).inc()

        start = time.time()
        try:
            response = await func(request, *args, **kwargs)
            status = response.status_code
            return response
        except Exception as e:
            status = 500
            raise
        finally:
            duration = time.time() - start
            http_requests_total.labels(method=method, endpoint=endpoint, status=status).inc()
            http_request_duration_seconds.labels(method=method, endpoint=endpoint).observe(duration)
            http_in_flight_requests.labels(method=method).dec()

    return wrapper


def metrics_endpoint():
    """暴露 /metrics 端点供 Prometheus 抓取"""
    from starlette.responses import Response
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


# 在路由中挂载
# @app.get("/metrics")
# async def metrics():
#     return metrics_endpoint()
```

对应的 Prometheus 抓取配置：

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "myapp"
    static_configs:
      - targets: ["localhost:8000"]
    metrics_path: /metrics
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
        replacement: "production"
```

### 5.2 OpenTelemetry 分布式追踪

OpenTelemetry 是目前最完善的遥测数据采集标准，支持 Tracing / Metrics / Logs：

```python
# app/telemetry.py —— OpenTelemetry 配置
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource


def setup_opentelemetry(
    service_name: str = "myapp",
    otlp_endpoint: str = "http://otel-collector:4317",
) -> trace.Tracer:
    """配置 OpenTelemetry SDK"""

    resource = Resource(attributes={SERVICE_NAME: service_name})

    provider = TracerProvider(resource=resource)

    # OTLP gRPC 导出器（发送到 OpenTelemetry Collector）
    otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

    # 设置全局 TracerProvider
    trace.set_tracer_provider(provider)

    return trace.get_tracer(__name__)


def instrument_app(app) -> None:
    """自动插桩 FastAPI 应用"""

    # FastAPI 自动插桩
    FastAPIInstrumentor.instrument_app(app)

    # HTTP 请求追踪
    RequestsInstrumentor().instrument()

    # 数据库追踪（如果使用 SQLAlchemy）
    # SQLAlchemyInstrumentor().instrument()

    print("✅ OpenTelemetry 插桩完成")


# 使用方式
# from app.telemetry import setup_opentelemetry, instrument_app
# setup_opentelemetry()
# instrument_app(app)
```

### 5.3 结构化日志与 AlertManager 告警

结合结构化日志和 Prometheus 告警规则，实现自动化告警：

```yaml
# alertmanager.yml 告警规则
groups:
  - name: myapp_alerts
    rules:
      # 高错误率告警
      - alert: HighErrorRate
        expr: |
          rate(http_requests_total{status=~"5.."}[5m])
          /
          rate(http_requests_total[5m])
          > 0.05
        for: 3m
        labels:
          severity: critical
        annotations:
          summary: "5xx 错误率过高"
          description: "当前 5xx 错误率 > 5%，持续 3 分钟以上"

      # 请求延迟告警
      - alert: HighLatency
        expr: |
          histogram_quantile(0.95,
            rate(http_request_duration_seconds_bucket[5m])
          ) > 1.0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "响应延迟过高"
          description: "P95 响应时间 > 1 秒，持续 5 分钟以上"

      # 连接池耗尽告警
      - alert: DBPoolExhausted
        expr: |
          db_query_duration_seconds_count > 0
          and on()
          avg(db_query_duration_seconds) > 2.0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "数据库连接池可能耗尽"
          description: "平均查询时间 > 2 秒"

      # 实例宕机告警
      - alert: InstanceDown
        expr: up{job="myapp"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "实例 {{ $labels.instance }} 宕机"

      # Worker 异常告警
      - alert: WorkerCountDrop
        expr: worker_count < 2
        for: 30s
        labels:
          severity: warning
        annotations:
          summary: "Worker 数量异常"
          description: "当前 worker 数 < 2"
```

```python
# app/alerts.py —— 应用内告警指标采集
import time
from dataclasses import dataclass, field
from typing import Dict, List
from prometheus_client import Counter, Gauge, Histogram

# 定义告警阶段指标
alert_fired = Counter("app_alerts_fired_total", "Total alerts fired", ["alert_type"])
recovery_time = Histogram(
    "app_recovery_time_seconds", "Time to recover from alerts", ["alert_type"]
)


@dataclass
class AlertManager:
    """应用内轻量级告警检测器"""

    thresholds: Dict[str, float] = field(default_factory=lambda: {
        "error_rate": 0.05,
        "p95_latency": 1.0,
        "db_timeout": 2.0,
    })
    _state: Dict[str, bool] = field(default_factory=dict)

    def check_error_rate(self, error_count: int, total_count: int) -> str | None:
        rate = error_count / max(total_count, 1)
        if rate > self.thresholds["error_rate"]:
            alert_fired.labels(alert_type="high_error_rate").inc()
            return "high_error_rate"
        return None

    def check_latency(self, p95: float) -> str | None:
        if p95 > self.thresholds["p95_latency"]:
            alert_fired.labels(alert_type="high_latency").inc()
            return "high_latency"
        return None

    def alert_if_needed(self) -> List[str]:
        """轮询检测所有告警条件"""
        active_alerts: List[str] = []
        # 假设从 Prometheus 查询最新数据
        # error_rate = query("rate(http_requests_total...")
        # if result := self.check_error_rate(error_rate, total):
        #     active_alerts.append(result)
        return active_alerts
```

---

## 6. 安全实践

### 6.1 依赖审计

```bash
# pip-audit —— 扫描已知漏洞
pip install pip-audit
pip-audit --requirement requirements.txt
pip-audit --requirement requirements.txt --format json > audit-report.json

# 在 CI 中阻断漏洞依赖
# pip-audit --fail-on P67899 --require-hashes

# Bandit —— Python 代码安全扫描
pip install bandit
bandit -r app/ -f json -o bandit-report.json
bandit -r app/ -ll  # 仅报告中高严重性问题

# Safety —— 另一个依赖扫描工具
pip install safety
safety check -r requirements.txt
```

在 CI 中集成：

```yaml
# .github/workflows/security.yml
name: Security Scan

on:
  schedule:
    - cron: "0 6 * * 1"  # 每周一 6:00 UTC
  push:
    paths:
      - "requirements.txt"
      - "pyproject.toml"
      - "**/*.py"

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v3

      - name: Security audit
        run: |
          uv tool install pip-audit
          uv tool run pip-audit --requirement requirements.txt --fail-on P67899

      - name: Static analysis
        run: |
          uv tool install bandit
          uv tool run bandit -r app/ -ll -x tests/
```

### 6.2 密钥管理——永不将密钥写入代码

```python
# config.py —— 密钥的多种加载方式
import os
import json
from functools import lru_cache

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    boto3 = None

try:
    import hvac  # HashiCorp Vault
except ImportError:
    hvac = None


class SecretsManager:
    """统一的密钥管理器，支持多种后端"""

    def __init__(self):
        self._backend = self._detect_backend()

    def _detect_backend(self) -> str:
        """自动检测可用后端"""
        if os.getenv("VAULT_ADDR"):
            return "vault"
        if os.getenv("AWS_DEFAULT_REGION") and boto3:
            return "aws_secretsmanager"
        if os.getenv("KUBERNETES_SERVICE_HOST"):
            return "kubernetes"
        return "env"  # 回退到环境变量

    def get_secret(self, key: str) -> str:
        value = os.getenv(key)
        if value:
            return value

        if self._backend == "aws_secretsmanager":
            return self._from_aws(key)
        elif self._backend == "vault":
            return self._from_vault(key)
        elif self._backend == "kubernetes":
            return self._from_k8s(key)

        raise ValueError(f"Secret {key} not found")

    def _from_aws(self, secret_id: str) -> str:
        if not boto3:
            raise RuntimeError("boto3 not installed")
        client = boto3.client("secretsmanager")
        try:
            response = client.get_secret_value(SecretId=secret_id)
            return response["SecretString"]
        except ClientError as e:
            raise RuntimeError(f"AWS Secrets Manager error: {e}")

    def _from_vault(self, path: str) -> str:
        if not hvac:
            raise RuntimeError("hvac not installed")
        client = hvac.Client(
            url=os.getenv("VAULT_ADDR"),
            token=os.getenv("VAULT_TOKEN"),
        )
        secret = client.secrets.kv.v2.read_secret_version(path=path)
        return secret["data"]["data"][path.split("/")[-1]]

    def _from_k8s(self, key: str) -> str:
        path = f"/etc/secrets/{key}"
        if os.path.exists(path):
            with open(path) as f:
                return f.read().strip()
        raise FileNotFoundError(f"K8s secret file {path} not found")


secrets = SecretsManager()

# 使用方式
# database_url = secrets.get_secret("DATABASE_URL")
# secret_key = secrets.get_secret("SECRET_KEY")
```

### 6.3 HTTPS 配置

Nginx 反向代理 + Let's Encrypt 是标准的 HTTPS 部署方案：

```nginx
# nginx/nginx.conf
upstream myapp {
    server 127.0.0.1:8000;
    keepalive 64;
}

# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

# HTTPS 服务
server {
    listen 443 ssl http2;
    server_name example.com;

    # 证书路径
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    # 现代 TLS 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS (HTTP Strict Transport Security)
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # 安全头
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" always;

    # 反向代理到 Gunicorn
    location / {
        proxy_pass http://myapp;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时配置
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
        proxy_send_timeout 60s;

        # 缓冲
        proxy_buffering on;
        proxy_buffers 8 16k;
        proxy_buffer_size 4k;
        proxy_busy_buffers_size 64k;
    }

    # 静态文件直接由 Nginx 处理
    location /static/ {
        alias /opt/myapp/static/;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # Let's Encrypt 验证
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 日志
    access_log /var/log/nginx/myapp.access.log;
    error_log /var/log/nginx/myapp.error.log warn;
}
```

### 6.4 Python 安全中间件

```python
# app/middleware/security.py
import time
import hashlib
import hmac
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """添加安全响应头的中间件"""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Content Security Policy
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none';"
        )

        # 非 HTTPS 环境不发送 HSTS
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )

        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """简单的内存限流中间件（生产环境推荐使用 Redis）"""

    def __init__(self, app, max_requests: int = 60, window: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window
        self._requests: dict[str, list[float]] = {}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 健康检查不限制
        if request.url.path in ("/healthz", "/metrics"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()

        # 清理过期记录
        self._requests[client_ip] = [
            t for t in self._requests.get(client_ip, [])
            if now - t < self.window
        ]

        if len(self._requests[client_ip]) >= self.max_requests:
            return Response(
                content='{"detail": "Too Many Requests"}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(int(self.window))},
            )

        self._requests[client_ip].append(now)
        return await call_next(request)


# 在 FastAPI 中注册
# app.add_middleware(SecurityHeadersMiddleware)
# app.add_middleware(RateLimitMiddleware, max_requests=60, window=60)
```

### 6.5 依赖锁定与签名验证

```bash
# 生成哈希锁定的 requirements.txt
uv pip compile pyproject.toml --generate-hashes -o requirements-lock.txt

# 或使用 pip-tools
pip-compile --generate-hashes pyproject.toml -o requirements-lock.txt

# 安装时验证哈希
pip install --require-hashes -r requirements-lock.txt

# 使用 pip-audit 在 CI 中强制拒绝已知漏洞
pip-audit --require-hashes -r requirements-lock.txt --fail-on P67899
```

---

## 附录：部署检查清单

```markdown
# 部署前检查清单

## 🔐 安全
- [ ] 所有密钥已配置（不在代码中硬编码）
- [ ] HTTPS 证书已部署且未过期
- [ ] 安全头已配置（HSTS, CSP, X-Frame-Options 等）
- [ ] 依赖审计已通过（pip-audit / bandit）
- [ ] CORS 已限制为具体域名（非 `*`）
- [ ] 数据库密码强度符合要求

## 🐳 容器化
- [ ] 使用多阶段构建，最终镜像 < 500MB
- [ ] 使用非 root 用户运行
- [ ] 健康检查端点已实现并配置
- [ ] 日志输出到 stdout / stderr
- [ ] `.dockerignore` 已配置

## ⚙️ 配置
- [ ] 环境变量按 environment 分级管理
- [ ] Worker 数量计算公式已填写：2 * CPU_CORES + 1
- [ ] 超时参数已根据实际业务调整
- [ ] 日志级别可通过环境变量控制

## 📊 可观测性
- [ ] Prometheus /metrics 端点已暴露
- [ ] 关键业务指标已埋点
- [ ] 请求延迟 Histogram 已配置
- [ ] 告警规则已部署
- [ ] 日志为 JSON 格式，可被日志系统采集

## 🚀 CI/CD
- [ ] 测试阶段包含 lint + type check + unit test
- [ ] 构建阶段利用 Docker 层缓存
- [ ] 部署策略已确定（蓝绿 / 滚动更新）
- [ ] 回滚方案已记录
- [ ] 数据库迁移脚本已准备
```
