# 第 14 章：高级并发模式

> 目标读者：有 Go 并发编程经验，希望掌握工程级并发模式的开发者。本章覆盖扇入扇出、Pipeline、Worker Pool 变体、限流器、熔断器、Singleflight、并发安全容器等实战模式。

---

## 14.1 扇入（Fan-In）与扇出（Fan-Out）

### 14.1.1 Fan-Out：一个任务分发到多个 goroutine

```go
// Fan-Out：将工作分发给多个 worker 并行处理
func fanOut(items []int, workerCount int) []int {
    results := make(chan int, len(items))

    // 创建多个 worker
    var wg sync.WaitGroup
    for i := 0; i < workerCount; i++ {
        wg.Add(1)
        go func(workerID int) {
            defer wg.Done()
            for _, item := range items {
                // 每个 worker 处理一部分
                if item%workerCount == workerID%workerCount {
                    results <- process(item)
                }
            }
        }(i)
    }

    // 等待所有 worker 完成
    go func() {
        wg.Wait()
        close(results)
    }()

    // 收集结果
    var output []int
    for result := range results {
        output = append(output, result)
    }
    return output
}
```

### 14.1.2 Fan-In：多个 channel 合并到一个 channel

```go
// Fan-In：将多个 channel 的数据合并到一个 channel
func fanIn(channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup

    // 为每个输入 channel 启动一个 goroutine
    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan int) {
            defer wg.Done()
            for v := range c {
                out <- v // 转发到输出 channel
            }
        }(ch)
    }

    // 所有输入 channel 关闭后，关闭输出 channel
    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}

// 使用示例
func main() {
    ch1 := produce("source1", []int{1, 2, 3})
    ch2 := produce("source2", []int{4, 5, 6})
    ch3 := produce("source3", []int{7, 8, 9})

    merged := fanIn(ch1, ch2, ch3)

    for v := range merged {
        fmt.Println(v) // 顺序不确定，但所有值都会出现
    }
}

func produce(name string, items []int) <-chan int {
    ch := make(chan int)
    go func() {
        defer close(ch)
        for _, item := range items {
            ch <- item
        }
    }()
    return ch
}
```

### 14.1.3 Fan-Out/Fan-In 组合模式

```go
// 经典模式：分发 → 并行处理 → 合并
func processInParallel(ctx context.Context, input <-chan Request, workerCount int) <-chan Response {
    // Fan-Out：分发到多个 worker
    workers := make([]<-chan Response, workerCount)
    for i := 0; i < workerCount; i++ {
        workers[i] = processWorker(ctx, input)
    }

    // Fan-In：合并所有 worker 的输出
    return fanIn(workers...)
}

func processWorker(ctx context.Context, input <-chan Request) <-chan Response {
    out := make(chan Response)
    go func() {
        defer close(out)
        for req := range input {
            select {
            case <-ctx.Done():
                return
            case out <- handleRequest(req):
            }
        }
    }()
    return out
}
```

---

## 14.2 Pipeline 模式

### 14.2.1 基础 Pipeline

```go
// Pipeline：数据经过多个阶段处理，每个阶段是一个 goroutine
// Stage 1: 生成数据
// Stage 2: 处理数据
// Stage 3: 过滤数据
// Stage 4: 聚合结果

func generate(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case <-ctx.Done():
                return
            case out <- n:
            }
        }
    }()
    return out
}

func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            select {
            case <-ctx.Done():
                return
            case out <- n * n:
            }
        }
    }()
    return out
}

func filter(ctx context.Context, in <-chan int, predicate func(int) bool) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            if predicate(n) {
                select {
                case <-ctx.Done():
                    return
                case out <- n:
                }
            }
        }
    }()
    return out
}

// 组合 Pipeline
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // 生成 → 平方 → 过滤偶数 → 平方
    pipeline := square(
        ctx,
        filter(
            ctx,
            square(ctx, generate(ctx, 1, 2, 3, 4, 5)),
            func(n int) bool { return n%2 == 0 },
        ),
    )

    for v := range pipeline {
        fmt.Println(v) // 16 (2²=4, 4是偶数, 4²=16), 100 (4²=16, 16是偶数, 16²=256)
    }
}
```

### 14.2.2 可扩展的 Pipeline 框架

```go
// 通用的 Pipeline 框架
type Stage[In any, Out any] func(context.Context, <-chan In) <-chan Out

// 连接两个阶段
func Connect[In, Mid, Out any](
    ctx context.Context,
    stage1 Stage[In, Mid],
    stage2 Stage[Mid, Out],
    input <-chan In,
) <-chan Out {
    mid := stage1(ctx, input)
    return stage2(ctx, mid)
}

// 使用
func main() {
    ctx := context.Background()

    input := generate(ctx, 1, 2, 3, 4, 5)

    result := Connect(ctx,
        Stage[int, int](square),
        Stage[int, int](func(ctx context.Context, in <-chan int) <-chan int {
            return filter(ctx, in, func(n int) bool { return n > 5 })
        }),
        input,
    )

    for v := range result {
        fmt.Println(v)
    }
}
```

---

## 14.3 Worker Pool 变体

### 14.3.1 固定大小 Worker Pool

```go
type WorkerPool struct {
    tasks   chan Task
    results chan Result
    wg      sync.WaitGroup
}

type Task struct {
    ID    int
    Data  any
}

type Result struct {
    TaskID int
    Value  any
    Err    error
}

func NewWorkerPool(workerCount, queueSize int) *WorkerPool {
    return &WorkerPool{
        tasks:   make(chan Task, queueSize),
        results: make(chan Result, queueSize),
    }
}

func (p *WorkerPool) Start(worker func(Task) Result) {
    for i := 0; i < cap(p.tasks); i++ {
        // 忽略，workerCount 由调用者控制
    }
    // 实际使用 workerCount
    _ = worker
}

func (p *WorkerPool) Submit(task Task) error {
    select {
    case p.tasks <- task:
        return nil
    default:
        return fmt.Errorf("队列已满")
    }
}

func (p *WorkerPool) Results() <-chan Result {
    return p.results
}
```

### 14.3.2 优雅关停的 Worker Pool

```go
type GracefulPool struct {
    tasks    chan func()
    wg       sync.WaitGroup
    quit     chan struct{}
    closed   atomic.Bool
}

func NewGracefulPool(size int) *GracefulPool {
    p := &GracefulPool{
        tasks: make(chan func(), 100),
        quit:  make(chan struct{}),
    }

    p.wg.Add(size)
    for i := 0; i < size; i++ {
        go p.worker(i)
    }

    return p
}

func (p *GracefulPool) worker(id int) {
    defer p.wg.Done()
    for {
        select {
        case <-p.quit:
            // 退出信号，但先处理完队列中的任务
            for task := range p.tasks {
                task()
            }
            return
        case task, ok := <-p.tasks:
            if !ok {
                return
            }
            task()
        }
    }
}

func (p *GracefulPool) Submit(task func()) error {
    if p.closed.Load() {
        return fmt.Errorf("pool 已关闭")
    }
    select {
    case p.tasks <- task:
        return nil
    default:
        return fmt.Errorf("队列已满")
    }
}

func (p *GracefulPool) Shutdown() {
    p.closed.Store(true)
    close(p.quit) // 通知 worker 退出
    p.wg.Wait()   // 等待所有任务完成
    close(p.tasks)
}
```

### 14.3.3 优先级 Worker Pool

```go
type Priority int

const (
    PriorityLow Priority = iota
    PriorityNormal
    PriorityHigh
)

type PriorityTask struct {
    Priority Priority
    Fn       func()
}

type PriorityPool struct {
    highQ   chan func()
    normalQ chan func()
    lowQ    chan func()
    quit    chan struct{}
    wg      sync.WaitGroup
}

func NewPriorityPool(size int) *PriorityPool {
    p := &PriorityPool{
        highQ:   make(chan func(), 50),
        normalQ: make(chan func(), 100),
        lowQ:    make(chan func(), 200),
        quit:    make(chan struct{}),
    }

    p.wg.Add(size)
    for i := 0; i < size; i++ {
        go p.worker()
    }
    return p
}

func (p *PriorityPool) worker() {
    defer p.wg.Done()
    for {
        select {
        case <-p.quit:
            return
        case fn := <-p.highQ:
            fn()
        default:
            // 高优先级没有任务，检查中低优先级
            select {
            case <-p.quit:
                return
            case fn := <-p.highQ:
                fn()
            case fn := <-p.normalQ:
                fn()
            case fn := <-p.lowQ:
                fn()
            }
        }
    }
}

func (p *PriorityPool) Submit(priority Priority, fn func()) error {
    switch priority {
    case PriorityHigh:
        select {
        case p.highQ <- fn:
            return nil
        default:
            return fmt.Errorf("高优先级队列已满")
        }
    case PriorityNormal:
        select {
        case p.normalQ <- fn:
            return nil
        default:
            return fmt.Errorf("普通队列已满")
        }
    case PriorityLow:
        select {
        case p.lowQ <- fn:
            return nil
        default:
            return fmt.Errorf("低优先级队列已满")
        }
    }
    return nil
}
```

---

## 14.4 限流器（Rate Limiter）

### 14.4.1 令牌桶限流器

```go
import "golang.org/x/time/rate"

func tokenBucketExample() {
    // 每秒产生 10 个令牌，桶容量 5
    limiter := rate.NewLimiter(10, 5)

    for i := 0; i < 20; i++ {
        // Wait 会阻塞直到获取到令牌
        err := limiter.Wait(context.Background())
        if err != nil {
            fmt.Printf("请求 %d: 限流错误 %v\n", i, err)
            continue
        }
        fmt.Printf("请求 %d: 允许\n", i)
    }
}

// 非阻塞版本
func nonBlockingLimiter() {
    limiter := rate.NewLimiter(10, 5)

    for i := 0; i < 20; i++ {
        // Reserve 返回预约信息，不需要立即等待
        r := limiter.Reserve()
        if !r.OK() {
            fmt.Printf("请求 %d: 被拒绝\n", i)
            continue
        }
        // 可以选择延迟执行
        time.Sleep(r.Delay())
        fmt.Printf("请求 %d: 允许\n", i)
    }
}

// 允许/拒绝版本
func allowOrDeny() {
    limiter := rate.NewLimiter(10, 5)

    for i := 0; i < 20; i++ {
        if limiter.Allow() {
            fmt.Printf("请求 %d: 允许\n", i)
        } else {
            fmt.Printf("请求 %d: 拒绝\n", i)
        }
    }
}
```

### 14.4.2 基于 IP 的分布式限流

```go
import (
    "sync"
    "golang.org/x/time/rate"
)

type IPRateLimiter struct {
    ips     map[string]*rate.Limiter
    mu      sync.RWMutex
    rate    rate.Limit
    burst   int
}

func NewIPRateLimiter(r rate.Limit, burst int) *IPRateLimiter {
    return &IPRateLimiter{
        ips:   make(map[string]*rate.Limiter),
        rate:  r,
        burst: burst,
    }
}

func (l *IPRateLimiter) GetLimiter(ip string) *rate.Limiter {
    l.mu.Lock()
    defer l.mu.Unlock()

    limiter, exists := l.ips[ip]
    if !exists {
        limiter = rate.NewLimiter(l.rate, l.burst)
        l.ips[ip] = limiter
    }
    return limiter
}

// Gin 中间件
func RateLimitMiddleware(limiter *IPRateLimiter) gin.HandlerFunc {
    return func(c *gin.Context) {
        ip := c.ClientIP()
        if !limiter.GetLimiter(ip).Allow() {
            c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
                "error": "请求过于频繁",
            })
            return
        }
        c.Next()
    }
}
```

---

## 14.5 熔断器（Circuit Breaker）

### 14.5.1 手动实现熔断器

```go
type State int

const (
    StateClosed   State = iota // 正常
    StateOpen                   // 熔断
    StateHalfOpen               // 半开
)

type CircuitBreaker struct {
    name          string
    state         State
    failures      int
    successes     int
    maxFailures   int
    timeout       time.Duration
    lastFailure   time.Time
    mu            sync.Mutex
    onStateChange func(name string, from, to State)
}

func NewCircuitBreaker(name string, maxFailures int, timeout time.Duration) *CircuitBreaker {
    return &CircuitBreaker{
        name:        name,
        state:       StateClosed,
        maxFailures: maxFailures,
        timeout:     timeout,
    }
}

func (cb *CircuitBreaker) Execute(fn func() error) error {
    cb.mu.Lock()
    state := cb.state
    cb.mu.Unlock()

    switch state {
    case StateOpen:
        // 检查是否可以进入半开状态
        if time.Since(cb.lastFailure) > cb.timeout {
            cb.setState(StateHalfOpen)
            return cb.execute(fn)
        }
        return fmt.Errorf("熔断器 [%s] 已打开", cb.name)

    case StateHalfOpen:
        return cb.execute(fn)

    case StateClosed:
        return cb.execute(fn)
    }

    return nil
}

func (cb *CircuitBreaker) execute(fn func() error) error {
    err := fn()

    cb.mu.Lock()
    defer cb.mu.Unlock()

    if err != nil {
        cb.onFailure()
        return err
    }
    cb.onSuccess()
    return nil
}

func (cb *CircuitBreaker) onSuccess() {
    if cb.state == StateHalfOpen {
        cb.successes++
        if cb.successes >= 3 { // 连续 3 次成功，恢复
            cb.setState(StateClosed)
            cb.failures = 0
            cb.successes = 0
        }
    } else {
        cb.failures = 0 // 重置失败计数
    }
}

func (cb *CircuitBreaker) onFailure() {
    cb.failures++
    cb.lastFailure = time.Now()

    if cb.state == StateHalfOpen {
        cb.setState(StateOpen)
        cb.successes = 0
    } else if cb.failures >= cb.maxFailures {
        cb.setState(StateOpen)
    }
}

func (cb *CircuitBreaker) setState(newState State) {
    if cb.state != newState {
        oldState := cb.state
        cb.state = newState
        if cb.onStateChange != nil {
            cb.onStateChange(cb.name, oldState, newState)
        }
    }
}
```

### 14.5.2 使用 github.com/sony/gobreaker

```go
import "github.com/sony/gobreaker"

func gobreakerExample() {
    cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
        Name:        "api-call",
        MaxRequests: 3,                    // 半开状态允许的最大请求数
        Interval:    10 * time.Second,     // 统计窗口
        Timeout:     30 * time.Second,     // 熔断持续时间
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            // 失败率超过 60% 时触发熔断
            return counts.ConsecutiveFailures >= 5
        },
        OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
            log.Printf("熔断器 [%s] 状态变更: %s → %s", name, from, to)
        },
    })

    // 使用熔断器包装调用
    result, err := cb.Execute(func() (any, error) {
        resp, err := http.Get("https://api.example.com/data")
        if err != nil {
            return nil, err
        }
        defer resp.Body.Close()

        if resp.StatusCode >= 500 {
            return nil, fmt.Errorf("服务端错误: %d", resp.StatusCode)
        }

        return io.ReadAll(resp.Body)
    })

    if err != nil {
        if errors.Is(err, gobreaker.ErrOpenState) {
            log.Println("熔断器已打开，请求被拒绝")
        }
        return
    }

    fmt.Println("结果:", result)
}
```

---

## 14.6 Singleflight

### 14.6.1 防止缓存击穿

```go
import "golang.org/x/sync/singleflight"

type CacheService struct {
    cache   map[string]any
    mu      sync.RWMutex
    group   singleflight.Group
    db      *sql.DB
}

func NewCacheService(db *sql.DB) *CacheService {
    return &CacheService{
        cache: make(map[string]any),
        db:    db,
    }
}

func (s *CacheService) Get(key string) (any, error) {
    // 1. 先查本地缓存
    s.mu.RLock()
    val, ok := s.cache[key]
    s.mu.RUnlock()
    if ok {
        return val, nil
    }

    // 2. 使用 singleflight 合并并发请求
    result, err, _ := s.group.Do(key, func() (any, error) {
        // 只有一个 goroutine 会执行这个函数
        // 其他并发请求会等待同一个结果

        // 再次检查缓存（double-check）
        s.mu.RLock()
        val, ok := s.cache[key]
        s.mu.RUnlock()
        if ok {
            return val, nil
        }

        // 查询数据库
        data, err := s.queryDB(key)
        if err != nil {
            return nil, err
        }

        // 写入缓存
        s.mu.Lock()
        s.cache[key] = data
        s.mu.Unlock()

        return data, nil
    })

    if err != nil {
        return nil, err
    }
    return result, nil
}
```

### 14.6.2 Singleflight 与超时

```go
func (s *CacheService) GetWithTimeout(ctx context.Context, key string) (any, error) {
    // 带超时的 singleflight
    ch := s.group.DoChan(key, func() (any, error) {
        return s.queryDB(key)
    })

    select {
    case result := <-ch:
        if result.Err != nil {
            return nil, result.Err
        }
        return result.Val, nil
    case <-ctx.Done():
        // 超时后忘记这个请求（不影响其他等待者）
        s.group.Forget(key)
        return nil, ctx.Err()
    }
}
```

---

## 14.7 并发安全容器

### 14.7.1 sync.Map

```go
// sync.Map —— 并发安全的 map
// 适用场景：读多写少（如缓存、配置）
// 不适用：写多读少（性能不如 map + mutex）

var sm sync.Map

// 写入
sm.Store("key1", "value1")
sm.Store("key2", 42)

// 读取
val, ok := sm.Load("key1")
if ok {
    fmt.Println(val) // value1
}

// 读取或写入
val, loaded := sm.LoadOrStore("key3", "default")
// loaded=false 表示是新写入的

// 删除
sm.Delete("key1")

// 遍历
sm.Range(func(key, val any) bool {
    fmt.Printf("%v: %v\n", key, val)
    return true // 返回 false 停止遍历
})

// LoadAndDelete —— 读取并删除（原子操作）
val, loaded := sm.LoadAndDelete("key2")
```

### 14.7.2 泛型并发安全 Map

```go
type ConcurrentMap[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}

func NewConcurrentMap[K comparable, V any]() *ConcurrentMap[K, V] {
    return &ConcurrentMap[K, V]{
        m: make(map[K]V),
    }
}

func (cm *ConcurrentMap[K, V]) Get(key K) (V, bool) {
    cm.mu.RLock()
    defer cm.mu.RUnlock()
    val, ok := cm.m[key]
    return val, ok
}

func (cm *ConcurrentMap[K, V]) Set(key K, val V) {
    cm.mu.Lock()
    defer cm.mu.Unlock()
    cm.m[key] = val
}

func (cm *ConcurrentMap[K, V]) Delete(key K) {
    cm.mu.Lock()
    defer cm.mu.Unlock()
    delete(cm.m, key)
}

func (cm *ConcurrentMap[K, V]) Range(fn func(K, V) bool) {
    cm.mu.RLock()
    defer cm.mu.RUnlock()
    for k, v := range cm.m {
        if !fn(k, v) {
            break
        }
    }
}

// Compute —— 原子性的读取-修改-写入
func (cm *ConcurrentMap[K, V]) Compute(key K, fn func(oldVal V, loaded bool) (newVal V, delete bool)) {
    cm.mu.Lock()
    defer cm.mu.Unlock()

    oldVal, loaded := cm.m[key]
    newVal, delete := fn(oldVal, loaded)

    if delete {
        delete(cm.m, key)
    } else {
        cm.m[key] = newVal
    }
}
```

### 14.7.3 分片锁 Map（高并发优化）

```go
// 分片锁 Map：将 map 分成 N 个分片，每个分片独立加锁
// 减少锁竞争，提高并发性能

const shardCount = 32

type Shard[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}

type ShardedMap[K comparable, V any] struct {
    shards [shardCount]*Shard[K, V]
}

func NewShardedMap[K comparable, V any]() *ShardedMap[K, V] {
    sm := &ShardedMap[K, V]{}
    for i := range sm.shards {
        sm.shards[i] = &Shard[K, V]{m: make(map[K]V)}
    }
    return sm
}

// 根据键选择分片
func (sm *ShardedMap[K, V]) getShard(key K) *Shard[K, V] {
    hash := fnv32(fmt.Sprintf("%v", key))
    return sm.shards[hash%shardCount]
}

func fnv32(key string) uint32 {
    hash := uint32(2166136261)
    for i := 0; i < len(key); i++ {
        hash *= 16777619
        hash ^= uint32(key[i])
    }
    return hash
}

func (sm *ShardedMap[K, V]) Get(key K) (V, bool) {
    shard := sm.getShard(key)
    shard.mu.RLock()
    defer shard.mu.RUnlock()
    val, ok := shard.m[key]
    return val, ok
}

func (sm *ShardedMap[K, V]) Set(key K, val V) {
    shard := sm.getShard(key)
    shard.mu.Lock()
    defer shard.mu.Unlock()
    shard.m[key] = val
}

func (sm *ShardedMap[K, V]) Delete(key K) {
    shard := sm.getShard(key)
    shard.mu.Lock()
    defer shard.mu.Unlock()
    delete(shard.m, key)
}
```

---

## 14.8 ErrGroup

### 14.8.1 基础用法

```go
import "golang.org/x/sync/errgroup"

func fetchAll(urls []string) ([]string, error) {
    g, ctx := errgroup.WithContext(context.Background())
    results := make([]string, len(urls))

    for i, url := range urls {
        i, url := i, url // 捕获变量
        g.Go(func() error {
            select {
            case <-ctx.Done():
                return ctx.Err()
            default:
            }

            resp, err := http.Get(url)
            if err != nil {
                return err
            }
            defer resp.Body.Close()

            body, err := io.ReadAll(resp.Body)
            if err != nil {
                return err
            }

            results[i] = string(body)
            return nil
        })
    }

    // 等待所有 goroutine 完成
    // 如果任何一个返回错误，Wait 返回第一个错误
    if err := g.Wait(); err != nil {
        return nil, err
    }

    return results, nil
}
```

### 14.8.2 限制并发的 ErrGroup

```go
func fetchWithLimit(urls []string, concurrency int) ([]string, error) {
    g, ctx := errgroup.WithContext(context.Background())
    g.SetLimit(concurrency) // 限制最大并发数

    var mu sync.Mutex
    var results []string

    for _, url := range urls {
        url := url
        g.Go(func() error {
            select {
            case <-ctx.Done():
                return ctx.Err()
            default:
            }

            resp, err := http.Get(url)
            if err != nil {
                return err
            }
            defer resp.Body.Close()

            body, err := io.ReadAll(resp.Body)
            if err != nil {
                return err
            }

            mu.Lock()
            results = append(results, string(body))
            mu.Unlock()
            return nil
        })
    }

    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

---

## 14.9 并发编排：WaitGroup + Channel + Context 组合

### 14.9.1 优雅的并发任务编排

```go
type TaskGroup struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
    errs   []error
    mu     sync.Mutex
}

func NewTaskGroup(parent context.Context) *TaskGroup {
    ctx, cancel := context.WithCancel(parent)
    return &TaskGroup{ctx: ctx, cancel: cancel}
}

func (g *TaskGroup) Go(fn func(ctx context.Context) error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        if err := fn(g.ctx); err != nil {
            g.mu.Lock()
            g.errs = append(g.errs, err)
            g.mu.Unlock()
            g.cancel() // 一个失败，取消所有
        }
    }()
}

func (g *TaskGroup) Wait() []error {
    g.wg.Wait()
    g.cancel()
    return g.errs
}

// 使用
func main() {
    g := NewTaskGroup(context.Background())

    g.Go(func(ctx context.Context) error {
        return fetchFromServiceA(ctx)
    })

    g.Go(func(ctx context.Context) error {
        return fetchFromServiceB(ctx)
    })

    g.Go(func(ctx context.Context) error {
        return fetchFromServiceC(ctx)
    })

    errs := g.Wait()
    if len(errs) > 0 {
        log.Printf("部分任务失败: %v", errs)
    }
}
```

---

## 小结

| 模式 | 用途 | 关键机制 |
|------|------|---------|
| Fan-In/Fan-Out | 并行分发与合并 | channel + WaitGroup |
| Pipeline | 多阶段数据处理 | channel 链式传递 |
| Worker Pool | 限制并发数 | channel + goroutine |
| 优先级 Pool | 任务优先级调度 | 多级 channel + select |
| 令牌桶限流 | 速率控制 | `golang.org/x/time/rate` |
| 熔断器 | 故障隔离 | 状态机（Closed/Open/HalfOpen） |
| Singleflight | 防缓存击穿 | `golang.org/x/sync/singleflight` |
| sync.Map | 并发安全 map | 读多写少场景 |
| 分片锁 Map | 高并发 map | 分片减少锁竞争 |
| ErrGroup | 并发错误收集 | `golang.org/x/sync/errgroup` |
| TaskGroup | 优雅并发编排 | context + WaitGroup |