# 第1章 并发编程深入

> 目标读者：已掌握 Go 基础语法的开发者，跳过入门内容，聚焦高级实践。

---

## 1. Goroutine 调度模型

### 1.1 GMP 模型原理

Go 的运行时调度器实现了 **GMP** 模型，三个核心概念：

| 组件 | 全称 | 说明 |
|------|------|------|
| **G** | Goroutine | 轻量级线程，包含栈、上下文、状态 |
| **M** | Machine | 操作系统线程（OS thread），由内核调度 |
| **P** | Processor | 逻辑处理器，控制并发度（GOMAXPROCS） |

**关系图解**（逻辑结构）：

```
OS Thread (M1) ── P1 ── [G1 → G2 → G3 → ...]   // 本地队列
                    \
OS Thread (M2) ── P2 ── [G4 → G5 → ...]
                    /
         全局队列: [G7 → G8 → G9 → ...]
```

- **P 的数量** = `GOMAXPROCS`（默认 = CPU 核数），决定真正的并行度。
- **每个 P** 持有本地 goroutine 队列（LRQ）。
- **全局队列**（GRQ）存放尚未分配给 P 的 G。
- **M** 必须绑定 P 才能执行 G；M 阻塞时会创建或复用新的 M。

### 1.2 调度时机

**Hand Off（移交）**：当 M 因为 syscall（如文件 IO、网络 IO）阻塞时，P 会将当前 M 剥离，并绑定到另一个空闲 M（或新建 M），保证 P 不闲置。

```
M1（阻塞在 syscall） → P 被摘下 → 绑定 M2 → M2 执行 LRQ 中下一个 G
```

**Work Stealing（工作窃取）**：当某个 P 的本地队列为空时，它会：
1. 优先从全局队列偷取 G。
2. 若全局队列为空，随机从其他 P 的 LRQ **偷一半** G 过来。

```go
// 展示 work stealing 的效果：所有 P 最终都能负载均衡
func ExampleWorkStealing() {
    runtime.GOMAXPROCS(4)
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(n int) {
            defer wg.Done()
            time.Sleep(time.Millisecond) // 模拟短任务
        }(i)
    }
    wg.Wait()
}
```

### 1.3 为什么 Goroutine 轻量？

| 对比项 | OS 线程 | Goroutine |
|--------|---------|-----------|
| 栈初始大小 | ~1–8 MB | 2 KB（可动态增长至 1 GB） |
| 创建成本 | 系统调用，μs 级 | 用户态，ns 级 |
| 上下文切换 | 内核态（~μs） | 用户态（~几十 ns） |
| 调度器 | 内核调度 | Go runtime 协作式调度 |

调度的核心：当 G 遇到 `channel` 操作、`time.Sleep`、`syscall`、`runtime.Gosched()` 时，Go 调度器主动介入，**协作式**地切换 G，而非依赖内核时间片抢占。

---

## 2. Channel 进阶

### 2.1 有缓冲 vs 无缓冲

```go
// 无缓冲 channel：同步通信，发送方阻塞直到接收方就绪
func unbuffered() {
    ch := make(chan int)
    go func() {
        ch <- 42 // 阻塞，直到 main 接收
    }()
    val := <-ch // 接收，解除发送方阻塞
    fmt.Println(val)
}

// 有缓冲 channel：异步通信，发送方只有在缓冲满时才阻塞
func buffered() {
    ch := make(chan int, 3)
    ch <- 1 // 不阻塞
    ch <- 2 // 不阻塞
    ch <- 3 // 不阻塞
    // ch <- 4 // 这里会阻塞，缓冲已满
    fmt.Println(<-ch, <-ch, <-ch)
}
```

**选择准则**：
- **无缓冲**：用于 goroutine 间的同步信号、严格交替执行。
- **有缓冲**：用于解耦生产/消费速率、批量处理。缓冲大小需压测，不宜拍脑袋。

### 2.2 单向 Channel

函数签名中使用单向 channel 约束行为，提升类型安全：

```go
// 只读 <-chan
func consumer(in <-chan int) {
    for v := range in {
        fmt.Println("consume:", v)
    }
}

// 只写 chan<-
func producer(out chan<- int) {
    for i := 0; i < 5; i++ {
        out <- i
    }
    close(out)
}

func main() {
    ch := make(chan int, 3)
    go producer(ch) // 隐式转换 chan int → chan<- int
    consumer(ch)    // 隐式转换 chan int → <-chan int
}
```

双向 channel 可隐式转换为单向，反之不行。这能防止误写误读。

### 2.3 关闭 Channel 的正确姿势

**原则**：**只在发送方关闭 channel**，从已关闭的 channel 接收永远不会阻塞且立即返回零值。

```go
// 安全的关闭模式
func safeClose() {
    ch := make(chan int)
    go func() {
        defer close(ch) // 发送方负责关闭
        for i := 0; i < 3; i++ {
            ch <- i
        }
    }()
    for v := range ch { // range 自动检测关闭
        fmt.Println(v)
    }
}

// 多方发送 —— 使用 sync.Once 确保只关闭一次
type safeChan struct {
    once sync.Once
    ch   chan int
}

func (s *safeChan) Close() {
    s.once.Do(func() {
        close(s.ch)
    })
}
```

**注意**：向已关闭的 channel 发送数据会 **panic**。永远不要在接收方关闭 channel。

### 2.4 select 多路复用

```go
func selectDemo() {
    ch1 := make(chan string, 1)
    ch2 := make(chan string, 1)

    go func() { time.Sleep(100 * time.Millisecond); ch1 <- "slow" }()
    go func() { time.Sleep(10 * time.Millisecond); ch2 <- "fast" }()

    select {
    case msg := <-ch1:
        fmt.Println("ch1:", msg)
    case msg := <-ch2:
        fmt.Println("ch2:", msg) // 大概率走这里
    case <-time.After(200 * time.Millisecond):
        fmt.Println("timeout")
    default:
        fmt.Println("no one ready") // 非阻塞
    }
}
```

**重要语义**：
- `select` 随机选择一个可用的 case（所有 case 同时就绪时）。
- 没有 `default` 且所有 case 阻塞时，`select` **永久阻塞**。
- `time.After` 会产生泄漏（timer 未回收），密集调用应使用 `time.NewTimer`。

### 2.5 nil Channel 的妙用

nil channel 永远阻塞，在 select 中可以动态启用/禁用分支：

```go
func nilChannelDemo() {
    in := make(chan int, 2)
    in <- 1
    in <- 2
    close(in)

    var out chan<- int         // nil channel
    var val int
    var ok bool

    for {
        select {
        case val, ok = <-in:
            if !ok {
                in = nil         // 禁用 in 分支
                out = make(chan int, 2) // 启用 out 分支
                continue
            }
            fmt.Println("读:", val)
        case out <- val:
            // 写入成功
        }
        // 当 in 和 out 都变为 nil 时，退出循环
        if in == nil && out == nil {
            break
        }
    }
}
```

常见用途：将 channel 设为 nil 来屏蔽 select 分支，实现状态的动态切换。

---

## 3. Context 深入

### 3.1 核心接口

```go
type Context interface {
    Deadline() (deadline time.Time, ok bool)
    Done() <-chan struct{}
    Err() error
    Value(key any) any
}
```

- `Done()` 返回一个 channel，取消时关闭。
- `Err()` 返回取消原因：`context.Canceled` 或 `context.DeadlineExceeded`。

### 3.2 withCancel / withTimeout / withValue

```go
func contextDemo() {
    // --- WithCancel ---
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        time.Sleep(50 * time.Millisecond)
        cancel() // 手动取消
    }()
    <-ctx.Done()
    fmt.Println("canceled:", ctx.Err()) // context.Canceled

    // --- WithTimeout ---
    ctx2, cancel2 := context.WithTimeout(context.Background(), 100*time.Millisecond)
    defer cancel2() // 及时释放资源，即使超时也要调
    <-ctx2.Done()
    fmt.Println("timeout:", ctx2.Err()) // context.DeadlineExceeded

    // --- WithValue ---
    ctx3 := context.WithValue(context.Background(), "key", "value")
    fmt.Println(ctx3.Value("key")) // value
}
```

### 3.3 传递规范 & 常见陷阱

**规范**：
- `context.Context` 必须是函数签名的 **第一个参数**，通常命名为 `ctx`。
- 不存结构体字段，而是通过函数参数传递。
- 只传 **请求级数据**（trace id、auth token），不传可选参数。

**陷阱**：

```go
// ❌ 陷阱1：不 defer cancel 导致资源泄漏
func leak() {
    ctx, cancel := context.WithCancel(context.Background())
    go func() {
        <-ctx.Done() // 如果函数返回了但没人 cancel，这个 G 永远不退出
    }()
    _ = cancel // 忘记调 cancel
    // 函数返回时 cancel 从未被调用
}

// ✅ 正确做法
func noLeak() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // 确保任何路径都调用
    go func() {
        <-ctx.Done()
    }()
}

// ❌ 陷阱2：把 WithValue 当作全局配置传递
func badValue() {
    ctx := context.WithValue(context.Background(), "db", dbConn)
    // 不推荐 —— 类型不安全且不透明
}

// ❌ 陷阱3：context 超时后继续执行
func notRespectCtx(ctx context.Context) {
    select {
    case <-ctx.Done():
        return // 必须检查并返回
    case <-time.After(1 * time.Second):
        // 如果已经超时，这里仍然可能执行！
    }
}
```

---

## 4. sync 包详解

### 4.1 Mutex vs RWMutex

| 场景 | 推荐 |
|------|------|
| 读写比例接近，或写频繁 | `sync.Mutex` |
| 读远多于写（≥10:1） | `sync.RWMutex` |

```go
type safeCounter struct {
    mu    sync.RWMutex
    value int
}

func (c *safeCounter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.value++
}

func (c *safeCounter) Value() int {
    c.mu.RLock()         // 读锁允许多个并发读
    defer c.mu.RUnlock()
    return c.value
}
```

**注意**：`RWMutex` 在写锁被阻塞时，会阻止新的读锁（防止写饥饿）。Go 1.8+ 的 `RWMutex` 已优化读写公平性。

### 4.2 sync.Map 的使用场景

`sync.Map` 仅在以下场景比 `map+Mutex` 快：
1. **读多写少**，且 key 访问呈现热点分布。
2. **写和读并发的 goroutine 数量较多**。
3. 合并写（多次修改同一个 key）的场景。

```go
func syncMapDemo() {
    var m sync.Map

    // 写
    m.Store("key1", 42)
    m.Store("key2", "hello")

    // 读
    if val, ok := m.Load("key1"); ok {
        fmt.Println(val)
    }

    // 不存在则写
    actual, loaded := m.LoadOrStore("key3", "new")
    fmt.Println(loaded, actual) // false, "new"

    // 遍历
    m.Range(func(key, value any) bool {
        fmt.Println(key, value)
        return true // 返回 false 则停止遍历
    })
}
```

**不适合**：写频繁、key 分布离散度高、value 大量变动的场景。这种情况下 `map + sync.Mutex` 更优。

### 4.3 sync.Once 正确用法

确保一段代码只执行一次，常用于单例初始化：

```go
type singleton struct{}

var (
    instance *singleton
    once     sync.Once
)

func GetInstance() *singleton {
    once.Do(func() {
        instance = &singleton{}
        fmt.Println("created once")
    })
    return instance
}
```

**陷阱**：`once.Do` 内部的 `panic` 或死锁会导致 `once` 标记为已执行，后续不再执行。

```go
func oncePanic() {
    var once sync.Once
    once.Do(func() {
        panic("oops")
    })
    // once.Do 不会再次执行，即使上次 panic 了
}
```

### 4.4 sync.Pool 对象复用

用于缓存临时对象，减少 GC 压力。注意 Pool 中的对象**随时可能被 GC 回收**。

```go
type buffer struct {
    buf []byte
}

var bufPool = sync.Pool{
    New: func() any {
        return &buffer{buf: make([]byte, 0, 1024)}
    },
}

func getBuffer() *buffer {
    return bufPool.Get().(*buffer)
}

func putBuffer(b *buffer) {
    b.buf = b.buf[:0] // 重置但不释放底层数组
    bufPool.Put(b)
}

func poolDemo() {
    b := getBuffer()
    b.buf = append(b.buf, "hello"...)
    putBuffer(b)
}
```

**适用场景**：高频创建和销毁的对象（json 序列化缓冲、protobuf 复用、连接池元数据）。不适用于需要持久化的对象。

### 4.5 sync.WaitGroup

```go
func waitGroupDemo() {
    const N = 5
    var wg sync.WaitGroup

    for i := 0; i < N; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            fmt.Println("work", id)
        }(i)
    }
    wg.Wait()
    fmt.Println("all done")
}
```

**注意**：
- `wg.Add` 必须在 `go` 之前调用，否则可能 `Wait` 提前返回。
- `wg.Done` 在 goroutine 中务必 `defer` 调用，防止 panic 导致计数泄漏。
- `wg.Wait` 可被多个 goroutine 同时等待。

### 4.6 sync.Cond

用于 goroutine 等待某个条件成立，比 channel 更适合 **多次通知 / 广播** 场景：

```go
type queue struct {
    items []int
    cond  *sync.Cond
}

func newQueue() *queue {
    return &queue{
        cond: sync.NewCond(&sync.Mutex{}),
    }
}

func (q *queue) Put(item int) {
    q.cond.L.Lock()
    defer q.cond.L.Unlock()
    q.items = append(q.items, item)
    q.cond.Signal() // 唤醒一个等待者
}

func (q *queue) Get() int {
    q.cond.L.Lock()
    defer q.cond.L.Unlock()
    for len(q.items) == 0 {
        q.cond.Wait() // 释放锁并等待
    }
    item := q.items[0]
    q.items = q.items[1:]
    return item
}

func condDemo() {
    q := newQueue()
    go func() { time.Sleep(10 * time.Millisecond); q.Put(1) }()
    fmt.Println(q.Get()) // 1
}
```

**关键**：
- `Wait()` **必须在 Lock 之后调用**，内部会释放锁，被唤醒时重新获取锁。
- 使用 `for` 而非 `if` 检查条件（防止虚假唤醒）。
- `Signal()` 唤醒一个 goroutine，`Broadcast()` 唤醒所有。

---

## 5. 并发模式

### 5.1 Fan-in / Fan-out

**Fan-out**：多个 goroutine 从同一个 channel 读取（分散处理）。
**Fan-in**：多个 channel 合并到一个 channel（汇总结果）。

```go
func fanInFanOut() {
    // Fan-out: 多个 worker 消费同一 channel
    jobs := make(chan int, 100)
    var wg sync.WaitGroup

    for w := 0; w < 3; w++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := range jobs {
                fmt.Printf("worker %d processing job %d\n", id, j)
            }
        }(w)
    }

    for j := 0; j < 10; j++ {
        jobs <- j
    }
    close(jobs)
    wg.Wait()

    // Fan-in: 合并多个结果 channel
    ch1 := make(chan int, 1)
    ch2 := make(chan int, 1)
    ch1 <- 1
    ch2 <- 2

    merged := make(chan int)
    go func() {
        for v := range ch1 {
            merged <- v
        }
    }()
    go func() {
        for v := range ch2 {
            merged <- v
        }
    }()

    // 实际 fan-in 需要使用 sync.WaitGroup 或 channel 合并
    // 更简洁的方式用 reflect.Select 或者 goroutine + wg
}
```

### 5.2 Worker Pool

控制并发数，避免资源耗尽：

```go
func workerPool(numWorkers int, jobs <-chan int, results chan<- int) {
    var wg sync.WaitGroup
    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for job := range jobs {
                results <- job * 2 // 模拟处理
            }
        }()
    }
    wg.Wait()
    close(results)
}

func workerPoolDemo() {
    const numJobs = 50
    jobs := make(chan int, numJobs)
    results := make(chan int, numJobs)

    go workerPool(3, jobs, results) // 3 个 worker

    for j := 0; j < numJobs; j++ {
        jobs <- j
    }
    close(jobs)

    for r := range results {
        _ = r
    }
}
```

### 5.3 Pipeline

每个阶段是一个 channel 操作，组合成处理流水线：

```go
func gen(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        for _, n := range nums {
            out <- n
        }
        close(out)
    }()
    return out
}

func sq(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for n := range in {
            out <- n * n
        }
        close(out)
    }()
    return out
}

func pipelineDemo() {
    // 输出: 1, 4, 9, 16, 25
    for v := range sq(sq(gen(1, 2, 3, 4, 5))) {
        fmt.Println(v)
    }
}
```

### 5.4 Tee 模式

将一个 channel 的数据复制到两个下游：

```go
func tee(in <-chan int) (_, _ <-chan int) {
    out1 := make(chan int)
    out2 := make(chan int)
    go func() {
        defer close(out1)
        defer close(out2)
        for v := range in {
            out1 <- v
            out2 <- v
        }
    }()
    return out1, out2
}

func teeDemo() {
    in := make(chan int)
    go func() {
        for i := 0; i < 5; i++ {
            in <- i
        }
        close(in)
    }()
    a, b := tee(in)
    for v := range a {
        fmt.Println("a:", v, "b:", <-b)
    }
}
```

### 5.5 Rate Limiting

使用 channel 做令牌桶实现限流：

```go
func rateLimit() {
    rate := time.Second / 10 // 每秒 10 个
    tick := time.NewTicker(rate)
    defer tick.Stop()

    requests := make(chan int, 50)
    for i := 0; i < 50; i++ {
        requests <- i
    }
    close(requests)

    for req := range requests {
        <-tick.C // 每次消费一个令牌
        fmt.Println("process", req, time.Now())
    }
}

// 突发限流（允许 burst）
func burstLimit() {
    const rate = 3
    burst := make(chan struct{}, rate)
    for i := 0; i < rate; i++ {
        burst <- struct{}{} // 初始填满令牌
    }

    go func() {
        tick := time.NewTicker(100 * time.Millisecond)
        defer tick.Stop()
        for range tick.C {
            select {
            case burst <- struct{}{}: // 定期补充
            default: // 桶满则丢弃
            }
        }
   }()

    for i := 0; i < 10; i++ {
        <-burst // 消费令牌
        fmt.Println("burst req", i)
    }
}
```

### 5.6 Graceful Shutdown

优雅关闭：监听退出信号，逐层取消 goroutine：

```go
func gracefulShutdown() {
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    // 启动 worker
    ch := make(chan int)
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for {
            select {
            case <-ctx.Done():
                fmt.Println("worker: shutting down")
                return
            case v, ok := <-ch:
                if !ok {
                    return
                }
                fmt.Println("process:", v)
            }
        }
    }()

    // 模拟发送任务
    for i := 0; i < 5; i++ {
        ch <- i
    }
    close(ch)

    <-ctx.Done() // 等待信号
    fmt.Println("main: received signal")
    stop() // 通知子 context 结束
    wg.Wait()
    fmt.Println("all goroutines exited")
}
```

---

## 6. 竞态检测与数据竞争

### 6.1 Race Detector 的使用

Go 内置竞态检测器，只需在 `go run/test/build` 时加 `-race` 参数：

```bash
go run -race main.go
go test -race ./...
go build -race -o myapp .
```

**运行时开销**：CPU ~5–10x，内存 ~2–3x，建议在 CI 中持续启用。

### 6.2 常见竞态场景

```go
// 场景1：未同步的 map 并发读写
func mapRace() {
    m := make(map[int]int)
    go func() { for i := 0; i < 1000; i++ { m[i] = i } }()
    go func() { for i := 0; i < 1000; i++ { _ = m[i] } }() // ⚠️ 触发 race
}

// 场景2：多个 goroutine 写同一个变量（无锁）
func varRace() {
    var counter int
    for i := 0; i < 100; i++ {
        go func() { counter++ }() // ⚠️ counter++ 不是原子操作
    }
}

// 场景3：对 slice 的并发 append
func sliceRace() {
    var s []int
    for i := 0; i < 100; i++ {
        go func() { s = append(s, i) }() // ⚠️ slice header 并发写入
    }
}

// 场景4：channel 发送方和接收方的外部变量访问
func chanRace() {
    var result int
    ch := make(chan struct{})
    go func() {
        result = 42
        ch <- struct{}{}
    }()
    <-ch
    _ = result // ✅ 正确的同步：channel 保证了 happens-before
}
```

### 6.3 如何避免数据竞争

| 方法 | 说明 |
|------|------|
| **使用 channel 同步** | channel 通信保证 happens-before |
| **使用 sync.Mutex / RWMutex** | 保护临界区 |
| **使用 sync/atomic 包** | 原子操作，适合计数器、flag |
| **避免共享可变状态** | 传递副本而非指针，或者只在一个 goroutine 中持有数据 |

```go
// 使用原子操作替代锁
type atomicCounter struct {
    value atomic.Int64
}

func (c *atomicCounter) Inc()  { c.value.Add(1) }
func (c *atomicCounter) Val() int64 { return c.value.Load() }

// 使用不可变副本
func copyRace() {
    type config struct{ Addr string }
    var cfg atomic.Value // 或使用 sync.RWMutex

    // 写 goroutine
    go func() {
        cfg.Store(&config{Addr: ":8080"})
    }()

    // 读 goroutine
    go func() {
        c := cfg.Load().(*config)
        _ = c.Addr
    }()
}
```

### 6.4 -race 检测不到的竞态

1. **数据竞争发生在不同机器上**（分布式竞态）—— 需用分布式 tracing。
2. **`sync.Once` 的 `panic` 导致未初始化**。
3. **unsafe 包绕过类型安全** —— `unsafe.Pointer` 的读写需要额外注意。
4. **`reflect` 包操作不可导出字段**。

---

## 总结

| 主题 | 关键要点 |
|------|----------|
| GMP 模型 | G 是 goroutine，M 是线程，P 是逻辑处理器；Work Stealing + Hand Off 实现调度 |
| Channel | 无缓冲用于同步，有缓冲用于解耦；发送方关闭；nil channel 屏蔽 select 分支 |
| Context | 第一个参数传递；超时和取消必须 defer cancel；WithValue 仅传请求级数据 |
| sync 包 | 读多写少用 RWMutex；Pool 减少 GC；Once 确保单次执行；Cond 做多次通知 |
| 并发模式 | Fan-in/out 扩缩容；Worker Pool 限制并发；Pipeline 串联；Tee 复制数据流 |
| Race Detector | 加 `-race` 运行；map 并发读写是常见坑；用原子操作或 channel 保证 happens-before |

---

> **进一步阅读**：Go 官方文档 [The Go Memory Model](https://go.dev/ref/mem)，以及 [RSC 的并发文章](https://research.swtch.com/gomm)。
