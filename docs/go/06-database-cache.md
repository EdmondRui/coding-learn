# 第六章：数据库与缓存

> 目标读者：掌握 Go 基础语法、并发编程的开发者

---

## 6.1 database/sql 标准库

Go 标准库 `database/sql` 提供了 SQL 数据库的统一操作接口，配合具体数据库驱动（如 `github.com/lib/pq`、`github.com/go-sql-driver/mysql`）使用。

### 6.1.1 连接池配置

`sql.DB` 是一个连接池对象，不是单个连接。通过以下参数控制池行为：

```go
package main

import (
    "database/sql"
    "fmt"
    "log"
    "time"

    _ "github.com/go-sql-driver/mysql"
)

func main() {
    dsn := "user:password@tcp(127.0.0.1:3306)/testdb?charset=utf8mb4&parseTime=True"
    db, err := sql.Open("mysql", dsn)
    if err != nil {
        log.Fatal("打开数据库失败:", err)
    }
    defer db.Close()

    // 验证连接是否可用
    if err := db.Ping(); err != nil {
        log.Fatal("无法连接数据库:", err)
    }

    // ---------- 连接池配置 ----------
    // 最大打开连接数（默认 0 = 不限制）
    db.SetMaxOpenConns(25)
    // 最大空闲连接数（默认 2）
    db.SetMaxIdleConns(10)
    // 连接最大存活时间 —— 防止负载均衡器断开陈旧连接
    db.SetConnMaxLifetime(30 * time.Minute)
    // 连接最大空闲时间 —— 回收长期不用的连接
    db.SetConnMaxIdleTime(5 * time.Minute)

    fmt.Println("数据库连接池已配置")
}
```

**参数调优建议：**

| 参数 | 建议值 | 说明 |
|------|--------|------|
| `MaxOpenConns` | CPU 核数 × 2~4 | 避免数据库过载 |
| `MaxIdleConns` | ≤ MaxOpenConns | 减少建立连接开销 |
| `ConnMaxLifetime` | 5~30 分钟 | 防止连接被中间件断开 |
| `ConnMaxIdleTime` | 5 分钟 | 回收空闲连接 |

### 6.1.2 预处理语句（Prepared Statements）

预处理语句防止 SQL 注入，提高重复查询性能：

```go
// 创建预处理语句
stmt, err := db.Prepare("INSERT INTO users(name, email, age) VALUES(?, ?, ?)")
if err != nil {
    log.Fatal(err)
}
defer stmt.Close()

// 批量插入
users := []struct {
    Name  string
    Email string
    Age   int
}{
    {"张三", "zhangsan@example.com", 28},
    {"李四", "lisi@example.com", 32},
    {"王五", "wangwu@example.com", 24},
}

for _, u := range users {
    result, err := stmt.Exec(u.Name, u.Email, u.Age)
    if err != nil {
        log.Printf("插入失败 [%s]: %v\n", u.Name, err)
        continue
    }
    id, _ := result.LastInsertId()
    log.Printf("插入成功 ID=%d\n", id)
}
```

### 6.1.3 查询方法

`database/sql` 提供三类查询方法：

```go
// -------- 1. Query：返回多行 --------
rows, err := db.Query("SELECT id, name, email FROM users WHERE age > ?", 25)
if err != nil {
    log.Fatal(err)
}
defer rows.Close() // 必须关闭，否则连接泄漏

for rows.Next() {
    var id int
    var name, email string
    if err := rows.Scan(&id, &name, &email); err != nil {
        log.Fatal(err)
    }
    fmt.Printf("%d: %s (%s)\n", id, name, email)
}
// 检查遍历过程中是否出错
if err := rows.Err(); err != nil {
    log.Fatal(err)
}

// -------- 2. QueryRow：返回单行 --------
var user struct {
    ID    int
    Name  string
    Email string
}
err = db.QueryRow("SELECT id, name, email FROM users WHERE id = ?", 1).Scan(
    &user.ID, &user.Name, &user.Email,
)
if err == sql.ErrNoRows {
    fmt.Println("用户不存在")
} else if err != nil {
    log.Fatal(err)
}

// -------- 3. Exec：不返回行（INSERT/UPDATE/DELETE） --------
result, err := db.Exec("UPDATE users SET age = ? WHERE id = ?", 30, 1)
if err != nil {
    log.Fatal(err)
}
affected, _ := result.RowsAffected()
fmt.Printf("影响了 %d 行\n", affected)
```

### 6.1.4 处理 NULL 值

数据库 `NULL` 无法直接 Scan 到 Go 基本类型，需使用 `sql.Null*` 类型：

```go
type User struct {
    ID          int
    Name        string
    Email       sql.NullString // 数据库可能为 NULL
    Phone       sql.NullString
    Age         sql.NullInt64
    Salary      sql.NullFloat64
    CreatedAt   sql.NullTime
}

rows, err := db.Query("SELECT id, name, email, phone, age, salary, created_at FROM users")
if err != nil {
    log.Fatal(err)
}
defer rows.Close()

for rows.Next() {
    var u User
    if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Phone, &u.Age, &u.Salary, &u.CreatedAt); err != nil {
        log.Fatal(err)
    }
    // 使用 .Valid 判断是否为 NULL
    if u.Email.Valid {
        fmt.Printf("邮箱: %s\n", u.Email.String)
    } else {
        fmt.Println("邮箱: 未设置")
    }
}
```

**常用 Null 类型：** `sql.NullString`、`sql.NullInt64`、`sql.NullFloat64`、`sql.NullBool`、`sql.NullTime`（Go 1.13+）、`sql.NullByte`、`sql.NullInt32`（Go 1.17+）。

### 6.1.5 事务（Tx）

事务确保多个操作原子性提交或回滚：

```go
func transferFunds(db *sql.DB, fromID, toID int, amount float64) error {
    // 开始事务
    tx, err := db.Begin()
    if err != nil {
        return fmt.Errorf("开启事务失败: %w", err)
    }
    // 发生 panic 或错误时自动回滚
    defer tx.Rollback() // 已提交的事务调用 Rollback 是安全的（无操作）

    // 扣减转出账户余额
    _, err = tx.Exec("UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?",
        amount, fromID, amount)
    if err != nil {
        return fmt.Errorf("扣款失败: %w", err)
    }

    // 增加转入账户余额
    _, err = tx.Exec("UPDATE accounts SET balance = balance + ? WHERE id = ?",
        amount, toID)
    if err != nil {
        return fmt.Errorf("入账失败: %w", err)
    }

    // 提交事务
    if err := tx.Commit(); err != nil {
        return fmt.Errorf("提交事务失败: %w", err)
    }
    return nil
}
```

**事务内使用预处理语句：**

```go
tx, _ := db.Begin()
stmt, _ := tx.Prepare("INSERT INTO logs(user_id, action) VALUES(?, ?)")
defer stmt.Close()

for _, log := range logs {
    _, err := stmt.Exec(log.UserID, log.Action)
    if err != nil {
        tx.Rollback()
        return err
    }
}
return tx.Commit()
```

> `Tx` 对象的方法（Exec/Query/Prepare）会在该事务的连接上执行，确保所有操作在同一个数据库连接上。

---

## 6.2 GORM

GORM 是 Go 最流行的 ORM 框架，提供对象-关系映射能力。

### 6.2.1 模型定义

```go
import (
    "gorm.io/driver/mysql"
    "gorm.io/gorm"
    "gorm.io/gorm/logger"
)

// 模型 —— 嵌入 gorm.Model 获得 ID/CreatedAt/UpdatedAt/DeletedAt
type User struct {
    gorm.Model
    Name    string    `gorm:"type:varchar(100);not null;index:idx_name"`
    Email   string    `gorm:"uniqueIndex;not null"`
    Age     int       `gorm:"default:18;check:age >= 0"`
    Active  bool      `gorm:"default:true"`
    Profile Profile   // HasOne 关联
    Orders  []Order   // HasMany 关联
}

type Profile struct {
    gorm.Model
    UserID  uint   `gorm:"uniqueIndex"`
    Bio     string `gorm:"type:text"`
    Avatar  string
}

type Order struct {
    gorm.Model
    UserID  uint
    Product string
    Amount  float64
}

// 自定义表名
func (User) TableName() string {
    return "sys_users"
}

func main() {
    dsn := "root:password@tcp(127.0.0.1:3306)/testdb?charset=utf8mb4&parseTime=True"
    db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
        Logger: logger.Default.LogMode(logger.Info), // 打印 SQL
    })
    if err != nil {
        log.Fatal(err)
    }

    // 自动迁移（开发环境使用）
    db.AutoMigrate(&User{}, &Profile{}, &Order{})
}
```

### 6.2.2 CRUD 操作

```go
// -------- Create --------
user := User{Name: "张三", Email: "zhangsan@example.com", Age: 28}
result := db.Create(&user)
fmt.Println("新用户ID:", user.ID)     // 回填 ID
fmt.Println("影响行数:", result.RowsAffected)
fmt.Println("错误:", result.Error)

// 批量插入
users := []User{
    {Name: "李四", Email: "lisi@example.com", Age: 32},
    {Name: "王五", Email: "wangwu@example.com", Age: 24},
}
db.Create(&users)

// 按字段子集创建
db.Select("Name", "Email").Create(&user)

// -------- Read --------
// 查询单个
var u User
db.First(&u, 1)                 // 按主键：SELECT * FROM users WHERE id = 1
db.First(&u, "name = ?", "张三") // 条件：SELECT * FROM users WHERE name = '张三' ORDER BY id LIMIT 1
db.Take(&u)                     // 不排序取一条
db.Last(&u)                     // 按主键降序取一条

// 查询多个
var users []User
db.Where("age > ?", 25).Find(&users)
db.Where("name IN ?", []string{"张三", "李四"}).Find(&users)
db.Where(&User{Name: "张三", Active: true}).Find(&users) // struct 条件

// 复杂查询
db.Where("age >= ?", 18).
    Where("active = ?", true).
    Or("name LIKE ?", "%张%").
    Order("age DESC").
    Limit(10).
    Offset(0).
    Find(&users)

// -------- Update --------
db.Model(&user).Update("name", "张三丰")           // 更新单个字段
db.Model(&user).Updates(User{Name: "张三丰", Age: 30}) // 更新多个（零值不更新）
db.Model(&user).Updates(map[string]interface{}{
    "name": "张三丰",
    "age":  0, // map 会更新零值
})

// 条件更新
db.Model(&User{}).Where("age < ?", 18).Update("active", false)

// -------- Delete --------
db.Delete(&u)                      // 软删除（设置了 gorm.DeletedAt）
db.Unscoped().Delete(&u)           // 硬删除
db.Where("age < ?", 18).Delete(&User{}) // 批量删除
```

### 6.2.3 关联关系

```go
// -------- BelongsTo（属于） --------
type Profile struct {
    gorm.Model
    UserID uint
    User   User // BelongsTo：Profile 属于 User
}

// -------- HasMany（一对多） --------
type User struct {
    gorm.Model
    Orders []Order // HasMany：User 有多个 Order
}
// Order 中需要有 UserID 字段

// -------- Many2Many（多对多） --------
// 中间表 user_languages 自动创建
type User struct {
    gorm.Model
    Languages []Language `gorm:"many2many:user_languages;"`
}
type Language struct {
    gorm.Model
    Name string
}

// 关联 CRUD
db.Model(&user).Association("Orders").Find(&orders)
db.Model(&user).Association("Orders").Append(&Order{Product: "手机", Amount: 5999})
db.Model(&user).Association("Orders").Delete(&order)
db.Model(&user).Association("Orders").Clear()
```

### 6.2.4 预加载（Eager Loading）

```go
// -------- Preload（独立查询） --------
var users []User
db.Preload("Profile").Preload("Orders").Find(&users)
// 生成 SQL：
// SELECT * FROM users
// SELECT * FROM profiles WHERE user_id IN (1,2,3,...)
// SELECT * FROM orders WHERE user_id IN (1,2,3,...)

// 带条件的预加载
db.Preload("Orders", "amount > ?", 1000).Find(&users)
db.Preload("Orders", func(db *gorm.DB) *gorm.DB {
    return db.Where("amount > ?", 1000).Order("amount DESC")
}).Find(&users)

// 嵌套预加载
db.Preload("Orders.Items").Preload("Profile.Avatar").Find(&users)

// -------- Joins（左连接，单条 SQL） --------
// Joins 适用于 BelongsTo/HasOne，比 Preload 性能更好
db.Joins("Profile").Joins("Manager").Find(&users)
// SELECT users.*, Profile.* FROM users
// LEFT JOIN profiles Profile ON users.id = Profile.user_id
```

**Preload vs Joins 选择：**

| 方式 | SQL 数量 | 适用场景 |
|------|---------|---------|
| `Preload` | N+1 → 2 条 | HasMany、多层级嵌套 |
| `Joins` | 1 条 | BelongsTo、HasOne、需要 WHERE 过滤关联表 |

### 6.2.5 作用域（Scopes）

作用域封装常用查询条件，提高复用性：

```go
// 定义作用域
func Active(db *gorm.DB) *gorm.DB {
    return db.Where("active = ?", true)
}

func Adult(db *gorm.DB) *gorm.DB {
    return db.Where("age >= ?", 18)
}

func Paginate(page, pageSize int) func(*gorm.DB) *gorm.DB {
    return func(db *gorm.DB) *gorm.DB {
        offset := (page - 1) * pageSize
        return db.Offset(offset).Limit(pageSize)
    }
}

// 使用作用域
var users []User
db.Scopes(Active, Adult, Paginate(1, 20)).Find(&users)

// 动态作用域
type UserQuery struct {
    Name  string
    AgeGT int
    Email string
}

func (q UserQuery) Scopes() func(*gorm.DB) *gorm.DB {
    return func(db *gorm.DB) *gorm.DB {
        if q.Name != "" {
            db = db.Where("name LIKE ?", "%"+q.Name+"%")
        }
        if q.AgeGT > 0 {
            db = db.Where("age > ?", q.AgeGT)
        }
        if q.Email != "" {
            db = db.Where("email = ?", q.Email)
        }
        return db
    }
}

// 使用
db.Scopes(query.Scopes()).Find(&users)
```

### 6.2.6 钩子（Hooks）

GORM 提供模型生命周期钩子：

```go
type User struct {
    gorm.Model
    Name      string
    Email     string
    Password  string
    PasswordHash string
}

// BeforeCreate —— 创建前自动执行
func (u *User) BeforeCreate(tx *gorm.DB) error {
    // 密码加密
    hash, err := bcrypt.GenerateFromPassword([]byte(u.Password), bcrypt.DefaultCost)
    if err != nil {
        return err
    }
    u.PasswordHash = string(hash)
    u.Password = "" // 不保存明文
    return nil
}

// AfterCreate —— 创建后执行（记录审计日志）
func (u *User) AfterCreate(tx *gorm.DB) error {
    return tx.Model(&AuditLog{}).Create(&AuditLog{
        UserID:   u.ID,
        Action:   "created",
        Table:    "users",
    }).Error
}

// BeforeDelete —— 删除前检查
func (u *User) BeforeDelete(tx *gorm.DB) error {
    if u.Name == "admin" {
        return fmt.Errorf("不能删除管理员账号")
    }
    return nil
}
```

**所有钩子：** `BeforeSave`、`BeforeCreate`、`AfterCreate`、`AfterSave`、`BeforeUpdate`、`AfterUpdate`、`BeforeDelete`、`AfterDelete`、`AfterFind`（查询后只执行一次）。

---

## 6.3 连接池与性能

### 6.3.1 连接池参数调优

```go
package pooltune

import (
    "database/sql"
    "time"
)

// ProdDB 生产环境数据库配置
func ProdDB(dsn string) (*sql.DB, error) {
    db, err := sql.Open("mysql", dsn+"?interpolateParams=true")
    if err != nil {
        return nil, err
    }

    // 核心配置
    db.SetMaxOpenConns(50)                // 数据库最大连接数上限
    db.SetMaxIdleConns(25)                // 空闲连接数 = MaxOpenConns 的一半
    db.SetConnMaxLifetime(30 * time.Minute) // 保证连接不超过 MySQL wait_timeout
    db.SetConnMaxIdleTime(10 * time.Minute) // 回收空闲连接

    // 验证配置
    stats := db.Stats()
    // stats.OpenConnections
    // stats.InUse
    // stats.Idle
    // stats.WaitCount
    // stats.WaitDuration
    // stats.MaxIdleClosed
    // stats.MaxLifetimeClosed

    return db, nil
}
```

**监控连接池状态：**

```go
func printPoolStats(db *sql.DB) {
    stats := db.Stats()
    log.Printf("连接池状态 — 打开:%d 使用中:%d 空闲:%d 等待数:%d 等待时间:%v",
        stats.OpenConnections,
        stats.InUse,
        stats.Idle,
        stats.WaitCount,
        stats.WaitDuration,
    )
}

// 在 Prometheus 指标中暴露
var dbOpenConns = promauto.NewGauge(prometheus.GaugeOpts{
    Name: "db_open_connections",
})
// 定时上报
go func() {
    for {
        stats := db.Stats()
        dbOpenConns.Set(float64(stats.OpenConnections))
        time.Sleep(15 * time.Second)
    }
}()
```

### 6.3.2 连接泄漏检测

连接泄漏的常见原因：`rows.Close()` 未调用、事务未 Commit/Rollback。

```go
// 使用 sql.DB.Stats 检测泄漏
func detectLeak(db *sql.DB) {
    stats := db.Stats()
    if stats.InUse > stats.Idle*2 && stats.WaitCount > 100 {
        log.Warn("疑似连接泄漏: InUse=%d Idle=%d WaitCount=%d",
            stats.InUse, stats.Idle, stats.WaitCount)
    }
}

// 工具：使用 net/http/pprof 查看 goroutine 栈
// import _ "net/http/pprof"
// 访问 /debug/pprof/goroutine 查找卡在 database/sql.(*Conn).grabConn 的 goroutine

// 最佳实践：确保 rows 关闭
func queryUsers(db *sql.DB) error {
    rows, err := db.Query("SELECT id, name FROM users")
    if err != nil {
        return err
    }
    defer rows.Close() // 必须！for rows.Next() 结束后也要 Close

    for rows.Next() {
        // ...
    }
    return rows.Err()
}
```

### 6.3.3 慢查询日志

```go
import (
    "gorm.io/gorm/logger"
    "time"
)

// GORM 慢查询配置
db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{
    Logger: logger.New(
        log.New(os.Stdout, "[SQL] ", log.LstdFlags),
        logger.Config{
            SlowThreshold:             200 * time.Millisecond, // 慢查询阈值
            LogLevel:                  logger.Warn,            // 慢查询走 Warn 级别
            IgnoreRecordNotFoundError: true,                   // 忽略 ErrRecordNotFound
            Colorful:                  false,
        },
    ),
})

// database/sql 慢查询 —— 需自行包装
type slowQueryDB struct {
    *sql.DB
    threshold time.Duration
}

func (s *slowQueryDB) Query(query string, args ...interface{}) (*sql.Rows, error) {
    start := time.Now()
    rows, err := s.DB.Query(query, args...)
    if elapsed := time.Since(start); elapsed > s.threshold {
        log.Warnf("慢查询 [%v] %s %v", elapsed, query, args)
    }
    return rows, err
}
```

### 6.3.4 Prepared Statement 缓存

`database/sql` 默认缓存预处理语句，但不同 `*sql.DB` 间不共享：

```go
// 默认启用：db 会缓存 Prepared Statement
// 每次 db.Prepare() 或 db.Query("?", arg) 会在连接池中缓存
// 连接关闭时缓存失效

// 关闭缓存（不推荐，除非遇到 prepare 数量达到 MySQL 上限）
db.SetMaxIdleConns(0) // 空闲连接为 0 会每次新建连接，不缓存 prepare

// interpoalteParams —— 客户端插值而非服务端 prepare
// 适用于高并发短查询，减少 MySQL prepare 次数
// dsn += "?interpolateParams=true"
// 注意：会失去 prepared statement 的 SQL 注入防护
// 只应在参数被严格类型检查时使用
```

---

## 6.4 事务模式

### 6.4.1 声明式事务

GORM 提供 `Transaction` 方法简化事务处理：

```go
func createOrder(db *gorm.DB, userID uint, product string, amount float64) error {
    return db.Transaction(func(tx *gorm.DB) error {
        // 扣减库存
        if err := tx.Model(&Inventory{}).
            Where("product = ? AND quantity >= ?", product, 1).
            Update("quantity", gorm.Expr("quantity - 1")).
            Error; err != nil {
            return err // 自动 Rollback
        }

        // 创建订单
        order := Order{UserID: userID, Product: product, Amount: amount}
        if err := tx.Create(&order).Error; err != nil {
            return err // 自动 Rollback
        }

        // 记录流水
        if err := tx.Create(&Ledger{
            UserID: userID, Amount: amount, Type: "payment",
        }).Error; err != nil {
            return err
        }

        return nil // Commit
    })
}
```

**手动事务（需精细控制）：**

```go
tx := db.Begin()

// 设置事务隔离级别（MySQL 支持）
tx.Set("REPEATABLE READ")
// tx.Exec("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")

if err := tx.Create(&order).Error; err != nil {
    tx.Rollback()
    return err
}

// 部分提交（释放锁但还没完全结束）
// tx.SavePoint("after_order")

if err := tx.Create(&payment).Error; err != nil {
    tx.Rollback()
    return err
}

return tx.Commit().Error
```

### 6.4.2 嵌套事务（SavePoint）

```go
func nestedTransaction(db *gorm.DB) error {
    return db.Transaction(func(tx *gorm.DB) error {
        tx.Create(&User{Name: "外层"})

        // 嵌套事务 —— 使用 SavePoint
        return tx.Transaction(func(tx2 *gorm.DB) error {
            tx2.Create(&User{Name: "内层"})
            // 内层回滚不影响外层
            return errors.New("内层回滚")
        })
    })
    // 结果：外层 User "外层" 会被创建，内层 "内层" 被回滚
}
```

**SavePoint 底层原理：**

```sql
-- 外层事务
BEGIN;
INSERT INTO users (name) VALUES ('外层');

-- 内层事务开始 -> SAVEPOINT sp_xxx
SAVEPOINT sp_1;
INSERT INTO users (name) VALUES ('内层');
-- 如果内层回滚
ROLLBACK TO SAVEPOINT sp_1;

-- 外层提交
COMMIT;
```

### 6.4.3 分布式事务思考

```go
// Go 中常用的分布式事务方案

// 方案一：TCC（Try-Confirm/Cancel）
// 适用：短事务、强一致性需求
type TCCService interface {
    Try(ctx context.Context) error
    Confirm(ctx context.Context) error
    Cancel(ctx context.Context) error
}

// 方案二：SAGA（编排模式）
// 适用：长事务、最终一致性
type SagaStep struct {
    Action   func(ctx context.Context) error
    Compense func(ctx context.Context) error // 补偿操作
}

// 方案三：本地消息表 + 消息队列
// 适用：跨服务最终一致
func placeOrder(db *gorm.DB, mq *rabbitmq.Conn) error {
    return db.Transaction(func(tx *gorm.DB) error {
        // 1. 创建订单
        tx.Create(&order)
        // 2. 写入本地消息表（和订单在同一事务中）
        tx.Create(&Outbox{
            Topic:   "order.created",
            Payload: orderJSON,
        })
        return nil
    })
    // 3. 独立进程轮询 Outbox 表，发送到 MQ
    // 4. 消费方处理成功后删除 Outbox 记录
}
```

### 6.4.4 事务传播行为

GORM 不直接支持 Spring 风格的事务传播，但可通过 `嵌套事务` + `独立连接` 模拟：

```go
// REQUIRED：支持当前事务，不存在则新建（GORM 默认行为）
// REQUIRES_NEW：始终开启新事务（使用新连接）

// 模拟 REQUIRES_NEW：使用独立连接
func requiresNew(db *gorm.DB, fn func(tx *gorm.DB) error) error {
    // 从连接池获取独立连接
    conn, err := db.ConnPool.(*sql.DB).Conn(context.Background())
    if err != nil {
        return err
    }
    defer conn.Close()

    // 在该连接上开启新事务
    tx := db.Begin(&sql.TxOptions{
        Isolation: sql.LevelDefault,
    })
    // ... 操作 ...
    return tx.Commit().Error
}
```

---

## 6.5 Redis 实战

### 6.5.1 go-redis 客户端

```go
import (
    "context"
    "github.com/redis/go-redis/v9"
)

var ctx = context.Background()

func main() {
    rdb := redis.NewClient(&redis.Options{
        Addr:         "localhost:6379",
        Password:     "",
        DB:           0,
        PoolSize:     10,               // 连接池大小
        MinIdleConns: 5,                // 最小空闲连接
        MaxRetries:   3,                // 最大重试次数
        DialTimeout:  5 * time.Second,
        ReadTimeout:  3 * time.Second,
        WriteTimeout: 3 * time.Second,
    })

    pong, err := rdb.Ping(ctx).Result()
    fmt.Println(pong, err)

    // ---------- String ----------
    rdb.Set(ctx, "key", "value", 0)          // 无过期
    rdb.Set(ctx, "key2", "value2", 10*time.Minute) // 10 分钟过期
    val, _ := rdb.Get(ctx, "key").Result()
    val2, _ := rdb.Get(ctx, "nonexist").Result()
    fmt.Println(val, val2) // 不存在返回 redis.Nil

    // ---------- List ----------
    rdb.LPush(ctx, "queue", "task1", "task2")
    task, _ := rdb.BRPop(ctx, 5*time.Second, "queue").Result()

    // ---------- Hash ----------
    rdb.HSet(ctx, "user:1", "name", "张三", "age", 28)
    name, _ := rdb.HGet(ctx, "user:1", "name").Result()
    all, _ := rdb.HGetAll(ctx, "user:1").Result()

    // ---------- Set ----------
    rdb.SAdd(ctx, "tags:go", "concurrency", "generics", "testing")
    members, _ := rdb.SMembers(ctx, "tags:go").Result()

    // ---------- ZSet ----------
    rdb.ZAdd(ctx, "leaderboard",
        redis.Z{Score: 100, Member: "alice"},
        redis.Z{Score: 85, Member: "bob"},
    )
    top3, _ := rdb.ZRevRange(ctx, "leaderboard", 0, 2).Result()

    // ---------- 过期与删除 ----------
    rdb.Expire(ctx, "key", 1*time.Hour)
    rdb.Del(ctx, "key")
    exists, _ := rdb.Exists(ctx, "key").Result()
}
```

### 6.5.2 Pipeline 与批量操作

Pipeline 减少 RTT（往返时间），批量发送命令：

```go
// -------- Pipeline --------
pipe := rdb.Pipeline()

incr := pipe.Incr(ctx, "counter")
pipe.Expire(ctx, "counter", 1*time.Hour)
pipe.Set(ctx, "key", "value", 0)

_, err := pipe.Exec(ctx) // 一次性发送所有命令
fmt.Println(incr.Val())  // 执行后读取结果

// -------- Pipelined 便捷方法 --------
var incrResult *redis.IntCmd
_, err = rdb.Pipelined(ctx, func(pipe redis.Pipeliner) error {
    incrResult = pipe.Incr(ctx, "counter")
    pipe.Expire(ctx, "counter", 1*time.Hour)
    return nil
})
fmt.Println(incrResult.Val())

// -------- 批量操作 --------
// MGet/MSet —— 一次获取/设置多个 Key
vals, _ := rdb.MGet(ctx, "key1", "key2", "key3").Result()
rdb.MSet(ctx, "k1", "v1", "k2", "v2", "k3", "v3")

// 批量删除匹配模式的所有 Key（生产环境慎用）
iter := rdb.Scan(ctx, 0, "user:*", 100).Iterator()
for iter.Next(ctx) {
    rdb.Del(ctx, iter.Val())
}
```

### 6.5.3 Lua 脚本

Lua 脚本保证原子性，用于实现复杂逻辑：

```go
// ---------- 原子扣减库存 ----------
var decrStock = redis.NewScript(`
    local stock = redis.call("GET", KEYS[1])
    if not stock then
        return -1  -- 不存在
    end
    if tonumber(stock) < tonumber(ARGV[1]) then
        return 0   -- 库存不足
    end
    redis.call("DECRBY", KEYS[1], ARGV[1])
    return 1       -- 成功
`)

func DecreaseStock(rdb *redis.Client, key string, count int) (int, error) {
    result, err := decrStock.Run(ctx, rdb, []string{key}, count).Int()
    if err != nil {
        return 0, err
    }
    return result, nil
    // -1: 不存在；0: 库存不足；1: 成功
}

// ---------- 限流（滑动窗口） ----------
var rateLimiter = redis.NewScript(`
    local key = KEYS[1]
    local window = tonumber(ARGV[1])  -- 时间窗口（秒）
    local limit = tonumber(ARGV[2])   -- 最大请求数
    local now = redis.call("TIME")
    local current = tonumber(now[1]) * 1000 + math.floor(now[2] / 1000)

    redis.call("ZREMRANGEBYSCORE", key, 0, current - window * 1000)
    local count = redis.call("ZCARD", key)
    if count >= limit then
        return 0
    end
    redis.call("ZADD", key, current, current .. ":" .. math.random())
    redis.call("EXPIRE", key, window)
    return 1
`)

func AllowRequest(rdb *redis.Client, key string, windowSec, limit int64) bool {
    ok, err := rateLimiter.Run(ctx, rdb, []string{key}, windowSec, limit).Int()
    return err == nil && ok == 1
}
```

### 6.5.4 分布式锁

```go
import (
    "github.com/redis/go-redis/v9"
    "github.com/google/uuid"
)

// 简易分布式锁
type RedisLock struct {
    rdb    *redis.Client
    key    string
    value  string // 唯一值，用于安全释放锁
    ttl    time.Duration
}

func NewRedisLock(rdb *redis.Client, key string, ttl time.Duration) *RedisLock {
    return &RedisLock{
        rdb:   rdb,
        key:   key,
        value: uuid.New().String(),
        ttl:   ttl,
    }
}

// Lock 获取锁 —— SET NX EX 原子操作
func (l *RedisLock) Lock(ctx context.Context) (bool, error) {
    ok, err := l.rdb.SetNX(ctx, l.key, l.value, l.ttl).Result()
    if err != nil {
        return false, err
    }
    return ok, nil
}

// Unlock 释放锁 —— Lua 脚本保证原子性（只释放自己的锁）
var unlockScript = redis.NewScript(`
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
    end
    return 0
`)

func (l *RedisLock) Unlock(ctx context.Context) error {
    _, err := unlockScript.Run(ctx, l.rdb, []string{l.key}, l.value).Result()
    return err
}

// 使用示例
func processWithLock(rdb *redis.Client, userID string) error {
    lock := NewRedisLock(rdb, "lock:user:"+userID, 10*time.Second)
    ctx := context.Background()

    ok, err := lock.Lock(ctx)
    if err != nil {
        return err
    }
    if !ok {
        return fmt.Errorf("获取锁失败，请稍后重试")
    }
    defer lock.Unlock(ctx)

    // 执行业务逻辑
    return nil
}

// Redlock 高可用方案（多节点）
// 建议使用第三方库：github.com/go-redsync/redsync
```

### 6.5.5 缓存穿透/击穿/雪崩的应对

```go
// ---------- 缓存穿透：查询不存在的数据 ----------
// 方案：布隆过滤器 + 空值缓存
func GetUser(rdb *redis.Client, db *sql.DB, userID int) (*User, error) {
    // 1. 查缓存
    val, err := rdb.Get(ctx, fmt.Sprintf("user:%d", userID)).Bytes()
    if err == nil {
        var u User
        json.Unmarshal(val, &u)
        return &u, nil
    }

    // 2. 布隆过滤器快速过滤（需提前初始化）
    exists, _ := rdb.BFExists(ctx, "bloom:users", strconv.Itoa(userID)).Result()
    if !exists {
        return nil, fmt.Errorf("用户不存在") // 直接返回，不打 DB
    }

    // 3. 查数据库
    var u User
    err = db.QueryRow("SELECT id, name FROM users WHERE id = ?", userID).
        Scan(&u.ID, &u.Name)
    if err == sql.ErrNoRows {
        // 空值缓存（短过期，防穿透）
        rdb.Set(ctx, fmt.Sprintf("user:%d", userID), nil, 30*time.Second)
        return nil, fmt.Errorf("用户不存在")
    }
    if err != nil {
        return nil, err
    }

    // 4. 回写缓存
    data, _ := json.Marshal(u)
    rdb.Set(ctx, fmt.Sprintf("user:%d", userID), data, 1*time.Hour)
    return &u, nil
}

// ---------- 缓存击穿：热点 Key 过期瞬间大量并发 ----------
// 方案一：互斥锁（分布式锁）
func GetHotData(rdb *redis.Client, db *sql.DB, key string) (string, error) {
    data, err := rdb.Get(ctx, key).Result()
    if err == nil {
        return data, nil
    }
    if err != redis.Nil {
        return "", err
    }

    // 只有一个 goroutine 查 DB，其余等待
    lockKey := "lock:" + key
    lock := NewRedisLock(rdb, lockKey, 5*time.Second)
    ok, _ := lock.Lock(ctx)
    if !ok {
        // 没抢到锁，等待 50ms 后重试
        time.Sleep(50 * time.Millisecond)
        return GetHotData(rdb, db, key) // 递归重试
    }
    defer lock.Unlock(ctx)

    // 双重检查：可能已由其他协程回写
    data, err = rdb.Get(ctx, key).Result()
    if err == nil {
        return data, nil
    }

    // 查 DB
    var result string
    db.QueryRow("SELECT data FROM hot_data WHERE id = ?", key).Scan(&result)

    // 设置过期时间（加随机偏移）
    expire := 1*time.Hour + time.Duration(rand.Intn(300))*time.Second
    rdb.Set(ctx, key, result, expire)
    return result, nil
}

// ---------- 缓存雪崩：大量 Key 同时过期 ----------
// 方案：过期时间加随机偏移
func cacheSet(rdb *redis.Client, key string, value interface{}, baseTTL time.Duration) {
    // 基础 TTL + 0~300 秒随机偏移
    jitter := time.Duration(rand.Intn(300)) * time.Second
    rdb.Set(ctx, key, value, baseTTL+jitter)
}

// 方案：多级缓存（本地缓存 + Redis）
// 本地缓存使用 freecache / bigcache
// 请求链路: L1(本地) -> L2(Redis) -> DB
```

---

## 6.6 数据库迁移

### 6.6.1 golang-migrate 使用

```go
// 安装 CLI
// $ brew install golang-migrate
// $ go install -tags 'mysql' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

// 创建迁移文件
// $ migrate create -ext sql -dir migrations -seq create_users_table

// 生成两个文件:
// migrations/000001_create_users_table.up.sql
// migrations/000001_create_users_table.down.sql
```

**迁移文件示例：**

```sql
-- 000001_create_users_table.up.sql
CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    age INT DEFAULT 18,
    active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    INDEX idx_users_name (name),
    INDEX idx_users_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 000001_create_users_table.down.sql
DROP TABLE IF EXISTS users;
```

**Go 代码中使用：**

```go
package migration

import (
    "fmt"
    "log"

    "github.com/golang-migrate/migrate/v4"
    _ "github.com/golang-migrate/migrate/v4/database/mysql"
    _ "github.com/golang-migrate/migrate/v4/source/file"
)

// RunMigrations 执行数据库迁移
func RunMigrations(dsn, migrationsDir string) error {
    // database URL 格式: mysql://user:password@tcp(host:port)/dbname
    dbURL := fmt.Sprintf("mysql://%s", dsn)

    m, err := migrate.New(
        fmt.Sprintf("file://%s", migrationsDir),
        dbURL,
    )
    if err != nil {
        return fmt.Errorf("创建迁移实例失败: %w", err)
    }
    defer m.Close()

    // 执行所有待处理的迁移（推荐）
    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("执行迁移失败: %w", err)
    }
    log.Println("数据库迁移完成")
    return nil
}

// 应用启动时调用
func main() {
    dsn := "root:password@tcp(127.0.0.1:3306)/testdb?charset=utf8mb4&parseTime=True"
    if err := RunMigrations(dsn, "./migrations"); err != nil {
        log.Fatal(err)
    }
}
```

### 6.6.2 版本管理

```go
// 常用 migrate CLI 命令：
// migrate -path migrations -database "mysql://..." up       -- 升级到最新
// migrate -path migrations -database "mysql://..." up 3     -- 升级 3 个版本
// migrate -path migrations -database "mysql://..." down 1   -- 回退 1 个版本
// migrate -path migrations -database "mysql://..." version  -- 查看当前版本
// migrate -path migrations -database "mysql://..." goto N   -- 跳到指定版本
// migrate -path migrations -database "mysql://..." force N  -- 强制设置版本（修复脏状态）

// 代码中控制版本：
func MigrateToVersion(dsn, dir string, version uint) error {
    m, err := migrate.New(fmt.Sprintf("file://%s", dir),
        fmt.Sprintf("mysql://%s", dsn))
    if err != nil {
        return err
    }
    defer m.Close()

    // 迁移到指定版本
    if err := m.Migrate(version); err != nil && err != migrate.ErrNoChange {
        return err
    }
    return nil
}

// 检查当前版本
func CurrentVersion(dsn, dir string) (uint, bool, error) {
    m, err := migrate.New(fmt.Sprintf("file://%s", dir),
        fmt.Sprintf("mysql://%s", dsn))
    if err != nil {
        return 0, false, err
    }
    defer m.Close()

    version, dirty, err := m.Version()
    if err == migrate.ErrNilVersion {
        return 0, false, nil // 尚未迁移
    }
    return version, dirty, err
}

// 脏状态处理
// Dirty = true 表示上次迁移中途失败
// 需要手动检查数据库状态，然后 force 版本号
// m.Force(version) 绕过校验，直接设置版本号
```

### 6.6.3 回滚策略

```go
// ---------- 安全回滚流程 ----------
// 1. 迁移前备份（重要！）
//    $ mysqldump -u root -p testdb > backup_$(date +%Y%m%d_%H%M%S).sql

// 2. 预览回滚操作（dry-run 模式）
func DryRunDown(dsn, dir string, steps int) {
    m, _ := migrate.New(fmt.Sprintf("file://%s", dir),
        fmt.Sprintf("mysql://%s", dsn))
    defer m.Close()

    // 读取 down 文件内容（模拟执行）
    version, _, _ := m.Version()
    for i := 0; i < steps; i++ {
        downSQL, _ := os.ReadFile(
            fmt.Sprintf("%s/%06d_*.down.sql", dir, version))
        log.Printf("将执行回滚 #%d:\n%s", version, downSQL)
        version--
    }
}

// 3. 逐步回滚（一次一个版本）
//    不要一次性回滚多个版本，除非确认完全兼容

// 4. 回滚后验证
//    - 检查表结构
//    - 检查数据完整性
//    - 运行测试用例

// ---------- 迁移文件命名规范 ----------
// {version}_{title}.{direction}.sql
//
// 版本号策略：
// 000001_create_users_table.up.sql     -- 唯一递增
// 000002_add_age_to_users.up.sql
// 000002_add_age_to_users.down.sql
//
// 或时间戳风格（golang-migrate v4.18+）：
// 20250101120000_create_users_table.up.sql
// 20250101120000_create_users_table.down.sql

// ---------- 生产环境迁移清单 ----------
// [ ] 在 staging 环境执行一次
// [ ] 确认 up/down 可逆
// [ ] 大表操作使用 pt-online-schema-change
// [ ] 避免锁表（MySQL 5.7 以下 ALTER 会锁全表）
// [ ] 回滚脚本必须经过测试
// [ ] 监控迁移执行时间

// ---------- 嵌入迁移文件（二进制部署）----------
import (
    "github.com/golang-migrate/migrate/v4/source/iofs"
    "embed"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func RunEmbedMigrations(dbURL string) error {
    source, err := iofs.New(migrationsFS, "migrations")
    if err != nil {
        return err
    }

    m, err := migrate.NewWithSourceInstance("iofs", source, dbURL)
    if err != nil {
        return err
    }
    defer m.Close()

    return m.Up()
}
```

**回滚注意事项：**

| 场景 | 建议 |
|------|------|
| ADD COLUMN | 直接 down → DROP COLUMN（安全） |
| DROP COLUMN | 先备份数据，确认无查询引用后再 down |
| 大表加索引 | 使用 `pt-online-schema-change`，down 是 DROP INDEX |
| 数据迁移 | down 需包含反向数据恢复逻辑 |
| 改列类型 | down 可能丢失数据，务必先备份 |

---

> **本章总结**：数据库与缓存是后端系统的核心基础设施。database/sql 提供底层控制力，GORM 提升开发效率，合理配置连接池保障性能，Redis 解决缓存和分布式协调问题，golang-migrate 确保数据库版本可控。实践中应根据场景选择合适的抽象层次，避免过度设计。
