# 第 16 章：Node.js 事件循环与性能

> 目标读者：有 JavaScript/TypeScript 基础，希望深入理解 Node.js 事件循环机制、与浏览器的差异、libuv 底层原理以及性能优化实践的开发者。

---

## 16.1 Node.js 事件循环概览

### 16.1.1 与浏览器事件循环的核心差异

浏览器事件循环只有宏任务和微任务两个队列。Node.js 事件循环有 **6 个阶段**，每个阶段有专门的队列：

```
   ┌──────────────────────────┐
┌─>│        timers             │ ← setTimeout / setInterval
│  └─────────────┬────────────┘
│  ┌─────────────┴────────────┐
│  │     pending callbacks     │ ← 系统级回调（TCP 错误等）
│  └─────────────┬────────────┘
│  ┌─────────────┴────────────┐
│  │       idle, prepare       │ ← 内部使用
│  └─────────────┬────────────┘
│  ┌─────────────┴────────────┐
│  │         poll              │ ← I/O 回调、文件读取、网络请求
│  └─────────────┬────────────┘
│  ┌─────────────┴────────────┐
│  │        check              │ ← setImmediate
│  └─────────────┬────────────┘
│  ┌─────────────┴────────────┐
│  │    close callbacks        │ ← socket.on('close', ...)
│  └─────────────┬────────────┘
│                │
└────────────────┘
```

### 16.1.2 完整的事件循环流程

```
1. 进入事件循环
2. 检查是否有 process.nextTick 微任务 → 执行全部
3. 检查是否有其他微任务（Promise.then 等）→ 执行全部
4. 进入 timers 阶段 → 执行到期的 setTimeout/setInterval
5. 检查 process.nextTick → 执行全部
6. 检查微任务 → 执行全部
7. 进入 pending callbacks 阶段
8. 检查 process.nextTick → 执行全部
9. 检查微任务 → 执行全部
10. 进入 idle, prepare 阶段（内部）
11. 进入 poll 阶段
    - 如果有 I/O 回调 → 执行
    - 如果没有 I/O 回调：
      - 如果有 setImmediate → 进入 check 阶段
      - 如果有定时器 → 等待定时器到期
      - 否则 → 阻塞等待 I/O
12. 检查 process.nextTick → 执行全部
13. 检查微任务 → 执行全部
14. 进入 check 阶段 → 执行 setImmediate
15. 检查 process.nextTick → 执行全部
16. 检查微任务 → 执行全部
17. 进入 close callbacks 阶段
18. 检查 process.nextTick → 执行全部
19. 检查微任务 → 执行全部
20. 回到步骤 2
```

**关键规则**：每个阶段之间都会清空 `process.nextTick` 和微任务队列。

---

## 16.2 六个阶段详解

### 16.2.1 timers 阶段

执行到期的 `setTimeout` 和 `setInterval` 回调：

```javascript
const start = Date.now();

setTimeout(() => {
  console.log(`定时器延迟: ${Date.now() - start}ms`);
}, 100);

// 如果事件循环被阻塞，定时器会延迟
// setTimeout 的延迟是"至少"延迟指定时间，不是"精确"延迟
```

**重要细节**：

```javascript
// 定时器可能因为 poll 阶段的 I/O 而延迟
const start = Date.now();

setTimeout(() => {
  console.log(`setTimeout: ${Date.now() - start}ms`);
}, 10);

// 模拟阻塞 I/O
const fs = require("fs");
fs.readFile("/large-file", () => {
  // 如果这个回调执行时间超过 10ms
  // setTimeout 的回调会延迟到下一个 timers 阶段
  const end = Date.now();
  while (Date.now() - end < 50) {
    // 模拟耗时操作
  }
});
```

### 16.2.2 pending callbacks 阶段

执行上一轮循环中延迟到本轮的 I/O 回调（如 TCP 错误回调）：

```javascript
const net = require("net");

const server = net.createServer((socket) => {
  socket.on("error", (err) => {
    // 某些系统级错误回调会在此阶段执行
    console.error("Socket 错误:", err.code);
  });
});

server.listen(3000);
```

### 16.2.3 idle, prepare 阶段

Node.js 内部使用，开发者通常不接触。用于 libuv 内部操作。

### 16.2.4 poll 阶段

这是最关键的阶段——获取新的 I/O 事件，执行 I/O 相关回调：

```javascript
const fs = require("fs");

// 文件读取回调在 poll 阶段执行
fs.readFile("data.txt", (err, data) => {
  console.log("文件读取完成（poll 阶段）");
});

// 网络请求回调也在 poll 阶段
const http = require("http");
http.get("http://example.com", (res) => {
  console.log("网络请求完成（poll 阶段）");
});
```

**poll 阶段的行为规则**：

1. 如果 poll 队列不为空 → 依次执行回调
2. 如果 poll 队列为空：
   - 如果有 `setImmediate` → 结束 poll 阶段，进入 check 阶段
   - 如果有定时器 → 等待定时器到期后回到 timers 阶段
   - 如果都没有 → 阻塞等待新的 I/O 事件

### 16.2.5 check 阶段

`setImmediate` 的回调在此阶段执行：

```javascript
const fs = require("fs");

fs.readFile("data.txt", () => {
  // 在 I/O 回调中，setImmediate 总是先于 setTimeout
  setTimeout(() => {
    console.log("setTimeout");
  }, 0);

  setImmediate(() => {
    console.log("setImmediate");
  });
});

// 输出顺序：setImmediate → setTimeout
// 因为 I/O 回调在 poll 阶段执行
// poll 之后是 check 阶段（setImmediate）
// 然后才是下一轮的 timers 阶段（setTimeout）
```

### 16.2.6 close callbacks 阶段

执行关闭事件的回调，如 `socket.on('close')`：

```javascript
const net = require("net");

const server = net.createServer((socket) => {
  socket.on("close", () => {
    console.log("Socket 关闭（close callbacks 阶段）");
  });
});
```

---

## 16.3 process.nextTick 与微任务

### 16.3.1 process.nextTick 的特殊性

`process.nextTick` 不是微任务队列的一部分，它有自己的独立队列，**优先级高于所有微任务**：

```javascript
process.nextTick(() => console.log("nextTick 1"));
process.nextTick(() => console.log("nextTick 2"));

Promise.resolve().then(() => console.log("Promise 1"));
Promise.resolve().then(() => console.log("Promise 2"));

process.nextTick(() => console.log("nextTick 3"));

// 输出顺序：
// nextTick 1
// nextTick 2
// nextTick 3
// Promise 1
// Promise 2
```

**执行顺序**：`process.nextTick` → `Promise.then` → 其他微任务

### 16.3.2 nextTick 的递归陷阱

```javascript
// ⚠️ 危险：nextTick 递归会饿死 I/O
function recursiveNextTick() {
  process.nextTick(() => {
    console.log("nextTick");
    recursiveNextTick(); // 永远不会让出给 I/O
  });
}

recursiveNextTick();
setTimeout(() => {
  console.log("这行永远不会执行");
}, 0);
```

**Node.js 的保护机制**：`process.maxTickDepth` 默认值是 1024，超过会打印警告但不会阻止。

### 16.3.3 何时使用 process.nextTick

```javascript
// ✅ 正确用法 1：确保回调在调用后异步执行
function readFile(path, callback) {
  const data = fs.readFileSync(path); // 同步读取
  process.nextTick(() => callback(null, data)); // 异步回调
}

// ✅ 正确用法 2：确保事件在监听器注册后触发
class EventEmitter {
  constructor() {
    this.events = {};
  }

  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return this;
  }

  emit(event, ...args) {
    const listeners = this.events[event] || [];
    // 使用 nextTick 确保所有监听器已注册
    process.nextTick(() => {
      listeners.forEach((listener) => listener(...args));
    });
  }
}

const emitter = new EventEmitter();
emitter.on("data", (data) => console.log("收到:", data));
emitter.emit("data", "hello"); // 如果不用 nextTick，可能错过事件
```

### 16.3.4 nextTick vs setImmediate

| 特性 | `process.nextTick` | `setImmediate` |
|------|-------------------|----------------|
| 执行时机 | 每个阶段之后 | check 阶段 |
| 优先级 | 最高（高于微任务） | 较低（在 poll 之后） |
| 递归安全 | 可能饿死 I/O | 不会饿死 I/O |
| 推荐用途 | 确保异步执行 | I/O 后立即执行 |

```javascript
// 在非 I/O 上下文中，顺序不确定
setTimeout(() => console.log("setTimeout"), 0);
setImmediate(() => console.log("setImmediate"));
process.nextTick(() => console.log("nextTick"));

// 输出顺序：
// nextTick（总是最先）
// setTimeout 和 setImmediate 的顺序取决于上下文
```

---

## 16.4 Node.js 事件循环实战

### 16.4.1 综合执行顺序

```javascript
console.log("1: 同步开始");

setTimeout(() => {
  console.log("2: setTimeout");
}, 0);

setImmediate(() => {
  console.log("3: setImmediate");
});

Promise.resolve().then(() => {
  console.log("4: Promise.then");
});

process.nextTick(() => {
  console.log("5: nextTick");
});

fs.readFile(__filename, () => {
  console.log("6: I/O 回调");

  setTimeout(() => {
    console.log("7: I/O 中的 setTimeout");
  }, 0);

  setImmediate(() => {
    console.log("8: I/O 中的 setImmediate");
  });
});

console.log("9: 同步结束");

// 典型输出顺序：
// 1: 同步开始
// 9: 同步结束
// 5: nextTick
// 4: Promise.then
// 2: setTimeout（或 3: setImmediate，取决于上下文）
// 3: setImmediate（或 2: setTimeout）
// 6: I/O 回调
// 8: I/O 中的 setImmediate（在 I/O 回调中 setImmediate 一定先于 setTimeout）
// 7: I/O 中的 setTimeout
```

### 16.4.2 微任务在每个阶段之间执行

```javascript
const fs = require("fs");

fs.readFile(__filename, () => {
  console.log("1: I/O 回调（poll 阶段）");

  Promise.resolve().then(() => {
    console.log("2: 微任务（poll 后）");
  });

  process.nextTick(() => {
    console.log("3: nextTick（poll 后）");
  });

  // 进入 check 阶段
  setImmediate(() => {
    console.log("4: setImmediate（check 阶段）");

    Promise.resolve().then(() => {
      console.log("5: 微任务（check 后）");
    });
  });
});

// 输出：1 → 3 → 2 → 4 → 5
```

### 16.4.3 定时器精度

```javascript
// Node.js 定时器精度测试
function testTimerPrecision() {
  const delays = [0, 1, 5, 10, 50, 100, 500, 1000];

  delays.forEach((delay) => {
    const start = performance.now();
    setTimeout(() => {
      const actual = performance.now() - start;
      console.log(`设定 ${delay}ms，实际 ${actual.toFixed(2)}ms，偏差 ${(actual - delay).toFixed(2)}ms`);
    }, delay);
  });
}

testTimerPrecision();
// 典型输出：
// 设定 0ms，实际 1.23ms，偏差 1.23ms
// 设定 1ms，实际 2.45ms，偏差 1.45ms
// 设定 5ms，实际 6.78ms，偏差 1.78ms
// 设定 10ms，实际 11.23ms，偏差 1.23ms
// 设定 50ms，实际 51.01ms，偏差 1.01ms
// 设定 100ms，实际 100.89ms，偏差 0.89ms
// 设定 500ms，实际 500.56ms，偏差 0.56ms
// 设定 1000ms，实际 1000.34ms，偏差 0.34ms
```

---

## 16.5 libuv 与底层机制

### 16.5.1 libuv 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Node.js 进程                            │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  V8 引擎      │  │  Node.js 绑定 │  │  JavaScript 代码  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         └─────────────────┼────────────────────┘            │
│                           │                                 │
│  ┌────────────────────────┴──────────────────────────────┐  │
│  │                    libuv                                │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │  │
│  │  │ 事件循环   │  │ 线程池    │  │  系统调用             │ │  │
│  │  │ (epoll/  │  │ (Thread  │  │  (非阻塞 I/O)        │ │  │
│  │  │  kqueue/ │  │  Pool)   │  │                     │ │  │
│  │  │  IOCP)   │  │  4 线程   │  │                     │ │  │
│  │  └──────────┘  └──────────┘  └──────────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 16.5.2 libuv 线程池

Node.js 的某些操作无法使用系统级异步 I/O，需要通过 libuv 线程池完成：

| 操作 | 是否使用线程池 |
|------|--------------|
| 网络请求 (net/http) | ❌ 使用系统异步 I/O |
| DNS 查询 (dns.lookup) | ✅ 使用线程池 |
| 文件系统操作 (fs) | ✅ 使用线程池（大部分平台） |
| 压缩 (zlib) | ✅ 使用线程池 |
| 加密 (crypto) | ✅ 部分使用线程池 |
| Pipe | ❌ 使用系统异步 I/O |

```javascript
// 线程池大小默认为 4，可通过环境变量调整
// UV_THREADPOOL_SIZE=8 node app.js

const fs = require("fs");
const crypto = require("crypto");

// 这些操作会使用线程池
// 如果线程池满了，后续操作会排队等待
for (let i = 0; i < 8; i++) {
  fs.readFile("/large-file", () => {
    console.log(`文件 ${i} 读取完成`);
  });
}

for (let i = 0; i < 8; i++) {
  crypto.pbkdf2("password", "salt", 100000, 64, "sha512", () => {
    console.log(`加密 ${i} 完成`);
  });
}
```

### 16.5.3 线程池大小的影响

```javascript
// 默认线程池大小：4
// 当有 4 个以上的 CPU 密集型操作时，会排队等待

const crypto = require("crypto");
const start = Date.now();

// 8 个加密操作，但线程池只有 4 个线程
for (let i = 0; i < 8; i++) {
  crypto.pbkdf2(`password${i}`, "salt", 100000, 64, "sha512", () => {
    console.log(`加密 ${i} 完成，耗时: ${Date.now() - start}ms`);
  });
}

// 前 4 个几乎同时完成，后 4 个等线程池空闲后才开始
// 加密 0 完成，耗时: ~200ms
// 加密 1 完成，耗时: ~200ms
// 加密 2 完成，耗时: ~200ms
// 加密 3 完成，耗时: ~200ms
// 加密 4 完成，耗时: ~400ms  ← 等待线程池
// ...
```

---

## 16.6 阻塞事件循环与解决方案

### 16.6.1 什么会阻塞事件循环

```javascript
// ❌ CPU 密集型操作阻塞事件循环
function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// 计算 fibonacci(45) 可能需要数秒
// 这段时间内所有 I/O、定时器、网络请求都无法处理
console.time("fibonacci");
const result = fibonacci(45);
console.timeEnd("fibonacci"); // fibonacci: 5000ms+

// ❌ 同步文件操作
const data = fs.readFileSync("/large-file"); // 阻塞直到读取完成

// ❌ JSON.parse 大字符串
const hugeData = JSON.parse(fs.readFileSync("huge.json", "utf-8")); // 可能阻塞数秒

// ❌ 正则表达式回溯
const regex = /^(a+)+$/;
regex.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"); // 可能阻塞
```

### 16.6.2 解决方案 1：分片处理

```javascript
// 将大任务拆分为小任务，每轮事件循环处理一部分
async function processLargeArray(items, processFn, chunkSize = 100) {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    for (const item of chunk) {
      processFn(item);
    }
    // 让出主线程
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// 使用
const largeArray = Array.from({ length: 100000 }, (_, i) => i);
await processLargeArray(largeArray, (item) => {
  // 处理每个元素
}, 100);
```

### 16.6.3 解决方案 2：Worker Threads

```javascript
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

// main.js
if (isMainThread) {
  function computeInWorker(data) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: data,
      });

      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }

  // 主线程不阻塞
  const result = await computeInWorker({ n: 45 });
  console.log("结果:", result);
} else {
  // Worker 线程
  function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
  }

  const result = fibonacci(workerData.n);
  parentPort.postMessage(result);
}
```

### 16.6.4 解决方案 3：Worker Threads 线程池

```javascript
const { Worker } = require("worker_threads");
const path = require("path");

class WorkerPool {
  constructor(size = 4) {
    this.size = size;
    this.pool = [];
    this.queue = [];
  }

  init() {
    for (let i = 0; i < this.size; i++) {
      this.pool.push(this.createWorker());
    }
  }

  createWorker() {
    const worker = new Worker(path.join(__dirname, "worker.js"));
    worker.busy = false;

    worker.on("message", (result) => {
      worker.busy = false;
      if (worker.resolve) {
        worker.resolve(result);
        worker.resolve = null;
      }
      this.processQueue();
    });

    worker.on("error", (err) => {
      worker.busy = false;
      if (worker.reject) {
        worker.reject(err);
        worker.reject = null;
      }
    });

    return worker;
  }

  execute(data) {
    return new Promise((resolve, reject) => {
      const worker = this.pool.find((w) => !w.busy);

      if (worker) {
        worker.busy = true;
        worker.resolve = resolve;
        worker.reject = reject;
        worker.postMessage(data);
      } else {
        this.queue.push({ data, resolve, reject });
      }
    });
  }

  processQueue() {
    if (this.queue.length === 0) return;

    const worker = this.pool.find((w) => !w.busy);
    if (!worker) return;

    const { data, resolve, reject } = this.queue.shift();
    worker.busy = true;
    worker.resolve = resolve;
    worker.reject = reject;
    worker.postMessage(data);
  }

  terminate() {
    this.pool.forEach((worker) => worker.terminate());
  }
}

// 使用
const pool = new WorkerPool(4);
pool.init();

const results = await Promise.all([
  pool.execute({ task: "fibonacci", n: 40 }),
  pool.execute({ task: "fibonacci", n: 42 }),
  pool.execute({ task: "fibonacci", n: 44 }),
  pool.execute({ task: "fibonacci", n: 45 }),
]);

pool.terminate();
```

---

## 16.7 流与背压

### 16.7.1 流的事件循环影响

Node.js 流（Stream）是事件循环友好的数据处理方式，不会一次性加载全部数据到内存：

```javascript
const fs = require("fs");
const { pipeline } = require("stream/promises");
const { Transform } = require("stream");

// ❌ 一次性读取大文件——阻塞事件循环、占用大量内存
const data = fs.readFileSync("huge-file.txt", "utf-8");
const processed = data.split("\n").map(transformLine);
fs.writeFileSync("output.txt", processed.join("\n"));

// ✅ 使用流——内存友好、不阻塞事件循环
const transform = new Transform({
  transform(chunk, encoding, callback) {
    const lines = chunk.toString().split("\n");
    const processed = lines.map(transformLine).join("\n");
    callback(null, processed);
  },
});

await pipeline(
  fs.createReadStream("huge-file.txt"),
  transform,
  fs.createWriteStream("output.txt")
);
```

### 16.7.2 背压机制

当生产者速度 > 消费者速度时，流会自动暂停读取，防止内存溢出：

```javascript
const fs = require("fs");
const { Transform } = require("stream");
const http = require("http");

// 模拟慢速消费者
const slowTransform = new Transform({
  transform(chunk, encoding, callback) {
    // 模拟处理延迟
    setTimeout(() => {
      callback(null, chunk.toString().toUpperCase());
    }, 100); // 每块数据处理 100ms
  },
});

// 创建可读流
const readable = fs.createReadStream("large-file.txt", {
  highWaterMark: 64 * 1024, // 64KB 缓冲区
});

// 监听背压事件
readable.on("pause", () => console.log("读取暂停（背压）"));
readable.on("resume", () => console.log("读取恢复"));

readable.pipe(slowTransform).pipe(process.stdout);
// 当缓冲区满时，readable 会自动暂停
// 当缓冲区清空后，readable 会自动恢复
```

### 16.7.3 手动处理背压

```javascript
const fs = require("fs");

async function processWithBackpressure(inputPath, outputPath) {
  const readable = fs.createReadStream(inputPath);
  const writable = fs.createWriteStream(outputPath);

  let paused = false;

  readable.on("data", (chunk) => {
    const canWrite = writable.write(transformChunk(chunk));

    if (!canWrite && !paused) {
      // 消费者处理不过来，暂停读取
      readable.pause();
      paused = true;
    }
  });

  writable.on("drain", () => {
    // 缓冲区清空，恢复读取
    if (paused) {
      readable.resume();
      paused = false;
    }
  });

  return new Promise((resolve, reject) => {
    writable.on("finish", resolve);
    writable.on("error", reject);
  });
}
```

---

## 16.8 性能监控与诊断

### 16.8.1 事件循环延迟检测

```javascript
// 检测事件循环延迟
function monitorEventLoopLag(intervalMs = 1000) {
  let lastTime = performance.now();

  setInterval(() => {
    const currentTime = performance.now();
    const lag = currentTime - lastTime - intervalMs;
    const lagMs = Math.max(0, lag);

    if (lagMs > 50) {
      console.warn(`⚠️ 事件循环延迟: ${lagMs.toFixed(2)}ms`);
    } else if (lagMs > 10) {
      console.log(`事件循环延迟: ${lagMs.toFixed(2)}ms`);
    }

    lastTime = currentTime;
  }, intervalMs);
}

monitorEventLoopLag();
```

### 16.8.2 使用 perf_hooks 监控

```javascript
const { performance, PerformanceObserver } = require("perf_hooks");

// 监控函数执行时间
function measureAsync(name, fn) {
  const start = performance.now();
  performance.mark(`${name}-start`);

  return fn().then((result) => {
    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);
    const duration = performance.now() - start;
    console.log(`${name}: ${duration.toFixed(2)}ms`);
    return result;
  });
}

// 监控所有性能条目
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`[Perf] ${entry.name}: ${entry.duration.toFixed(2)}ms`);
  }
});
observer.observe({ type: "measure", buffered: true });

// 使用
await measureAsync("数据库查询", () => db.query("SELECT * FROM users"));
await measureAsync("API 请求", () => fetch("https://api.example.com/data"));
```

### 16.8.3 使用 clinic.js 诊断

```bash
# 安装
npm install -g clinic

# CPU 性能分析
clinic he -- node app.js
# 生成 CPU 火焰图，打开 clinic-he.html 查看

# 事件循环延迟分析
clinic doctor -- node app.js
# 生成诊断报告，检测 I/O 问题、CPU 瓶颈等

# 内存泄漏检测
clinic bubbleprof -- node app.js
# 分析异步操作的时间分布
```

### 16.8.4 使用 --diagnostics-dir 生成诊断

```bash
# 生成 CPU Profile
node --prof app.js
# 分析
node --prof-process isolate-0x*.log

# 生成堆快照
node --heapsnapshot-signal=SIGUSR2 app.js
# 发送信号生成快照
kill -USR2 <pid>

# 使用 inspector
node --inspect app.js
# 在 Chrome DevTools 中连接
```

---

## 16.9 Node.js 与浏览器事件循环对比

### 16.9.1 关键差异总结

| 特性 | 浏览器 | Node.js |
|------|--------|---------|
| 事件循环阶段 | 宏任务 → 微任务 → 渲染 | 6 个阶段 |
| 微任务优先级 | Promise.then | process.nextTick > Promise.then |
| `setImmediate` | 不存在 | check 阶段执行 |
| `process.nextTick` | 不存在 | 每个阶段后执行 |
| `requestAnimationFrame` | 渲染前执行 | 不存在 |
| 渲染 | 有 | 无 |
| I/O 模型 | 浏览器网络栈 | libuv |
| 定时器最小延迟 | 4ms（嵌套 5 层后） | 1ms |

### 16.9.2 同一段代码的不同输出

```javascript
// 浏览器
setTimeout(() => console.log("setTimeout"), 0);
Promise.resolve().then(() => console.log("Promise"));

// 浏览器输出：Promise → setTimeout
// Node.js 输出：Promise → setTimeout（大多数情况）

// 但在 I/O 回调中：
fs.readFile(__filename, () => {
  setTimeout(() => console.log("setTimeout"), 0);
  setImmediate(() => console.log("setImmediate"));
});

// Node.js 输出：setImmediate → setTimeout
// 因为 I/O 回调在 poll 阶段，下一个是 check（setImmediate），然后才是 timers
```

### 16.9.3 跨平台兼容写法

```javascript
// 如果需要代码在浏览器和 Node.js 中都能运行
// 使用 Promise 代替 process.nextTick
function nextTick(callback) {
  if (typeof process !== "undefined" && process.nextTick) {
    process.nextTick(callback);
  } else {
    Promise.resolve().then(callback);
  }
}

// 使用 queueMicrotask（浏览器和 Node.js 12+ 都支持）
function scheduleMicrotask(callback) {
  queueMicrotask(callback);
}

// 使用 setImmediate 的替代方案
function nextIteration(callback) {
  if (typeof setImmediate !== "undefined") {
    setImmediate(callback);
  } else {
    setTimeout(callback, 0);
  }
}
```

---

## 16.10 异步错误处理

### 16.10.1 未捕获的 Promise 错误

```javascript
// ❌ 未处理的 Promise 拒绝
Promise.reject("错误"); // Node.js 会打印警告

// ✅ 始终处理 Promise 错误
Promise.reject("错误").catch((err) => {
  console.error("捕获:", err);
});

// 全局错误处理
process.on("unhandledRejection", (reason, promise) => {
  console.error("未处理的 Promise 拒绝:", reason);
  console.error("Promise:", promise);
  // 可以选择退出进程
  // process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("未捕获的异常:", error);
  // ⚠️ 此后进程状态不可靠，建议重启
  process.exit(1);
});
```

### 16.10.2 async 函数中的错误冒泡

```javascript
// async 函数中的错误会变成 rejected Promise
async function fetchData() {
  const response = await fetch("https://api.example.com/data");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// 调用方必须处理错误
async function handler() {
  try {
    const data = await fetchData();
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      console.error("网络错误:", error);
    } else {
      console.error("未知错误:", error);
    }
    throw error; // 重新抛出
  }
}
```

### 16.10.3 EventEmitter 的错误事件

```javascript
const EventEmitter = require("events");

const emitter = new EventEmitter();

// ❌ 如果没有监听 error 事件，会抛出未捕获异常
// emitter.emit("error", new Error("出错了")); // 进程崩溃

// ✅ 始终监听 error 事件
emitter.on("error", (error) => {
  console.error("事件错误:", error.message);
});

emitter.emit("error", new Error("出错了")); // 安全
```

---

## 16.11 实战：构建高性能事件循环应用

### 16.11.1 避免阻塞的最佳实践

```javascript
// ❌ 同步操作
const data = fs.readFileSync("file.txt");

// ✅ 异步操作
const data = await fs.promises.readFile("file.txt");

// ❌ CPU 密集型操作阻塞主线程
const hash = crypto.createHash("sha256").update(hugeData).digest("hex");

// ✅ 使用 Worker Threads
const hash = await computeInWorker({ task: "hash", data: hugeData });

// ❌ 正则表达式灾难性回溯
const badRegex = /(a+)+b/;
badRegex.test("aaaaaaaaaaaaaaaaaaaaaac"); // 可能阻塞

// ✅ 使用安全的正则或限制输入
const safeRegex = /a+b/;
if (input.length > 1000) {
  throw new Error("输入过长");
}
```

### 16.11.2 优雅关停

```javascript
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

server.listen(PORT);

let connections = 0;
server.on("connection", (socket) => {
  connections++;
  socket.on("close", () => connections--);
});

function gracefulShutdown(signal) {
  console.log(`收到 ${signal}，开始优雅关停...`);

  // 1. 停止接受新连接
  server.close(() => {
    console.log("HTTP 服务器已关闭");
  });

  // 2. 设置超时强制退出
  const forceTimeout = setTimeout(() => {
    console.error("关停超时，强制退出");
    process.exit(1);
  }, 10000);

  // 3. 等待现有连接完成
  const checkInterval = setInterval(() => {
    if (connections === 0) {
      clearTimeout(forceTimeout);
      clearInterval(checkInterval);
      console.log("所有连接已关闭");
      process.exit(0);
    }
  }, 100);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
```

### 16.11.3 健康检查端点

```javascript
const express = require("express");
const app = express();

let isReady = false;
let isAlive = true;

// 就绪探针
app.get("/readyz", (req, res) => {
  if (isReady) {
    res.status(200).json({ status: "ready" });
  } else {
    res.status(503).json({ status: "not ready" });
  }
});

// 存活探针
app.get("/healthz", (req, res) => {
  if (isAlive) {
    // 检查事件循环延迟
    const start = Date.now();
    setImmediate(() => {
      const lag = Date.now() - start;
      if (lag > 100) {
        res.status(503).json({ status: "unhealthy", lag });
      } else {
        res.status(200).json({ status: "healthy", lag });
      }
    });
  } else {
    res.status(503).json({ status: "unhealthy" });
  }
});

// 初始化完成后设置就绪
async function start() {
  await connectDatabase();
  await connectRedis();
  isReady = true;
}

start().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
```

---

## 小结

| 阶段 | 执行内容 | 关键 API |
|------|---------|---------|
| timers | 到期的 setTimeout/setInterval | `setTimeout`, `setInterval` |
| pending callbacks | 系统级回调 | TCP 错误等 |
| idle, prepare | 内部使用 | — |
| poll | I/O 回调 | `fs.readFile`, `net.createServer` |
| check | setImmediate | `setImmediate` |
| close callbacks | 关闭事件 | `socket.on('close')` |

| 优先级 | API | 说明 |
|--------|-----|------|
| 最高 | `process.nextTick` | 每个阶段后立即执行 |
| 高 | `Promise.then` | 微任务队列 |
| 中 | `setImmediate` | check 阶段 |
| 低 | `setTimeout(fn, 0)` | timers 阶段 |

| 性能优化 | 方法 |
|---------|------|
| 避免 CPU 密集操作 | Worker Threads / 分片 |
| 避免同步 I/O | 使用 `fs.promises` |
| 流处理大数据 | `pipeline` + 背压 |
| 监控事件循环延迟 | `perf_hooks` / `clinic.js` |
| 线程池调优 | `UV_THREADPOOL_SIZE` |