# Python 高级特性

> 适用读者：已掌握 Python 基础语法（函数、类、迭代器）的开发者。
> 目标：深入理解 Python 的语言机制，写出更优雅、高效的代码。

---

## 一、装饰器进阶 — 不只是语法糖

装饰器是一个可调用对象，接收函数并返回替换品。

### 1.1 带参数

三层嵌套：外层接收参数 → 中层接收函数 → 内层 wrapper：

```python
import time
from functools import wraps

def retry(max_attempts=3, delay=1.0, exceptions=(Exception,)):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exc = e
                    print(f"[{attempt}/{max_attempts}] 失败: {e}")
                    if attempt < max_attempts:
                        time.sleep(delay)
            raise last_exc
        return wrapper
    return decorator

@retry(max_attempts=3, delay=0.2, exceptions=(ConnectionError,))
def fetch_data(url: str):
    raise ConnectionError("网络超时")
```

### 1.2 类装饰器

通过 `__call__` 维护状态：

```python
class CountCalls:
    def __init__(self, func):
        wraps(func)(self)
        self.func, self.count = func, 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        print(f"已调用 {self.count} 次")
        return self.func(*args, **kwargs)

@CountCalls
def greet(name: str):
    return f"你好, {name}"
```

### 1.3 装饰器链

`@a @b def f(): ...` 等价于 `f = a(b(f))`：

```python
def bold(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        return f"**{func(*args, **kwargs)}**"
    return wrapper

@bold
def render(text: str):
    return text
```

### 1.4 实际应用

**TTL 缓存**

```python
def ttl_cache(seconds: int):
    def decorator(func):
        cache = {}
        @wraps(func)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            now = time.time()
            if key in cache:
                val, ts = cache[key]
                if now - ts < seconds:
                    return val
            result = func(*args, **kwargs)
            cache[key] = (result, now)
            return result
        return wrapper
    return decorator

@ttl_cache(5)
def get_user(user_id: int):
    print(f"查询: {user_id}")
    return {"id": user_id, "name": "Alice"}
```

**权限校验**

```python
def require_role(role: str):
    def decorator(func):
        @wraps(func)
        def wrapper(user, *args, **kwargs):
            if user.get("role") != role:
                raise PermissionError(f"需要 {role} 角色")
            return func(user, *args, **kwargs)
        return wrapper
    return decorator

@require_role("admin")
def delete_user(user, target_id: int):
    print(f"用户 {target_id} 已删除")
```

---

## 二、上下文管理器 — 资源管理

### 2.1 基础协议

```python
class ManagedFile:
    def __init__(self, path, mode="r"):
        self.path, self.mode = path, mode

    def __enter__(self):
        self.file = open(self.path, self.mode)
        return self.file

    def __exit__(self, exc_type, exc_val, exc_tb):
        if hasattr(self, 'file'):
            self.file.close()
        return False  # True 会抑制异常

with ManagedFile("/tmp/test.txt", "w") as f:
    f.write("Hello")
```

### 2.2 `@contextmanager` & 实用工具

```python
from contextlib import contextmanager, suppress, closing
import os

@contextmanager
def change_dir(target: str):
    original = os.getcwd()
    try:
        os.chdir(target)
        yield
    finally:
        os.chdir(original)

with suppress(FileNotFoundError):
    os.remove("不存在的文件.txt")
with closing(open("/tmp/test.txt")) as f:
    data = f.read()
```

### 2.3 异步 & 事务

```python
import asyncio

class AsyncSession:
    async def __aenter__(self):
        print("连接..."); await asyncio.sleep(0.1); return self
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        print("关闭..."); await asyncio.sleep(0.1)

@contextmanager
def transaction(db: str):
    print(f"开启事务: {db}")
    try:
        yield; print("提交事务")
    except Exception as e:
        print(f"回滚: {e}"); raise
```

---

## 三、元类与描述符 — 控制类和属性

### 3.1 `type()` 动态创建类

`class` 关键字本质上是 `type()` 的语法糖：

```python
Person = type("Person", (), {"species": "人类", "greet": lambda self: "你好"})
print(Person().species)  # 人类
```

动态数据模型：

```python
def create_model(name, fields):
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            if k not in fields: raise AttributeError(f"未知: {k}")
            setattr(self, k, v)
    def __repr__(self):
        pairs = [f"{k}={getattr(self, k)}" for k in fields]
        return f"{name}({', '.join(pairs)})"
    return type(name, (), {"__init__": __init__, "__repr__": __repr__, **{k: None for k in fields}})

User = create_model("User", {"id": int, "name": str})
print(User(id=1, name="Alice"))
```

### 3.2 `__new__` vs `__init__`

**元类实现单例**：`__call__` 是元类拦截实例化的钩子。

```python
class SingletonMeta(type):
    _instances = {}
    def __call__(cls, *args, **kwargs):
        if cls not in cls._instances:
            cls._instances[cls] = super().__call__(*args, **kwargs)
        return cls._instances[cls]

class DB(metaclass=SingletonMeta):
    def __init__(self, host: str): self.host = host

a, b = DB("local"), DB("remote")
print(a is b, a.host)  # True local
```

**`__new__` 修饰不可变类型**：

```python
class PositiveInt(int):
    def __new__(cls, value):
        if value <= 0: raise ValueError
        return super().__new__(cls, value)
```

### 3.3 描述符协议

描述符劫持属性访问。`property`、`classmethod`、`staticmethod` 底层都是描述符。

```python
class ValidatedField:
    def __set_name__(self, owner, name):
        self.private_name = f"_{name}"

    def __get__(self, obj, objtype=None):
        if obj is None: return self
        return getattr(obj, self.private_name, None)

    def __set__(self, obj, value):
        self.validate(value)
        setattr(obj, self.private_name, value)

    def validate(self, value): raise NotImplementedError

class Email(ValidatedField):
    def validate(self, value):
        if "@" not in str(value): raise ValueError(f"无效邮箱: {value}")

class User:
    email = Email()
    def __init__(self, email: str): self.email = email

u = User("a@b.com")
print(u.email)  # a@b.com
```

### 3.4 `property` 实现原理

```python
class CustomProperty:
    def __init__(self, fget=None, fset=None, fdel=None):
        self.fget, self.fset, self.fdel = fget, fset, fdel

    def __get__(self, obj, objtype=None):
        if obj is None: return self
        if self.fget is None: raise AttributeError("不可读")
        return self.fget(obj)

    def __set__(self, obj, value):
        if self.fset is None: raise AttributeError("不可写")
        self.fset(obj, value)

    def setter(self, fset):
        return CustomProperty(self.fget, fset, self.fdel)

class Circle:
    def __init__(self, radius): self._radius = radius

    @CustomProperty
    def radius(self): return self._radius

    @radius.setter
    def radius(self, value):
        if value <= 0: raise ValueError
        self._radius = value

c = Circle(5)
c.radius = 10
print(c.radius)  # 10
```

---

## 四、生成器进阶 — 不仅仅是迭代

### 4.1 `yield from`

```python
def flatten(nested):
    for item in nested:
        if hasattr(item, "__iter__") and not isinstance(item, (str, bytes)):
            yield from flatten(item)
        else:
            yield item

print(list(flatten([1, [2, [3, 4], 5], 6])))  # [1, 2, 3, 4, 5, 6]
```

### 4.2 双向通信

`send()` 向生成器发送值，`throw()` 注入异常，`close()` 注入 `GeneratorExit`：

```python
def coro():
    x = yield "启动"
    print(f"收到: {x}")
    y = yield f"继续: {x}"

c = coro()
print(c.send(None))  # 启动
print(c.send(10))    # 继续: 10
c.send(20)           # 结束
```

### 4.3 协程 — 协作式多任务

```python
def task(name: str, n: int):
    for i in range(n):
        print(f"[{name}] {i+1}")
        yield

def scheduler(tasks):
    while tasks:
        for t in list(tasks):
            try: next(t)
            except StopIteration: tasks.remove(t)

scheduler([task("A", 2), task("B", 3)])
# A1 B1 A2 B2 B3
```

### 4.4 管道模式

生成器惰性求值，构建数据处理链：

```python
def read_lines(path):
    with open(path) as f:
        yield from (line.strip() for line in f)

def drop_comments(lines):
    yield from (l for l in lines if not l.startswith("#"))

def parse_csv(lines):
    yield from (line.split(",") for line in lines if line)

def to_dicts(rows, headers=None):
    if headers is None: headers = next(rows)
    for row in rows:
        yield dict(zip(headers, row))

pipe = to_dicts(parse_csv(drop_comments(read_lines("data.csv"))))
print(list(pipe))
```



---

## 五、魔术方法与运算符重载

魔术方法（Dunder Methods）让自定义对象像内置类型一样自然。

### 5.1 字符串表示

```python
class Point:
    def __init__(self, x, y): self.x, self.y = x, y

    def __repr__(self): return f"Point({self.x!r}, {self.y!r})"
    def __str__(self): return f"({self.x}, {self.y})"

    def __format__(self, fmt):
        if fmt == "polar":
            import math
            r = math.hypot(self.x, self.y)
            theta = math.degrees(math.atan2(self.y, self.x))
            return f"({r:.2f}, {theta:.1f}°)"
        return str(self)

p = Point(3, 4)
print(repr(p))       # Point(3, 4)
print(f"{p:polar}")  # (5.00, 53.1°)
```

### 5.2 运算符重载

```python
class Vector:
    def __init__(self, *cs): self.components = cs

    def __add__(self, other):
        return Vector(*(a + b for a, b in zip(self.components, other.components)))

    def __mul__(self, other):
        if isinstance(other, Vector):
            return sum(a * b for a, b in zip(self.components, other.components))
        return Vector(*(c * other for c in self.components))

    def __rmul__(self, other): return self.__mul__(other)

    def __abs__(self):
        import math
        return math.sqrt(sum(c**2 for c in self.components))

    def __repr__(self): return f"Vector{self.components}"

v1, v2 = Vector(1, 2, 3), Vector(4, 5, 6)
print(v1 + v2)  # Vector(5, 7, 9)
print(v1 * v2)  # 32 (点乘)
print(3 * v1)   # Vector(3, 6, 9)
```

### 5.3 自定义容器

```python
class SparseArray:
    """只存储非零元素"""
    def __init__(self, default=0):
        self._data, self._default = {}, default

    def __setitem__(self, index, value):
        if value == self._default:
            self._data.pop(index, None)
        else:
            self._data[index] = value

    def __getitem__(self, index):
        return self._data.get(index, self._default)

    def __contains__(self, index): return index in self._data
    def __len__(self): return len(self._data)

arr = SparseArray()
arr[0] = 10; arr[5] = 20
print(arr[0], arr[3], 5 in arr)  # 10 0 True
```

### 5.4 可调用对象 — `__call__`

```python
from collections import defaultdict

class Counter:
    def __init__(self, start=0): self.count = start
    def __call__(self):
        self.count += 1
        return self.count

c = Counter(10)
print(c(), c())  # 11 12

dd = defaultdict(Counter(1))
print(dd["a"], dd["b"])  # 2 2
```

### 5.5 完整示例 — 不可变值对象

```python
class Money:
    """不可变的货币值对象"""
    def __init__(self, amount: float, currency: str = "CNY"):
        self._amount = float(amount)
        self._currency = currency.upper()

    @property
    def amount(self): return self._amount
    @property
    def currency(self): return self._currency

    def __add__(self, other):
        if not isinstance(other, Money): return NotImplemented
        if self.currency != other.currency: raise ValueError("币种不一致")
        return Money(self.amount + other.amount, self.currency)

    def __mul__(self, factor):
        return Money(self.amount * factor, self.currency)

    def __rmul__(self, factor): return self.__mul__(factor)

    def __eq__(self, other):
        if not isinstance(other, Money): return NotImplemented
        return (self.amount, self.currency) == (other.amount, other.currency)

    def __hash__(self):
        return hash((self._amount, self._currency))

    def __repr__(self):
        return f"Money({self.amount:.2f}, {self.currency})"

    def __str__(self):
        symbols = {"CNY": "¥", "USD": "$", "EUR": "€"}
        sym = symbols.get(self.currency, self.currency)
        return f"{sym}{self.amount:.2f}"

total = Money(10000, "CNY") + Money(5000, "CNY")
print(total)                # ¥15000.00
print(total * 0.9)          # ¥13500.00
print({total: "salary"})    # 可哈希，可作字典键
```

---


