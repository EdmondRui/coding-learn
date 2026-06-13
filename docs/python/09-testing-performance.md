# Python 测试与性能调优

## 1. pytest 进阶

### 1.1 Fixture 作用域与依赖

`scope` 参数控制 fixture 生命周期，合理设置可显著提升测试效率：

| 作用域 | 生命周期 | 适用场景 |
|--------|----------|----------|
| `function`（默认） | 每个测试函数 | 独立临时数据 |
| `class` | 每个测试类 | 类级别共享 |
| `module` | 每个模块 | 连接池、配置 |
| `session` | 整个测试会话 | 数据库引擎、HTTP 客户端 |

```python
import pytest, sqlite3
from typing import Generator

@pytest.fixture(scope="session")
def db_conn() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    yield conn
    conn.close()

@pytest.fixture(scope="function")
def transaction(db_conn: sqlite3.Connection) -> Generator[sqlite3.Connection, None, None]:
    db_conn.execute("BEGIN")
    yield db_conn
    db_conn.rollback()

def test_insert(transaction: sqlite3.Connection) -> None:
    transaction.execute("INSERT INTO users (name) VALUES ('alice')")
    assert transaction.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1

def test_rollback(transaction: sqlite3.Connection) -> None:
    # 上一个测试已回滚，互不干扰
    assert transaction.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
```

### 1.2 conftest.py 组织

`conftest.py` 按目录层级自动发现，是共享 fixture 和钩子的中心：

```
tests/
├── conftest.py              # 全局 fixture 与配置
├── api/
│   ├── conftest.py          # API 层专用 fixture
│   └── test_users.py
└── services/
    └── test_payment.py
```

```python
# tests/conftest.py
import pytest
def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: 跳过慢测试")
    config.addinivalue_line("markers", "integration: 需要外部服务")

# tests/api/conftest.py — 共享 HTTP 客户端
@pytest.fixture(scope="module")
def api_client():
    from httpx import Client, ASGITransport
    from myapp.main import app
    with Client(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
```

### 1.3 参数化测试

`@pytest.mark.parametrize` 消除重复测试代码：

```python
import pytest
from datetime import date

def is_weekend(d: date) -> bool:
    return d.weekday() >= 5

@pytest.mark.parametrize("d,expected", [
    (date(2026, 6, 8), False),   # 周一
    (date(2026, 6, 13), True),   # 周六
    (date(2026, 6, 14), True),   # 周日
])
def test_is_weekend(d: date, expected: bool) -> None:
    assert is_weekend(d) == expected

# 组合参数化（笛卡尔积）
@pytest.mark.parametrize("a", [1, 2])
@pytest.mark.parametrize("b", [3, 4])
def test_cartesian(a: int, b: int) -> None:
    assert a + b == b + a  # 2 × 2 = 4 个用例
```

### 1.4 标记（Mark）

```python
@pytest.mark.skip(reason="未实现")
def test_not_ready(): ...

@pytest.mark.skipif(sys.version_info < (3, 11), reason="需要 3.11+")
def test_new_feature(): ...

@pytest.mark.xfail(reason="已知 bug #12345")
def test_known_bug():
    assert buggy_function() == 42

@pytest.mark.slow
def test_heavy(): ...

# 运行: pytest -m "not slow" / "slow or integration"
```

### 1.5 插件开发

pytest 插件通过约定命名的钩子函数自动注册：

```python
# my_timer.py — 自动记录每个测试耗时
import pytest, time

@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item: pytest.Item) -> None:
    item._start_time = time.perf_counter()

@pytest.hookimpl(trylast=True)
def pytest_runtest_teardown(item: pytest.Item) -> None:
    print(f"  ⏱ {item.nodeid} 耗时 {time.perf_counter() - item._start_time:.3f}s")
```

---

## 2. Mock 与隔离

### 2.1 patch 策略

```python
from unittest.mock import patch
import requests

class UserService:
    def fetch_user(self, user_id: int) -> dict:
        resp = requests.get(f"https://api.example.com/users/{user_id}")
        resp.raise_for_status()
        return resp.json()

# 装饰器方式
@patch("requests.get")
def test_fetch_user(mock_get) -> None:
    mock_get.return_value.json.return_value = {"id": 1, "name": "alice"}
    mock_get.return_value.status_code = 200
    assert UserService().fetch_user(1)["name"] == "alice"
    mock_get.assert_called_once_with("https://api.example.com/users/1")

# 上下文管理器方式
def test_fetch_user_failure() -> None:
    with patch("requests.get") as mock_get:
        mock_get.side_effect = requests.ConnectionError("timeout")
        with pytest.raises(requests.ConnectionError):
            UserService().fetch_user(1)
```

### 2.2 autospec

`autospec=True` 让 mock 自动匹配被替换对象的签名，防止接口偏离：

```python
class PaymentGateway:
    def charge(self, amount: float, currency: str = "CNY") -> dict: ...

# autospec=False — 调用错误签名也不会报错
with patch("mymodule.PaymentGateway") as MockGW:
    MockGW.return_value.charge(100, extra="oops")  # 静默通过

# autospec=True — 严格校验
with patch("mymodule.PaymentGateway", autospec=True) as MockGW:
    MockGW.return_value.charge(100, "USD")         # ✅
    # MockGW.return_value.charge(100, extra="x")   # ❌ TypeError
```

### 2.3 side_effect — 动态返回值

```python
from unittest.mock import Mock

# 迭代返回值
m = Mock(side_effect=[10, 20, StopIteration])
assert m() == 10
assert m() == 20

# 根据参数动态返回
def side_effect(*args):
    return {"role": "admin"} if args[0] == "admin" else {"role": "user"}

m = Mock(side_effect=side_effect)
assert m("admin")["role"] == "admin"
assert m("guest")["role"] == "user"
```

### 2.4 异步 Mock

```python
from unittest.mock import AsyncMock
import pytest

class AsyncCache:
    async def get(self, key: str) -> str | None: ...

@pytest.mark.asyncio
async def test_async_cache() -> None:
    cache = AsyncCache()
    cache.get = AsyncMock(return_value=None)

    result = await cache.get("foo")
    assert result is None
    cache.get.assert_awaited_once_with("foo")

# 配合 patch
@pytest.mark.asyncio
async def test_patch_async() -> None:
    with patch("mymodule.AsyncCache.get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = "cached"
        ...
```

---

## 3. 集成测试与端到端

### 3.1 测试数据库

使用事务回滚策略保证测试隔离：

```python
import pytest, asyncpg
from typing import AsyncGenerator

@pytest.fixture(scope="module")
async def pg_pool() -> AsyncGenerator[asyncpg.Pool, None]:
    pool = await asyncpg.create_pool("postgresql://test:test@localhost:5432/testdb")
    yield pool
    await pool.close()

@pytest.fixture
async def pg_txn(pg_pool: asyncpg.Pool) -> AsyncGenerator[asyncpg.Connection, None]:
    conn = await pg_pool.acquire()
    async with conn.transaction():  # 测试结束自动回滚
        yield conn

@pytest.mark.asyncio
async def test_create_user(pg_txn: asyncpg.Connection) -> None:
    await pg_txn.execute("INSERT INTO users (name) VALUES ($1)", "alice")
    assert await pg_txn.fetchval("SELECT COUNT(*) FROM users") == 1
```

### 3.2 HTTP 客户端测试

使用 httpx 的 `ASGITransport` / `WSGITransport`，无需启动真实服务器：

```python
from httpx import ASGITransport, AsyncClient, WSGITransport, Client

# FastAPI / Starlette — 无需启动真实服务器
@pytest.fixture
async def async_client():
    from myapp.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

@pytest.mark.asyncio
async def test_get_users(async_client: AsyncClient) -> None:
    assert (await async_client.get("/users")).status_code == 200

# Flask (WSGI) 同理
@pytest.fixture
def wsgi_client():
    from myflask import app
    return Client(transport=WSGITransport(app=app), base_url="http://test")
```

### 3.3 Docker 集成测试

使用 `testcontainers` 自动编排依赖服务：

```python
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def postgres_url() -> str:
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url()

@pytest.mark.integration
def test_db_connection(postgres_url: str) -> None:
    import asyncpg
    # 使用真实 PostgreSQL 容器完成测试
# 集成测试应标记 @pytest.mark.integration，在 CI 中独立运行
```

---

## 4. 性能剖析

### 4.1 cProfile — 函数级分析

```python
import cProfile, pstats, io

def slow_function():
    return sum(range(10_000_000))

profiler = cProfile.Profile()
profiler.enable()
slow_function()
profiler.disable()

stream = io.StringIO()
stats = pstats.Stats(profiler, stream=stream)
stats.sort_stats("cumulative")
stats.print_stats(10)
print(stream.getvalue())

# 命令行: python -m cProfile -s cumulative my_script.py
```

### 4.2 line_profiler — 行级分析

```python
# pip install line-profiler

@profile
def process_data(n: int) -> list[int]:
    result = []
    for i in range(n):
        result.append(i ** 2)
    return result

if __name__ == "__main__":
    process_data(100_000)

# 运行: kernprof -l -v my_script.py
# 输出每行: 命中次数、耗时、百分比
```

### 4.3 memory_profiler — 内存分析

```python
# pip install memory-profiler

@profile
def memory_intensive():
    large = [i for i in range(1_000_000)]
    return {i: i**2 for i in range(100_000)}

if __name__ == "__main__":
    memory_intensive()

# 运行: python -m memory_profiler my_script.py
# 输出每行: 内存使用、增量
```

### 4.4 py-spy — 无侵入采样分析

```bash
# pip install py-spy

# 附着到运行中的进程
py-spy record -o flamegraph.svg --pid 12345

# 直接分析脚本
py-spy record -o flamegraph.svg -- python my_script.py

# 交互式 top 模式
py-spy top --pid 12345
```

### 4.5 火焰图生成

```bash
# 方案一：cProfile 输出转 SVG
python -m cProfile -o output.prof my_script.py
pip install flameprof
flameprof output.prof > flamegraph.svg

# 方案二：py-spy 直接生成
py-spy record -o flamegraph.svg -- python my_script.py
```

火焰图解读：**X 轴**为采样占比（非时间线），**Y 轴**为调用栈深度，**宽度越宽**消耗 CPU 越多。

---

## 5. 性能优化策略

### 5.1 算法优化

选择正确的算法复杂度是最有效的优化：

```python
# O(n²) 嵌套查找 → O(n) 哈希查找
def find_duplicates(items: list[int]) -> set[int]:
    seen, dupes = set(), set()
    for x in items:
        if x in seen:
            dupes.add(x)
        else:
            seen.add(x)
    return dupes

# n=10000 时差距约 8000 倍
```

### 5.2 数据结构选择

```python
from collections import deque, defaultdict, Counter
import heapq

q = deque([1, 2, 3]); q.appendleft(0)  # O(1) vs list.insert(0) O(n)

heap = [3, 1, 4, 1, 5]
heapq.heapify(heap); heapq.heappop(heap)  # O(n) / O(log n)

assert Counter("mississippi").most_common(1)[0] == ("i", 4)

groups = defaultdict(list)
for k, v in [("a", 1), ("b", 2), ("a", 3)]:
    groups[k].append(v)
```

### 5.3 缓存策略

```python
from functools import lru_cache, cache, cached_property
import time

# LRU 缓存 — 适合纯函数重复调用
@lru_cache(maxsize=128)
def expensive(n: int) -> int:
    time.sleep(0.1)
    return n * n

expensive(10)  # 100ms
expensive(10)  # 缓存命中，μs 级返回

# Python 3.9+ 无限制缓存
@cache
def fib(n: int) -> int:
    return n if n < 2 else fib(n-1) + fib(n-2)

# 实例级懒加载
class DataLoader:
    def __init__(self, path: str):
        self.path = path

    @cached_property
    def data(self) -> list[dict]:
        """只加载一次"""
        return [{"id": 1}]

# TTL 缓存
from cachetools import TTLCache
cache = TTLCache(maxsize=100, ttl=60)
def get_user(id: int) -> dict:
    if id not in cache:
        cache[id] = fetch_from_db(id)
    return cache[id]
```

### 5.4 C 扩展 / Cython / Numba

```python
# Cython: 定义 .pyx 文件后用 cythonize 编译，快 10-50 倍
# def sum_range(int n):
#     cdef int i; cdef long total = 0
#     for i in range(n): total += i
#     return total

# Numba JIT: 首次调用编译，后续 C 速度
from numba import jit
@jit(nopython=True)
def sum_numba(n: int) -> int:
    total = 0
    for i in range(n): total += i
    return total
```

### 5.5 并发 vs 并行选择

| 场景 | 方案 | 特点 |
|------|------|------|
| I/O 密集型 | `asyncio` + `aiohttp` | 单线程高并发 |
| CPU 密集型 | `multiprocessing.Pool` | 多进程绕开 GIL |
| 混合型 | `asyncio` + `run_in_executor` | I/O 与计算分离 |

```python
import asyncio, aiohttp
from concurrent.futures import ProcessPoolExecutor

# I/O 密集型：asyncio 高并发
async def fetch_all(urls: list[str]) -> list[bytes]:
    async with aiohttp.ClientSession() as session:
        tasks = [session.get(u) for u in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [await r.read() if isinstance(r, aiohttp.ClientResponse) else b"" for r in results]

# CPU 密集型委托给进程池，不阻塞事件循环
async def main():
    loop = asyncio.get_running_loop()
    with ProcessPoolExecutor(max_workers=4) as pool:
        primes = await loop.run_in_executor(pool, compute_primes, 100_000)
```

---

## 6. 基准测试

### 6.1 timeit — 微基准

```python
import timeit

# 语句级别
t = timeit.timeit('"-".join(str(n) for n in range(100))', number=10000)

# 函数对比
t1 = timeit.timeit(lambda: [i**2 for i in range(1000)], number=10000)
t2 = timeit.timeit(lambda: list(map(lambda i: i**2, range(1000))), number=10000)
print(f"比例: {t1/t2:.2f}x")

# 命令行: python -m timeit -n 10000 '"-".join(str(n) for n in range(100))'
```

> `timeit` 适合微基准，I/O 密集型用 `pytest-benchmark`。

### 6.2 pytest-benchmark

```python
# pip install pytest-benchmark
def test_sort_benchmark(benchmark) -> None:
    result = benchmark(sorted, [3, 1, 4, 1, 5, 9, 2] * 1000)
    assert result[0] == 1

# pytest --benchmark-only 输出 min/max/mean/stddev
# pytest --benchmark-save=baseline 保存基准以供后续对比
```

### 6.3 压力测试（locust）

```python
# locustfile.py
from locust import HttpUser, task, between

class WebsiteUser(HttpUser):
    wait_time = between(1, 3)

    @task(3)
    def view_home(self): self.client.get("/")

    @task(1)
    def create_user(self): self.client.post("/users", json={"name": "alice"})

    def on_start(self): self.client.post("/login", json={"username": "test"})

# 运行: locust -f locustfile.py --headless -u 100 -r 10 --run-time 1m
# 无头模式: -u 并发数, -r 每秒启动数
# Web 模式: 去掉 --headless，访问 http://localhost:8089
```

### 6.4 性能回归检测

```python
# pytest-benchmark 支持基准对比
# 1. 生成基准: pytest --benchmark-save=baseline test_bench.py
# 2. 对比:     pytest --benchmark-compare=baseline test_bench.py
# 3. 设定阈值:
# pyproject.toml:
# [tool:pytest]
# benchmark_compare_max_slowdown = 1.2  # 最多慢 20%

# 自定义回归检测
PERF_THRESHOLDS = {"user_creation": 0.5, "search_query": 0.3}

def check_regression(results: dict[str, float]) -> list[str]:
    return [f"{n}: {t:.3f}s > {PERF_THRESHOLDS[n]:.3f}s"
            for n, t in results.items()
            if n in PERF_THRESHOLDS and t > PERF_THRESHOLDS[n]]
```

---

## 总结

| 维度 | 工具 / 技术 | 核心用途 |
|------|-------------|----------|
| 单元测试 | pytest + fixture + mock | 逻辑正确性 |
| 集成测试 | httpx / testcontainers | 组件协作验证 |
| 性能剖析 | cProfile / line_profiler / py-spy | 定位热点 |
| 性能优化 | 算法 + 数据结构 + 缓存 + C扩展 | 消除瓶颈 |
| 基准测试 | timeit / pytest-benchmark / locust | 量化与回归 |

合理测试保障代码质量，科学性能分析让优化效果可衡量、可验证。
