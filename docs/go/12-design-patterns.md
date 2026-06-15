# 第 12 章：设计模式

> 目标读者：有 Go 开发经验，希望系统掌握 GoF 23 种经典设计模式及 Go 特有惯用模式的开发者。所有示例均使用 Go 语言特性实现，强调 Go 风格的简洁性。

---

## 创建型模式

创建型模式关注对象的创建机制，使系统在创建对象时更加灵活、可复用。

---

### 12.1 单例（Singleton）

确保一个类只有一个实例，并提供一个全局访问点。Go 中通过 `sync.Once` 实现最简洁且线程安全的单例。

```go
package main

import (
	"fmt"
	"sync"
)

// Config 全局配置管理器（懒加载单例）
type Config struct {
	AppName string
	Port    int
}

var (
	configInstance *Config
	once          sync.Once
	initConfigFn  = func() {
		configInstance = &Config{
			AppName: "my-app",
			Port:    8080,
		}
	}
)

// GetConfig 返回全局唯一的配置实例
func GetConfig() *Config {
	once.Do(initConfigFn)
	return configInstance
}

// ResetConfig 仅用于测试：重置单例
func ResetConfig() {
	configInstance = nil
	once = sync.Once{}
}

func main() {
	cfg1 := GetConfig()
	cfg2 := GetConfig()

	fmt.Printf("cfg1 == cfg2: %v\n", cfg1 == cfg2) // true
	fmt.Printf("AppName: %s, Port: %d\n", cfg1.AppName, cfg1.Port)

	// 并发安全测试
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cfg := GetConfig()
			_ = cfg
		}()
	}
	wg.Wait()
	fmt.Println("All goroutines got same singleton instance")
}
```

> **要点总结：**
> - `sync.Once` 是 Go 中最推荐的单例实现方式，保证并发安全且延迟加载
> - 避免在 `init()` 中初始化单例，会破坏延迟加载和测试灵活性
> - 全局单例增加隐式耦合，使用依赖注入替代单例往往是更好的设计

---

### 12.2 工厂方法（Factory Method）

定义一个创建对象的接口，让子类决定实例化哪个类。Go 中通过接口+构造函数实现。

```go
package main

import "fmt"

// Payment 支付方式接口
type Payment interface {
	Pay(amount float64) string
}

// ---------- 具体产品 ----------

type Alipay struct{}

func (a *Alipay) Pay(amount float64) string {
	return fmt.Sprintf("支付宝支付: ¥%.2f", amount)
}

type WechatPay struct{}

func (w *WechatPay) Pay(amount float64) string {
	return fmt.Sprintf("微信支付: ¥%.2f", amount)
}

type CreditCard struct{}

func (c *CreditCard) Pay(amount float64) string {
	return fmt.Sprintf("信用卡支付: ¥%.2f", amount)
}

// ---------- 工厂方法 ----------

// PaymentFactory 工厂函数，根据类型返回对应的支付实现
func PaymentFactory(paymentType string) Payment {
	switch paymentType {
	case "alipay":
		return &Alipay{}
	case "wechat":
		return &WechatPay{}
	case "credit":
		return &CreditCard{}
	default:
		panic(fmt.Sprintf("unknown payment type: %s", paymentType))
	}
}

func main() {
	types := []string{"alipay", "wechat", "credit"}
	amount := 99.99

	for _, t := range types {
		payment := PaymentFactory(t)
		fmt.Println(payment.Pay(amount))
	}
}
```

> **要点总结：**
> - 工厂方法将对象的创建和使用解耦
> - 新增支付方式只需添加新的 struct+实现，无需修改已有代码（开闭原则）
> - Go 中无需抽象工厂类，普通的工厂函数即可实现

---

### 12.3 抽象工厂（Abstract Factory）

提供一个创建一系列相关或相互依赖对象的接口，而无需指定它们的具体类。Go 中通过接口组合实现。

```go
package main

import "fmt"

// ---------- 抽象产品 ----------

// Button 按钮接口
type Button interface {
	Render() string
	OnClick() string
}

// ScrollBar 滚动条接口
type ScrollBar interface {
	Render() string
	Scroll(direction string) string
}

// ---------- 具体产品：Windows 风格 ----------

type WindowsButton struct{}

func (w *WindowsButton) Render() string    { return "Windows Button" }
func (w *WindowsButton) OnClick() string   { return "Windows click sound" }

type WindowsScrollBar struct{}

func (w *WindowsScrollBar) Render() string           { return "Windows ScrollBar" }
func (w *WindowsScrollBar) Scroll(dir string) string { return fmt.Sprintf("Windows scrolling %s", dir) }

// ---------- 具体产品：Mac 风格 ----------

type MacButton struct{}

func (m *MacButton) Render() string  { return "Mac Button" }
func (m *MacButton) OnClick() string { return "Mac click sound" }

type MacScrollBar struct{}

func (m *MacScrollBar) Render() string           { return "Mac ScrollBar" }
func (m *MacScrollBar) Scroll(dir string) string { return fmt.Sprintf("Mac scrolling %s", dir) }

// ---------- 抽象工厂接口 ----------

type UIFactory interface {
	CreateButton() Button
	CreateScrollBar() ScrollBar
}

type WindowsFactory struct{}
func (w *WindowsFactory) CreateButton() Button    { return &WindowsButton{} }
func (w *WindowsFactory) CreateScrollBar() ScrollBar { return &WindowsScrollBar{} }

type MacFactory struct{}
func (m *MacFactory) CreateButton() Button    { return &MacButton{} }
func (m *MacFactory) CreateScrollBar() ScrollBar { return &MacScrollBar{} }

// ---------- 客户端代码 ----------

type Application struct {
	button    Button
	scrollBar ScrollBar
}

func NewApplication(factory UIFactory) *Application {
	return &Application{
		button:    factory.CreateButton(),
		scrollBar: factory.CreateScrollBar(),
	}
}

func (a *Application) Render() {
	fmt.Println(a.button.Render())
	fmt.Println(a.scrollBar.Render())
}

func main() {
	app := NewApplication(&MacFactory{})
	app.Render()

	// 切换风格无需修改 Application 代码
	app2 := NewApplication(&WindowsFactory{})
	app2.Render()
}
```

> **要点总结：**
> - 抽象工厂保证同一产品族的产品兼容性（不会出现 Windows 按钮 + Mac 滚动条）
> - Go 中通过接口组合替代抽象类，工厂方法返回接口类型
> - 新增产品族只需实现一组具体产品+工厂，符合开闭原则

---

### 12.4 建造者（Builder）

将一个复杂对象的构建与它的表示分离，使得同样的构建过程可以创建不同的表示。Go 中通常通过链式调用实现。

```go
package main

import (
	"fmt"
	"strings"
)

// Email 复杂邮件对象
type Email struct {
	From    string
	To      []string
	Cc      []string
	Bcc     []string
	Subject string
	Body    string
	HTML    bool
	Headers map[string]string
}

// EmailBuilder 邮件建造者
type EmailBuilder struct {
	email *Email
	errs  []string
}

func NewEmailBuilder() *EmailBuilder {
	return &EmailBuilder{
		email: &Email{
			Headers: make(map[string]string),
		},
	}
}

func (b *EmailBuilder) From(from string) *EmailBuilder {
	b.email.From = from
	return b
}

func (b *EmailBuilder) To(to ...string) *EmailBuilder {
	b.email.To = append(b.email.To, to...)
	return b
}

func (b *EmailBuilder) Cc(cc ...string) *EmailBuilder {
	b.email.Cc = append(b.email.Cc, cc...)
	return b
}

func (b *EmailBuilder) Bcc(bcc ...string) *EmailBuilder {
	b.email.Bcc = append(b.email.Bcc, bcc...)
	return b
}

func (b *EmailBuilder) Subject(subject string) *EmailBuilder {
	b.email.Subject = subject
	return b
}

func (b *EmailBuilder) Body(body string) *EmailBuilder {
	b.email.Body = body
	return b
}

func (b *EmailBuilder) IsHTML(html bool) *EmailBuilder {
	b.email.HTML = html
	return b
}

func (b *EmailBuilder) Header(key, value string) *EmailBuilder {
	b.email.Headers[key] = value
	return b
}

// Build 构建并验证 Email
func (b *EmailBuilder) Build() (*Email, error) {
	if b.email.From == "" {
		b.errs = append(b.errs, "From is required")
	}
	if len(b.email.To) == 0 {
		b.errs = append(b.errs, "To is required")
	}
	if len(b.errs) > 0 {
		return nil, fmt.Errorf("email validation failed: %s", strings.Join(b.errs, "; "))
	}
	return b.email, nil
}

// SendEmail 发送邮件（模拟）
func SendEmail(email *Email) {
	fmt.Printf("Sending email from %s to %v\nSubject: %s\n", email.From, email.To, email.Subject)
}

func main() {
	email, err := NewEmailBuilder().
		From("no-reply@example.com").
		To("user1@example.com", "user2@example.com").
		Cc("manager@example.com").
		Subject("Weekly Report").
		Body("<h1>Report</h1><p>All good!</p>").
		IsHTML(true).
		Header("X-Priority", "high").
		Build()

	if err != nil {
		fmt.Println("Error:", err)
		return
	}

	SendEmail(email)
}
```

> **要点总结：**
> - Builder 模式适用于构造参数多、有必填项和复杂验证逻辑的对象
> - 链式调用（Method Chaining）使代码可读性和可维护性大幅提升
> - `Build()` 方法中统一验证，避免对象处于不一致状态

---

### 12.5 原型（Prototype）

通过复制现有对象来创建新对象，而不是通过实例化。Go 中通过深拷贝实现。

```go
package main

import (
	"encoding/gob"
	"bytes"
	"fmt"
)

// Prototype 原型接口
type Prototype interface {
	Clone() Prototype
}

// User 用户对象（含指针字段，需要深拷贝）
type User struct {
	Name    string
	Age     int
	Address *Address
	Tags    []string
}

type Address struct {
	City    string
	Street  string
	ZipCode string
}

// Clone 使用 gob 编码实现深拷贝
func (u *User) Clone() *User {
	var buf bytes.Buffer
	enc := gob.NewEncoder(&buf)
	dec := gob.NewDecoder(&buf)

	if err := enc.Encode(u); err != nil {
		panic(fmt.Sprintf("encode error: %v", err))
	}

	var clone User
	if err := dec.Decode(&clone); err != nil {
		panic(fmt.Sprintf("decode error: %v", err))
	}
	return &clone
}

// CloneManual 手动深拷贝（更高性能，无反射）
func (u *User) CloneManual() *User {
	tags := make([]string, len(u.Tags))
	copy(tags, u.Tags)

	return &User{
		Name: u.Name,
		Age:  u.Age,
		Tags: tags,
		Address: &Address{
			City:    u.Address.City,
			Street:  u.Address.Street,
			ZipCode: u.Address.ZipCode,
		},
	}
}

func main() {
	original := &User{
		Name: "Alice",
		Age:  30,
		Address: &Address{
			City:    "Beijing",
			Street:  "Chaoyang Road",
			ZipCode: "100000",
		},
		Tags: []string{"vip", "developer"},
	}

	clone := original.Clone()

	// 修改克隆对象不影响原对象
	clone.Name = "Bob"
	clone.Address.City = "Shanghai"
	clone.Tags[0] = "admin"

	fmt.Printf("Original: %+v\n", original)
	fmt.Printf("Clone:    %+v\n", clone)

	// 验证深拷贝
	fmt.Printf("Address same pointer: %v\n", original.Address == clone.Address) // false
}
```

> **要点总结：**
> - 原型模式适用于创建成本高（如 DB 查询结果）的对象
> - Go 中必须使用深拷贝，共享指针字段会导致意外副作用
> - `gob` 编码通用但性能较低；手动复制性能更好但需维护

---

## 结构型模式

结构型模式关注类和对象的组合，用于构建更大、更灵活的结构。

---

### 12.6 适配器（Adapter）

将一个类的接口转换成客户端期望的另一个接口，使原本不兼容的类可以一起工作。

```go
package main

import "fmt"

// ---------- 目标接口 ----------

// SMSProvider 短信发送接口（客户端期望的接口）
type SMSProvider interface {
	Send(phone, message string) error
}

// ---------- 被适配者（第三方 SDK） ----------

// AliyunSDK 阿里云短信 SDK（不兼容的接口）
type AliyunSDK struct{}

func (a *AliyunSDK) SendSMS(phoneNumbers, signName, templateCode string) error {
	fmt.Printf("[Aliyun] Sending SMS to %s, sign: %s, template: %s\n", phoneNumbers, signName, templateCode)
	return nil
}

// TencentSDK 腾讯云短信 SDK（不兼容的接口）
type TencentSDK struct{}

func (t *TencentSDK) SendMessage(phone, content string) error {
	fmt.Printf("[Tencent] Sending message to %s: %s\n", phone, content)
	return nil
}

// ---------- 适配器 ----------

// AliyunAdapter 阿里云适配器
type AliyunAdapter struct {
	sdk *AliyunSDK
}

func NewAliyunAdapter() *AliyunAdapter {
	return &AliyunAdapter{sdk: &AliyunSDK{}}
}

func (a *AliyunAdapter) Send(phone, message string) error {
	return a.sdk.SendSMS(phone, "MyApp", "SMS_123456")
}

// TencentAdapter 腾讯云适配器
type TencentAdapter struct {
	sdk *TencentSDK
}

func NewTencentAdapter() *TencentAdapter {
	return &TencentAdapter{sdk: &TencentSDK{}}
}

func (t *TencentAdapter) Send(phone, message string) error {
	return t.sdk.SendMessage(phone, message)
}

// ---------- 客户端 ----------

// NotifyService 通知服务（只依赖 SMSProvider 接口）
type NotifyService struct {
	provider SMSProvider
}

func NewNotifyService(provider SMSProvider) *NotifyService {
	return &NotifyService{provider: provider}
}

func (n *NotifyService) SendVerificationCode(phone, code string) {
	message := fmt.Sprintf("Your verification code is: %s", code)
	if err := n.provider.Send(phone, message); err != nil {
		fmt.Println("Send failed:", err)
	}
}

func main() {
	// 使用阿里云
	aliyunSvc := NewNotifyService(NewAliyunAdapter())
	aliyunSvc.SendVerificationCode("13800138000", "123456")

	// 切换腾讯云，无需修改 NotifyService
	tencentSvc := NewNotifyService(NewTencentAdapter())
	tencentSvc.SendVerificationCode("13900139000", "654321")
}
```

> **要点总结：**
> - 适配器模式用于整合第三方库、遗留系统等不兼容接口
> - Go 中适配器实现目标接口，内部调用被适配者的方法
> - 适配器将变化封装在内，客户端无需关心底层实现

---

### 12.7 桥接（Bridge）

将抽象与实现分离，使它们可以独立变化。Go 中通过接口组合实现。

```go
package main

import "fmt"

// ---------- 实现层次 ----------

// Device 设备接口（实现层次）
type Device interface {
	IsEnabled() bool
	Enable()
	Disable()
	GetVolume() int
	SetVolume(percent int)
	GetName() string
}

// TV 电视机
type TV struct {
	enabled bool
	volume  int
}

func (t *TV) IsEnabled() bool       { return t.enabled }
func (t *TV) Enable()               { t.enabled = true }
func (t *TV) Disable()              { t.enabled = false }
func (t *TV) GetVolume() int        { return t.volume }
func (t *TV) SetVolume(percent int) { t.volume = percent }
func (t *TV) GetName() string       { return "TV" }

// Radio 收音机
type Radio struct {
	enabled bool
	volume  int
}

func (r *Radio) IsEnabled() bool       { return r.enabled }
func (r *Radio) Enable()               { r.enabled = true }
func (r *Radio) Disable()              { r.enabled = false }
func (r *Radio) GetVolume() int        { return r.volume }
func (r *Radio) SetVolume(percent int) { r.volume = percent }
func (r *Radio) GetName() string       { return "Radio" }

// ---------- 抽象层次 ----------

// Remote 遥控器抽象
type Remote struct {
	device Device
}

func NewRemote(device Device) *Remote {
	return &Remote{device: device}
}

func (r *Remote) TogglePower() {
	if r.device.IsEnabled() {
		r.device.Disable()
	} else {
		r.device.Enable()
	}
}

func (r *Remote) VolumeUp() {
	current := r.device.GetVolume()
	r.device.SetVolume(current + 10)
}

func (r *Remote) VolumeDown() {
	current := r.device.GetVolume()
	r.device.SetVolume(current - 10)
}

// AdvancedRemote 高级遥控器（扩展抽象）
type AdvancedRemote struct {
	*Remote
}

func NewAdvancedRemote(device Device) *AdvancedRemote {
	return &AdvancedRemote{Remote: NewRemote(device)}
}

func (a *AdvancedRemote) Mute() {
	a.device.SetVolume(0)
}

func main() {
	tv := &TV{}
	radio := &Radio{}

	tvRemote := NewRemote(tv)
	tvRemote.TogglePower()
	tvRemote.VolumeUp()
	fmt.Printf("%s: enabled=%v, volume=%d\n", tv.GetName(), tv.IsEnabled(), tv.GetVolume())

	advRemote := NewAdvancedRemote(radio)
	advRemote.TogglePower()
	advRemote.Mute()
	fmt.Printf("%s: enabled=%v, volume=%d\n", radio.GetName(), radio.IsEnabled(), radio.GetVolume())
}
```

> **要点总结：**
> - 桥接模式解决"类爆炸"问题：设备类型 × 遥控器类型 = 组合而非继承
> - 抽象层持有实现层的接口引用，两者通过组合关联
> - Go 的接口组合天然支持桥接，无需继承语法

---

### 12.8 组合（Composite）

将对象组合成树形结构以表示"部分-整体"的层次结构，使得客户端对单个对象和组合对象的使用具有一致性。

```go
package main

import "fmt"

// FileComponent 文件系统组件接口
type FileComponent interface {
	Name() string
	Size() int64
	Print(indent string)
}

// ---------- 叶子节点：文件 ----------

type File struct {
	name string
	size int64
}

func NewFile(name string, size int64) *File {
	return &File{name: name, size: size}
}

func (f *File) Name() string           { return f.name }
func (f *File) Size() int64            { return f.size }
func (f *File) Print(indent string) {
	fmt.Printf("%s📄 %s (%d bytes)\n", indent, f.name, f.size)
}

// ---------- 组合节点：目录 ----------

type Directory struct {
	name     string
	children []FileComponent
}

func NewDirectory(name string) *Directory {
	return &Directory{name: name}
}

func (d *Directory) Add(child FileComponent) {
	d.children = append(d.children, child)
}

func (d *Directory) Remove(child FileComponent) {
	for i, c := range d.children {
		if c == child {
			d.children = append(d.children[:i], d.children[i+1:]...)
			return
		}
	}
}

func (d *Directory) Name() string { return d.name }

func (d *Directory) Size() int64 {
	var total int64
	for _, child := range d.children {
		total += child.Size()
	}
	return total
}

func (d *Directory) Print(indent string) {
	fmt.Printf("%s📁 %s/ (%d bytes)\n", indent, d.name, d.Size())
	for _, child := range d.children {
		child.Print(indent + "  ")
	}
}

func main() {
	// 构建文件树
	root := NewDirectory("root")
	docs := NewDirectory("docs")
	pics := NewDirectory("pictures")

	root.Add(docs)
	root.Add(pics)

	docs.Add(NewFile("readme.md", 1024))
	docs.Add(NewFile("license.md", 512))

	pics.Add(NewFile("photo1.jpg", 204800))
	pics.Add(NewFile("photo2.jpg", 409600))

	// 组合嵌套
	subdir := NewDirectory("subdir")
	subdir.Add(NewFile("notes.txt", 256))
	docs.Add(subdir)

	// 统一操作：打印和计算大小
	root.Print("")
	fmt.Printf("\nTotal size: %d bytes\n", root.Size())
}
```

> **要点总结：**
> - 组合模式让叶子对象和容器对象具有一致的接口
> - 客户端无需区分操作的是单个文件还是整个目录
> - 适用于树形结构场景：文件系统、UI 组件树、组织结构

---

### 12.9 装饰器（Decorator）

动态地给对象添加额外的职责，比继承更灵活。Go 中通过接口嵌入和函数包装实现。

```go
package main

import (
	"fmt"
	"log"
	"time"
)

// ---------- 基础组件接口 ----------

// DataSource 数据源接口
type DataSource interface {
	Read() string
	Write(data string)
}

// ---------- 具体组件 ----------

// FileDataSource 文件数据源
type FileDataSource struct {
	filename string
	data     string
}

func NewFileDataSource(name string) *FileDataSource {
	return &FileDataSource{filename: name}
}

func (f *FileDataSource) Read() string {
	return f.data
}

func (f *FileDataSource) Write(data string) {
	f.data = data
	fmt.Printf("Writing to %s: %s\n", f.filename, data)
}

// ---------- 装饰器基类 ----------

// DataSourceDecorator 装饰器基类（嵌入接口）
type DataSourceDecorator struct {
	wrappee DataSource
}

func (d *DataSourceDecorator) Read() string {
	return d.wrappee.Read()
}

func (d *DataSourceDecorator) Write(data string) {
	d.wrappee.Write(data)
}

// ---------- 具体装饰器 ----------

// EncryptionDecorator 加密装饰器
type EncryptionDecorator struct {
	DataSourceDecorator
}

func NewEncryptionDecorator(source DataSource) *EncryptionDecorator {
	return &EncryptionDecorator{DataSourceDecorator{wrappee: source}}
}

func (e *EncryptionDecorator) Write(data string) {
	encrypted := fmt.Sprintf("encrypted(%s)", data) // 模拟加密
	fmt.Println("🔒 Encrypting data")
	e.wrappee.Write(encrypted)
}

func (e *EncryptionDecorator) Read() string {
	data := e.wrappee.Read()
	decrypted := data[len("encrypted(") : len(data)-1] // 模拟解密
	fmt.Println("🔓 Decrypting data")
	return decrypted
}

// CompressionDecorator 压缩装饰器
type CompressionDecorator struct {
	DataSourceDecorator
}

func NewCompressionDecorator(source DataSource) *CompressionDecorator {
	return &CompressionDecorator{DataSourceDecorator{wrappee: source}}
}

func (c *CompressionDecorator) Write(data string) {
	compressed := fmt.Sprintf("compressed(%s)", data) // 模拟压缩
	fmt.Println("📦 Compressing data")
	c.wrappee.Write(compressed)
}

func (c *CompressionDecorator) Read() string {
	data := c.wrappee.Read()
	uncompressed := data[len("compressed(") : len(data)-1] // 模拟解压
	fmt.Println("📦 Decompressing data")
	return uncompressed
}

// LoggingDecorator 日志装饰器
type LoggingDecorator struct {
	DataSourceDecorator
}

func NewLoggingDecorator(source DataSource) *LoggingDecorator {
	return &LoggingDecorator{DataSourceDecorator{wrappee: source}}
}

func (l *LoggingDecorator) Write(data string) {
	log.Printf("Write: %d bytes", len(data))
	l.wrappee.Write(data)
}

func (l *LoggingDecorator) Read() string {
	data := l.wrappee.Read()
	log.Printf("Read: %d bytes", len(data))
	return data
}

func main() {
	source := NewFileDataSource("test.txt")

	// 多层装饰：加密 → 压缩 → 日志
	decorated := NewLoggingDecorator(
		NewCompressionDecorator(
			NewEncryptionDecorator(source),
		),
	)

	decorated.Write("Hello, World!")
	fmt.Println("\nReading back...")
	result := decorated.Read()
	fmt.Println("Result:", result)
}
```

> **要点总结：**
> - 装饰器模式通过组合替代继承，在运行时动态添加行为
> - Go 中通过嵌入接口类型实现装饰器基类，减少模板代码
> - 装饰器链的顺序影响结果（从外到内写，从内到外读）

---

### 12.10 外观（Facade）

为子系统中的一组接口提供一个统一的简化接口。

```go
package main

import "fmt"

// ---------- 复杂子系统 ----------

// Amplifier 功放
type Amplifier struct{}

func (a *Amplifier) On()    { fmt.Println("Amplifier: on") }
func (a *Amplifier) Off()   { fmt.Println("Amplifier: off") }
func (a *Amplifier) SetVolume(vol int) { fmt.Printf("Amplifier: volume set to %d\n", vol) }

// DVDPlayer DVD 播放器
type DVDPlayer struct{}

func (d *DVDPlayer) On()       { fmt.Println("DVD Player: on") }
func (d *DVDPlayer) Off()      { fmt.Println("DVD Player: off") }
func (d *DVDPlayer) Play(movie string) { fmt.Printf("DVD Player: playing '%s'\n", movie) }

// Projector 投影仪
type Projector struct{}

func (p *Projector) On()       { fmt.Println("Projector: on") }
func (p *Projector) Off()      { fmt.Println("Projector: off") }
func (p *Projector) SetInput(source string) { fmt.Printf("Projector: input set to %s\n", source) }

// Screen 屏幕
type Screen struct{}

func (s *Screen) Down() { fmt.Println("Screen: down") }
func (s *Screen) Up()   { fmt.Println("Screen: up") }

// PopcornPopper 爆米花机
type PopcornPopper struct{}

func (p *PopcornPopper) On()    { fmt.Println("Popcorn Popper: on") }
func (p *PopcornPopper) Pop()   { fmt.Println("Popcorn Popper: popping popcorn") }
func (p *PopcornPopper) Off()   { fmt.Println("Popcorn Popper: off") }

// ---------- 外观 ----------

type HomeTheaterFacade struct {
	amp      *Amplifier
	dvd      *DVDPlayer
	projector *Projector
	screen   *Screen
	popper   *PopcornPopper
}

func NewHomeTheaterFacade() *HomeTheaterFacade {
	return &HomeTheaterFacade{
		amp:       &Amplifier{},
		dvd:       &DVDPlayer{},
		projector: &Projector{},
		screen:    &Screen{},
		popper:    &PopcornPopper{},
	}
}

// WatchMovie 简化的观影接口
func (h *HomeTheaterFacade) WatchMovie(movie string) {
	fmt.Println("\n🎬 Get ready to watch a movie...")
	h.popper.On()
	h.popper.Pop()
	h.screen.Down()
	h.projector.On()
	h.projector.SetInput("DVD")
	h.amp.On()
	h.amp.SetVolume(30)
	h.dvd.On()
	h.dvd.Play(movie)
	fmt.Println("🎬 Enjoy the movie!")
}

// EndMovie 结束观影
func (h *HomeTheaterFacade) EndMovie() {
	fmt.Println("\n🎬 Shutting down theater...")
	h.popper.Off()
	h.screen.Up()
	h.projector.Off()
	h.amp.Off()
	h.dvd.Off()
	fmt.Println("🎬 Goodbye!")
}

func main() {
	theater := NewHomeTheaterFacade()
	theater.WatchMovie("Inception")
	theater.EndMovie()
}
```

> **要点总结：**
> - 外观模式为复杂子系统提供简单入口，降低使用成本
> - 外观不限制客户端直接使用子系统，提供可选简化
> - 适合作为库的公共 API，隐藏内部实现细节

---

### 12.11 享元（Flyweight）

通过共享已有对象来支持大量细粒度对象的复用，减少内存占用。

```go
package main

import (
	"fmt"
	"sync"
)

// ---------- 享元对象 ----------

// Character 字符样式（享元：内部状态不变）
type Character struct {
	char    rune
	font    string
	size    int
	color   string
}

// CharFactory 字符工厂（享元池）
type CharFactory struct {
	mu     sync.Mutex
	pool   map[string]*Character
}

func NewCharFactory() *CharFactory {
	return &CharFactory{
		pool: make(map[string]*Character),
	}
}

// GetCharacter 获取或创建字符享元
func (f *CharFactory) GetCharacter(char rune, font string, size int, color string) *Character {
	key := fmt.Sprintf("%c-%s-%d-%s", char, font, size, color)
	f.mu.Lock()
	defer f.mu.Unlock()

	if c, ok := f.pool[key]; ok {
		return c
	}

	c := &Character{
		char:  char,
		font:  font,
		size:  size,
		color: color,
	}
	f.pool[key] = c
	return c
}

func (f *CharFactory) PoolSize() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.pool)
}

// ---------- 外部状态 ----------

// Position 位置（外部状态，不共享）
type Position struct {
	X, Y int
}

// TextEditor 文本编辑器
type TextEditor struct {
	factory *CharFactory
	chars   []struct {
		*Character
		Position
	}
}

func NewTextEditor(factory *CharFactory) *TextEditor {
	return &TextEditor{factory: factory}
}

func (e *TextEditor) Insert(char rune, font string, size int, color string, x, y int) {
	charObj := e.factory.GetCharacter(char, font, size, color)
	e.chars = append(e.chars, struct {
		*Character
		Position
	}{charObj, Position{x, y}})
}

func (e *TextEditor) Render() {
	for _, c := range e.chars {
		fmt.Printf("'%c' at (%d,%d) [font=%s, size=%d, color=%s]\n",
			c.char, c.X, c.Y, c.font, c.size, c.color)
	}
}

func main() {
	factory := NewCharFactory()
	editor := NewTextEditor(factory)

	// 插入大量字符，相同样式共享同一个对象
	editor.Insert('H', "Arial", 12, "black", 0, 0)
	editor.Insert('e', "Arial", 12, "black", 10, 0)
	editor.Insert('l', "Arial", 12, "black", 20, 0)
	editor.Insert('l', "Arial", 12, "black", 30, 0)
	editor.Insert('o', "Arial", 12, "black", 40, 0)

	editor.Insert('W', "Arial", 14, "red", 0, 20)
	editor.Insert('o', "Arial", 14, "red", 10, 20)
	editor.Insert('r', "Arial", 14, "red", 20, 20)

	editor.Render()
	fmt.Printf("\nTotal characters: %d, Shared objects: %d\n",
		len(editor.chars), factory.PoolSize())
}
```

> **要点总结：**
> - 享元模式区分内部状态（共享）和外部状态（不共享）
> - 适合大量相似对象场景，如文本编辑器、粒子系统、游戏地图
> - Go 中通常使用 sync.Map 或 sync.Mutex 保护享元池的并发安全

---

### 12.12 代理（Proxy）

为另一个对象提供一个替身或占位符以控制对这个对象的访问。

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// Image 图片接口
type Image interface {
	Display()
}

// ---------- 真实主题 ----------

// RealImage 真实图片（加载成本高）
type RealImage struct {
	filename string
}

func NewRealImage(filename string) *RealImage {
	fmt.Printf("Loading image from disk: %s\n", filename)
	time.Sleep(100 * time.Millisecond) // 模拟加载延迟
	return &RealImage{filename: filename}
}

func (r *RealImage) Display() {
	fmt.Printf("Displaying image: %s\n", r.filename)
}

// ---------- 代理 ----------

// ProxyImage 图片代理（延迟加载 + 访问控制）
type ProxyImage struct {
	filename    string
	realImage   *RealImage
	accessLevel string
	mu          sync.Mutex
}

func NewProxyImage(filename, accessLevel string) *ProxyImage {
	return &ProxyImage{
		filename:    filename,
		accessLevel: accessLevel,
	}
}

// Display 延迟加载：图片只在首次显示时加载
func (p *ProxyImage) Display() {
	if !p.hasAccess() {
		fmt.Printf("Access denied: %s\n", p.filename)
		return
	}

	p.mu.Lock()
	if p.realImage == nil {
		p.realImage = NewRealImage(p.filename)
	}
	p.mu.Unlock()

	p.realImage.Display()
}

func (p *ProxyImage) hasAccess() bool {
	return p.accessLevel == "admin" || p.accessLevel == "user"
}

// ---------- 客户端 ----------

func main() {
	images := []Image{
		NewProxyImage("photo1.jpg", "guest"), // 无权限
		NewProxyImage("photo2.jpg", "user"),
		NewProxyImage("photo3.jpg", "admin"),
	}

	for _, img := range images {
		img.Display()
	}
	// 再次显示，不再从磁盘加载
	fmt.Println("\n--- Second display (cached) ---")
	images[1].Display()
	images[2].Display()
}
```

> **要点总结：**
> - 代理模式常见用途：延迟加载（虚拟代理）、访问控制（保护代理）、日志（日志代理）
> - Go 中代理实现与装饰器类似，但目的不同：代理控制访问，装饰器添加行为
> - 注意并发安全，尤其是懒加载场景

---

## 行为型模式

行为型模式关注对象之间的通信和职责分配。

---

### 12.13 责任链（Chain of Responsibility）

使多个对象都有机会处理请求，从而避免请求的发送者和接收者之间的耦合关系。将这些对象连成一条链，并沿着链传递请求。

```go
package main

import "fmt"

// ---------- 请求 ----------

type Request struct {
	Path    string
	Method  string
	UserID  int64
	Role    string
	Body    string
}

// ---------- 处理器接口 ----------

type Handler interface {
	SetNext(Handler) Handler
	Handle(*Request) bool
}

// BaseHandler 基础处理器（嵌入实现链式调用）
type BaseHandler struct {
	next Handler
}

func (b *BaseHandler) SetNext(next Handler) Handler {
	b.next = next
	return next
}

func (b *BaseHandler) HandleNext(req *Request) bool {
	if b.next != nil {
		return b.next.Handle(req)
	}
	return true
}

// ---------- 具体处理器 ----------

// RateLimitHandler 限流
type RateLimitHandler struct {
	BaseHandler
	limit int
	count int
}

func NewRateLimitHandler(limit int) *RateLimitHandler {
	return &RateLimitHandler{limit: limit}
}

func (h *RateLimitHandler) Handle(req *Request) bool {
	h.count++
	if h.count > h.limit {
		fmt.Printf("[RateLimit] Request %s %s blocked (limit=%d)\n", req.Method, req.Path, h.limit)
		return false
	}
	fmt.Printf("[RateLimit] Request %s %s allowed\n", req.Method, req.Path)
	return h.HandleNext(req)
}

// AuthHandler 认证
type AuthHandler struct {
	BaseHandler
}

func NewAuthHandler() *AuthHandler {
	return &AuthHandler{}
}

func (h *AuthHandler) Handle(req *Request) bool {
	if req.UserID == 0 {
		fmt.Println("[Auth] Unauthorized: missing user")
		return false
	}
	fmt.Printf("[Auth] User %d authenticated\n", req.UserID)
	return h.HandleNext(req)
}

// RoleHandler 角色鉴权
type RoleHandler struct {
	BaseHandler
	allowedRoles []string
}

func NewRoleHandler(roles ...string) *RoleHandler {
	return &RoleHandler{allowedRoles: roles}
}

func (h *RoleHandler) Handle(req *Request) bool {
	for _, role := range h.allowedRoles {
		if req.Role == role {
			fmt.Printf("[Role] User %d has required role: %s\n", req.UserID, role)
			return h.HandleNext(req)
		}
	}
	fmt.Printf("[Role] User %d role '%s' not allowed\n", req.UserID, req.Role)
	return false
}

// LoggingHandler 日志
type LoggingHandler struct {
	BaseHandler
}

func NewLoggingHandler() *LoggingHandler {
	return &LoggingHandler{}
}

func (h *LoggingHandler) Handle(req *Request) bool {
	fmt.Printf("[Log] %s %s by user %d\n", req.Method, req.Path, req.UserID)
	return h.HandleNext(req)
}

func main() {
	// 构建处理链: Logging → RateLimit(5) → Auth → Role(admin)
	handler := NewLoggingHandler()
	handler.SetNext(NewRateLimitHandler(5)).
		SetNext(NewAuthHandler()).
		SetNext(NewRoleHandler("admin"))

	// 测试请求
	requests := []*Request{
		{Path: "/api/users", Method: "GET", UserID: 1001, Role: "admin"},
		{Path: "/api/orders", Method: "POST", UserID: 1002, Role: "user"},
		{Path: "/api/users", Method: "GET", UserID: 0, Role: "guest"},
	}

	for _, req := range requests {
		fmt.Printf("\n--- Processing %s %s ---\n", req.Method, req.Path)
		if handler.Handle(req) {
			fmt.Println("✅ Request processed successfully")
		} else {
			fmt.Println("❌ Request rejected by chain")
		}
	}
}
```

> **要点总结：**
> - 责任链模式将请求发送者和接收者解耦，每个处理器只关注自己的职责
> - 链可以动态组合，新增处理器不影响现有代码
> - 典型的应用场景：HTTP 中间件、审批流、日志过滤

---

### 12.14 命令（Command）

将请求封装为对象，从而支持参数化、队列化、日志化以及可撤销的操作。

```go
package main

import "fmt"

// ---------- 命令接口 ----------

type Command interface {
	Execute() error
	Undo() error
}

// ---------- 具体命令 ----------

// TV 接收者
type TV struct {
	isOn bool
}

func (t *TV) On()  { t.isOn = true; fmt.Println("TV is ON") }
func (t *TV) Off() { t.isOn = false; fmt.Println("TV is OFF") }

type TVOnCommand struct {
	tv *TV
}

func NewTVOnCommand(tv *TV) *TVOnCommand {
	return &TVOnCommand{tv: tv}
}
func (c *TVOnCommand) Execute() error { c.tv.On(); return nil }
func (c *TVOnCommand) Undo() error    { c.tv.Off(); return nil }

type TVOffCommand struct {
	tv *TV
}

func NewTVOffCommand(tv *TV) *TVOffCommand {
	return &TVOffCommand{tv: tv}
}
func (c *TVOffCommand) Execute() error { c.tv.Off(); return nil }
func (c *TVOffCommand) Undo() error    { c.tv.On(); return nil }

// ---------- 宏命令 ----------

type MacroCommand struct {
	commands []Command
}

func (m *MacroCommand) Add(cmd Command) {
	m.commands = append(m.commands, cmd)
}

func (m *MacroCommand) Execute() error {
	for _, cmd := range m.commands {
		if err := cmd.Execute(); err != nil {
			return err
		}
	}
	return nil
}

func (m *MacroCommand) Undo() error {
	// 逆序撤销
	for i := len(m.commands) - 1; i >= 0; i-- {
		if err := m.commands[i].Undo(); err != nil {
			return err
		}
	}
	return nil
}

// ---------- 调用者 ----------

type RemoteControl struct {
	history []Command
}

func (r *RemoteControl) Execute(cmd Command) {
	if err := cmd.Execute(); err != nil {
		fmt.Println("Execute error:", err)
		return
	}
	r.history = append(r.history, cmd)
}

func (r *RemoteControl) UndoLast() {
	if len(r.history) == 0 {
		fmt.Println("No commands to undo")
		return
	}
	cmd := r.history[len(r.history)-1]
	r.history = r.history[:len(r.history)-1]
	if err := cmd.Undo(); err != nil {
		fmt.Println("Undo error:", err)
	}
}

func main() {
	tv := &TV{}
	remote := &RemoteControl{}

	// 单个命令
	remote.Execute(NewTVOnCommand(tv))
	remote.Execute(NewTVOffCommand(tv))

	fmt.Println("\n--- Undo ---")
	remote.UndoLast() // TV ON
	remote.UndoLast() // TV OFF

	fmt.Println("\n--- Macro ---")
	macro := &MacroCommand{}
	macro.Add(NewTVOnCommand(tv))
	macro.Add(NewTVOffCommand(tv))
	macro.Execute()
	macro.Undo()
}
```

> **要点总结：**
> - 命令模式将操作参数化和延迟执行，支持撤销/重做
> - Go 中命令通常定义为接口，每个命令实现 Execute/Undo
> - 适用于任务队列、操作日志、事务回滚、GUI 按钮操作

---

### 12.15 迭代器（Iterator）

提供一种方法顺序访问聚合对象中的元素，而不暴露其内部表示。Go 中利用 channel 可优雅实现迭代器。

```go
package main

import "fmt"

// ---------- 集合 ----------

// TreeNode 二叉树节点
type TreeNode struct {
	Value int
	Left  *TreeNode
	Right *TreeNode
}

// InOrder 中序遍历迭代器（通过 channel 实现）
func (n *TreeNode) InOrder() <-chan int {
	ch := make(chan int)
	go func() {
		n.inOrderRecursive(ch)
		close(ch)
	}()
	return ch
}

func (n *TreeNode) inOrderRecursive(ch chan<- int) {
	if n == nil {
		return
	}
	n.Left.inOrderRecursive(ch)
	ch <- n.Value
	n.Right.inOrderRecursive(ch)
}

// PreOrder 前序遍历
func (n *TreeNode) PreOrder() <-chan int {
	ch := make(chan int)
	go func() {
		n.preOrderRecursive(ch)
		close(ch)
	}()
	return ch
}

func (n *TreeNode) preOrderRecursive(ch chan<- int) {
	if n == nil {
		return
	}
	ch <- n.Value
	n.Left.preOrderRecursive(ch)
	n.Right.preOrderRecursive(ch)
}

// PostOrder 后序遍历
func (n *TreeNode) PostOrder() <-chan int {
	ch := make(chan int)
	go func() {
		n.postOrderRecursive(ch)
		close(ch)
	}()
	return ch
}

func (n *TreeNode) postOrderRecursive(ch chan<- int) {
	if n == nil {
		return
	}
	n.Left.postOrderRecursive(ch)
	n.Right.postOrderRecursive(ch)
	ch <- n.Value
}

// ---------- 可迭代集合 ----------

// Collection 可迭代集合
type Collection struct {
	items []interface{}
}

func NewCollection(items ...interface{}) *Collection {
	return &Collection{items: items}
}

// Iterate 返回 channel 迭代器
func (c *Collection) Iterate() <-chan interface{} {
	ch := make(chan interface{})
	go func() {
		for _, item := range c.items {
			ch <- item
		}
		close(ch)
	}()
	return ch
}

func main() {
	// 二叉树迭代
	root := &TreeNode{Value: 1,
		Left: &TreeNode{Value: 2,
			Left:  &TreeNode{Value: 4},
			Right: &TreeNode{Value: 5},
		},
		Right: &TreeNode{Value: 3},
	}

	fmt.Println("InOrder:")
	for v := range root.InOrder() {
		fmt.Printf("%d ", v)
	}
	fmt.Println()

	fmt.Println("PreOrder:")
	for v := range root.PreOrder() {
		fmt.Printf("%d ", v)
	}
	fmt.Println()

	// Collection 迭代
	col := NewCollection("a", "b", "c", 42, true)
	fmt.Println("\nCollection:")
	for item := range col.Iterate() {
		fmt.Printf("%v ", item)
	}
	fmt.Println()
}
```

> **要点总结：**
> - Go 中 channel 是实现迭代器最自然的工具，配合 `range` 使用体验极佳
> - 迭代器 goroutine 需确保 channel 正确关闭，防止死锁
> - 对于可中断的迭代，可使用 select + done channel 模式

---

### 12.16 中介者（Mediator）

用一个中介对象来封装一系列对象的交互，使各对象不需要显式地相互引用，从而使其松散耦合。

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

// ---------- 事件 ----------

type Event struct {
	Type string
	Data interface{}
}

// ---------- 中介者（事件总线） ----------

type EventBus struct {
	mu         sync.RWMutex
	subscribers map[string][]chan Event
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string][]chan Event),
	}
}

// Subscribe 订阅事件
func (eb *EventBus) Subscribe(eventType string, buffer int) <-chan Event {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	ch := make(chan Event, buffer)
	eb.subscribers[eventType] = append(eb.subscribers[eventType], ch)
	return ch
}

// Publish 发布事件
func (eb *EventBus) Publish(event Event) {
	eb.mu.RLock()
	subs := make([]chan Event, len(eb.subscribers[event.Type]))
	copy(subs, eb.subscribers[event.Type])
	eb.mu.RUnlock()

	for _, ch := range subs {
		select {
		case ch <- event:
		default:
			// 队列满则丢弃，防止阻塞
			fmt.Printf("Dropping event: %s (subscriber slow)\n", event.Type)
		}
	}
}

// Close 关闭总线
func (eb *EventBus) Close() {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	for _, subs := range eb.subscribers {
		for _, ch := range subs {
			close(ch)
		}
	}
	eb.subscribers = nil
}

// ---------- 组件 ----------

type UserService struct {
	bus *EventBus
}

func (u *UserService) Register(username string) {
	fmt.Printf("[UserService] User registered: %s\n", username)
	u.bus.Publish(Event{Type: "user.created", Data: username})
}

type EmailService struct {
	bus *EventBus
}

func (e *EmailService) Start() {
	ch := e.bus.Subscribe("user.created", 10)
	go func() {
		for evt := range ch {
			username := evt.Data.(string)
			fmt.Printf("[EmailService] Sending welcome email to %s\n", username)
		}
	}()
}

type NotificationService struct {
	bus *EventBus
}

func (n *NotificationService) Start() {
	ch := n.bus.Subscribe("user.created", 10)
	go func() {
		for evt := range ch {
			username := evt.Data.(string)
			fmt.Printf("[NotificationService] Sending push notification to %s\n", username)
		}
	}()
}

func main() {
	bus := NewEventBus()
	defer bus.Close()

	// 启动服务
	emailSvc := &EmailService{bus: bus}
	emailSvc.Start()

	notifSvc := &NotificationService{bus: bus}
	notifSvc.Start()

	// 触发事件
	userSvc := &UserService{bus: bus}
	userSvc.Register("alice")
	userSvc.Register("bob")

	time.Sleep(100 * time.Millisecond) // 等待异步处理
}
```

> **要点总结：**
> - 中介者模式降低多对象间的耦合度，将网状通信转为星型通信
> - Go 中通过 channel 实现事件总线，天然支持异步和解耦
> - 适用于 UI 组件协调、聊天室、事件驱动架构

---

### 12.17 备忘录（Memento）

在不破坏封装的前提下捕获并外部化对象的内部状态，以便之后恢复。

```go
package main

import "fmt"

// ---------- 备忘录 ----------

// Memento 不透明备忘录（对外只暴露元数据）
type Memento struct {
	state     []byte   // 序列化后的状态（对外不可见）
	timestamp int64    // 快照时间
	label     string   // 快照标签
}

// ---------- 发起人 ----------

// TextEditor 文本编辑器（发起人）
type TextEditor struct {
	content  string
	cursorX  int
	cursorY  int
}

func NewTextEditor() *TextEditor {
	return &TextEditor{}
}

func (e *TextEditor) Write(text string) {
	e.content += text
}

func (e *TextEditor) Delete(n int) {
	if n > len(e.content) {
		e.content = ""
	} else {
		e.content = e.content[:len(e.content)-n]
	}
}

func (e *TextEditor) SetCursor(x, y int) {
	e.cursorX = x
	e.cursorY = y
}

// Save 创建快照
func (e *TextEditor) Save(label string) *Memento {
	return &Memento{
		state:     []byte(fmt.Sprintf("%s|%d|%d", e.content, e.cursorX, e.cursorY)),
		timestamp: 1234567890, // 实际应为 time.Now().Unix()
		label:     label,
	}
}

// Restore 从快照恢复
func (e *TextEditor) Restore(m *Memento) {
	var content string
	var x, y int
	fmt.Sscanf(string(m.state), "%s|%d|%d", &content, &x, &y)
	e.content = content
	e.cursorX = x
	e.cursorY = y
}

func (e *TextEditor) String() string {
	return fmt.Sprintf("Content: '%s', Cursor: (%d,%d)", e.content, e.cursorX, e.cursorY)
}

// ---------- 看护人 ----------

type History struct {
	mementos []*Memento
}

func NewHistory() *History {
	return &History{}
}

func (h *History) Push(m *Memento) {
	h.mementos = append(h.mementos, m)
}

func (h *History) Pop() *Memento {
	if len(h.mementos) == 0 {
		return nil
	}
	m := h.mementos[len(h.mementos)-1]
	h.mementos = h.mementos[:len(h.mementos)-1]
	return m
}

func (h *History) List() []string {
	var labels []string
	for _, m := range h.mementos {
		labels = append(labels, m.label)
	}
	return labels
}

func main() {
	editor := NewTextEditor()
	history := NewHistory()

	editor.Write("Hello")
	history.Push(editor.Save("step 1"))

	editor.Write(", World!")
	history.Push(editor.Save("step 2"))

	editor.Delete(6)
	editor.SetCursor(0, 0)
	fmt.Println("Current:", editor)

	// 撤销到 step 2
	editor.Restore(history.Pop())
	fmt.Println("After undo:", editor)

	// 撤销到 step 1
	editor.Restore(history.Pop())
	fmt.Println("After undo:", editor)
}
```

> **要点总结：**
> - 备忘录模式提供对象状态的"快照"与"恢复"能力，不破坏封装性
> - Go 中通过小写字段或编码方式保护备忘录的内部状态不被外部篡改
> - 适用于文本编辑器撤销、事务回滚、游戏存档

---

### 12.18 观察者（Observer）

定义对象间一对多的依赖关系，当一个对象的状态发生变化时，所有依赖它的对象都得到通知。

```go
package main

import (
	"fmt"
	"sync"
)

// ---------- 事件类型 ----------

type EventType int

const (
	EventOrderCreated EventType = iota
	EventOrderPaid
	EventOrderShipped
	EventOrderCancelled
)

// OrderEvent 订单事件
type OrderEvent struct {
	Type  EventType
	OrderID string
	Data  interface{}
}

// ---------- 观察者 ----------

type Observer interface {
	Update(event OrderEvent)
}

// ---------- 可观察对象 ----------

type Observable interface {
	Register(observer Observer)
	Deregister(observer Observer)
	Notify(event OrderEvent)
}

// ---------- 具体可观察对象：订单服务 ----------

type OrderService struct {
	mu        sync.RWMutex
	observers []Observer
}

func NewOrderService() *OrderService {
	return &OrderService{}
}

func (s *OrderService) Register(o Observer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.observers = append(s.observers, o)
}

func (s *OrderService) Deregister(o Observer) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, obs := range s.observers {
		if obs == o {
			s.observers = append(s.observers[:i], s.observers[i+1:]...)
			return
		}
	}
}

func (s *OrderService) Notify(event OrderEvent) {
	s.mu.RLock()
	observers := make([]Observer, len(s.observers))
	copy(observers, s.observers)
	s.mu.RUnlock()

	for _, o := range observers {
		o.Update(event)
	}
}

// CreateOrder 创建订单（触发通知）
func (s *OrderService) CreateOrder(orderID string) {
	fmt.Printf("[OrderService] Order created: %s\n", orderID)
	s.Notify(OrderEvent{Type: EventOrderCreated, OrderID: orderID, Data: "new order"})
}

// ---------- 具体观察者 ----------

type EmailNotifier struct {
	name string
}

func (e *EmailNotifier) Update(event OrderEvent) {
	switch event.Type {
	case EventOrderCreated:
		fmt.Printf("[%s] Sending order confirmation email for %s\n", e.name, event.OrderID)
	case EventOrderShipped:
		fmt.Printf("[%s] Sending shipping notification for %s\n", e.name, event.OrderID)
	}
}

type InventoryService struct{}

func (i *InventoryService) Update(event OrderEvent) {
	if event.Type == EventOrderCreated {
		fmt.Printf("[Inventory] Reserving stock for order %s\n", event.OrderID)
	}
}

type AnalyticsService struct{}

func (a *AnalyticsService) Update(event OrderEvent) {
	fmt.Printf("[Analytics] Recording order event: %d for %s\n", event.Type, event.OrderID)
}

func main() {
	orderSvc := NewOrderService()

	// 注册观察者
	email := &EmailNotifier{name: "Email"}
	orderSvc.Register(email)
	orderSvc.Register(&InventoryService{})
	orderSvc.Register(&AnalyticsService{})

	// 触发事件
	orderSvc.CreateOrder("ORD-001")

	fmt.Println("\n--- Removing email notifier ---")
	orderSvc.Deregister(email)
	orderSvc.CreateOrder("ORD-002")
}
```

> **要点总结：**
> - 观察者模式解耦了主题和观察者，主题不关心观察者的具体实现
> - Go 中观察者可以实现接口，也可以通过 channel 广播事件
> - 注意观察者的执行顺序和错误隔离（一个观察者 panic 不应影响其他观察者）

---

### 12.19 状态（State）

允许一个对象在其内部状态改变时改变它的行为，对象看起来似乎修改了它的类。

```go
package main

import (
	"fmt"
)

// ---------- 状态接口 ----------

type VendingMachineState interface {
	InsertCoin(machine *VendingMachine)
	SelectProduct(machine *VendingMachine, product string)
	Dispense(machine *VendingMachine)
}

// ---------- 上下文 ----------

type VendingMachine struct {
	state       VendingMachineState
	inventory   map[string]int
	balance     int
}

func NewVendingMachine() *VendingMachine {
	vm := &VendingMachine{
		inventory: map[string]int{
			"A1": 5,
			"A2": 3,
			"B1": 0, // 售罄
		},
	}
	vm.state = &IdleState{}
	return vm
}

func (vm *VendingMachine) SetState(state VendingMachineState) {
	vm.state = state
	fmt.Printf("State changed to: %T\n", state)
}

func (vm *VendingMachine) InsertCoin()        { vm.state.InsertCoin(vm) }
func (vm *VendingMachine) SelectProduct(p string) { vm.state.SelectProduct(vm, p) }
func (vm *VendingMachine) Dispense()           { vm.state.Dispense(vm) }

func (vm *VendingMachine) AddBalance(amount int) { vm.balance += amount }
func (vm *VendingMachine) GetBalance() int        { return vm.balance }
func (vm *VendingMachine) DeductBalance(amount int) { vm.balance -= amount }
func (vm *VendingMachine) HasStock(product string) bool {
	return vm.inventory[product] > 0
}
func (vm *VendingMachine) DispenseProduct(product string) {
	vm.inventory[product]--
	fmt.Printf("Dispensed %s. Remaining: %d\n", product, vm.inventory[product])
}

// ---------- 具体状态 ----------

// IdleState 待机状态
type IdleState struct{}

func (s *IdleState) InsertCoin(machine *VendingMachine) {
	machine.AddBalance(10)
	fmt.Printf("Inserted coin. Balance: %d\n", machine.GetBalance())
	machine.SetState(&HasCoinState{})
}

func (s *IdleState) SelectProduct(machine *VendingMachine, product string) {
	fmt.Println("Insert coin first")
}

func (s *IdleState) Dispense(machine *VendingMachine) {
	fmt.Println("Insert coin first")
}

// HasCoinState 已投币状态
type HasCoinState struct{}

func (s *HasCoinState) InsertCoin(machine *VendingMachine) {
	machine.AddBalance(10)
	fmt.Printf("Added coin. Balance: %d\n", machine.GetBalance())
}

func (s *HasCoinState) SelectProduct(machine *VendingMachine, product string) {
	if !machine.HasStock(product) {
		fmt.Printf("Product %s out of stock\n", product)
		machine.SetState(&IdleState{})
		return
	}
	if machine.GetBalance() < 10 {
		fmt.Println("Insufficient balance")
		return
	}
	fmt.Printf("Selected product: %s\n", product)
	machine.DeductBalance(10)
	machine.DispenseProduct(product)
	machine.SetState(&DispensingState{})
}

func (s *HasCoinState) Dispense(machine *VendingMachine) {
	fmt.Println("Select product first")
}

// DispensingState 出货状态
type DispensingState struct{}

func (s *DispensingState) InsertCoin(machine *VendingMachine) {
	fmt.Println("Please wait, dispensing...")
}

func (s *DispensingState) SelectProduct(machine *VendingMachine, product string) {
	fmt.Println("Please wait, dispensing...")
}

func (s *DispensingState) Dispense(machine *VendingMachine) {
	if machine.GetBalance() > 0 {
		fmt.Printf("Returning change: %d\n", machine.GetBalance())
		machine.DeductBalance(machine.GetBalance())
	}
	machine.SetState(&IdleState{})
}

func main() {
	vm := NewVendingMachine()

	vm.InsertCoin()                     // Idle → HasCoin
	vm.SelectProduct("A1")              // HasCoin → Dispensing
	vm.Dispense()                       // Dispensing → Idle

	fmt.Println("\n--- Try out of stock ---")
	vm.SelectProduct("B1")              // Idle → 会提示插入硬币

	fmt.Println("\n--- Full flow again ---")
	vm.InsertCoin()
	vm.SelectProduct("A2")
	vm.Dispense()
}
```

> **要点总结：**
> - 状态模式将状态相关的行为提取到独立的状态类中，避免大型的条件分支
> - 每个状态只关心自己的行为，状态转换逻辑清晰
> - Go 中状态通过接口实现，上下文持有当前状态引用
> - 适用于订单状态机、工作流引擎、游戏角色状态

---

### 12.20 策略（Strategy）

定义一族算法，把它们封装起来，使它们可以互相替换，算法的变化不会影响使用算法的客户端。

```go
package main

import (
	"fmt"
	"math"
)

// ---------- 策略接口 ----------

type PricingStrategy interface {
	Calculate(basePrice float64) float64
	Name() string
}

// ---------- 具体策略 ----------

type RegularPricing struct{}

func (r *RegularPricing) Calculate(basePrice float64) float64 {
	return basePrice
}
func (r *RegularPricing) Name() string { return "Regular" }

type DiscountPricing struct {
	discountPercent float64
	minAmount       float64
}

func NewDiscountPricing(percent, min float64) *DiscountPricing {
	return &DiscountPricing{discountPercent: percent, minAmount: min}
}

func (d *DiscountPricing) Calculate(basePrice float64) float64 {
	if basePrice >= d.minAmount {
		return basePrice * (1 - d.discountPercent/100)
	}
	return basePrice
}
func (d *DiscountPricing) Name() string { return fmt.Sprintf("Discount %.0f%%", d.discountPercent) }

type PremiumPricing struct {
	discountLevels []struct {
		threshold float64
		discount  float64
	}
}

func NewPremiumPricing() *PremiumPricing {
	return &PremiumPricing{
		discountLevels: []struct {
			threshold float64
			discount  float64
		}{
			{100, 5},   // 超过 100 减 5%
			{500, 10},  // 超过 500 减 10%
			{1000, 15}, // 超过 1000 减 15%
		},
	}
}

func (p *PremiumPricing) Calculate(basePrice float64) float64 {
	discount := 0.0
	for _, level := range p.discountLevels {
		if basePrice >= level.threshold {
			discount = level.discount
		}
	}
	return basePrice * (1 - discount/100)
}
func (p *PremiumPricing) Name() string { return "Premium" }

// FreeShippingPricing 免运费包装
type FreeShippingPricing struct {
	strategy PricingStrategy
}

func NewFreeShippingPricing(strategy PricingStrategy) *FreeShippingPricing {
	return &FreeShippingPricing{strategy: strategy}
}

func (f *FreeShippingPricing) Calculate(basePrice float64) float64 {
	price := f.strategy.Calculate(basePrice)
	// 超过 50 免运费
	if price >= 50 {
		return price
	}
	return price + 9.99 // 运费
}
func (f *FreeShippingPricing) Name() string {
	return f.strategy.Name() + " + FreeShipping"
}

// ---------- 上下文 ----------

type Order struct {
	items    []OrderItem
	strategy PricingStrategy
}

type OrderItem struct {
	Name     string
	Price    float64
	Quantity int
}

func NewOrder(strategy PricingStrategy) *Order {
	return &Order{strategy: strategy}
}

func (o *Order) AddItem(name string, price float64, qty int) {
	o.items = append(o.items, OrderItem{Name: name, Price: price, Quantity: qty})
}

func (o *Order) SetStrategy(strategy PricingStrategy) {
	o.strategy = strategy
}

func (o *Order) CalculateTotal() float64 {
	var base float64
	for _, item := range o.items {
		base += item.Price * float64(item.Quantity)
	}
	base = math.Round(base*100) / 100

	total := o.strategy.Calculate(base)
	total = math.Round(total*100) / 100

	fmt.Printf("Strategy: %s, Base: $%.2f, Total: $%.2f\n", o.strategy.Name(), base, total)
	return total
}

func main() {
	order := NewOrder(&RegularPricing{})
	order.AddItem("Laptop", 999.99, 1)
	order.AddItem("Mouse", 29.99, 2)

	order.CalculateTotal()

	// 切换策略
	order.SetStrategy(NewDiscountPricing(10, 200))
	order.CalculateTotal()

	order.SetStrategy(NewPremiumPricing())
	order.CalculateTotal()

	order.SetStrategy(NewFreeShippingPricing(NewPremiumPricing()))
	order.CalculateTotal()
}
```

> **要点总结：**
> - 策略模式将算法封装为独立对象，客户端可以在运行时切换策略
> - Go 中策略通常是接口，策略实现作为参数注入上下文
> - 适用于价格策略、排序算法、压缩方式、认证方式等

---

### 12.21 模板方法（Template Method）

在一个方法中定义算法的骨架，将一些步骤延迟到子类中实现。

```go
package main

import "fmt"

// ---------- 模板接口 ----------

// DataProcessor 数据处理模板
type DataProcessor interface {
	Read() string
	Process(data string) string
	Write(result string)
}

// Template 执行模板方法
func ExecuteTemplate(p DataProcessor) {
	// 1. 读取
	data := p.Read()
	fmt.Printf("Read: %s\n", data)
	// 2. 处理
	result := p.Process(data)
	fmt.Printf("Processed: %s\n", result)
	// 3. 写入
	p.Write(result)
}

// ---------- 具体实现 ----------

// CSVProcessor CSV 处理器
type CSVProcessor struct{}

func (c *CSVProcessor) Read() string {
	return "name,age,city"
}

func (c *CSVProcessor) Process(data string) string {
	return fmt.Sprintf("Processed CSV: %s", data)
}

func (c *CSVProcessor) Write(result string) {
	fmt.Println("Writing CSV result to file...")
}

// JSONProcessor JSON 处理器
type JSONProcessor struct{}

func (j *JSONProcessor) Read() string {
	return `{"users":[{"name":"Alice","age":30}]}`
}

func (j *JSONProcessor) Process(data string) string {
	return fmt.Sprintf("Validated JSON: %s", data)
}

func (j *JSONProcessor) Write(result string) {
	fmt.Println("Writing JSON result to database...")
}

// ---------- 带钩子的模板 ----------

// ReportGenerator 报表生成器（使用嵌入提供默认行为）
type ReportGenerator struct {
	Header    string
	Footer    string
}

func (r *ReportGenerator) Generate() {
	r.printHeader()
	r.printContent()
	r.printFooter()
}

func (r *ReportGenerator) printHeader() {
	fmt.Println("=== ", r.Header, " ===")
}

func (r *ReportGenerator) printFooter() {
	fmt.Println("=== ", r.Footer, " ===")
}

// printContent 钩子方法（默认空实现，子类覆盖）
func (r *ReportGenerator) printContent() {}

// SalesReport 销售报表（覆盖钩子）
type SalesReport struct {
	ReportGenerator
	Sales []int
}

func NewSalesReport() *SalesReport {
	return &SalesReport{
		ReportGenerator: ReportGenerator{
			Header: "Monthly Sales Report",
			Footer: "Generated on 2026-06-15",
		},
		Sales: []int{120, 85, 200, 150, 90},
	}
}

func (s *SalesReport) printContent() {
	total := 0
	for i, sale := range s.Sales {
		fmt.Printf("  Day %d: $%d\n", i+1, sale)
		total += sale
	}
	fmt.Printf("  Total: $%d\n", total)
}

func main() {
	fmt.Println("=== CSV Processor ===")
	ExecuteTemplate(&CSVProcessor{})

	fmt.Println("\n=== JSON Processor ===")
	ExecuteTemplate(&JSONProcessor{})

	fmt.Println("\n=== Sales Report ===")
	report := NewSalesReport()
	report.Generate()
}
```

> **要点总结：**
> - 模板方法模式定义算法骨架，子类或接口实现填充可变部分
> - Go 中可以通过接口或结构体嵌入 + 钩子方法实现
> - 钩子方法提供默认实现，允许子类选择性覆盖

---

### 12.22 访问者（Visitor）

表示一个作用于某对象结构中的各元素的操作，你可以在不改变各元素类的前提下定义作用于这些元素的新操作。

```go
package main

import (
	"fmt"
	"math"
)

// ---------- 访问者接口 ----------

type Visitor interface {
	VisitCircle(*Circle)
	VisitRectangle(*Rectangle)
	VisitTriangle(*Triangle)
}

// ---------- 元素接口 ----------

type Shape interface {
	Accept(Visitor)
}

// ---------- 具体元素 ----------

type Circle struct {
	Radius float64
}

func (c *Circle) Accept(v Visitor) { v.VisitCircle(c) }

type Rectangle struct {
	Width  float64
	Height float64
}

func (r *Rectangle) Accept(v Visitor) { v.VisitRectangle(r) }

type Triangle struct {
	A, B, C float64 // 三边长度
}

func (t *Triangle) Accept(v Visitor) { v.VisitTriangle(t) }

// ---------- 具体访问者 1：面积计算 ----------

type AreaCalculator struct {
	TotalArea float64
}

func (a *AreaCalculator) VisitCircle(c *Circle) {
	area := math.Pi * c.Radius * c.Radius
	a.TotalArea += area
	fmt.Printf("Circle area: %.2f\n", area)
}

func (a *AreaCalculator) VisitRectangle(r *Rectangle) {
	area := r.Width * r.Height
	a.TotalArea += area
	fmt.Printf("Rectangle area: %.2f\n", area)
}

func (a *AreaCalculator) VisitTriangle(t *Triangle) {
	// 海伦公式
	s := (t.A + t.B + t.C) / 2
	area := math.Sqrt(s * (s - t.A) * (s - t.B) * (s - t.C))
	if math.IsNaN(area) {
		area = 0
	}
	a.TotalArea += area
	fmt.Printf("Triangle area: %.2f\n", area)
}

// ---------- 具体访问者 2：JSON 序列化 ----------

type JSONSerializer struct {
	Output string
}

func (j *JSONSerializer) VisitCircle(c *Circle) {
	j.Output = fmt.Sprintf(`{"type":"circle","radius":%.2f}`, c.Radius)
}

func (j *JSONSerializer) VisitRectangle(r *Rectangle) {
	j.Output = fmt.Sprintf(`{"type":"rectangle","width":%.2f,"height":%.2f}`, r.Width, r.Height)
}

func (j *JSONSerializer) VisitTriangle(t *Triangle) {
	j.Output = fmt.Sprintf(`{"type":"triangle","sides":[%.2f,%.2f,%.2f]}`, t.A, t.B, t.C)
}

// ---------- 具体访问者 3：边界检查 ----------

type BoundsChecker struct {
	X, Y float64
}

func (b *BoundsChecker) VisitCircle(c *Circle) {
	if math.Abs(b.X) <= c.Radius && math.Abs(b.Y) <= c.Radius {
		fmt.Printf("Point (%.1f, %.1f) is inside circle\n", b.X, b.Y)
	} else {
		fmt.Printf("Point (%.1f, %.1f) is outside circle\n", b.X, b.Y)
	}
}

func (b *BoundsChecker) VisitRectangle(r *Rectangle) {
	if b.X >= 0 && b.X <= r.Width && b.Y >= 0 && b.Y <= r.Height {
		fmt.Printf("Point (%.1f, %.1f) is inside rectangle\n", b.X, b.Y)
	} else {
		fmt.Printf("Point (%.1f, %.1f) is outside rectangle\n", b.X, b.Y)
	}
}

func (b *BoundsChecker) VisitTriangle(t *Triangle) {
	fmt.Printf("Bounds check for triangle at (%.1f, %.1f)\n", b.X, b.Y)
}

func main() {
	shapes := []Shape{
		&Circle{Radius: 5},
		&Rectangle{Width: 10, Height: 4},
		&Triangle{A: 3, B: 4, C: 5},
	}

	fmt.Println("=== Area Calculation ===")
	areaCalc := &AreaCalculator{}
	for _, shape := range shapes {
		shape.Accept(areaCalc)
	}
	fmt.Printf("Total area: %.2f\n", areaCalc.TotalArea)

	fmt.Println("\n=== JSON Serialization ===")
	serializer := &JSONSerializer{}
	for _, shape := range shapes {
		shape.Accept(serializer)
		fmt.Println(serializer.Output)
	}

	fmt.Println("\n=== Bounds Check ===")
	checker := &BoundsChecker{X: 3, Y: 2}
	for _, shape := range shapes {
		shape.Accept(checker)
	}
}
```

> **要点总结：**
> - 访问者模式让你在不修改元素类的情况下增加新操作（双分派）
> - 新增访问者无需修改元素类，新增元素需要修改所有访问者
> - Go 中通过 `Accept(v Visitor)` 实现双分派
> - 适用于语法树 AST、文件系统操作、类型检查器等

---

### 12.23 函数选项模式（Functional Options）

Go 中独有的一种设计模式，用于灵活地配置结构体构造函数，替代传统建造者或重载构造函数。

```go
package main

import (
	"fmt"
	"time"
)

// ---------- 服务器配置 ----------

type Server struct {
	addr     string
	port     int
	timeout  time.Duration
	maxConns int
	tls      bool
	logger   func(string)
}

// ServerOption 函数选项类型
type ServerOption func(*Server)

// WithPort 设置端口
func WithPort(port int) ServerOption {
	return func(s *Server) {
		s.port = port
	}
}

// WithTimeout 设置超时
func WithTimeout(timeout time.Duration) ServerOption {
	return func(s *Server) {
		s.timeout = timeout
	}
}

// WithMaxConns 设置最大连接数
func WithMaxConns(maxConns int) ServerOption {
	return func(s *Server) {
		s.maxConns = maxConns
	}
}

// WithTLS 启用 TLS
func WithTLS(enabled bool) ServerOption {
	return func(s *Server) {
		s.tls = enabled
	}
}

// WithLogger 设置日志函数
func WithLogger(logger func(string)) ServerOption {
	return func(s *Server) {
		s.logger = logger
	}
}

// NewServer 创建服务器（默认值 + 选项覆盖）
func NewServer(addr string, opts ...ServerOption) *Server {
	s := &Server{
		addr:     addr,
		port:     8080,         // 默认端口
		timeout:  30 * time.Second, // 默认超时
		maxConns: 100,          // 默认最大连接数
		tls:      false,
		logger:   func(msg string) { fmt.Println(msg) },
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// ---------- 带预检查的选项模式 ----------

// Option 通用选项接口（可返回错误）
type Option[T any] interface {
	Apply(*T) error
}

// optionFunc 实现 Option 接口的函数适配器
type optionFunc[T any] func(*T) error

func (f optionFunc[T]) Apply(t *T) error {
	return f(t)
}

// DBConfig 数据库配置
type DBConfig struct {
	DSN          string
	MaxOpenConns int
	MaxIdleConns int
}

// WithMaxOpenConns 带验证的选项
func WithMaxOpenConns(n int) Option[DBConfig] {
	return optionFunc[DBConfig](func(c *DBConfig) error {
		if n <= 0 {
			return fmt.Errorf("MaxOpenConns must be positive, got %d", n)
		}
		c.MaxOpenConns = n
		return nil
	})
}

// NewDB 创建数据库连接（带选项验证）
func NewDB(dsn string, opts ...Option[DBConfig]) (*DBConfig, error) {
	cfg := &DBConfig{
		DSN:          dsn,
		MaxOpenConns: 10,
		MaxIdleConns: 5,
	}
	for _, opt := range opts {
		if err := opt.Apply(cfg); err != nil {
			return nil, fmt.Errorf("apply option: %w", err)
		}
	}
	return cfg, nil
}

func main() {
	// 使用函数选项
	srv := NewServer("0.0.0.0",
		WithPort(9090),
		WithTimeout(60*time.Second),
		WithTLS(true),
		WithMaxConns(500),
		WithLogger(func(msg string) {
			fmt.Printf("[Server] %s\n", msg)
		}),
	)
	fmt.Printf("Server: %+v\n", srv)

	// 带验证的选项
	db, err := NewDB("user:pass@tcp(localhost:3306)/db",
		WithMaxOpenConns(25),
	)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Printf("DB: %+v\n", db)
}
```

> **要点总结：**
> - 函数选项模式是 Go 特有的惯用模式，优雅解决可选配置问题
> - 选项是闭包，捕获配置参数并修改目标结构体
> - 结合泛型（Go 1.18+）可实现类型安全的通用选项接口
> - 默认值 + 零值安全，新增选项不影响已有代码

---

### 12.24 错误包装与检查模式

Go 1.13+ 引入的错误链机制，结合 `errors.Is` 和 `errors.As` 构建可检查的错误体系。

```go
package main

import (
	"errors"
	"fmt"
	"os"
)

// ---------- 哨兵错误 ----------

var (
	ErrNotFound    = errors.New("resource not found")
	ErrForbidden   = errors.New("forbidden")
	ErrTimeout     = errors.New("request timeout")
	ErrInvalidInput = errors.New("invalid input")
)

// ---------- 自定义错误类型 ----------

type ValidationError struct {
	Field   string
	Message string
	Err     error
}

func (v *ValidationError) Error() string {
	return fmt.Sprintf("validation error on %s: %s", v.Field, v.Message)
}

func (v *ValidationError) Unwrap() error {
	return v.Err
}

// ---------- 多层错误包装 ----------

// Repository 数据访问层
type Repository struct{}

func (r *Repository) GetUser(id int) error {
	// 模拟数据库错误
	return fmt.Errorf("get user %d: %w", id, ErrNotFound)
}

// Service 业务层
type Service struct {
	repo *Repository
}

func (s *Service) GetUserProfile(id int) error {
	if id <= 0 {
		return &ValidationError{
			Field:   "id",
			Message: "must be positive",
			Err:     ErrInvalidInput,
		}
	}
	if err := s.repo.GetUser(id); err != nil {
		// 包装错误上下文
		return fmt.Errorf("service get profile for user %d: %w", id, err)
	}
	return nil
}

// ---------- 错误检查工具 ----------

// IsNotFound 判断是否为"未找到"错误
func IsNotFound(err error) bool {
	return errors.Is(err, ErrNotFound)
}

// IsInvalidInput 判断是否为"无效输入"错误
func IsInvalidInput(err error) bool {
	return errors.Is(err, ErrInvalidInput)
}

// GetValidationError 提取 ValidationError
func GetValidationError(err error) *ValidationError {
	var ve *ValidationError
	if errors.As(err, &ve) {
		return ve
	}
	return nil
}

// ---------- 错误处理中间件风格 ----------

type AppError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Err     error  `json:"-"`
}

func (e *AppError) Error() string {
	return fmt.Sprintf("app error %d: %s", e.Code, e.Message)
}

func (e *AppError) Unwrap() error {
	return e.Err
}

// WrapAppError 包装为应用错误
func WrapAppError(code int, msg string, err error) *AppError {
	return &AppError{Code: code, Message: msg, Err: err}
}

// ErrorHandler HTTP 错误处理
type ErrorHandler func(wrapper func(err error) *AppError)

func main() {
	svc := &Service{repo: &Repository{}}

	// 测试 1：无效输入
	err := svc.GetUserProfile(0)
	fmt.Printf("Error: %v\n", err)
	fmt.Printf("IsInvalidInput: %v\n", IsInvalidInput(err))
	if ve := GetValidationError(err); ve != nil {
		fmt.Printf("Validation field: %s\n", ve.Field)
	}

	fmt.Println()

	// 测试 2：资源未找到
	err = svc.GetUserProfile(42)
	fmt.Printf("Error: %v\n", err)
	fmt.Printf("IsNotFound: %v\n", IsNotFound(err))

	fmt.Println()

	// 测试 3：包装为 HTTP 错误
	if err != nil {
		appErr := WrapAppError(404, "User not found", err)
		fmt.Printf("HTTP Response: %d %s\n", appErr.Code, appErr.Message)
	}

	// 测试 4：标准库错误检查
	_, openErr := os.Open("nonexistent.txt")
	if errors.Is(openErr, os.ErrNotExist) {
		fmt.Println("\nFile not found (using errors.Is)")
	}
}
```

> **要点总结：**
> - 使用 `%w` 包装错误，使用 `errors.Is`/`errors.As` 解包检查
> - 哨兵错误（`var ErrXxx = errors.New(...)`）满足常见比较需求
> - 自定义错误类型实现 `Unwrap()` 方法加入错误链
> - 每层包装时添加上下文信息，形成完整的错误调用链

---

### 12.25 中间件模式

HTTP 中间件是 Go Web 开发中最常用的模式之一。它包装 `http.Handler` 以在请求处理前后执行额外逻辑。

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"
)

// ---------- 基础中间件类型 ----------

// Middleware 中间件类型
type Middleware func(http.Handler) http.Handler

// Chain 构建中间件链
func Chain(handler http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler
}

// ---------- 具体中间件 ----------

// LoggingMiddleware 请求日志
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("[%s] %s %s %v", r.Method, r.URL.Path, r.RemoteAddr, time.Since(start))
	})
}

// RecoverMiddleware panic 恢复
func RecoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("Panic recovered: %v", rec)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware 跨域
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequestIDMiddleware 注入 request ID
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-ID")
		if reqID == "" {
			reqID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		ctx := context.WithValue(r.Context(), "request_id", reqID)
		w.Header().Set("X-Request-ID", reqID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RateLimitMiddleware 简易限流
func RateLimitMiddleware(limit int) Middleware {
	tokens := make(chan struct{}, limit)
	// 初始填充
	for i := 0; i < limit; i++ {
		tokens <- struct{}{}
	}
	// 定期补充
	go func() {
		ticker := time.NewTicker(time.Second)
		for range ticker.C {
			select {
			case tokens <- struct{}{}:
			default:
			}
		}
	}()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-tokens:
				next.ServeHTTP(w, r)
			default:
				http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
			}
		})
	}
}

// ---------- 带参数的中间件工厂 ----------

// TimeoutMiddleware 请求超时
func TimeoutMiddleware(timeout time.Duration) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ---------- Negroni 风格中间件（中间件可写响应） ----------

type MiddlewareHandler interface {
	ServeHTTP(w http.ResponseWriter, r *http.Request, next http.HandlerFunc)
}

type MiddlewareFunc func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc)

func (f MiddlewareFunc) ServeHTTP(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	f(w, r, next)
}

func Adapt(m MiddlewareHandler) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			m.ServeHTTP(w, r, next.ServeHTTP)
		})
	}
}

// ---------- 最终处理器 ----------

func helloHandler(w http.ResponseWriter, r *http.Request) {
	reqID, _ := r.Context().Value("request_id").(string)
	fmt.Fprintf(w, "Hello! Request ID: %s\n", reqID)
}

func main() {
	finalHandler := http.HandlerFunc(helloHandler)

	// 构建中间件链
	handler := Chain(
		finalHandler,
		RecoverMiddleware,
		RequestIDMiddleware,
		LoggingMiddleware,
		CORSMiddleware,
		TimeoutMiddleware(10*time.Second),
		RateLimitMiddleware(100),
	)

	// 或者用 Negroni 风格
	negroniHandler := Chain(
		finalHandler,
		Adapt(MiddlewareFunc(func(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
			log.Println("[Negroni] Before")
			next(w, r)
			log.Println("[Negroni] After")
		})),
	)

	mux := http.NewServeMux()
	mux.Handle("/", handler)
	mux.Handle("/negroni", negroniHandler)

	log.Println("Server starting on :8080")
	http.ListenAndServe(":8080", mux)
}
```

> **要点总结：**
> - 中间件模式是装饰器模式在 HTTP 领域的特定应用
> - Go 标准中间件签名为 `func(http.Handler) http.Handler`
> - 中间件链通过"洋葱模型"执行：外层 → 内层 → 处理器 → 内层 → 外层
> - 注意中间件顺序：Recover 应在最外层，日志在中间，具体功能在最内层

---

## 章节总结

本章系统覆盖了 GoF 23 种经典设计模式以及 3 种 Go 特有的惯用模式：

| 类别 | 模式 | Go 实现要点 |
|------|------|-----------|
| 创建型 | 单例 | `sync.Once` 延迟加载 |
| 创建型 | 工厂方法 | 接口 + 工厂函数 |
| 创建型 | 抽象工厂 | 接口组合 |
| 创建型 | 建造者 | 链式调用 |
| 创建型 | 原型 | `gob` 编码 / 手动深拷贝 |
| 结构型 | 适配器 | 实现目标接口，包装不兼容对象 |
| 结构型 | 桥接 | 接口引用分离抽象与实现 |
| 结构型 | 组合 | 统一叶子与容器的接口 |
| 结构型 | 装饰器 | 嵌入接口，动态包装 |
| 结构型 | 外观 | 简化复杂子系统 |
| 结构型 | 享元 | sync.Map 对象池 |
| 结构型 | 代理 | 延迟加载 + 访问控制 |
| 行为型 | 责任链 | 处理器链，可组合 |
| 行为型 | 命令 | 封装操作为对象 |
| 行为型 | 迭代器 | channel + goroutine |
| 行为型 | 中介者 | 事件总线 + channel |
| 行为型 | 备忘录 | 序列化状态快照 |
| 行为型 | 观察者 | 接口订阅 + 广播 |
| 行为型 | 状态 | 状态接口 + 状态转换 |
| 行为型 | 策略 | 策略接口 + 运行时切换 |
| 行为型 | 模板方法 | 骨架接口 + 钩子方法 |
| 行为型 | 访问者 | Accept 双分派 |
| Go 惯用 | 函数选项 | 闭包 + 可选参数 |
| Go 惯用 | 错误包装 | `errors.Is`/`As` + `%w` |
| Go 惯用 | 中间件 | `func(http.Handler) http.Handler` |

**设计原则总结：**
- **组合优于继承**：Go 没有继承，接口嵌入和组合是核心手段
- **面向接口编程**：依赖接口而非具体实现
- **开闭原则**：对扩展开放，对修改封闭
- **单一职责**：每个模式类/接口只关注一个职责
- **依赖倒置**：高层模块不依赖低层模块，二者都依赖抽象
