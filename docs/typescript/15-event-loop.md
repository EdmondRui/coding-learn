# 第 15 章：事件循环与异步机制

> 目标读者：有 JavaScript/TypeScript 基础，希望深入理解事件循环原理、异步执行顺序和底层机制的开发者。本章从浏览器架构出发，系统讲解事件循环的每个环节。

---

## 15.1 为什么需要事件循环

### 15.1.1 单线程的 JavaScript

JavaScript 从诞生起就是单线程语言。原因很简单：浏览器环境中 JavaScript 需要操作 DOM，如果多个线程同时修改同一个元素，浏览器无法决定以谁为准。

```
┌─────────────────────────────────────────┐
│              浏览器进程                    │
│                                         │
│  ┌───────────┐  ┌──────────┐  ┌───────┐ │
│  │ JS 主线程   │  │ 渲染线程   │  │ 网络线程│ │
│  │ (事件循环)  │  │ (独立线程) │  │       │ │
│  └───────────┘  └──────────┘  └───────┘ │
│                                         │
│  ┌───────────┐  ┌──────────┐  ┌───────┐ │
│  │ 定时器线程  │  │ I/O 线程  │  │ GPU线程│ │
│  └───────────┘  └──────────┘  └───────┘ │
└─────────────────────────────────────────┘
```

单线程意味着同一时刻只能执行一段代码。但浏览器本身是多线程的——网络请求、定时器、I/O 操作由其他线程处理，完成后将回调放入队列，等待 JS 主线程执行。

**事件循环就是协调"什么时候执行哪段代码"的调度机制。**

### 15.1.2 同步与异步的本质区别

```javascript
// 同步——阻塞
console.log("1");
const data = fs.readFileSync("file.txt"); // 阻塞主线程，等待文件读取完成
console.log("2", data);

// 异步——非阻塞
console.log("1");
fs.readFile("file.txt", (err, data) => {
  // 这个回调在事件循环的后续轮次中执行
  console.log("3", data);
});
console.log("2"); // 立即执行，不等待文件读取
// 输出顺序：1 → 2 → 3
```

同步代码在调用栈中顺序执行，异步代码的回调被放入任务队列，等待调用栈清空后由事件循环调度执行。

---

## 15.2 调用栈与任务队列

### 15.2.1 调用栈（Call Stack）

调用栈是 JavaScript 执行代码的追踪机制——后进先出（LIFO）：

```javascript
function multiply(a, b) {
  return a * b;
}

function square(n) {
  return multiply(n, n);
}

function printSquare(n) {
  const result = square(n);
  console.log(result);
}

printSquare(4);
```

调用栈变化过程：

```
1. printSquare(4) 入栈
2. square(4) 入栈
3. multiply(4, 4) 入栈
4. multiply 返回 16，出栈
5. square 返回 16，出栈
6. console.log(16) 入栈
7. console.log 执行完毕，出栈
8. printSquare 执行完毕，出栈
```

**栈溢出**：当调用栈深度超过限制（浏览器通常 10000+ 层）：

```javascript
function recurse() {
  return recurse(); // 无限递归 → RangeError: Maximum call stack size exceeded
}
recurse();
```

### 15.2.2 任务队列（Task Queue）

任务队列是先进先出（FIFO）的数据结构，存放待执行的异步回调。

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  调用栈       │     │  微任务队列       │     │  宏任务队列    │
│  (Call Stack) │     │  (Microtask)     │     │  (Macrotask)  │
│              │     │                  │     │              │
│  fn1()       │     │  Promise.then    │     │  setTimeout  │
│  fn2()       │     │  MutationObserver│     │  setInterval │
│              │     │  queueMicrotask  │     │  I/O 回调     │
└──────────────┘     └──────────────────┘     └──────────────┘
       ↑                      ↑                       ↑
       │                      │                       │
       └──────────────────────┴───────────────────────┘
                          事件循环调度
```

---

## 15.3 事件循环完整流程

### 15.3.1 一次事件循环迭代

HTML 规范定义的浏览器事件循环一次迭代步骤：

```
1. 从宏任务队列中取出最早的任务
2. 执行该任务（进入调用栈）
3. 调用栈清空后，执行所有微任务：
   a. 取出微任务队列中最早的任务
   b. 执行该任务
   c. 重复直到微任务队列为空
4. 如果需要，执行渲染（requestAnimationFrame 回调在此执行）
5. 回到步骤 1
```

用代码表示：

```javascript
while (true) {
  // 1. 取一个宏任务
  const macroTask = macroTaskQueue.dequeue();
  if (macroTask) {
    execute(macroTask); // 执行宏任务
  }

  // 2. 清空微任务队列
  while (microTaskQueue.length > 0) {
    const microTask = microTaskQueue.dequeue();
    execute(microTask);
  }

  // 3. 渲染（如果需要）
  if (needsRendering) {
    executeAnimationFrames(); // requestAnimationFrame 回调
    render();                 // 布局、绘制
  }
}
```

### 15.3.2 完整执行顺序示例

```javascript
console.log("1: 同步代码开始");

setTimeout(() => {
  console.log("2: setTimeout 宏任务");
}, 0);

Promise.resolve()
  .then(() => {
    console.log("3: Promise.then 微任务 1");
  })
  .then(() => {
    console.log("4: Promise.then 微任务 2");
  });

queueMicrotask(() => {
  console.log("5: queueMicrotask 微任务");
});

console.log("6: 同步代码结束");

// 输出顺序：
// 1: 同步代码开始
// 6: 同步代码结束
// 3: Promise.then 微任务 1
// 5: queueMicrotask 微任务
// 4: Promise.then 微任务 2
// 2: setTimeout 宏任务
```

**解析**：

1. 同步代码执行：输出 `1` 和 `6`
2. 调用栈清空，开始清空微任务队列
3. 执行 Promise.then 微任务 1 → 输出 `3`，同时注册微任务 2
4. 执行 queueMicrotask → 输出 `5`
5. 继续清空微任务：执行微任务 2 → 输出 `4`
6. 微任务队列清空，取下一个宏任务
7. 执行 setTimeout 回调 → 输出 `2`

---

## 15.4 宏任务与微任务

### 15.4.1 宏任务（Macrotask）

| API | 说明 |
|-----|------|
| `setTimeout` / `setInterval` | 定时器 |
| `setImmediate`（Node.js） | 立即执行（下一轮事件循环） |
| I/O 回调 | 网络请求、文件读写完成回调 |
| UI 渲染 | 浏览器渲染 |
| `requestAnimationFrame` | 下一帧渲染前（特殊位置） |
| `MessageChannel` | 消息通道 |
| DOM 事件回调 | click、scroll 等 |

### 15.4.2 微任务（Microtask）

| API | 说明 |
|-----|------|
| `Promise.then/catch/finally` | Promise 链式回调 |
| `queueMicrotask()` | 显式添加微任务 |
| `MutationObserver` | DOM 变动监听回调 |
| `IntersectionObserver` | 元素可见性监听回调（部分浏览器） |
| `process.nextTick`（Node.js） | Node.js 专属，优先级高于微任务 |
| `Object.observe`（已废弃） | 对象变动监听 |

### 15.4.3 微任务优先级

在微任务队列内部，执行顺序就是入队顺序（FIFO）。但有一个重要细节：**微任务中产生的微任务，会在当前微任务队列清空前执行**。

```javascript
console.log("同步开始");

setTimeout(() => console.log("宏任务"), 0);

Promise.resolve()
  .then(() => {
    console.log("微任务 1");
    // 在微任务中产生新的微任务
    Promise.resolve().then(() => {
      console.log("微任务 1 产生的微任务");
    });
  })
  .then(() => {
    console.log("微任务 2");
  });

console.log("同步结束");

// 输出顺序：
// 同步开始
// 同步结束
// 微任务 1
// 微任务 1 产生的微任务
// 微任务 2
// 宏任务
```

**关键规则**：微任务中产生的微任务，仍然在当前宏任务结束后、下一个宏任务开始前全部执行完。

### 15.4.4 微任务饥饿问题

如果微任务不断产生微任务，宏任务将永远得不到执行：

```javascript
// ⚠️ 危险：微任务无限循环，宏任务永远无法执行
function infiniteMicrotask() {
  Promise.resolve().then(() => {
    console.log("微任务执行中...");
    infiniteMicrotask(); // 递归产生微任务
  });
}

infiniteMicrotask();

setTimeout(() => {
  console.log("这行永远不会执行");
}, 0);
```

**实践建议**：不要在微任务中无限递归。如果需要分批处理大量数据，使用 `setTimeout` 让出主线程。

---

## 15.5 Promise 与事件循环

### 15.5.1 Promise 的微任务本质

Promise 的 `.then()`、`.catch()`、`.finally()` 回调都是微任务：

```javascript
const promise = new Promise((resolve) => {
  console.log("1: Promise 构造函数（同步执行）");
  resolve("值");
});

promise.then((value) => {
  console.log("3: then 回调（微任务）", value);
});

console.log("2: 同步代码");

// 输出：1 → 2 → 3
```

**要点**：
- `new Promise(executor)` 中的 `executor` 是**同步执行**的
- `.then()` 注册的回调是**微任务**
- `resolve()` 调用后，`.then()` 回调不会立即执行，而是进入微任务队列

### 15.5.2 Promise 链式调用的执行顺序

```javascript
Promise.resolve()
  .then(() => {
    console.log("A");
    return Promise.resolve("B值");
  })
  .then((v) => {
    console.log(v); // "B值"
  });

Promise.resolve()
  .then(() => {
    console.log("C");
  })
  .then(() => {
    console.log("D");
  });

// 输出顺序：A → C → D → B值
```

**为什么不是 A → B值 → C → D？**

当 `.then()` 回调返回一个 Promise 时，V8 引擎会额外创建两个微任务来处理（规范中的 PromiseResolveThenableJob）。所以 `B值` 的输出被推迟了。

简化规则：
- `.then()` 返回普通值 → 下一个 `.then()` 在下一个微任务执行
- `.then()` 返回 Promise → 需要额外 2 个微任务来解包

### 15.5.3 Promise.resolve 的不同形式

```javascript
// Promise.resolve(普通值) —— 1 个微任务
Promise.resolve(42).then((v) => console.log("普通值:", v));

// Promise.resolve(Promise) —— 不产生额外微任务
const p = Promise.resolve(42);
Promise.resolve(p).then((v) => console.log("已有 Promise:", v));

// Promise.resolve(thenable) —— 2 个微任务
Promise.resolve({
  then(resolve) {
    resolve("thenable 值");
  }
}).then((v) => console.log("thenable:", v));
```

### 15.5.4 async/await 的微任务机制

`async/await` 是 Promise 的语法糖，但执行细节有差异：

```javascript
async function async1() {
  console.log("async1 start");
  await async2();
  console.log("async1 end"); // 等同于 .then() 回调
}

async function async2() {
  console.log("async2");
}

console.log("script start");

setTimeout(() => {
  console.log("setTimeout");
}, 0);

async1();

new Promise((resolve) => {
  console.log("promise1");
  resolve();
}).then(() => {
  console.log("promise2");
});

console.log("script end");

// 输出顺序：
// script start
// async1 start
// async2
// promise1
// script end
// async1 end    ← await 后面的代码是微任务
// promise2
// setTimeout
```

**关键理解**：

1. `await` 后面的表达式同步执行
2. `await` 后面的代码被包装成微任务（等同于 `.then()`）
3. 不同引擎的微任务插入时机有细微差异（V8 7.2+ 做了优化）

### 15.5.5 await 的执行细节（V8 优化前后）

**V8 7.2 之前**（旧版行为）：

```javascript
async function foo() {
  const result = await promise;
  // 等同于：
  // promise.then(result => { ... })
  // 但会创建一个额外的 Promise 和 2 个微任务
}
```

**V8 7.2+ 之后**（优化行为）：

```javascript
async function foo() {
  const result = await promise;
  // 优化后：直接复用外层 Promise
  // 只需要 1 个微任务（而不是 2 个）
}
```

这意味着在较新的浏览器/Node.js 中，`await` 后面的代码比 `.then()` 回调更早执行：

```javascript
async function asyncFn() {
  await Promise.resolve();
  console.log("asyncFn");
}

function promiseFn() {
  Promise.resolve().then(() => {
    console.log("promiseFn");
  });
}

asyncFn();
promiseFn();

// V8 7.2+ 输出：asyncFn → promiseFn
// V8 7.2 之前输出：promiseFn → asyncFn
```

---

## 15.6 requestAnimationFrame 与事件循环

### 15.6.1 rAF 的执行时机

`requestAnimationFrame` 的回调在微任务之后、渲染之前执行：

```
┌─────────────────────────────────────────────┐
│              一次事件循环                      │
│                                             │
│  1. 执行一个宏任务                            │
│  2. 清空所有微任务                            │
│  3. 执行 requestAnimationFrame 回调  ←─── 这里 │
│  4. 渲染（布局 → 绘制 → 合成）                │
│  5. 回到步骤 1                               │
└─────────────────────────────────────────────┘
```

```javascript
console.log("同步代码");

setTimeout(() => console.log("setTimeout"), 0);

Promise.resolve().then(() => console.log("Promise"));

requestAnimationFrame(() => console.log("rAF"));

// 输出顺序：
// 同步代码 → Promise → setTimeout → rAF
// 注意：rAF 可能在 setTimeout 之前或之后，取决于是否在渲染帧内
```

### 15.6.2 rAF 与 setTimeout 的区别

```javascript
// setTimeout(fn, 0) —— 不保证与屏幕刷新同步
// 在 60Hz 屏幕上，一帧约 16.67ms
// setTimeout 可能在一帧内执行多次，或跳帧

// requestAnimationFrame —— 保证每帧只执行一次
let lastTime = 0;
function animate(currentTime) {
  const delta = currentTime - lastTime;
  console.log(`帧间隔: ${delta.toFixed(2)}ms`);
  lastTime = currentTime;
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
```

### 15.6.3 rAF 的正确使用模式

```javascript
// ✅ 正确：在 rAF 中读取布局信息，在 rAF 中修改样式
function smoothScroll(element, target) {
  const current = element.scrollTop;
  const distance = target - current;
  const duration = 300;
  const start = performance.now();

  function step(timestamp) {
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / duration, 1);
    // 缓动函数
    const eased = 1 - Math.pow(1 - progress, 3);
    element.scrollTop = current + distance * eased;

    if (progress < 1) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

// ❌ 错误：在 setTimeout 中做动画
// 会导致掉帧、不流畅
function badAnimation() {
  setInterval(() => {
    element.style.left = parseInt(element.style.left) + 1 + "px";
  }, 16); // 不精确的 16ms
}
```

---

## 15.7 定时器深度解析

### 15.7.1 setTimeout 的最小延迟

```javascript
// HTML5 规范：setTimeout 最小延迟为 4ms（嵌套超过 5 层时）
// 但在未激活的标签页中，最小延迟变为 1000ms

let start = performance.now();

setTimeout(() => {
  console.log(`实际延迟: ${(performance.now() - start).toFixed(2)}ms`);
}, 0);

// 活跃标签页：实际延迟约 0~4ms
// 后台标签页：实际延迟约 1000ms
```

### 15.7.2 定时器嵌套与 4ms 限制

```javascript
// 嵌套 setTimeout 的延迟变化
function measureDelay(depth = 0) {
  const start = performance.now();
  setTimeout(() => {
    const delay = performance.now() - start;
    console.log(`深度 ${depth}: 延迟 ${delay.toFixed(2)}ms`);
    if (depth < 10) {
      measureDelay(depth + 1);
    }
  }, 0);
}

measureDelay();
// 深度 0: 延迟 0.5ms   ← 第一次接近 0ms
// 深度 1: 延迟 0.8ms
// 深度 2: 延迟 1.2ms
// 深度 3: 延迟 2.0ms
// 深度 4: 延迟 3.5ms
// 深度 5: 延迟 4.2ms   ← 超过 5 层后，最小延迟变为 4ms
// 深度 6: 延迟 4.1ms
// ...
```

### 15.7.3 setInterval 的累积漂移

```javascript
// setInterval 的漂移问题
// 每次回调执行时间会累加到间隔上

// ❌ 有漂移
setInterval(() => {
  doSomethingThatTakes5ms(); // 执行 5ms
  // 实际间隔：10ms（设定）+ 5ms（执行）= 15ms？
  // 不，setInterval 会尝试追赶，但如果执行时间 > 间隔，会连续触发
}, 10);

// ✅ 无漂移：用 setTimeout 递归
function scheduleAtFixedRate(interval) {
  const start = performance.now();

  function tick() {
    doSomethingThatTakes5ms();
    const elapsed = performance.now() - start;
    const delay = Math.max(0, interval - (elapsed % interval));
    setTimeout(tick, delay);
  }

  setTimeout(tick, interval);
}
```

### 15.7.4 用 MessageChannel 实现比 setTimeout(fn, 0) 更快的延迟

```javascript
// MessageChannel 的回调是宏任务，但不受 4ms 最小延迟限制
function fasterSetTimeout(callback) {
  const channel = new MessageChannel();
  channel.port1.onmessage = callback;
  channel.port2.postMessage(null);
}

// 对比
const start = performance.now();

setTimeout(() => {
  console.log(`setTimeout: ${(performance.now() - start).toFixed(2)}ms`);
}, 0);

fasterSetTimeout(() => {
  console.log(`MessageChannel: ${(performance.now() - start).toFixed(2)}ms`);
});

// MessageChannel: 0.20ms  ← 更快
// setTimeout: 4.10ms       ← 受 4ms 限制
```

---

## 15.8 经典面试题解析

### 15.8.1 综合执行顺序

```javascript
console.log("1");

setTimeout(() => {
  console.log("2");
  Promise.resolve().then(() => {
    console.log("3");
  });
}, 0);

Promise.resolve()
  .then(() => {
    console.log("4");
    setTimeout(() => {
      console.log("5");
    }, 0);
  })
  .then(() => {
    console.log("6");
  });

console.log("7");

// 输出：1 → 7 → 4 → 6 → 2 → 3 → 5
```

**解析**：

1. 同步代码：`1`、`7`
2. 微任务队列：执行 `.then()` → `4`，注册 `setTimeout(5)`，注册 `.then(6)`
3. 继续微任务：`6`
4. 微任务队列清空，取宏任务 `setTimeout(2)`
5. 执行 `2`，注册微任务 `.then(3)`
6. 清空微任务：`3`
7. 取宏任务 `setTimeout(5)`：`5`

### 15.8.2 async/await 与 Promise 混合

```javascript
async function async1() {
  console.log("async1 start");
  await async2();
  console.log("async1 end");
}

async function async2() {
  console.log("async2");
}

console.log("script start");

setTimeout(() => {
  console.log("setTimeout");
}, 0);

async1();

new Promise((resolve) => {
  console.log("promise1");
  resolve();
}).then(() => {
  console.log("promise2");
});

console.log("script end");

// 输出顺序：
// script start
// async1 start
// async2
// promise1
// script end
// async1 end    ← await 后的代码是微任务
// promise2
// setTimeout
```

### 15.8.3 多层 Promise 嵌套

```javascript
new Promise((resolve) => {
  console.log(1);
  resolve();
})
  .then(() => {
    console.log(2);
    return new Promise((resolve) => {
      console.log(3);
      resolve();
    }).then(() => {
      console.log(4);
    });
  })
  .then(() => {
    console.log(5);
  });

new Promise((resolve) => {
  console.log(6);
  resolve();
})
  .then(() => {
    console.log(7);
  })
  .then(() => {
    console.log(8);
  });

// 输出：1 → 6 → 2 → 7 → 3 → 8 → 4 → 5
```

**解析**：

1. 同步：`1`、`6`
2. 微任务第一轮：`2`、`7`
3. `2` 返回了新 Promise，需要额外微任务解包
4. 微任务第二轮：`3`、`8`
5. 微任务第三轮：`4`
6. 微任务第四轮：`5`

### 15.8.4 async 函数中的错误处理

```javascript
async function errorExample() {
  try {
    const result = await Promise.reject("错误");
    console.log("不会执行");
  } catch (e) {
    console.log("捕获:", e); // 捕获: 错误
  }
}

// 等价于
function errorExampleEquivalent() {
  return Promise.reject("错误")
    .then((result) => {
      console.log("不会执行");
    })
    .catch((e) => {
      console.log("捕获:", e);
    });
}
```

### 15.8.5 微任务中的同步代码阻塞

```javascript
// ⚠️ 微任务中的死循环会阻塞渲染
function blockRendering() {
  Promise.resolve().then(function loop() {
    // 这会阻塞所有宏任务和渲染
    // while(true) {} // 危险！
    
    // 正确做法：分批处理，让出主线程
    processBatch();
    if (hasMore()) {
      setTimeout(loop, 0); // 用宏任务让出主线程
    }
  });
}
```

---

## 15.9 MutationObserver 与事件循环

### 15.9.1 MutationObserver 的执行时机

`MutationObserver` 回调是微任务，在当前宏任务结束后、渲染之前执行：

```javascript
const target = document.getElementById("container");
const observer = new MutationObserver((mutations) => {
  console.log("MutationObserver 回调（微任务）");
  mutations.forEach((mutation) => {
    console.log(`变更类型: ${mutation.type}`);
  });
});

observer.observe(target, { childList: true, subtree: true });

// 同步修改 DOM
target.appendChild(document.createElement("div"));
console.log("同步代码");

// 微任务中修改 DOM
Promise.resolve().then(() => {
  target.appendChild(document.createElement("span"));
  console.log("微任务中修改 DOM");
});

// 输出顺序：
// 同步代码
// MutationObserver 回调（微任务）—— 处理 div 的变更
// 微任务中修改 DOM
// MutationObserver 回调（微任务）—— 处理 span 的变更
```

**重要**：MutationObserver 会批量收集变更，在微任务时机统一触发回调。

### 15.9.2 MutationObserver vs 旧 API

```javascript
// ❌ 已废弃：Mutation Events（同步触发，性能差）
target.addEventListener("DOMNodeInserted", (e) => {
  // 每次插入都同步触发，严重性能问题
});

// ✅ 推荐：MutationObserver（微任务，批量处理）
const observer = new MutationObserver((mutations) => {
  // 批量处理所有变更
  for (const mutation of mutations) {
    // 处理变更
  }
});
observer.observe(target, {
  childList: true,
  attributes: true,
  characterData: true,
  subtree: true,
});
```

---

## 15.10 IntersectionObserver 与事件循环

### 15.10.1 执行时机

`IntersectionObserver` 的回调在微任务之后、渲染之前执行（与 `requestAnimationFrame` 类似但更早）：

```javascript
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        console.log("元素进入视口:", entry.target);
      }
    });
  },
  { threshold: 0.5 }
);

document.querySelectorAll(".lazy-image").forEach((img) => {
  observer.observe(img);
});
```

### 15.10.2 懒加载实现

```javascript
function createLazyLoader() {
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.classList.remove("lazy");
          obs.unobserve(img); // 加载后停止观察
        }
      });
    },
    { rootMargin: "200px" } // 提前 200px 开始加载
  );

  return {
    observe: (img) => observer.observe(img),
    disconnect: () => observer.disconnect(),
  };
}
```

---

## 15.11 事件循环与性能

### 15.11.1 长任务检测

```javascript
// 使用 PerformanceObserver 检测长任务（超过 50ms）
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.warn(
      `长任务检测: ${entry.duration.toFixed(2)}ms`,
      `开始时间: ${entry.startTime.toFixed(2)}ms`,
      `类型: ${entry.name}`
    );
  }
});

observer.observe({ type: "longtask", buffered: true });
```

### 15.11.2 分片执行避免阻塞

```javascript
// ❌ 阻塞主线程
function processLargeArray(items) {
  for (const item of items) {
    heavyProcess(item); // 如果 items 有 10000 个，主线程卡死
  }
}

// ✅ 分片执行——每帧处理一批
function processInChunks(items, chunkSize = 50) {
  let index = 0;

  function processChunk() {
    const end = Math.min(index + chunkSize, items.length);
    for (let i = index; i < end; i++) {
      heavyProcess(items[i]);
    }
    index = end;

    if (index < items.length) {
      // 让出主线程，下一帧继续
      requestAnimationFrame(processChunk);
    } else {
      console.log("处理完成");
    }
  }

  requestAnimationFrame(processChunk);
}

// ✅ 使用 scheduler API（现代浏览器）
async function processWithScheduler(items) {
  for (const item of items) {
    heavyProcess(item);
    // 让出主线程，允许处理用户输入等更高优先级任务
    await scheduler.yield();
  }
}
```

### 15.11.3 requestIdleCallback

```javascript
// 在浏览器空闲时执行低优先级任务
function processIdleTasks(tasks) {
  function processTask(deadline) {
    // deadline.timeRemaining() 返回剩余空闲时间（毫秒）
    while (deadline.timeRemaining() > 0 && tasks.length > 0) {
      const task = tasks.shift();
      task();
    }

    if (tasks.length > 0) {
      requestIdleCallback(processTask);
    }
  }

  requestIdleCallback(processTask);
}

// 使用示例：预加载非关键资源
requestIdleCallback((deadline) => {
  while (deadline.timeRemaining() > 5 && hasMoreToPreload()) {
    preloadNextResource();
  }
});
```

### 15.11.4 Scheduler API（现代方案）

```javascript
// 新的 Scheduler API —— 更精细的任务优先级控制
// 优先级从高到低：user-blocking > user-visible > background

// 高优先级任务（如用户交互响应）
scheduler.postTask(() => {
  updateUI();
}, { priority: "user-blocking" });

// 中优先级任务（如数据加载）
scheduler.postTask(() => {
  fetchData();
}, { priority: "user-visible" });

// 低优先级任务（如分析上报）
scheduler.postTask(() => {
  sendAnalytics();
}, { priority: "background" });

// 让出主线程
async function longTask() {
  for (const item of largeList) {
    processItem(item);
    await scheduler.yield(); // 让出主线程
  }
}
```

---

## 15.12 Web Workers 与事件循环

### 15.12.1 Web Worker 的独立事件循环

每个 Web Worker 有自己独立的事件循环，不会阻塞主线程：

```javascript
// main.js
const worker = new Worker("worker.js");

worker.onmessage = (e) => {
  console.log("主线程收到结果:", e.data);
};

worker.postMessage({ type: "compute", data: largeArray });

// worker.js
self.onmessage = (e) => {
  if (e.data.type === "compute") {
    // 耗时计算在 Worker 线程中执行，不阻塞主线程
    const result = heavyComputation(e.data.data);
    self.postMessage(result);
  }
};
```

### 15.12.2 SharedArrayBuffer 与 Atomics

```javascript
// 主线程
const sharedBuffer = new SharedArrayBuffer(4);
const sharedArray = new Int32Array(sharedBuffer);

const worker = new Worker("worker.js");
worker.postMessage({ buffer: sharedBuffer });

// 等待 Worker 通知
Atomics.wait(sharedArray, 0, 0); // 阻塞直到 sharedArray[0] !== 0
console.log("Worker 完成，结果:", sharedArray[0]);

// worker.js
self.onmessage = (e) => {
  const array = new Int32Array(e.data.buffer);
  // 执行计算
  const result = compute();
  array[0] = result;
  Atomics.notify(array, 0); // 通知主线程
};
```

---

## 15.13 事件循环可视化总结

```
┌──────────────────────────────────────────────────────────────┐
│                     浏览器事件循环                              │
│                                                              │
│  ┌─────────────┐                                             │
│  │  宏任务队列   │ ← setTimeout, setInterval, I/O, UI 事件     │
│  │  (FIFO)     │                                             │
│  └──────┬──────┘                                             │
│         │ 取一个任务                                          │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │  执行宏任务   │ ← 同步代码在此执行                           │
│  └──────┬──────┘                                             │
│         │ 宏任务执行完毕                                        │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │ 清空微任务队列 │ ← Promise.then, MutationObserver,           │
│  │  (全部执行)   │    queueMicrotask                          │
│  └──────┬──────┘                                             │
│         │ 微任务清空                                           │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │  rAF 回调    │ ← requestAnimationFrame                     │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │   渲染       │ ← 布局 → 绘制 → 合成                        │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│    回到宏任务队列 ←──────────────────────────────────────────┘
│
│  关键规则：
│  1. 每次只取一个宏任务
│  2. 宏任务后清空所有微任务（包括微任务中产生的微任务）
│  3. 微任务清空后才可能渲染
│  4. rAF 在渲染前执行
│  5. 微任务中无限产生微任务会饿死宏任务
└──────────────────────────────────────────────────────────────┘
```

---

## 小结

| 概念 | 执行时机 | 特点 |
|------|---------|------|
| 同步代码 | 立即 | 阻塞主线程 |
| 宏任务 | 下一轮事件循环 | setTimeout、I/O、UI 事件 |
| 微任务 | 当前宏任务后、渲染前 | Promise、MutationObserver |
| rAF | 微任务后、渲染前 | 每帧一次，适合动画 |
| rIC | 浏览器空闲时 | 低优先级任务 |
| Web Worker | 独立线程 | 不阻塞主线程 |

| 常见陷阱 | 说明 |
|---------|------|
| 微任务饥饿 | 微任务无限递归会阻塞宏任务 |
| setTimeout 最小延迟 | 嵌套 5 层后最小 4ms，后台标签 1s |
| setInterval 漂移 | 回调执行时间会累积 |
| Promise 返回 Promise | 额外 2 个微任务解包 |
| await 优化差异 | V8 7.2+ 前后行为不同 |