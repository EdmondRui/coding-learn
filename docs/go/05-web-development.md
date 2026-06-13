# 第五章：Web 开发

> 目标读者：掌握 Go 基础语法、并发编程的开发者

---

## 5.1 net/http 标准库

Go 标准库 `net/http` 提供了完整的 HTTP 客户端与服务端实现，无需第三方依赖即可构建 Web 服务。

### 5.1.1 http.Handler 接口

核心接口只有一個方法：

```go
type Handler interface {
    ServeHTTP(w http.ResponseWriter, r *http.Request)
}
```

任何实现了 `ServeHTTP` 的类型都可作为 HTTP 处理器。`http.HandlerFunc` 是适配器，将普通函数转换为 Handler：

```go
func helloHandler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:])
}

func main() {
    http.Handle("/", http.HandlerFunc(helloHandler))
    http.ListenAndServe(":8080", nil)
}
```

### 5.1.2 ServeMux 路由

`http.ServeMux` 是标准库自带的路由器，支持路径匹配：

```go
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/api/users", listUsers)
    mux.HandleFunc("/api/users/", getUser) // 前缀匹配
    mux.HandleFunc("GET /api/posts", listPosts) // Go 1.22+ 支持方法匹配
    http.ListenAndServe(":8080", mux)
}
```

> Go 1.22+ 的 ServeMux 支持 `METHOD /path` 格式和路径变量 `{name}`。

### 5.1.3 自定义 Server

创建 `http.Server` 结构体可以精细控制服务行为：

```go
func main() {
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("Hello"))
    })

    srv := &http.Server{
        Addr:         ":8080",
        Handler:      mux,
        ReadTimeout:  5 * time.Second,   // 读取请求体的超时
        WriteTimeout: 10 * time.Second,  // 发送响应的超时
        IdleTimeout:  60 * time.Second,  // 长连接空闲超时
        MaxHeaderBytes: 1 << 20,         // 请求头最大 1MB
    }

    if err := srv.ListenAndServe(); err != nil {
        log.Fatal(err)
    }
}
```

**超时配置建议：**

| 参数 | 推荐值 | 作用 |
|------|--------|------|
| ReadTimeout | 3-10s | 防止慢客户端攻击 |
| WriteTimeout | 10-30s | 限制慢响应 |
| IdleTimeout | 30-120s | 配合 keep-alive 节省连接数 |

### 5.1.4 优雅关闭

使用 `Shutdown` 方法实现平滑退出，确保正在处理的请求完成后再关闭：

```go
func main() {
    srv := &http.Server{Addr: ":8080"}

    go func() {
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("listen: %s\n", err)
        }
    }()

    // 监听中断信号
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit
    log.Println("Shutting down server...")

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := srv.Shutdown(ctx); err != nil {
        log.Fatalf("Server forced to shutdown: %v", err)
    }
    log.Println("Server exited")
}
```

---

## 5.2 Gin 框架

[Gin](https://github.com/gin-gonic/gin) 是 Go 最流行的 Web 框架，性能优异，API 简洁。

### 5.2.1 基础路由与分组

```go
func main() {
    r := gin.Default()

    // 路由分组
    v1 := r.Group("/api/v1")
    {
        v1.GET("/users", listUsers)
        v1.GET("/users/:id", getUser)
        v1.POST("/users", createUser)
        v1.PUT("/users/:id", updateUser)
        v1.DELETE("/users/:id", deleteUser)
    }

    // 嵌套分组
    admin := r.Group("/admin", authMiddleware())
    {
        admin.GET("/dashboard", dashboard)
    }

    r.Run(":8080")
}
```

### 5.2.2 参数绑定

Gin 提供了多种绑定方式，自动根据 Content-Type 选择解析器：

```go
type CreateUserRequest struct {
    Name  string `json:"name"  form:"name"  binding:"required"`
    Email string `json:"email" form:"email" binding:"required,email"`
    Age   int    `json:"age"   form:"age"   binding:"gte=0,lte=150"`
}

func createUser(c *gin.Context) {
    var req CreateUserRequest

    // 根据 Content-Type 自动选择绑定方式
    if err := c.ShouldBind(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    // 明确指定 JSON 绑定
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    // 绑定查询参数
    if err := c.ShouldBindQuery(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    // 绑定路径参数
    id := c.Param("id")

    // 绑定 URI 参数
    if err := c.ShouldBindUri(&req); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    c.JSON(200, gin.H{"data": req})
}
```

### 5.2.3 参数校验（validator tags）

Gin 内置了 [go-playground/validator](https://github.com/go-playground/validator) 校验器，通过 struct tag 声明规则：

```go
type User struct {
    Username string `json:"username" binding:"required,min=3,max=32"`
    Password string `json:"password" binding:"required,min=8,containsany=!@#$%"`
    Email    string `json:"email"    binding:"required,email"`
    Phone    string `json:"phone"    binding:"required,e164"`          // 国际电话格式
    URL      string `json:"url"      binding:"omitempty,url"`          // 可选字段校验
    Role     string `json:"role"     binding:"required,oneof=admin user"` // 枚举
    Tags     []string `json:"tags"   binding:"required,min=1,dive,min=2"` // 数组元素校验
}
```

### 5.2.4 文件上传

```go
func uploadFile(c *gin.Context) {
    // 单文件
    file, err := c.FormFile("file")
    if err != nil {
        c.String(400, "file required")
        return
    }

    // 保存到本地
    dst := filepath.Join("./uploads", file.Filename)
    if err := c.SaveUploadedFile(file, dst); err != nil {
        c.String(500, "save failed")
        return
    }

    // 多文件上传
    form, _ := c.MultipartForm()
    files := form.File["files"]
    for _, f := range files {
        c.SaveUploadedFile(f, "./uploads/"+f.Filename)
    }

    c.JSON(200, gin.H{
        "filename": file.Filename,
        "size":     file.Size,
    })
}
```

---

## 5.3 中间件模式

### 5.3.1 中间件原理

中间件是一个 Handler 包装函数，在请求处理前后执行逻辑。Gin 的中间件本质是 `gin.HandlerFunc`：

```go
// 中间件定义：接收 gin.Context，调用 c.Next() 传递到下一个处理器
func MyMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        // 请求前逻辑
        start := time.Now()

        c.Next() // 传递给下一个中间件或路由处理函数

        // 请求后逻辑
        latency := time.Since(start)
        log.Printf("Request %s took %v", c.Request.URL.Path, latency)
    }
}
```

### 5.3.2 日志中间件

```go
func LoggerMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        start := time.Now()
        path := c.Request.URL.Path
        method := c.Request.Method

        c.Next()

        status := c.Writer.Status()
        size := c.Writer.Size()
        latency := time.Since(start)

        log.Printf("[%d] %s %s | %v | %d bytes",
            status, method, path, latency, size,
        )
    }
}
```

### 5.3.3 Recovery 中间件

在请求出现 panic 时恢复，避免进程崩溃：

```go
func RecoveryMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        defer func() {
            if err := recover(); err != nil {
                // 记录堆栈信息
                stack := debug.Stack()
                log.Printf("PANIC: %v\n%s", err, stack)

                // 返回 500 错误
                c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
                    "error": "Internal Server Error",
                })
            }
        }()
        c.Next()
    }
}
```

### 5.3.4 请求 ID 中间件

为每个请求分配唯一追踪 ID，便于问题排查：

```go
func RequestIDMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        requestID := c.GetHeader("X-Request-ID")
        if requestID == "" {
            requestID = uuid.New().String()
        }

        c.Set("request_id", requestID)
        c.Header("X-Request-ID", requestID)
        c.Next()
    }
}
```

### 5.3.5 CORS 中间件

处理跨域请求：

```go
func CORSMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        c.Header("Access-Control-Allow-Origin", "*")
        c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
        c.Header("Access-Control-Max-Age", "86400")

        if c.Request.Method == "OPTIONS" {
            c.AbortWithStatus(http.StatusNoContent)
            return
        }
        c.Next()
    }
}
```

### 5.3.6 中间件执行顺序

中间件的注册顺序决定了执行顺序：**先注册的中间件先执行（洋葱模型）**。

```go
func main() {
    r := gin.New()

    // 注册顺序决定了调用栈
    r.Use(LoggerMiddleware())    // ① 最早入栈，最晚出栈
    r.Use(RequestIDMiddleware()) // ②
    r.Use(CORSMiddleware())      // ③ 最后入栈，最早出栈

    // 执行流程：
    // Logger → RequestID → CORS → Handler → CORS → RequestID → Logger
    r.GET("/ping", func(c *gin.Context) {
        c.JSON(200, gin.H{"message": "pong"})
    })

    // 分组中间件：仅对 /admin 下的路由生效
    admin := r.Group("/admin", RecoveryMiddleware())
    {
        admin.GET("/stats", statsHandler)
    }

    r.Run(":8080")
}
```

> **洋葱模型**：请求从外向内经过所有中间件到达 Handler，响应从内向外依次返回，先注册的中间件最外层执行。

---

## 5.4 RESTful API 设计

### 5.4.1 资源命名与 HTTP 方法语义

| HTTP 方法 | 操作 | 路径示例 | 语义 |
|-----------|------|----------|------|
| GET | 查询（列表） | `GET /api/v1/users` | 获取用户列表 |
| GET | 查询（单个） | `GET /api/v1/users/:id` | 获取单个用户 |
| POST | 创建 | `POST /api/v1/users` | 创建新用户 |
| PUT | 全量更新 | `PUT /api/v1/users/:id` | 替换用户全部字段 |
| PATCH | 部分更新 | `PATCH /api/v1/users/:id` | 更新用户部分字段 |
| DELETE | 删除 | `DELETE /api/v1/users/:id` | 删除用户 |

**命名规范：**
- 使用复数名词：`/users` 而非 `/user`
- 使用小写字母和连字符：`/order-items` 而非 `/orderItems`
- 层级关系：`/users/:id/orders`
- 不使用动词：用 `POST /articles/:id/publish` 而非 `/articles/:id/publish-article`

### 5.4.2 状态码规范

```go
// 2xx 成功
http.StatusOK              // 200 GET/PUT/PATCH 成功
http.StatusCreated         // 201 POST 创建成功
http.StatusNoContent       // 204 DELETE 成功，无响应体

// 4xx 客户端错误
http.StatusBadRequest      // 400 参数校验失败
http.StatusUnauthorized    // 401 未认证
http.StatusForbidden       // 403 无权限
http.StatusNotFound        // 404 资源不存在
http.StatusConflict        // 409 资源冲突（如邮箱已注册）
http.StatusUnprocessableEntity // 422 请求语义错误

// 5xx 服务端错误
http.StatusInternalServerError // 500 未预期的服务端错误
http.StatusServiceUnavailable  // 503 服务暂不可用
```

### 5.4.3 分页与过滤

```go
type PaginationParams struct {
    Page     int    `form:"page"     binding:"required,min=1"`
    PageSize int    `form:"page_size" binding:"required,min=1,max=100"`
    SortBy   string `form:"sort_by"`
    Order    string `form:"order"    binding:"omitempty,oneof=asc desc"`
}

type PaginatedResponse struct {
    Data       interface{} `json:"data"`
    Page       int         `json:"page"`
    PageSize   int         `json:"page_size"`
    Total      int64       `json:"total"`
    TotalPages int         `json:"total_pages"`
}

func listUsers(c *gin.Context) {
    var params PaginationParams
    if err := c.ShouldBindQuery(&params); err != nil {
        c.JSON(400, gin.H{"error": err.Error()})
        return
    }

    offset := (params.Page - 1) * params.PageSize
    users, total := queryUsers(offset, params.PageSize)

    c.JSON(200, PaginatedResponse{
        Data:       users,
        Page:       params.Page,
        PageSize:   params.PageSize,
        Total:      total,
        TotalPages: int(math.Ceil(float64(total) / float64(params.PageSize))),
    })
}

// 过滤参数：?status=active&role=admin&created_after=2024-01-01
type UserFilterParams struct {
    Status      string `form:"status" binding:"omitempty,oneof=active inactive"`
    Role        string `form:"role"`
    CreatedAfter string `form:"created_after" binding:"omitempty,datetime=2006-01-02"`
}
```

### 5.4.4 版本管理

推荐在 URL 路径中嵌入版本号：

```go
func main() {
    r := gin.Default()

    // v1 版本 - 老接口
    v1 := r.Group("/api/v1")
    v1.GET("/users", v1ListUsers)

    // v2 版本 - 新接口，可独立演进
    v2 := r.Group("/api/v2")
    v2.GET("/users", v2ListUsers)

    r.Run(":8080")
}
```

版本策略对比：

| 方式 | 示例 | 优点 | 缺点 |
|------|------|------|------|
| URL 路径 | `/api/v1/users` | 最直观，易于路由 | URL 较冗长 |
| 请求头 | `Accept: application/vnd.app.v1+json` | 语义化，URL 整洁 | 调试不方便 |
| 查询参数 | `?version=1` | 实现简单 | 容易被忽略 |

---

## 5.5 JWT 认证

### 5.5.1 JWT 结构

JWT 由三部分组成，用 `.` 分隔：

```
header.payload.signature
```

- **Header**：算法和令牌类型
- **Payload**：声明（claims），存放用户信息
- **Signature**：对前两部分的签名，防止篡改

### 5.5.2 签发与验证

使用 `golang-jwt/jwt/v5` 库：

```go
import (
    "time"
    "github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte("your-secret-key")

type CustomClaims struct {
    UserID   string `json:"user_id"`
    Username string `json:"username"`
    Role     string `json:"role"`
    jwt.RegisteredClaims
}

// 签发 Token
func GenerateToken(userID, username, role string) (string, error) {
    claims := CustomClaims{
        UserID:   userID,
        Username: username,
        Role:     role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(2 * time.Hour)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            Issuer:    "my-app",
        },
    }

    token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
    return token.SignedString(jwtSecret)
}

// 验证 Token
func ParseToken(tokenString string) (*CustomClaims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &CustomClaims{},
        func(token *jwt.Token) (interface{}, error) {
            // 检查签名算法
            if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, fmt.Errorf("unexpected signing method: %v",
                    token.Header["alg"])
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
```

### 5.5.3 Access Token + Refresh Token 模式

```go
type TokenPair struct {
    AccessToken  string `json:"access_token"`
    RefreshToken string `json:"refresh_token"`
}

func GenerateTokenPair(userID, username, role string) (*TokenPair, error) {
    // Access Token（短时效）
    accessToken, err := GenerateToken(userID, username, role)
    if err != nil {
        return nil, err
    }

    // Refresh Token（长时效，携带更少信息）
    refreshClaims := jwt.RegisteredClaims{
        ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
        IssuedAt:  jwt.NewNumericDate(time.Now()),
        ID:        userID, // 用 sub 关联用户
    }
    refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
    refreshTokenStr, err := refreshToken.SignedString(jwtSecret)

    return &TokenPair{
        AccessToken:  accessToken,
        RefreshToken: refreshTokenStr,
    }, nil
}

// 刷新 Token
func RefreshAccessToken(refreshTokenStr string) (*TokenPair, error) {
    claims := &jwt.RegisteredClaims{}
    token, err := jwt.ParseWithClaims(refreshTokenStr, claims,
        func(token *jwt.Token) (interface{}, error) {
            return jwtSecret, nil
        })
    if err != nil || !token.Valid {
        return nil, fmt.Errorf("invalid refresh token")
    }

    // 从数据库或缓存中查询用户信息
    user := findUserByID(claims.ID)
    return GenerateTokenPair(user.ID, user.Username, user.Role)
}
```

### 5.5.4 中间件集成

```go
func AuthMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        authHeader := c.GetHeader("Authorization")
        if authHeader == "" {
            c.AbortWithStatusJSON(401, gin.H{"error": "missing authorization header"})
            return
        }

        // 格式: "Bearer <token>"
        parts := strings.SplitN(authHeader, " ", 2)
        if len(parts) != 2 || parts[0] != "Bearer" {
            c.AbortWithStatusJSON(401, gin.H{"error": "invalid authorization format"})
            return
        }

        claims, err := ParseToken(parts[1])
        if err != nil {
            c.AbortWithStatusJSON(401, gin.H{"error": "invalid or expired token"})
            return
        }

        // 将用户信息注入上下文
        c.Set("user_id", claims.UserID)
        c.Set("username", claims.Username)
        c.Set("role", claims.Role)
        c.Next()
    }
}

// 角色鉴权中间件
func RoleMiddleware(allowedRoles ...string) gin.HandlerFunc {
    return func(c *gin.Context) {
        role, _ := c.Get("role")
        for _, r := range allowedRoles {
            if role == r {
                c.Next()
                return
            }
        }
        c.AbortWithStatusJSON(403, gin.H{"error": "forbidden"})
    }
}

// 使用
func main() {
    r := gin.Default()

    // 公开路由
    r.POST("/api/v1/login", loginHandler)
    r.POST("/api/v1/refresh", refreshHandler)

    // 需认证的路由
    protected := r.Group("/api/v1")
    protected.Use(AuthMiddleware())
    {
        protected.GET("/profile", getProfile)

        // 仅 admin 可访问
        admin := protected.Group("/admin")
        admin.Use(RoleMiddleware("admin"))
        {
            admin.GET("/users", listAllUsers)
        }
    }

    r.Run(":8080")
}
```

---

## 5.6 请求校验与错误响应

### 5.6.1 统一错误响应格式

定义标准化的错误结构，确保 API 返回格式一致：

```go
type ErrorResponse struct {
    Code    int         `json:"code"`
    Message string      `json:"message"`
    Details interface{} `json:"details,omitempty"`
    RequestID string   `json:"request_id,omitempty"`
}

func respondError(c *gin.Context, status int, message string, details ...interface{}) {
    resp := ErrorResponse{
        Code:    status,
        Message: message,
    }
    if len(details) > 0 {
        resp.Details = details[0]
    }
    if rid, exists := c.Get("request_id"); exists {
        resp.RequestID = rid.(string)
    }
    c.AbortWithStatusJSON(status, resp)
}

// 使用
func getUser(c *gin.Context) {
    id := c.Param("id")

    user, err := findUserByID(id)
    if err == sql.ErrNoRows {
        respondError(c, 404, "user not found")
        return
    }
    if err != nil {
        respondError(c, 500, "internal server error")
        return
    }

    c.JSON(200, gin.H{"data": user})
}
```

### 5.6.2 参数校验错误翻译

将 validator 的错误信息转为用户友好的中文消息：

```go
import (
    "github.com/go-playground/validator/v10"
)

type ValidatorError struct {
    Field   string `json:"field"`
    Message string `json:"message"`
}

func formatValidationErrors(err error) []ValidatorError {
    var errors []ValidatorError
    if ve, ok := err.(validator.ValidationErrors); ok {
        for _, fe := range ve {
            errors = append(errors, ValidatorError{
                Field:   toSnakeCase(fe.Field()),
                Message: translateTag(fe),
            })
        }
    }
    return errors
}

// 翻译校验错误消息
func translateTag(fe validator.FieldError) string {
    field := fe.Field()
    tag := fe.Tag()
    param := fe.Param()

    messages := map[string]string{
        "required":    field + " 是必填字段",
        "min":         field + " 长度不能小于 " + param,
        "max":         field + " 长度不能大于 " + param,
        "email":       "请输入有效的邮箱地址",
        "oneof":       field + " 必须是 " + param + " 之一",
        "gte":         field + " 不能小于 " + param,
        "lte":         field + " 不能大于 " + param,
        "url":         "请输入有效的 URL",
        "datetime":    field + " 格式不正确，应为 " + param,
        "e164":        "请输入有效的电话号码",
        "containsany": field + " 必须包含 " + param + " 中的至少一个字符",
    }

    if msg, ok := messages[tag]; ok {
        return msg
    }
    return field + " 校验失败"
}

func toSnakeCase(s string) string {
    var result strings.Builder
    for i, r := range s {
        if r >= 'A' && r <= 'Z' {
            if i > 0 {
                result.WriteRune('_')
            }
            result.WriteRune(r + 32)
        } else {
            result.WriteRune(r)
        }
    }
    return result.String()
}
```

### 5.6.3 自定义 validator

注册业务相关的自定义校验规则：

```go
import "github.com/go-playground/validator/v10"

var validate *validator.Validate

func init() {
    validate = validator.New()

    // 注册自定义校验：密码强度
    validate.RegisterValidation("password_strength", func(fl validator.FieldLevel) bool {
        password := fl.Field().String()
        if len(password) < 8 {
            return false
        }
        hasUpper := strings.ContainsAny(password, "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        hasLower := strings.ContainsAny(password, "abcdefghijklmnopqrstuvwxyz")
        hasDigit := strings.ContainsAny(password, "0123456789")
        hasSpecial := strings.ContainsAny(password, "!@#$%^&*")
        return hasUpper && hasLower && hasDigit && hasSpecial
    })

    // 注册自定义校验：枚举值
    validate.RegisterValidation("enum", func(fl validator.FieldLevel) bool {
        values := strings.Split(fl.Param(), " ")
        current := fl.Field().String()
        for _, v := range values {
            if current == v {
                return true
            }
        }
        return false
    })
}

type RegisterRequest struct {
    Username string `json:"username" binding:"required,min=3,max=32"`
    Password string `json:"password" binding:"required,password_strength"`
    Gender   string `json:"gender"   binding:"required,enum=男 女 其他"`
}

func registerHandler(c *gin.Context) {
    var req RegisterRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        errors := formatValidationErrors(err)
        respondError(c, 422, "参数校验失败", errors)
        return
    }
    c.JSON(201, gin.H{"message": "注册成功"})
}
```

### 5.6.4 完整示例

整合上述所有概念：

```go
func main() {
    r := gin.New()
    r.Use(LoggerMiddleware(), RecoveryMiddleware(), RequestIDMiddleware())

    api := r.Group("/api/v1")
    {
        api.POST("/register", registerHandler)
        api.POST("/login", loginHandler)
    }

    authorized := api.Group("")
    authorized.Use(AuthMiddleware())
    {
        authorized.GET("/users/:id", getUser)
        authorized.POST("/upload", uploadFile)
    }

    r.Run(":8080")
}

func loginHandler(c *gin.Context) {
    var req struct {
        Username string `json:"username" binding:"required"`
        Password string `json:"password" binding:"required"`
    }
    if err := c.ShouldBindJSON(&req); err != nil {
        respondError(c, 400, "参数错误", formatValidationErrors(err))
        return
    }

    user := authenticate(req.Username, req.Password)
    if user == nil {
        respondError(c, 401, "用户名或密码错误")
        return
    }

    tokens, err := GenerateTokenPair(user.ID, user.Username, user.Role)
    if err != nil {
        respondError(c, 500, "令牌生成失败")
        return
    }

    c.JSON(200, tokens)
}
```

---

## 总结

| 主题 | 要点 |
|------|------|
| net/http | Handler 接口、ServeMux 路由、自定义 Server、超时配置、Shutdown 优雅关闭 |
| Gin 框架 | 路由分组、ShouldBind 参数绑定、validator tags 校验、文件上传 |
| 中间件模式 | 洋葱模型、日志/Recovery/RequestID/CORS 中间件、注册顺序决定执行顺序 |
| RESTful API | 资源命名规范、HTTP 方法语义、状态码选择、分页过滤、URL 版本管理 |
| JWT 认证 | HS256 签名、Access+Refresh 双令牌、AuthMiddleware + RoleMiddleware |
| 错误响应 | 统一 ErrorResponse、validator 中文翻译、自定义校验规则 |

> **下一步建议**：学习数据库操作（GORM）、gRPC 通信、以及如何编写测试覆盖 Web handler。
