# 第 2 章：接口与泛型

---

## 2.1 接口设计哲学

### 隐式实现（Duck Typing）

Go 的接口是**隐式实现**的——一个类型只要实现了接口的所有方法，它就自动满足该接口，无需显式声明 `implements` 关键字。

```go
// 定义接口
type Stringer interface {
    String() string
}

// 无需声明 implements，自动满足
type User struct{ Name string }

func (u User) String() string { return u.Name }

// 任何有 String() string 方法的类型都能传进来
func Print(s Stringer) { fmt.Println(s.String()) }

func main() {
    Print(User{Name: "alice"}) // 输出: alice
}
```

**对比 Java/C#：** 隐式实现让松耦合成为默认行为。包 A 定义接口，包 B 实现它，无需依赖对方。这催生了"适配器模式是 Go 的口头禅"的说法。

### 小接口原则

> "The bigger the interface, the weaker the abstraction." — Rob Pike

Go 标准库的接口通常只有 1–3 个方法：

```go
type Reader interface { Read(p []byte) (n int, err error) }
type Writer interface { Write(p []byte) (n int, err error) }
type Closer interface { Close() error }

// 组合成大接口
type ReadWriteCloser interface {
    Reader
    Writer
    Closer
}
```

小接口的好处：
- **易于实现**：`*os.File`、`bytes.Buffer`、`strings.Reader` 都实现了 `io.Reader`
- **易于组合**：通过嵌入拼出你需要的能力集
- **易于测试**：可以轻松构造 mock

### io.Reader / io.Writer 的设计智慧

```go
// 整个 io 包的核心——只是一个函数签名
type Reader interface {
    Read(p []byte) (n int, err error)
}

// 任意实现都能组合使用
func Copy(dst Writer, src Reader) (int64, error)
```

这个设计让 Go 拥有了类似 Unix 管道的生态：任何实现了 `Reader` 的都可以读，任何实现了 `Writer` 的都可以写。`io.Copy`、`io.MultiReader`、`io.TeeReader` 等组合函数都是在这个基础上构建的。

### 接口定义在消费方

接口应该定义在**使用方**而非生产方。生产方返回具体类型，消费方按需声明接口。

```go
// ❌ 错误：生产方定义接口
package user

type Storage interface {
    Save(u User) error
}

type dbStorage struct{}

func (d dbStorage) Save(u User) error { /* ... */ }

func NewStorage() Storage { return &dbStorage{} }

// ✅ 正确：消费方定义自己需要的接口
package user

type User struct{ Name string }

type dbStorage struct{}

func (d dbStorage) Save(u User) error { /* ... */ }

func NewStorage() *dbStorage { return &dbStorage{} }

// --- 消费方 ---
package handler

type saver interface {
    Save(user.User) error
}

func CreateUser(s saver) { /* 只依赖 saver 接口 */ }
```

这样避免了包之间的循环依赖，也避免了不必要的接口污染。

---

## 2.2 类型断言与类型 switch

### 类型断言（Type Assertion）

```go
var v interface{} = "hello"

s := v.(string)       // 直接断言，失败则 panic
fmt.Println(s)

s, ok := v.(string)   // 安全断言，ok 为 false 表示失败
if !ok {
    fmt.Println("not a string")
}

// panic 场景
n := v.(int)          // panic: interface conversion: interface{} is string, not int
```

### 类型 switch（Type Switch）

```go
func classify(v interface{}) string {
    switch x := v.(type) {
    case nil:
        return "nil"
    case int, int8, int16, int32, int64:
        return "integer"
    case string:
        return "string, len=" + strconv.Itoa(len(x))
    case bool:
        return "bool"
    case error:
        return "error: " + x.Error()
    default:
        return fmt.Sprintf("unknown: %T", v)
    }
}
```

`x` 在 `case` 分支内被自动转换为该分支的具体类型，无需再次断言。

### 接口组合与嵌套

```go
// 嵌套组合
type ReadSeeker interface {
    io.Reader
    io.Seeker
}

// 等价于手动展开
type ReadSeekerManual interface {
    Read(p []byte) (n int, err error)
    Seek(offset int64, whence int) (int64, error)
}

// 实际应用：http.ResponseWriter 的内嵌
type ResponseWriter interface {
    Header() http.Header
    Write([]byte) (int, error)
    WriteHeader(int)
}

// 通过内嵌扩展
type FlusherResponseWriter interface {
    http.ResponseWriter
    http.Flusher
}
```

### 常见陷阱：nil 接口 vs nil 值

这是 Go 中最常见的接口 bug 之一。

```go
// 陷阱：接口持有 nil 指针，但接口本身 != nil
type Err struct{ Msg string }

func (e *Err) Error() string {
    if e == nil {
        return "no error"
    }
    return e.Msg
}

func getErr(flag bool) error {
    var e *Err = nil
    if flag {
        e = &Err{Msg: "oops"}
    }
    return e // ⚠️ 返回的是 (*Err, nil)，不是 (nil, nil)
}

func main() {
    err := getErr(false)
    fmt.Println(err == nil) // false !!

    // 即使调方法看起来"正常"，但接口本身不是 nil
    // 修复方式：返回显式的 nil
}
```

**修复方案：** 确保在需要返回 nil 接口时返回显式的 `nil` 而非 nil 指针：

```go
func getErrFixed(flag bool) error {
    if !flag {
        return nil // ✅ 返回 (nil, nil)
    }
    return &Err{Msg: "oops"}
}
```

**另一个常见陷阱：** 包含 nil map 或 nil slice 的 struct 赋值给接口后，`== nil` 也是 false。

---

## 2.3 泛型（Go 1.18+）

Go 1.18 引入了泛型。语法使用方括号 `[T]` 声明类型参数。

### 类型参数与泛型函数

```go
// 泛型函数：适用于任意可比较类型
func Min[T constraints.Ordered](a, b T) T {
    if a < b {
        return a
    }
    return b
}

func main() {
    fmt.Println(Min[int](3, 5))     // 显式指定类型参数
    fmt.Println(Min(3.14, 2.71))    // 类型推断
    fmt.Println(Min("apple", "banana"))
}
```

### 泛型类型

```go
// 泛型栈
type Stack[T any] struct {
    items []T
}

func (s *Stack[T]) Push(v T) {
    s.items = append(s.items, v)
}

func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 {
        var zero T
        return zero, false
    }
    v := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return v, true
}

func (s *Stack[T]) Peek() (T, bool) {
    if len(s.items) == 0 {
        var zero T
        return zero, false
    }
    return s.items[len(s.items)-1], true
}

func main() {
    s := Stack[int]{}
    s.Push(10)
    s.Push(20)
    v, _ := s.Pop()
    fmt.Println(v) // 20
}
```

### 类型约束

```go
// comparable —— 内置约束，支持 == 和 !=
func Contains[T comparable](slice []T, target T) bool {
    for _, v := range slice {
        if v == target {
            return true
        }
    }
    return false
}

// any —— 等价于 interface{}
func PrintAll[T any](items []T) {
    for _, v := range items {
        fmt.Println(v)
    }
}

// 自定义约束 —— 通过接口实现
type Number interface {
    int | int64 | float64 | float32
}

func Sum[T Number](nums []T) T {
    var total T
    for _, n := range nums {
        total += n
    }
    return total
}
```

**约束中的 `~` 前缀：** 允许底层类型相同但命名不同的类型也满足约束。

```go
type MyInt int // 底层类型是 int

type IntLike interface {
    ~int | ~int64 // ~ 表示底层类型是 int/int64 即可
}

func Double[T IntLike](v T) T { return v * 2 }

func main() {
    fmt.Println(Double(MyInt(5))) // ✅ 输出 10
}
```

### 泛型方法——限制

Go 的泛型方法有重要限制：**方法不能引入新的类型参数**。只有函数和类型可以。

```go
type Container[T any] struct{ val T }

// ✅ 可以：方法的类型参数来自结构体
func (c Container[T]) Get() T { return c.val }

// ❌ 不允许：方法上不能声明新的类型参数
// func (c Container[T]) Convert[U any]() U { /* ... */ }

// ✅ 变通：改用函数
func Convert[T, U any](c Container[T], fn func(T) U) U {
    return fn(c.val)
}
```

### 什么时候该用泛型

**适合泛型的场景：**

| 场景 | 理由 |
|------|------|
| 容器/数据结构 | `Stack[T]`、`List[T]`、`Tree[T]` 等 |
| 操作所有同类型元素 | `Map[T1, T2]`、`Filter[T]`、`Reduce[T]` |
| 消除重复的类型断言 | 替代 `interface{}` + 类型断言 |
| 算法 | `Sort[T]`、`BinarySearch[T]` |

**不适合泛型的场景：**

| 场景 | 理由 |
|------|------|
| 不同类型的操作完全不同 | 用泛型只会让代码更难懂 |
| 只需一个具体类型 | 过早泛化是过度工程 |
| 涉及方法（非函数） | Go 不支持方法级泛型参数 |
| 性能敏感且类型多 | 泛型会在编译期为每种类型生成代码，增加二进制体积 |

---

## 2.4 泛型实战模式

### 泛型切片操作

```go
// 泛型 slice 工具集
type Slice[T any] []T

func (s Slice[T]) Filter(fn func(T) bool) Slice[T] {
    var out Slice[T]
    for _, v := range s {
        if fn(v) {
            out = append(out, v)
        }
    }
    return out
}

// 独立的函数版本
func Map[T, U any](input []T, fn func(T) U) []U {
    output := make([]U, len(input))
    for i, v := range input {
        output[i] = fn(v)
    }
    return output
}

func Reduce[T, U any](input []T, init U, fn func(U, T) U) U {
    acc := init
    for _, v := range input {
        acc = fn(acc, v)
    }
    return acc
}

func main() {
    nums := []int{1, 2, 3, 4, 5}

    doubled := Map(nums, func(n int) int { return n * 2 })
    fmt.Println(doubled) // [2 4 6 8 10]

    sum := Reduce(nums, 0, func(acc, n int) int { return acc + n })
    fmt.Println(sum) // 15

    // Filter with Slice type
    s := Slice[int](nums)
    evens := s.Filter(func(n int) bool { return n%2 == 0 })
    fmt.Println(evens) // [2 4]
}
```

### 泛型排序

```go
import "sort"

// 通用排序：任何实现了 sort.Interface 的都能排
type Sortable[T any] struct {
    data []T
    less func(a, b T) bool
}

func (s Sortable[T]) Len() int           { return len(s.data) }
func (s Sortable[T]) Less(i, j int) bool { return s.less(s.data[i], s.data[j]) }
func (s Sortable[T]) Swap(i, j int)      { s.data[i], s.data[j] = s.data[j], s.data[i] }

func Sort[T any](data []T, less func(a, b T) bool) {
    sort.Sort(Sortable[T]{data: data, less: less})
}

func main() {
    people := []struct {
        Name string
        Age  int
    }{
        {"Alice", 30},
        {"Bob", 25},
        {"Charlie", 35},
    }

    // 按年龄排序
    Sort(people, func(a, b struct{ Name string; Age int }) bool {
        return a.Age < b.Age
    })
    fmt.Println(people) // [{Bob 25} {Alice 30} {Charlie 35}]

    // 利用 constraints.Ordered
    nums := []int{5, 2, 8, 1, 9}
    Sort(nums, func(a, b int) bool { return a < b })
    fmt.Println(nums) // [1 2 5 8 9]
}
```

### 泛型 HTTP Handler

```go
// 泛型 JSON API handler——消除重复的序列化和错误处理
type APIHandler[T any, R any] func(ctx context.Context, req T) (R, error)

func MakeHandler[T any, R any](handler APIHandler[T, R]) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var req T
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
            return
        }

        resp, err := handler(r.Context(), req)
        if err != nil {
            // 简化：实际应考虑错误类型
            http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
            return
        }

        w.Header().Set("Content-Type", "application/json")
        json.NewEncoder(w).Encode(resp)
    }
}

// 使用示例
type CreateUserReq struct {
    Name  string `json:"name"`
    Email string `json:"email"`
}

type CreateUserResp struct {
    ID  int    `json:"id"`
    OK  bool   `json:"ok"`
}

func createUser(ctx context.Context, req CreateUserReq) (CreateUserResp, error) {
    // 业务逻辑...
    return CreateUserResp{ID: 42, OK: true}, nil
}

func main() {
    http.HandleFunc("/api/users", MakeHandler(createUser))
    // curl -X POST -d '{"name":"alice","email":"a@b.com"}' /api/users
    // 返回 {"id":42,"ok":true}
}
```

### 泛型与接口的配合

```go
// 泛型约束可以是接口，两者是互补关系
type Serializer[T any] interface {
    Serialize(v T) ([]byte, error)
    Deserialize(data []byte, v *T) error
}

type JSONSerializer[T any] struct{}

func (JSONSerializer[T]) Serialize(v T) ([]byte, error) {
    return json.Marshal(v)
}

func (JSONSerializer[T]) Deserialize(data []byte, v *T) error {
    return json.Unmarshal(data, v)
}

// 泛型函数搭配接口约束
func Process[T any](data []byte, s Serializer[T]) (*T, error) {
    var v T
    if err := s.Deserialize(data, &v); err != nil {
        return nil, err
    }
    return &v, nil
}
```

---

## 2.5 接口与泛型的选择

### 权衡全景

| 维度 | 接口 | 泛型 |
|------|------|------|
| **分发机制** | 运行时动态分发（vtable） | 编译期单态化（静态） |
| **性能** | 有间接调用开销，可能逃逸到堆 | 零开销抽象，可内联 |
| **二进制体积** | 一份代码 | 每个类型参数实例化一份 |
| **表达能力** | 可以表示行为契约（方法集） | 可以表示类型族（约束） |
| **方法支持** | 类型可以完全基于接口定义 | 方法不能额外泛型化 |
| **反射** | `reflect` 可完整工作 | 受限（不能用 `T` 做类型 switch） |

### 经验法则

**选接口当：**
- 你需要表达**行为契约**（方法集）
- 你需要**运行时多态**（一个切片里存不同类型）
- 你需要**依赖注入**和 mock 测试
- 你的抽象边界在**包边界**（比如存储层、消息队列）

**选泛型当：**
- 你的逻辑对**所有类型都相同**（容器、算法）
- 你想消除 `interface{}` 的类型断言
- 你在写工具库/辅助函数
- 你关心**编译期类型安全**胜过运行时灵活

### 同一个问题，两种解法

```go
// ========== 接口方案 ==========
type Comparator interface {
    Less(other Comparator) bool
}

type Int int
func (a Int) Less(b Comparator) bool { return a < b.(Int) }

func SortInterfaces(items []Comparator) { /* ... */ }

// ========== 泛型方案 ==========
func SortGeneric[T constraints.Ordered](items []T) {
    sort.Slice(items, func(i, j int) bool {
        return items[i] < items[j]
    })
}

// 对比：泛型方案类型安全（编译期检查），
//       接口方案更灵活（可处理不能加约束的类型）
```

### 混合使用——最佳实践

最强大的模式是**接口 + 泛型一起用**：

```go
// 接口定义行为边界
type Store[T any] interface {
    Get(id string) (T, error)
    Set(id string, val T) error
}

// 泛型函数使用接口
func CacheThenGet[T any](store Store[T], id string, fetch func() (T, error)) (T, error) {
    v, err := store.Get(id)
    if err == nil {
        return v, nil
    }
    v, err = fetch()
    if err != nil {
        var zero T
        return zero, err
    }
    store.Set(id, v)
    return v, nil
}
```

> **核心原则：接口定义"做什么"（行为），泛型定义"对什么做"（类型）。**

---

## 总结

| 概念 | 要点 |
|------|------|
| 隐式实现 | 松耦合，小接口，接口在消费方定义 |
| 类型断言 | `v.(T)` + `ok` 模式，避免 nil 接口陷阱 |
| 泛型 | `[T any]`，函数 + 类型，约束用 `interface` |
| 实战模式 | 切片工具、排序、HTTP handler、与接口配合 |
| 选择权衡 | 接口 = 运行时多态，泛型 = 编译期多态 |

> 当你不知道该选接口还是泛型时，先从具体类型开始，重构时再抽象。过度设计是万恶之源。
