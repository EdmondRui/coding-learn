# Python Web 开发基础

> 适用人群：已掌握 Python 语法基础，了解装饰器与上下文管理。
> 从 WSGI/ASGI 规范出发深入 Web 框架底层，不讲解 "什么是 HTTP" 入门内容。

---

## 1. WSGI 规范深度解析

### 1.1 接口定义

WSGI（PEP 3333）定义了 Python Web 服务器与应用程序之间的标准接口。核心是**一个可调用对象**：

```python
def application(environ: dict, start_response: callable) -> list[bytes]:
    start_response("200 OK", [("Content-Type", "text/plain; charset=utf-8")])
    return [b"Hello, WSGI World!"]
```

- **`environ`**: 包含所有请求信息的 `dict`（CGI 风格变量 + WSGI 扩展变量）。
- **`start_response(status, headers, exc_info=None)`**: 设置响应状态码和头，返回 `write` 可调用（遗留 API，现代用法只关注调用本身）。
- **返回值**: `Iterable[bytes]`，响应体字节块可迭代对象。

### 1.2 environ 字典结构

```python
environ = {
    "REQUEST_METHOD": "POST", "PATH_INFO": "/api/users",
    "QUERY_STRING": "page=1", "SERVER_PROTOCOL": "HTTP/1.1",
    "HTTP_HOST": "example.com", "CONTENT_TYPE": "application/json",
    "CONTENT_LENGTH": "42", "REMOTE_ADDR": "192.168.1.100",
    "wsgi.version": (1, 0), "wsgi.url_scheme": "http",
    "wsgi.input": io.BytesIO(b'{"name": "Alice"}'),
}
```

关键点：
- 请求头转换规则：`HTTP_` 前缀 + 大写 + `-` 替换为 `_`。
- `CONTENT_TYPE` 和 `CONTENT_LENGTH` **不含** `HTTP_` 前缀。
- `wsgi.input` 是 `BufferedReader`，用 `.read()` 读取请求体。

### 1.3 wsgiref 内部原理

```python
from wsgiref.simple_server import make_server

def app(environ, start_response):
    start_response("200 OK", [("Content-Type", "text/plain")])
    return [b"Hello, World!\n"]

make_server("", 8000, app).serve_forever()
```

`BaseHandler.run()` 的简化流程：**构建 environ → 封装 start_response 闭包 → result = application(...) → 迭代 result 发送响应体 → 调用 result.close() 清理**。

### 1.4 WSGI 中间件模式

中间件是**同时实现服务器端和应用程序端接口**的可调用对象，对内是应用，对外是服务器：

```python
class LoggingMiddleware:
    def __init__(self, app): self.app = app
    def __call__(self, environ, start_response):
        method, path = environ["REQUEST_METHOD"], environ["PATH_INFO"]
        print(f"[REQ] {method} {path}")
        def custom_sr(status, headers, exc_info=None):
            print(f"[RES] {method} {path} -> {status}")
            return start_response(status, headers, exc_info)
        return self.app(environ, custom_sr)

def auth_middleware(app):
    def wrapped(environ, start_response):
        if not environ.get("HTTP_AUTHORIZATION", "").startswith("Bearer "):
            start_response("401 Unauthorized", [("Content-Type", "text/plain")])
            return [b"Unauthorized"]
        environ["REMOTE_USER"] = "alice"
        return app(environ, start_response)
    return wrapped

# 洋葱模型：请求从外向内穿透，响应从内向外返回
app = auth_middleware(LoggingMiddleware(raw_app))
```

---

## 2. ASGI 规范与异步 Web

### 2.1 ASGI 接口

ASGI（PEP 4843 / 6502）通过事件驱动支持 HTTP、WebSocket 和生命周期三种模式。核心签名如下：

```python
async def application(scope: dict, receive: callable, send: callable) -> None:
    await receive()
    await send({"type": "http.response.start", "status": 200,
                "headers": [(b"content-type", b"text/plain; charset=utf-8")]})
    await send({"type": "http.response.body", "body": b"Hello, ASGI!"})
```

**与 WSGI 核心差异**：WSGI 是 `callable → return iterable` 的同步模型；ASGI 是 `callable → await send/receive` 的异步事件驱动模型。

### 2.2 scope 与事件驱动

```python
scope = {"type": "http", "method": "POST", "path": "/api/users",
         "headers": [(b"host", b"example.com")]}
```

请求体通过事件流分块接收：

```python
async def http_app(scope, receive, send):
    body = b""
    more_body = True
    while more_body:
        event = await receive()
        if event["type"] == "http.request":
            body += event.get("body", b"")
            more_body = event.get("more_body", False)
    await send({"type": "http.response.start", "status": 200,
                "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": b'{"ok": true}'})
```

### 2.3 WebSocket 支持

ASGI 原生支持 WebSocket，这在 WSGI 中不可能实现：

```python
async def ws_app(scope, receive, send):
    await send({"type": "websocket.accept"})
    while True:
        event = await receive()
        if event["type"] == "websocket.receive":
            await send({"type": "websocket.send",
                        "text": f"Echo: {event.get('text')}"})
        elif event["type"] == "websocket.disconnect": break
```

### 2.4 ASGI 中间件

```python
class ASGILoggingMiddleware:
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http": return await self.app(scope, receive, send)
        print(f"[ASGI] {scope['method']} {scope['path']}")
        async def logged_send(event):
            if event["type"] == "http.response.start": print(f"-> {event['status']}")
            await send(event)
        await self.app(scope, receive, logged_send)
```

### 2.5 WSGI vs ASGI 对比

| 维度 | WSGI | ASGI |
|------|------|------|
| 标准 | PEP 3333 | PEP 4843 / 6502 |
| 并发模型 | 线程/进程 | 异步事件循环 |
| 接口风格 | `callable → Iterable[bytes]` | `callable → await send/receive` |
| 请求体 | `wsgi.input.read()` | `await receive()` 事件驱动 |
| 流式响应 | yield chunk | 多次 `send` + `more_body` |
| WebSocket | 不支持 | 原生支持 |
| 框架 | Flask, Django | FastAPI, Starlette |
| 服务器 | Gunicorn, uWSGI | Uvicorn, Daphne |

---

## 3. HTTP 协议深度

### 3.1 请求方法语义

HTTP 方法的**安全性和幂等性约束**：

```python
HTTP_SEMANTICS = {
    "GET":    {"safe": True,  "idempotent": True},
    "HEAD":   {"safe": True,  "idempotent": True},
    "POST":   {"safe": False, "idempotent": False},
    "PUT":    {"safe": False, "idempotent": True},
    "PATCH":  {"safe": False, "idempotent": False},
    "DELETE": {"safe": False, "idempotent": True},
}
```

- **安全方法**（GET/HEAD/OPTIONS）：不应修改服务端状态。
- **幂等方法**（GET/PUT/DELETE）：多次执行结果相同，可安全重试。

### 3.2 状态码设计

```python
from enum import IntEnum

class HTTPStatus(IntEnum):
    OK = 200; CREATED = 201; NO_CONTENT = 204
    BAD_REQUEST = 400; UNAUTHORIZED = 401; FORBIDDEN = 403
    NOT_FOUND = 404; CONFLICT = 409; UNPROCESSABLE_ENTITY = 422
    TOO_MANY_REQUESTS = 429; INTERNAL_SERVER_ERROR = 500
```

原则：2xx 成功，3xx 重定向，4xx 客户端错误，5xx 服务器错误。

### 3.3 Content-Type 与内容协商

```python
class ContentNegotiator:
    RENDERERS = {"application/json": json.dumps,
                 "text/html": lambda d: f"<pre>{d}</pre>".encode()}
    @classmethod
    def negotiate(cls, accept: str) -> str:
        if not accept: return "application/json"
        entries = []
        for part in accept.split(","):
            part = part.strip(); q = 1.0
            if ";q=" in part: part, _, q_str = part.partition(";q="); q = float(q_str)
            entries.append((q, part))
        entries.sort(key=lambda x: -x[0])
        for q, mime in entries:
            if mime in cls.RENDERERS: return mime
        return "application/json"
# Accept: text/html;q=0.8, application/json;q=1.0 → "application/json"
```

### 3.4 Cookie / Session 机制

Cookie 通过 `Set-Cookie` 响应头让客户端保存键值对。生产环境需 HMAC 签名防篡改：

```python
import hmac, hashlib, time, secrets
from urllib.parse import quote, unquote

class SecureCookie:
    def __init__(self, secret: str): self.secret = secret.encode()
    def bake(self, name: str, value: str, max_age=3600) -> str:
        expires = int(time.time()) + max_age
        payload = f"{value}|{expires}"
        sig = hmac.new(self.secret, payload.encode(), hashlib.sha256).hexdigest()
        return "; ".join([f"{name}={quote(f'{payload}|{sig}')}",
                          f"Max-Age={max_age}", "Path=/"])
    def parse(self, header: str) -> dict[str, str]:
        cookies = {}
        if not header: return cookies
        for item in header.split(";"):
            if "=" not in item: continue
            name, _, raw = item.strip().partition("=")
            try:
                decoded = unquote(raw); v, exp, sig = decoded.rsplit("|", 2)
                if time.time() > int(exp): continue
                expected = hmac.new(self.secret, f"{v}|{exp}".encode(),
                                    hashlib.sha256).hexdigest()
                if hmac.compare_digest(sig, expected): cookies[name] = v
            except (ValueError, KeyError): continue
        return cookies
```

Session 用 Cookie 存 session ID，数据放服务端：

```python
class SessionStore:
    def __init__(self): self._store = {}
    def create_session(self, data=None) -> str:
        sid = secrets.token_hex(32)
        self._store[sid] = {"data": data or {}, "created": time.time()}
        return sid
    def get_session(self, sid: str) -> dict | None:
        rec = self._store.get(sid)
        return rec["data"] if rec and time.time() - rec["created"] < 86400 else None
```

### 3.5 CORS 策略

```python
def cors_headers(environ) -> list[tuple] | None:
    origin = environ.get("HTTP_ORIGIN", "")
    if origin not in {"https://app.example.com"}: return None
    if environ["REQUEST_METHOD"] == "OPTIONS":
        return [("Access-Control-Allow-Origin", origin),
                ("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE"),
                ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
                ("Access-Control-Allow-Credentials", "true"),
                ("Access-Control-Max-Age", "86400")]
    return [("Access-Control-Allow-Origin", origin)]
```

| 请求头 | 响应头 |
|---|---|
| `Origin` | `Access-Control-Allow-Origin` |
| `Access-Control-Request-Method` | `Access-Control-Allow-Methods` |
| 附带 Cookie | `Access-Control-Allow-Credentials: true` |

---

## 4. 中间件模式

### 4.1 中间件本质

Web 中间件是**装饰器模式的框架级应用**，将跨切面关注点从业务逻辑剥离：

```python
class MiddlewareChain:
    def __init__(self, core_app): self.core = core_app; self._mws = []
    def add(self, mw_cls, **opts): self._mws.append((mw_cls, opts)); return self
    def build(self):
        app = self.core
        for mw_cls, opts in reversed(self._mws): app = mw_cls(app, **opts)
        return app
```

### 4.2 日志 + 错误处理

```python
import functools, time, logging, json, threading
from collections import defaultdict

def request_logger(app):
    @functools.wraps(app)
    def wrapped(environ, start_response):
        req_id = environ.get("HTTP_X_REQUEST_ID", "no-id")
        method, path = environ["REQUEST_METHOD"], environ["PATH_INFO"]
        start = time.time()
        def logged_sr(status, headers, exc_info=None):
            logging.info("[%s] %s %s -> %s (%dms)", req_id, method, path,
                         status, int((time.time() - start) * 1000))
            return start_response(status, headers, exc_info)
        try: return app(environ, logged_sr)
        except Exception:
            logging.exception("[%s] %s %s FAILED", req_id, method, path)
            start_response("500 Internal Server Error", [("Content-Type", "text/plain")])
            return [b"Internal Server Error"]
    return wrapped

class ErrorHandlingMiddleware:
    def __init__(self, app, debug=False): self.app, self.debug = app, debug
    def __call__(self, environ, start_response):
        try: return self.app(environ, start_response)
        except Exception as e:
            msg = str(e) if self.debug else "Internal Server Error"
            body = json.dumps({"error": True, "message": msg}).encode()
            start_response("500 Internal Server Error",
                           [("Content-Type", "application/json")])
            return [body]
```

### 4.3 限流中间件

```python
class RateLimitMiddleware:
    def __init__(self, app, max_req=100, window=60):
        self.app, self.max_req, self.win = app, max_req, window
        self._buckets = defaultdict(list); self._lock = threading.Lock()
    def _allow(self, ip: str) -> bool:
        now = time.time()
        with self._lock:
            bucket = self._buckets[ip]
            bucket[:] = [t for t in bucket if t > now - self.win]
            if len(bucket) >= self.max_req: return False
            bucket.append(now); return True
    def __call__(self, environ, start_response):
        if not self._allow(environ.get("REMOTE_ADDR", "")):
            start_response("429 Too Many Requests", [("Content-Type", "application/json")])
            return [json.dumps({"error": "Too Many Requests"}).encode()]
        return self.app(environ, start_response)

# 组合使用
app = MiddlewareChain(core_app).add(RateLimitMiddleware, max_req=60) \
    .add(ErrorHandlingMiddleware, debug=True).add(request_logger).build()
```

---

## 5. 请求生命周期

### 5.1 完整链路

```python
# TCP Connect → HTTP Parse → Environ Build → Route Match
# → Middleware Chain → App Logic → Serialize → TCP Send

raw = (b"POST /api/users HTTP/1.1\r\nHost: example.com\r\n"
       b"Content-Length: 18\r\n\r\n{\"name\": \"Alice\"}")
req_line, rest = raw.split(b"\r\n", 1)
method, path, _ = req_line.decode().split()
hdr_raw, _, body = rest.partition(b"\r\n\r\n")
environ = {"REQUEST_METHOD": method, "PATH_INFO": path.split("?")[0],
           "wsgi.input": io.BytesIO(body)}
```

### 5.2 路由匹配原理

```python
import re

class Router:
    def __init__(self): self._routes = []
    def add(self, method, pattern, handler):
        regex = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern)
        self._routes.append((method.upper(), re.compile(f"^{regex}$"), handler))

    def __call__(self, environ, start_response):
        for m, pat, handler in self._routes:
            if environ["REQUEST_METHOD"] != m and m != "ANY": continue
            match = pat.match(environ["PATH_INFO"])
            if match:
                environ["ROUTE_PARAMS"] = match.groupdict()
                return handler(environ, start_response)
        start_response("404 Not Found", [("Content-Type", "text/plain")])
        return [b"Not Found"]
# /users/42 → ROUTE_PARAMS = {"user_id": "42"}
```

### 5.3 请求上下文

```python
import threading, contextvars

class ThreadSafeContext:
    """线程安全请求上下文（WSGI）"""
    _local = threading.local()
    @classmethod
    def init(cls, environ):
        cls._local.request_id = environ.get("HTTP_X_REQUEST_ID", "")
        cls._local.path = environ["PATH_INFO"]
    @classmethod
    def get(cls):
        return {"request_id": getattr(cls._local, "request_id", "unknown"),
                "path": getattr(cls._local, "path", "/")}

# 协程安全版本（ASGI 场景用 contextvars）
req_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("request_id")
```

### 5.4 资源生命周期管理

```python
import contextlib

class ConnPool:
    def __init__(self, max_conn=10):
        self._sem = threading.Semaphore(max_conn)
        self._conns = threading.local()
    @contextlib.contextmanager
    def acquire(self):
        self._sem.acquire()
        try:
            self._conns.current = object()
            yield self._conns.current
        finally:
            self._sem.release(); del self._conns.current

class RequestLifecycle:
    def __init__(self, app, pool): self.app, self.pool = app, pool
    def __call__(self, environ, start_response):
        ThreadSafeContext.init(environ)                     # 1. 建立上下文
        with self.pool.acquire() as conn:                   # 2. 获取连接
            environ["db.conn"] = conn
            return self.app(environ, start_response)        # 3. 处理（自动释放）
```

### 5.5 并发安全

```python
class ThreadSafeCounter:
    def __init__(self): self._count = 0; self._lock = threading.Lock()
    def inc(self) -> int:
        with self._lock: self._count += 1; return self._count

class AsyncSafeCounter:
    def __init__(self): self._count = 0; self._lock = asyncio.Lock()
    async def inc(self) -> int:
        async with self._lock: self._count += 1; return self._count
```

---

## 总结

| 规范 | 适用场景 | 服务器 | 框架 |
|------|---------|--------|------|
| WSGI | 同步 API、传统项目 | Gunicorn, uWSGI | Flask, Django |
| ASGI | 异步、WebSocket、SSE | Uvicorn, Daphne | FastAPI, Starlette |

选择建议：
- **已有同步代码库** → WSGI + Gunicorn，通过 `ThreadPoolExecutor` 提升并发。
- **新项目** → ASGI + Uvicorn，同步代码可通过 `sync_to_async` 适配。
- **需要 WebSocket / SSE / 长连接** → 必须 ASGI。

理解这些底层规范后，你将能更自由地选择框架、排查性能瓶颈、甚至编写自己的 Web 框架。
