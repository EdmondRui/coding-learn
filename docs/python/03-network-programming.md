# Python 网络编程

## 1. Socket 编程进阶

### 1.1 TCP Socket 深入

`socket.setsockopt` 提供细粒度 TCP 控制：

```python
import socket, struct
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)     # 快速重启
sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)     # 禁用 Nagle
sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)     # 保活检测
if hasattr(socket, 'TCP_KEEPIDLE'):
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, 60)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 10)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 5)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
sock.bind(('0.0.0.0', 8888))
sock.listen(128)
```

`SO_REUSEADDR` 跳过 `TIME_WAIT` 让服务快速重启。`TCP_NODELAY` 对小包场景（游戏、交易系统）至关重要——Nagle 会延迟小包等 ACK。`SO_KEEPALIVE` 清理死连接，但默认间隔 2h，需 `TCP_KEEPIDLE` 调短。`SO_LINGER` 让 `close()` 发 RST 而非 FIN，适用于快速回收端口。

### 1.2 UDP Socket

```python
udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
udp.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 2_097_152)
udp.bind(('0.0.0.0', 5353))
data, addr = udp.recvfrom(65535)
udp.sendto(b'pong', addr)
```

UDP 无连接、无重传，`recvfrom`/`sendto` 每次携带地址。适用于 DNS、日志收集、流媒体等容忍丢包的场景。

### 1.3 非阻塞 Socket 与 selectors

```python
import selectors, socket
sel = selectors.DefaultSelector()  # Linux → epoll, macOS → kqueue
server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.setblocking(False)
server.bind(('0.0.0.0', 8888))
server.listen(128)

def accept(sock, mask):
    conn, addr = sock.accept()
    conn.setblocking(False)
    sel.register(conn, selectors.EVENT_READ, read)

def read(conn, mask):
    data = conn.recv(4096)
    if data:
        conn.sendall(data)
    else:
        sel.unregister(conn); conn.close()

sel.register(server, selectors.EVENT_READ, accept)
while True:
    for key, mask in sel.select():
        key.data(key.fileobj, mask)
```

**I/O 模型对比**：`select` 有 1024 fd 上限、线性遍历；`poll` 无上限但仍线性；`epoll`（Linux）和 `kqueue`（macOS）仅返回就绪 fd，O(1)。**边缘触发 ET**（`select.EPOLLET`）仅状态变化时通知，需循环读至 `EAGAIN`，高吞吐场景适用；**水平触发 LT** 反复通知，编程更简单。

---

## 2. 自定义协议设计

### 2.1 消息帧定界

TCP 是流协议，应用层必须自行划分边界。

**长度前缀法**（推荐二进制协议）：

```python
import struct
def encode_len(data: bytes) -> bytes:
    return struct.pack('!I', len(data)) + data

def decode_len(buf: bytearray) -> tuple[bytes | None, int]:
    if len(buf) < 4: return None, 0
    n = struct.unpack('!I', buf[:4])[0]
    if len(buf) < 4 + n: return None, 0
    msg = bytes(buf[4:4 + n])
    del buf[:4 + n]
    return msg, 4 + n
```

**分隔符法**（适用于文本协议）：

```python
def decode_delim(buf: bytearray, delim=b'\r\n') -> tuple[bytes | None, int]:
    idx = buf.find(delim)
    if idx == -1: return None, 0
    msg = bytes(buf[:idx])
    del buf[:idx + len(delim)]
    return msg, idx + len(delim)
```

### 2.2 序列化方案

| 方案 | 速度 | 体积 | Schema | 跨语言 | 场景 |
|------|------|------|--------|--------|------|
| json | 慢 | 大 | 无 | 极广 | 配置、调试 |
| msgpack | 快 | 小 | 无 | 广 | 内部高吞吐 |
| protobuf | 极快 | 极小 | `.proto` | 广 | 微服务、gRPC |

```python
import msgpack
data = {'cmd': 'ping', 'seq': 42}
packed = msgpack.packb(data, use_bin_type=True)
# protobuf: 先定义 schema.proto, 执行 protoc --python_out=.
from proto.schema_pb2 import Request
req = Request(cmd='ping', seq=42)
wire = req.SerializeToString()
parsed = Request(); parsed.ParseFromString(wire)
```

Protobuf 强类型 + 字段编号实现兼容演进；Msgpack 零 Schema 定义适合快速迭代。

### 2.3 心跳机制

检测死连接、维持 NAT 映射：

```python
import struct, time, threading
HB_REQ, HB_RSP = 0x01, 0x02

def encode_hb_req(seq: int) -> bytes:
    return struct.pack('!BI', HB_REQ, seq)

def encode_hb_rsp(seq: int) -> bytes:
    return struct.pack('!BIB', HB_RSP, seq, 0)


class Heartbeat:
    def __init__(self, conn, interval=10, timeout=30):
        self.conn, self.interval, self.timeout = conn, interval, timeout
        self._seq, self._last_pong, self._running = 0, time.time(), False

    def start(self):
        self._running, self._last_pong = True, time.time()
        threading.Thread(target=self._loop, daemon=True).start()

    def on_pong(self):
        self._last_pong = time.time()

    def _loop(self):
        while self._running:
            time.sleep(self.interval)
            if time.time() - self._last_pong > self.timeout:
                self.conn.close(); break
            self._seq += 1
            try:
                self.conn.sendall(encode_hb_req(self._seq))
            except OSError:
                break
```

心跳包应极轻（3-5 字节），服务端收到 `REQ` 立即回复 `RSP` 不入队列。

---

## 3. SSL/TLS 安全通信

### 3.1 基础 TLS 配置

```python
import ssl, socket
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('cert.pem', 'key.pem')
ctx.minimum_version = ssl.TLSVersion.TLSv1_2
ctx.set_ciphers('ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM')
ctx.options |= ssl.OP_NO_COMPRESSION | ssl.OP_SINGLE_ECDH_USE

sock = socket.socket()
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('0.0.0.0', 9443)); sock.listen(128)
with ctx.wrap_socket(sock, server_side=True) as ssock:
    conn, addr = ssock.accept()
    print(f"版本: {conn.version()}, 密码套件: {conn.cipher()}")
```

`OP_NO_COMPRESSION` 防御 CRIME 攻击；`OP_SINGLE_ECDH_USE` 确保前向安全性。

### 3.2 双向认证（mTLS）

```python
# 服务端
ctx_srv = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx_srv.load_cert_chain('server-cert.pem', 'server-key.pem')
ctx_srv.load_verify_locations('ca-cert.pem')
ctx_srv.verify_mode = ssl.CERT_REQUIRED
# 客户端
ctx_cli = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx_cli.load_cert_chain('client-cert.pem', 'client-key.pem')
ctx_cli.load_verify_locations('ca-cert.pem')
ctx_cli.verify_mode = ssl.CERT_REQUIRED
raw = socket.create_connection(('example.com', 9443))
with ctx_cli.wrap_socket(raw, server_hostname='example.com') as tls:
    print(tls.getpeercert())
```

双方均持 CA 签发证书并互相校验，零信任架构核心组件。

### 3.3 SNI 与 asyncio

**SNI** 实现单端口多证书：

```python
def sni_cb(sock: ssl.SSLSocket, name: str, ctx):
    certs = {'api.example.com': ('api.pem', 'api-key.pem'),
             'www.example.com': ('www.pem', 'www-key.pem')}
    if name in certs:
        new_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        new_ctx.load_cert_chain(*certs[name])
        sock.context = new_ctx
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.sni_callback = sni_cb
```

**集成 asyncio**：

```python
import asyncio, ssl
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('cert.pem', 'key.pem')
async def cb(r, w):
    w.write(await r.read(1024)); await w.drain(); w.close()
server = await asyncio.start_server(cb, '0.0.0.0', 9443, ssl=ctx)
async with server: await server.serve_forever()
```

---

## 4. asyncio 网络层

### 4.1 Streams API

`asyncio.start_server` 是高并发 TCP 首选：

```python
import asyncio

async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    peer = writer.get_extra_info('peername')
    try:
        while True:
            data = await reader.readuntil(b'\n')
            resp = await process(data.strip())
            writer.write(resp + b'\n')
            await writer.drain()
            if writer.transport.get_write_buffer_size() > 65536:
                writer.write(b'BACKPRESSURE\n'); await writer.drain()
    except (ConnectionResetError, asyncio.IncompleteReadError):
        pass
    finally:
        writer.close(); await writer.wait_closed()

async def process(data: bytes) -> bytes:
    await asyncio.sleep(0.01)
    return b'OK:' + data

server = await asyncio.start_server(
    handle, '0.0.0.0', 8888, limit=65536, reuse_address=True, backlog=1024)
async with server: await server.serve_forever()
```

**核心方法**：
- `reader.readuntil(delim)` / `reader.readexactly(n)` — 对应分隔符/长度前缀
- `writer.drain()` — 等待写缓冲排空，实现背压
- `transport.get_write_buffer_size()` — 监控缓冲防止 OOM
- `writer.wait_closed()` — 确保连接完全关闭

### 4.2 Protocol/Transport 模式

Steams 底层是 `asyncio.Protocol`：

```python
class EchoProtocol(asyncio.Protocol):
    def connection_made(self, tp):
        self.tp = tp
        print(f"连接: {tp.get_extra_info('peername')}")
    def data_received(self, data):
        if len(data) >= 4:
            n = int.from_bytes(data[:4], 'big')
            if len(data) >= 4 + n:
                self.tp.write(data)
    def eof_received(self): return False
    def connection_lost(self, exc): print(f"断开: {exc}")

server = await asyncio.get_running_loop().create_server(EchoProtocol, '0.0.0.0', 8889)
async with server: await server.serve_forever()
```

Protocol 模式可调用 `pause_reading()/resume_reading()` 精细流控。**推荐 Streams，需底层控制时降级到 Protocol**。

### 4.3 连接限流

```python
class ConnLimiter:
    def __init__(self, max_conn=5000, rps=100):
        self._conns = set(); self._max_conn, self._rps = max_conn, rps
        self._times = []

    def acquire(self, w) -> bool:
        if len(self._conns) >= self._max_conn: return False
        self._conns.add(w); return True

    def release(self, w): self._conns.discard(w)

    def allow(self) -> bool:
        now = time.monotonic()
        self._times = [t for t in self._times if now - t < 1.0]
        if len(self._times) >= self._rps: return False
        self._times.append(now); return True

limiter = ConnLimiter()
async def handler(r, w):
    if not limiter.acquire(w):
        w.write(b'BUSY\n'); await w.drain(); w.close(); return
    try:
        while data := await r.readline():
            if not limiter.allow(): w.write(b'LIMIT\n')
            else: w.write(b'OK\n')
            await w.drain()
    finally:
        limiter.release(w); w.close(); await w.wait_closed()
```

---

## 5. 实战：轻量级 RPC 框架

综合上述技术实现完整的 RPC 框架。

### 5.1 协议层

```python
# rpc/protocol.py
import struct, msgpack, uuid
from enum import IntEnum

class MsgType(IntEnum):
    REQUEST, RESPONSE, HEARTBEAT, ERROR = 1, 2, 3, 4

class Protocol:
    MAGIC = b'\xCC\xDD\xEE\xFF'; HDR = 25

    @staticmethod
    def encode_request(method, params, rid=None):
        rid = rid or str(uuid.uuid4())
        return Protocol._pack(MsgType.REQUEST, rid,
            msgpack.packb({'method': method, 'params': params, 'id': rid}))

    @staticmethod
    def encode_response(rid, result=None, error=None):
        payload = msgpack.packb({'id': rid, 'result': result, 'error': error})
        return Protocol._pack(MsgType.ERROR if error else MsgType.RESPONSE, rid, payload)

    @staticmethod
    def encode_heartbeat():
        return Protocol._pack(MsgType.HEARTBEAT, '', b'')

    @staticmethod
    def _pack(t, rid, payload):
        rb = rid.encode('ascii').ljust(16, b'\x00')[:16]
        return Protocol.MAGIC + bytes([t]) + rb + struct.pack('!I', len(payload)) + payload

    @staticmethod
    def parse(data):
        if len(data) < Protocol.HDR or data[:4] != Protocol.MAGIC: return None
        t, rid = data[4], data[5:21].rstrip(b'\x00').decode()
        n = struct.unpack('!I', data[21:25])[0]
        if len(data) < Protocol.HDR + n: return None
        return {'type': MsgType(t), 'req_id': rid,
                'body': msgpack.unpackb(data[25:25+n], raw=False)}

    @staticmethod
    def parse_stream(buf):
        msgs = []
        while True:
            m = Protocol.parse(bytes(buf))
            if not m: break
            msgs.append(m)
            n = struct.unpack('!I', buf[21:25])[0]
            del buf[:Protocol.HDR + n]
        return msgs
```

### 5.2 服务端

```python
# rpc/server.py
import asyncio, logging
from rpc.protocol import Protocol, MsgType
logger = logging.getLogger(__name__)

class Server:
    def __init__(self, host='0.0.0.0', port=9090):
        self.host, self.port = host, port
        self._services = {}

    def register(self, name):
        def wrap(f): self._services[name] = f; return f
        return wrap

    async def _handle(self, reader, writer):
        buf, peer = bytearray(), writer.get_extra_info('peername')
        logger.info(f"RPC 连接: {peer}")
        try:
            while chunk := await reader.read(65536):
                buf.extend(chunk)
                for msg in Protocol.parse_stream(buf):
                    if resp := await self._dispatch(msg):
                        writer.write(resp); await writer.drain()
        except Exception: logger.exception("异常")
        finally: writer.close(); await writer.wait_closed()

    async def _dispatch(self, msg):
        if msg['type'] in (MsgType.HEARTBEAT,): return None
        body, rid = msg['body'], msg['req_id']
        method = body['method']
        if method not in self._services:
            return Protocol.encode_response(rid, error=f"Unknown: {method}")
        try:
            result = self._services[method](**body['params'])
            if asyncio.iscoroutine(result): result = await result
            return Protocol.encode_response(rid, result=result)
        except Exception as e:
            return Protocol.encode_response(rid, error=str(e))

    async def start(self):
        self.server = await asyncio.start_server(
            self._handle, self.host, self.port, reuse_address=True, backlog=1024)
        async with self.server: await self.server.serve_forever()
```

### 5.3 客户端

```python
# rpc/client.py
import asyncio, uuid, logging
from rpc.protocol import Protocol, MsgType
logger = logging.getLogger(__name__)

class RPCError(Exception): pass

class Client:
    def __init__(self, host='127.0.0.1', port=9090, conn_tmo=5, req_tmo=10):
        self.host, self.port = host, port
        self.conn_tmo, self.req_tmo = conn_tmo, req_tmo
        self._reader = self._writer = None
        self._pending = {}; self._read_task = None

    async def connect(self):
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(self.host, self.port), timeout=self.conn_tmo)
        self._read_task = asyncio.create_task(self._read_loop())

    async def _read_loop(self):
        buf = bytearray()
        try:
            while chunk := await self._reader.read(65536):
                buf.extend(chunk)
                for msg in Protocol.parse_stream(buf):
                    if msg['type'] == MsgType.HEARTBEAT: continue
                    fut = self._pending.pop(msg['req_id'], None)
                    if fut and not fut.done():
                        body = msg['body']
                        if body.get('error'): fut.set_exception(RPCError(body['error']))
                        else: fut.set_result(body.get('result'))
        except: pass
        finally:
            for f in self._pending.values():
                if not f.done(): f.set_exception(ConnectionError("断开"))
            self._pending.clear()

    async def call(self, method, params=None, timeout=None):
        params, timeout = params or {}, timeout or self.req_tmo
        for attempt in range(3):
            try: return await self._do_call(method, params, timeout)
            except (ConnectionError, TimeoutError) as e:
                logger.warning(f"重试 {attempt+1}: {e}")
                await asyncio.sleep(1 << attempt)
                await self.reconnect()
        raise ConnectionError("RPC 失败")

    async def _do_call(self, method, params, timeout):
        rid = str(uuid.uuid4())
        data = Protocol.encode_request(method, params, rid)
        fut = asyncio.get_running_loop().create_future()
        self._pending[rid] = fut
        self._writer.write(data); await self._writer.drain()
        try: return await asyncio.wait_for(fut, timeout=timeout)
        except TimeoutError: self._pending.pop(rid, None); raise

    async def reconnect(self): self.close(); await self.connect()

    def close(self):
        if self._read_task: self._read_task.cancel()
        if self._writer: self._writer.close()
        self._reader = self._writer = self._read_task = None
```

### 5.4 使用示例

```python
# 服务端
from rpc.server import Server
server = Server()

@server.register('math.add')
def add(a, b): return a + b

@server.register('user.get')
async def get(uid):
    await asyncio.sleep(0.01)
    return {'uid': uid, 'name': 'Alice'}
# asyncio.run(server.start())

# 客户端
from rpc.client import Client
async def main():
    c = Client('127.0.0.1', 9090, req_tmo=5)
    await c.connect()
    r = await c.call('math.add', {'a': 1, 'b': 2})          # → 3
    u = await c.call('user.get', {'uid': 42})                # → {'uid': 42, 'name': 'Alice'}
    rs = await asyncio.gather(*[c.call('math.add', {'a':i,'b':i}) for i in range(10)])
    c.close()
# asyncio.run(main())
```

客户端内置 3 次指数退避重试、连接恢复、请求超时。服务端同步/异步 handler 共存、心跳静默忽略、异常隔离。

---

## 总结

| 主题 | 核心要点 |
|------|---------|
| **Socket 进阶** | `setsockopt` 控制保活/Nagle/缓冲区，非阻塞 + `selectors` 事件驱动 |
| **自定义协议** | 长度前缀帧定界，msgpack/protobuf 序列化，心跳保活 |
| **SSL/TLS** | 安全基线配置，mTLS 双向认证，SNI 多证书，asyncio 集成 |
| **asyncio 网络** | Streams API 优先，Protocol/Transport 底层控制，连接限流与背压 |
| **RPC 框架** | 协议编码 → 服务注册 → 请求派发 → 超时重试，综合运用前述技术 |

理解这些底层原理后，使用 gRPC、thrift 等框架时将能更深刻地理解其设计取舍。
