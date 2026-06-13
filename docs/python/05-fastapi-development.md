# FastAPI 现代开发

## 1. 依赖注入系统

FastAPI 的依赖注入系统是其最强大的特性之一，它通过 `Depends` 机制实现声明式的依赖解析，无需手动实例化任何对象。

### 1.1 Depends 基础

依赖本质上是一个可调用对象（函数、类、方法），FastAPI 自动解析其参数并注入结果：

```python
from fastapi import Depends, FastAPI, Query

app = FastAPI()

# 一个普通的依赖函数
def pagination_deps(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    return {"page": page, "size": size, "offset": (page - 1) * size}

@app.get("/items")
def list_items(pagination: dict = Depends(pagination_deps)):
    # pagination 已经是 pagination_deps 的返回值
    return {"items": [], **pagination}
```

`Depends` 接收一个可调用对象，FastAPI 会在请求生命周期内自动调用它，并将返回值注入到路径函数参数中。依赖本身也可以声明自己的依赖，形成依赖链。

### 1.2 依赖链

依赖可以嵌套依赖，形成清晰的层级结构：

```python
from fastapi import Depends, FastAPI, HTTPException, status
from typing import Optional

app = FastAPI()

# 模拟数据库
fake_db = {"admin": {"role": "admin", "name": "Admin"}, "user1": {"role": "user", "name": "User One"}}

def get_token_header(authorization: str = ...) -> str:
    """从请求头提取 token —— 第一层依赖"""
    # 实际项目中从 Header 中提取
    return authorization

def get_current_user(token: str = Depends(get_token_header)) -> dict:
    """根据 token 获取当前用户 —— 第二层依赖"""
    user = fake_db.get(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user

def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """检查管理员权限 —— 第三层依赖"""
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
    return user

@app.get("/admin/dashboard")
def admin_dashboard(admin: dict = Depends(require_admin)):
    return {"message": f"Welcome {admin['name']}"}
```

依赖链的解析是**缓存**的——在同一个请求中，同一个依赖只会被调用一次，即使它在多个路径中被引用。

### 1.3 类依赖

用类做依赖可以携带状态和方法，可读性更好：

```python
from fastapi import Depends, FastAPI, Query
from dataclasses import dataclass
from typing import Optional

app = FastAPI()

class Pagination:
    """可复用的分页依赖，类本身就是可调用对象"""
    def __init__(
        self,
        page: int = Query(1, ge=1),
        size: int = Query(20, ge=1, le=100),
        sort: Optional[str] = Query(None),
    ):
        self.page = page
        self.size = size
        self.offset = (page - 1) * size
        self.sort = sort

@app.get("/users")
def list_users(pag: Pagination = Depends(Pagination)):
    return {"users": [], "page": pag.page, "size": pag.size}

@app.get("/posts")
def list_posts(pag: Pagination = Depends(Pagination)):
    return {"posts": [], "offset": pag.offset}
```

### 1.4 全局依赖

有些依赖需要在所有路由中生效（如日志、鉴权），可以注册到应用级别：

```python
from fastapi import Depends, FastAPI, Request
from time import time

app = FastAPI()

async def log_request_time(request: Request):
    request.state.start_time = time()

async def verify_api_key(request: Request):
    api_key = request.headers.get("X-API-Key")
    if api_key != "secret-key":
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Invalid API Key")

# 全局依赖 —— 所有路由都会执行
app.dependency_overrides = {}

# 也可以这样注册
app = FastAPI(dependencies=[Depends(log_request_time)])

@app.get("/items")
def get_items():
    return {"status": "ok"}
```

### 1.5 依赖覆盖（测试用）

依赖覆盖是 FastAPI 测试的核心利器——你可以替换任意依赖的实现，无需修改生产代码：

```python
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

app = FastAPI()

async def get_db_session():
    """生产环境连接真实数据库"""
    db = await create_real_db_connection()
    try:
        yield db
    finally:
        await db.close()

async def get_current_user():
    """生产环境从 JWT 解析用户"""
    return {"id": 1, "name": "real_user"}

@app.get("/profile")
def get_profile(
    user: dict = Depends(get_current_user),
    db=Depends(get_db_session),
):
    return {"user": user}

# ----- 测试代码 -----

async def mock_get_current_user():
    return {"id": 999, "name": "test_user"}

async def mock_get_db_session():
    yield {"fake": "db_connection"}  # 模拟数据库

def test_get_profile():
    # 覆盖依赖：将生产依赖替换为测试替身
    app.dependency_overrides[get_current_user] = mock_get_current_user
    app.dependency_overrides[get_db_session] = mock_get_db_session

    client = TestClient(app)
    response = client.get("/profile")
    assert response.status_code == 200
    assert response.json()["user"]["name"] == "test_user"

    # 测试完成后清理
    app.dependency_overrides.clear()
```

这种模式让单元测试变得极其简单——不需要 mock 整个框架，只需要替换一个函数。

---

## 2. Pydantic 数据验证

FastAPI 的请求体验证完全基于 Pydantic v2。掌握 Pydantic 的高级用法是写出健壮 API 的关键。

### 2.1 BaseModel 高级用法

```python
from pydantic import BaseModel, Field, EmailStr
from typing import Optional
from datetime import datetime
from uuid import UUID, uuid4

class UserBase(BaseModel):
    """用户基础模型"""
    id: UUID = Field(default_factory=uuid4)
    username: str = Field(..., min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9_]+$")
    email: EmailStr
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # 禁用额外字段
    class Config:
        extra = "forbid"  # 拒绝未定义的字段

class UserCreate(UserBase):
    """创建用户请求体"""
    password: str = Field(..., min_length=8, repr=False)  # repr=False 防止密码被序列化输出

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain an uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain a digit")
        return v
```

**`Field` 关键参数**：
- `default` / `default_factory`：默认值 / 动态默认值工厂
- `alias`：字段别名（用于接收不符合 Python 命名规范的字段名）
- `min_length` / `max_length` / `pattern`：字符串约束
- `ge` / `le` / `gt` / `lt`：数值约束
- `repr`：控制是否在 `repr()` 中显示（适合密码等敏感字段）
- `description`：生成 OpenAPI 文档描述

### 2.2 嵌套模型与复杂结构

```python
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date

class Address(BaseModel):
    street: str
    city: str
    country: str
    postal_code: str = Field(..., pattern=r"^\d{5}(-\d{4})?$")

class Skill(BaseModel):
    name: str
    level: int = Field(ge=1, le=5)

class Employee(BaseModel):
    name: str
    department: str
    address: Address          # 嵌套模型
    skills: List[Skill]       # 模型列表
    tags: List[str] = []      # 简单列表
    metadata: Optional[dict] = None  # 自由字典

# 使用示例
data = {
    "name": "张三",
    "department": "Engineering",
    "address": {
        "street": "123 Main St",
        "city": "Beijing",
        "country": "China",
        "postal_code": "100000",
    },
    "skills": [
        {"name": "Python", "level": 5},
        {"name": "FastAPI", "level": 4},
    ],
    "tags": ["backend", "api"],
}

emp = Employee(**data)
print(emp.model_dump())          # 序列化为字典
print(emp.model_dump_json())     # 序列化为 JSON（默认排除 None）
print(emp.model_dump(mode="json"))  # 确保类型兼容 JSON（datetime 转字符串）
```

### 2.3 自定义验证器

Pydantic v2 提供了两种验证器：`field_validator` 和 `model_validator`。

```python
from pydantic import BaseModel, field_validator, model_validator
from typing import Any
from datetime import date

class Booking(BaseModel):
    check_in: date
    check_out: date
    guest_count: int = Field(ge=1, le=10)
    promo_code: str = ""

    # 字段级验证器：验证单个字段
    @field_validator("check_out")
    @classmethod
    def check_out_after_check_in(cls, v: date, info: Any) -> date:
        """通过 info.data 可以访问其他字段的 原始值（验证前）"""
        if "check_in" in info.data and v <= info.data["check_in"]:
            raise ValueError("check_out must be after check_in")
        return v

    # 模型级验证器：验证多个字段的交叉约束
    @model_validator(mode="after")
    def validate_booking(self) -> "Booking":
        """mode='after' 表示在字段验证完成后执行"""
        if self.guest_count > 4 and not self.promo_code:
            raise ValueError("Promo code required for groups larger than 4")
        return self

    # model_validator 的 mode='before' 可以预处理原始数据
    @model_validator(mode="before")
    @classmethod
    def normalize_data(cls, data: Any) -> Any:
        """在字段验证之前对原始数据做转换"""
        if isinstance(data, dict):
            # 自动将 'checkin' / 'checkout' 统一为标准字段名
            data["check_in"] = data.pop("checkin", data.get("check_in"))
            data["check_out"] = data.pop("checkout", data.get("check_out"))
        return data
```

**验证器选择指南**：
| 验证器 | 用途 | 模式 |
|--------|------|------|
| `field_validator` | 单个字段格式/业务校验 | `before` / `after` |
| `model_validator` | 多字段交叉校验、数据预处理 | `before` / `after` |

### 2.4 序列化配置

```python
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime
from uuid import UUID, uuid4

class Product(BaseModel):
    model_config = ConfigDict(
        # 序列化时使用 alias（默认是验证时使用）
        populate_by_name=True,

        # 拒绝未定义的输入字段
        extra="forbid",

        # 枚举输出值而非名称
        use_enum_values=True,

        # JSON 序列化时自动转换 datetime
        json_encoders={
            datetime: lambda v: v.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    id: UUID = Field(default_factory=uuid4, alias="product_id")
    name: str
    price: float = Field(gt=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    internal_notes: str = Field("", exclude=True)  # exclude=True 阻止序列化

p = Product(name="Laptop", price=999.99)
print(p.model_dump(by_alias=True))
# {'product_id': UUID(...), 'name': 'Laptop', 'price': 999.99, 'created_at': datetime(...)}

print(p.model_dump(exclude={"created_at"}))
# 排除特定字段

print(p.model_dump_json(exclude_none=True))
# JSON 输出，排除 None 值字段
```

---

## 3. 后台任务与事件

### 3.1 BackgroundTasks

对于不需要等待结果的操作（发送邮件、推送通知、日志记录），使用 `BackgroundTasks`：

```python
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel, EmailStr
import time

app = FastAPI()

# 模拟发送邮件
def send_welcome_email(email: str, username: str):
    time.sleep(3)  # 模拟耗时
    print(f"[EMAIL] Welcome email sent to {email} for user {username}")

def send_slack_notification(channel: str, message: str):
    time.sleep(1)
    print(f"[SLACK] #{channel}: {message}")

class UserSignup(BaseModel):
    username: str
    email: EmailStr

@app.post("/signup")
def signup(user: UserSignup, tasks: BackgroundTasks):
    # 注册用户（同步完成）
    # ... 写入数据库 ...

    # 注册后台任务（响应返回后执行）
    tasks.add_task(send_welcome_email, user.email, user.username)
    tasks.add_task(send_slack_notification, "new-users", f"New user: {user.username}")

    return {"status": "ok", "message": "User created. Welcome email will be sent shortly."}
```

**注意事项**：
- `BackgroundTasks` 不支持 `asyncio` 中的 `await`——如果需要异步后台任务，使用 `asyncio.create_task` 或 Celery/ARQ
- 后台任务与请求共享同一个数据库 session 时需谨慎，通常应建立独立连接
- `BackgroundTasks` 运行在同一个进程内，适合轻量级操作；重量级任务应使用消息队列

### 3.2 Lifespan 事件（推荐方式）

从 FastAPI 0.93+ 开始，推荐使用 `lifespan` 替代 `startup`/`shutdown` 装饰器：

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from typing import AsyncGenerator

# 模拟：初始化数据库连接池、加载模型等
fake_models = {}

@asynccontextmanager
async def app_lifespan(app: FastAPI) -> AsyncGenerator:
    # ----- startup -----
    print("[LIFESPAN] Starting up...")
    fake_models["ml_model"] = {"name": "sentiment-bert", "version": "2.1.0"}
    fake_models["db_pool"] = {"min_conn": 5, "max_conn": 20}
    print(f"[LIFESPAN] Models loaded: {list(fake_models.keys())}")

    yield  # 应用开始处理请求

    # ----- shutdown -----
    print("[LIFESPAN] Shutting down...")
    fake_models.clear()
    print("[LIFESPAN] Resources released")

app = FastAPI(lifespan=app_lifespan)
```

### 3.3 startup/shutdown（兼容方式）

```python
from fastapi import FastAPI

app = FastAPI()

@app.on_event("startup")
async def startup():
    print("Connecting to database...")
    # 初始化连接池
    # 加载缓存
    # 注册健康检查

@app.on_event("shutdown")
async def shutdown():
    print("Closing connections...")
    # 关闭连接池
    # 持久化缓存
    # 通知注册中心下线
```

**区别**：`lifespan` 是 ASGI 标准范式，在 Starlette/FastAPI 中更受推荐；`on_event` 是旧接口，未来可能废弃。

---

## 4. WebSocket 实时通信

FastAPI 原生支持 WebSocket，适合构建聊天、实时通知、协作编辑等场景。

### 4.1 基础 WebSocket 路由

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json

app = FastAPI()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            # 处理消息
            response = {"status": "received", "content": message.get("text", "")}
            await websocket.send_json(response)
    except WebSocketDisconnect:
        print("Client disconnected")
```

### 4.2 连接管理与广播模式

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import Set, Dict
from pydantic import BaseModel
import json
import asyncio

app = FastAPI()

class ConnectionManager:
    """WebSocket 连接管理器"""

    def __init__(self):
        # active_connections: 所有活跃连接
        self.active_connections: Set[WebSocket] = set()
        # room_connections: 按房间分组
        self.room_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room: str = "global"):
        await websocket.accept()
        self.active_connections.add(websocket)
        if room not in self.room_connections:
            self.room_connections[room] = set()
        self.room_connections[room].add(websocket)

    def disconnect(self, websocket: WebSocket, room: str = "global"):
        self.active_connections.discard(websocket)
        if room in self.room_connections:
            self.room_connections[room].discard(websocket)

    async def broadcast(self, message: dict):
        """广播给所有连接"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.active_connections.discard(conn)

    async def broadcast_to_room(self, room: str, message: dict):
        """广播给房间内所有连接"""
        if room not in self.room_connections:
            return
        disconnected = []
        for connection in self.room_connections[room]:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.room_connections[room].discard(conn)

manager = ConnectionManager()

@app.websocket("/ws/chat/{room}")
async def chat_websocket(websocket: WebSocket, room: str):
    await manager.connect(websocket, room)
    try:
        # 通知房间其他用户
        await manager.broadcast_to_room(room, {
            "type": "system",
            "message": "A user joined the room",
        })

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            # 处理不同类型的消息
            msg_type = message.get("type", "chat")

            if msg_type == "chat":
                await manager.broadcast_to_room(room, {
                    "type": "chat",
                    "sender": message["sender"],
                    "text": message["text"],
                    "timestamp": asyncio.get_event_loop().time(),
                })
            elif msg_type == "typing":
                await manager.broadcast_to_room(room, {
                    "type": "typing",
                    "sender": message["sender"],
                    "is_typing": message.get("is_typing", True),
                })
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
        await manager.broadcast_to_room(room, {
            "type": "system",
            "message": "A user left the room",
        })
```

### 4.3 WebSocket 认证

WebSocket 的握手阶段支持 HTTP Header，可以利用这点做认证：

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

app = FastAPI()
SECRET_KEY = "your-secret-key"

async def verify_ws_token(websocket: WebSocket) -> dict:
    """验证 WebSocket 连接中的 token"""
    token = websocket.headers.get("authorization", "").replace("Bearer ", "")

    # 也可以从查询参数中获取
    token = token or websocket.query_params.get("token", "")

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload
    except jwt.PyJWTError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return None

@app.websocket("/ws/protected")
async def protected_websocket(websocket: WebSocket):
    user = await verify_ws_token(websocket)
    if not user:
        return

    await websocket.accept()
    try:
        await websocket.send_json({
            "type": "system",
            "message": f"Welcome {user.get('sub', 'unknown')}",
        })
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"echo": data})
    except WebSocketDisconnect:
        print(f"User {user.get('sub')} disconnected")
```

---

## 5. 中间件与认证

### 5.1 自定义中间件

中间件是处理请求/响应管道的钩子，在每个请求之前和之后执行：

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import time
import uuid

app = FastAPI()

class ProcessTimeMiddleware(BaseHTTPMiddleware):
    """记录每个请求的处理时间"""

    async def dispatch(self, request: Request, call_next):
        start_time = time.time()

        # 为每个请求分配请求 ID
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id

        # 调用下一个中间件或路由处理函数
        response = await call_next(request)

        # 响应返回后添加自定义 Header
        process_time = time.time() - start_time
        response.headers["X-Process-Time"] = str(round(process_time, 4))
        response.headers["X-Request-ID"] = request_id

        return response

class ErrorLoggingMiddleware(BaseHTTPMiddleware):
    """捕获未处理异常并返回统一错误格式"""

    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
            return response
        except Exception as exc:
            # 记录错误日志
            print(f"[ERROR] {request.method} {request.url.path}: {exc}")
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal server error",
                    "request_id": getattr(request.state, "request_id", "unknown"),
                },
            )

# 注册中间件（顺序重要：先添加的先执行）
app.add_middleware(ErrorLoggingMiddleware)
app.add_middleware(ProcessTimeMiddleware)
```

### 5.2 CORS 中间件

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[  # 允许的源
        "http://localhost:3000",
        "https://yourdomain.com",
    ],
    allow_origin_regex=r"https://.*\.yourdomain\.com",
    allow_credentials=True,     # 允许携带 Cookie
    allow_methods=["*"],        # 允许的 HTTP 方法
    allow_headers=["*"],        # 允许的请求头
    expose_headers=["X-Request-ID"],  # 暴露给前端的响应头
    max_age=3600,               # 预检请求缓存时间（秒）
)
```

### 5.3 OAuth2 / JWT 认证

完整的 JWT 认证流程包含：登录颁发 token → 请求携带 token → 中间件验证：

```python
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import jwt

# ------ 配置 ------
SECRET_KEY = "your-256-bit-secret"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# ------ 模型 ------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    username: Optional[str] = None
    scopes: List[str] = []

class User(BaseModel):
    username: str
    email: str = ""
    disabled: bool = False

class UserInDB(User):
    hashed_password: str

# ------ 模拟数据库 ------
fake_users_db = {
    "alice": {
        "username": "alice",
        "email": "alice@example.com",
        "hashed_password": "$2b$12$...",  # 实际应使用 bcrypt
        "disabled": False,
    }
}

# ------ 认证工具函数 ------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """实际应使用 bcrypt.checkpw"""
    return plain_password == "password"  # 仅为演示

def get_user(db, username: str) -> Optional[UserInDB]:
    if username in db:
        user_dict = db[username]
        return UserInDB(**user_dict)
    return None

async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    """从 JWT token 解析当前用户"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except jwt.PyJWTError:
        raise credentials_exception

    user = get_user(fake_users_db, username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

# ------ 路由 ------
app = FastAPI()

@app.post("/auth/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = get_user(fake_users_db, form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    access_token = create_access_token(
        data={"sub": user.username, "scopes": ["read", "write"]},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return Token(access_token=access_token)

@app.get("/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    return current_user
```

### 5.4 权限控制

通过依赖组合实现细粒度权限控制：

```python
from fastapi import Depends, FastAPI, HTTPException, status
from typing import List, Set

app = FastAPI()

# ------ 角色与权限 ------
class Permission:
    """权限定义"""
    READ = "items:read"
    WRITE = "items:write"
    DELETE = "items:delete"
    ADMIN = "admin"

# 角色-权限映射
ROLE_PERMISSIONS = {
    "viewer": {Permission.READ},
    "editor": {Permission.READ, Permission.WRITE},
    "admin": {Permission.READ, Permission.WRITE, Permission.DELETE, Permission.ADMIN},
}

def require_permissions(*required: str):
    """返回一个依赖，检查当前用户是否拥有所有指定权限"""
    async def permission_checker(
        current_user: dict = Depends(get_current_active_user),
    ) -> dict:
        user_role = current_user.get("role", "viewer")
        user_permissions = ROLE_PERMISSIONS.get(user_role, set())

        missing = [p for p in required if p not in user_permissions]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(missing)}",
            )
        return current_user
    return permission_checker

# ------ 受保护路由 ------
@app.delete("/items/{item_id}")
async def delete_item(
    item_id: int,
    user: dict = Depends(require_permissions(Permission.DELETE)),
):
    return {"message": f"Item {item_id} deleted by {user['username']}"}

@app.get("/admin/users")
async def list_users(
    user: dict = Depends(require_permissions(Permission.ADMIN)),
):
    return {"users": []}
```

---

## 6. 生产实践

### 6.1 项目结构

推荐的生产项目结构：

```
project/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI 应用入口
│   ├── config.py            # 配置管理
│   ├── api/
│   │   ├── __init__.py
│   │   ├── v1/              # API v1 路由
│   │   │   ├── __init__.py
│   │   │   ├── users.py
│   │   │   ├── items.py
│   │   │   └── auth.py
│   │   └── v2/              # API v2 路由
│   │       └── ...
│   ├── models/              # SQLAlchemy / Beanie ORM 模型
│   │   ├── __init__.py
│   │   └── user.py
│   ├── schemas/             # Pydantic 请求/响应模型
│   │   ├── __init__.py
│   │   ├── user.py
│   │   └── item.py
│   ├── services/            # 业务逻辑层
│   │   ├── __init__.py
│   │   └── user_service.py
│   ├── dependencies/        # 自定义依赖
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   └── database.py
│   ├── middleware/          # 中间件
│   │   ├── __init__.py
│   │   └── logging.py
│   └── utils/               # 工具函数
│       ├── __init__.py
│       └── security.py
├── tests/                   # 测试
│   ├── conftest.py
│   ├── test_users.py
│   └── test_auth.py
├── alembic/                 # 数据库迁移
│   └── versions/
├── alembic.ini
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

### 6.2 配置管理

使用 Pydantic 的 `BaseSettings` 管理配置，支持环境变量和 `.env` 文件：

```python
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # 应用配置
    app_name: str = "FastAPI App"
    debug: bool = False
    api_prefix: str = "/api/v1"

    # 数据库
    database_url: str
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # Redis
    redis_url: Optional[str] = None

    # JWT
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # CORS
    allowed_origins: list[str] = ["http://localhost:3000"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

# 全局单例
settings = Settings()
```

在应用中使用：

```python
from app.config import settings

app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    docs_url=f"{settings.api_prefix}/docs" if settings.debug else None,
)
```

### 6.3 数据库集成

以 SQLAlchemy 2.0 async 为例：

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.config import settings

# 创建异步引擎
engine = create_async_engine(
    settings.database_url,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    echo=settings.debug,
)

# 会话工厂
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# 依赖：获取数据库会话
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```

### 6.4 错误处理

统一错误处理，避免异常信息泄露：

```python
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.exception_handlers import http_exception_handler
from pydantic import ValidationError

app = FastAPI()

class AppException(Exception):
    """自定义业务异常"""
    def __init__(self, message: str, code: str = "INTERNAL_ERROR", status_code: int = 400):
        self.message = message
        self.code = code
        self.status_code = status_code

@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )

@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    """Pydantic 验证错误格式化"""
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": exc.errors(),
            }
        },
    )

@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    """保留原始 HTTPException 的行为，但统一格式"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": "HTTP_ERROR",
                "message": exc.detail,
            }
        },
        headers=getattr(exc, "headers", None),
    )
```

### 6.5 API 版本管理

推荐通过路由前缀管理版本，避免 URL 参数或 Header 方式：

```python
from fastapi import FastAPI, APIRouter

# ---------- v1 路由 ----------
router_v1 = APIRouter(prefix="/api/v1")

@router_v1.get("/users")
def list_users_v1():
    return [{"id": 1, "name": "User (v1)", "legacy_field": "old"}]

@router_v1.post("/users")
def create_user_v1():
    return {"message": "User created (v1)"}

# ---------- v2 路由 ----------
router_v2 = APIRouter(prefix="/api/v2")

@router_v2.get("/users")
def list_users_v2():
    return [{"id": 1, "name": "User (v2)", "email": "user@example.com", "profile": {}}]

@router_v2.post("/users")
def create_user_v2():
    return {"message": "User created (v2)", "user_id": 1}

# ---------- 注册 ----------
app = FastAPI()
app.include_router(router_v1)
app.include_router(router_v2)

# 可选：健康检查路由无版本
@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "2.0.0"}
```

**版本管理策略要点**：
- **URL 路径版本**（`/api/v1/`）最直观，适合大多数场景
- 旧版本维护：只修 bug 不加功能，用 `deprecated=True` 标记
- 版本过渡：新旧版本共存，通过文档告知用户弃用时间线
- 不推荐 Header 版本的方案——难以调试、不好缓存、OpenAPI 支持差

---

## 总结

FastAPI 的现代开发远不止"写几个路由"。掌握依赖注入的灵活用法、Pydantic 的验证能力、WebSocket 的实时通信模式，以及合理的项目架构，才能构建出健壮、可维护、高性能的生产级 API 服务。

核心思想：**用声明式取代命令式**——通过依赖注入、验证器声明、中间件链等机制，让框架替你处理横切关注点，业务代码保持干净和聚焦。
