# 第三章：错误处理与测试

> 面向有经验的开发者，聚焦 Go 错误设计的哲学与测试体系的实战技巧。

---

## 3.1 error 接口与错误设计

### 3.1.1 error 接口本质

Go 的 error 是一个**内置接口**，仅包含一个方法：

```go
type error interface {
    Error() string
}
```

任何实现了 `Error() string` 的类型都可以作为 error 使用。这是 Go 简洁错误哲学的基石——**错误是值（error is a value）**。

```go
type MyError struct {
    Code    int
    Message string
}

func (e *MyError) Error() string {
    return fmt.Sprintf("code=%d: %s", e.Code, e.Message)
}

func doSomething() error {
    return &MyError{Code: 400, Message: "invalid input"}
}
```

### 3.1.2 Sentinel Error（哨兵错误）

哨兵错误是预定义的包级别错误变量，用于表示**特定的、不可恢复的错误条件**。最经典的例子是 `io.EOF`：

```go
var EOF = errors.New("EOF")

// 使用方通过 == 比较来判断
_, err := reader.Read(buf)
if err == io.EOF {
    break // 正常结束，不是真正的"错误"
}
```

定义哨兵错误的最佳实践：

```go
package db

import "errors"

// 在包级别导出，让调用方可以判断错误类型
var (
    ErrNotFound = errors.New("record not found")
    ErrConflict = errors.New("record already exists")
    ErrForbidden = errors.New("operation forbidden")
)
```

> ⚠️ 哨兵错误的问题：调用方必须依赖你的包，导致**紧耦合**。推荐在库内部使用，对外暴露用自定义类型或行为接口。

### 3.1.3 自定义错误类型

当需要传递**额外上下文**（状态码、错误码、内部错误等）时，定义结构化错误类型：

```go
type ValidationError struct {
    Field   string
    Value   any
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed: %s=%v, %s", e.Field, e.Value, e.Message)
}

// 更好的做法：实现一个接口让调用方行为判断
type Temporary interface {
    Temporary() bool
}

type TimeoutError struct {
    Operation string
    Duration  time.Duration
}

func (e *TimeoutError) Error() string {
    return fmt.Sprintf("%s timed out after %v", e.Operation, e.Duration)
}

func (e *TimeoutError) Temporary() bool { return true }
```

### 3.1.4 errors.Is / errors.As / Unwrap

Go 1.13 引入了错误链的三个核心工具：

| 函数 | 用途 |
|------|------|
| `errors.Is(err, target)` | 判断错误链中是否包含**特定哨兵错误**（== 比较） |
| `errors.As(err, &target)` | 将错误链中某个错误**类型断言**到目标变量 |
| `Unwrap()` | 返回包装的下一层错误（实现错误链） |

```go
var ErrDataCorrupt = errors.New("data corrupt")

type NetworkError struct {
    Err error
    Addr string
}

// 实现 Unwrap 让错误链生效
func (e *NetworkError) Unwrap() error { return e.Err }

func (e *NetworkError) Error() string {
    return fmt.Sprintf("network error at %s: %v", e.Addr, e.Err)
}

func process() error {
    return &NetworkError{
        Err: fmt.Errorf("read: %w", ErrDataCorrupt),
        Addr: ":8080",
    }
}

// --- 调用方使用 ---
err := process()

// errors.Is: 检查链中是否有 ErrDataCorrupt
if errors.Is(err, ErrDataCorrupt) {
    fmt.Println("data is corrupt, retry")
}

// errors.As: 获取链中某个 NetworkError 的详细信息
var nErr *NetworkError
if errors.As(err, &nErr) {
    fmt.Println("address:", nErr.Addr)
}
```

**关键区别**：
- `Is` 用于值比较（sentinel errors）
- `As` 用于类型提取（custom error types）

### 3.1.5 错误包装（fmt.Errorf + %w）

`%w` 是 Go 1.13 引入的错误包装动词，自动创建实现了 `Unwrap()` 的包装错误：

```go
func ReadConfig(path string) error {
    data, err := os.ReadFile(path)
    if err != nil {
        // 包装：保留原始错误，添加上下文
        return fmt.Errorf("read config %s: %w", path, err)
    }
    return parseConfig(data)
}

func Main() error {
    err := ReadConfig("/etc/app.yaml")
    if err != nil {
        // 输出: read config /etc/app.yaml: open /etc/app.yaml: no such file or directory
        fmt.Println(err)

        // 仍然可以解开原始错误
        if errors.Is(err, os.ErrNotExist) {
            fmt.Println("config file does not exist, using defaults")
            return nil
        }
        return err
    }
    return nil
}
```

> ⚠️ 只在需要**上层调用方判断底层错误**时使用 `%w`。如果只是给日志提供上下文而不暴露内部错误，用 `%v` 替代。

---

## 3.2 panic 与 recover

### 3.2.1 什么时候该 panic

Go 的设计哲学：**panic 用于真正的"不可能"状况，而非常规错误处理**。

适合 panic 的场景：

| 场景 | 原因 | 示例 |
|------|------|------|
| 程序初始化失败 | 无法继续运行 | 监听端口失败、数据库连接失败 |
| 不可恢复的不变量 | 代码逻辑有 bug | nil 解引用、数组越界 |
| 类型断言失败（无条件） | 必须保证类型 | `x := val.(Type)` 在已知类型时 |

```go
func MustParse(input string) time.Time {
    t, err := time.Parse(time.RFC3339, input)
    if err != nil {
        // 设计者确定输入必须是合法时间格式，否则是调用方 bug
        panic(fmt.Sprintf("must parse valid time: %v", err))
    }
    return t
}
```

**绝不该 panic 的场景**：
- 用户输入校验（应返回 error）
- 网络超时（应返回 error）
- 文件不存在（应返回 error）

> 一条原则：**你的 panic 不应该被上游 recover 作为业务逻辑的一部分**。

### 3.2.2 recover 的正确用法

`recover` 只在 `defer` 函数中有用，通常用于：

1. **goroutine 的崩溃保护**（让进程继续运行）
2. **框架层面的统一错误恢复**（如 HTTP 中间件）

```go
// 安全的 goroutine 启动函数
func GoSafe(fn func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                // 记录堆栈，防止进程崩溃
                log.Printf("goroutine panic recovered: %v\nstack: %s",
                    r, debug.Stack())
            }
        }()
        fn()
    }()
}
```

HTTP 中间件中的 recover：

```go
func RecoveryMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if err := recover(); err != nil {
                log.Printf("panic recovered: %v", err)
                http.Error(w, "Internal Server Error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

### 3.2.3 panic 在库中的使用规范

如果编写一个库，遵循以下规范：

```go
// 好：库内部用 panic 只发生在不可恢复状况
func (p *Parser) MustParse(input string) AST {
    ast, err := p.Parse(input)
    if err != nil {
        panic(fmt.Sprintf("must parse: %v", err))
    }
    return ast
}

// 好：库函数总返回 error，不 panic
func (p *Parser) Parse(input string) (AST, error) {
    // ... 正常解析逻辑
    return ast, nil
}

// 坏：库函数非法输入时 panic
func (p *Parser) Parse(input string) AST {
    if len(input) == 0 {
        panic("empty input") // ❌ 调用方无法优雅处理
    }
    // ...
}
```

**库的原则**：
- 导出的函数尽可能返回 `error`，而非 panic
- 只有 `Must*` 前缀的函数才允许 panic
- **绝不从库跨越边界 panic 到调用方**

---

## 3.3 错误处理模式

### 3.3.1 错误链

错误链用于逐层添加上下文，保留根因：

```go
type AppError struct {
    Op     string // 操作名称
    Kind   string // 错误类别（"network", "validation", "database"）
    Err    error  // 底层错误
}

func (e *AppError) Error() string {
    return fmt.Sprintf("%s: %s: %v", e.Op, e.Kind, e.Err)
}

func (e *AppError) Unwrap() error { return e.Err }

// 使用
func (s *Service) CreateUser(ctx context.Context, req *CreateUserReq) error {
    user, err := s.db.InsertUser(ctx, req)
    if err != nil {
        return &AppError{Op: "CreateUser", Kind: "database", Err: err}
    }
    // ...
    return nil
}
```

### 3.3.2 业务错误码

在 HTTP API / gRPC 服务中，通常需要结构化错误码：

```go
type BizError struct {
    HTTPCode int    `json:"-"`        // HTTP 状态码，不对外暴露
    Code     string `json:"code"`      // 业务错误码
    Message  string `json:"message"`   // 用户可读信息
    Details  any    `json:"details,omitempty"` // 额外详情
}

func (e *BizError) Error() string {
    return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// 预定义业务错误
var (
    ErrUserNotFound  = &BizError{HTTPCode: 404, Code: "USER_NOT_FOUND", Message: "用户不存在"}
    ErrInvalidParams = &BizError{HTTPCode: 400, Code: "INVALID_PARAMS", Message: "参数错误"}
    ErrNoPermission  = &BizError{HTTPCode: 403, Code: "NO_PERMISSION", Message: "无权限"}
)

// 在 HTTP handler 中使用
func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
    user, err := h.svc.GetUser(r.Context(), r.URL.Query().Get("id"))
    if err != nil {
        var biz *BizError
        if errors.As(err, &biz) {
            // 返回结构化的 JSON 错误
            w.WriteHeader(biz.HTTPCode)
            json.NewEncoder(w).Encode(biz)
            return
        }
        // 未知错误返回 500
        w.WriteHeader(http.StatusInternalServerError)
        json.NewEncoder(w).Encode(map[string]string{"code": "INTERNAL", "message": "服务器内部错误"})
        return
    }
    json.NewEncoder(w).Encode(user)
}
```

### 3.3.3 错误分组（errors.Join）

Go 1.20 引入了 `errors.Join`，将多个错误合并为一个：

```go
func Validate(input *SignupReq) error {
    var errs []error

    if input.Name == "" {
        errs = append(errs, fmt.Errorf("name is required"))
    }
    if len(input.Password) < 8 {
        errs = append(errs, fmt.Errorf("password must be at least 8 chars"))
    }
    if !strings.Contains(input.Email, "@") {
        errs = append(errs, fmt.Errorf("invalid email"))
    }

    // 一次性返回所有校验错误
    return errors.Join(errs...)
}

// 调用方
err := Validate(req)
if err != nil {
    fmt.Println(err) // 输出所有错误，每行一个
}
```

### 3.3.4 多错误处理（错误收集器）

在需要"继续执行，但收集所有错误"的场景：

```go
// 清理任务：即使某个步骤失败，也要继续执行后续清理
func CleanupResources(resources []Resource) error {
    var errs []error
    for _, r := range resources {
        if err := r.Close(); err != nil {
            // 记录错误，但继续执行
            errs = append(errs, fmt.Errorf("close %s: %w", r.ID(), err))
        }
    }
    // 用 Go 1.20 的 errors.Join
    return errors.Join(errs...)
}

// 批量处理：收集所有错误后统一返回
func BatchProcess(items []Item) []error {
    var errs []error
    for i, item := range items {
        if err := processItem(item); err != nil {
            errs = append(errs, fmt.Errorf("item[%d]: %w", i, err))
        }
    }
    return errs
}
```

---

## 3.4 测试框架

### 3.4.1 testing 包基础

Go 内置 `testing` 包，无需第三方框架。测试文件命名 `*_test.go`，测试函数签名 `func TestXxx(t *testing.T)`：

```go
// math.go
func Add(a, b int) int { return a + b }
func Divide(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("division by zero")
    }
    return a / b, nil
}

// math_test.go
func TestAdd(t *testing.T) {
    got := Add(1, 2)
    want := 3
    if got != want {
        t.Errorf("Add(1, 2) = %d; want %d", got, want)
    }
}

func TestDivide(t *testing.T) {
    got, err := Divide(10, 2)
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    if got != 5 {
        t.Errorf("got %d, want 5", got)
    }
}

func TestDivideByZero(t *testing.T) {
    _, err := Divide(10, 0)
    if err == nil {
        t.Error("expected error, got nil")
    }
}
```

测试辅助方法：

| 方法 | 行为 | 适用 |
|------|------|------|
| `t.Error(args...)` | 记录失败，继续执行 | 多断言场景 |
| `t.Errorf(fmt, args...)` | 格式化失败记录，继续执行 | 带格式的失败信息 |
| `t.Fatal(args...)` | 记录失败，立即终止 | 前置条件失败 |
| `t.Fatalf(fmt, args...)` | 格式化失败，立即终止 | 初始化失败 |
| `t.Log(args...)` | 仅在 `-v` 模式下输出 | 调试信息 |
| `t.Cleanup(fn)` | 注册清理函数，测试结束时执行 | 资源清理 |

### 3.4.2 表驱动测试（Table-Driven Tests）

Go 社区最推崇的测试模式——将测试用例组织为表格：

```go
func TestAddTableDriven(t *testing.T) {
    tests := []struct {
        name string
        a, b int
        want int
    }{
        {"positive", 1, 2, 3},
        {"negative", -1, -2, -3},
        {"zero", 0, 0, 0},
        {"mixed", 1, -1, 0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := Add(tt.a, tt.b)
            if got != tt.want {
                t.Errorf("Add(%d, %d) = %d; want %d", tt.a, tt.b, got, tt.want)
            }
        })
    }
}
```

带错误的表驱动测试：

```go
func TestDivideTableDriven(t *testing.T) {
    tests := []struct {
        name    string
        a, b    int
        want    int
        wantErr bool
    }{
        {"normal", 10, 2, 5, false},
        {"divide by one", 10, 1, 10, false},
        {"divide by zero", 10, 0, 0, true},
        {"negative", -10, 2, -5, false},
        {"fraction truncate", 5, 2, 2, false}, // 整数除法截断
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := Divide(tt.a, tt.b)
            if (err != nil) != tt.wantErr {
                t.Errorf("Divide(%d, %d) error = %v, wantErr = %v", tt.a, tt.b, err, tt.wantErr)
                return
            }
            if got != tt.want {
                t.Errorf("Divide(%d, %d) = %d; want %d", tt.a, tt.b, got, tt.want)
            }
        })
    }
}
```

### 3.4.3 子测试（t.Run）

子测试提供嵌套的执行范围和独立的设置/清理：

```go
func TestUserService(t *testing.T) {
    // 共享设置
    db := setupTestDB(t)
    svc := NewUserService(db)

    // 清理所有子测试完成后执行
    t.Cleanup(func() {
        db.Close()
    })

    t.Run("create user", func(t *testing.T) {
        user, err := svc.CreateUser("alice@example.com")
        if err != nil {
            t.Fatal(err)
        }
        if user.Email != "alice@example.com" {
            t.Errorf("got %s, want alice@example.com", user.Email)
        }
    })

    t.Run("find user", func(t *testing.T) {
        user, err := svc.FindUser("alice@example.com")
        if err != nil {
            t.Fatal(err)
        }
        if user == nil {
            t.Fatal("expected user, got nil")
        }
    })

    t.Run("delete user", func(t *testing.T) {
        err := svc.DeleteUser("alice@example.com")
        if err != nil {
            t.Fatal(err)
        }
    })
}
```

运行测试的子集：

```bash
go test -v -run "TestUserService/create" # 只运行 create 子测试
go test -v -run "TestUserService"         # 运行所有子测试
```

### 3.4.4 TestMain

`TestMain` 是测试的**入口点**，用于全局设置和清理：

```go
func TestMain(m *testing.M) {
    // 全局设置：启动测试数据库、创建临时文件等
    setup()
    defer teardown()

    // m.Run() 执行所有测试，返回退出码
    code := m.Run()
    // 退出前清理
    os.Exit(code)
}

func setup() {
    log.Println("=== 初始化测试环境 ===")
    // 连接测试数据库
    // 创建测试表
    // 准备测试数据
}

func teardown() {
    log.Println("=== 清理测试环境 ===")
    // 清理测试数据
    // 关闭连接
}
```

> 注意：一个包只能有一个 `TestMain`。

### 3.4.5 测试初始化与清理（t.Cleanup）

Go 1.14+ 不再需要用 defer 清理，`t.Cleanup` 更灵活：

```go
func TestWithTempFile(t *testing.T) {
    f, err := os.CreateTemp("", "test-*")
    if err != nil {
        t.Fatal(err)
    }
    // 注册清理函数，测试结束自动执行
    t.Cleanup(func() {
        os.Remove(f.Name())
        f.Close()
    })

    // 使用 f 进行测试
    f.WriteString("test data")
    f.Sync()
    // ...
}
```

**Cleanup vs Defer**：
- `defer`：在函数返回时执行，处理一个函数内的多个清理
- `t.Cleanup`：在测试结束时执行，即使子测试失败也会执行，适合 helper 函数中使用

---

## 3.5 高级测试

### 3.5.1 Benchmark（基准测试）

基准测试函数签名 `func BenchmarkXxx(b *testing.B)`，用于衡量代码性能：

```go
// 字符串拼接性能对比
func BenchmarkConcatWithPlus(b *testing.B) {
    // b.N 由框架自动调整，保证足够的运行时间
    for i := 0; i < b.N; i++ {
        s := ""
        for j := 0; j < 100; j++ {
            s += "a"
        }
    }
}

func BenchmarkConcatWithBuilder(b *testing.B) {
    for i := 0; i < b.N; i++ {
        var sb strings.Builder
        for j := 0; j < 100; j++ {
            sb.WriteString("a")
        }
        _ = sb.String()
    }
}

// 运行: go test -bench=. -benchmem
// 输出示例:
// BenchmarkConcatWithPlus-8        1000000   1234 ns/op   536 B/op   8 allocs/op
// BenchmarkConcatWithBuilder-8    5000000    234 ns/op    56 B/op    2 allocs/op
```

高级 benchmark 技巧：

```go
// 1. 重置计时器——排除初始化时间
func BenchmarkComplex(b *testing.B) {
    data := generateLargeDataset() // 预处理不计入
    b.ResetTimer()

    for i := 0; i < b.N; i++ {
        process(data)
    }
}

// 2. 并行基准测试
func BenchmarkParallel(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            doWork()
        }
    })
}

// 3. 跳过基准测试
func BenchmarkSkipped(b *testing.B) {
    if testing.Short() {
        b.Skip("skipping benchmark in short mode")
    }
    for i := 0; i < b.N; i++ {
        heavyComputation()
    }
}
```

### 3.5.2 pprof 性能分析

Go 内置 pprof 用于 CPU 和内存分析：

```go
import (
    "net/http"
    _ "net/http/pprof" // 注册 pprof handler
)

func main() {
    // 启动 pprof HTTP 服务
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()
    // ... 应用代码
}
```

命令行使用：

```bash
# 生成 CPU profile
go test -bench=. -cpuprofile=cpu.out ./...
go tool pprof -http=:8080 cpu.out

# 生成内存 profile
go test -bench=. -memprofile=mem.out ./...
go tool pprof -http=:8081 mem.out

# 通过 HTTP 获取运行中应用的 profile
go tool pprof http://localhost:6060/debug/pprof/heap
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
```

### 3.5.3 Fuzzing（模糊测试）

Go 1.18 原生支持 fuzzing，函数签名 `func FuzzXxx(f *testing.F)`：

```go
// 被测试函数：反转字符串
func Reverse(s string) string {
    runes := []rune(s)
    for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
        runes[i], runes[j] = runes[j], runes[i]
    }
    return string(runes)
}

// 模糊测试——自动生成随机输入
func FuzzReverse(f *testing.F) {
    // seed corpus：初始种子输入
    f.Add("hello")
    f.Add("世界")
    f.Add("123!@#")

    f.Fuzz(func(t *testing.T, s string) {
        reversed := Reverse(s)
        doubleReversed := Reverse(reversed)

        // 性质：两次反转应等于原字符串
        if s != doubleReversed {
            t.Errorf("double reverse failed: input=%q, got=%q", s, doubleReversed)
        }

        // 性质：反转后不应产生无效 UTF-8
        if !utf8.ValidString(reversed) {
            t.Errorf("reversed string is invalid UTF-8: %q", reversed)
        }
    })
}
```

```bash
# 运行模糊测试（无限运行直到找到崩溃）
go test -fuzz=FuzzReverse -fuzztime=30s

# 使用已有的 crash 文件复现
go test -run=FuzzReverse/6a2f6c9a0b
```

### 3.5.4 测试覆盖率

Go 内置覆盖率工具：

```bash
# 运行测试并生成覆盖率数据
go test -coverprofile=coverage.out ./...

# 查看覆盖率百分比
go test -cover ./...

# 浏览器查看详细覆盖率（红色=未覆盖，绿色=覆盖）
go tool cover -html=coverage.out -o coverage.html

# 只看某个包的覆盖率
go test -coverprofile=coverage.out ./internal/service/...

# 按函数查看覆盖率
go tool cover -func=coverage.out
```

在 CI 中设置覆盖率门限：

```go
// coverage_test.go
func TestCoverage(t *testing.T) {
    // 自定义方式计算包覆盖率
    // 实际上通过 CI 工具（如 codecov, sonar）更常见
}
```

### 3.5.5 Mock 与接口测试

Go 推崇**接口 + 依赖注入**实现可测试性：

```go
// --- 定义接口 ---
type UserRepository interface {
    FindByID(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, user *User) error
}

type UserService struct {
    repo UserRepository
}

func NewUserService(repo UserRepository) *UserService {
    return &UserService{repo: repo}
}

// --- 测试 mock ---
type mockRepo struct {
    users map[string]*User
}

func (m *mockRepo) FindByID(_ context.Context, id string) (*User, error) {
    user, ok := m.users[id]
    if !ok {
        return nil, ErrUserNotFound
    }
    return user, nil
}

func (m *mockRepo) Save(_ context.Context, user *User) error {
    m.users[user.ID] = user
    return nil
}

func TestUserService_FindByID(t *testing.T) {
    repo := &mockRepo{users: map[string]*User{
        "1": {ID: "1", Name: "Alice"},
    }}
    svc := NewUserService(repo)

    user, err := svc.FindByID(context.Background(), "1")
    if err != nil {
        t.Fatal(err)
    }
    if user.Name != "Alice" {
        t.Errorf("got %s, want Alice", user.Name)
    }

    // 测试不存在的用户
    _, err = svc.FindByID(context.Background(), "999")
    if !errors.Is(err, ErrUserNotFound) {
        t.Errorf("expected ErrUserNotFound, got %v", err)
    }
}
```

使用 mock 库（如 `gomock`、`testify/mock`）进一步简化：

```go
// 使用 testify/mock
type MockRepository struct {
    mock.Mock
}

func (m *MockRepository) FindByID(ctx context.Context, id string) (*User, error) {
    args := m.Called(ctx, id)
    return args.Get(0).(*User), args.Error(1)
}

func TestWithMock(t *testing.T) {
    repo := new(MockRepository)
    repo.On("FindByID", mock.Anything, "1").Return(&User{ID: "1", Name: "Alice"}, nil)

    svc := NewUserService(repo)
    user, err := svc.FindByID(context.Background(), "1")
    assert.NoError(t, err)
    assert.Equal(t, "Alice", user.Name)
    repo.AssertExpectations(t)
}
```

---

## 3.6 测试实践

### 3.6.1 测试文件组织

推荐的测试文件组织结构：

```
project/
├── internal/
│   ├── handler/
│   │   ├── user.go
│   │   ├── user_test.go        # 单元测试
│   │   └── user_integration_test.go  # 集成测试（编译标签）
│   ├── service/
│   │   ├── user.go
│   │   └── user_test.go
│   └── repository/
│       ├── user.go
│       └── user_test.go
├── test/
│   ├── testutil/               # 测试工具函数
│   │   ├── db.go               # 测试数据库 helper
│   │   ├── fixture.go           # 测试夹具
│   │   └── golden.go           # golden file helper
│   ├── integration/            # 多包集成测试
│   │   └── api_test.go
│   └── testdata/               # 测试数据文件
│       ├── fixtures/           # 测试夹具数据
│       └── golden/             # golden file 期望输出
└── go.mod
```

编译标签隔离集成测试：

```go
// user_integration_test.go 第一行：
//go:build integration

package handler

func TestUserIntegration(t *testing.T) {
    // 只在 go test -tags=integration 时运行
}
```

### 3.6.2 Golden File 测试

将预期输出保存到文件，避免在测试代码中硬编码长篇字符串：

```go
package testutil

import (
    "bytes"
    "os"
    "path/filepath"
    "testing"
)

// UpdateGolden = go test -update 时更新 golden 文件
var UpdateGolden = os.Getenv("UPDATE_GOLDEN") == "true"

func AssertGolden(t *testing.T, name string, actual []byte) {
    t.Helper()
    goldenPath := filepath.Join("testdata", "golden", name+".golden")

    if UpdateGolden {
        os.MkdirAll(filepath.Dir(goldenPath), 0755)
        if err := os.WriteFile(goldenPath, actual, 0644); err != nil {
            t.Fatalf("writing golden file: %v", err)
        }
        return
    }

    expected, err := os.ReadFile(goldenPath)
    if err != nil {
        t.Fatalf("reading golden file %s: %v", goldenPath, err)
    }
    if !bytes.Equal(expected, actual) {
        t.Errorf("output mismatch for %s\n--- expected\n+++ actual\n%s",
            name, diff.Diff(string(expected), string(actual)))
    }
}
```

使用方式：

```go
func TestRenderHTML(t *testing.T) {
    result := renderUserPage(&User{Name: "Alice"})
    testutil.AssertGolden(t, "user_page", result)
}

// 更新 golden 文件：
// UPDATE_GOLDEN=true go test -run=TestRenderHTML
```

### 3.6.3 单元测试 vs 集成测试

| 维度 | 单元测试 | 集成测试 |
|------|----------|----------|
| 范围 | 单个函数/方法 | 多个组件协作 |
| 外部依赖 | Mock/Stub | 真实数据库、HTTP 服务 |
| 速度 | 毫秒级 | 秒级 |
| 稳定性 | 高（不受环境干扰） | 低（依赖外部服务） |
| 定位错误 | 精准 | 模糊 |

```go
// 单元测试：不依赖数据库
func TestOrderService_CalculateTotal(t *testing.T) {
    svc := NewOrderService(nil) // 不需要 repo
    total := svc.CalculateTotal([]Item{{Price: 100, Qty: 2}})
    if total != 200 {
        t.Errorf("got %d, want 200", total)
    }
}

// 集成测试：依赖真实数据库
//go:build integration
func TestOrderService_CreateOrder(t *testing.T) {
    db := testutil.NewTestDB(t) // 创建测试数据库
    svc := NewOrderService(db)

    order, err := svc.CreateOrder(context.Background(), &CreateOrderReq{
        UserID: "user-1",
        Items:  []Item{{ProductID: "prod-1", Qty: 1}},
    })
    if err != nil {
        t.Fatal(err)
    }
    if order.ID == "" {
        t.Error("expected order ID to be generated")
    }
}
```

### 3.6.4 测试 HTTP Handler

测试 HTTP handler 的三种方式：

```go
// 方式一：httptest.Recorder（推荐）
func TestUserHandler_GetUser(t *testing.T) {
    handler := NewUserHandler(NewUserService(newMockRepo()))

    req := httptest.NewRequest("GET", "/users/1", nil)
    rec := httptest.NewRecorder()

    handler.ServeHTTP(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
    }

    var resp UserResponse
    if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
        t.Fatal(err)
    }
    if resp.Name != "Alice" {
        t.Errorf("name = %s, want Alice", resp.Name)
    }
}

// 方式二：httptest.Server（测试完整路由和中间件）
func TestUserHandler_WithRouter(t *testing.T) {
    handler := NewUserHandler(NewUserService(newMockRepo()))
    mux := http.NewServeMux()
    mux.Handle("GET /api/users/{id}", handler)

    ts := httptest.NewServer(mux)
    defer ts.Close()

    resp, err := http.Get(ts.URL + "/api/users/1")
    if err != nil {
        t.Fatal(err)
    }
    defer resp.Body.Close()
    // 断言...
}

// 方式三：表驱动测试 HTTP handler
func TestUserHandler_GetUserTable(t *testing.T) {
    tests := []struct {
        name       string
        userID     string
        wantStatus int
        wantName   string
    }{
        {"existing user", "1", http.StatusOK, "Alice"},
        {"not found", "999", http.StatusNotFound, ""},
        {"invalid id", "abc", http.StatusBadRequest, ""},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            handler := NewUserHandler(NewUserService(newMockRepo()))
            req := httptest.NewRequest("GET", "/users/"+tt.userID, nil)
            rec := httptest.NewRecorder()
            handler.ServeHTTP(rec, req)

            if rec.Code != tt.wantStatus {
                t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
            }
            if tt.wantName != "" {
                var resp UserResponse
                json.Unmarshal(rec.Body.Bytes(), &resp)
                if resp.Name != tt.wantName {
                    t.Errorf("name = %s, want %s", resp.Name, tt.wantName)
                }
            }
        })
    }
}
```

---

## 小结

| 概念 | 关键要点 |
|------|----------|
| **错误设计** | error 是接口；sentinel errors 用 `errors.Is`，自定义类型用 `errors.As`；`%w` 用于错误包装 |
| **Panic** | 仅"不可能"状况使用 panic；recover 只在 defer 中有效；库不向调用方传播 panic |
| **测试框架** | 表驱动测试是 Go 标准；`t.Run` 组织子测试；`TestMain` 做全局设置 |
| **高级测试** | benchmark 关注 ns/op 和 allocs/op；fuzzing 自动发现边界；mock 通过接口注入 |
| **测试实践** | golden file 管理长输出；编译标签隔离集成测试；httptest 测试 HTTP handler |
