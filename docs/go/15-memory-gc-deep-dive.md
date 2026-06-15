# 第 15 章：内存管理与 GC 深度

> 目标读者：有 Go 开发经验，希望深入理解内存分配、GC 原理和性能调优的开发者。本章覆盖三色标记算法、写屏障、GC 调优、pprof 内存分析、sync.Pool、逃逸分析实战等核心主题。

---

## 15.1 Go 内存分配器

### 15.1.1 TCMalloc 思想

Go 的内存分配器基于 TCMalloc（Thread-Caching Malloc），核心思想：

- **线程缓存（Thread Cache）**：每个 P 拥有本地缓存，分配无需加锁
- **中心缓存（Central Cache）**：当本地缓存不足时，从中心缓存获取
- **页堆（Page Heap）**：大块内存从堆获取

```
┌──────────────────────────────────────────────────┐
│                   Page Heap                       │
│            (大对象 > 32KB 直接分配)                 │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│               Central Cache                       │
│         (spanClass 级别的空闲列表)                   │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────┬──────────┼──────────┬──────────┐
│ P0 Cache │ P1 Cache │ P2 Cache │ P3 Cache │
│ (mcache) │ (mcache) │ (mcache) │ (mcache) │
└──────────┴──────────┴──────────┴──────────┘
```

### 15.1.2 对象大小分类

| 大小 | 分类 | 分配方式 |
|------|------|---------|
| ≤ 16B | 微对象（Tiny） | mcache 微分配器合并 |
| 16B ~ 32KB | 小对象（Small） | mcache 对应 size class |
| > 32KB | 大对象（Large） | 直接从 mheap 分配 |

```go
// 分配示例
func allocationExample() {
    // 微对象：<= 16B，无指针
    a := 42                    // 8B，栈分配
    b := "hello"               // 16B header + 5B data
    c := make([]int, 0)        // 24B slice header

    // 小对象：16B ~ 32KB
    d := make([]int, 100)      // 100 * 8 = 800B
    e := make(map[string]int)  // hmap 结构 ~64B

    // 大对象：> 32KB
    f := make([]byte, 1<<20)   // 1MB，直接从 mheap
}
```

### 15.1.3 mcache 本地缓存

```go
// runtime/mcache.go
type mcache struct {
    // 微分配器：合并 < 16B 的无指针对象
    tiny       uintptr
    tinyoffset uintptr
    tinyAllocs uintptr

    // 每个 size class 的 span 缓存
    alloc [numSpanClasses]*mspan
}

// 分配流程：
// 1. size <= 16B 且无指针 → 微分配器合并
// 2. size <= 32KB → 从 mcache 的对应 span 分配
// 3. mcache 没有空闲 span → 从 mcentral 获取
// 4. mcentral 没有空闲 span → 从 mheap 获取新页
```

---

## 15.2 三色标记算法

### 15.2.1 三色标记原理

Go GC 使用三色标记-清除算法，将对象分为三种颜色：

| 颜色 | 含义 |
|------|------|
| **白色** | 未被标记，可能是垃圾对象 |
| **灰色** | 已被标记，但其引用的对象尚未扫描 |
| **黑色** | 已被标记，且其引用的对象都已扫描 |

```
标记过程：

初始状态：所有对象为白色
    ┌──────┐
    │ 根集  │ (栈变量、全局变量)
    └──┬───┘
       │ 标记根集引用的对象为灰色
       ▼
  ┌─────────────────────────────────────┐
  │  循环：                              │
  │  1. 取一个灰色对象                    │
  │  2. 将其引用的白色对象标记为灰色        │
  │  3. 将该灰色对象标记为黑色             │
  │  4. 重复直到没有灰色对象               │
  └─────────────────────────────────────┘
       │
       ▼
  剩余白色对象 = 垃圾 → 清除
```

### 15.2.2 并发标记的挑战

GC 需要与用户代码并发运行。如果用户代码在标记期间修改了引用关系，可能导致误删存活对象：

```
问题场景（无写屏障）：

1. 黑色对象 A 引用白色对象 B
2. 灰色对象 C 也引用白色对象 B
3. 用户代码：C 不再引用 B，A 开始引用 B
4. 但 A 已经是黑色，不会再被扫描
5. B 变成白色，被错误回收！

时间线：
  T1: A(黑) → nil,  C(灰) → B(白)
  T2: 用户代码执行: A.ref = B, C.ref = nil
  T3: A(黑) → B(白), C(灰) → nil
  T4: B 没有灰色对象引用它 → B 被错误回收！
```

---

## 15.3 写屏障

### 15.3.1 写屏障的作用

写屏障（Write Barrier）在每次引用修改时执行，确保三色标记不变性不被破坏：

```go
// 伪代码：写屏障
func writeBarrier(slot *unsafe.Pointer, new unsafe.Pointer) {
    old := *slot
    *slot = new
    if gcphase == _GCmark {
        shade(new) // 将 new 标记为灰色
    }
}
```

### 15.3.2 Dijkstra 插入写屏障

```go
// Dijkstra 写屏障：标记新引用的对象
func dijkstraWriteBarrier(slot *unsafe.Pointer, new unsafe.Pointer) {
    shade(new) // 将 new 标记为灰色
    *slot = new
}
```

优点：实现简单，保证强三色不变性。缺点：栈上赋值也需要写屏障，STW 开销大。

### 15.3.3 Yuasa 删除写屏障

```go
// Yuasa 写屏障：标记被删除引用的对象
func yuasaWriteBarrier(slot *unsafe.Pointer, new unsafe.Pointer) {
    old := *slot
    shade(old) // 将 old 标记为灰色
    *slot = new
}
```

### 15.3.4 混合写屏障（Go 1.8+）

Go 1.8+ 使用混合写屏障，结合了 Dijkstra 和 Yuasa 的优点：

```go
// 混合写屏障
func hybridWriteBarrier(slot *unsafe.Pointer, new unsafe.Pointer) {
    old := *slot
    shade(old) // Yuasa：标记旧值
    shade(new) // Dijkstra：标记新值
    *slot = new
}

// 实际实现（优化版）—— 批量处理减少开销
func gcWriteBarrier(slot *unsafe.Pointer, new unsafe.Pointer) {
    // 将 old 和 new 放入写屏障缓存（work buffer）
    // 批量处理，减少每次赋值的开销
    buf := getWriteBarrierBuf()
    buf.put(old)
    buf.put(new)
    *slot = new
}
```

**混合写屏障的优势**：

| 特性 | Dijkstra | Yuasa | 混合写屏障 |
|------|----------|-------|-----------|
| 栈是否需要写屏障 | 是 | 否 | 否 |
| 栈是否需要 STW | 是 | 否 | 否 |
| 保证不变性 | 强三色 | 弱三色 | 弱三色 |
| 栈重新扫描 | 需要 | 不需要 | 不需要 |
| STW 时间 | 较长 | 较短 | 很短（~100μs） |

---

## 15.4 GC 流程详解

### 15.4.1 GC 完整流程

```
1. GC 触发（堆增长到阈值 / 手动调用 / 2 分钟未触发）
2. STW（Stop The World）—— 暂停所有 goroutine
3. 标记准备（Mark Setup）—— 开启写屏障
4. 恢复世界（Start The World）
5. 并发标记（Concurrent Mark）—— 扫描根集 + 处理灰色队列
6. 标记终止（Mark Termination）—— STW，关闭写屏障，清理
7. 恢复世界
8. 并发清除（Concurrent Sweep）—— 回收白色对象
```

### 15.4.2 GC 触发条件

```go
// 1. 堆内存增长触发（最常见）
// 当堆大小 >= 上次 GC 后存活大小 × (1 + GOGC/100) 时触发
// GOGC=100（默认）→ 堆增长 100% 时触发
// GOGC=200 → 堆增长 200% 时触发

// 2. 2 分钟未触发 GC
// runtime 保证至少每 2 分钟触发一次 GC

// 3. 手动触发
runtime.GC() // 强制触发 GC

// 4. Go 1.19+ GOMEMLIMIT
// 当堆大小接近 GOMEMLIMIT 时，更积极地触发 GC
```

### 15.4.3 GC 暂停时间分析

```go
import (
    "runtime/debug"
    "time"
)

func analyzeGCPause() {
    var m runtime.MemStats
    var totalPause time.Duration

    runtime.ReadMemStats(&m)
    for i := 0; i < int(m.NumGC); i++ {
        // PauseNs 是环形缓冲区
        pause := m.PauseNs[(i+256)%256]
        totalPause += time.Duration(pause)
    }

    fmt.Printf("GC 次数: %d\n", m.NumGC)
    fmt.Printf("总暂停时间: %v\n", totalPause)
    fmt.Printf("平均暂停: %v\n", totalPause/time.Duration(m.NumGC))

    // Go 1.8+ 的目标：GC 暂停 < 1ms
    // Go 1.12+ 的目标：GC 暂停 < 500μs
}
```

---

## 15.5 GC 调优

### 15.5.1 GOGC 调优

```go
import "runtime/debug"

func tuneGOGC() {
    // 读取当前 GOGC
    fmt.Println("GOGC:", debug.SetGCPercent(0)) // 0 表示不修改

    // 设置 GOGC
    debug.SetGCPercent(200) // 更大的值 = 更少的 GC = 更大的堆

    // GOGC=off 禁用 GC（不推荐）
    // debug.SetGCPercent(-1)
}
```

| GOGC 值 | 堆大小上限 | GC 频率 | 适用场景 |
|---------|-----------|---------|---------|
| 50 | 1.5× 存活 | 频繁 | 内存紧张 |
| 100（默认） | 2× 存活 | 适中 | 通用 |
| 200 | 3× 存活 | 较少 | 延迟敏感 |
| 400 | 5× 存活 | 很少 | 吞吐优先 |
| off | 无限 | 不触发 | 短命进程 |

### 15.5.2 GOMEMLIMIT（Go 1.19+）

```go
import "runtime/debug"

func tuneMemoryLimit() {
    // 设置内存上限为 2GB
    debug.SetMemoryLimit(2 << 30)

    // 环境变量方式
    // GOMEMLIMIT=2GiB

    // GOMEMLIMIT 与 GOGC 的交互：
    // - 当堆接近 GOMEMLIMIT 时，GC 更积极
    // - GOGC 仍然控制基本触发频率
    // - GOMEMLIMIT 是硬上限（软限制，尽力而为）

    // 推荐组合：
    // GOGC=off GOMEMLIMIT=2GiB
    // → 完全由内存上限控制 GC，更可预测
}
```

### 15.5.3 减少 GC 压力的编码实践

```go
// ❌ 频繁分配临时对象
func badHandler(w http.ResponseWriter, r *http.Request) {
    for i := 0; i < 1000; i++ {
        data := make([]byte, 1024) // 每次分配 1KB
        process(data)
    }
}

// ✅ 复用缓冲区
func goodHandler(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 1024) // 只分配一次
    for i := 0; i < 1000; i++ {
        process(buf)
    }
}

// ✅ 使用 sync.Pool 复用对象
var bufPool = sync.Pool{
    New: func() any {
        return make([]byte, 1024)
    },
}

func pooledHandler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf) // 归还池

    process(buf)
}

// ❌ 字符串拼接产生大量临时对象
func badConcat(parts []string) string {
    result := ""
    for _, p := range parts {
        result += p // 每次拼接都创建新字符串
    }
    return result
}

// ✅ 使用 strings.Builder
func goodConcat(parts []string) string {
    var b strings.Builder
    b.Grow(len(parts) * 20) // 预分配
    for _, p := range parts {
        b.WriteString(p)
    }
    return b.String()
}
```

---

## 15.6 sync.Pool 详解

### 15.6.1 sync.Pool 机制

```go
// sync.Pool 是临时对象缓存
// 特点：
// 1. 每个 P 有本地池，无锁访问
// 2. GC 时会清理池中对象（这是关键区别）
// 3. 适用于短期复用，不适合长期缓存

var pool = sync.Pool{
    New: func() any {
        return &MyObject{
            Data: make([]byte, 1024),
        }
    },
}

type MyObject struct {
    Data []byte
}

func usePool() {
    // 获取对象
    obj := pool.Get().(*MyObject)

    // 使用对象
    process(obj.Data)

    // 重置状态后归还
    obj.Data = obj.Data[:0]
    pool.Put(obj)
}
```

### 15.6.2 sync.Pool 与 GC

```go
// sync.Pool 在 GC 时会清理对象
// Go 1.13+ 的优化：不在每次 GC 都清理
// 使用 victim cache 延迟一轮清理

// 清理流程：
// 1. 当前池的对象移到 victim cache
// 2. victim cache 的旧对象被清除
// 3. 下一次 GC 时，victim cache 的对象才被清除

// 这意味着对象至少存活两轮 GC

// 监控 sync.Pool 效果
func monitorPool() {
    // 使用 runtime.MemStats 观察堆大小变化
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)

    // 使用 pool 处理请求
    for i := 0; i < 10000; i++ {
        obj := pool.Get().(*MyObject)
        process(obj)
        pool.Put(obj)
    }

    runtime.ReadMemStats(&after)
    fmt.Printf("堆增长: %d MB\n", (after.HeapAlloc-before.HeapAlloc)/1024/1024)
}
```

### 15.6.3 标准库中的 sync.Pool 使用

```go
// fmt 包使用 sync.Pool 缓存 pp 对象
var ppFree = sync.Pool{
    New: func() any { return new(pp) },
}

func Fprintf(w io.Writer, format string, a ...any) (n int, err error) {
    p := ppFree.Get().(*pp)
    p.doPrintf(format, a)
    n, err = w.Write(p.buf)
    p.free() // 归还池
    return
}

// encoding/json 使用 sync.Pool 缓存编码器
var encPool = sync.Pool{
    New: func() any { return new(encoder) },
}

// net/http 使用 sync.Pool 缓存响应写入器
var bufioWriterPool = sync.Pool{
    New: func() any { return bufio.NewWriterSize(any, 4<<10) },
}
```

---

## 15.7 pprof 内存分析

### 15.7.1 启动 pprof

```go
import (
    _ "net/http/pprof"
    "net/http"
)

func main() {
    go func() {
        http.ListenAndServe(":6060", nil)
    }()

    // 业务代码...
}
```

### 15.7.2 堆内存分析

```bash
# 下载堆 profile
go tool pprof http://localhost:6060/debug/pprof/heap

# 常用命令
(pprof) top20           # 查看分配最多的函数
(pprof) list funcName   # 查看函数内的分配
(pprof) web             # 生成火焰图
(pprof) svg             # 生成 SVG

# 对比两次 profile
go tool pprof -base heap1.pprof heap2.pprof

# 查看存活对象（而非累计分配）
go tool pprof -inuse_space http://localhost:6060/debug/pprof/heap
# 查看累计分配
go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
```

### 15.7.3 代码中获取 profile

```go
import "runtime/pprof"

func captureHeapProfile() {
    f, err := os.Create("heap.pprof")
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()

    runtime.GC() // 先触发 GC
    if err := pprof.WriteHeapProfile(f); err != nil {
        log.Fatal(err)
    }
}
```

---

## 15.8 逃逸分析实战

### 15.8.1 查看逃逸分析结果

```bash
# 编译时查看逃逸分析
go build -gcflags="-m -m" ./...

# 只看逃逸决策
go build -gcflags="-m" ./...

# 输出示例：
# ./main.go:12:6: &User literal escapes to heap:
#   - flow: ~R0 = &{...}:
#   - from ./main.go:12:6: &User literal
#   - to ./main.go:13:9: return &User{Name: name}
```

### 15.8.2 常见逃逸场景与优化

```go
// 场景 1：返回局部变量指针
func newUser(name string) *User {
    u := User{Name: name}
    return &u // 逃逸！
}

// 优化：如果调用者不需要指针，返回值
func newUserValue(name string) User {
    return User{Name: name} // 不逃逸
}

// 场景 2：接口赋值
func print(s fmt.Stringer) { // 接口参数导致逃逸
    println(s.String())
}

// 优化：使用泛型避免接口
func printGeneric[T fmt.Stringer](s T) {
    println(s.String()) // 不逃逸（Go 1.18+）
}

// 场景 3：闭包捕获
func counter() func() int {
    count := 0 // 逃逸！被闭包捕获
    return func() int {
        count++
        return count
    }
}

// 场景 4：slice 扩容
func growSlice() {
    s := make([]int, 0)
    for i := 0; i < 1000; i++ {
        s = append(s, i) // 可能多次扩容，旧数组逃逸
    }
}

// 优化：预分配
func preallocSlice() {
    s := make([]int, 0, 1000) // 预分配，不逃逸
    for i := 0; i < 1000; i++ {
        s = append(s, i)
    }
}

// 场景 5：map 中的值
func mapEscape() {
    m := make(map[string]*User)
    u := User{Name: "Alice"} // 逃逸！因为要取地址放入 map
    m["alice"] = &u
}

// 优化：直接构造
func mapNoEscape() {
    m := make(map[string]User)
    m["alice"] = User{Name: "Alice"} // 不逃逸
}
```

---

## 小结

| 主题 | 关键点 |
|------|--------|
| 内存分配器 | TCMalloc、mcache/mcentral/mheap 三级缓存 |
| 三色标记 | 白色（垃圾）、灰色（待扫描）、黑色（存活） |
| 写屏障 | 混合写屏障（Go 1.8+），栈无需写屏障 |
| GC 流程 | STW 开启写屏障 → 并发标记 → STW 关闭 → 并发清除 |
| GC 调优 | GOGC、GOMEMLIMIT、减少分配 |
| sync.Pool | 临时对象缓存，GC 时清理，victim cache 延迟一轮 |
| pprof | heap profile、inuse_space vs alloc_space |
| 逃逸分析 | -gcflags="-m"、返回指针/接口/闭包导致逃逸 |