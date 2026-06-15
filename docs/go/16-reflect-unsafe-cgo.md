# 第 16 章：反射、unsafe 与 CGo 进阶

> 目标读者：有 Go 开发经验，希望掌握反射、unsafe 指针操作和 CGo 等高级特性的开发者。本章从反射三定律出发，深入 unsafe 的类型转换与指针操作，以及 CGo 的调用机制与性能优化。

---

## 16.1 反射三定律

### 16.1.1 定律一：反射可以将接口值转换为反射对象

```go
import "reflect"

func law1() {
    var x int = 42
    v := reflect.ValueOf(x)   // 从接口值得到反射 Value
    t := reflect.TypeOf(x)    // 从接口值得到反射 Type

    fmt.Printf("Type: %v\n", t)  // int
    fmt.Printf("Value: %v\n", v) // 42

    // 注意：reflect.ValueOf 传入的是 x 的副本
    // v 是不可修改的
    fmt.Printf("CanSet: %v\n", v.CanSet()) // false
}
```

### 16.1.2 定律二：反射可以从反射对象获取接口值

```go
func law2() {
    var x int = 42
    v := reflect.ValueOf(x)

    // 从 Value 还原为 interface{}
    i := v.Interface()

    // 类型断言
    val := i.(int)
    fmt.Printf("还原值: %d\n", val) // 42
}
```

### 16.1.3 定律三：要修改反射对象，值必须可设置

```go
func law3() {
    var x int = 42

    // ❌ 传入值副本，不可修改
    v := reflect.ValueOf(x)
    // v.SetInt(100) // panic: reflect: call of reflect.Value.SetInt on unaddressable value

    // ✅ 传入指针，通过 Elem() 获取可设置的 Value
    pv := reflect.ValueOf(&x)
    v = pv.Elem() // 解引用
    fmt.Printf("CanSet: %v\n", v.CanSet()) // true
    v.SetInt(100)
    fmt.Printf("x = %d\n", x) // 100
}
```

---

## 16.2 反射实战

### 16.2.1 通用 JSON 序列化器

```go
func marshal(v any) (string, error) {
    val := reflect.ValueOf(v)

    // 处理指针
    if val.Kind() == reflect.Ptr {
        val = val.Elem()
    }

    switch val.Kind() {
    case reflect.Struct:
        var parts []string
        typ := val.Type()
        for i := 0; i < val.NumField(); i++ {
            field := typ.Field(i)
            fieldVal := val.Field(i)

            // 跳过未导出字段
            if !field.IsExported() {
                continue
            }

            jsonTag := field.Tag.Get("json")
            if jsonTag == "-" {
                continue
            }
            name := field.Name
            if jsonTag != "" {
                name = strings.Split(jsonTag, ",")[0]
            }

            sub, err := marshal(fieldVal.Interface())
            if err != nil {
                return "", err
            }
            parts = append(parts, fmt.Sprintf("%q:%s", name, sub))
        }
        return "{" + strings.Join(parts, ",") + "}", nil

    case reflect.Slice, reflect.Array:
        var parts []string
        for i := 0; i < val.Len(); i++ {
            sub, _ := marshal(val.Index(i).Interface())
            parts = append(parts, sub)
        }
        return "[" + strings.Join(parts, ",") + "]", nil

    case reflect.String:
        return fmt.Sprintf("%q", val.String()), nil
    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
        return fmt.Sprintf("%d", val.Int()), nil
    case reflect.Bool:
        return fmt.Sprintf("%t", val.Bool()), nil
    default:
        return "", fmt.Errorf("不支持的类型: %s", val.Kind())
    }
}
```

### 16.2.2 基于 reflect 的验证框架

```go
type Validator struct {
    rules map[string][]func(reflect.Value) error
}

func NewValidator() *Validator {
    return &Validator{rules: make(map[string][]func(reflect.Value) error)}
}

func (v *Validator) Required(field string) *Validator {
    v.rules[field] = append(v.rules[field], func(val reflect.Value) error {
        if val.IsZero() {
            return fmt.Errorf("字段 %s 是必填的", field)
        }
        return nil
    })
    return v
}

func (v *Validator) Min(field string, min int) *Validator {
    v.rules[field] = append(v.rules[field], func(val reflect.Value) error {
        switch val.Kind() {
        case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
            if val.Int() < int64(min) {
                return fmt.Errorf("字段 %s 最小值为 %d", field, min)
            }
        case reflect.String:
            if val.Len() < min {
                return fmt.Errorf("字段 %s 最小长度为 %d", field, min)
            }
        }
        return nil
    })
    return v
}

func (v *Validator) Validate(s any) error {
    val := reflect.ValueOf(s)
    if val.Kind() == reflect.Ptr {
        val = val.Elem()
    }
    typ := val.Type()

    for fieldName, rules := range v.rules {
        f, ok := typ.FieldByName(fieldName)
        if !ok {
            return fmt.Errorf("字段 %s 不存在", fieldName)
        }
        fieldVal := val.FieldByIndex(f.Index)
        for _, rule := range rules {
            if err := rule(fieldVal); err != nil {
                return err
            }
        }
    }
    return nil
}

// 使用
type User struct {
    Name string
    Age  int
}

func main() {
    v := NewValidator().
        Required("Name").Min("Name", 2).
        Required("Age").Min("Age", 0)

    err := v.Validate(&User{Name: "A", Age: -1})
    fmt.Println(err) // 字段 Name 最小长度为 2
}
```

### 16.2.3 反射的性能影响与优化

```go
// 反射比直接调用慢 10~100 倍
// 优化策略：

// 1. 缓存反射结果
type fieldInfo struct {
    index int
    typ   reflect.Type
}

var fieldCache sync.Map

func getCachedField(typ reflect.Type, name string) (fieldInfo, bool) {
    key := typ.String() + "." + name
    if v, ok := fieldCache.Load(key); ok {
        return v.(fieldInfo), true
    }
    f, ok := typ.FieldByName(name)
    if !ok {
        return fieldInfo{}, false
    }
    info := fieldInfo{index: f.Index[0], typ: f.Type}
    fieldCache.Store(key, info)
    return info, true
}

// 2. 使用代码生成代替反射（如 easyjson）
// 3. 使用泛型代替反射（Go 1.18+）
```

---

## 16.3 unsafe 指针操作

### 16.3.1 unsafe.Pointer 四种操作模式

```go
import "unsafe"

// 模式 1：*T → unsafe.Pointer → *T（类型转换）
func pointerConversion() {
    var i int64 = 0x0102030405060708
    // 将 int64 的内存解释为 [8]byte
    p := unsafe.Pointer(&i)
    bytes := (*[8]byte)(p)
    fmt.Printf("字节: %v\n", bytes) // 小端序
}

// 模式 2：unsafe.Pointer → uintptr（指针运算）
func pointerArithmetic() {
    arr := [4]int{10, 20, 30, 40}

    // 获取第一个元素的 unsafe.Pointer
    base := unsafe.Pointer(&arr[0])

    // 指针运算：跳到第 3 个元素
    // uintptr 转换必须在同一个表达式中完成
    third := (*int)(unsafe.Pointer(uintptr(base) + 2*unsafe.Sizeof(arr[0])))
    fmt.Printf("第三个元素: %d\n", *third) // 30
}

// 模式 3：unsafe.Pointer → syscall（系统调用参数）
// 用于传递指针给 syscall

// 模式 4：*T → unsafe.Pointer → *T（不同类型转换）
func sliceHeaderConversion() {
    // string → []byte（零拷贝）
    s := "hello world"
    // string 的底层结构：{ptr, len}
    // slice 的底层结构：{ptr, len, cap}

    // ⚠️ 通过 unsafe 修改 string 的内容是未定义行为
    // string 是不可变的，编译器可能优化为共享内存

    // 安全用法：只读转换
    hdr := (*reflect.StringHeader)(unsafe.Pointer(&s))
    slice := (*reflect.SliceHeader)(unsafe.Pointer(&[]byte{}))
    slice.Data = hdr.Data
    slice.Len = hdr.Len
    slice.Cap = hdr.Len

    // 更简洁的写法
    b := unsafe.Slice(unsafe.StringData(s), len(s))
    fmt.Printf("bytes: %v\n", b)
}
```

### 16.3.2 Go 1.17+ 新增 unsafe 函数

```go
func newUnsafeFunctions() {
    // unsafe.Slice：从指针创建 slice
    arr := [5]int{1, 2, 3, 4, 5}
    s := unsafe.Slice(&arr[0], 5)
    fmt.Printf("slice: %v\n", s) // [1 2 3 4 5]

    // unsafe.SliceData：获取 slice 的底层数组指针
    data := unsafe.SliceData(s)
    fmt.Printf("第一个元素: %d\n", *data) // 1

    // unsafe.String：从指针创建 string
    bytes := []byte("hello")
    str := unsafe.String(unsafe.SliceData(bytes), len(bytes))
    fmt.Printf("string: %s\n", str) // hello

    // unsafe.StringData：获取 string 的底层数据指针
    s2 := "world"
    data2 := unsafe.StringData(s2)
    fmt.Printf("第一个字节: %c\n", *data2) // w

    // unsafe.Add：指针偏移
    base := unsafe.Pointer(&arr[0])
    third := (*int)(unsafe.Add(base, 2*unsafe.Sizeof(arr[0])))
    fmt.Printf("第三个元素: %d\n", *third) // 3
}
```

### 16.3.3 实战：高性能类型转换

```go
// string ↔ []byte 零拷贝转换
func stringToBytes(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
}

func bytesToString(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
}

// ⚠️ 注意：
// - stringToBytes 返回的 []byte 不应该被修改
// - 如果原始 string 被回收，[]byte 会指向无效内存
// - 只在性能关键路径使用，且确保生命周期正确

// 性能对比
func benchmarkConversion(b *testing.B) {
    s := strings.Repeat("x", 1024)

    b.Run("标准转换", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = []byte(s)
        }
    })
    // ~100 ns/op, 每次分配+拷贝

    b.Run("unsafe 零拷贝", func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            _ = stringToBytes(s)
        }
    })
    // ~1 ns/op, 无分配无拷贝
}
```

---

## 16.4 CGo

### 16.4.1 基础用法

```go
// #cgo CFLAGS: -I./include
// #cgo LDFLAGS: -L./lib -lmylib
// #include "mylib.h"
// #include <stdlib.h>
import "C"
import "unsafe"

func callCFunction() {
    // 调用 C 函数
    result := C.my_function(42)
    fmt.Printf("C 函数返回: %d\n", result)

    // C 字符串 → Go 字符串
    cStr := C.CString("hello from Go")
    defer C.free(unsafe.Pointer(cStr)) // 必须手动释放！
    C.my_print(cStr)

    // C 字符串 → Go 字符串
    goStr := C.GoString(cStr)
    fmt.Println(goStr)

    // Go []byte → C 内存
    goBytes := []byte("hello")
    cBytes := C.CBytes(goBytes)
    defer C.free(cBytes)
}
```

### 16.4.2 CGo 类型映射

| Go 类型 | C 类型 |
|---------|--------|
| `C.char` | `char` |
| `C.schar` | `signed char` |
| `C.uchar` | `unsigned char` |
| `C.short` | `short` |
| `C.int` | `int` |
| `C.long` | `long` |
| `C.longlong` | `long long` |
| `C.float` | `float` |
| `C.double` | `double` |
| `C.size_t` | `size_t` |

### 16.4.3 CGo 的性能开销

```go
// CGo 调用的开销：
// 1. goroutine 栈切换（~50ns）
// 2. 参数/返回值转换
// 3. 线程绑定（CGo 调用期间 M 被锁定）

// ❌ 频繁的 CGo 调用
func badCGoLoop() {
    for i := 0; i < 100000; i++ {
        C.small_function(C.int(i)) // 每次调用 ~200ns
    }
    // 总计 ~20ms
}

// ✅ 批量调用减少开销
func goodCGoBatch() {
    // 一次性传递数组
    arr := make([]C.int, 100000)
    for i := range arr {
        arr[i] = C.int(i)
    }
    C.batch_function(&arr[0], C.size_t(len(arr)))
}
```

### 16.4.4 CGo 回调 Go 函数

```go
// #cgo CFLAGS: -I.
// #include "callback.h"
// extern void goCallback(int);
import "C"

// 导出 Go 函数给 C
//export goCallback
func goCallback(val C.int) {
    fmt.Printf("C 调用 Go 回调: %d\n", int(val))
}

// C 代码（callback.h）：
// void registerCallback(void (*fn)(int));
// void triggerCallback(int val);
```

### 16.4.5 CGo 的限制与注意事项

```go
// 1. CGo 调用期间 goroutine 被锁定到 M
//    - 不会发生抢占
//    - 不会发生 Hand Off
//    - 如果 C 函数阻塞，M 也被阻塞

// 2. C 内存不受 Go GC 管理
//    - C.malloc 分配的内存必须 C.free
//    - C.CString/C.CBytes 分配的内存必须 C.free

// 3. 交叉编译限制
//    - CGo 需要目标平台的 C 工具链
//    - CGO_ENABLED=0 禁用 CGo（纯 Go 构建）

// 4. 构建速度
//    - CGo 文件修改后需要重新编译 C 代码
//    - 比 纯 Go 编译慢很多

// 环境变量
// CGO_ENABLED=0 go build  # 禁用 CGo
// CGO_ENABLED=1 go build  # 启用 CGo（默认）
```

---

## 16.5 汇编 Stub

### 16.5.1 为什么需要汇编 Stub

Go 的某些底层函数无法用 Go 本身实现（如栈切换、调度器入口），需要用汇编编写：

```go
// runtime/asm_amd64.s —— 汇编 Stub 示例
// func gogo(buf *gobuf)
// 切换到 gobuf 保存的 goroutine 上下文
TEXT runtime·gogo(SB), NOSPLIT, $0-8
    MOVQ    buf+0(FP), BX       // 加载 gobuf 指针
    MOVQ    gobuf_g(BX), DX     // 加载 G 指针
    MOVQ    0(DX), CX           // 确保 G 不为 nil
    MOVQ    gobuf_sp(BX), SP    // 恢复栈指针
    MOVQ    gobuf_pc(BX), BX    // 恢复程序计数器
    JMP     BX                  // 跳转到目标 goroutine
```

### 16.5.2 使用 go:linkname 访问未导出函数

```go
// go:linkname 允许访问其他包的未导出函数
// ⚠️ 这是非官方特性，可能在版本间变化

//go:linkname runtime_fastrand runtime.fastrand
func runtime_fastrand() uint32

func main() {
    // 访问 runtime 包的未导出随机数函数
    r := runtime_fastrand()
    fmt.Println(r)
}
```

---

## 小结

| 主题 | 关键点 | 注意事项 |
|------|--------|---------|
| 反射三定律 | 接口→反射对象、反射→接口、可设置性 | 性能比直接调用慢 10~100 倍 |
| 反射实战 | 通用序列化、验证框架 | 缓存反射结果、考虑代码生成 |
| unsafe.Pointer | 四种操作模式 | 必须在同一表达式完成 uintptr 转换 |
| unsafe 新函数 | Slice/String/SliceData/StringData/Add | Go 1.17+，更安全的 API |
| 零拷贝转换 | string↔[]byte | 不可修改、生命周期管理 |
| CGo | C 函数调用、类型映射、回调 | 调用开销 ~200ns、M 被锁定 |
| CGo 限制 | 内存管理、交叉编译、构建速度 | CGO_ENABLED=0 禁用 |
| 汇编 Stub | gogo、go:linkname | 非官方特性，版本间可能变化 |