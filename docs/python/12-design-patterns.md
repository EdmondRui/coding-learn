# 第 12 章：设计模式

> 目标读者：有 Python 基础、希望系统掌握设计模式以写出可维护、可扩展代码的开发者。本章覆盖 23 种 GoF 设计模式 + Python 惯用模式，每种都有完整代码示例。

---

## 12.1 单例（Singleton）

单例模式确保一个类只有一个实例，并提供全局访问点。Python 中有多种实现方式。

### 12.1.1 模块级单例

```python
# singleton_module.py
"""Python 模块天然是单例 —— 模块在首次导入时执行一次，后续导入返回缓存"""


class DatabaseConnection:
    """数据库连接类"""

    def __init__(self, host: str = "localhost", port: int = 5432):
        self.host = host
        self.port = port
        self._connected = False

    def connect(self) -> None:
        if not self._connected:
            print(f"连接到数据库 {self.host}:{self.port}")
            self._connected = True
        else:
            print("已连接，复用现有连接")

    def query(self, sql: str) -> list:
        if not self._connected:
            raise RuntimeError("未连接数据库")
        print(f"执行查询: {sql}")
        return [{"id": 1, "name": "Alice"}]


# 模块级别的实例 —— 天然单例
db = DatabaseConnection()


# 在其他文件中使用：
# from singleton_module import db
# db.connect()
# db.query("SELECT * FROM users")
```

### 12.1.2 元类实现

```python
from typing import Any


class SingletonMeta(type):
    """单例元类 —— 控制类的实例化过程"""

    _instances: dict[type, object] = {}

    def __call__(cls, *args: Any, **kwargs: Any) -> Any:
        if cls not in cls._instances:
            # 首次调用时创建实例
            instance = super().__call__(*args, **kwargs)
            cls._instances[cls] = instance
        return cls._instances[cls]


class Logger(metaclass=SingletonMeta):
    """日志器 —— 全局唯一实例"""

    def __init__(self, level: str = "INFO"):
        self.level = level
        print(f"Logger 初始化 (level={level})")

    def log(self, message: str) -> None:
        print(f"[{self.level}] {message}")


# 测试单例行为
logger1 = Logger("DEBUG")
logger2 = Logger("ERROR")

print(f"logger1 is logger2: {logger1 is logger2}")  # True
print(f"logger1.level: {logger1.level}")             # DEBUG（第二次初始化被忽略）
logger1.log("这是一条日志")
```

### 12.1.3 装饰器实现

```python
from functools import wraps
from typing import Any, Callable


def singleton(cls: type) -> Callable:
    """装饰器实现单例模式"""
    instances: dict[type, object] = {}

    @wraps(cls)
    def get_instance(*args: Any, **kwargs: Any) -> object:
        if cls not in instances:
            instances[cls] = cls(*args, **kwargs)
        return instances[cls]

    return get_instance


@singleton
class AppConfig:
    """应用配置 —— 单例"""

    def __init__(self, env: str = "development"):
        self.env = env
        self.settings: dict[str, Any] = {}
        print(f"加载配置: {env}")

    def set(self, key: str, value: Any) -> None:
        self.settings[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self.settings.get(key, default)


# 使用示例
config1 = AppConfig("production")
config2 = AppConfig()

print(f"config1 is config2: {config1 is config2}")
config1.set("debug", False)
print(f"config2.get('debug'): {config2.get('debug')}")  # False
```

**要点总结：**
- 模块级单例最简单，适合大多数场景
- 元类实现控制力最强，适合框架开发
- 装饰器实现最灵活，不影响类的继承体系
- 注意单例在多线程环境下的线程安全问题

---

## 12.2 工厂方法（Factory Method）

工厂方法模式定义一个创建对象的接口，让子类决定实例化哪个类。

### 12.2.1 工厂函数

```python
from abc import ABC, abstractmethod
from typing import Any


# ---- 产品接口 ----
class Notification(ABC):
    """通知抽象基类"""

    @abstractmethod
    def send(self, message: str, recipient: str) -> bool:
        ...


class EmailNotification(Notification):
    """邮件通知"""

    def send(self, message: str, recipient: str) -> bool:
        print(f"发送邮件至 {recipient}: {message}")
        return True


class SMSNotification(Notification):
    """短信通知"""

    def send(self, message: str, recipient: str) -> bool:
        print(f"发送短信至 {recipient}: {message}")
        return True


class PushNotification(Notification):
    """推送通知"""

    def send(self, message: str, recipient: str) -> bool:
        print(f"发送推送至设备 {recipient}: {message}")
        return True


# ---- 工厂函数 ----
def create_notification(channel: str) -> Notification:
    """通知工厂函数"""
    factories = {
        "email": EmailNotification,
        "sms": SMSNotification,
        "push": PushNotification,
    }
    cls = factories.get(channel.lower())
    if cls is None:
        raise ValueError(f"不支持的通知渠道: {channel}")
    return cls()


# 使用示例
notifier = create_notification("email")
notifier.send("欢迎使用我们的服务！", "user@example.com")
```

### 12.2.2 字典分发

```python
from typing import Protocol, Any


# ---- Protocol 定义接口 ----
class PaymentProcessor(Protocol):
    """支付处理器协议"""

    def pay(self, amount: float, currency: str) -> dict:
        ...


class AlipayProcessor:
    """支付宝支付"""

    def pay(self, amount: float, currency: str) -> dict:
        print(f"支付宝支付: {currency} {amount}")
        return {"provider": "alipay", "status": "success", "amount": amount}


class WechatPayProcessor:
    """微信支付"""

    def pay(self, amount: float, currency: str) -> dict:
        print(f"微信支付: {currency} {amount}")
        return {"provider": "wechat", "status": "success", "amount": amount}


class StripeProcessor:
    """Stripe 支付"""

    def pay(self, amount: float, currency: str) -> dict:
        print(f"Stripe 支付: {currency} {amount}")
        return {"provider": "stripe", "status": "success", "amount": amount}


# ---- 字典分发注册 ----
class PaymentFactory:
    """支付工厂 —— 支持运行时注册"""

    _processors: dict[str, type] = {
        "alipay": AlipayProcessor,
        "wechat": WechatPayProcessor,
        "stripe": StripeProcessor,
    }

    @classmethod
    def register(cls, name: str, processor_cls: type) -> None:
        """运行时注册新的支付方式"""
        cls._processors[name] = processor_cls

    @classmethod
    def create(cls, name: str, **kwargs: Any) -> PaymentProcessor:
        """创建支付处理器实例"""
        processor_cls = cls._processors.get(name.lower())
        if processor_cls is None:
            raise ValueError(f"不支持的支付方式: {name}")
        return processor_cls(**kwargs)


# 使用示例
payment = PaymentFactory.create("alipay")
result = payment.pay(99.9, "CNY")
print(f"支付结果: {result}")

# 运行时注册新支付方式
class CryptoProcessor:
    def pay(self, amount: float, currency: str) -> dict:
        return {"provider": "crypto", "status": "success", "amount": amount}

PaymentFactory.register("crypto", CryptoProcessor)
crypto = PaymentFactory.create("crypto")
print(crypto.pay(0.1, "BTC"))
```

**要点总结：**
- 工厂方法通过函数或类的 `__init_subclass__` 实现自动注册
- 字典分发比 if-elif 链更易维护和扩展
- Protocol 是 Python 3.8+ 的鸭子类型方案，比 ABC 更灵活

---

## 12.3 抽象工厂（Abstract Factory）

抽象工厂模式提供一个创建一系列相关或依赖对象的接口，无需指定具体类。

```python
from abc import ABC, abstractmethod
from typing import Any


# ---- 抽象产品 ----
class Button(ABC):
    """按钮抽象"""

    @abstractmethod
    def render(self) -> str: ...

    @abstractmethod
    def on_click(self) -> None: ...


class Checkbox(ABC):
    """复选框抽象"""

    @abstractmethod
    def render(self) -> str: ...

    @abstractmethod
    def toggle(self) -> None: ...


# ---- 具体产品：Windows 风格 ----
class WindowsButton(Button):
    def render(self) -> str:
        return "渲染 Windows 风格按钮"

    def on_click(self) -> None:
        print("Windows 按钮被点击")


class WindowsCheckbox(Checkbox):
    def render(self) -> str:
        return "渲染 Windows 风格复选框"

    def toggle(self) -> None:
        print("Windows 复选框切换")


# ---- 具体产品：Mac 风格 ----
class MacButton(Button):
    def render(self) -> str:
        return "渲染 Mac 风格按钮"

    def on_click(self) -> None:
        print("Mac 按钮被点击")


class MacCheckbox(Checkbox):
    def render(self) -> str:
        return "渲染 Mac 风格复选框"

    def toggle(self) -> None:
        print("Mac 复选框切换")


# ---- 抽象工厂 ----
class GUIFactory(ABC):
    """抽象工厂 —— 创建一套相关的 UI 组件"""

    @abstractmethod
    def create_button(self) -> Button: ...

    @abstractmethod
    def create_checkbox(self) -> Checkbox: ...


class WindowsFactory(GUIFactory):
    """Windows 风格工厂"""

    def create_button(self) -> Button:
        return WindowsButton()

    def create_checkbox(self) -> Checkbox:
        return WindowsCheckbox()


class MacFactory(GUIFactory):
    """Mac 风格工厂"""

    def create_button(self) -> Button:
        return MacButton()

    def create_checkbox(self) -> Checkbox:
        return MacCheckbox()


# ---- 客户端 ----
def create_ui(factory: GUIFactory) -> None:
    """使用工厂创建整套 UI 组件"""
    button = factory.create_button()
    checkbox = factory.create_checkbox()

    print(button.render())
    print(checkbox.render())
    button.on_click()
    checkbox.toggle()


# 根据配置选择工厂
def get_factory(os_type: str) -> GUIFactory:
    factories = {
        "windows": WindowsFactory,
        "mac": MacFactory,
    }
    cls = factories.get(os_type.lower())
    if cls is None:
        raise ValueError(f"不支持的操作系统: {os_type}")
    return cls()


# 使用示例
current_os = "mac"  # 可以从配置读取
factory = get_factory(current_os)
create_ui(factory)
```

**要点总结：**
- 抽象工厂保证同一族产品的一致性（Windows 按钮必须配 Windows 复选框）
- 新增产品族只需添加新的工厂类和产品类，符合开闭原则
- 适合需要切换整套实现方案的场景（主题、数据库、云服务商）

---

## 12.4 建造者（Builder）

建造者模式将一个复杂对象的构建与表示分离，使同样的构建过程可以创建不同的表示。

### 12.4.1 链式调用

```python
from dataclasses import dataclass, field
from typing import Optional, Self
from datetime import date


@dataclass
class UserProfile:
    """用户档案 —— 复杂对象"""
    username: str
    email: str
    bio: str = ""
    avatar_url: str = ""
    birthday: Optional[date] = None
    website: str = ""
    github: str = ""
    twitter: str = ""
    skills: list[str] = field(default_factory=list)
    is_public: bool = True


class UserProfileBuilder:
    """用户档案建造者 —— 链式调用"""

    def __init__(self, username: str, email: str):
        self._profile = UserProfile(username=username, email=email)

    def with_bio(self, bio: str) -> Self:
        self._profile.bio = bio
        return self

    def with_avatar(self, url: str) -> Self:
        self._profile.avatar_url = url
        return self

    def with_birthday(self, birthday: date) -> Self:
        self._profile.birthday = birthday
        return self

    def with_website(self, url: str) -> Self:
        self._profile.website = url
        return self

    def with_social(self, github: str = "", twitter: str = "") -> Self:
        self._profile.github = github
        self._profile.twitter = twitter
        return self

    def with_skills(self, *skills: str) -> Self:
        self._profile.skills = list(skills)
        return self

    def set_private(self) -> Self:
        self._profile.is_public = False
        return self

    def build(self) -> UserProfile:
        """构建最终对象"""
        if not self._profile.username or not self._profile.email:
            raise ValueError("用户名和邮箱不能为空")
        return self._profile


# 使用示例
profile = (
    UserProfileBuilder("alice", "alice@example.com")
    .with_bio("全栈工程师，热爱 Python")
    .with_avatar("https://avatars.example.com/alice.png")
    .with_website("https://alice.dev")
    .with_social(github="alice-dev", twitter="@alice_codes")
    .with_skills("Python", "FastAPI", "React", "Docker")
    .set_private()
    .build()
)

print(f"建造完成: {profile}")
```

### 12.4.2 dataclass Builder

```python
from dataclasses import dataclass, field, replace
from typing import Optional, Any


@dataclass
class SQLQuery:
    """SQL 查询构建器 —— 使用 dataclass 实现"""

    table: str
    fields: list[str] = field(default_factory=lambda: ["*"])
    conditions: list[str] = field(default_factory=list)
    order_by: Optional[str] = None
    order_dir: str = "ASC"
    limit: Optional[int] = None
    offset: int = 0
    joins: list[str] = field(default_factory=list)
    group_by: Optional[str] = None

    def select(self, *fields: str) -> "SQLQuery":
        """选择字段"""
        return replace(self, fields=list(fields))

    def where(self, condition: str) -> "SQLQuery":
        """添加 WHERE 条件"""
        return replace(self, conditions=self.conditions + [condition])

    def order(self, field: str, direction: str = "ASC") -> "SQLQuery":
        """排序"""
        return replace(self, order_by=field, order_dir=direction)

    def paginate(self, page: int, size: int = 20) -> "SQLQuery":
        """分页"""
        return replace(self, limit=size, offset=(page - 1) * size)

    def join(self, join_stmt: str) -> "SQLQuery":
        """添加 JOIN"""
        return replace(self, joins=self.joins + [join_stmt])

    def build(self) -> str:
        """生成 SQL 语句"""
        sql = f"SELECT {', '.join(self.fields)} FROM {self.table}"

        for join in self.joins:
            sql += f" {join}"

        if self.conditions:
            sql += " WHERE " + " AND ".join(self.conditions)

        if self.group_by:
            sql += f" GROUP BY {self.group_by}"

        if self.order_by:
            sql += f" ORDER BY {self.order_by} {self.order_dir}"

        if self.limit is not None:
            sql += f" LIMIT {self.limit} OFFSET {self.offset}"

        return sql + ";"


# 使用示例
query = (
    SQLQuery(table="users")
    .select("id", "username", "email", "created_at")
    .where("is_active = true")
    .where("role = 'admin'")
    .order("created_at", "DESC")
    .paginate(page=1, size=20)
    .join("LEFT JOIN profiles ON users.id = profiles.user_id")
    .build()
)

print(query)
# SELECT id, username, email, created_at FROM users
# LEFT JOIN profiles ON users.id = profiles.user_id
# WHERE is_active = true AND role = 'admin'
# ORDER BY created_at DESC
# LIMIT 20 OFFSET 0;
```

**要点总结：**
- 链式调用（fluent interface）让代码可读性极强
- dataclass 的 `replace()` 方法天然支持不可变建造者
- 建造者适合构造参数多、有可选步骤的复杂对象

---

## 12.5 原型（Prototype）

原型模式通过复制现有对象来创建新对象，而非通过实例化。

```python
import copy
from dataclasses import dataclass, field
from typing import Any, Optional
from datetime import datetime


@dataclass
class Address:
    """地址"""
    city: str
    street: str
    zip_code: str


@dataclass
class Document:
    """文档 —— 支持原型复制的对象"""
    title: str
    content: str
    author: str
    tags: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    address: Optional[Address] = None  # 可变引用对象

    def clone(self, deep: bool = True, **updates: Any) -> "Document":
        """克隆原型对象"""
        cloned = copy.deepcopy(self) if deep else copy.copy(self)
        cloned.updated_at = datetime.now()
        # 应用更新
        for key, value in updates.items():
            setattr(cloned, key, value)
        return cloned

    def display(self) -> str:
        return f"Document(title={self.title!r}, author={self.author!r}, tags={self.tags})"


# ---- 原型注册表 ----
class DocumentPrototypeRegistry:
    """文档原型注册表"""

    def __init__(self):
        self._prototypes: dict[str, Document] = {}

    def register(self, name: str, prototype: Document) -> None:
        """注册原型"""
        self._prototypes[name] = prototype

    def unregister(self, name: str) -> None:
        """注销原型"""
        self._prototypes.pop(name, None)

    def create(self, name: str, **updates: Any) -> Document:
        """从原型创建新对象"""
        prototype = self._prototypes.get(name)
        if prototype is None:
            raise KeyError(f"未找到原型: {name}")
        return prototype.clone(**updates)


# 使用示例
registry = DocumentPrototypeRegistry()

# 创建原型
base_article = Document(
    title="文章模板",
    content="请填写内容",
    author="系统",
    tags=["template"],
    metadata={"type": "article", "status": "draft"},
    address=Address(city="Beijing", street="Default", zip_code="100000"),
)

# 注册原型
registry.register("article", base_article)
registry.register("blog", Document(
    title="博客模板",
    content="请在此撰写博客",
    author="系统",
    tags=["blog"],
    metadata={"type": "blog", "visibility": "public"},
))

# 从原型创建新文档
new_article = registry.create(
    "article",
    title="Python 设计模式详解",
    content="设计模式是软件开发中...",
    author="Alice",
    tags=["python", "design-patterns"],
)

blog_post = registry.create(
    "blog",
    title="我的第一篇文章",
    author="Bob",
)

print("原型:", base_article.display())
print("克隆:", new_article.display())
print("深拷贝验证:", base_article.address is new_article.address)  # False（深拷贝）
```

**要点总结：**
- `copy.deepcopy` 处理嵌套对象的完整复制
- `copy.copy` 浅拷贝只复制顶层，内部对象仍共享引用
- 原型模式配合注册表可以像工厂一样按需生产对象

---

## 12.6 适配器（Adapter）

适配器模式将一个类的接口转换成客户端期望的另一个接口。

### 12.6.1 类适配器

```python
from abc import ABC, abstractmethod
from typing import Any


# ---- 目标接口 ----
class JSONAnalyzerTarget(ABC):
    """数据分析器接口（客户端期望的接口）"""

    @abstractmethod
    def load_data(self, json_str: str) -> None: ...

    @abstractmethod
    def calculate_average(self, field: str) -> float: ...

    @abstractmethod
    def get_summary(self) -> dict: ...


# ---- 被适配者（第三方库，接口不同） ----
class XMLProcessor:
    """XML 处理器 —— 接口与客户端期望的不同"""

    def __init__(self):
        self._data: dict = {}

    def parse_xml(self, xml_content: str) -> None:
        """解析 XML 内容"""
        # 模拟 XML 解析
        import json
        # 假设 XML 被转成了 JSON
        self._data = json.loads(xml_content) if xml_content else {}

    def compute_mean(self, column: str) -> float:
        """计算平均值（方法名不同）"""
        values = [
            item.get(column, 0)
            for item in self._data.get("items", [])
            if isinstance(item, dict)
        ]
        return sum(values) / len(values) if values else 0.0

    def get_stats(self) -> dict[str, Any]:
        """获取统计信息"""
        return {"count": len(self._data.get("items", [])), "status": "processed"}


# ---- 适配器 ----
class XMLToJSONAdapter(JSONAnalyzerTarget):
    """类适配器 —— 继承被适配者，实现目标接口"""

    def __init__(self):
        self._processor = XMLProcessor()

    def load_data(self, xml_str: str) -> None:
        """将 XML 解析接口适配为客户端期望的接口"""
        self._processor.parse_xml(xml_str)

    def calculate_average(self, field: str) -> float:
        """适配方法名"""
        return self._processor.compute_mean(field)

    def get_summary(self) -> dict:
        """适配返回格式"""
        stats = self._processor.get_stats()
        return {"total_items": stats["count"], "status": stats["status"]}


# 使用示例
adapter = XMLToJSONAdapter()
xml_data = '{"items": [{"value": 10}, {"value": 20}, {"value": 30}]}'
adapter.load_data(xml_data)
avg = adapter.calculate_average("value")
summary = adapter.get_summary()
print(f"平均值: {avg}")
print(f"摘要: {summary}")
```

### 12.6.2 函数适配器

```python
from typing import Callable, Any


# ---- 外部服务（接口不兼容） ----
class ExternalAuthService:
    """第三方认证服务"""

    def authenticate(self, username: str, password_hash: str) -> dict:
        """返回格式与系统要求不同"""
        return {
            "user": username,
            "authenticated": True,
            "token": "ext_" + password_hash[:8],
            "expires_in": 3600,
        }


# ---- 系统期望的接口 ----
def system_login(username: str, password: str) -> dict:
    """系统期望的登录函数签名"""
    return {
        "username": username,
        "token": "",
        "success": False,
    }


# ---- 函数适配器 ----
def adapt_external_auth(external_service: ExternalAuthService) -> Callable:
    """将外部认证服务适配为系统接口"""
    import hashlib

    def adapted_login(username: str, password: str) -> dict:
        # 做适配转换
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        result = external_service.authenticate(username, password_hash)

        # 转换为系统格式
        return {
            "username": result["user"],
            "token": result["token"],
            "success": result["authenticated"],
            "expires_in": result.get("expires_in", 0),
        }

    return adapted_login


# 使用示例
external_service = ExternalAuthService()
login_adapter = adapt_external_auth(external_service)

result = login_adapter("alice", "secure_password")
print(f"登录结果: {result}")
```

**要点总结：**
- 类适配器通过继承被适配者实现，在 Python 中多用组合而非继承
- 函数适配器通过高阶函数实现，更 Pythonic
- 适配器保持接口不变，只做转换，不改变功能

---

## 12.7 桥接（Bridge）

桥接模式将抽象部分与实现部分分离，使它们可以独立变化。

```python
from abc import ABC, abstractmethod
from typing import Any


# ---- 实现层次 ----
class Device(ABC):
    """设备接口（实现层次）"""

    @abstractmethod
    def is_enabled(self) -> bool: ...

    @abstractmethod
    def enable(self) -> None: ...

    @abstractmethod
    def disable(self) -> None: ...

    @abstractmethod
    def get_volume(self) -> int: ...

    @abstractmethod
    def set_volume(self, percent: int) -> None: ...


class TV(Device):
    """电视机实现"""

    def __init__(self):
        self._on = False
        self._volume = 50

    def is_enabled(self) -> bool:
        return self._on

    def enable(self) -> None:
        self._on = True
        print("电视已开启")

    def disable(self) -> None:
        self._on = False
        print("电视已关闭")

    def get_volume(self) -> int:
        return self._volume

    def set_volume(self, percent: int) -> None:
        self._volume = max(0, min(100, percent))
        print(f"电视音量设置为: {self._volume}")


class Radio(Device):
    """收音机实现"""

    def __init__(self):
        self._on = False
        self._volume = 30

    def is_enabled(self) -> bool:
        return self._on

    def enable(self) -> None:
        self._on = True
        print("收音机已开启")

    def disable(self) -> None:
        self._on = False
        print("收音机已关闭")

    def get_volume(self) -> int:
        return self._volume

    def set_volume(self, percent: int) -> None:
        self._volume = max(0, min(100, percent))
        print(f"收音机音量设置为: {self._volume}")


# ---- 抽象层次 ----
class RemoteControl(ABC):
    """遥控器抽象"""

    def __init__(self, device: Device):
        self._device = device

    def toggle_power(self) -> None:
        if self._device.is_enabled():
            self._device.disable()
        else:
            self._device.enable()

    def volume_up(self) -> None:
        vol = self._device.get_volume()
        self._device.set_volume(vol + 10)

    def volume_down(self) -> None:
        vol = self._device.get_volume()
        self._device.set_volume(vol - 10)


class AdvancedRemoteControl(RemoteControl):
    """高级遥控器"""

    def mute(self) -> None:
        self._device.set_volume(0)
        print("已静音")

    def set_volume_to(self, percent: int) -> None:
        self._device.set_volume(percent)


# 使用示例
tv = TV()
remote = AdvancedRemoteControl(tv)

remote.toggle_power()      # 开启电视
remote.volume_up()         # 音量大
remote.volume_up()         # 音量大
remote.mute()              # 静音
remote.toggle_power()      # 关闭电视

print("\n切换到收音机...")
radio = Radio()
radio_remote = AdvancedRemoteControl(radio)
radio_remote.toggle_power()
radio_remote.set_volume_to(80)
```

**要点总结：**
- 抽象和实现可独立扩展：新增设备不影响遥控器，新增遥控器不影响设备
- 桥接用组合代替继承，避免类爆炸（N 种设备 × M 种遥控器 = N+M 个类）
- 适用于跨平台 UI、多数据库支持等场景

---

## 12.8 组合（Composite）

组合模式将对象组合成树形结构以表示"部分-整体"的层次结构。

```python
from abc import ABC, abstractmethod
from typing import List, Optional


# ---- 组件接口 ----
class FileSystemNode(ABC):
    """文件系统节点接口"""

    def __init__(self, name: str):
        self.name = name
        self.parent: Optional["Directory"] = None

    @abstractmethod
    def get_size(self) -> int: ...

    @abstractmethod
    def display(self, indent: str = "") -> str: ...

    def get_path(self) -> str:
        """获取完整路径"""
        if self.parent:
            return f"{self.parent.get_path()}/{self.name}"
        return self.name


# ---- 叶子节点 ----
class File(FileSystemNode):
    """文件（叶子节点）"""

    def __init__(self, name: str, size: int = 0):
        super().__init__(name)
        self.size = size

    def get_size(self) -> int:
        return self.size

    def display(self, indent: str = "") -> str:
        size_str = f" ({self.size} bytes)" if self.size > 0 else ""
        return f"{indent}📄 {self.name}{size_str}"


# ---- 容器节点 ----
class Directory(FileSystemNode):
    """目录（容器节点）"""

    def __init__(self, name: str):
        super().__init__(name)
        self._children: list[FileSystemNode] = []

    def add(self, node: FileSystemNode) -> "Directory":
        """添加子节点"""
        self._children.append(node)
        node.parent = self
        return self  # 支持链式调用

    def remove(self, node: FileSystemNode) -> None:
        """移除子节点"""
        self._children.remove(node)
        node.parent = None

    def get_child(self, name: str) -> Optional[FileSystemNode]:
        """按名称查找子节点"""
        for child in self._children:
            if child.name == name:
                return child
        return None

    def get_size(self) -> int:
        """递归计算目录总大小"""
        return sum(child.get_size() for child in self._children)

    def display(self, indent: str = "") -> str:
        result = f"{indent}📁 {self.name}/ ({self.get_size()} bytes)"
        for child in self._children:
            result += "\n" + child.display(indent + "  ")
        return result


# 使用示例 — 构建文件系统树
root = Directory("root")

home = Directory("home")
alice = Directory("alice")
alice.add(File("readme.md", 1024))
alice.add(File("profile.jpg", 204800))
home.add(alice)
home.add(File("shared.txt", 512))

etc = Directory("etc")
etc.add(File("config.yaml", 2048))
etc.add(File("hosts", 128))

root.add(home)
root.add(etc)
root.add(File("VERSION", 32))

# 树形展示
print(root.display())
print(f"\n总大小: {root.get_size()} bytes")
print(f"home 路径: {home.get_path()}")
```

**要点总结：**
- 叶子节点和容器节点实现同一接口，客户端可以统一处理
- 递归组合天然适合树形结构（文件系统、DOM、组织架构）
- 新增节点类型无需修改现有代码

---

## 12.9 装饰器（Decorator）

装饰器模式动态地给对象添加额外职责，Python 语法原生支持这一模式。

### 12.9.1 函数装饰器

```python
import time
import functools
from typing import Any, Callable


def timer(func: Callable) -> Callable:
    """计时装饰器 —— 打印函数执行时间"""
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"[{func.__name__}] 耗时: {elapsed:.4f}s")
        return result
    return wrapper


def retry(max_attempts: int = 3, delay: float = 0.5) -> Callable:
    """重试装饰器 —— 失败后自动重试"""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts:
                        raise
                    print(f"[{func.__name__}] 第 {attempt} 次失败: {e}, 重试中...")
                    time.sleep(delay)
            return None  # never reached
        return wrapper
    return decorator


def log_call(func: Callable) -> Callable:
    """日志装饰器 —— 记录函数调用"""
    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        args_repr = [repr(a) for a in args]
        kwargs_repr = [f"{k}={v!r}" for k, v in kwargs.items()]
        signature = ", ".join(args_repr + kwargs_repr)
        print(f"→ 调用 {func.__name__}({signature})")
        result = func(*args, **kwargs)
        print(f"← {func.__name__} 返回: {result!r}")
        return result
    return wrapper


# 组合使用多个装饰器
@log_call
@timer
@retry(max_attempts=2)
def fetch_data(url: str, timeout: float = 10) -> dict:
    """获取远程数据"""
    if "error" in url:
        raise ConnectionError("连接失败")
    return {"url": url, "status": 200, "data": "..."}


# 使用示例
print("--- 正常调用 ---")
result = fetch_data("https://api.example.com/data")

print("\n--- 失败重试 ---")
try:
    fetch_data("https://api.example.com/error")
except ConnectionError:
    print("最终仍失败")
```

### 12.9.2 类装饰器

```python
from typing import Any, Callable
import functools


def singleton(cls: type) -> Callable:
    """类装饰器：单例模式"""
    instances: dict[type, object] = {}

    @functools.wraps(cls)
    def get_instance(*args: Any, **kwargs: Any) -> object:
        if cls not in instances:
            instances[cls] = cls(*args, **kwargs)
        return instances[cls]

    return get_instance


def add_repr(cls: type) -> type:
    """类装饰器：自动添加 __repr__ 方法"""
    def __repr__(self) -> str:
        items = []
        for attr, value in self.__dict__.items():
            items.append(f"{attr}={value!r}")
        return f"{cls.__name__}({', '.join(items)})"

    cls.__repr__ = __repr__
    return cls


def add_methods(*methods: Callable) -> Callable[[type], type]:
    """类装饰器：批量添加方法"""
    def decorator(cls: type) -> type:
        for method in methods:
            setattr(cls, method.__name__, method)
        return cls
    return decorator


# ---- 使用 ----

@add_repr
@singleton
class DatabasePool:
    """数据库连接池（单例）"""
    def __init__(self, max_connections: int = 10):
        self.max_connections = max_connections
        self._connections = []

    def acquire(self) -> str:
        return "connection_1"


# 添加额外方法
def health_check(self) -> str:
    return f"OK (连接数: {len(self._connections)})"

DatabasePool = add_methods(health_check)(DatabasePool)


# 测试
pool1 = DatabasePool(20)
pool2 = DatabasePool()
print(f"同一实例: {pool1 is pool2}")
print(repr(pool1))
print(pool1.health_check())
```

**要点总结：**
- `functools.wraps` 保留原函数的元信息（`__name__`, `__doc__` 等）
- 多个装饰器的执行顺序是从下到上（靠近函数的先执行）
- 类装饰器适合横切关注点（日志、缓存、单例等）

---

## 12.10 外观（Facade）

外观模式为子系统提供一个统一的简化接口。

```python
from typing import Any
from datetime import datetime


# ---- 复杂子系统 ----
class InventorySystem:
    """库存系统"""

    def check_stock(self, product_id: str) -> bool:
        print(f"  检查库存: {product_id}")
        return True  # 模拟有库存

    def reserve(self, product_id: str, quantity: int) -> str:
        print(f"  预留库存: {product_id} × {quantity}")
        return "RES-12345"


class PaymentSystem:
    """支付系统"""

    def charge(self, user_id: str, amount: float) -> str:
        print(f"  扣款: 用户 {user_id}, 金额 ¥{amount}")
        return "PAY-67890"

    def refund(self, payment_id: str) -> bool:
        print(f"  退款: {payment_id}")
        return True


class ShippingSystem:
    """物流系统"""

    def create_shipment(self, order_id: str, address: dict) -> str:
        print(f"  创建物流单: {order_id}")
        return "SF-11111"

    def track(self, tracking_id: str) -> dict:
        return {"status": "in_transit", "location": "北京中转站"}


class NotificationSystem:
    """通知系统"""

    def send_email(self, email: str, subject: str, body: str) -> bool:
        print(f"  发送邮件至 {email}: {subject}")
        return True


# ---- 外观 ----
class OrderFacade:
    """订单外观 —— 统一的下单接口"""

    def __init__(self):
        self._inventory = InventorySystem()
        self._payment = PaymentSystem()
        self._shipping = ShippingSystem()
        self._notification = NotificationSystem()

    def place_order(
        self,
        user_id: str,
        email: str,
        product_id: str,
        quantity: int,
        address: dict,
    ) -> dict[str, Any]:
        """一站式下单"""
        print(f"\n--- 开始处理订单 ---")
        order_id = f"ORD-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # 1. 检查库存
        if not self._inventory.check_stock(product_id):
            return {"success": False, "error": "库存不足"}

        # 2. 预留库存
        reservation_id = self._inventory.reserve(product_id, quantity)

        # 3. 处理支付
        amount = 99.9 * quantity  # 简化定价
        payment_id = self._payment.charge(user_id, amount)

        # 4. 创建物流
        tracking_id = self._shipping.create_shipment(order_id, address)

        # 5. 发送通知
        self._notification.send_email(
            email,
            "订单确认",
            f"您的订单 {order_id} 已确认，物流单号: {tracking_id}",
        )

        return {
            "success": True,
            "order_id": order_id,
            "payment_id": payment_id,
            "tracking_id": tracking_id,
            "amount": amount,
        }


# 使用示例
facade = OrderFacade()
result = facade.place_order(
    user_id="user_001",
    email="alice@example.com",
    product_id="PROD-001",
    quantity=2,
    address={"city": "北京", "street": "长安街 1 号"},
)
print(f"\n下单结果: {result}")
```

**要点总结：**
- 外观封装子系统复杂性，客户端只与外观交互
- 外观不限制客户端直接访问子系统（与中介者不同）
- 适用于为复杂系统提供简化入口，如 SDK、库的门面类

---

## 12.11 享元（Flyweight）

享元模式通过共享大量细粒度对象来减少内存使用。

### 12.11.1 `__slots__` 优化

```python
import sys
from typing import Any


# ---- 不使用 __slots__（每个实例有 __dict__） ----
class CharacterWithoutSlots:
    """字符（不优化）"""
    def __init__(self, char: str, font: str, size: int, color: str):
        self.char = char
        self.font = font
        self.size = size
        self.color = color


# ---- 使用 __slots__ ----
class CharacterOptimized:
    """字符（使用 __slots__ 优化内存）"""
    __slots__ = ("char", "font", "size", "color")

    def __init__(self, char: str, font: str, size: int, color: str):
        self.char = char
        self.font = font
        self.size = size
        self.color = color


# ---- 享元工厂 + 内部/外部状态分离 ----
class CharacterStyle:
    """字符样式 —— 内部状态（可共享）"""
    __slots__ = ("font", "size", "color")

    def __init__(self, font: str, size: int, color: str):
        self.font = font
        self.size = size
        self.color = color


class CharacterFlyweight:
    """享元字符 —— 分离内部状态（样式）和外部状态（位置）"""
    __slots__ = ("char", "style")

    def __init__(self, char: str, style: CharacterStyle):
        self.char = char
        self.style = style

    def render(self, x: int, y: int) -> str:
        """外部状态（位置）在方法调用时传入"""
        return (
            f"字符 '{self.char}' "
            f"[字体={self.style.font}, 大小={self.style.size}, 颜色={self.style.color}] "
            f"渲染在 ({x}, {y})"
        )


class GlyphFactory:
    """享元工厂 —— 管理享元对象的创建和共享"""

    def __init__(self):
        self._style_pool: dict[tuple, CharacterStyle] = {}
        self._char_pool: dict[tuple, CharacterFlyweight] = {}

    def get_style(self, font: str, size: int, color: str) -> CharacterStyle:
        """获取或创建样式享元"""
        key = (font, size, color)
        if key not in self._style_pool:
            self._style_pool[key] = CharacterStyle(font, size, color)
            print(f"  [新建样式] {key}")
        return self._style_pool[key]

    def get_character(self, char: str, font: str, size: int, color: str) -> CharacterFlyweight:
        """获取或创建字符享元"""
        style = self.get_style(font, size, color)
        key = (char, font, size, color)
        if key not in self._char_pool:
            self._char_pool[key] = CharacterFlyweight(char, style)
        return self._char_pool[key]


# 对比测试
def compare_memory_usage():
    """对比优化前后的内存使用"""
    factory = GlyphFactory()

    # 传统方式：每个字符独立存储所有属性
    traditional = [
        CharacterWithoutSlots(f"c{i}", "Arial", 12, "black")
        for i in range(1000)
    ]

    # 享元方式：共享样式，只存字符+样式引用
    flyweight = [
        factory.get_character(f"c{i}", "Arial", 12, "black")
        for i in range(1000)
    ]

    # 比较单个对象大小
    traditional_size = sys.getsizeof(traditional[0]) + sys.getsizeof(traditional[0].__dict__)
    flyweight_size = sys.getsizeof(flyweight[0])

    print(f"传统对象大小: ~{traditional_size} bytes")
    print(f"享元对象大小: ~{flyweight_size} bytes")
    print(f"样式池大小: {len(factory._style_pool)}")  # 只有 1 个样式对象


# 使用示例
compare_memory_usage()

print("\n--- 享元渲染 ---")
factory = GlyphFactory()
chars = [
    ("H", "Arial", 12, "black"),
    ("e", "Arial", 12, "black"),
    ("l", "Arial", 12, "black"),
    ("l", "Arial", 12, "black"),
    ("o", "Arial", 12, "black"),
]

for i, (char, font, size, color) in enumerate(chars):
    c = factory.get_character(char, font, size, color)
    print(c.render(i * 10, 100))
```

### 12.11.2 对象池

```python
import threading
from typing import TypeVar, Generic, Optional
from contextlib import contextmanager

T = TypeVar("T")


class ObjectPool(Generic[T]):
    """通用对象池"""

    def __init__(self, factory, min_size: int = 5, max_size: int = 20):
        self._factory = factory
        self._min_size = min_size
        self._max_size = max_size
        self._pool: list[T] = []
        self._lock = threading.Lock()

        # 预创建
        for _ in range(min_size):
            self._pool.append(self._factory())

    def acquire(self) -> T:
        """从池中获取对象"""
        with self._lock:
            if self._pool:
                return self._pool.pop()
            if len(self._pool) < self._max_size:
                return self._factory()
            raise RuntimeError("连接池已满")

    def release(self, obj: T) -> None:
        """归还对象到池中"""
        with self._lock:
            if len(self._pool) < self._max_size:
                self._pool.append(obj)

    @contextmanager
    def get(self):
        """上下文管理器方式使用"""
        obj = self.acquire()
        try:
            yield obj
        finally:
            self.release(obj)


# 使用示例
class DatabaseConnection:
    """数据库连接"""
    def __init__(self):
        self.id = id(self)
        print(f"  创建连接 #{self.id}")

    def query(self, sql: str) -> str:
        return f"[连接 #{self.id}] 查询结果: {sql}"


# 创建连接池
pool = ObjectPool(DatabaseConnection, min_size=3, max_size=10)

print("从连接池获取连接:")
with pool.get() as conn:
    print(conn.query("SELECT 1"))
    print(conn.query("SELECT 2"))

with pool.get() as conn2:
    print(conn2.query("SELECT 3"))
```

**要点总结：**
- `__slots__` 减少每个实例的内存开销（消除 `__dict__`）
- 享元的核心是分离内部状态（可共享）和外部状态（上下文相关）
- 对象池是享元的一种变体，适用于连接、线程等资源复用

---

## 12.12 代理（Proxy）

代理模式为其他对象提供一种代理以控制对这个对象的访问。

### 12.12.1 属性代理

```python
from typing import Any, Optional
import time


# ---- 真实主题 ----
class ExpensiveImage:
    """大图片 —— 加载代价高"""

    def __init__(self, filename: str):
        self.filename = filename
        self._load_image()

    def _load_image(self) -> None:
        """模拟从磁盘加载大图片"""
        print(f"正在从磁盘加载图片: {self.filename}...")
        time.sleep(1)  # 模拟 IO
        self._data = f"binary data of {self.filename}"
        print(f"加载完成: {self.filename}")

    def display(self) -> str:
        return f"显示图片: {self.filename} ({len(self._data)} bytes)"


class ImageProxy:
    """图片代理 —— 延迟加载"""

    def __init__(self, filename: str):
        self.filename = filename
        self._real_image: Optional[ExpensiveImage] = None

    def display(self) -> str:
        """首次调用时触发真实加载"""
        if self._real_image is None:
            self._real_image = ExpensiveImage(self.filename)
        return self._real_image.display()

    @property
    def is_loaded(self) -> bool:
        return self._real_image is not None


# 使用示例
print("创建代理对象（不加载图片）:")
proxy = ImageProxy("photo_hd.jpg")

print("\n用户点击图片，触发加载:")
print(proxy.display())

print("\n再次显示（使用缓存）:")
print(proxy.display())
```

### 12.12.2 延迟加载 + 访问控制

```python
from typing import Any, Optional
import time


class APIClient:
    """真实 API 客户端"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._init_client()

    def _init_client(self) -> None:
        """初始化 SDK 客户端（耗时操作）"""
        print("初始化 API 客户端...")
        time.sleep(0.5)
        self._client = {"base_url": "https://api.example.com"}

    def fetch_users(self) -> list[dict]:
        print(f"获取用户列表 (API Key: {self.api_key[:4]}...)")
        return [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]

    def create_user(self, data: dict) -> dict:
        print(f"创建用户: {data}")
        return {"id": 3, **data}


class AuthorizedAPIProxy:
    """带权限控制的 API 代理"""

    def __init__(self, api_key: str):
        self._api_key = api_key
        self._real_client: Optional[APIClient] = None
        self._rate_limit_remaining = 100
        self._last_request_time = 0.0

    def _check_rate_limit(self) -> None:
        """检查速率限制"""
        if self._rate_limit_remaining <= 0:
            raise RuntimeError("API 速率限制已用尽")
        now = time.time()
        if now - self._last_request_time < 0.1:
            raise RuntimeError("请求过于频繁")
        self._last_request_time = now

    def _get_client(self) -> APIClient:
        """延迟初始化客户端"""
        if self._real_client is None:
            self._real_client = APIClient(self._api_key)
        return self._real_client

    def fetch_users(self) -> list[dict]:
        """代理访问"""
        self._check_rate_limit()

        # 缓存检查
        if hasattr(self, "_cached_users"):
            print("返回缓存的用户列表")
            return self._cached_users

        users = self._get_client().fetch_users()
        self._cached_users = users
        self._rate_limit_remaining -= 1
        return users

    def create_user(self, data: dict) -> dict:
        """代理访问（写操作不缓存）"""
        self._check_rate_limit()

        # 参数校验
        if "name" not in data:
            raise ValueError("用户名称不能为空")

        result = self._get_client().create_user(data)
        # 清空读缓存
        if hasattr(self, "_cached_users"):
            del self._cached_users
        self._rate_limit_remaining -= 1
        return result


# 使用示例
proxy = AuthorizedAPIProxy("sk-abc123secret")
print("代理已创建，客户端尚未初始化\n")

users = proxy.fetch_users()
print(f"用户列表: {users}\n")

# 再次调用（命中缓存）
users_again = proxy.fetch_users()
print(f"再次获取（缓存）: {users_again}\n")

new_user = proxy.create_user({"name": "Charlie"})
print(f"新用户: {new_user}")
```

**要点总结：**
- 虚拟代理（Virtual Proxy）实现延迟加载，优化性能
- 保护代理（Protection Proxy）控制访问权限
- 远程代理（Remote Proxy）隐藏网络通信细节
- Python 中 `__getattr__` 可用于实现更通用的代理

---

## 12.13 责任链（Chain of Responsibility）

责任链模式将请求沿着处理者链传递，直到有一个处理者能够处理它。

### 12.13.1 中间件链

```python
from abc import ABC, abstractmethod
from typing import Optional, Any
from dataclasses import dataclass, field


@dataclass
class Request:
    """HTTP 请求"""
    path: str
    method: str
    headers: dict[str, str] = field(default_factory=dict)
    ip: str = "127.0.0.1"
    user: Optional[dict] = None
    body: dict = field(default_factory=dict)
    valid: bool = True
    error: Optional[str] = None


class Middleware(ABC):
    """中间件基类"""

    def __init__(self):
        self._next: Optional["Middleware"] = None

    def set_next(self, middleware: "Middleware") -> "Middleware":
        """设置链中的下一个处理者"""
        self._next = middleware
        return middleware

    def handle(self, request: Request) -> Request:
        """处理请求，可传递给下一个"""
        request = self.process(request)
        if request.valid and self._next:
            return self._next.handle(request)
        return request

    @abstractmethod
    def process(self, request: Request) -> Request:
        """实际的请求处理"""
        ...


class LoggingMiddleware(Middleware):
    """日志中间件"""

    def process(self, request: Request) -> Request:
        print(f"[日志] {request.method} {request.path} 来自 {request.ip}")
        return request


class AuthMiddleware(Middleware):
    """认证中间件"""

    def process(self, request: Request) -> Request:
        token = request.headers.get("Authorization", "")
        if token.startswith("Bearer "):
            token = token[7:]
            if token == "valid-token":
                request.user = {"id": 1, "name": "Alice", "role": "admin"}
                print(f"[认证] 用户: Alice")
                return request
        request.valid = False
        request.error = "未授权"
        return request


class RateLimitMiddleware(Middleware):
    """限流中间件"""

    def __init__(self, max_requests: int = 10):
        super().__init__()
        self._requests: dict[str, int] = {}

    def process(self, request: Request) -> Request:
        count = self._requests.get(request.ip, 0)
        if count >= 10:
            request.valid = False
            request.error = "请求过于频繁"
            return request
        self._requests[request.ip] = count + 1
        print(f"[限流] IP {request.ip}: 第 {count + 1} 次请求")
        return request


class RouterMiddleware(Middleware):
    """路由中间件（最终处理者）"""

    def process(self, request: Request) -> Request:
        print(f"[路由] 处理 {request.method} {request.path}")
        if request.path == "/api/users":
            print("  → 返回用户列表")
        elif request.path == "/api/login":
            print("  → 处理登录")
        else:
            print(f"  → 404 未找到路由")
        return request


# 构建责任链
logging = LoggingMiddleware()
auth = AuthMiddleware()
rate_limit = RateLimitMiddleware()
router = RouterMiddleware()

logging.set_next(auth).set_next(rate_limit).set_next(router)

# 使用示例
valid_request = Request(
    path="/api/users",
    method="GET",
    headers={"Authorization": "Bearer valid-token"},
    ip="192.168.1.1",
)

print("--- 有效请求 ---")
result = logging.handle(valid_request)
print(f"结果: valid={result.valid}, error={result.error}\n")

invalid_request = Request(
    path="/api/admin",
    method="POST",
    headers={},
    ip="192.168.1.2",
)

print("--- 无效请求 ---")
result = logging.handle(invalid_request)
print(f"结果: valid={result.valid}, error={result.error}")
```

**要点总结：**
- 责任链将发送者与接收者解耦，每个处理者只关心自己的职责
- 可以动态组合链的顺序
- Web 框架的中间件是责任链的典型应用

---

## 12.14 命令（Command）

命令模式将请求封装为对象，从而支持参数化、队列化、日志化操作。

### 12.14.1 可调用对象

```python
from abc import ABC, abstractmethod
from typing import Any, Callable
from dataclasses import dataclass, field
import sys


# ---- 接收者 ----
class TextEditor:
    """文本编辑器（接收者）"""

    def __init__(self):
        self.content = ""
        self.clipboard = ""

    def insert(self, text: str, pos: int = -1) -> None:
        if pos == -1:
            pos = len(self.content)
        self.content = self.content[:pos] + text + self.content[pos:]
        print(f"插入 '{text}' → 内容: '{self.content}'")

    def delete(self, start: int, length: int) -> str:
        deleted = self.content[start:start + length]
        self.content = self.content[:start] + self.content[start + length:]
        print(f"删除 '{deleted}' → 内容: '{self.content}'")
        return deleted

    def copy(self, start: int, length: int) -> None:
        self.clipboard = self.content[start:start + length]
        print(f"复制 '{self.clipboard}'")

    def paste(self, pos: int = -1) -> None:
        if self.clipboard:
            self.insert(self.clipboard, pos)


# ---- 命令接口 ----
class Command(ABC):
    """命令抽象基类"""

    @abstractmethod
    def execute(self) -> None: ...

    @abstractmethod
    def undo(self) -> None: ...


class InsertCommand(Command):
    """插入命令"""

    def __init__(self, editor: TextEditor, text: str, pos: int = -1):
        self.editor = editor
        self.text = text
        self.pos = pos
        self._executed = False

    def execute(self) -> None:
        self.editor.insert(self.text, self.pos)
        self._executed = True

    def undo(self) -> None:
        if self._executed:
            length = len(self.text)
            pos = self.pos if self.pos != -1 else len(self.editor.content) - length
            self.editor.delete(pos, length)


class DeleteCommand(Command):
    """删除命令"""

    def __init__(self, editor: TextEditor, start: int, length: int):
        self.editor = editor
        self.start = start
        self.length = length
        self._deleted_text = ""

    def execute(self) -> None:
        self._deleted_text = self.editor.delete(self.start, self.length)

    def undo(self) -> None:
        self.editor.insert(self._deleted_text, self.start)


class CopyCommand(Command):
    """复制命令（无 undo）"""

    def __init__(self, editor: TextEditor, start: int, length: int):
        self.editor = editor
        self.start = start
        self.length = length

    def execute(self) -> None:
        self.editor.copy(self.start, self.length)

    def undo(self) -> None:
        pass  # 复制操作无需撤销


# ---- 调用者（命令管理器） ----
class CommandManager:
    """命令管理器 —— 支持撤销/重做"""

    def __init__(self):
        self._undo_stack: list[Command] = []
        self._redo_stack: list[Command] = []

    def execute(self, command: Command) -> None:
        command.execute()
        self._undo_stack.append(command)
        self._redo_stack.clear()

    def undo(self) -> None:
        if self._undo_stack:
            command = self._undo_stack.pop()
            command.undo()
            self._redo_stack.append(command)

    def redo(self) -> None:
        if self._redo_stack:
            command = self._redo_stack.pop()
            command.execute()
            self._undo_stack.append(command)


# 使用示例
editor = TextEditor()
manager = CommandManager()

print("--- 编辑操作 ---")
manager.execute(InsertCommand(editor, "Hello"))
manager.execute(InsertCommand(editor, " World", 5))
manager.execute(DeleteCommand(editor, 5, 6))

print("\n--- 撤销 ---")
manager.undo()  # 撤销删除
manager.undo()  # 撤销插入 " World"

print("\n--- 重做 ---")
manager.redo()  # 重新插入 " World"
```

### 12.14.2 函数命令

```python
from typing import Callable, Any
from dataclasses import dataclass, field
from collections.abc import Callable as CallableABC


class FunctionCommand:
    """基于函数的命令 —— 更轻量"""

    def __init__(
        self,
        execute_fn: CallableABC[[], Any],
        undo_fn: CallableABC[[], Any] | None = None,
        name: str = "",
    ):
        self._execute = execute_fn
        self._undo = undo_fn
        self.name = name or execute_fn.__name__
        self._executed = False

    def execute(self) -> Any:
        result = self._execute()
        self._executed = True
        return result

    def undo(self) -> None:
        if self._undo:
            self._undo()


class MacroCommand:
    """宏命令 —— 组合多个命令"""

    def __init__(self, commands: list[FunctionCommand], name: str = "macro"):
        self.commands = commands
        self.name = name

    def execute(self) -> None:
        print(f"执行宏: {self.name}")
        for cmd in self.commands:
            cmd.execute()

    def undo(self) -> None:
        print(f"撤销宏: {self.name}")
        for cmd in reversed(self.commands):
            cmd.undo()


# 使用示例
counter = {"value": 0}

def increment():
    counter["value"] += 1
    print(f"递增: {counter['value']}")

def decrement():
    counter["value"] -= 1
    print(f"递减: {counter['value']}")

def multiply():
    counter["value"] *= 2
    print(f"翻倍: {counter['value']}")

def divide():
    counter["value"] //= 2
    print(f"减半: {counter['value']}")


inc = FunctionCommand(increment, decrement, "increment")
mul = FunctionCommand(multiply, divide, "multiply")

macro = MacroCommand([inc, inc, mul], "double_increment")
macro.execute()
print(f"最终值: {counter['value']}")

macro.undo()
print(f"撤销后: {counter['value']}")
```

**要点总结：**
- 命令模式将操作参数化，支持延迟执行、队列、日志
- 通过存储执行状态可以实现撤销/重做
- Python 中函数是一等公民，简单场景直接用函数即可

---

## 12.15 迭代器（Iterator）

迭代器模式提供一种顺序访问聚合对象元素的方法，而不暴露其底层表示。

### 12.15.1 `__iter__` / `__next__`

```python
from typing import Any, Optional


class TreeNode:
    """二叉树节点"""

    def __init__(self, value: Any):
        self.value = value
        self.left: Optional["TreeNode"] = None
        self.right: Optional["TreeNode"] = None


class BinaryTree:
    """二叉树 —— 支持多种遍历方式的迭代器"""

    def __init__(self, root: TreeNode):
        self.root = root

    def __iter__(self):
        """默认使用中序遍历"""
        return self._inorder(self.root)

    @staticmethod
    def _inorder(node: Optional[TreeNode]):
        """中序遍历生成器"""
        if node:
            yield from BinaryTree._inorder(node.left)
            yield node.value
            yield from BinaryTree._inorder(node.right)

    @staticmethod
    def _preorder(node: Optional[TreeNode]):
        """前序遍历生成器"""
        if node:
            yield node.value
            yield from BinaryTree._preorder(node.left)
            yield from BinaryTree._preorder(node.right)

    @staticmethod
    def _postorder(node: Optional[TreeNode]):
        """后序遍历生成器"""
        if node:
            yield from BinaryTree._postorder(node.left)
            yield from BinaryTree._postorder(node.right)
            yield node.value

    def preorder(self):
        """前序遍历"""
        return self._preorder(self.root)

    def postorder(self):
        """后序遍历"""
        return self._postorder(self.root)

    def bfs(self):
        """广度优先遍历"""
        if not self.root:
            return
        queue = [self.root]
        while queue:
            node = queue.pop(0)
            yield node.value
            if node.left:
                queue.append(node.left)
            if node.right:
                queue.append(node.right)


# 使用示例
root = TreeNode(1)
root.left = TreeNode(2)
root.right = TreeNode(3)
root.left.left = TreeNode(4)
root.left.right = TreeNode(5)
root.right.left = TreeNode(6)
root.right.right = TreeNode(7)

tree = BinaryTree(root)

print("中序遍历（默认）:", list(tree))
print("前序遍历:", list(tree.preorder()))
print("后序遍历:", list(tree.postorder()))
print("BFS:", list(tree.bfs()))
```

### 12.15.2 可迭代工具

```python
from typing import Iterator, Any


class PaginatedAPI:
    """分页 API 迭代器 —— 自动获取所有页"""

    def __init__(self, base_url: str, page_size: int = 20):
        self.base_url = base_url
        self.page_size = page_size

    def _fetch_page(self, page: int) -> list[dict]:
        """模拟 API 调用"""
        # 假设返回了分页数据
        if page > 3:  # 总共 3 页
            return []
        return [
            {"id": i, "name": f"Item {i}", "page": page}
            for i in range((page - 1) * self.page_size + 1, page * self.page_size + 1)
        ]

    def __iter__(self) -> Iterator[dict]:
        """迭代所有页面中的所有项目"""
        page = 1
        while True:
            items = self._fetch_page(page)
            if not items:
                break
            yield from items
            page += 1


class LazySequence:
    """惰性序列 —— 按需计算元素"""

    def __init__(self, generator_func, start: int = 0, end: int = float("inf")):
        self._generator_func = generator_func
        self._start = start
        self._end = end

    def __iter__(self) -> Iterator:
        for i in range(self._start, self._end):
            yield self._generator_func(i)

    def __getitem__(self, index: int):
        """支持索引访问"""
        if index < 0:
            raise IndexError("不支持负索引")
        if index >= self._end - self._start:
            raise IndexError("超出范围")
        return self._generator_func(self._start + index)

    def take(self, n: int):
        """取前 n 个元素"""
        return [self._generator_func(i) for i in range(self._start, self._start + n)]


# 使用示例
print("--- 分页迭代器 ---")
api = PaginatedAPI("https://api.example.com/items", page_size=5)
for i, item in enumerate(api):
    if i >= 7:
        break
    print(f"  {item}")

print("\n--- 惰性序列 ---")
lazy = LazySequence(lambda n: n ** 2, 0, 100)
print("前 10 个:", lazy.take(10))
print("第 5 个:", lazy[5])
```

**要点总结：**
- 生成器（`yield`）是实现迭代器最 Pythonic 的方式
- `__iter__` 返回迭代器对象，`__next__` 定义每次迭代的行为
- 迭代器模式让客户端无需了解聚合对象的内部结构

---

## 12.16 中介者（Mediator）

中介者模式定义一个中介对象来封装一组对象之间的交互。

### 12.16.1 事件总线

```python
from typing import Any, Callable
from collections import defaultdict
import asyncio


class EventBus:
    """事件总线 —— 中介者"""

    def __init__(self):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)

    def subscribe(self, event_type: str, handler: Callable) -> None:
        """订阅事件"""
        self._subscribers[event_type].append(handler)
        print(f"[总线] 注册订阅: {event_type} -> {handler.__name__}")

    def unsubscribe(self, event_type: str, handler: Callable) -> None:
        """取消订阅"""
        if handler in self._subscribers[event_type]:
            self._subscribers[event_type].remove(handler)

    def publish(self, event_type: str, **data: Any) -> None:
        """发布事件（同步）"""
        print(f"[总线] 发布事件: {event_type} {data}")
        for handler in self._subscribers.get(event_type, []):
            handler(**data)

    async def publish_async(self, event_type: str, **data: Any) -> None:
        """发布事件（异步）"""
        print(f"[总线] 异步事件: {event_type}")
        for handler in self._subscribers.get(event_type, []):
            if asyncio.iscoroutinefunction(handler):
                await handler(**data)
            else:
                handler(**data)


# ---- 组件 ----
class UserService:
    """用户服务"""

    def __init__(self, bus: EventBus):
        self.bus = bus
        # 订阅事件
        bus.subscribe("user.registered", self.on_user_registered)

    def register(self, username: str, email: str) -> None:
        """用户注册"""
        print(f"[用户服务] 注册用户: {username} ({email})")
        # 发布注册事件
        self.bus.publish("user.registered", username=username, email=email)

    def on_user_registered(self, username: str, email: str) -> None:
        """处理用户注册事件的回调（通过订阅触发）"""
        # 注意：这里只是演示订阅关系，实际中防止循环
        pass


class EmailService:
    """邮件服务"""

    def __init__(self, bus: EventBus):
        bus.subscribe("user.registered", self.send_welcome_email)

    def send_welcome_email(self, username: str, email: str, **kwargs) -> None:
        print(f"[邮件服务] 发送欢迎邮件至 {email}: 欢迎 {username}!")


class LoggingService:
    """日志服务 —— 记录所有事件"""

    def __init__(self, bus: EventBus):
        bus.subscribe("user.registered", self.log_event)
        bus.subscribe("order.created", self.log_event)

    def log_event(self, **data: Any) -> None:
        print(f"[日志服务] 记录事件: {data}")


class AnalyticsService:
    """分析服务"""

    def __init__(self, bus: EventBus):
        bus.subscribe("user.registered", self.track_registration)

    def track_registration(self, username: str, **kwargs) -> None:
        print(f"[分析服务] 追踪注册: {username}")


# 使用示例
bus = EventBus()

# 创建组件（组件自动注册到总线）
user_svc = UserService(bus)
email_svc = EmailService(bus)
log_svc = LoggingService(bus)
analytics_svc = AnalyticsService(bus)

# 触发流程
print("\n--- 用户注册流程 ---")
user_svc.register("alice", "alice@example.com")
# 输出:
# 总线自动通知所有订阅者：邮件服务、日志服务、分析服务
```

**要点总结：**
- 中介者将多对多的交互简化为一对多（组件 ↔ 中介者）
- 事件总线是中介者模式的典型实现
- 中介者模式避免组件之间的直接耦合，便于扩展

---

## 12.17 备忘录（Memento）

备忘录模式在不破坏封装的前提下，捕获并外部化对象的内部状态，以便之后恢复。

```python
from dataclasses import dataclass, field
from typing import Any, Optional
from datetime import datetime
import copy


# ---- 备忘录 ----
@dataclass
class EditorMemento:
    """编辑器状态的快照"""
    content: str
    cursor_position: int
    selection: Optional[tuple[int, int]]
    timestamp: datetime = field(default_factory=datetime.now)


# ---- 原发器 ----
class TextEditor:
    """文本编辑器（原发器）"""

    def __init__(self):
        self.content = ""
        self.cursor_position = 0
        self.selection: Optional[tuple[int, int]] = None

    def write(self, text: str) -> None:
        """写入文本"""
        self.content += text
        self.cursor_position = len(self.content)
        print(f"写入: '{text}'")

    def delete(self, length: int) -> None:
        """删除"""
        if self.cursor_position > 0:
            deleted = self.content[-length:]
            self.content = self.content[:-length]
            self.cursor_position = len(self.content)
            print(f"删除: '{deleted}'")

    def set_cursor(self, pos: int) -> None:
        self.cursor_position = max(0, min(pos, len(self.content)))

    def select(self, start: int, end: int) -> None:
        self.selection = (start, end)

    def save(self) -> EditorMemento:
        """创建备忘录（保存当前状态）"""
        return EditorMemento(
            content=self.content,
            cursor_position=self.cursor_position,
            selection=self.selection,
        )

    def restore(self, memento: EditorMemento) -> None:
        """从备忘录恢复状态"""
        self.content = memento.content
        self.cursor_position = memento.cursor_position
        self.selection = memento.selection
        print(f"恢复至: '{self.content[:30]}...' (来自 {memento.timestamp:%H:%M:%S})")


# ---- 负责人 ----
class History:
    """历史记录（负责人）"""

    def __init__(self, max_history: int = 20):
        self._mementos: list[EditorMemento] = []
        self._current = -1
        self._max_history = max_history

    def push(self, memento: EditorMemento) -> None:
        """保存新状态"""
        # 丢弃当前之后的所有状态（如果有撤销后的操作）
        self._mementos = self._mementos[:self._current + 1]
        self._mementos.append(memento)
        self._current = len(self._mementos) - 1
        # 限制历史长度
        if len(self._mementos) > self._max_history:
            self._mementos.pop(0)
            self._current -= 1

    def undo(self) -> Optional[EditorMemento]:
        """撤销"""
        if self._current > 0:
            self._current -= 1
            return self._mementos[self._current]
        return None

    def redo(self) -> Optional[EditorMemento]:
        """重做"""
        if self._current < len(self._mementos) - 1:
            self._current += 1
            return self._mementos[self._current]
        return None


# 使用示例
editor = TextEditor()
history = History()

# 初始快照
history.push(editor.save())

editor.write("Hello, World!")
history.push(editor.save())

editor.write(" 这是第二行。")
history.push(editor.save())

editor.delete(6)  # 删除 "行。"
history.push(editor.save())

print("\n--- 撤销 ---")
memento = history.undo()
if memento:
    editor.restore(memento)

print("\n--- 撤销 ---")
memento = history.undo()
if memento:
    editor.restore(memento)

print("\n--- 重做 ---")
memento = history.redo()
if memento:
    editor.restore(memento)
```

**要点总结：**
- 备忘录存储原发器的内部状态快照，不暴露内部结构
- 负责人（Caretaker）管理备忘录的生命周期，但不修改其内容
- 适用于撤销/恢复、事务回滚、游戏存档等场景

---

## 12.18 观察者（Observer）

观察者模式定义对象之间的一对多依赖关系，当被观察者状态变化时，所有依赖者自动收到通知。

### 12.18.1 事件订阅

```python
from typing import Any, Callable
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum, auto


class EventType(Enum):
    """事件类型"""
    PRICE_CHANGE = auto()
    STOCK_LOW = auto()
    ORDER_PLACED = auto()
    SHIPMENT_UPDATE = auto()


@dataclass
class Event:
    """事件数据"""
    type: EventType
    data: dict[str, Any] = field(default_factory=dict)


class Subject:
    """被观察者（主题）"""

    def __init__(self):
        self._observers: dict[EventType, list[Callable]] = defaultdict(list)

    def attach(self, event_type: EventType, observer: Callable) -> None:
        """注册观察者"""
        self._observers[event_type].append(observer)

    def detach(self, event_type: EventType, observer: Callable) -> None:
        """移除观察者"""
        self._observers[event_type].remove(observer)

    def notify(self, event: Event) -> None:
        """通知所有观察者"""
        for observer in self._observers.get(event.type, []):
            observer(event)


# ---- 具体被观察者 ----
class Product(Subject):
    """商品 —— 可被观察"""

    def __init__(self, name: str, price: float, stock: int):
        super().__init__()
        self.name = name
        self._price = price
        self._stock = stock

    @property
    def price(self) -> float:
        return self._price

    @price.setter
    def price(self, new_price: float) -> None:
        old_price = self._price
        self._price = new_price
        self.notify(Event(EventType.PRICE_CHANGE, {
            "product": self.name,
            "old_price": old_price,
            "new_price": new_price,
        }))

    @property
    def stock(self) -> int:
        return self._stock

    @stock.setter
    def stock(self, new_stock: int) -> None:
        self._stock = new_stock
        if new_stock < 10:
            self.notify(Event(EventType.STOCK_LOW, {
                "product": self.name,
                "stock": new_stock,
            }))


# ---- 观察者 ----
class EmailNotifier:
    """邮件通知器"""

    def on_price_change(self, event: Event) -> None:
        data = event.data
        print(f"[邮件] {data['product']} 价格变动: "
              f"¥{data['old_price']} → ¥{data['new_price']}")

    def on_low_stock(self, event: Event) -> None:
        data = event.data
        print(f"[邮件] 库存预警: {data['product']} 仅剩 {data['stock']} 件！")


class Logger:
    """日志记录器"""

    @staticmethod
    def log_event(event: Event) -> None:
        print(f"[日志] 事件: {event.type.name}, 数据: {event.data}")


class AnalyticsTracker:
    """分析追踪器"""

    @staticmethod
    def track_price_change(event: Event) -> None:
        data = event.data
        print(f"[分析] 记录价格变更: {data['product']}")
        # 实际中发送到分析平台


# 使用示例
product = Product("Python 编程书", 79.0, 50)

email_notifier = EmailNotifier()
logger = Logger()
analytics = AnalyticsTracker()

# 订阅事件
product.attach(EventType.PRICE_CHANGE, email_notifier.on_price_change)
product.attach(EventType.PRICE_CHANGE, logger.log_event)
product.attach(EventType.PRICE_CHANGE, analytics.track_price_change)
product.attach(EventType.STOCK_LOW, email_notifier.on_low_stock)
product.attach(EventType.STOCK_LOW, logger.log_event)

print("--- 修改价格 ---")
product.price = 69.0

print("\n--- 修改库存（触发预警） ---")
product.stock = 5
```

### 12.18.2 asyncio 事件

```python
import asyncio
from typing import Any, Callable, Awaitable
from collections import defaultdict


class AsyncEventEmitter:
    """异步事件发射器"""

    def __init__(self):
        self._handlers: dict[str, list[Callable[..., Awaitable[Any]]]] = defaultdict(list)

    def on(self, event: str):
        """装饰器方式注册异步事件处理器"""
        def decorator(func):
            self._handlers[event].append(func)
            return func
        return decorator

    async def emit(self, event: str, **data: Any) -> list[Any]:
        """发射异步事件"""
        results = []
        for handler in self._handlers.get(event, []):
            result = await handler(**data)
            results.append(result)
        return results


# 使用示例
emitter = AsyncEventEmitter()


@emitter.on("user.login")
async def send_login_notification(username: str, ip: str, **kwargs):
    await asyncio.sleep(0.1)
    print(f"[通知] 用户 {username} 从 {ip 登录")
    return "notification_sent"


@emitter.on("user.login")
async def record_login_log(username: str, **kwargs):
    await asyncio.sleep(0.05)
    print(f"[日志] 登录记录: {username}")
    return "logged"


@emitter.on("user.logout")
async def cleanup_session(username: str, **kwargs):
    await asyncio.sleep(0.1)
    print(f"[清理] 清除 {username} 的会话")
    return "cleaned"


async def main():
    print("--- 用户登录 ---")
    results = await emitter.emit("user.login", username="alice", ip="192.168.1.1")
    print(f"结果: {results}")

    print("\n--- 用户登出 ---")
    results = await emitter.emit("user.logout", username="alice")
    print(f"结果: {results}")


# asyncio.run(main())
```

**要点总结：**
- 观察者模式实现事件驱动架构的核心机制
- Python 中可以用 `__call__`、普通方法或异步函数作为观察者
- `asyncio.Event` 可简单实现一对多的异步通知

---

## 12.19 状态（State）

状态模式允许对象在内部状态改变时改变其行为，看起来就像改变了类。

```python
from abc import ABC, abstractmethod
from typing import Any, Optional


# ---- 状态接口 ----
class OrderState(ABC):
    """订单状态接口"""

    @abstractmethod
    def pay(self, order: "Order") -> None: ...

    @abstractmethod
    def ship(self, order: "Order") -> None: ...

    @abstractmethod
    def deliver(self, order: "Order") -> None: ...

    @abstractmethod
    def cancel(self, order: "Order") -> None: ...

    @abstractmethod
    def refund(self, order: "Order") -> None: ...

    @abstractmethod
    def get_status(self) -> str: ...


# ---- 具体状态 ----
class PendingState(OrderState):
    """待支付"""

    def pay(self, order: "Order") -> None:
        print("支付成功")
        order.state = PaidState()

    def ship(self, order: "Order") -> None:
        print("⚠️ 未支付，无法发货")

    def deliver(self, order: "Order") -> None:
        print("⚠️ 未支付，无法交付")

    def cancel(self, order: "Order") -> None:
        print("订单已取消")
        order.state = CancelledState()

    def refund(self, order: "Order") -> None:
        print("⚠️ 未支付，无需退款")

    def get_status(self) -> str:
        return "待支付"


class PaidState(OrderState):
    """已支付"""

    def pay(self, order: "Order") -> None:
        print("⚠️ 已支付，请勿重复支付")

    def ship(self, order: "Order") -> None:
        print("已发货")
        order.state = ShippedState()

    def deliver(self, order: "Order") -> None:
        print("⚠️ 未发货，无法交付")

    def cancel(self, order: "Order") -> None:
        print("订单已取消，退款处理中")
        order.state = RefundingState()

    def refund(self, order: "Order") -> None:
        print("退款处理中")
        order.state = RefundingState()

    def get_status(self) -> str:
        return "已支付"


class ShippedState(OrderState):
    """已发货"""

    def pay(self, order: "Order") -> None:
        print("⚠️ 已支付")

    def ship(self, order: "Order") -> None:
        print("⚠️ 已发货")

    def deliver(self, order: "Order") -> None:
        print("已送达")
        order.state = DeliveredState()

    def cancel(self, order: "Order") -> None:
        print("⚠️ 已发货，无法取消，请联系客服")

    def refund(self, order: "Order") -> None:
        print("⚠️ 已发货，需要退货流程")

    def get_status(self) -> str:
        return "已发货"


class DeliveredState(OrderState):
    """已送达"""

    def pay(self, order: "Order") -> None:
        print("⚠️ 已支付")

    def ship(self, order: "Order") -> None:
        print("⚠️ 已完成")

    def deliver(self, order: "Order") -> None:
        print("⚠️ 已完成")

    def cancel(self, order: "Order") -> None:
        print("⚠️ 已完成，无法取消")

    def refund(self, order: "Order") -> None:
        print("退款处理中（售后）")
        order.state = RefundingState()

    def get_status(self) -> str:
        return "已送达"


class CancelledState(OrderState):
    """已取消"""

    def pay(self, order: "Order") -> None:
        print("⚠️ 订单已取消")

    def ship(self, order: "Order") -> None:
        print("⚠️ 订单已取消")

    def deliver(self, order: "Order") -> None:
        print("⚠️ 订单已取消")

    def cancel(self, order: "Order") -> None:
        print("⚠️ 已取消")

    def refund(self, order: "Order") -> None:
        print("⚠️ 已取消")

    def get_status(self) -> str:
        return "已取消"


class RefundingState(OrderState):
    """退款中"""

    def pay(self, order: "Order") -> None:
        print("⚠️ 退款中")

    def ship(self, order: "Order") -> None:
        print("⚠️ 退款中")

    def deliver(self, order: "Order") -> None:
        print("⚠️ 退款中")

    def cancel(self, order: "Order") -> None:
        print("⚠️ 退款中")

    def refund(self, order: "Order") -> None:
        print("退款已完成")
        order.state = RefundedState()

    def get_status(self) -> str:
        return "退款中"


class RefundedState(OrderState):
    """已退款"""

    def pay(self, order: "Order") -> None:
        print("⚠️ 已退款")

    def ship(self, order: "Order") -> None:
        print("⚠️ 已退款")

    def deliver(self, order: "Order") -> None:
        print("⚠️ 已退款")

    def cancel(self, order: "Order") -> None:
        print("⚠️ 已退款")

    def refund(self, order: "Order") -> None:
        print("⚠️ 已退款")

    def get_status(self) -> str:
        return "已退款"


# ---- 上下文 ----
class Order:
    """订单（上下文）"""

    def __init__(self, order_id: str):
        self.order_id = order_id
        self.state: OrderState = PendingState()
        print(f"订单 {order_id} 创建，状态: {self.state.get_status()}")

    def pay(self) -> None:
        print(f"\n[支付] 订单 {self.order_id}:")
        self.state.pay(self)
        print(f"  当前状态: {self.state.get_status()}")

    def ship(self) -> None:
        print(f"\n[发货] 订单 {self.order_id}:")
        self.state.ship(self)
        print(f"  当前状态: {self.state.get_status()}")

    def deliver(self) -> None:
        print(f"\n[交付] 订单 {self.order_id}:")
        self.state.deliver(self)
        print(f"  当前状态: {self.state.get_status()}")

    def cancel(self) -> None:
        print(f"\n[取消] 订单 {self.order_id}:")
        self.state.cancel(self)
        print(f"  当前状态: {self.state.get_status()}")

    def refund(self) -> None:
        print(f"\n[退款] 订单 {self.order_id}:")
        self.state.refund(self)
        print(f"  当前状态: {self.state.get_status()}")


# 使用示例
order = Order("ORD-001")
order.pay()
order.ship()
order.deliver()
order.refund()

print("\n--- 异常流程 ---")
order2 = Order("ORD-002")
order2.ship()  # 未支付不能发货
order2.pay()
order2.cancel()
```

**要点总结：**
- 状态模式将每个状态的行为封装在独立的类中
- 状态转换由状态类本身控制，消除大量的 if-elif 条件判断
- 适合工作流、订单状态机、游戏角色状态等场景

---

## 12.20 策略（Strategy）

策略模式定义一系列算法，将它们一一封装，并使它们可以相互替换。

### 12.20.1 函数策略

```python
from typing import Callable, Any
from decimal import Decimal


# ---- 策略类型 ----
# 函数是最简单的策略实现
DiscountStrategy = Callable[[Decimal], Decimal]


def no_discount(amount: Decimal) -> Decimal:
    """无折扣"""
    return amount


def percentage_discount(percent: float) -> DiscountStrategy:
    """百分比折扣工厂"""
    def strategy(amount: Decimal) -> Decimal:
        discount = amount * Decimal(str(percent / 100))
        return amount - discount
    strategy.__name__ = f"{percent}%_discount"
    return strategy


def fixed_discount(amount_to_deduct: Decimal) -> DiscountStrategy:
    """固定金额折扣工厂"""
    def strategy(amount: Decimal) -> Decimal:
        return max(Decimal("0"), amount - amount_to_deduct)
    strategy.__name__ = f"fixed_{amount_to_deduct}_off"
    return strategy


def threshold_discount(threshold: Decimal, percent: float) -> DiscountStrategy:
    """满减折扣"""
    def strategy(amount: Decimal) -> Decimal:
        if amount >= threshold:
            return percentage_discount(percent)(amount)
        return amount
    strategy.__name__ = f"满{threshold}打{percent}折"
    return strategy


# ---- 上下文 ----
class OrderCalculator:
    """订单计算器（上下文）"""

    def __init__(self, strategy: DiscountStrategy = no_discount):
        self._strategy = strategy

    @property
    def strategy(self) -> DiscountStrategy:
        return self._strategy

    @strategy.setter
    def strategy(self, strategy: DiscountStrategy) -> None:
        self._strategy = strategy
        print(f"切换策略: {strategy.__name__}")

    def calculate(self, items: list[dict]) -> dict:
        """计算订单"""
        subtotal = sum(Decimal(str(item["price"])) * item["quantity"] for item in items)
        total = self._strategy(subtotal)
        return {
            "items_count": len(items),
            "subtotal": float(subtotal),
            "discount": float(subtotal - total),
            "total": float(total),
        }


# 使用示例
cart = [
    {"name": "Python 书", "price": 79.0, "quantity": 2},
    {"name": "鼠标", "price": 29.9, "quantity": 1},
]

calc = OrderCalculator()
print("无折扣:", calc.calculate(cart))

calc.strategy = percentage_discount(10)
print("10% 折扣:", calc.calculate(cart))

calc.strategy = fixed_discount(Decimal("30"))
print("减 30:", calc.calculate(cart))

calc.strategy = threshold_discount(Decimal("150"), 15)
print("满 150 打 85 折:", calc.calculate(cart))
```

### 12.20.2 类策略

```python
from abc import ABC, abstractmethod
from typing import Any
import json
import pickle


# ---- 策略接口 ----
class Serializer(ABC):
    """序列化策略接口"""

    @abstractmethod
    def serialize(self, data: Any) -> str: ...

    @abstractmethod
    def deserialize(self, data: str) -> Any: ...

    @property
    @abstractmethod
    def content_type(self) -> str: ...


class JSONSerializer(Serializer):
    """JSON 序列化"""

    def serialize(self, data: Any) -> str:
        return json.dumps(data, ensure_ascii=False, indent=2)

    def deserialize(self, data: str) -> Any:
        return json.loads(data)

    @property
    def content_type(self) -> str:
        return "application/json"


class PickleSerializer(Serializer):
    """Pickle 序列化（Python 原生）"""

    def serialize(self, data: Any) -> str:
        import base64
        return base64.b64encode(pickle.dumps(data)).decode()

    def deserialize(self, data: str) -> Any:
        import base64
        return pickle.loads(base64.b64decode(data.encode()))

    @property
    def content_type(self) -> str:
        return "application/octet-stream"


class XMLSerializer(Serializer):
    """XML 序列化"""

    def serialize(self, data: Any) -> str:
        if isinstance(data, dict):
            items = "".join(f"  <{k}>{v}</{k}>" for k, v in data.items())
            return f"<root>\n{items}\n</root>"
        return f"<root>{data}</root>"

    def deserialize(self, data: str) -> Any:
        import re
        result = {}
        for match in re.finditer(r"<(\w+)>(.*?)</\1>", data):
            result[match.group(1)] = match.group(2)
        return result

    @property
    def content_type(self) -> str:
        return "application/xml"


# ---- 上下文 ----
class DataExporter:
    """数据导出器"""

    def __init__(self, serializer: Serializer = JSONSerializer()):
        self._serializer = serializer

    def set_serializer(self, serializer: Serializer) -> None:
        self._serializer = serializer

    def export(self, data: Any, filename: str) -> None:
        """导出数据"""
        serialized = self._serializer.serialize(data)
        with open(filename, "w") as f:
            f.write(serialized)
        print(f"已导出 {filename} ({self._serializer.content_type})")

    def import_data(self, filename: str) -> Any:
        """导入数据"""
        with open(filename) as f:
            return self._serializer.deserialize(f.read())


# 使用示例
data = {
    "name": "Python 设计模式",
    "author": "Alice",
    "year": 2024,
    "tags": ["python", "design patterns"],
}

exporter = DataExporter()

# 使用 JSON
exporter.set_serializer(JSONSerializer())
print(exporter._serializer.serialize(data))

# 使用 XML
exporter.set_serializer(XMLSerializer())
print(exporter._serializer.serialize(data))
```

**要点总结：**
- 策略模式用组合替代继承，在运行时切换行为
- Python 中函数本身就是策略的轻量实现
- 类策略适合复杂策略（含状态、多个方法）的场景

---

## 12.21 模板方法（Template Method）

模板方法模式定义一个操作中的算法骨架，将一些步骤延迟到子类中实现。

```python
from abc import ABC, abstractmethod
from typing import Any, Optional
from datetime import datetime


# ---- 抽象基类 —— 定义模板 ----
class DataPipeline(ABC):
    """数据处理管道 —— 模板方法模式"""

    def run(self, input_path: str) -> dict:
        """模板方法 —— 定义处理流程的骨架"""
        print(f"\n=== 开始处理: {input_path} ===")

        data = self.extract(input_path)
        print(f"[提取] 获取 {len(data)} 条数据")

        if not self.validate(data):
            return {"success": False, "error": "数据验证失败"}

        transformed = self.transform(data)
        print(f"[转换] 处理完成")

        self.enrich(transformed)  # 钩子方法

        output_path = self.get_output_path(input_path)
        self.load(transformed, output_path)
        print(f"[加载] 写入 {output_path}")

        self.cleanup()  # 钩子方法

        return {"success": True, "output": output_path, "records": len(data)}

    # ---- 抽象方法（必须实现） ----
    @abstractmethod
    def extract(self, path: str) -> list[dict]:
        """提取数据"""
        ...

    @abstractmethod
    def transform(self, data: list[dict]) -> list[dict]:
        """转换数据"""
        ...

    @abstractmethod
    def load(self, data: list[dict], path: str) -> None:
        """加载数据"""
        ...

    # ---- 具体方法（可选覆盖） ----
    def validate(self, data: list[dict]) -> bool:
        """数据验证（默认实现）"""
        return len(data) > 0

    # ---- 钩子方法（Hook）—— 可选覆盖 ----
    def enrich(self, data: list[dict]) -> None:
        """数据增强（空实现，子类可选覆盖）"""
        pass

    def cleanup(self) -> None:
        """清理资源（空实现，子类可选覆盖）"""
        pass

    def get_output_path(self, input_path: str) -> str:
        """生成输出路径"""
        name = input_path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        return f"/output/{name}_processed_{datetime.now().strftime('%Y%m%d')}.csv"


# ---- 具体子类 ----
class CSVToJSONPipeline(DataPipeline):
    """CSV 转 JSON 管道"""

    def extract(self, path: str) -> list[dict]:
        import csv
        with open(path, newline="") as f:
            return list(csv.DictReader(f))

    def transform(self, data: list[dict]) -> list[dict]:
        import json
        result = []
        for row in data:
            # 数据类型转换
            converted = {}
            for key, value in row.items():
                if value.isdigit():
                    converted[key] = int(value)
                else:
                    converted[key] = value
            result.append(converted)
        return result

    def load(self, data: list[dict], path: str) -> None:
        import json
        with open(path, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def enrich(self, data: list[dict]) -> None:
        """添加处理时间戳"""
        for record in data:
            record["processed_at"] = datetime.now().isoformat()


class APIDataPipeline(DataPipeline):
    """API 数据管道"""

    def extract(self, path: str) -> list[dict]:
        # 模拟从 API 获取数据
        return [
            {"id": 1, "name": "Alice", "email": "alice@example.com"},
            {"id": 2, "name": "Bob", "email": "bob@example.com"},
        ]

    def transform(self, data: list[dict]) -> list[dict]:
        # 脱敏处理
        for record in data:
            if "email" in record:
                local, domain = record["email"].split("@")
                record["email"] = f"{local[:2]}***@{domain}"
        return data

    def load(self, data: list[dict], path: str) -> None:
        import json
        with open(path, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def validate(self, data: list[dict]) -> bool:
        """增强验证"""
        if not data:
            return False
        required_fields = {"id", "name"}
        for record in data:
            if not required_fields.issubset(record.keys()):
                return False
        return True

    def cleanup(self) -> None:
        print("[清理] 关闭 API 连接")


# 使用示例
print("--- CSV Pipeline ---")
csv_pipeline = CSVToJSONPipeline()
result = csv_pipeline.run("/data/input.csv")
print(f"结果: {result}")

print("\n--- API Pipeline ---")
api_pipeline = APIDataPipeline()
result = api_pipeline.run("/data/api_export.json")
print(f"结果: {result}")
```

**要点总结：**
- 模板方法定义算法骨架，子类实现可变步骤
- 钩子（Hook）提供扩展点，子类可选覆盖
- 避免代码重复，将公共流程提取到基类

---

## 12.22 访问者（Visitor）

访问者模式将数据结构与数据操作分离，在不修改数据结构的前提下定义新操作。

```python
from abc import ABC, abstractmethod
from typing import Any


# ---- 元素接口 ----
class FileSystemElement(ABC):
    """文件系统元素"""

    @abstractmethod
    def accept(self, visitor: "Visitor") -> Any: ...


class File(FileSystemElement):
    """文件"""

    def __init__(self, name: str, size: int):
        self.name = name
        self.size = size

    def accept(self, visitor: "Visitor") -> Any:
        return visitor.visit_file(self)


class Directory(FileSystemElement):
    """目录"""

    def __init__(self, name: str):
        self.name = name
        self.children: list[FileSystemElement] = []

    def add(self, element: FileSystemElement) -> "Directory":
        self.children.append(element)
        return self

    def accept(self, visitor: "Visitor") -> Any:
        return visitor.visit_directory(self)


# ---- 访问者接口 ----
class Visitor(ABC):
    """访问者接口"""

    @abstractmethod
    def visit_file(self, file: File) -> Any: ...

    @abstractmethod
    def visit_directory(self, directory: Directory) -> Any: ...


# ---- 具体访问者：大小计算器 ----
class SizeCalculator(Visitor):
    """大小计算器"""

    def visit_file(self, file: File) -> int:
        return file.size

    def visit_directory(self, directory: Directory) -> int:
        total = 0
        for child in directory.children:
            total += child.accept(self)
        return total


# ---- 具体访问者：搜索 ----
class SearchVisitor(Visitor):
    """文件搜索器"""

    def __init__(self, keyword: str):
        self.keyword = keyword.lower()
        self.results: list[str] = []

    def visit_file(self, file: File) -> None:
        if self.keyword in file.name.lower():
            self.results.append(f"/{file.name}")

    def visit_directory(self, directory: Directory) -> None:
        for child in directory.children:
            child.accept(self)


# ---- 具体访问者：HTML 导出 ----
class HTMLExporter(Visitor):
    """HTML 格式导出器"""

    def visit_file(self, file: File) -> str:
        return f'<li class="file">📄 {file.name} ({file.size} bytes)</li>'

    def visit_directory(self, directory: Directory) -> str:
        children_html = "\n".join(
            child.accept(self) for child in directory.children
        )
        return (
            f'<li class="directory">📁 {directory.name}/\n'
            f'  <ul>\n{children_html}\n  </ul>\n'
            f"</li>"
        )


# 构建文件系统
root = Directory("root")
home = Directory("home")
alice = Directory("alice")
alice.add(File("readme.md", 1024)).add(File("photo.jpg", 204800))
home.add(alice).add(File("notes.txt", 512))
etc = Directory("etc")
etc.add(File("config.yaml", 2048)).add(File("hosts", 128))
root.add(home).add(etc).add(File("VERSION", 32))

# 访问者：计算总大小
size_calc = SizeCalculator()
total_size = root.accept(size_calc)
print(f"总大小: {total_size} bytes ({total_size/1024:.1f} KB)")

# 访问者：搜索
search = SearchVisitor("readme")
root.accept(search)
print(f"搜索结果: {search.results}")

# 访问者：导出 HTML
exporter = HTMLExporter()
html = root.accept(exporter)
print(f"\nHTML 导出:\n{html}")
```

**要点总结：**
- 访问者模式通过双分派（Double Dispatch）确定调用哪个方法
- 新增操作只需添加新的访问者，符合开闭原则
- 适合数据结构稳定但操作频繁变化的场景（编译器 AST、文件系统）

---

## 12.23 上下文管理器模式

上下文管理器是 Python 最常用的惯用模式之一，用于资源获取和释放。

### 12.23.1 类实现

```python
from typing import Optional, Any
import time


class Timer:
    """计时器上下文管理器"""

    def __init__(self, name: str = "timer"):
        self.name = name
        self.start: Optional[float] = None
        self.elapsed: float = 0.0

    def __enter__(self) -> "Timer":
        self.start = time.perf_counter()
        return self

    def __exit__(
        self,
        exc_type: Optional[type],
        exc_val: Optional[BaseException],
        exc_tb: Optional[Any],
    ) -> Optional[bool]:
        self.elapsed = time.perf_counter() - self.start
        print(f"[{self.name}] 耗时: {self.elapsed:.4f}s")
        # 返回 False 表示不抑制异常
        return False


class DatabaseConnection:
    """数据库连接上下文管理器"""

    def __init__(self, host: str, dbname: str):
        self.host = host
        self.dbname = dbname
        self._connected = False

    def __enter__(self) -> "DatabaseConnection":
        print(f"连接到 {self.host}/{self.dbname}")
        self._connected = True
        return self

    def __exit__(self, *args) -> None:
        print(f"断开连接 {self.host}/{self.dbname}")
        self._connected = False

    def query(self, sql: str) -> list:
        if not self._connected:
            raise RuntimeError("未连接")
        print(f"执行查询: {sql}")
        return [{"result": "data"}]


# 使用示例
print("--- Timer ---")
with Timer("数据处理") as t:
    time.sleep(0.5)
    print("处理数据中...")

print(f"计时结果: {t.elapsed:.4f}s")

print("\n--- 数据库连接 ---")
with DatabaseConnection("localhost", "test") as db:
    result = db.query("SELECT * FROM users")
    print(f"查询结果: {result}")
```

### 12.23.2 contextlib 工具

```python
from contextlib import (
    contextmanager,
    closing,
    suppress,
    redirect_stdout,
    redirect_stderr,
    ExitStack,
)
import io
import os
from typing import Generator, Any


# ---- @contextmanager 装饰器 ----
@contextmanager
def atomic_file_write(filepath: str, mode: str = "w") -> Generator[io.IOBase, Any, None]:
    """原子文件写入：写临时文件，成功后重命名"""
    temp_path = f"{filepath}.tmp"
    print(f"写入临时文件: {temp_path}")

    f = open(temp_path, mode)
    try:
        yield f
        f.close()
        # 成功后重命名（原子操作）
        os.replace(temp_path, filepath)
        print(f"写入完成: {filepath}")
    except Exception:
        # 失败则删除临时文件
        f.close()
        if os.path.exists(temp_path):
            os.remove(temp_path)
        print(f"写入失败，已清理临时文件")
        raise


@contextmanager
def change_directory(path: str) -> Generator[None, Any, None]:
    """临时切换工作目录"""
    original = os.getcwd()
    os.chdir(path)
    print(f"切换目录: {path}")
    try:
        yield
    finally:
        os.chdir(original)
        print(f"恢复目录: {original}")


# ---- 使用 contextlib 工具 ----
def read_config_with_suppress():
    """抑制特定异常"""
    with suppress(FileNotFoundError):
        with open("config.json") as f:
            return f.read()
    return "{}"  # 文件不存在时返回默认值


def capture_output():
    """捕获标准输出"""
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        print("这段输出被捕获")
        print("不会显示在控制台")
    return buffer.getvalue()


def managed_resources():
    """ExitStack 管理多个资源"""
    with ExitStack() as stack:
        # 动态注册资源
        f1 = stack.enter_context(open("/dev/null", "w"))
        f2 = stack.enter_context(open("/dev/null", "w"))
        buffer = stack.enter_context(io.StringIO())

        stack.callback(lambda: print("所有资源已清理"))
        # 退出时按注册逆序自动清理


# 使用示例
print("--- 原子写入 ---")
try:
    with atomic_file_write("/tmp/test.txt") as f:
        f.write("Hello, World!")
        # 如果这里抛出异常，临时文件会被清理
except Exception:
    pass

print("\n--- 捕获输出 ---")
captured = capture_output()
print(f"捕获的内容: {captured!r}")
```

**要点总结：**
- `__enter__`/`__exit__` 实现资源管理协议
- `@contextmanager` 装饰器将生成器转为上下文管理器
- `contextlib` 提供 `suppress`、`closing`、`ExitStack` 等实用工具

---

## 12.24 描述符模式

描述符是 Python 中控制属性访问的核心机制，`@property` 底层即通过描述符实现。

### 12.24.1 基础描述符

```python
from typing import Any, Optional


class PositiveNumber:
    """正数描述符 —— 自动校验值必须为正数"""

    def __set_name__(self, owner: type, name: str) -> None:
        """Python 3.6+ 自动获取属性名"""
        self._name = f"_{name}"

    def __get__(self, obj: Optional[object], objtype: Optional[type] = None) -> Any:
        if obj is None:
            return self  # 类访问时返回描述符本身
        return getattr(obj, self._name, 0)

    def __set__(self, obj: object, value: Any) -> None:
        if not isinstance(value, (int, float)):
            raise TypeError("值必须是数字")
        if value <= 0:
            raise ValueError("值必须为正数")
        setattr(obj, self._name, value)

    def __delete__(self, obj: object) -> None:
        raise AttributeError("不允许删除此属性")


class ValidatedString:
    """验证字符串描述符"""

    def __init__(self, min_length: int = 0, max_length: int = 255):
        self.min_length = min_length
        self.max_length = max_length

    def __set_name__(self, owner: type, name: str) -> None:
        self._name = f"_{name}"

    def __get__(self, obj: Optional[object], objtype: Optional[type] = None) -> Any:
        if obj is None:
            return self
        return getattr(obj, self._name, "")

    def __set__(self, obj: object, value: str) -> None:
        if not isinstance(value, str):
            raise TypeError("值必须是字符串")
        if len(value) < self.min_length:
            raise ValueError(f"字符串长度不能少于 {self.min_length}")
        if len(value) > self.max_length:
            raise ValueError(f"字符串长度不能超过 {self.max_length}")
        setattr(obj, self._name, value)


class Product:
    """商品 —— 使用描述符"""

    name = ValidatedString(min_length=1, max_length=100)
    price = PositiveNumber()
    stock = PositiveNumber()

    def __init__(self, name: str, price: float, stock: int):
        self.name = name
        self.price = price
        self.stock = stock

    def __repr__(self) -> str:
        return f"Product(name={self.name!r}, price={self.price}, stock={self.stock})"


# 使用示例
product = Product("Python 编程书", 79.0, 100)
print(product)
print(f"名称: {product.name}, 价格: {product.price}")

try:
    product.price = -10  # ValueError: 值必须为正数
except ValueError as e:
    print(f"校验失败: {e}")

try:
    product.name = ""  # ValueError: 字符串长度不能少于 1
except ValueError as e:
    print(f"校验失败: {e}")

# 类访问返回描述符
print(f"类级别访问: {Product.price}")
```

### 12.24.2 property 描述符

```python
from typing import Optional


class Temperature:
    """温度 —— 使用 @property 实现属性控制"""

    def __init__(self, celsius: float = 0):
        self._celsius = celsius

    @property
    def celsius(self) -> float:
        """获取摄氏温度"""
        return self._celsius

    @celsius.setter
    def celsius(self, value: float) -> None:
        """设置摄氏温度（校验范围）"""
        if value < -273.15:
            raise ValueError("温度不能低于绝对零度")
        self._celsius = value

    @celsius.deleter
    def celsius(self) -> None:
        """删除温度属性"""
        raise AttributeError("不允许删除温度")

    @property
    def fahrenheit(self) -> float:
        """华氏温度（只读计算属性）"""
        return self._celsius * 9 / 5 + 32

    @fahrenheit.setter
    def fahrenheit(self, value: float) -> None:
        """通过华氏度设置温度"""
        self.celsius = (value - 32) * 5 / 9


# ---- 自定义 property（理解实现原理） ----
class CustomProperty:
    """自定义 property 描述符实现"""

    def __init__(self, fget=None, fset=None, fdel=None, doc=None):
        self.fget = fget
        self.fset = fset
        self.fdel = fdel
        self.__doc__ = doc

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        if self.fget is None:
            raise AttributeError("不可读")
        return self.fget(obj)

    def __set__(self, obj, value):
        if self.fset is None:
            raise AttributeError("不可写")
        self.fset(obj, value)

    def __delete__(self, obj):
        if self.fdel is None:
            raise AttributeError("不可删除")
        self.fdel(obj)

    def setter(self, fset):
        return CustomProperty(self.fget, fset, self.fdel, self.__doc__)

    def deleter(self, fdel):
        return CustomProperty(self.fget, self.fset, fdel, self.__doc__)


# 使用示例
temp = Temperature(25)
print(f"摄氏: {temp.celsius}°C")
print(f"华氏: {temp.fahrenheit}°F")

temp.celsius = 30
print(f"更新后华氏: {temp.fahrenheit}°F")

temp.fahrenheit = 100
print(f"通过华氏设置: {temp.celsius}°C")
```

**要点总结：**
- 描述符协议：`__get__`、`__set__`、`__delete__`、`__set_name__`
- `@property` 是描述符的语法糖
- 描述符实现了 ORM 字段验证、类型转换等核心功能

---

## 12.25 装饰器模式进阶

### 12.25.1 带参数装饰器

```python
import functools
from typing import Any, Callable, Optional
import time
import logging

logger = logging.getLogger(__name__)


def retry(
    max_attempts: int = 3,
    delay: float = 0.5,
    backoff: float = 2.0,
    exceptions: tuple = (Exception,),
    on_retry: Optional[Callable] = None,
) -> Callable:
    """
    可配置重试装饰器

    Args:
        max_attempts: 最大重试次数
        delay: 初始延迟（秒）
        backoff: 延迟倍数
        exceptions: 需要重试的异常类型
        on_retry: 重试回调函数
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            current_delay = delay
            last_exception = None

            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt == max_attempts:
                        raise

                    if on_retry:
                        on_retry(func, attempt, e, current_delay)

                    logger.warning(
                        "%s 第 %d/%d 次失败: %s, %.1fs 后重试",
                        func.__name__, attempt, max_attempts, e, current_delay,
                    )
                    time.sleep(current_delay)
                    current_delay *= backoff

            raise last_exception  # type: ignore
        return wrapper
    return decorator


def log_retry(func, attempt, error, delay):
    """重试日志回调"""
    print(f"[重试] {func.__name__}: 第 {attempt} 次, 错误: {error}")


@retry(max_attempts=3, delay=0.1, backoff=2.0, on_retry=log_retry)
def unstable_api_call(url: str) -> dict:
    """不稳定的 API 调用"""
    import random
    if random.random() < 0.7:  # 70% 概率失败
        raise ConnectionError(f"连接 {url} 失败")
    return {"status": "ok", "url": url}


# 使用示例
print("--- 带参数装饰器 ---")
result = unstable_api_call("https://api.example.com/data")
print(f"结果: {result}")
```

### 12.25.2 类装饰器与装饰器类

```python
from typing import Any, Callable, Optional
import functools
import time


class RateLimiter:
    """装饰器类 —— 基于令牌桶的限流"""

    def __init__(self, calls: int = 10, period: float = 1.0):
        self.calls = calls
        self.period = period
        self._timestamps: list[float] = []

    def __call__(self, func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            now = time.monotonic()
            # 移除过期的记录
            self._timestamps = [t for t in self._timestamps if now - t < self.period]

            if len(self._timestamps) >= self.calls:
                wait = self.period - (now - self._timestamps[0])
                raise RuntimeError(
                    f"限流: 请在 {wait:.2f}s 后重试"
                )

            self._timestamps.append(now)
            return func(*args, **kwargs)
        return wrapper


class CachedResult:
    """装饰器类 —— 结果缓存"""

    def __init__(self, ttl: float = 60.0):
        self.ttl = ttl
        self._cache: dict[str, tuple[float, Any]] = {}

    def __call__(self, func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            # 生成缓存键
            key = f"{func.__name__}:{args}:{frozenset(kwargs.items())}"

            now = time.monotonic()
            if key in self._cache:
                timestamp, value = self._cache[key]
                if now - timestamp < self.ttl:
                    print(f"[缓存命中] {key[:40]}...")
                    return value

            result = func(*args, **kwargs)
            self._cache[key] = (now, result)
            return result
        return wrapper


# 使用示例
@RateLimiter(calls=3, period=2)
def fetch_data(url: str) -> str:
    """获取数据（限流）"""
    return f"Data from {url}"


@CachedResult(ttl=5)
def expensive_query(user_id: int) -> list:
    """耗时查询（缓存）"""
    print(f"执行查询: user_id={user_id}")
    time.sleep(1)
    return [{"id": user_id, "name": f"User_{user_id}"}]


print("--- 限流测试 ---")
for i in range(5):
    try:
        result = fetch_data(f"https://api.example.com/data/{i}")
        print(f"请求 {i}: ✅ {result}")
    except RuntimeError as e:
        print(f"请求 {i}: ❌ {e}")

print("\n--- 缓存测试 ---")
for i in range(4):
    user_id = 1 if i < 2 else 2
    result = expensive_query(user_id)
    print(f"查询 user={user_id}: {result[0]['name']}")
```

### 12.25.3 functools.wraps 的重要性

```python
from functools import wraps
from typing import Any, Callable


def bad_decorator(func: Callable) -> Callable:
    """不保留元信息的装饰器"""
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        print(f"调用 {func}")
        return func(*args, **kwargs)
    return wrapper


def good_decorator(func: Callable) -> Callable:
    """使用 @wraps 保留元信息"""
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        print(f"调用 {func.__name__}")
        return func(*args, **kwargs)
    return wrapper


@bad_decorator
def add(a: int, b: int) -> int:
    """两个数相加"""
    return a + b


@good_decorator
def multiply(a: int, b: int) -> int:
    """两个数相乘"""
    return a * b


print("--- 未使用 @wraps ---")
print(f"__name__: {add.__name__}")       # wrapper
print(f"__doc__: {add.__doc__}")         # None

print("\n--- 使用 @wraps ---")
print(f"__name__: {multiply.__name__}")  # multiply
print(f"__doc__: {multiply.__doc__}")    # 两个数相乘

# 如果不用 @wraps，调试工具（如 help()）、文档生成器、序列化框架都会受影响
```

**要点总结：**
- 带参数装饰器需要在最外层多包装一层函数
- 装饰器类通过 `__call__` 实现，适合需要维护状态的场景
- `functools.wraps` 必须是任何装饰器实现的标准配置
- 装饰器本质是语法糖：`@decorator` 等价于 `func = decorator(func)`
