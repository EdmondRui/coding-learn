# 第九章：工程化实践

> 掌握 Go 项目从开发到部署的全链路工程化最佳实践。

---

## 9.1 项目布局

### 9.1.1 标准项目结构

Go 官方没有强制目录结构，但社区形成了被广泛认可的布局规范：

```
my-project/
├── cmd/                  # 可执行文件入口
│   └── my-app/
│       └── main.go
├── internal/             # 私有包，外部不可导入
│   ├── handler/
│   ├── service/
│   └── repository/
├── pkg/                  # 可被外部导入的公共库
│   └── validate/
├── api/                  # API 定义文件（protobuf / OpenAPI）
├── configs/              # 配置文件
├── scripts/              # 构建/部署脚本
├── migrations/           # 数据库迁移
├── go.mod
└── go.sum
```

**关键约定：**

| 目录 | 可见性 | 用途 |
|------|--------|------|
| `cmd/` | 仅主程序 | 每个子目录是一个独立的 `main` 包 |
| `internal/` | 项目私有 | Go 编译器限制外部导入 |
| `pkg/` | 公开 | 提供给外部项目使用的库 |

### 9.1.2 Internal 包的可见性

`internal` 包机制是编译期强制约束：

```go
// my-project/internal/service/user.go
package service

func CreateUser(name string) string {
    return "user: " + name
}
```

```go
// my-project/cmd/my-app/main.go
package main

import "my-project/internal/service"

func main() {
    // ✅ 同一模块内可以导入
    println(service.CreateUser("alice"))
}
```

```go
// other-project/main.go —— ❌ 编译错误！
package main

import "my-project/internal/service" // 报错：use of internal package not allowed
```

### 9.1.3 多 main 入口组织

```go
// cmd/server/main.go
package main

import "log"

func main() {
    log.Println("starting server...")
}

// cmd/worker/main.go
package main

import "log"

func main() {
    log.Println("starting worker...")
}
```

构建时分别指定入口：

```bash
go build -o bin/server ./cmd/server
go build -o bin/worker ./cmd/worker
```

### 9.1.4 Go 1.16+ 嵌入文件

使用 `//go:embed` 将静态文件编译进二进制：

```go
package main

import (
    "embed"
    "net/http"
)

//go:embed static/*
var staticFiles embed.FS

//go:embed configs/prod.yaml
var configData []byte

//go:embed templates/*.html
var templateFiles embed.FS

func main() {
    // 从嵌入的文件系统提供静态文件
    http.Handle("/static/", http.FileServer(http.FS(staticFiles)))
    println("config size:", len(configData))
}
```

---

## 9.2 依赖管理

### 9.2.1 Go Modules 基础

从 Go 1.16 起，`GO111MODULE=on` 成为默认。核心文件：

```bash
# 初始化模块
go mod init github.com/yourname/my-project

# 添加依赖（自动更新 go.mod + go.sum）
go get github.com/gin-gonic/gin@v1.9.1

# 整理依赖
go mod tidy

# 查看依赖图
go mod graph

# 下载所有依赖到本地缓存
go mod download
```

生成的 `go.mod`：

```
module github.com/yourname/my-project

go 1.22

require (
    github.com/gin-gonic/gin v1.9.1
    go.uber.org/zap v1.27.0
)

// 间接依赖
require (
    github.com/go-playground/validator/v10 v10.14.0 // indirect
)
```

### 9.2.2 最小版本选择（MVS）

Go 采用 **Minimal Version Selection** 算法——选取所有依赖声明的**最大最小版本**。

```
A → B v1.1, C v1.3
C → B v1.2
最终选 B v1.2（max(1.1, 1.2)）
```

优点：可重现、无冲突。与 npm/yarn 的依赖提升机制完全不同。

### 9.2.3 replace 与 exclude

用于本地开发或临时修复：

```
module my-project

go 1.22

require github.com/example/pkg v1.0.0

// 替换为本地路径——本地开发
replace github.com/example/pkg => ../pkg

// 替换为其他版本或 fork
replace github.com/example/pkg => github.com/myfork/pkg v1.1.0

// 排除有问题的版本
exclude github.com/example/pkg v1.0.0
```

### 9.2.4 私有模块

企业内部的私有仓库需要配置：

```bash
# 告诉 Go 哪些是私有模块，不走 GOPROXY
export GOPRIVATE=github.com/mycompany/*

# 配置 Git 凭证
git config --global url."git@github.com:mycompany".insteadOf "https://github.com/mycompany"

# 若私有模块在 go.sum 有 hash 校验问题
export GONOSUMCHECK=github.com/mycompany/*
export GONOSUMDB=github.com/mycompany/*
```

### 9.2.5 Vendor 模式

需要复现离线构建时使用：

```bash
# 生成 vendor 目录
go mod vendor

# 使用 vendor 构建
go build -mod=vendor ./...
```

`vendor/` 目录应提交到版本控制（CI 环境无外网时）。

---

## 9.3 日志规范

### 9.3.1 slog 结构化日志（Go 1.21+）

Go 标准库自带的 `log/slog` 是现代 Go 应用的首选日志库：

```go
package main

import (
    "context"
    "log/slog"
    "os"
    "time"
)

func main() {
    // JSON 格式，适合生产
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
    slog.SetDefault(logger)

    // 基本用法
    slog.Info("服务启动", "port", 8080, "env", "production")

    // 带错误对象
    slog.Error("请求失败", "error", "connection refused", "retry", 3)
}
```

输出：

```json
{"time":"2026-06-07T10:00:00Z","level":"INFO","msg":"服务启动","port":8080,"env":"production"}
{"time":"2026-06-07T10:00:01Z","level":"ERROR","msg":"请求失败","error":"connection refused","retry":3}
```

### 9.3.2 日志级别

```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelWarn, // 只输出 Warn 及以上
}))

slog.Debug("调试信息")   // 不输出
slog.Info("普通信息")    // 不输出
slog.Warn("警告信息")    // 输出
slog.Error("错误信息")   // 输出
```

自定义级别：

```go
// 定义业务级别
const (
    LevelAudit = slog.Level(8) // 比 Error(8) 更大的值
)

func main() {
    opts := &slog.HandlerOptions{
        Level: slog.LevelInfo,
        // 自定义级别名称
        ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
            if a.Key == slog.LevelKey {
                level := a.Value.Any().(slog.Level)
                if level == LevelAudit {
                    a.Value = slog.StringValue("AUDIT")
                }
            }
            return a
        },
    }
    logger := slog.New(slog.NewJSONHandler(os.Stdout, opts))
    logger.Log(context.Background(), LevelAudit, "用户操作审计", "user_id", 42, "action", "delete")
}
```

### 9.3.3 上下文日志

在请求链路中传递日志属性：

```go
func HandleRequest(ctx context.Context, userID string) {
    // 注入请求维度的属性
    ctx = slog.With(ctx, "request_id", generateID(), "user_id", userID)

    processPayment(ctx, 99.9)
}

func processPayment(ctx context.Context, amount float64) {
    // 自动携带上下文中的属性
    slog.InfoContext(ctx, "处理支付", "amount", amount)
}
```

### 9.3.4 日志轮转

使用 `lumberjack` 实现文件日志轮转：

```go
import (
    "gopkg.in/natefinch/lumberjack.v2"
    "log/slog"
)

func setupLogger() {
    writer := &lumberjack.Logger{
        Filename:   "/var/log/app/app.log",
        MaxSize:    100,   // 每个文件最大 100 MB
        MaxBackups: 30,    // 保留 30 个备份
        MaxAge:     28,    // 保留 28 天
        Compress:   true,  // 启用压缩
    }

    logger := slog.New(slog.NewJSONHandler(writer, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
    slog.SetDefault(logger)
}
```

### 9.3.5 性能考量

```go
// ❌ 不推荐——每次都格式化
slog.Info("计算结果", "value", expensiveCalculation())

// ✅ 推荐——惰性求值
slog.Info("计算结果", "value", slog.AnyValue(func() string {
    return expensiveCalculation()
}))

// ✅ 使用 LogAttrs 避免反射开销
slog.LogAttrs(context.Background(), slog.LevelInfo,
    "批量处理完成",
    slog.Int("count", 1000),
    slog.Duration("elapsed", 250*time.Millisecond),
)
```

**Benchmark 对比：**

| 方式 | 耗时（ns/op） |
|------|-------------|
| `slog.Info("msg", "k", "v")` | ~200 |
| `slog.LogAttrs(..., slog.String("k","v"))` | ~150 |
| `log.Printf` | ~500 |
| `zap.Logger.Info` | ~100 |

---

## 9.4 CI/CD

### 9.4.1 GitHub Actions 完整流程

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: "1.22"
          cache: true

      - name: 缓存 golangci-lint
        uses: actions/cache@v3
        with:
          path: ~/.cache/golangci-lint
          key: golangci-lint-${{ runner.os }}

      - name: Lint
        uses: golangci/golangci-lint-action@v4
        with:
          version: latest
          args: --timeout=5m ./...

      - name: 单元测试
        run: go test -race -coverprofile=coverage.out -covermode=atomic ./...
        env:
          CGO_ENABLED: "0"

      - name: 测试覆盖率检查
        run: |
          go tool cover -func=coverage.out | tail -1
          # 如果覆盖率低于 80% 则失败
          go tool cover -func=coverage.out | awk '/total/ {if ($3 < 80.0) exit 1}'

      - name: 构建验证
        run: go build ./cmd/...
```

### 9.4.2 golangci-lint 配置

```yaml
# .golangci.yml
linters:
  enable:
    - errcheck    # 检查未处理的错误
    - gosimple    # 简化代码
    - govet       # go vet
    - ineffassign # 无效赋值
    - staticcheck # 静态分析
    - misspell    # 拼写检查
    - revive      # 代码风格
    - gosec       # 安全扫描
    - prealloc    # 预分配切片
    - unconvert   # 不必要的类型转换

linters-settings:
  errcheck:
    check-blank: true
  revive:
    rules:
      - name: exported
        severity: warning

issues:
  exclude-rules:
    - path: _test\.go
      linters:
        - errcheck
```

### 9.4.3 Docker 多阶段构建

```dockerfile
# ============ 构建阶段 ============
FROM golang:1.22-alpine AS builder

WORKDIR /src
RUN apk add --no-cache git ca-certificates

# 利用缓存——先复制依赖定义
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o /app ./cmd/server

# ============ 运行阶段 ============
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

# 非 root 用户
RUN adduser -D -u 1001 appuser
USER appuser

WORKDIR /app
COPY --from=builder /app .

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/server"]
```

### 9.4.4 基础镜像选择

| 镜像 | 大小 | 安全 | 适用场景 |
|------|------|------|---------|
| `scratch` | ~2 MB | 最高 | 纯静态编译的 Go 程序 |
| `distroless` | ~20 MB | 高 | 需要 libc 或 ca-certificates |
| `alpine` | ~20 MB | 中 | 需要调试工具（sh、wget） |
| `ubuntu` | ~200 MB | 低 | 需要大量系统依赖 |

```dockerfile
# scratch 示例
FROM scratch
COPY --from=builder /app /app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
ENTRYPOINT ["/app"]

# distroless 示例
FROM gcr.io/distroless/base-debian12
COPY --from=builder /app /app
ENTRYPOINT ["/app"]
```

**编译纯静态二进制：**

```go
// main.go 顶部添加
//go:build netgo

package main

// 编译时确保纯静态链接
// CGO_ENABLED=0 go build -tags netgo -ldflags="-w -s" -o app .
```

---

## 9.5 容器化部署

### 9.5.1 Dockerfile 最佳实践

```dockerfile
# 1. 选择固定标签，拒绝 latest
FROM golang:1.22-alpine3.20 AS builder

# 2. 设置工作目录
WORKDIR /app

# 3. 先复制依赖文件以利用 layer 缓存
COPY go.mod go.sum ./
RUN go mod download

# 4. 复制源码
COPY . .

# 5. 编译优化
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-w -s -X main.version=$(git describe --tags)" \
    -o /app/server ./cmd/server

# 6. 最小运行镜像
FROM alpine:3.20

# 7. 时区与证书
RUN apk add --no-cache tzdata ca-certificates

# 8. 非 root 用户
RUN adduser -D -u 1001 app
USER app

COPY --from=builder /app/server /server

# 9. 健康检查
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD ["/server", "health"]

EXPOSE 8080
ENTRYPOINT ["/server"]
```

### 9.5.2 K8s Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: production
  labels:
    app: my-app
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0     # 零停机更新
      maxSurge: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      terminationGracePeriodSeconds: 30  # 优雅关闭等待时间
      serviceAccountName: my-app
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
      containers:
        - name: app
          image: registry.example.com/my-app:v1.0.0
          imagePullPolicy: Always
          ports:
            - containerPort: 8080
              name: http
            - containerPort: 9090
              name: metrics

          # === 存活探针 ===
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3

          # === 就绪探针 ===
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 2

          # === 启动探针 ===
          startupProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 30

          # === 资源限制 ===
          resources:
            requests:
              cpu: "250m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"

          env:
            - name: GOMAXPROCS
              value: "2"          # 匹配 CPU limit
            - name: TZ
              value: "Asia/Shanghai"
---
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: production
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: http
  type: ClusterIP
```

### 9.5.3 健康检查端点实现

```go
package main

import (
    "context"
    "encoding/json"
    "net/http"
    "sync"
    "time"
)

type HealthChecker struct {
    mu      sync.RWMutex
    ready   bool
    deps    map[string]error
}

func NewHealthChecker() *HealthChecker {
    return &HealthChecker{
        ready: true,
        deps:  make(map[string]error),
    }
}

func (h *HealthChecker) SetReady(ok bool) {
    h.mu.Lock()
    defer h.mu.Unlock()
    h.ready = ok
}

func (h *HealthChecker) ReportDep(name string, err error) {
    h.mu.Lock()
    defer h.mu.Unlock()
    h.deps[name] = err
}

// Liveness: 是否存活（OOM/死锁时停止响应）
func (h *HealthChecker) LivenessHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

// Readiness: 是否就绪（依赖就绪才能接收流量）
func (h *HealthChecker) ReadinessHandler(w http.ResponseWriter, r *http.Request) {
    h.mu.RLock()
    defer h.mu.RUnlock()

    for dep, err := range h.deps {
        if err != nil {
            http.Error(w, dep+": "+err.Error(), http.StatusServiceUnavailable)
            return
        }
    }
    if !h.ready {
        http.Error(w, "not ready", http.StatusServiceUnavailable)
        return
    }
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
```

---

## 9.6 优雅关闭

### 9.6.1 优雅关闭模式

```go
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    // 创建可取消的上下文，捕获 SIGINT/SIGTERM
    ctx, stop := signal.NotifyContext(
        context.Background(),
        syscall.SIGINT,  // Ctrl+C
        syscall.SIGTERM, // K8s 停止信号
    )
    defer stop()

    srv := &http.Server{Addr: ":8080"}

    // 启动 HTTP 服务（goroutine）
    go func() {
        slog.Info("服务启动", "addr", srv.Addr)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            slog.Error("服务异常退出", "error", err)
            os.Exit(1)
        }
    }()

    // 等待中断信号
    <-ctx.Done()
    slog.Info("收到关闭信号，开始优雅关闭...")

    // 创建关闭上下文，设置超时
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    // 优雅关闭——停止接收新连接，等待现有请求完成
    if err := srv.Shutdown(shutdownCtx); err != nil {
        slog.Error("关闭超时，强制退出", "error", err)
        os.Exit(1)
    }

    slog.Info("服务已安全关闭")
}
```

### 9.6.2 完整的企业级优雅关闭

```go
package main

import (
    "context"
    "database/sql"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "sync"
    "syscall"
    "time"
)

type Server struct {
    httpSrv  *http.Server
    db       *sql.DB
    wg       sync.WaitGroup
    shutdown chan struct{}
}

// 信号监听 + 多层资源关闭
func (s *Server) GracefulShutdown(timeout time.Duration) {
    ctx, stop := signal.NotifyContext(
        context.Background(),
        syscall.SIGINT, syscall.SIGTERM,
    )
    defer stop()

    <-ctx.Done()
    slog.Warn("收到退出信号，执行优雅关闭...")

    shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    var wg sync.WaitGroup

    // 1. 关闭 HTTP —— 排空连接
    wg.Add(1)
    go func() {
        defer wg.Done()
        slog.Info("关闭 HTTP 服务...")
        if err := s.httpSrv.Shutdown(shutdownCtx); err != nil {
            slog.Error("HTTP 关闭异常", "error", err)
        }
    }()

    // 2. 关闭数据库连接池 —— 排空活跃查询
    wg.Add(1)
    go func() {
        defer wg.Done()
        slog.Info("关闭数据库连接...")
        if s.db != nil {
            s.db.Close()
        }
    }()

    wg.Wait()

    // 3. 等待业务 Goroutine 完成
    slog.Info("等待业务处理完成...")
    done := make(chan struct{})
    go func() {
        s.wg.Wait()
        close(done)
    }()

    select {
    case <-done:
        slog.Info("所有任务已完成，安全退出")
    case <-shutdownCtx.Done():
        slog.Error("关闭超时，部分任务未完成，强制退出")
    }

    close(s.shutdown)
}
```

### 9.6.3 连接排空示例

```go
// 数据库连接池排空
func drainDB(db *sql.DB, timeout time.Duration) error {
    db.SetMaxOpenConns(0)          // 禁止新连接
    db.SetConnMaxLifetime(timeout) // 现有连接超时后关闭

    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    for {
        stats := db.Stats()
        if stats.OpenConnections == 0 {
            return nil // 所有连接已关闭
        }
        slog.Info("等待数据库连接关闭", "open", stats.OpenConnections,
            "in_use", stats.InUse)

        select {
        case <-ctx.Done():
            return fmt.Errorf("数据库连接排空超时，剩余 %d 个连接", stats.OpenConnections)
        case <-time.After(500 * time.Millisecond):
        }
    }
}

// 消息队列消费者排空
func drainConsumer(consumer Consumer, timeout time.Duration) {
    slog.Info("停止消费者...")
    consumer.Stop() // 停止拉取新消息

    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    done := make(chan struct{})
    go func() {
        consumer.Wait() // 等待正在处理的消息完成
        close(done)
    }()

    select {
    case <-done:
        slog.Info("消费者已安全关闭")
    case <-ctx.Done():
        slog.Error("消费者关闭超时")
    }
}
```

### 9.6.4 超时强制退出

```go
import (
    "os"
    "syscall"
    "time"
)

// graceShutdown 带超时的优雅关闭，超时后强制退出
func graceShutdown(cleanup func(context.Context) error, timeout time.Duration) {
    // 捕获信号
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh

    slog.Warn("收到关闭信号")

    // 创建带超时的上下文
    ctx, cancel := context.WithTimeout(context.Background(), timeout)
    defer cancel()

    // 执行清理
    if err := cleanup(ctx); err != nil {
        slog.Error("清理失败", "error", err)
    }

    // 检查是否超时
    select {
    case <-ctx.Done():
        if ctx.Err() == context.DeadlineExceeded {
            slog.Error("优雅关闭超时，强制退出")
            // 发送 SIGQUIT 触发 goroutine 堆栈转储
            syscall.Kill(syscall.Getpid(), syscall.SIGQUIT)
            os.Exit(1)
        }
    default:
        slog.Info("优雅关闭完成")
    }
}
```

---

## 总结

| 实践 | 核心要点 |
|------|---------|
| **项目布局** | cmd/internal/pkg 三层结构，internal 编译期隔离 |
| **依赖管理** | Go Modules + MVS + replace/GOPRIVATE/vendor |
| **日志规范** | slog 结构化日志，lumberjack 轮转，带上下文属性 |
| **CI/CD** | GitHub Actions + golangci-lint + 多阶段构建 |
| **容器化** | 非 root 用户，健康检查三件套，资源限制 |
| **优雅关闭** | signal.NotifyContext + Shutdown + 超时兜底 |
