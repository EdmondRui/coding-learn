# 第七章：微服务架构

> 目标读者：掌握 Go 基础语法、并发编程、Web 开发的开发者

---

## 7.1 gRPC 与 Protobuf

gRPC 是 Google 开源的高性能 RPC 框架，基于 HTTP/2 协议，默认使用 Protocol Buffers（protobuf）作为序列化协议。相比 JSON/HTTP REST，gRPC 具有更高的性能、更小的传输体积和强类型接口约束。

### 7.1.1 Protocol Buffers 定义

`.proto` 文件是 gRPC 服务的契约文件，定义消息结构和服务接口。

```protobuf
// proto/user/v1/user.proto
syntax = "proto3";

package user.v1;

option go_package = "github.com/example/proto/gen/go/user/v1;userv1";

// 用户消息
message User {
  int64  id        = 1;
  string name      = 2;
  string email     = 3;
  int32  age       = 4;
  repeated string tags = 5;       //  repeated = 列表
  map<string, string> attrs = 6;  // map 类型
}

// 请求 / 响应消息
message GetUserRequest {
  int64 id = 1;
}

message GetUserResponse {
  User user = 1;
}

message ListUsersRequest {
  int32 page_size = 1;
  int32 page_num  = 2;
}

message ListUsersResponse {
  repeated User users      = 1;
  int32         total_count = 2;
}
```

### 7.1.2 Service / RPC 定义

```protobuf
service UserService {
  // 一元 RPC（Unary）
  rpc GetUser(GetUserRequest) returns (GetUserResponse);

  // 服务端流式 RPC（Server Streaming）
  rpc ListUsers(ListUsersRequest) returns (stream User);

  // 客户端流式 RPC（Client Streaming）
  rpc BatchCreateUser(stream User) returns (ListUsersResponse);

  // 双向流式 RPC（Bidirectional Streaming）
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);
}

message ChatMessage {
  string user_id  = 1;
  string content  = 2;
  int64  timestamp = 3;
}
```

生成代码命令：

```bash
protoc --go_out=. --go-grpc_out=. proto/user/v1/user.proto
```

### 7.1.3 四种通信模式

**一元 RPC（Unary）**——最常用，类似 HTTP 请求/响应：

```go
// 服务端
func (s *UserServer) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.GetUserResponse, error) {
    user, err := s.db.FindUser(req.Id)
    if err != nil {
        return nil, status.Errorf(codes.NotFound, "user not found: %v", err)
    }
    return &pb.GetUserResponse{User: user}, nil
}

// 客户端
resp, err := client.GetUser(ctx, &pb.GetUserRequest{Id: 1001})
```

**服务端流式 RPC**——服务端推送多条数据：

```go
func (s *UserServer) ListUsers(req *pb.ListUsersRequest, stream pb.UserService_ListUsersServer) error {
    users, _ := s.db.ListUsers(req.PageSize, req.PageNum)
    for _, u := range users {
        if err := stream.Send(u); err != nil { // 逐条发送
            return err
        }
    }
    return nil
}
```

**客户端流式 RPC**——客户端批量发送：

```go
func (s *UserServer) BatchCreateUser(stream pb.UserService_BatchCreateUserServer) error {
    var users []*pb.User
    for {
        user, err := stream.Recv()
        if errors.Is(err, io.EOF) {
            return stream.SendAndClose(&pb.ListUsersResponse{Users: users})
        }
        users = append(users, user)
    }
}
```

**双向流式 RPC**——全双工通信：

```go
func (s *UserServer) Chat(stream pb.UserService_ChatServer) error {
    for {
        msg, err := stream.Recv()
        if errors.Is(err, io.EOF) {
            return nil
        }
        // 处理消息并回复
        reply := &pb.ChatMessage{Content: "ack: " + msg.Content}
        if err := stream.Send(reply); err != nil {
            return err
        }
    }
}
```

### 7.1.4 拦截器（Interceptor）

拦截器类似 HTTP 中间件，可对每个 RPC 进行前置/后置处理。分为**一元拦截器**和**流拦截器**。

```go
// 一元服务端拦截器：日志 + 耗时
func LoggingUnaryInterceptor(ctx context.Context, req any,
    info *grpc.UnaryServerInfo, handler grpc.UnaryHandler,
) (any, error) {
    start := time.Now()
    log.Printf("[gRPC] %s 开始", info.FullMethod)
    resp, err := handler(ctx, req)
    log.Printf("[gRPC] %s 完成, 耗时=%v, err=%v", info.FullMethod, time.Since(start), err)
    return resp, err
}

// 一元客户端拦截器：添加认证令牌
func AuthUnaryInterceptor(ctx context.Context, method string,
    req, reply any, cc *grpc.ClientConn, invoker grpc.UnaryInvoker, opts ...grpc.CallOption,
) error {
    ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer "+token)
    return invoker(ctx, method, req, reply, cc, opts...)
}

// 注册拦截器
server := grpc.NewServer(
    grpc.UnaryInterceptor(LoggingUnaryInterceptor),
    // grpc.StreamInterceptor(streamInterceptor),   // 流拦截器
)
```

### 7.1.5 错误状态码

gRPC 内置了丰富的状态码（`google.golang.org/grpc/codes`），传递结构化错误：

```go
import (
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

// 服务端返回错误
if user == nil {
    return nil, status.Errorf(codes.NotFound, "用户 %d 不存在", req.Id)
}
if req.Age < 0 {
    return nil, status.Errorf(codes.InvalidArgument, "年龄不能为负数")
}

// 客户端处理错误
resp, err := client.GetUser(ctx, req)
if err != nil {
    st, ok := status.FromError(err)
    if ok {
        switch st.Code() {
        case codes.NotFound:
            log.Println("用户不存在:", st.Message())
        case codes.Unavailable:
            log.Println("服务不可用，稍后重试")
        }
    }
}
```

常用状态码：`OK`、`Canceled`、`NotFound`、`InvalidArgument`、`DeadlineExceeded`、`AlreadyExists`、`PermissionDenied`、`Unavailable`、`Internal`。

---

## 7.2 服务注册与发现

微服务架构下，服务实例的 IP 和端口是动态变化的，需要注册中心维护服务地址列表。

### 7.2.1 Consul 服务注册

使用 `hashicorp/consul` Go SDK 实现注册与发现：

```go
import "github.com/hashicorp/consul/api"

// 服务注册
func RegisterService(serviceName, host string, port int) (*api.Client, error) {
    client, _ := api.NewClient(&api.Config{Address: "127.0.0.1:8500"})

    registration := &api.AgentServiceRegistration{
        ID:      fmt.Sprintf("%s-%s-%d", serviceName, host, port),
        Name:    serviceName,
        Address: host,
        Port:    port,
        Check: &api.AgentServiceCheck{
            HTTP:     fmt.Sprintf("http://%s:%d/health", host, port),
            Interval: "10s",                    // 每 10s 检查一次
            Timeout:  "3s",
            DeregisterCriticalServiceAfter: "30s", // 30s 后自动注销
        },
    }
    err := client.Agent().ServiceRegister(registration)
    return client, err
}

// 服务发现
func DiscoverService(client *api.Client, serviceName string) ([]string, error) {
    services, _, err := client.Health().Service(serviceName, "", true, nil)
    if err != nil {
        return nil, err
    }
    var addrs []string
    for _, s := range services {
        addrs = append(addrs, fmt.Sprintf("%s:%d", s.Service.Address, s.Service.Port))
    }
    return addrs, nil
}
```

### 7.2.2 etcd 服务注册

```go
import clientv3 "go.etcd.io/etcd/client/v3"

// 使用 etcd 实现注册（租约 + keepalive）
func RegisterEtcd(cli *clientv3.Client, service, addr string, ttl int64) error {
    lease, _ := cli.Grant(context.Background(), ttl)
    key := fmt.Sprintf("/services/%s/%s", service, addr)
    _, err := cli.Put(context.Background(), key, addr, clientv3.WithLease(lease.ID))
    if err != nil {
        return err
    }
    // 自动续约
    keepAliveCh, _ := cli.KeepAlive(context.Background(), lease.ID)
    go func() {
        for range keepAliveCh {
            // 续约成功
        }
    }()
    return nil
}
```

### 7.2.3 负载均衡策略

gRPC 内置了 `round_robin` 负载均衡策略，也可通过 `resolver` 自定义：

```go
import (
    "google.golang.org/grpc"
    _ "google.golang.org/grpc/balancer/roundrobin" // 注册 round_robin
)

// 方式一：使用 DNS 解析 + round_robin
conn, _ := grpc.Dial(
    "dns:///user-service:8080",
    grpc.WithDefaultServiceConfig(`{"loadBalancingConfig": [{"round_robin": {}}]}`),
    grpc.WithInsecure(),
)

// 方式二：自定义 resolver + 手动负载
type CustomResolver struct {
    addrs []string
    index int
}

func (r *CustomResolver) Next() string {
    r.index = (r.index + 1) % len(r.addrs)
    return r.addrs[r.index]
}

// 方式三：least-connections（最小连接数）
// 需使用第三方库或 gRPC-Go 的 weighted_target 策略
```

### 7.2.4 负载均衡模式对比

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| round_robin | 轮询 | 各实例性能均匀 |
| least_requests | 最小请求数 | 请求处理时间差异大 |
| weighted_target | 加权 | 实例规格不同 |
| hash | 一致性哈希 | 需要会话保持 |

gRPC 默认使用 `pick_first`——只连第一个地址，失败才切到下一个。要启用负载均衡必须显式配置。

---

## 7.3 配置管理

### 7.3.1 Viper 配置框架

[Viper](https://github.com/spf13/viper) 是 Go 最流行的配置管理库，支持多数据源、多格式、环境变量覆盖和热更新。

```go
import "github.com/spf13/viper"

// 初始化 Viper
func InitConfig() error {
    v := viper.New()

    // 1. 设置配置文件路径
    v.AddConfigPath("./config")     // 搜索目录
    v.SetConfigName("app")          // 文件名（无后缀）
    v.SetConfigType("yaml")         // 显式指定格式

    // 2. 读取配置文件
    if err := v.ReadInConfig(); err != nil {
        return fmt.Errorf("读取配置失败: %w", err)
    }

    // 3. 环境变量覆盖（优先级高于配置文件）
    v.SetEnvPrefix("APP")           // 前缀: APP_
    v.AutomaticEnv()                // 自动匹配: app.port -> APP_PORT
    v.SetEnvKeyReplacer(strings.NewReplacer(".", "_")) // app.db.host -> APP_DB_HOST

    // 4. 设置默认值
    v.SetDefault("server.port", 8080)
    v.SetDefault("server.timeout", 30)

    return nil
}
```

### 7.3.2 多格式支持

```go
// YAML (app.yaml)
// server:
//   port: 8080
//   timeout: 30s
// database:
//   host: localhost
//   port: 5432

// TOML (app.toml)
// [server]
// port = 8080
// timeout = "30s"

// 读取方式完全一致
v.SetConfigType("yaml")  // 或 toml, json, properties, dotenv

// 配置结构体映射
type Config struct {
    Server   ServerConfig   `mapstructure:"server"`
    Database DatabaseConfig `mapstructure:"database"`
}

type ServerConfig struct {
    Port    int           `mapstructure:"port"`
    Timeout time.Duration `mapstructure:"timeout"`
}

func LoadConfig(v *viper.Viper) (*Config, error) {
    var cfg Config
    if err := v.Unmarshal(&cfg); err != nil {
        return nil, err
    }
    // 支持 decoder 标签定制
    v.Unmarshal(&cfg, func(dc *mapstructure.DecoderConfig) {
        dc.DecodeHook = mapstructure.ComposeDecodeHookFunc(
            mapstructure.StringToTimeDurationHookFunc(),
            mapstructure.StringToSliceHookFunc(","),
        )
    })
    return &cfg, nil
}
```

### 7.3.3 环境变量覆盖优先级

```
运行时 Set() > 环境变量 > 配置文件 > 默认值
```

```bash
# 命令行覆盖
export APP_SERVER_PORT=9090  # 优先级高于配置文件
```

### 7.3.4 热更新（Watch）

```go
func WatchConfig(v *viper.Viper, onChange func()) {
    v.WatchConfig()
    v.OnConfigChange(func(e fsnotify.Event) {
        log.Printf("配置文件变更: %s, 操作: %s", e.Name, e.Op)
        onChange()
    })
}

// 使用示例
v := viper.New()
// ... 初始化配置 ...
WatchConfig(v, func() {
    newCfg, _ := LoadConfig(v)
    log.Printf("配置已热更新: %+v", newCfg.Server)
    // 动态调整连接池、日志级别等
})
```

> 注意：热更新后需手动同步到正在使用的对象（如使用原子指针 `atomic.Pointer[Config]` 替换）。

---

## 7.4 链路追踪

### 7.4.1 OpenTelemetry Go SDK

OpenTelemetry（OTel）是 CNCF 的可观测性标准，统一了 Trace、Metric、Log 的采集。

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/trace"
    "go.opentelemetry.io/otel/attribute"
)

// 初始化 TracerProvider
func InitTracer(serviceName string) func() {
    // 1. 创建 exporter（此处使用 stdout 输出，生产环境替换为 Jaeger/OTLP）
    exporter, _ := stdout.New(stdout.WithPrettyPrint())

    // 2. 创建 TracerProvider
    tp := trace.NewTracerProvider(
        trace.WithBatcher(exporter),
        trace.WithResource(
            resource.NewWithAttributes(
                semconv.SchemaURL,
                semconv.ServiceNameKey.String(serviceName),
                attribute.String("environment", "production"),
            ),
        ),
    )
    otel.SetTracerProvider(tp)

    // 3. 返回关闭函数
    return func() { _ = tp.Shutdown(context.Background()) }
}
```

### 7.4.2 Trace / Span 概念

```go
func ProcessOrder(ctx context.Context, orderID string) {
    // 从上下文中获取 tracer
    tracer := otel.Tracer("order-service")

    // 创建 Span
    ctx, span := tracer.Start(ctx, "ProcessOrder",
        trace.WithAttributes(
            attribute.String("order.id", orderID),
            attribute.Int("item.count", len(items)),
        ),
    )
    defer span.End()  // 结束 Span

    // 嵌套子操作——自动传递上下文
    ValidateOrder(ctx, orderID)       // 子 Span
    DeductStock(ctx, items)           // 子 Span
    CreatePayment(ctx, orderID, amt)  // 子 Span

    // 记录事件
    span.AddEvent("order.processed",
        trace.WithAttributes(attribute.Int64("amount", amt)),
    )

    // 记录错误
    if err != nil {
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
    }
}
```

### 7.4.3 gRPC / HTTP 自动埋点

OpenTelemetry 提供了拦截器实现自动埋点：

```go
import (
    "go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
    "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// gRPC 服务端自动埋点
server := grpc.NewServer(
    grpc.StatsHandler(otelgrpc.NewServerHandler()),
)

// gRPC 客户端自动埋点
conn, _ := grpc.Dial(
    "target:8080",
    grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
    grpc.WithInsecure(),
)

// HTTP 服务端自动埋点
handler := otelhttp.NewHandler(
    mux,
    "http-server",
    otelhttp.WithMessageEvents(otelhttp.ReadEvents, otelhttp.WriteEvents),
)
http.ListenAndServe(":8080", handler)
```

### 7.4.4 Jaeger 集成

```go
import (
    "go.opentelemetry.io/otel/exporters/jaeger"
    "go.opentelemetry.io/otel/sdk/trace"
)

func InitJaegerProvider(serviceName, endpoint string) (func(), error) {
    // 创建 Jaeger exporter
    exporter, err := jaeger.New(jaeger.WithCollectorEndpoint(
        jaeger.WithEndpoint(endpoint),  // e.g. "http://jaeger:14268/api/traces"
    ))
    if err != nil {
        return nil, err
    }

    // 创建 TracerProvider
    tp := trace.NewTracerProvider(
        trace.WithBatcher(exporter),
        trace.WithResource(
            resource.NewWithAttributes(
                semconv.SchemaURL,
                semconv.ServiceNameKey.String(serviceName),
            ),
        ),
    )
    otel.SetTracerProvider(tp)
    return func() { _ = tp.Shutdown(context.Background()) }, nil
}
```

### 7.4.5 Baggage 传递

Baggage 用于跨服务传递上下文信息（如用户 ID、请求来源），不会上报到后端：

```go
import "go.opentelemetry.io/otel/baggage"

// 添加 Baggage
func SetUserContext(ctx context.Context, userID, role string) context.Context {
    b, _ := baggage.Parse(
        fmt.Sprintf("user_id=%s,role=%s", userID, role),
    )
    return baggage.ContextWithBaggage(ctx, b)
}

// 读取 Baggage
func GetUserFromContext(ctx context.Context) string {
    b := baggage.FromContext(ctx)
    member := b.Member("user_id")
    return member.Value()
}

// Baggage 会自动随 gRPC 元数据传递（无需手动处理）
```

---

## 7.5 熔断与限流

### 7.5.1 熔断器模式（三态）

熔断器有三种状态：**Closed**（正常）、**Open**（熔断）、**Half-Open**（半开）。

```go
import "github.com/sony/gobreaker"

// 创建熔断器
var cb *gobreaker.CircuitBreaker

func InitCircuitBreaker() {
    cb = gobreaker.NewCircuitBreaker(gobreaker.Settings{
        Name:        "user-service-cb",
        MaxRequests: 5,                 // Half-Open 状态下最大请求数
        Interval:    60 * time.Second,  // Closed 状态下重置计数的时间窗口
        Timeout:     30 * time.Second,  // Open -> Half-Open 等待时间
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            // 失败率超过 60% 时熔断
            failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
            return counts.Requests >= 5 && failureRatio >= 0.6
        },
        OnStateChange: func(name string, from, to gobreaker.State) {
            log.Printf("[熔断器] %s: %s -> %s", name, from, to)
        },
    })
}

// 使用熔断器
func GetUserWithCB(ctx context.Context, id int64) (*pb.User, error) {
    resp, err := cb.Execute(func() (any, error) {
        return userClient.GetUser(ctx, &pb.GetUserRequest{Id: id})
    })
    if err != nil {
        return nil, err
    }
    return resp.(*pb.User), nil
}
```

### 7.5.2 令牌桶限流

使用 `golang.org/x/time/rate` 实现令牌桶：

```go
import "golang.org/x/time/rate"

// 创建限流器：每秒 100 个令牌，桶容量 200
var limiter = rate.NewLimiter(rate.Limit(100), 200)

// gRPC 一元拦截器实现限流
func RateLimitUnaryInterceptor(ctx context.Context, req any,
    info *grpc.UnaryServerInfo, handler grpc.UnaryHandler,
) (any, error) {
    if !limiter.Allow() {
        return nil, status.Errorf(codes.ResourceExhausted, "请求过于频繁，请稍后重试")
    }
    return handler(ctx, req)
}

// Wait 方式（阻塞等待令牌）
func DoWithRateLimit(ctx context.Context) error {
    return limiter.Wait(ctx) // 可传入带超时的 context
}

// AllowN 支持批量判断
if limiter.AllowN(time.Now(), 10) {
    // 处理 10 个请求
}
```

### 7.5.3 漏桶限流

使用 `go.uber.org/ratelimit` 实现漏桶（Uber 出品）：

```go
import "go.uber.org/ratelimit"

// 每秒 50 个请求
rl := ratelimit.New(50)

// 每次调用返回前都会阻塞，保证恒定速率
for _, req := range requests {
    rl.Take()                       // 等待下一个可用时间片
    go handleRequest(req)
}

// 基于 IP 的分桶限流
type IPRateLimiter struct {
    mu       sync.Mutex
    limiters map[string]*rate.Limiter
    rate     rate.Limit
    burst    int
}

func (l *IPRateLimiter) GetLimiter(ip string) *rate.Limiter {
    l.mu.Lock()
    defer l.mu.Unlock()
    lim, ok := l.limiters[ip]
    if !ok {
        lim = rate.NewLimiter(l.rate, l.burst)
        l.limiters[ip] = lim
    }
    return lim
}
```

### 7.5.4 自适应限流

参考 TCP 拥塞控制的思路，根据系统负载动态调整限流阈值：

```go
// 基于 CPU + Goroutine 数量的自适应限流
type AdaptiveLimiter struct {
    maxCPU    float64
    maxGoCnt  int
    pass      *int64 // 过去 1s 通过请求
    reject    *int64 // 过去 1s 拒绝请求
}

func (a *AdaptiveLimiter) Allow() bool {
    // 每分钟计算一次允许率
    passes := atomic.LoadInt64(a.pass)
    rejects := atomic.LoadInt64(a.reject)

    // 如果拒绝率 > 30%，收紧限流
    if passes+rejects > 100 {
        ratio := float64(rejects) / float64(passes+rejects)
        if ratio > 0.3 {
            // 动态降低限流阈值
            return false
        }
    }
    return true
}
```

> 生产环境可优先考虑 [alibaba/sentinel-golang](https://github.com/alibaba/sentinel-golang)，内置了自适应限流和熔断降级策略。

---

## 7.6 服务网格入门

### 7.6.1 Istio 架构概览

Istio 是服务网格（Service Mesh）的事实标准，核心组件包括：

```
                            ┌──────────────────────┐
                            │     Control Plane     │
                            │  (istiod)             │
                            │  Pilot | Citadel |    │
                            │  Galley               │
                            └───────┬──────────────┘
                                    │ 配置下发
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
   ┌────▼────┐               ┌─────▼─────┐              ┌─────▼────┐
   │ Service A│  Sidecar     │  Service B │  Sidecar    │  Service C│
   │ [Go App] │─── Proxy ───▶│  [Go App]  │─── Proxy ──▶│  [Go App] │
   │          │   (Envoy)    │            │   (Envoy)   │           │
   └──────────┘              └────────────┘             └───────────┘
```

- **istiod**：控制面，统一管理 Pilot（服务发现与流量管理）、Citadel（安全）、Galley（配置校验）
- **Envoy Proxy**：数据面，以 Sidecar 方式注入到每个 Pod，拦截所有进出流量
- **Sidecar 注入**：自动将 Envoy 容器注入到 Deployment 中，对应用透明

### 7.6.2 Sidecar 注入

Istio 支持自动注入和手动注入。自动注入依赖 Kubernetes 的 MutatingWebhook：

```yaml
# 命名空间开启自动注入
apiVersion: v1
kind: Namespace
metadata:
  name: go-microservices
  labels:
    istio-injection: enabled    # 开启自动注入
---
# Go 服务 Deployment——无需任何修改
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
  namespace: go-microservices
spec:
  replicas: 3
  selector:
    matchLabels:
      app: user-service
  template:
    metadata:
      labels:
        app: user-service
    spec:
      containers:
      - name: user-service
        image: registry/user-service:v1
        ports:
        - containerPort: 8080
        env:
        - name: OTEL_SERVICE_NAME
          value: "user-service"
```

注入后每个 Pod 会包含两个容器：业务容器 + Envoy Sidecar。

### 7.6.3 流量管理

**VirtualService**——定义路由规则：

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: user-service-routing
  namespace: go-microservices
spec:
  hosts:
  - user-service
  http:
  - match:
    - headers:
        version:
          exact: v2
    route:
    - destination:
        host: user-service
        subset: v2
      weight: 100
  - route:
    - destination:
        host: user-service
        subset: v1
      weight: 80
    - destination:
        host: user-service
        subset: v2
      weight: 20           # 金丝雀发布：20% 流量到 v2
```

**DestinationRule**——定义负载均衡与连接池：

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: user-service-dst
  namespace: go-microservices
spec:
  host: user-service
  trafficPolicy:
    loadBalancer:
      simple: ROUND_ROBIN       # 负载均衡策略
    connectionPool:
      tcp:
        maxConnections: 100     # 最大连接数
      http:
        http1MaxPendingRequests: 10
        http2MaxRequests: 1000
    outlierDetection:           # 自动熔断
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 60s
  subsets:
  - name: v1
    labels:
      version: v1
  - name: v2
    labels:
      version: v2
```

### 7.6.4 Go 微服务与 Istio 的配合

Go 服务在 Istio 环境中需要注意以下几点：

```go
// 1. 入口流量处理——获取真实客户端 IP（Envoy 通过 X-Forwarded-For 传递）
func GetClientIP(r *http.Request) string {
    if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
        parts := strings.Split(xff, ",")
        return strings.TrimSpace(parts[0]) // 真实客户端 IP
    }
    return r.RemoteAddr // 实际是 Envoy 的 IP
}

// 2. 优雅退出——等待 Envoy 连接池耗尽
func GracefulShutdown(srv *http.Server) {
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    // 先停止接收新请求，等待已有请求完成
    if err := srv.Shutdown(ctx); err != nil {
        log.Fatalf("服务关闭异常: %v", err)
    }
    // 给 Envoy 额外时间通知控制面（建议 5s 以上）
    time.Sleep(5 * time.Second)
}

// 3. 利用 Istio 的故障注入测试容错（无需修改代码）
// 在 VirtualService 中配置：
// http:
//   - fault:
//       delay:
//         percentage: 50
//         fixedDelay: 5s
//       abort:
//         percentage: 10
//         httpStatus: 500
```

### 7.6.5 Istio 带来的能力（对 Go 应用透明）

| 能力 | 说明 | 零代码改动 |
|------|------|-----------|
| 超时与重试 | VirtualService 中配置 `timeout: 5s`, `retries: 3` | ✓ |
| 熔断 | DestinationRule `outlierDetection` | ✓ |
| 流量分割 | 金丝雀、蓝绿、A/B 测试 | ✓ |
| mTLS 加密 | 自动双向 TLS，无需修改应用 | ✓ |
| 可观测性 | Envoy 自动上报 Trace/Metric/Log | ✓ |
| 故障注入 | 注入延迟和异常，测试容错性 | ✓ |

> 核心思想：**Istio 将网络通信的通用能力下沉到基础设施层，Go 微服务专注于业务逻辑**。

---

## 综合示例：完整微服务

参考架构：gRPC + Consul 注册 + OpenTelemetry 追踪 + 熔断限流 + 配置管理，所有组件可组合成一个完整的 Go 微服务骨架。
