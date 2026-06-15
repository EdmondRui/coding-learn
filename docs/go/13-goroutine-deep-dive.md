# 第 13 章：Goroutine 深度剖析

> 目标读者：有 Go 并发编程经验，希望深入理解 goroutine 调度器原理、运行时机制和工程级调优的开发者。本章从 GMP 模型源码级解析出发，覆盖抢占式调度、系统调用处理、goroutine 泄漏、runtime 调优等核心主题。

---

## 13.1 GMP 调度器源码级解析

### 13.1.1 核心数据结构

Go 调度器的核心定义在 `runtime/runtime2.go` 中：

```go
// G —— goroutine
type g struct {
    stack      stack       // 栈范围 [lo, hi]
    sched      gobuf       // 调度上下文（保存寄存器）
    atomicstatus atomic.Uint32 // 状态
    gopc       uintptr     // 创建该 G 的 go 语句的 PC
    startpc    uintptr     // 入口函数 PC
    m          *m          // 当前绑定的 M
    parentGoid uint64      // 父 goroutine ID
    waiting    *sudog      // 等待队列（channel/sync 原语）
    timer      *timer      // time.Sleep 关联的定时器
}

// gobuf —— 保存 goroutine 的执行上下文
type gobuf struct {
    sp   uintptr  // 栈指针
    pc   uintptr  // 程序计数器
    g    guintptr // 指向 g 的指针
    ret  uintptr  // 返回值
    bp   uintptr  // 帧指针（用于栈回溯）
}

// M —— 操作系统线程
type m struct {
    g0        *g          // 调度栈（用于执行调度代码）
    curg      *g          // 当前运行的 goroutine
    p         puintptr    // 绑定的 P
    nextp     puintptr    // 唤醒时绑定的 P
    spinning  bool       // 是否正在寻找工作
    blocked   bool       // 是否阻塞在 syscall
    park      note        // 休眠/唤醒机制
    syscall   uint32     // 是否在系统调用中
}

// P —— 逻辑处理器
type p struct {
    id        int32
    status    uint32      // _Pidle / _Prunning / _Psyscall / _Pgcstop / _Pdead
    m         muintptr    // 绑定的 M
    runqhead  uint32      // 本地队列头
    runqtail  uint32      // 本地队列尾
    runq      [256]guintptr // 本地队列（256 个 G）
    runnext   guintptr    // 优先运行的 G（下一个时间片）
    gFree     *g          // 空闲 G 列表（复用）
}
```

### 13.1.2 G 的状态流转

```
                    ┌──────────┐
                    │  _Gidle   │ 新创建，尚未初始化
                    └────┬─────┘
                         │ go() 调用
                    ┌────▼─────┐
              ┌─────│_Grunnable│ 可运行，等待被 M 执行
              │     └────┬─────┘
              │          │ schedule() 选中
              │     ┌────▼─────┐
              │     │_Grunning │ 正在执行
              │     └──┬──┬────┘
              │        │  │
              │   系统调用  │ Gosched() / channel 阻塞
              │        │  │
              │  ┌─────▼──┐ │     ┌──────────┐
              │  │_Gsyscall│ │     │_Gwaiting │ 等待事件
              │  └────┬───┘ │     │(channel/ │
              │       │     │     │ mutex/   │
              │  系统调用   │     │ time/    │
              │  返回      │     │ select)  │
              │       │     │     └──┬───────┘
              │       │     │        │ 事件就绪
              │  ┌────▼─────┐       │
              └──│_Grunnable│◄──────┘
                 └────┬─────┘
                      │ goexit()
                 ┌────▼─────┐
                 │ _Gdead   │ 已退出，可复用
                 └──────────┘
```

### 13.1.3 调度核心流程

`schedule()` 是调度器的入口，定义在 `runtime/proc.go`：

```go
// 简化的调度流程
func schedule() {
    _g_ := getg()  // 获取当前 g0

    // 1. 检查是否有被标记为 next 的 G（最高优先级）
    if gp := _g_.m.p.ptr().runnext.ptr(); gp != nil {
        if runqget(_g_.m.p.ptr(), gp) {
            execute(gp, inheritTime)
            return
        }
    }

    // 2. 从本地队列获取 G
    if gp := runqget(_g_.m.p.ptr()); gp != nil {
        execute(gp, inheritTime)
        return
    }

    // 3. 本地队列为空，从全局队列/其他 P 窃取
    gp, inheritTime := findrunnable()
    execute(gp, inheritTime)
}

func findrunnable() (gp *g, inheritTime bool) {
    _g_ := getg()
    p := _g_.m.p.ptr()

    // 1. 检查本地队列
    if gp := runqget(p); gp != nil { return gp, false }

    // 2. 检查全局队列
    if gp := globrunqget(p, 0); gp != nil { return gp, false }

    // 3. 检查 netpoll（网络 I/O 就绪的 G）
    if netpollinited && netpollWaiters > 0 {
        if list := netpoll(0); !list.empty() {
            gp := list.pop()
            injectglist(&list)
            return gp, false
        }
    }

    // 4. Work Stealing：从其他 P 偷取
    for i := 0; i < 4; i++ {
        for enum := stealOrder.start(fastrand()); !enum.done(); enum.next() {
            p2 := allp[enum.position()]
            if gp := runqsteal(p, p2, stealRunNextG); gp != nil {
                return gp, true
            }
        }
    }

    // 5. 再次检查全局队列和 netpoll
    // 6. 休眠当前 M
    stopm()
    goto top  // 被唤醒后重新调度
}
```

### 13.1.4 runnext 的优先级机制

```go
// runnext 是 P 上的一个特殊槽位
// 当创建新 G 或 G 变为可运行时，优先放入 runnext
// 这保证了最近创建的 G 能最快被调度

func runqput(p *p, gp *g, next bool) {
    if next {
        // 放入 runnext 槽位，原来的 runnext 被推入队列
        oldnext := p.runnext
        if !p.runnext.cas(oldnext, guintptr(unsafe.Pointer(gp))) {
            // CAS 失败，重试
        }
        if oldnext != 0 {
            // 将旧的 runnext 放入队列尾部
            runqputSlow(p, oldnext.ptr(), 0)
        }
        return
    }
    // 放入本地队列尾部
    // ...
}
```

**为什么需要 runnext？** 当一个 goroutine 创建新 goroutine 时（如 `go func()`），新 G 很可能与当前 G 共享缓存数据，优先调度它有利于缓存命中率。

---

## 13.2 抢占式调度

### 13.2.1 协作式抢占的问题

Go 1.13 之前只有协作式抢占——goroutine 必须主动让出 CPU：

```go
// ❌ 死循环 goroutine 会导致调度器无法介入（Go 1.13 之前）
func deadLoop() {
    for {
        // 没有函数调用，没有 channel 操作
        // 调度器永远无法抢占这个 G
        // 其他 goroutine 会被饿死
    }
}
```

协作式抢占的触发点：
- 函数调用（编译器在函数序言插入栈检查）
- `channel` 操作
- `time.Sleep`
- `runtime.Gosched()`
- 系统调用

### 13.2.2 基于信号的异步抢占（Go 1.14+）

Go 1.14 引入了基于信号的异步抢占，解决了上述问题：

```
1. sysmon 线程检测到某个 G 运行超过 10ms
2. sysmon 向该 G 所在的 M 发送 SIGURG 信号
3. M 的信号处理器（doSigPreempt）被触发
4. 修改 G 的 PC，使其在恢复执行时调用 asyncPreempt
5. asyncPreempt 保存上下文，将 G 放回队列
6. 调度器选择其他 G 执行
```

```go
// runtime/signal_unix.go
func doSigPreempt(gp *g, sig *sigctxt) {
    // 检查是否可以抢占
    if preemptible(gp) {
        // 保存当前上下文
        sig.save(gp.sigPC0, gp.sigSP0, gp.sigLR0, gp.sigG0)
        // 修改返回地址为 asyncPreempt
        sig.setPC(funcPC(asyncPreempt))
    }
}

// runtime/preempt.go
func asyncPreempt() {
    // 保存所有寄存器
    // 调用 asyncPreempt2
}

func asyncPreempt2() {
    gp := getg()
    gp.asyncSafePoint = true
    // 将当前 G 放回可运行队列
    gopreempt_m(gp)
}
```

### 13.2.3 抢占的时机与限制

```go
// 仍然无法抢占的场景：
// 1. 正在执行 CGo 调用（M 被内核线程绑定）
// 2. 正在执行 runtime 内部代码（某些关键区）
// 3. 持有锁的 goroutine（避免死锁）

// 可以抢占的场景：
// 1. 普通循环（即使没有函数调用）
// 2. 密集计算
// 3. 任何用户代码
```

### 13.2.4 验证抢占效果

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GOMAXPROCS(1) // 只用一个 P

    // 死循环 goroutine
    go func() {
        for i := 0; ; i++ {
            if i%1e8 == 0 {
                fmt.Printf("goroutine A: %d\n", i/1e8)
            }
        }
    }()

    // 另一个 goroutine
    go func() {
        for i := 0; ; i++ {
            if i%1e8 == 0 {
                fmt.Printf("goroutine B: %d\n", i/1e8)
            }
        }
    }()

    time.Sleep(3 * time.Second)
}

// Go 1.14+ 输出（异步抢占生效）：
// goroutine A: 1
// goroutine B: 1
// goroutine A: 2
// goroutine B: 2
// ...

// Go 1.13 输出（只有协作式抢占）：
// goroutine A: 1
// goroutine A: 2
// goroutine A: 3
// ...（B 永远得不到执行）
```

---

## 13.3 系统调用处理

### 13.3.1 系统调用的 Enters/Exits

当 goroutine 执行系统调用时，调度器需要特殊处理：

```go
// runtime/proc.go —— 进入系统调用
func entersyscall() {
    _g_ := getg()
    _g_.m.locks++

    // 1. 保存当前 G 的调度信息
    save(getcallerpc(), getcallersp())

    // 2. 标记 G 为 _Gsyscall
    _g_.atomicstatus.Store(_Gsyscall)

    // 3. 标记 P 为 _Psyscall（允许被偷走）
    _g_.m.p.ptr().atomicstatus.Store(_Psyscall)

    // 4. 确保 sysmon 可以处理这个 P
    _g_.m.locks--
}

// 退出系统调用
func exitsyscall() {
    _g_ := getg()

    // 快速路径：尝试重新获取原来的 P
    oldp := _g_.m.p.ptr()
    if exitsyscallfast(oldp) {
        // 成功获取 P，继续执行
        _g_.m.p.ptr().atomicstatus.Store(_Prunning)
        _g_.atomicstatus.Store(_Grunning)
        return
    }

    // 慢速路径：原来的 P 已被偷走
    // 将 G 放入全局队列，M 休眠
    mcall(exitsyscall0)
}
```

### 13.3.2 Hand Off 机制

```
G1 在 M1 上执行 → G1 进入系统调用（如文件读取）
                    ↓
M1 被标记为阻塞，P1 从 M1 上摘下
                    ↓
P1 绑定到空闲的 M2（或创建新 M2）
                    ↓
M2 + P1 继续执行本地队列中的其他 G
                    ↓
G1 的系统调用完成 → M1 尝试获取 P
  - 有空闲 P → M1 + P 继续执行 G1
  - 无空闲 P → G1 放入全局队列，M1 休眠
```

### 13.3.3 系统调用的分类

```go
// 阻塞式系统调用（会触发 Hand Off）
// - 文件 I/O（open/read/write/close）
// - 网络连接（connect/accept，非 poll 模式）
// - 睡眠（nanosleep）
// - 进程操作（fork/exec/wait）

// 非阻塞式系统调用（通过 netpoll 处理）
// - 网络读写（read/write，配合 epoll/kqueue）
// - Go 的 net 包使用非阻塞 I/O + netpoll

// 示例：net 包如何避免阻塞 M
func netRead(fd int, buf []byte) (int, error) {
    // 1. 设置 fd 为非阻塞
    setNonblock(fd)

    // 2. 尝试读取
    n, err := read(fd, buf)
    if err == EAGAIN {
        // 3. 没有数据，将 G 挂到 netpoll
        netpollWait(fd, 'r')
        // 4. G 被挂起，M 可以执行其他 G
        // 5. 数据到达时，netpoll 唤醒 G
        n, err = read(fd, buf)
    }
    return n, err
}
```

---

## 13.4 Goroutine 泄漏检测与预防

### 13.4.1 常见泄漏场景

```go
// 场景 1：忘记读取 channel
func leak1() {
    ch := make(chan int)
    go func() {
        result := compute()
        ch <- result // 如果没人读取，goroutine 永远阻塞在这里
    }()
    // 只处理了部分逻辑就返回了，ch 没有被读取
}

// 场景 2：无限循环没有退出条件
func leak2() {
    go func() {
        for {
            doWork() // 永远不会退出
        }
    }()
}

// 场景 3：select 缺少 default 或退出条件
func leak3(ctx context.Context) {
    ch1 := make(chan int)
    ch2 := make(chan int)

    go func() {
        for {
            select {
            case <-ch1:
                // 处理 ch1
            case <-ch2:
                // 处理 ch2
            // ❌ 缺少 <-ctx.Done() 退出条件
            }
        }
    }()
}

// 场景 4：WaitGroup 使用不当
func leak4() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            // 如果这里 panic 且没有 recover
            // wg.Done() 不会被调用
            // wg.Wait() 永远阻塞
        }()
    }
    wg.Wait()
}
```

### 13.4.2 使用 runtime 监控 goroutine 数量

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

// goroutine 监控
func monitorGoroutines(interval time.Duration) {
    ticker := time.NewTicker(interval)
    defer ticker.Stop()

    for range ticker.C {
        count := runtime.NumGoroutine()
        fmt.Printf("当前 goroutine 数量: %d\n", count)

        if count > 1000 {
            fmt.Printf("⚠️ goroutine 数量异常: %d\n", count)
            // 可以输出堆栈信息
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true) // true = 所有 goroutine
            fmt.Printf("堆栈信息:\n%s\n", buf[:n])
        }
    }
}

func main() {
    go monitorGoroutines(time.Second)

    // 业务代码...
    select {}
}
```

### 13.4.3 使用 pprof 分析 goroutine

```go
import (
    "net/http"
    _ "net/http/pprof"
)

func main() {
    // 启动 pprof HTTP 服务
    go func() {
        http.ListenAndServe(":6060", nil)
    }()

    // 业务代码...
    select {}
}

// 命令行分析：
// go tool pprof http://localhost:6060/debug/pprof/goroutine
// (pprof) top          —— 查看 goroutine 数量最多的函数
// (pprof) traces       —— 查看调用栈
// (pprof) web          —— 生成火焰图

// 查看所有 goroutine 堆栈：
// curl http://localhost:6060/debug/pprof/goroutine?debug=1
```

### 13.4.4 预防 goroutine 泄漏的最佳实践

```go
// ✅ 实践 1：始终使用 context 控制生命周期
func worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            fmt.Println("worker 退出")
            return
        case job := <-jobCh:
            process(job)
        }
    }
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel() // 确保 goroutine 能退出

    go worker(ctx)
    // ...
}

// ✅ 实践 2：带缓冲 channel 防止发送阻塞
func safeSend(ch chan<- int, value int) bool {
    select {
    case ch <- value:
        return true
    default:
        return false // channel 满了，不阻塞
    }
}

// ✅ 实践 3：recover 防止 panic 导致 WaitGroup 不平衡
func safeGo(wg *sync.WaitGroup, fn func()) {
    wg.Add(1)
    go func() {
        defer wg.Done()
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine panic: %v", r)
            }
        }()
        fn()
    }()
}

// ✅ 实践 4：使用 done channel 通知退出
func processor(done <-chan struct{}, input <-chan int, output chan<- int) {
    defer close(output)

    for {
        select {
        case <-done:
            return
        case item, ok := <-input:
            if !ok {
                return
            }
            output <- process(item)
        }
    }
}
```

---

## 13.5 Runtime 调优

### 13.5.1 GOMAXPROCS

```go
import "runtime"

// GOMAXPROCS 控制 P 的数量，即并行度
// 默认值 = CPU 核数

// 查看当前值
fmt.Println(runtime.GOMAXPROCS(0)) // 0 表示不修改，只查询

// 设置为 4 个 P
runtime.GOMAXPROCS(4)

// ⚠️ 在容器环境中，默认值可能不正确
// 容器可能限制了 CPU 配额，但 Go 看到的是宿主机核数
// 使用 automaxprocs 自动适配：
// import "go.uber.org/automaxprocs"
// 它会读取 cgroup 的 CPU 配额并设置 GOMAXPROCS
```

### 13.5.2 GOGC 与内存控制

```go
// GOGC 控制 GC 触发频率
// 默认值 100，含义：当堆增长到上次 GC 后存活大小的 2 倍时触发 GC
// GOGC=100 → 堆大小 = 存活大小 × (1 + 100/100) = 2 × 存活大小
// GOGC=200 → 堆大小 = 存活大小 × (1 + 200/100) = 3 × 存活大小
// GOGC=50  → 堆大小 = 存活大小 × (1 + 50/100)  = 1.5 × 存活大小
// GOGC=off → 禁用 GC

// Go 1.19+ 使用 GOMEMLIMIT 替代 GOGC（更直观）
// GOMEMLIMIT 设置堆内存上限
runtime/debug.SetMemoryLimit(1 << 30) // 1GB

// 环境变量
// GOMEMLIMIT=1GiB
// GOGC=50
```

### 13.5.3 Goroutine 栈追踪

```go
import "runtime"

// 获取当前 goroutine 的栈信息
func stackTrace() {
    buf := make([]byte, 1024)
    n := runtime.Stack(buf, false) // false = 仅当前 goroutine
    fmt.Printf("栈信息:\n%s\n", buf[:n])
}

// 获取所有 goroutine 的栈信息
func allStackTraces() {
    buf := make([]byte, 1<<20) // 1MB
    n := runtime.Stack(buf, true) // true = 所有 goroutine
    fmt.Printf("所有 goroutine 栈:\n%s\n", buf[:n])
}

// Caller 信息
func callerInfo() {
    // 获取调用者信息
    pc, file, line, ok := runtime.Caller(1) // 1 = 调用者的调用者
    if ok {
        fn := runtime.FuncForPC(pc)
        fmt.Printf("函数: %s\n文件: %s:%d\n", fn.Name(), file, line)
    }

    // Callers —— 获取完整调用链
    pcs := make([]uintptr, 32)
    n := runtime.Callers(0, pcs)
    pcs = pcs[:n]

    frames := runtime.CallersFrames(pcs)
    for {
        frame, more := frames.Next()
        fmt.Printf("%s at %s:%d\n", frame.Function, frame.File, frame.Line)
        if !more {
            break
        }
    }
}
```

### 13.5.4 runtime.MemStats

```go
func printMemStats() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)

    fmt.Printf("堆已分配: %d MB\n", m.HeapAlloc/1024/1024)
    fmt.Printf("堆累计分配: %d MB\n", m.TotalAlloc/1024/1024)
    fmt.Printf("系统分配: %d MB\n", m.Sys/1024/1024)
    fmt.Printf("GC 次数: %d\n", m.NumGC)
    fmt.Printf("GC 总暂停: %d ms\n", m.PauseTotalNs/1e6)
    fmt.Printf("Goroutine 数: %d\n", runtime.NumGoroutine())

    // 最近一次 GC 信息
    fmt.Printf("上次 GC: %s\n", time.Unix(0, int64(m.LastGC)).Format(time.RFC3339))
    fmt.Printf("上次 GC 暂停: %d μs\n", m.PauseNs[(m.NumGC+255)%256]/1e3)
}
```

### 13.5.5 调度器信息追踪

```go
// 使用 GODEBUG 环境变量追踪调度器行为
// GODEBUG=schedtrace=1000  —— 每 1000ms 输出一次调度器状态
// GODEBUG=scheddetail=1    —— 输出详细的 P/M/G 状态

// 输出示例：
// SCHED 1000ms: gomaxprocs=4 idleprocs=2 threads=6 spinningthreads=0 idlethreads=3 runqueue=0 [0 0 0 0]
//
// gomaxprocs: P 数量
// idleprocs: 空闲 P 数量
// threads: M 数量
// spinningthreads: 正在寻找工作的 M 数量
// idlethreads: 空闲 M 数量
// runqueue: 全局队列中的 G 数量
// [0 0 0 0]: 每个 P 本地队列中的 G 数量

// 运行：
// GODEBUG=schedtrace=1000,scheddetail=1 go run main.go
```

---

## 13.6 Channel 底层实现

### 13.6.1 hchan 数据结构

```go
// runtime/chan.go
type hchan struct {
    qcount   uint           // 队列中的元素数量
    dataqsiz uint           // 环形队列容量（缓冲区大小）
    buf      unsafe.Pointer // 环形队列指针
    elemsize uint16         // 元素大小
    closed   uint32         // 是否已关闭
    timer    *timer         // Go 1.23+ timer 集成
    elemtype *_type         // 元素类型
    sendx    uint           // 发送索引
    recvx    uint           // 接收索引
    recvq    waitq          // 等待接收的 goroutine 队列
    sendq    waitq          // 等待发送的 goroutine 队列
    lock     mutex          // 互斥锁
}

type waitq struct {
    first *sudog
    last  *sudog
}

// sudog —— 封装了等待在 channel 上的 goroutine
type sudog struct {
    g     *g
    next  *sudog
    prev  *sudog
    elem  unsafe.Pointer // 指向数据的指针
    c     *hchan         // 关联的 channel
}
```

### 13.6.2 发送与接收流程

```go
// 简化的发送流程
func chansend(c *hchan, ep unsafe.Pointer, block bool) bool {
    lock(&c.lock)

    // 1. 检查是否有等待接收的 goroutine
    if sg := c.recvq.dequeue(); sg != nil {
        // 直接拷贝数据给接收方
        send(c, sg, ep)
        unlock(&c.lock)
        return true
    }

    // 2. 缓冲区有空位，放入缓冲区
    if c.qcount < c.dataqsiz {
        qp := chanbuf(c, c.sendx)
        typedmemmove(c.elemtype, qp, ep)
        c.sendx++
        if c.sendx == c.dataqsiz {
            c.sendx = 0
        }
        c.qcount++
        unlock(&c.lock)
        return true
    }

    // 3. 缓冲区满，阻塞当前 goroutine
    gp := getg()
    sg := acquireSudog()
    sg.elem = ep
    c.sendq.enqueue(sg)
    gopark(chanparkcommit, ...) // 挂起当前 G

    // 被唤醒后...
    return true
}

// 简化的接收流程
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) bool {
    lock(&c.lock)

    // 1. 检查是否有等待发送的 goroutine
    if sg := c.sendq.dequeue(); sg != nil {
        if c.dataqsiz == 0 {
            // 无缓冲：直接从发送方拷贝
            recvDirect(c.elemtype, sg, ep)
        } else {
            // 有缓冲：从缓冲区取，发送方数据放入缓冲区
            qp := chanbuf(c, c.recvx)
            typedmemmove(c.elemtype, ep, qp)
            typedmemmove(c.elemtype, qp, sg.elem)
            c.recvx++
            c.sendx++
            c.qcount++
        }
        unlock(&c.lock)
        goready(sg.g) // 唤醒发送方
        return true
    }

    // 2. 缓冲区有数据
    if c.qcount > 0 {
        qp := chanbuf(c, c.recvx)
        typedmemmove(c.elemtype, ep, qp)
        c.recvx++
        c.qcount--
        unlock(&c.lock)
        return true
    }

    // 3. 缓冲区空，阻塞
    gp := getg()
    sg := acquireSudog()
    sg.elem = ep
    c.recvq.enqueue(sg)
    gopark(chanparkcommit, ...)

    return true
}
```

### 13.6.3 Channel 的性能特性

```go
// 无缓冲 channel：零拷贝直接传递（发送方 → 接收方）
// 有缓冲 channel：两次拷贝（发送方 → 缓冲区 → 接收方）

// 性能对比
func benchmarkChannel(b *testing.B) {
    // 无缓冲
    ch := make(chan int)
    go func() {
        for i := 0; i < b.N; i++ {
            ch <- i
        }
    }()
    for i := 0; i < b.N; i++ {
        <-ch
    }
}

func benchmarkBufferedChannel(b *testing.B) {
    // 有缓冲（容量 1）
    ch := make(chan int, 1)
    go func() {
        for i := 0; i < b.N; i++ {
            ch <- i
        }
    }()
    for i := 0; i < b.N; i++ {
        <-ch
    }
}

// 典型结果：
// 无缓冲: ~100 ns/op
// 有缓冲(1): ~80 ns/op（缓冲区避免了直接握手）
// 有缓冲(128): ~40 ns/op（批量发送减少锁竞争）
```

---

## 13.7 Netpoll 机制

### 13.7.1 Netpoll 的工作原理

Go 的网络 I/O 使用非阻塞 fd + epoll/kqueue/IOCP，避免 M 阻塞：

```
1. 创建 socket → 设置为非阻塞模式
2. 尝试 read/write → 如果返回 EAGAIN
3. 将 fd 注册到 epoll/kqueue
4. 将当前 G 挂起（gopark）
5. M 继续执行其他 G
6. epoll_wait 返回就绪的 fd
7. 唤醒对应的 G，继续 read/write
```

```go
// runtime/netpoll_epoll.go (Linux)
func netpoll(delay int64) gList {
    var events [128]epollevent
retry:
    // 调用 epoll_wait
    n := epollwait(epfd, &events[0], int32(len(events)), waitms)
    if n < 0 {
        goto retry
    }

    var toRun gList
    for i := 0; i < n; i++ {
        ev := &events[i]
        // 从 epoll 事件中恢复 goroutine
        if ev.events == 0 {
            continue
        }
        gp := *(**g)(unsafe.Pointer(&ev.data))
        // 根据事件类型设置可读/可写
        toRun.pushBack(gp)
    }
    return toRun
}
```

### 13.7.2 Netpoll 与调度器的集成

```go
// sysmon 线程定期调用 netpoll
// 在 findrunnable() 中也会调用 netpoll

// sysmon 的 netpoll 调用时机：
// - 每 10ms 至少调用一次（如果网络等待者 > 0）
// - 在 GC 标记阶段也会调用

// 这意味着网络 I/O 就绪的 goroutine 会在以下时机被唤醒：
// 1. sysmon 周期性检查
// 2. 调度器 findrunnable 时
// 3. GC 标记阶段
```

---

## 13.8 Timer 与调度器

### 13.8.1 Timer 的实现演进

```go
// Go 1.13 及之前：全局 timer 堆（64 个桶）
// 所有 P 共享，锁竞争严重

// Go 1.14：每个 P 持有本地 timer 堆
// 减少了锁竞争，但仍有优化空间

// Go 1.23+：timer 集成到 channel
// time.Sleep 和 time.After 不再创建新 goroutine
// timer 直接与 channel 关联，更高效

// Go 1.23 之前
func oldTimerPattern() {
    // ❌ time.After 每次创建新 timer 和 channel
    select {
    case <-time.After(5 * time.Second):
        // 每次调用都分配新对象
    case <-ch:
    }
}

// Go 1.23+ 优化
func newTimerPattern() {
    // ✅ time.After 变得更高效
    // timer 不再需要额外 goroutine
    select {
    case <-time.After(5 * time.Second):
    case <-ch:
    }
}
```

### 13.8.2 Timer 最佳实践

```go
// ❌ 在循环中使用 time.After 会泄漏 timer
func leakyLoop(ch <-chan int) {
    for {
        select {
        case <-time.After(5 * time.Second):
            // 每次循环创建新 timer，旧的不会被回收
            // 直到下次 GC
            fmt.Println("超时")
        case v := <-ch:
            fmt.Println(v)
        }
    }
}

// ✅ 使用 time.NewTimer 并 Reset
func correctLoop(ch <-chan int) {
    timer := time.NewTimer(5 * time.Second)
    defer timer.Stop()

    for {
        select {
        case <-timer.C:
            fmt.Println("超时")
            timer.Reset(5 * time.Second) // 重用 timer
        case v := <-ch:
            fmt.Println(v)
            if !timer.Stop() {
                <-timer.C // 清空 channel
            }
            timer.Reset(5 * time.Second)
        }
    }
}
```

---

## 小结

| 主题 | 关键点 |
|------|--------|
| GMP 模型 | G/M/P 数据结构、本地队列/全局队列、runnext 优先级 |
| 调度流程 | schedule → findrunnable → execute → goexit |
| 抢占式调度 | Go 1.14+ 基于信号的异步抢占，解决死循环饿死问题 |
| 系统调用 | Enters/Exits、Hand Off、netpoll 避免阻塞 |
| Goroutine 泄漏 | 常见场景、pprof 检测、context 控制生命周期 |
| Runtime 调优 | GOMAXPROCS、GOGC/GOMEMLIMIT、schedtrace |
| Channel 底层 | hchan 结构、环形缓冲区、sudog 等待队列 |
| Netpoll | epoll/kqueue 集成、非阻塞 I/O |
| Timer | Go 1.23+ 优化、Reset 重用、避免泄漏 |