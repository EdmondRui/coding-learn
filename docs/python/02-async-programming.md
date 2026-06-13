# Python 异步编程

## 1. asyncio 核心机制

### 1.1 事件循环原理

`asyncio` 的核心是**事件循环（Event Loop）**——一个不断轮询任务队列、调度协程执行的运行时。可以把事件循环理解为操作系统内核的简化版：它维护一组待执行的任务，每次迭代从中取出可执行的任务，执行到该任务主动让出控制权（`await`），然后继续处理下一个任务。

```python
import asyncio

# Python 3.10+ 推荐用 asyncio.run() 自动创建与管理事件循环
async def demo():
    print("Hello")
    await asyncio.sleep(1)  # 主动让出控制权 1 秒
    print("World")

asyncio.run(demo())

# 底层等价形式（理解事件循环的生命周期）
async def low_level_demo():
    loop = asyncio.get_running_loop()
    print(f"当前事件循环: {loop}")
    print(f"循环是否运行中: {loop.is_running()}")

asyncio.run(low_level_demo())
```

事件循环的生命周期由 `asyncio.run()` 自动管理：创建新循环 → 设置为当前循环 → 运行传入的协程 → 关闭循环。在 Python 3.10+ 中，`asyncio.run()` 还会在结束时清理所有未完成的任务，避免资源泄漏。

### 1.2 async / await 语法

`async def` 定义一个**协程函数**，调用它返回一个**协程对象**。协程对象只有被事件循环调度才能执行，而 `await` 是触发调度的唯一方式。

```python
async def fetch_data():
    return 42

coro = fetch_data()          # 不会执行，只是创建协程对象
print(type(coro))            # <class 'coroutine'>

result = await coro          # 必须 await 才能拿到结果
```

一个常见的误解是 `async` 函数是"并行"的。实际上，`await` 只在当前协程内部挂起，让事件循环有机会调度**其他**协程。单线程内的多协程是**并发（concurrency）**而非**并行（parallelism）**。

```python
async def step(name, delay):
    print(f"{name}: start")
    await asyncio.sleep(delay)
    print(f"{name}: end after {delay}s")
    return delay

async def sequential():
    # 顺序执行 — 总耗时 3 秒
    await step("A", 1)
    await step("B", 2)

async def concurrent():
    # 并发执行 — 总耗时约 2 秒
    task_a = asyncio.create_task(step("A", 1))
    task_b = asyncio.create_task(step("B", 2))
    await task_a
    await task_b
```

### 1.3 Task 与 Coroutine

`Task` 是协程的包装器，它**立即被调度**到事件循环中，而不会阻塞当前协程的创建点。

| 概念 | 说明 | 何时使用 |
|------|------|----------|
| `Coroutine` | `async def` 返回的对象 | 直接 `await` 等待结果 |
| `Task` | 用 `asyncio.create_task()` 包装的协程 | 需要并发执行且不立即等待 |

```python
async def worker(n):
    await asyncio.sleep(n)
    return f"worker-{n} done"

async def task_vs_coroutine():
    # 直接 await — 顺序执行
    r1 = await worker(1)
    r2 = await worker(2)

    # 包装为 Task — 并发执行
    t1 = asyncio.create_task(worker(1))
    t2 = asyncio.create_task(worker(2))
    r1, r2 = await t1, await t2  # 总耗时约 2s 而非 3s

    # Task 提供了状态查询
    print(f"t1 完成: {t1.done()}")     # True
    print(f"t1 结果: {t1.result()}")   # worker-1 done
```

**重要**：`asyncio.create_task()` 必须在已有运行中事件循环的上下文里调用。如果在没有事件循环的地方调用，会抛出 `RuntimeError`。

### 1.4 Future 对象

`Future` 是底层基础设施，表示一个**将来会完成**的操作的结果。`Task` 继承自 `Future`，但大多数应用层代码不直接操作 `Future`，理解它有助于调试和框架开发。

```python
async def future_example():
    loop = asyncio.get_running_loop()
    future = loop.create_future()

    async def set_result():
        await asyncio.sleep(1)
        future.set_result("future done")

    asyncio.create_task(set_result())
    result = await future  # 等待直到 future.set_result() 被调用
    print(result)          # future done
```

`Future` 的核心方法：
- `set_result(result)` / `set_exception(exception)` — 手动完成
- `add_done_callback(callback)` — 完成时回调
- `done()` / `result()` — 查询状态与结果

在异步框架（如 `aiohttp`、`asyncpg`）内部，`Future` 常用于桥接回调式 API 和 `async/await`。

---

## 2. 协程调度与组合

### 2.1 asyncio.gather

`asyncio.gather` 并发执行多个 awaitable 对象，返回所有结果的有序列表。它有一个关键行为：**如果任一任务抛出异常，默认会取消所有其他未完成的任务**（`return_exceptions=False`）。

```python
async def fetch(url, delay):
    await asyncio.sleep(delay)
    if url == "bad":
        raise ValueError(f"Failed: {url}")
    return f"Data from {url}"

async def gather_demo():
    # 正常用法
    results = await asyncio.gather(
        fetch("a.com", 1),
        fetch("b.com", 2),
        fetch("c.com", 1.5),
    )
    print(results)  # ['Data from a.com', 'Data from b.com', 'Data from c.com']

    # 容错模式
    results = await asyncio.gather(
        fetch("a.com", 1),
        fetch("bad", 0.5),
        fetch("c.com", 1.5),
        return_exceptions=True,  # 异常作为返回值返回，不取消其他任务
    )
    for r in results:
        if isinstance(r, Exception):
            print(f"任务失败: {r}")
        else:
            print(f"成功: {r}")
```

### 2.2 asyncio.wait

`asyncio.wait` 提供更细粒度的控制，能区分 `FIRST_COMPLETED`、`FIRST_EXCEPTION`、`ALL_COMPLETED` 三种等待策略。它返回 `(done, pending)` 两个集合。

```python
async def wait_demo():
    tasks = {
        asyncio.create_task(fetch("a.com", 1)): "a",
        asyncio.create_task(fetch("b.com", 2)): "b",
        asyncio.create_task(fetch("c.com", 3)): "c",
    }

    # 等待第一个完成的任务
    done, pending = await asyncio.wait(
        tasks.keys(), return_when=asyncio.FIRST_COMPLETED
    )
    for task in done:
        name = tasks[task]
        print(f"{name} 最先完成: {task.result()}")

    # 取消剩余未完成的任务
    for task in pending:
        task.cancel()

    # 等待所有任务完成（含取消确认）
    await asyncio.wait(pending)
```

Python 3.11+ 中 `asyncio.wait` 的 `timeout` 参数支持浮点数，超时后未完成的任务仍在 `pending` 中，由调用者决定如何处理。

### 2.3 TaskGroup（Python 3.11+）

`TaskGroup` 是 Python 3.11 引入的结构化并发原语，解决了 `gather` 的一个关键问题：**当某个任务失败时，自动取消组内所有其他任务**，并提供清晰的异常聚合。

```python
async def task_group_demo():
    try:
        async with asyncio.TaskGroup() as tg:
            t1 = tg.create_task(fetch("a.com", 1))
            t2 = tg.create_task(fetch("bad", 0.5))   # 会失败
            t3 = tg.create_task(fetch("c.com", 2))   # 会被自动取消
        # 所有任务成功完成才会到达这里
        print(f"{t1.result()}, {t3.result()}")
    except* ValueError as eg:
        # ExceptionGroup 处理：Python 3.11+ 的 except* 语法
        for e in eg.exceptions:
            print(f"捕获异常: {e}")
```

**`TaskGroup` vs `gather`**：

| 特性 | `asyncio.gather` | `TaskGroup` |
|------|------------------|-------------|
| 任务失败时取消其他任务 | 需 `return_exceptions=False`（默认） | **总是**取消 |
| 异常处理方式 | 返回结果列表，异常在其中 | 抛出 `ExceptionGroup` |
| 结构化上下文 | 函数调用 | `async with` 上下文管理器 |
| Python 版本 | 3.7+ | 3.11+ |

### 2.4 超时控制

**`asyncio.wait_for`**（所有 Python 3 版本可用）：

```python
async def slow_operation():
    await asyncio.sleep(10)
    return "done"

async def wait_for_demo():
    try:
        result = await asyncio.wait_for(slow_operation(), timeout=2.0)
    except asyncio.TimeoutError:
        print("操作超时！")
```

**`asyncio.timeout`**（Python 3.11+，上下文管理器风格，更推荐）：

```python
async def timeout_demo():
    try:
        async with asyncio.timeout(2.0):
            result = await slow_operation()
    except TimeoutError:
        print("超时！")

    # 可重置的超时（Python 3.12+ 的 when 参数）
    async def resettable_timeout():
        timeout = asyncio.Timeout(5.0)
        async with timeout:
            await asyncio.sleep(3)
            timeout.reschedule(asyncio.current_loop().time() + 2)  # 重置剩余时间
            await asyncio.sleep(3)
```

---

## 3. 异步上下文与迭代

### 3.1 async with — 异步上下文管理器

实现 `__aenter__` 和 `__aexit__` 的类可以用于 `async with`。这对管理异步资源的生命周期（如数据库连接、HTTP 会话）至关重要。

```python
class AsyncResource:
    async def __aenter__(self):
        print("打开资源")
        await asyncio.sleep(0.5)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        print("关闭资源")
        await asyncio.sleep(0.3)
        # 返回 True 可抑制异常

    async def work(self):
        return "resource data"

async def async_with_demo():
    async with AsyncResource() as res:
        data = await res.work()
        print(data)
    # 退出 async with 块后自动关闭
```

实际项目中，`aiofiles.open`、`aiohttp.ClientSession` 等都遵循此模式：

```python
import aiofiles
import aiohttp

async def real_world_example():
    # 异步文件读写
    async with aiofiles.open("/tmp/data.txt", mode="w") as f:
        await f.write("Hello from async world\n")

    async with aiofiles.open("/tmp/data.txt", mode="r") as f:
        content = await f.read()
        print(content)

    # 异步 HTTP 会话
    async with aiohttp.ClientSession() as session:
        async with session.get("https://httpbin.org/delay/1") as resp:
            json_data = await resp.json()
            print(json_data)
```

### 3.2 async for — 异步迭代器

当一个迭代器的 `__anext__` 方法执行异步操作时，需要用 `async for` 来遍历。这对流式数据处理（WebSocket 消息、大文件分块读取）非常有用。

```python
class AsyncCounter:
    """从 start 数到 end，每步休眠 0.5 秒"""
    def __init__(self, start, end):
        self.current = start
        self.end = end

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.current >= self.end:
            raise StopAsyncIteration
        await asyncio.sleep(0.5)
        self.current += 1
        return self.current - 1

async def async_for_demo():
    async for num in AsyncCounter(1, 5):
        print(f"收到: {num}")
    # 总耗时约 2 秒（4 次 * 0.5 秒）
```

### 3.3 异步生成器

使用 `async for` 和 `yield` 可以定义**异步生成器**，比手动实现 `__aiter__` / `__anext__` 更简洁。

```python
async def async_range(start, end, delay=0.5):
    """异步版本的 range，每步 yield 后休眠"""
    for i in range(start, end):
        await asyncio.sleep(delay)
        yield i

async def async_gen_demo():
    async for value in async_range(0, 5, delay=0.3):
        print(f"生成值: {value}")

    # 异步生成器推导式（Python 3.6+）
    results = [x async for x in async_range(0, 5) if x % 2 == 0]
    print(f"偶数: {results}")  # [0, 2, 4]
```

**异步生成器 vs 异步迭代器**：

| 特性 | 异步生成器 | 异步迭代器 |
|------|-----------|-----------|
| 定义方式 | `async def` + `yield` | 类 + `__aiter__` / `__anext__` |
| 状态管理 | 自动（函数局部变量） | 手动（`self` 属性） |
| 使用场景 | 基于计算的流式数据 | 封装外部异步资源 |
| 异常处理 | 标准 try/except | 需在 `__anext__` 中处理 |

---

## 4. 异步 IO 模式

### 4.1 异步文件 IO — aiofiles

标准 `open()` 是同步的，会阻塞事件循环。`aiofiles` 使用线程池包装同步文件操作，提供非阻塞的文件 API。

```python
import aiofiles
import json

async def aiofiles_patterns():
    # 逐行读取大文件
    async with aiofiles.open("large.log", mode="r") as f:
        async for line in f:
            process_line(line)  # 非阻塞逐行处理

    # 二进制读写
    async with aiofiles.open("data.bin", mode="wb") as f:
        await f.write(b"\x00" * 1024)

    # JSON 文件处理
    data = {"key": "value"}
    async with aiofiles.open("config.json", mode="w") as f:
        await f.write(json.dumps(data, indent=2))

    async with aiofiles.open("config.json", mode="r") as f:
        loaded = json.loads(await f.read())
        print(loaded)
```

### 4.2 异步 HTTP — aiohttp / httpx

**aiohttp** 是 asyncio 生态中最成熟的 HTTP 客户端。

```python
import aiohttp

async def aiohttp_patterns():
    # 基础请求
    async with aiohttp.ClientSession() as session:
        async with session.get("https://api.example.com/data") as resp:
            assert resp.status == 200
            data = await resp.json()           # 自动解析 JSON
            text = await resp.text()            # 原始文本
            binary = await resp.read()          # 二进制内容

    # 自定义超时与重试
    timeout = aiohttp.ClientTimeout(total=30, connect=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        for attempt in range(3):
            try:
                async with session.get("https://httpbin.org/delay/10") as resp:
                    return await resp.json()
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if attempt == 2:
                    raise
                await asyncio.sleep(1 * (attempt + 1))  # 退避等待

    # 流式下载大文件
    async with aiohttp.ClientSession() as session:
        async with session.get("https://example.com/large.zip") as resp:
            with open("output.zip", "wb") as f:
                async for chunk in resp.content.iter_chunked(8192):
                    f.write(chunk)
```

<summary>为什么需要 ConnectionPool 和超时</summary>

每个 TCP 连接都有建立开销（DNS 解析、TLS 握手）。连接池复用现有连接，显著降低延迟。不设超时可能导致协程永远挂起，阻塞事件循环。

### 4.3 连接池管理

```python
import aiohttp

class ConnectionPoolDemo:
    """封装连接池的高级管理"""
    def __init__(self, base_url: str, pool_size: int = 10):
        self.base_url = base_url.rstrip("/")
        # TCPConnector 控制连接池大小
        connector = aiohttp.TCPConnector(
            limit=pool_size,           # 总连接数上限
            limit_per_host=pool_size,  # 单个主机的连接数上限
            ttl_dns_cache=300,         # DNS 缓存时间（秒）
            enable_cleanup_closed=True,
        )
        timeout = aiohttp.ClientTimeout(total=10, connect=3)
        self.session = aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers={"User-Agent": "AsyncDemo/1.0"},
        )

    async def fetch(self, path: str) -> dict:
        url = f"{self.base_url}/{path.lstrip('/')}"
        async with self.session.get(url) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def close(self):
        await self.session.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()


async def pool_demo():
    async with ConnectionPoolDemo("https://httpbin.org") as pool:
        results = await asyncio.gather(
            pool.fetch("/get"),
            pool.fetch("/uuid"),
            pool.fetch("/headers"),
        )
        print(f"并发完成 {len(results)} 个请求")
```

**httpx** 同时支持同步和异步 API，适合在同步代码库中逐步引入异步：

```python
import httpx

async def httpx_demo():
    async with httpx.AsyncClient(
        base_url="https://httpbin.org",
        limits=httpx.Limits(max_connections=20),
        timeout=httpx.Timeout(10.0, connect=5.0),
    ) as client:
        resp = await client.get("/json")
        print(resp.json())

        # 并发多个请求
        async with client as c:
            tasks = [c.get(f"/delay/{i}") for i in range(1, 4)]
            responses = await asyncio.gather(*tasks)
            for r in responses:
                print(f"Status: {r.status_code}")
```

---

## 5. 异步与同步混合

### 5.1 避免阻塞事件循环

事件循环在单线程中运行，**任何 CPU 密集型或同步阻塞调用都会冻结整个事件循环**。以下代码是典型的反模式：

```python
# 🚫 反模式：time.sleep 会阻塞整个事件循环
async def bad_pattern():
    import time
    time.sleep(5)  # 所有其他协程在这 5 秒内全部停止响应
```

使用 `asyncio.sleep` 替代 `time.sleep` 是最容易犯的错误之一。更隐蔽的阻塞包括：`subprocess.run`、`requests.get`、`hashlib` 的大规模哈希运算、`json.loads` 处理巨量数据。

### 5.2 run_in_executor

`loop.run_in_executor(None, func)` 将同步函数交给线程池执行，返回一个 awaitable 对象。

```python
import hashlib
import concurrent.futures

async def compute_hash(data: bytes) -> str:
    """计算哈希——CPU 密集型操作，放到线程池执行"""
    loop = asyncio.get_running_loop()

    def _hash():
        return hashlib.sha256(data).hexdigest()

    # None 表示使用默认线程池
    result = await loop.run_in_executor(None, _hash)
    return result

# 使用进程池处理 CPU 密集型任务
async def cpu_intensive_task():
    with concurrent.futures.ProcessPoolExecutor() as pool:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            pool,  # 指定进程池而非默认线程池
            expensive_cpu_function,
            large_input,
        )
        return result
```

### 5.3 asyncio.to_thread（Python 3.9+）

`asyncio.to_thread` 是 `run_in_executor(None, func)` 的简化封装，语法更直观：

```python
import requests

async def fetch_sync_lib(url: str) -> dict:
    """使用同步 requests 库，通过 to_thread 避免阻塞"""
    def _request():
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()

    # to_thread 自动使用默认线程池
    return await asyncio.to_thread(_request)

async def mixed_demo():
    # 混合使用异步库和同步库
    async with aiohttp.ClientSession() as session:
        async with session.get("https://httpbin.org/uuid") as resp:
            async_data = await resp.json()

    sync_data = await asyncio.to_thread(
        lambda: requests.get("https://httpbin.org/uuid").json()
    )

    # 也可以用列表推导式构建并发
    urls = [f"https://httpbin.org/delay/{i}" for i in range(1, 4)]
    tasks = [asyncio.to_thread(lambda u=url: requests.get(u).json()) for url in urls]
    results = await asyncio.gather(*tasks)
    print(results)
```

### 5.4 线程池 / 进程池集成

```python
import concurrent.futures
from typing import Any, Callable

class AsyncExecutor:
    """统一管理线程池和进程池的辅助类"""

    def __init__(self, max_workers: int = 4):
        self._thread_pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="async_io"
        )
        self._process_pool = concurrent.futures.ProcessPoolExecutor(
            max_workers=max_workers
        )

    async def run_io(self, func: Callable, *args, **kwargs) -> Any:
        """I/O 密集型任务 → 线程池"""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._thread_pool, func, *args)

    async def run_cpu(self, func: Callable, *args, **kwargs) -> Any:
        """CPU 密集型任务 → 进程池"""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._process_pool, func, *args)

    async def shutdown(self):
        self._thread_pool.shutdown(wait=True)
        self._process_pool.shutdown(wait=True)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.shutdown()


async def executor_demo():
    async with AsyncExecutor(max_workers=8) as executor:
        # I/O 任务 —— 多个 HTTP 请求
        io_results = await asyncio.gather(*[
            executor.run_io(requests.get, f"https://httpbin.org/delay/{i}")
            for i in range(1, 5)
        ])

        # CPU 任务 —— 哈希计算
        data = b"x" * 10_000_000
        hash_result = await executor.run_cpu(hashlib.sha256, data).hexdigest()
        print(f"SHA256: {hash_result}")
```

### 5.5 选择策略

| 场景 | 推荐方案 | 原因 |
|------|----------|------|
| 同步 I/O 库（`requests`、`boto3`） | `asyncio.to_thread` | 简洁，自动使用默认线程池 |
| CPU 密集短任务 | `run_in_executor(ProcessPoolExecutor)` | 避免 GIL 限制 |
| CPU 密集长任务 | 使用 `multiprocessing` 或框架（如 Ray） | 进程池管理更复杂时 |
| 大量短小的同步调用 | 批量打包为一次 `to_thread` | 减少线程切换开销 |

---

## 6. 常见陷阱

### 6.1 异步死锁

**错误**：在同一个事件循环中同步地等待异步结果。

```python
# 🚫 反模式：异步死锁
async def deadlock():
    loop = asyncio.get_running_loop()
    # 以下调用会阻塞当前协程，而 run_coroutine_threadsafe
    # 需要事件循环空闲来调度新协程 → 死锁
    future = asyncio.run_coroutine_threadsafe(
        asyncio.sleep(1), loop
    )
    result = future.result()  # ⚠️ 死锁！


# ✅ 正确做法：只用 await
async def no_deadlock():
    await asyncio.sleep(1)
```

**另一个经典死锁**：`asyncio.Lock` 被同一个协程重复 `await`：

```python
lock = asyncio.Lock()

async def reentrant_deadlock():
    async with lock:
        async with lock:  # ⚠️ 死锁！asyncio.Lock 不可重入
            pass

# ✅ 需要重入锁时使用 asyncio.Condition 或自定义逻辑
```

### 6.2 竞态条件

虽然协程在单线程中运行，但 `await` 点是天然的切换点，多个协程交替访问共享状态时仍然可能产生竞态条件。

```python
class Counter:
    def __init__(self):
        self.value = 0

counter = Counter()

async def bad_increment():
    # 🚫 竞态：读取-修改-写入 三步之间可能被切换
    current = counter.value  # await 之前读取
    await asyncio.sleep(0)   # 切换点！其他协程可能修改 counter.value
    counter.value = current + 1

async def race_demo():
    tasks = [asyncio.create_task(bad_increment()) for _ in range(100)]
    await asyncio.gather(*tasks)
    print(f"期望 100，实际 {counter.value}")  # 远小于 100

# ✅ 使用 asyncio.Lock 保护临界区
async def safe_increment(lock: asyncio.Lock):
    async with lock:
        current = counter.value
        await asyncio.sleep(0)  # 锁保护下，即使切换也是安全的
        counter.value = current + 1
```

### 6.3 过度并发——信号量控制

不加限制地创建 `Task` 可能导致：文件描述符耗尽、目标服务器拒绝服务、内存爆炸。

```python
async def fetch_all_unbounded():
    # 🚫 反模式：假如 urls 有 10000 个，瞬间创建 10000 个 Task
    urls = [f"https://httpbin.org/delay/{i}" for i in range(1, 100)]
    tasks = [asyncio.create_task(fetch_one(url)) for url in urls]
    return await asyncio.gather(*tasks)


# ✅ 使用 Semaphore 控制并发度
sem = asyncio.Semaphore(10)  # 最多 10 个并发

async def fetch_one(url: str) -> dict:
    async with sem:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                return await resp.json()

async def fetch_all_bounded(urls: list[str]) -> list[dict]:
    tasks = [asyncio.create_task(fetch_one(url)) for url in urls]
    return await asyncio.gather(*tasks)
```

**Semaphore 的协作式特性**：`Semaphore` 是协程安全的，计数在 `async with sem:` 进入时递减，退出时递增。它不会限制 Task 的创建数，只限制**同时执行**的临界区数量。

### 6.4 幽灵任务与引用泄漏

创建了 Task 但从未 `await` 它，Task 会在事件循环中"幽灵般"运行，如果持有大对象引用会导致内存泄漏。Python 3.11+ 的 `TaskGroup` 能有效缓解此问题。

```python
# 🚫 反模式：创建了 Task 但忘记等待
async def ghost_task():
    asyncio.create_task(leaky_worker())  # ⚠️ 没有保存引用！
    # 事件循环仍有对它的引用，但无法控制它了

# ✅ 始终保存 Task 引用并 await
async def safe_task():
    task = asyncio.create_task(worker())
    await task

# ✅ 或在 Python 3.11+ 使用 TaskGroup 自动管理生命周期
async def safe_task_group():
    async with asyncio.TaskGroup() as tg:
        tg.create_task(worker())  # exit 时自动等待所有任务
```

### 6.5 调试技巧

```python
import asyncio
import os

# 启用 asyncio 调试模式
# 方式一：环境变量
os.environ["PYTHONASYNCIODEBUG"] = "1"

# 方式二：代码中设置
async def debug_demo():
    loop = asyncio.get_running_loop()
    loop.set_debug(True)

    # 设置慢操作阈值（默认 0.1 秒）
    loop.slow_callback_duration = 0.05

    # 获取所有未完成任务
    for task in asyncio.all_tasks(loop):
        print(f"Task: {task}, done={task.done()}")

    # 获取当前协程的调用栈
    import traceback
    current_task = asyncio.current_task()
    print("当前任务栈:")
    traceback.print_stack(current_task.get_stack())


# 超时兜底——防止协程永远挂起
async def fetch_with_failsafe(url: str):
    try:
        async with asyncio.timeout(30):
            return await actual_fetch(url)
    except TimeoutError:
        print(f"请求 {url} 超时")
        return None


# asyncio.CancelledError 处理
async def cancellation_handling():
    """被取消时进行清理"""
    try:
        await asyncio.sleep(100)
    except asyncio.CancelledError:
        print("任务被取消，执行清理...")
        await asyncio.sleep(0.5)  # 清理操作
        raise  # 必须重新抛出，否则任务不会真正取消
```

### 6.6 调试 Checklist

| 问题 | 检查点 | 工具/手段 |
|------|--------|-----------|
| 事件循环阻塞 | 是否有同步 I/O 或 CPU 密集操作在协程中 | 启用调试模式 `loop.set_debug(True)` |
| 协程未执行 | 是否忘记 `await` | 代码检查 + `asyncio.all_tasks()` 查看 |
| 连接池耗尽 | 并发数是否超过连接池上限 | 监控文件描述符；使用 `Semaphore` 限流 |
| 异常静默 | 是否有 Task 异常未被捕获 | `asyncio.Task.exception()` 或 `TaskGroup` |
| 超时未生效 | 是否设置了超时但内部有同步阻塞 | 用 `asyncio.timeout` 包裹整个异步调用链 |
| 内存泄漏 | 是否有未完成的 Task 持有大对象 | `gc.get_objects()` + `asyncio.all_tasks()` |

```python
# 通用调试器辅助函数
async def inspect_tasks():
    """打印所有存活 Task 的状态"""
    tasks = asyncio.all_tasks()
    current = asyncio.current_task()
    for t in tasks:
        status = "RUNNING" if t is current else "PENDING"
        if t.done():
            status = "DONE"
            if t.cancelled():
                status = "CANCELLED"
            elif t.exception():
                status = f"EXCEPTION: {t.exception()}"
        print(f"[{status}] {t.get_name() or t.get_coro()}")
```

---

## 总结

Python 异步编程的核心模型可以归纳为：

> **事件循环驱动 → 协程协作式调度 → await 点切换 → 单线程并发**

掌握这一模型需要理解三个层次：

1. **原语层**：`Coroutine`、`Task`、`Future`、事件循环的关系
2. **组合层**：`gather`、`TaskGroup`、`Semaphore`、`Lock` 的协作语义
3. **集成层**：异步 I/O 库、同步代码桥接（`to_thread` / `run_in_executor`）、调试与陷阱规避

异步不是银弹——CPU 密集型任务仍然需要多进程，短同步调用可以用 `to_thread` 包装。选择异步的 ROI 最高的场景是 **I/O 密集型且高并发** 的网络服务、数据管道和实时应用。
