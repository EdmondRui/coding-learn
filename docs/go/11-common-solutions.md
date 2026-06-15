# 第 11 章：常见技术解决方案

> 目标读者：掌握 Go 基础语法与 Web 开发经验的开发者，聚焦实际项目中的高频技术方案与最佳实践。

---

## 11.1 JWT 认证与授权

JWT（JSON Web Token）是目前最流行的无状态认证方案。本节使用 [`golang-jwt/jwt/v5`](https://github.com/golang-jwt/jwt) 实现令牌的生成、验证及中间件集成。

### 11.1.1 Token 生成与验证

```go
package main

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// 自定义 Claims，嵌入标准 Claims
type CustomClaims struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// 密钥（生产环境从配置或密钥管理服务获取）
var jwtSecret = []byte("your-256-bit-secret")

// GenerateToken 生成 JWT access token
func GenerateToken(userID int64, username, role string) (string, error) {
	claims := CustomClaims{
		UserID:   userID,
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)), // 过期时间
			IssuedAt:  jwt.NewNumericDate(time.Now()),                     // 签发时间
			NotBefore: jwt.NewNumericDate(time.Now()),                     // 生效时间
			Issuer:    "my-app",
			Subject:   fmt.Sprint(userID),
			ID:        fmt.Sprintf("%d", time.Now().UnixNano()), // jti，用于防重放
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// ParseToken 解析并验证 JWT token
func ParseToken(tokenStr string) (*CustomClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &CustomClaims{}, func(t *jwt.Token) (interface{}, error) {
		// 验证签名算法是否匹配
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*CustomClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

func main() {
	// 生成 token
	token, err := GenerateToken(1001, "alice", "admin")
	if err != nil {
		panic(err)
	}
	fmt.Println("Generated token:", token)

	// 验证 token
	claims, err := ParseToken(token)
	if err != nil {
		panic(err)
	}
	fmt.Printf("Valid claims: UserID=%d, Username=%s, Role=%s\n", claims.UserID, claims.Username, claims.Role)
}
```

### 11.1.2 HTTP 中间件集成

```go
package main

import (
	"context"
	"log"
	"net/http"
	"strings"
)

type contextKey string

const claimsKey contextKey = "claims"

// JWTMiddleware 保护需要认证的路由
func JWTMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 从 Authorization 头提取 token
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
			return
		}

		// 支持 "Bearer <token>" 格式
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, `{"error":"invalid authorization format"}`, http.StatusUnauthorized)
			return
		}

		claims, err := ParseToken(parts[1])
		if err != nil {
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}

		// 将用户信息注入请求上下文
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetClaims 从请求上下文获取 JWT claims
func GetClaims(r *http.Request) *CustomClaims {
	claims, _ := r.Context().Value(claimsKey).(*CustomClaims)
	return claims
}

func adminHandler(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r)
	if claims == nil || claims.Role != "admin" {
		http.Error(w, `{"error":"admin only"}`, http.StatusForbidden)
		return
	}
	w.Write([]byte(`{"message":"welcome admin"}`))
}

func main() {
	mux := http.NewServeMux()
	mux.Handle("/api/admin", JWTMiddleware(http.HandlerFunc(adminHandler)))
	mux.HandleFunc("/api/public", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"message":"public endpoint"}`))
	})

	log.Println("Server starting on :8080")
	http.ListenAndServe(":8080", mux)
}
```

> **要点总结：**
> - Claims 中应只包含核心身份信息，避免存入敏感数据
> - 签名密钥必须足够复杂且定期轮换
> - Token 过期时间权衡安全性与用户体验，一般 access token 15 分钟~2 小时
> - 如需主动吊销，配合黑名单（Redis set）或使用 refresh token 机制

---

## 11.2 限流（Rate Limiting）

限流是保护服务不被突发流量打垮的关键手段。常见的算法有令牌桶、滑动窗口和基于 Redis 的分布式限流。

### 11.2.1 令牌桶（Token Bucket）

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// TokenBucket 令牌桶限流器
type TokenBucket struct {
	rate       float64       // 每秒放入的令牌数
	burst      int           // 桶容量
	tokens     float64       // 当前令牌数
	lastRefill time.Time     // 上次补充时间
	mu         sync.Mutex
}

func NewTokenBucket(rate float64, burst int) *TokenBucket {
	return &TokenBucket{
		rate:       rate,
		burst:      burst,
		tokens:     float64(burst),
		lastRefill: time.Now(),
	}
}

// refill 按时间间隔补充令牌
func (tb *TokenBucket) refill() {
	now := time.Now()
	elapsed := now.Sub(tb.lastRefill).Seconds()
	tb.tokens += elapsed * tb.rate
	if tb.tokens > float64(tb.burst) {
		tb.tokens = float64(tb.burst)
	}
	tb.lastRefill = now
}

// Allow 判断是否允许通过
func (tb *TokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	tb.refill()
	if tb.tokens >= 1 {
		tb.tokens--
		return true
	}
	return false
}

// AllowN 判断是否允许 n 个请求通过
func (tb *TokenBucket) AllowN(n int) bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	tb.refill()
	if tb.tokens >= float64(n) {
		tb.tokens -= float64(n)
		return true
	}
	return false
}

func main() {
	// 每秒 10 个请求，突发 20 个
	limiter := NewTokenBucket(10, 20)

	for i := 0; i < 30; i++ {
		if limiter.Allow() {
			fmt.Printf("Request %2d: ✅ allowed\n", i+1)
		} else {
			fmt.Printf("Request %2d: ❌ rate limited\n", i+1)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
```

### 11.2.2 滑动窗口（Sliding Window）

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// SlidingWindow 滑动窗口限流器
type SlidingWindow struct {
	mu        sync.Mutex
	window    time.Duration // 窗口大小
	maxReq    int           // 窗口内最大请求数
	timestamps []time.Time  // 请求时间戳列表
}

func NewSlidingWindow(window time.Duration, maxReq int) *SlidingWindow {
	return &SlidingWindow{
		window:    window,
		maxReq:    maxReq,
		timestamps: make([]time.Time, 0, maxReq),
	}
}

// Allow 判断是否允许请求
func (sw *SlidingWindow) Allow() bool {
	sw.mu.Lock()
	defer sw.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-sw.window)

	// 移除窗口外的时间戳
	cutoff := 0
	for i, t := range sw.timestamps {
		if t.After(windowStart) {
			break
		}
		cutoff = i + 1
	}
	sw.timestamps = sw.timestamps[cutoff:]

	// 检查请求数是否达到上限
	if len(sw.timestamps) >= sw.maxReq {
		return false
	}

	sw.timestamps = append(sw.timestamps, now)
	return true
}

func main() {
	// 1 秒内最多 5 个请求
	limiter := NewSlidingWindow(1*time.Second, 5)

	for i := 0; i < 10; i++ {
		if limiter.Allow() {
			fmt.Printf("Request %2d: ✅ allowed\n", i+1)
		} else {
			fmt.Printf("Request %2d: ❌ rate limited\n", i+1)
		}
		time.Sleep(150 * time.Millisecond)
	}
}
```

### 11.2.3 基于 Redis 的分布式限流

```go
package main

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisSlidingWindow 基于 Redis 有序集合的滑动窗口限流
type RedisSlidingWindow struct {
	client  *redis.Client
	window  time.Duration
	maxReq  int
}

func NewRedisSlidingWindow(client *redis.Client, window time.Duration, maxReq int) *RedisSlidingWindow {
	return &RedisSlidingWindow{
		client: client,
		window: window,
		maxReq: maxReq,
	}
}

// Allow 判断 key 对应的请求者是否允许通过
func (rsw *RedisSlidingWindow) Allow(ctx context.Context, key string) (bool, error) {
	now := time.Now().UnixMilli()
	windowStart := now - rsw.window.Milliseconds()

	pipe := rsw.client.Pipeline()

	// 移除窗口外的旧记录
	pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprint(windowStart))
	// 添加当前请求
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: now})
	// 设置 TTL 防止内存泄漏
	pipe.Expire(ctx, key, rsw.window)
	// 统计窗口内请求数
	countCmd := pipe.ZCard(ctx, key)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return false, err
	}

	return countCmd.Val() <= int64(rsw.maxReq), nil
}

func main() {
	ctx := context.Background()
	rdb := redis.NewClient(&redis.Options{
		Addr: "localhost:6379",
	})

	limiter := NewRedisSlidingWindow(rdb, 1*time.Second, 5)

	userKey := "rate:user:1001"
	for i := 0; i < 10; i++ {
		ok, err := limiter.Allow(ctx, userKey)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			return
		}
		if ok {
			fmt.Printf("Request %2d: ✅ allowed\n", i+1)
		} else {
			fmt.Printf("Request %2d: ❌ rate limited\n", i+1)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
```

| 算法 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 令牌桶 | 支持突发流量，实现简单 | 短期内可突破速率上限 | API 网关、通用接口限流 |
| 滑动窗口 | 边界平滑，精度高 | 需要存储时间戳列表 | 对精度要求高的场景 |
| Redis 分布式 | 跨进程/跨节点共享 | 增加网络延迟，需考虑原子性 | 微服务架构下的全局限流 |

> **要点总结：**
> - 令牌桶适合允许突发的场景；滑动窗口限流更平滑
> - 分布式限流推荐 Lua 脚本保证原子性，或使用 Redis 官方 `redis-cell` 模块
> - 限流应返回 `429 Too Many Requests` 并附带 `Retry-After` 头

---

## 11.3 配置管理

使用 Viper 实现多环境配置、环境变量读取和配置热更新。

```go
package main

import (
	"fmt"
	"log"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/spf13/viper"
)

type AppConfig struct {
	AppName    string        `mapstructure:"app_name"`
	Debug      bool          `mapstructure:"debug"`
	Port       int           `mapstructure:"port"`
	Timeout    time.Duration `mapstructure:"timeout"`
	Database   DatabaseConfig
	Redis      RedisConfig
}

type DatabaseConfig struct {
	Driver string `mapstructure:"driver"`
	DSN    string `mapstructure:"dsn"`
}

type RedisConfig struct {
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

var config AppConfig

// InitConfig 初始化配置，支持多环境
func InitConfig(env string) error {
	v := viper.New()

	// 1. 设置默认值
	v.SetDefault("port", 8080)
	v.SetDefault("debug", false)
	v.SetDefault("timeout", "30s")

	// 2. 配置文件路径
	v.SetConfigName(fmt.Sprintf("config.%s", env)) // config.dev.yaml, config.prod.yaml
	v.SetConfigType("yaml")
	v.AddConfigPath("./configs")
	v.AddConfigPath(".")

	// 3. 读取配置文件（允许不存在）
	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return fmt.Errorf("read config: %w", err)
		}
		log.Println("No config file found, using defaults and env vars")
	}

	// 4. 环境变量覆盖（高优先级）
	v.SetEnvPrefix("APP")                       // APP_ 前缀
	v.AutomaticEnv()                            // 自动匹配环境变量
	v.BindEnv("port", "APP_PORT")               // 显式绑定
	v.BindEnv("debug", "APP_DEBUG")
	v.BindEnv("database.dsn", "APP_DATABASE_DSN")

	// 5. 反序列化到结构体
	if err := v.Unmarshal(&config); err != nil {
		return fmt.Errorf("unmarshal config: %w", err)
	}

	// 6. 配置热更新监听
	v.WatchConfig()
	v.OnConfigChange(func(e fsnotify.Event) {
		log.Printf("Config file changed: %s", e.Name)
		if err := v.Unmarshal(&config); err != nil {
			log.Printf("Reload config failed: %v", err)
			return
		}
		log.Println("Config reloaded successfully")
	})

	return nil
}

func main() {
	// 可指定环境：dev / staging / prod
	if err := InitConfig("dev"); err != nil {
		log.Fatalf("Init config: %v", err)
	}

	fmt.Printf("AppName: %s\n", config.AppName)
	fmt.Printf("Port: %d\n", config.Port)
	fmt.Printf("Debug: %t\n", config.Debug)
	fmt.Printf("Database DSN: %s\n", config.Database.DSN)
}
```

**配置文件示例** `configs/config.dev.yaml`：

```yaml
app_name: my-app-dev
debug: true
port: 8080
timeout: 30s
database:
  driver: mysql
  dsn: user:password@tcp(127.0.0.1:3306)/dev_db
redis:
  addr: localhost:6379
  password: ""
  db: 0
```

> **要点总结：**
> - 优先级：默认值 < 配置文件 < 环境变量 < 命令行参数
> - 敏感信息（密码、密钥）不要硬编码在配置文件中，使用环境变量或密钥管理服务
> - 热更新适用于本地开发与部分非关键配置，生产环境推荐配置变更走 CI/CD 重启

---

## 11.4 结构化日志

Go 1.21 引入标准库 `log/slog`，提供高性能结构化日志。本节同时介绍第三方的 `zap` 库。

### 11.4.1 slog 基础用法

```go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"time"
)

func main() {
	// JSON Handler（适合生产）
	jsonHandler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			// 将 level 转为大写
			if a.Key == slog.LevelKey {
				a.Value = slog.StringValue(a.Value.Any().(slog.Level).String())
			}
			return a
		},
	})
	logger := slog.New(jsonHandler)
	slog.SetDefault(logger) // 设为全局默认

	// 基本日志
	slog.Info("server starting", "port", 8080)
	slog.Warn("slow request detected", "path", "/api/users", "duration_ms", 2500)
	slog.Error("database connection failed", "error", "connection refused")

	// 结构化属性
	slog.LogAttrs(context.Background(), slog.LevelInfo, "user login",
		slog.Int64("user_id", 1001),
		slog.String("ip", "192.168.1.1"),
		slog.Duration("elapsed", 150*time.Millisecond),
		slog.Group("request",
			slog.String("method", http.MethodPost),
			slog.String("path", "/api/login"),
		),
	)
}
```

### 11.4.2 上下文日志

```go
package main

import (
	"context"
	"log/slog"
	"os"
)

type ctxKey string

const requestIDKey ctxKey = "request_id"

// WithRequestID 将 request ID 注入上下文
func WithRequestID(ctx context.Context, reqID string) context.Context {
	return context.WithValue(ctx, requestIDKey, reqID)
}

// GetRequestID 从上下文获取 request ID
func GetRequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// ContextHandler 日志处理器包装：自动注入上下文属性
type ContextHandler struct {
	handler slog.Handler
}

func (h *ContextHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.handler.Enabled(ctx, level)
}

func (h *ContextHandler) Handle(ctx context.Context, record slog.Record) error {
	if reqID := GetRequestID(ctx); reqID != "" {
		record.AddAttrs(slog.String("request_id", reqID))
	}
	return h.handler.Handle(ctx, record)
}

func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextHandler{handler: h.handler.WithAttrs(attrs)}
}

func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return &ContextHandler{handler: h.handler.WithGroup(name)}
}

func main() {
	baseHandler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	logger := slog.New(&ContextHandler{handler: baseHandler})
	slog.SetDefault(logger)

	// 使用示例
	ctx := WithRequestID(context.Background(), "req-abc-123")
	slog.LogAttrs(ctx, slog.LevelInfo, "processing request",
		slog.String("path", "/api/orders"),
	)
	// 输出包含 {"request_id": "req-abc-123"}
}
```

### 11.4.3 使用 zap（高性能场景）

```go
package main

import (
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func main() {
	// 生产配置：JSON 格式、级别、采样
	cfg := zap.NewProductionConfig()
	cfg.EncoderConfig.TimeKey = "timestamp"
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	cfg.EncoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder
	cfg.Sampling = &zap.SamplingConfig{
		Initial:    100,               // 每秒前100条
		Thereafter: 100,               // 之后每100条保留1条
	}

	logger, err := cfg.Build()
	if err != nil {
		panic(err)
	}
	defer logger.Sync() // 刷新缓冲区

	// 字段风格
	logger.Info("server started",
		zap.Int("port", 8080),
		zap.String("env", "production"),
		zap.Duration("uptime", time.Hour),
	)

	// Sugar 风格（性能略低，但更易读）
	sugar := logger.Sugar()
	sugar.Infow("user login",
		"user_id", 1001,
		"ip", "192.168.1.1",
	)
}
```

### 11.4.4 日志轮转

```go
package main

import (
	"log/slog"
	"os"

	"gopkg.in/natefinch/lumberjack.v2"
)

func main() {
	// lumberjack 提供文件轮转能力
	rotator := &lumberjack.Logger{
		Filename:   "./logs/app.log",
		MaxSize:    100,  // 单文件最大 100 MB
		MaxBackups: 10,   // 保留 10 个备份
		MaxAge:     30,   // 保留 30 天
		Compress:   true, // 压缩旧文件
	}

	handler := slog.NewJSONHandler(rotator, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})
	logger := slog.New(handler)
	slog.SetDefault(logger)

	slog.Info("log rotation configured", "max_size_mb", 100, "max_backups", 10)

	// 应用退出前关闭轮转器，确保日志刷新
	defer rotator.Close()
}
```

> **要点总结：**
> - 生产环境使用 JSON 格式，便于日志收集系统（ELK/Loki）解析
> - 每个日志条目携带 request_id，方便链路追踪
> - 敏感信息（密码、token）切勿记入日志
> - 使用日志采样控制高并发下的日志量，避免磁盘 IO 过载

---

## 11.5 优雅关停

优雅关停（Graceful Shutdown）确保服务在退出前完成正在处理的请求、清理资源，避免连接被强行中断。

```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// Server 封装 HTTP 服务与优雅关停逻辑
type Server struct {
	httpServer *http.Server
	wg         sync.WaitGroup
	closeCh    chan struct{}
}

func NewServer(addr string, handler http.Handler) *Server {
	return &Server{
		httpServer: &http.Server{
			Addr:         addr,
			Handler:      handler,
			ReadTimeout:  10 * time.Second,
			WriteTimeout: 15 * time.Second,
			IdleTimeout:  60 * time.Second,
		},
		closeCh: make(chan struct{}),
	}
}

func (s *Server) Start() error {
	log.Printf("Listening on %s", s.httpServer.Addr)
	return s.httpServer.ListenAndServe()
}

// Shutdown 执行优雅关停
func (s *Server) Shutdown(ctx context.Context) error {
	log.Println("Shutting down server...")

	// 1. 拒绝新请求（关闭 listener）
	if err := s.httpServer.Shutdown(ctx); err != nil {
		return err
	}

	// 2. 等待正在处理的后台任务完成
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Println("All background jobs completed")
	case <-ctx.Done():
		log.Println("Context timeout while waiting for jobs")
	}

	// 3. 关闭其他资源
	close(s.closeCh)
	log.Println("Server stopped gracefully")
	return nil
}

// AddTask 增加后台任务计数
func (s *Server) AddTask() {
	s.wg.Add(1)
}

// DoneTask 标记后台任务完成
func (s *Server) DoneTask() {
	s.wg.Done()
}

// handler 模拟处理请求
func handler(w http.ResponseWriter, r *http.Request) {
	// 模拟长时间运行的任务
	select {
	case <-time.After(2 * time.Second):
		w.Write([]byte("done"))
	case <-r.Context().Done():
		// 客户端断开连接
		log.Println("Client disconnected")
	}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/slow", handler)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	srv := NewServer(":8080", mux)

	// 信号监听
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	// 启动服务（goroutine）
	go func() {
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// 等待退出信号
	sig := <-quit
	log.Printf("Received signal: %v", sig)

	// 执行优雅关停（最多等待 30 秒）
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Forced shutdown: %v", err)
	}
}
```

> **要点总结：**
> - 监听 `SIGINT`（Ctrl+C）和 `SIGTERM`（Kubernetes/docker stop）
> - 设置合理的超时时间，避免无限等待
> - 正在处理的长连接应通过 `r.Context().Done()` 感知客户端断开
> - 数据库连接、消息队列等资源也应在关停时排空

---

## 11.6 健康检查

Kubernetes 等容器编排平台要求应用暴露 liveness（存活）和 readiness（就绪）检查端点。

```go
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// Checker 健康检查接口
type Checker interface {
	Name() string
	Check(ctx context.Context) error
}

// HealthService 管理多个健康检查
type HealthService struct {
	mu            sync.RWMutex
	checkers      []Checker
}

func NewHealthService() *HealthService {
	return &HealthService{}
}

func (hs *HealthService) Register(checker Checker) {
	hs.mu.Lock()
	defer hs.mu.Unlock()
	hs.checkers = append(hs.checkers, checker)
}

func (hs *HealthService) CheckAll(ctx context.Context) HealthResult {
	hs.mu.RLock()
	checkers := make([]Checker, len(hs.checkers))
	copy(checkers, hs.checkers)
	hs.mu.RUnlock()

	result := HealthResult{
		Status:   "ok",
		Checks:   make(map[string]CheckDetail),
		Duration: 0,
	}
	start := time.Now()

	for _, checker := range checkers {
		detail := CheckDetail{Name: checker.Name()}
		startCheck := time.Now()
		if err := checker.Check(ctx); err != nil {
			detail.Status = "error"
			detail.Error = err.Error()
			result.Status = "error"
		} else {
			detail.Status = "ok"
		}
		detail.Duration = time.Since(startCheck).String()
		result.Checks[checker.Name()] = detail
	}

	result.Duration = time.Since(start).String()
	return result
}

type HealthResult struct {
	Status   string                 `json:"status"`
	Checks   map[string]CheckDetail `json:"checks"`
	Duration string                 `json:"duration"`
}

type CheckDetail struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	Duration string `json:"duration"`
}

// 数据库健康检查
type DatabaseChecker struct {
	db     *sql.DB
	name   string
	timeout time.Duration
}

func (d *DatabaseChecker) Name() string { return d.name }
func (d *DatabaseChecker) Check(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, d.timeout)
	defer cancel()
	return d.db.PingContext(ctx)
}

// HTTP 依赖健康检查
type HTTPDependencyChecker struct {
	url     string
	name    string
	timeout time.Duration
	client  *http.Client
}

func (h *HTTPDependencyChecker) Name() string { return h.name }
func (h *HTTPDependencyChecker) Check(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.url, nil)
	if err != nil {
		return err
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return fmt.Errorf("unhealthy status: %d", resp.StatusCode)
	}
	return nil
}

// MemoryChecker 内存使用检查（用于 liveness）
type MemoryChecker struct {
	thresholdMB float64
	name        string
}

func (m *MemoryChecker) Name() string { return m.name }
func (m *MemoryChecker) Check(ctx context.Context) error {
	// 简化检查，仅演示逻辑
	return nil
}

func main() {
	healthSvc := NewHealthService()

	// 注册数据库检查（实际需要 *sql.DB）
	// db, _ := sql.Open("mysql", dsn)
	// healthSvc.Register(&DatabaseChecker{db: db, name: "mysql", timeout: 2 * time.Second})

	// 注册外部依赖检查
	healthSvc.Register(&HTTPDependencyChecker{
		name:    "redis",
		url:     "http://localhost:8001/health",
		timeout: 2 * time.Second,
		client:  &http.Client{Timeout: 3 * time.Second},
	})

	// HTTP 处理函数
	livenessHandler := func(w http.ResponseWriter, r *http.Request) {
		// liveness：只需返回存活状态
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
	}

	readinessHandler := func(w http.ResponseWriter, r *http.Request) {
		// readiness：检查所有依赖是否就绪
		result := healthSvc.CheckAll(r.Context())
		w.Header().Set("Content-Type", "application/json")
		if result.Status != "ok" {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusOK)
		}
		json.NewEncoder(w).Encode(result)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", livenessHandler)  // K8s liveness probe
	mux.HandleFunc("/readyz", readinessHandler)   // K8s readiness probe
	mux.HandleFunc("/health", readinessHandler)   // 通用健康检查

	log.Println("Health check server on :8080")
	http.ListenAndServe(":8080", mux)
}
```

> **要点总结：**
> - **liveness** 检查服务进程是否存活，失败会导致 Pod 重启
> - **readiness** 检查依赖是否就绪，失败会从 Service 端点移除
> - 避免在 liveness 中检查外部依赖（如数据库），否则第三方故障会导致服务雪崩重启
> - 建议设置独立的端口暴露健康检查，避免被外部访问

---

## 11.7 文件上传与处理

Go 标准库 `net/http` 和 `mime/multipart` 提供了完善的文件上传支持，配合流式处理可应对大文件场景。

```go
package main

import (
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const uploadDir = "./uploads"
const maxFileSize = 100 << 20 // 100 MB

func init() {
	os.MkdirAll(uploadDir, 0755)
}

// uploadHandler 单文件上传
func uploadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 限制请求体大小
	r.Body = http.MaxBytesReader(w, r.Body, maxFileSize)

	// 解析 multipart form
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, fmt.Sprintf("parse form: %v", err), http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, fmt.Sprintf("get file: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// 生成唯一文件名
	ext := filepath.Ext(header.Filename)
	filename := fmt.Sprintf("%x%s", sha256.Sum256([]byte(fmt.Sprint(time.Now().UnixNano()))), ext)
	dstPath := filepath.Join(uploadDir, filename)

	// 创建目标文件
	dst, err := os.Create(dstPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("create file: %v", err), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	// 流式写入（避免内存占用）
	written, err := io.Copy(dst, file)
	if err != nil {
		http.Error(w, fmt.Sprintf("save file: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("File saved: %s (%d bytes)", filename, written)
	w.Write([]byte(fmt.Sprintf(`{"filename":"%s","size":%d}`, filename, written)))
}

// uploadMultipleHandler 多文件上传 + 进度回调（流式处理）
func uploadMultipleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxFileSize)

	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, fmt.Sprintf("multipart reader: %v", err), http.StatusBadRequest)
		return
	}

	type fileResult struct {
		Filename string `json:"filename"`
		Size     int64  `json:"size"`
		Error    string `json:"error,omitempty"`
	}
	var results []fileResult

	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			http.Error(w, fmt.Sprintf("read part: %v", err), http.StatusInternalServerError)
			return
		}

		if part.FileName() == "" {
			continue // 跳过普通表单字段
		}

		ext := filepath.Ext(part.FileName())
		filename := fmt.Sprintf("%x%s", sha256.Sum256([]byte(fmt.Sprint(time.Now().UnixNano()))), ext)
		dstPath := filepath.Join(uploadDir, filename)

		dst, err := os.Create(dstPath)
		if err != nil {
			results = append(results, fileResult{Filename: part.FileName(), Error: err.Error()})
			part.Close()
			continue
		}

		written, err := io.Copy(dst, part)
		dst.Close()
		part.Close()

		if err != nil {
			results = append(results, fileResult{Filename: part.FileName(), Error: err.Error()})
		} else {
			results = append(results, fileResult{Filename: filename, Size: written})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{"results":%+v}`, results)
}

// downloadHandler 文件下载
func downloadHandler(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Query().Get("file")
	if filename == "" {
		http.Error(w, "file parameter required", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(uploadDir, filepath.Base(filename)) // 防止路径遍历
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filePath)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/upload", uploadHandler)
	mux.HandleFunc("/upload-multiple", uploadMultipleHandler)
	mux.HandleFunc("/download", downloadHandler)

	log.Println("File server on :8080")
	http.ListenAndServe(":8080", mux)
}
```

> **要点总结：**
> - 使用 `http.MaxBytesReader` 限制请求体大小，防止内存攻击
> - 大文件使用流式处理（`io.Copy`），避免一次性读入内存
> - 使用 `filepath.Base` 防止路径遍历攻击
> - 分片上传需配合前端，服务端接收分片后合并（或使用 tus 协议）

---

## 11.8 分页与排序

### 11.8.1 Offset 分页（传统方式）

```go
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
)

type User struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// PaginatedResponse 通用分页响应
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	PageSize   int         `json:"page_size"`
	TotalPages int         `json:"total_pages"`
	HasNext    bool        `json:"has_next"`
	HasPrev    bool        `json:"has_prev"`
}

// PaginationParams 分页请求参数
type PaginationParams struct {
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	SortBy   string `json:"sort_by"`
	SortDir  string `json:"sort_dir"` // asc / desc
}

func ParsePaginationParams(r *http.Request) PaginationParams {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	sortBy := r.URL.Query().Get("sort_by")
	if sortBy == "" {
		sortBy = "id"
	}
	sortDir := r.URL.Query().Get("sort_dir")
	if sortDir != "asc" && sortDir != "desc" {
		sortDir = "asc"
	}

	return PaginationParams{
		Page:     page,
		PageSize: pageSize,
		SortBy:   sortBy,
		SortDir:  sortDir,
	}
}

func listUsersHandler(w http.ResponseWriter, r *http.Request) {
	params := ParsePaginationParams(r)

	// 模拟从数据库查询
	allUsers := make([]User, 1000)
	for i := range allUsers {
		allUsers[i] = User{ID: i + 1, Name: fmt.Sprintf("User_%d", i+1)}
	}

	total := len(allUsers)
	offset := (params.Page - 1) * params.PageSize
	end := offset + params.PageSize
	if end > total {
		end = total
	}

	// 模拟排序（实际应在 SQL 中完成）
	pageData := allUsers[offset:end]

	resp := PaginatedResponse{
		Data:       pageData,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(params.PageSize))),
		HasNext:    end < total,
		HasPrev:    params.Page > 1,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
```

### 11.8.2 Cursor 分页（基于游标）

```go
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// CursorPage Cursor 分页响应
type CursorPage struct {
	Data       []User `json:"data"`
	NextCursor string `json:"next_cursor,omitempty"`
	HasMore    bool   `json:"has_more"`
}

// EncodeCursor 将参数编码为游标
func EncodeCursor(id int, createdAt time.Time) string {
	data := fmt.Sprintf("%d,%d", id, createdAt.Unix())
	return base64.URLEncoding.EncodeToString([]byte(data))
}

// DecodeCursor 解码游标
func DecodeCursor(cursor string) (id int, createdAt time.Time, err error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, time.Time{}, err
	}
	parts := strings.SplitN(string(data), ",", 2)
	if len(parts) != 2 {
		return 0, time.Time{}, fmt.Errorf("invalid cursor")
	}

	id, err = strconv.Atoi(parts[0])
	if err != nil {
		return 0, time.Time{}, err
	}

	unix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, time.Time{}, err
	}

	return id, time.Unix(unix, 0), nil
}

// ListUsersCursor 基于游标的用户列表查询（模拟）
func ListUsersCursor(cursor string, limit int) ([]User, string, bool, error) {
	allUsers := make([]User, 1000)
	for i := range allUsers {
		allUsers[i] = User{ID: i + 1, Name: fmt.Sprintf("User_%d", i+1)}
	}

	startIdx := 0
	if cursor != "" {
		id, _, err := DecodeCursor(cursor)
		if err != nil {
			return nil, "", false, err
		}
		startIdx = id // 实际场景以数据库查询为准
	}

	endIdx := startIdx + limit
	if endIdx > len(allUsers) {
		endIdx = len(allUsers)
	}

	pageData := allUsers[startIdx:endIdx]
	hasMore := endIdx < len(allUsers)

	var nextCursor string
	if hasMore && len(pageData) > 0 {
		last := pageData[len(pageData)-1]
		nextCursor = EncodeCursor(last.ID, time.Now())
	}

	return pageData, nextCursor, hasMore, nil
}

func cursorUsersHandler(w http.ResponseWriter, r *http.Request) {
	cursor := r.URL.Query().Get("cursor")
	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
		limit = l
	}

	users, nextCursor, hasMore, err := ListUsersCursor(cursor, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := CursorPage{
		Data:       users,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
```

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| Offset | 实现简单，支持跳页 | 大 offset 性能下降（`OFFSET 100000`） | 数据量 < 10000，后台管理 |
| Cursor | 性能稳定，新增数据不影响排序 | 无法跳页，客户端需维护游标 | 无限滚动，实时 feed |

> **要点总结：**
> - Offset 分页适合后台管理系统，数据量小且需要跳页
> - Cursor 分页适合 C 端场景，游标通常使用数据库主键或时间戳编码
> - 游标不要暴露内部 ID，建议 Base64 编码或加密
> - 排序时确保排序列有索引，防止全表扫描

---

## 11.9 缓存策略

缓存是提升系统性能的关键手段。本节介绍本地缓存（bigcache）、Redis 缓存以及缓存穿透/击穿/雪崩的防护方案。

### 11.9.1 本地缓存（bigcache）

```go
package main

import (
	"fmt"
	"log"
	"time"

	"github.com/allegro/bigcache/v3"
)

func main() {
	cache, err := bigcache.New(context.Background(), bigcache.Config{
		Shards:             1024,             // 分片数（提高并发）
		LifeWindow:         10 * time.Minute, // 条目存活时间
		CleanWindow:        5 * time.Minute,  // 清理间隔
		MaxEntriesInWindow: 1000,             // 窗口内最大条目数
		MaxEntrySize:       500,              // 单条最大字节数
		Verbose:            false,
	})
	if err != nil {
		log.Fatal(err)
	}

	// 写入
	cache.Set("user:1001", []byte(`{"id":1001,"name":"alice"}`))

	// 读取
	data, err := cache.Get("user:1001")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Cached:", string(data))

	// 删除
	cache.Delete("user:1001")
}
```

### 11.9.2 Redis 缓存（读写穿透）

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

type UserCache struct {
	client    *redis.Client
	defaultTTL time.Duration
}

func NewUserCache(addr string, password string, db int) *UserCache {
	return &UserCache{
		client: redis.NewClient(&redis.Options{
			Addr:     addr,
			Password: password,
			DB:       db,
			PoolSize: 10,
		}),
		defaultTTL: 10 * time.Minute,
	}
}

// GetOrFetch 缓存穿透保护：先查缓存，未命中则回源加载
func (uc *UserCache) GetOrFetch(ctx context.Context, key string, ttl time.Duration, fetchFn func() (interface{}, error)) (string, error) {
	// 1. 查缓存
	val, err := uc.client.Get(ctx, key).Result()
	if err == nil {
		return val, nil
	}
	if err != redis.Nil {
		return "", fmt.Errorf("redis error: %w", err)
	}

	// 2. 缓存未命中，回源加载
	if ttl == 0 {
		ttl = uc.defaultTTL
	}

	data, err := fetchFn()
	if err != nil {
		return "", err
	}

	// 3. 序列化并写入缓存
	dataStr, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	if err := uc.client.Set(ctx, key, dataStr, ttl).Err(); err != nil {
		log.Printf("Cache set error: %v", err)
	}

	return string(dataStr), nil
}

// 模拟从数据库加载
func fetchUserFromDB(userID int) (interface{}, error) {
	time.Sleep(100 * time.Millisecond) // 模拟数据库查询
	return map[string]interface{}{
		"id":   userID,
		"name": "alice",
		"age":  30,
	}, nil
}

func main() {
	ctx := context.Background()
	cache := NewUserCache("localhost:6379", "", 0)

	key := "user:1001"
	result, err := cache.GetOrFetch(ctx, key, 10*time.Minute, func() (interface{}, error) {
		return fetchUserFromDB(1001)
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println("Result:", result)
}
```

### 11.9.3 缓存穿透/击穿/雪崩防护

```go
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// CacheProtection 缓存保护（穿透+击穿+雪崩）
type CacheProtection struct {
	client  *redis.Client
	mu      sync.Mutex // 用于单机互斥，生产环境使用 Redis 分布式锁
}

// PreventPenetration 缓存穿透防护：布隆过滤器或空值缓存
func (cp *CacheProtection) PreventPenetration(ctx context.Context, key string, ttl time.Duration) error {
	// 方案：缓存空值（Null Object），避免每次穿透到 DB
	return cp.client.Set(ctx, key, "__NULL__", ttl).Err()
}

// IsNullValue 检查是否是缓存的空值
func (cp *CacheProtection) IsNullValue(val string) bool {
	return val == "__NULL__"
}

// PreventBreakdown 缓存击穿防护：互斥锁（Mutex）
func (cp *CacheProtection) PreventBreakdown(ctx context.Context, key string, ttl time.Duration, fetchFn func() (string, error)) (string, error) {
	// 1. 尝试从缓存获取
	val, err := cp.client.Get(ctx, key).Result()
	if err == nil {
		return val, nil
	}
	if err != redis.Nil {
		return "", err
	}

	// 2. 缓存失效，加锁回源（生产环境使用 Redis 分布式锁）
	cp.mu.Lock()
	defer cp.mu.Unlock()

	// 双重检查：防止并发时重复加载
	val, err = cp.client.Get(ctx, key).Result()
	if err == nil {
		return val, nil
	}

	// 3. 回源加载
	data, err := fetchFn()
	if err != nil {
		return "", err
	}

	// 4. 写入缓存
	if err := cp.client.Set(ctx, key, data, ttl).Err(); err != nil {
		log.Printf("Set cache error: %v", err)
	}
	return data, nil
}

// PreventAvalanche 缓存雪崩防护：过期时间加随机偏移
func randomTTL(base time.Duration) time.Duration {
	buf := make([]byte, 1)
	rand.Read(buf)
	jitter := time.Duration(int(buf[0])%300) * time.Second // 0~300s 随机偏移
	return base + jitter
}

func main() {
	ctx := context.Background()
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	cp := &CacheProtection{client: rdb}

	// 模拟缓存雪崩防护：过期时间加随机偏移
	baseTTL := 10 * time.Minute
	ttlWithJitter := randomTTL(baseTTL)
	fmt.Printf("Base TTL: %v, With jitter: %v\n", baseTTL, ttlWithJitter)

	// 模拟击穿防护
	key := "hot:product:1001"
	result, err := cp.PreventBreakdown(ctx, key, ttlWithJitter, func() (string, error) {
		// 模拟 DB 查询
		time.Sleep(50 * time.Millisecond)
		return `{"id":1001,"name":"热门商品"}`, nil
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("Result:", result)
}
```

| 问题 | 现象 | 解决方案 |
|------|------|---------|
| 缓存穿透 | 查询不存在的数据，每次穿透到 DB | 布隆过滤器 / 缓存空值 |
| 缓存击穿 | 热点 key 失效，高并发打到 DB | 互斥锁回源 / 逻辑过期 |
| 缓存雪崩 | 大量 key 同时过期，DB 被打垮 | 过期时间加随机偏移 / 多级缓存 |

> **要点总结：**
> - 本地缓存延迟低但容量有限，适合高频读取的静态数据
> - Redis 缓存适合跨进程共享，注意设置合理 TTL 和最大内存策略
> - 缓存空值可防止穿透，但需设置较短的 TTL
> - 热点 key 的过期时间增加随机偏移，避免集中失效
> - 重要数据考虑本地 + Redis 多级缓存架构

---

## 11.10 定时任务与调度

### 11.10.1 Cron 表达式调度（robfig/cron）

```go
package main

import (
	"fmt"
	"log"
	"time"

	"github.com/robfig/cron/v3"
)

func main() {
	// 支持秒的 cron 表达式（6 字段）
	c := cron.New(cron.WithSeconds())

	// 每分钟的第 30 秒执行
	c.AddFunc("30 * * * * *", func() {
		fmt.Println("Every 30 seconds:", time.Now().Format(time.RFC3339))
	})

	// 每天 凌晨 3:00 执行
	c.AddFunc("0 0 3 * * *", func() {
		fmt.Println("Daily cleanup job at 03:00")
	})

	// 每小时执行
	c.AddFunc("0 0 * * * *", func() {
		fmt.Println("Hourly job")
	})

	// 带参数的 Job 类型
	type ReportJob struct {
		Name string
	}

	c.AddJob("0 0 8 * * 1-5", cron.NewChain(
		cron.SkipIfStillRunning(), // 防止任务堆积
		cron.Recover(),            // 捕获 panic
	).Then(&ReportJob{Name: "daily-report"}))

	c.Start()

	log.Println("Cron scheduler started")
	select {}
}
```

### 11.10.2 延迟任务与分布式调度

```go
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/go-redsync/redsync/v4"
	"github.com/go-redsync/redsync/v4/redis/goredis/v9"
	"github.com/redis/go-redis/v9"
)

// DelayedTask 延迟任务结构
type DelayedTask struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Payload   string    `json:"payload"`
	ExecuteAt time.Time `json:"execute_at"`
}

// TaskScheduler 基于 Redis 的分布式调度器
type TaskScheduler struct {
	client    *redis.Client
	redsync   *redsync.Redsync
}

func NewTaskScheduler(client *redis.Client) *TaskScheduler {
	pool := goredis.NewPool(client)
	return &TaskScheduler{
		client:  client,
		redsync: redsync.New(pool),
	}
}

// Schedule 添加延迟任务（使用 Redis 有序集合）
func (ts *TaskScheduler) Schedule(ctx context.Context, task DelayedTask) error {
	data, err := json.Marshal(task)
	if err != nil {
		return err
	}
	// 以执行时间戳作为 score
	return ts.client.ZAdd(ctx, "delayed:tasks", redis.Z{
		Score:  float64(task.ExecuteAt.Unix()),
		Member: data,
	}).Err()
}

// ProcessLoop 调度器主循环
func (ts *TaskScheduler) ProcessLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Scheduler stopped")
			return
		case <-ticker.C:
			ts.processDueTasks(ctx)
		}
	}
}

func (ts *TaskScheduler) processDueTasks(ctx context.Context) {
	now := time.Now().Unix()

	// 获取所有到期的任务
	tasks, err := ts.client.ZRangeByScore(ctx, "delayed:tasks", &redis.ZRangeBy{
		Min: "0",
		Max: fmt.Sprint(now),
	}).Result()
	if err != nil {
		log.Printf("Fetch tasks error: %v", err)
		return
	}

	for _, taskStr := range tasks {
		// 使用分布式锁防止重复执行
		mutex := ts.redsync.NewMutex("lock:task:"+taskStr,
			redsync.WithExpiry(10*time.Second),
			redsync.WithTries(1),
		)

		if err := mutex.Lock(); err != nil {
			continue // 被其他节点取走
		}

		// 执行任务
		var task DelayedTask
		if err := json.Unmarshal([]byte(taskStr), &task); err != nil {
			log.Printf("Unmarshal task error: %v", err)
			mutex.Unlock()
			continue
		}

		log.Printf("Executing task: %s (type: %s)", task.ID, task.Type)
		// 实际执行逻辑...
		ts.executeTask(task)

		// 从队列移除
		ts.client.ZRem(ctx, "delayed:tasks", taskStr)
		mutex.Unlock()
	}
}

func (ts *TaskScheduler) executeTask(task DelayedTask) {
	switch task.Type {
	case "send_email":
		log.Printf("Sending email: %s", task.Payload)
	case "generate_report":
		log.Printf("Generating report: %s", task.Payload)
	default:
		log.Printf("Unknown task type: %s", task.Type)
	}
}

func main() {
	ctx := context.Background()
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	scheduler := NewTaskScheduler(rdb)

	// 添加延迟任务
	task := DelayedTask{
		ID:        "task-001",
		Type:      "send_email",
		Payload:   `{"to":"user@example.com","template":"welcome"}`,
		ExecuteAt: time.Now().Add(30 * time.Second),
	}
	if err := scheduler.Schedule(ctx, task); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Task scheduled at: %s\n", task.ExecuteAt)

	// 启动调度循环
	go scheduler.ProcessLoop(ctx, 1*time.Second)

	// 运行 1 分钟
	time.Sleep(1 * time.Minute)
}
```

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| Cron | 简单稳定，支持复杂调度 | 单机无容错，不适合大量任务 | 系统维活、定时报表 |
| Redis ZSet | 分布式、持久化 | 精度受限于轮询间隔 | 延迟队列、任务调度 |
| 分布式锁 | 避免重复执行 | 增加复杂度 | 多副本部署的任务调度 |

> **要点总结：**
> - 单机任务使用 `robfig/cron`，多副本部署需配合分布式锁
> - 延迟任务的精度取决于轮询频次，对时间敏感的场景使用时间轮算法
> - 任务执行需考虑幂等性，防止重试导致重复
> - 对于长时间运行的任务，设置超时和心跳监控

---

## 章节总结

本章覆盖了 Web 服务开发中最常见的 10 大技术解决方案：

| 方案 | 推荐库 | 核心关注点 |
|------|-------|-----------|
| JWT | `golang-jwt/jwt/v5` | Claims 设计、密钥管理、过期策略 |
| 限流 | `golang.org/x/time/rate` + 自实现 | 算法选择、分布式一致性 |
| 配置管理 | `spf13/viper` | 优先级、热更新、敏感信息保护 |
| 结构化日志 | `log/slog` / `uber-go/zap` | 上下文注入、采样、轮转 |
| 优雅关停 | 标准库 + `os/signal` | 信号监听、连接排空、超时控制 |
| 健康检查 | 自实现 | liveness 与 readiness 分离 |
| 文件上传 | 标准库 `mime/multipart` | 流式处理、安全防护 |
| 分页排序 | 自实现 | Offset vs Cursor 取舍 |
| 缓存 | `allegro/bigcache` + Redis | 穿透/击穿/雪崩防护 |
| 定时任务 | `robfig/cron` | 分布式锁、幂等性 |
