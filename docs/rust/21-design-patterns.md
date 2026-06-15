# 第 21 章：设计模式

> 目标读者：掌握 Rust 基础与进阶特性，希望系统学习设计模式在 Rust 中的实现方式的开发者。本章覆盖 23 种 GoF 设计模式及 Rust 特有惯用模式，重点关注所有权系统对模式实现的影响。

---

## 21.1 创建型模式

### 21.1.1 单例（Singleton）

Rust 中单例的实现需要考虑线程安全和所有权。推荐使用 `std::sync::LazyLock`（Rust 1.80+）或 `once_cell::sync::Lazy`。

```rust
use std::sync::LazyLock;
use std::sync::Mutex;

/// 全局配置单例
static CONFIG: LazyLock<Mutex<Config>> = LazyLock::new(|| {
    Mutex::new(Config {
        app_name: "MyApp".into(),
        version: "1.0.0".into(),
        max_connections: 100,
    })
});

#[derive(Debug, Clone)]
struct Config {
    app_name: String,
    version: String,
    max_connections: u32,
}

impl Config {
    /// 获取全局配置的只读引用
    fn get() -> std::sync::MutexGuard<'static, Self> {
        CONFIG.lock().unwrap()
    }

    /// 更新配置
    fn update<F>(f: F)
    where
        F: FnOnce(&mut Config),
    {
        let mut config = CONFIG.lock().unwrap();
        f(&mut config);
    }
}

fn main() {
    // 读取配置
    let app_name = Config::get().app_name.clone();
    println!("应用名称: {}", app_name);

    // 更新配置
    Config::update(|c| c.max_connections = 200);

    // 验证更新
    println!("最大连接数: {}", Config::get().max_connections);
}
```

**要点总结**：

| 方案 | 特点 | 适用场景 |
|------|------|---------|
| `LazyLock<Mutex<T>>` | 标准库，线程安全，可变 | 需要可变的全局状态 |
| `LazyLock<T>` | 标准库，线程安全，不可变 | 只读全局配置 |
| `once_cell::sync::Lazy` | 第三方，1.80 之前可用 | 兼容旧版本 |

---

### 21.1.2 工厂方法（Factory Method）

```rust
use std::fmt;

/// 产品 trait
trait Vehicle: fmt::Debug {
    fn drive(&self) -> String;
}

#[derive(Debug)]
struct Car { model: String }
impl Vehicle for Car {
    fn drive(&self) -> String { format!("驾驶汽车: {}", self.model) }
}

#[derive(Debug)]
struct Bike { brand: String }
impl Vehicle for Bike {
    fn drive(&self) -> String { format!("骑行自行车: {}", self.brand) }
}

/// 工厂 trait
trait VehicleFactory {
    fn create(&self, name: &str) -> Box<dyn Vehicle>;
}

/// 汽车工厂
struct CarFactory;
impl VehicleFactory for CarFactory {
    fn create(&self, name: &str) -> Box<dyn Vehicle> {
        Box::new(Car { model: name.into() })
    }
}

/// 自行车工厂
struct BikeFactory;
impl VehicleFactory for BikeFactory {
    fn create(&self, name: &str) -> Box<dyn Vehicle> {
        Box::new(Bike { brand: name.into() })
    }
}

/// 泛型工厂函数
fn create_vehicle<F: VehicleFactory>(factory: &F, name: &str) -> Box<dyn Vehicle> {
    factory.create(name)
}

fn main() {
    let car_factory = CarFactory;
    let bike_factory = BikeFactory;

    let car = create_vehicle(&car_factory, "Model S");
    let bike = create_vehicle(&bike_factory, "Giant");

    println!("{}", car.drive());  // 驾驶汽车: Model S
    println!("{}", bike.drive()); // 骑行自行车: Giant
}
```

---

### 21.1.3 抽象工厂（Abstract Factory）

```rust
/// 按钮 trait
trait Button {
    fn render(&self) -> String;
}

/// 文本框 trait
trait TextBox {
    fn render(&self) -> String;
}

// --- Windows 风格 ---
struct WindowsButton;
impl Button for WindowsButton {
    fn render(&self) -> String { "Windows 按钮".into() }
}

struct WindowsTextBox;
impl TextBox for WindowsTextBox {
    fn render(&self) -> String { "Windows 文本框".into() }
}

// --- macOS 风格 ---
struct MacOSButton;
impl Button for MacOSButton {
    fn render(&self) -> String { "macOS 按钮".into() }
}

struct MacOSTextBox;
impl TextBox for MacOSTextBox {
    fn render(&self) -> String { "macOS 文本框".into() }
}

/// 抽象工厂 trait
trait UIFactory {
    type Button: Button;
    type TextBox: TextBox;

    fn create_button(&self) -> Self::Button;
    fn create_textbox(&self) -> Self::TextBox;
}

/// Windows 工厂
struct WindowsFactory;
impl UIFactory for WindowsFactory {
    type Button = WindowsButton;
    type TextBox = WindowsTextBox;

    fn create_button(&self) -> Self::Button { WindowsButton }
    fn create_textbox(&self) -> Self::TextBox { WindowsTextBox }
}

/// macOS 工厂
struct MacOSFactory;
impl UIFactory for MacOSFactory {
    type Button = MacOSButton;
    type TextBox = MacOSTextBox;

    fn create_button(&self) -> Self::Button { MacOSButton }
    fn create_textbox(&self) -> Self::TextBox { MacOSTextBox }
}

/// 使用抽象工厂渲染 UI
fn render_ui<F: UIFactory>(factory: &F) {
    let button = factory.create_button();
    let textbox = factory.create_textbox();
    println!("{}", button.render());
    println!("{}", textbox.render());
}

fn main() {
    let os = "macos"; // 运行时决定
    match os {
        "windows" => render_ui(&WindowsFactory),
        "macos" => render_ui(&MacOSFactory),
        _ => panic!("不支持的操作系统"),
    }
}
```

---

### 21.1.4 建造者（Builder）

Rust 中 Builder 模式非常常见，有两种风格：**消费型 Builder** 和 **类型状态 Builder**。

```rust
/// 消费型 Builder——最常用的 Rust Builder 模式
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub max_connections: u32,
    pub timeout_secs: u64,
    pub tls_enabled: bool,
}

pub struct ServerConfigBuilder {
    host: Option<String>,
    port: Option<u16>,
    max_connections: Option<u32>,
    timeout_secs: Option<u64>,
    tls_enabled: Option<bool>,
}

impl ServerConfigBuilder {
    pub fn new() -> Self {
        Self {
            host: None,
            port: None,
            max_connections: None,
            timeout_secs: None,
            tls_enabled: None,
        }
    }

    pub fn host(mut self, host: impl Into<String>) -> Self {
        self.host = Some(host.into());
        self
    }

    pub fn port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }

    pub fn max_connections(mut self, max: u32) -> Self {
        self.max_connections = Some(max);
        self
    }

    pub fn timeout(mut self, secs: u64) -> Self {
        self.timeout_secs = Some(secs);
        self
    }

    pub fn tls(mut self, enabled: bool) -> Self {
        self.tls_enabled = Some(enabled);
        self
    }

    /// 构建配置，缺失字段使用默认值
    pub fn build(self) -> ServerConfig {
        ServerConfig {
            host: self.host.unwrap_or_else(|| "127.0.0.1".into()),
            port: self.port.unwrap_or(8080),
            max_connections: self.max_connections.unwrap_or(100),
            timeout_secs: self.timeout_secs.unwrap_or(30),
            tls_enabled: self.tls_enabled.unwrap_or(false),
        }
    }
}

fn main() {
    let config = ServerConfigBuilder::new()
        .host("0.0.0.0")
        .port(3000)
        .max_connections(500)
        .timeout(60)
        .tls(true)
        .build();

    println!("{:#?}", config);
}
```

**类型状态 Builder**——编译期保证必填字段：

```rust
/// 类型状态标记
pub struct NoHost;
pub struct HasHost(String);

/// 泛型 Builder，通过类型参数追踪状态
pub struct TypedServerBuilder<HostState> {
    host: HostState,
    port: u16,
}

impl TypedServerBuilder<NoHost> {
    pub fn new() -> Self {
        Self { host: NoHost, port: 8080 }
    }

    /// 设置 host 后，Builder 类型变为 HasHost
    pub fn host(self, host: impl Into<String>) -> TypedServerBuilder<HasHost> {
        TypedServerBuilder {
            host: HasHost(host.into()),
            port: self.port,
        }
    }
}

impl TypedServerBuilder<HasHost> {
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// 只有 HasHost 状态才能调用 build
    pub fn build(self) -> ServerConfig {
        let HasHost(host) = self.host else { unreachable!() };
        ServerConfig {
            host,
            port: self.port,
            max_connections: 100,
            timeout_secs: 30,
            tls_enabled: false,
        }
    }
}

fn main() {
    // 编译通过：设置了 host
    let config = TypedServerBuilder::new()
        .host("0.0.0.0")
        .port(3000)
        .build();

    // 编译失败：未设置 host 就调用 build
    // TypedServerBuilder::new().build(); // ❌ 没有 host 方法
}
```

---

### 21.1.5 原型（Prototype）

Rust 通过 `Clone` trait 实现原型模式：

```rust
use std::collections::HashMap;

/// 原型注册表
#[derive(Clone, Debug)]
struct Shape {
    name: String,
    x: i32,
    y: i32,
    color: String,
}

impl Shape {
    fn new(name: &str) -> Self {
        Self {
            name: name.into(),
            x: 0,
            y: 0,
            color: "black".into(),
        }
    }

    fn with_position(mut self, x: i32, y: i32) -> Self {
        self.x = x;
        self.y = y;
        self
    }

    fn with_color(mut self, color: &str) -> Self {
        self.color = color.into();
        self
    }
}

/// 原型管理器
struct PrototypeManager {
    prototypes: HashMap<String, Shape>,
}

impl PrototypeManager {
    fn new() -> Self {
        let mut prototypes = HashMap::new();
        prototypes.insert("circle".into(), Shape::new("圆形").with_color("红色"));
        prototypes.insert("rectangle".into(), Shape::new("矩形").with_color("蓝色"));
        Self { prototypes }
    }

    /// 通过克隆原型创建新实例
    fn create(&self, key: &str) -> Option<Shape> {
        self.prototypes.get(key).cloned()
    }

    fn register(&mut self, key: &str, prototype: Shape) {
        self.prototypes.insert(key.into(), prototype);
    }
}

fn main() {
    let manager = PrototypeManager::new();

    // 克隆原型并修改
    let mut circle = manager.create("circle").unwrap();
    circle.x = 10;
    circle.y = 20;
    println!("{:?}", circle);

    let rect = manager.create("rectangle").unwrap();
    println!("{:?}", rect);
}
```

---

## 21.2 结构型模式

### 21.2.1 适配器（Adapter）

```rust
/// 目标接口——我们期望的日志接口
trait Logger {
    fn log_info(&self, message: &str);
    fn log_error(&self, message: &str);
}

/// 被适配者——第三方日志库的接口
struct ThirdPartyLogger;

impl ThirdPartyLogger {
    fn write_message(&self, level: &str, msg: &str) {
        println!("[{}] {}", level.to_uppercase(), msg);
    }
}

/// 适配器——将 ThirdPartyLogger 适配到 Logger 接口
struct LoggerAdapter {
    inner: ThirdPartyLogger,
}

impl LoggerAdapter {
    fn new() -> Self {
        Self { inner: ThirdPartyLogger }
    }
}

impl Logger for LoggerAdapter {
    fn log_info(&self, message: &str) {
        self.inner.write_message("info", message);
    }

    fn log_error(&self, message: &str) {
        self.inner.write_message("error", message);
    }
}

/// Newtype 适配器——用 newtype 包装外部类型
struct ExternalVec(Vec<i32>);

impl ExternalVec {
    fn new(inner: Vec<i32>) -> Self {
        Self(inner)
    }

    /// 适配为自定义接口
    fn sum(&self) -> i32 {
        self.0.iter().sum()
    }

    fn average(&self) -> Option<f64> {
        if self.0.is_empty() {
            None
        } else {
            Some(self.sum() as f64 / self.0.len() as f64)
        }
    }
}

fn main() {
    // 适配器模式
    let logger = LoggerAdapter::new();
    logger.log_info("系统启动");
    logger.log_error("连接失败");

    // Newtype 适配
    let vec = ExternalVec::new(vec![1, 2, 3, 4, 5]);
    println!("总和: {}", vec.sum());
    println!("平均值: {:?}", vec.average());
}
```

---

### 21.2.2 桥接（Bridge）

```rust
/// 实现层——渲染器
trait Renderer {
    fn render_circle(&self, x: f64, y: f64, radius: f64);
    fn render_rectangle(&self, x: f64, y: f64, w: f64, h: f64);
}

/// 具体实现——矢量渲染
struct VectorRenderer;
impl Renderer for VectorRenderer {
    fn render_circle(&self, x: f64, y: f64, r: f64) {
        println!("矢量绘制圆形: 中心({}, {}), 半径 {}", x, y, r);
    }
    fn render_rectangle(&self, x: f64, y: f64, w: f64, h: f64) {
        println!("矢量绘制矩形: 位置({}, {}), 宽高({}, {})", x, y, w, h);
    }
}

/// 具体实现——光栅渲染
struct RasterRenderer;
impl Renderer for RasterRenderer {
    fn render_circle(&self, x: f64, y: f64, r: f64) {
        println!("像素绘制圆形: 中心({}, {}), 半径 {}", x, y, r);
    }
    fn render_rectangle(&self, x: f64, y: f64, w: f64, h: f64) {
        println!("像素绘制矩形: 位置({}, {}), 宽高({}, {})", x, y, w, h);
    }
}

/// 抽象层——图形（持有渲染器引用）
struct Shape<'a, R: Renderer> {
    renderer: &'a R,
}

impl<'a, R: Renderer> Shape<'a, R> {
    fn new(renderer: &'a R) -> Self {
        Self { renderer }
    }

    fn draw_circle(&self, x: f64, y: f64, r: f64) {
        self.renderer.render_circle(x, y, r);
    }

    fn draw_rectangle(&self, x: f64, y: f64, w: f64, h: f64) {
        self.renderer.render_rectangle(x, y, w, h);
    }
}

fn main() {
    let vector = VectorRenderer;
    let raster = RasterRenderer;

    // 同一图形，不同渲染器
    let vector_shape = Shape::new(&vector);
    vector_shape.draw_circle(10.0, 20.0, 5.0);

    let raster_shape = Shape::new(&raster);
    raster_shape.draw_circle(10.0, 20.0, 5.0);
}
```

---

### 21.2.3 组合（Composite）

```rust
use std::fmt;

/// 组件 trait
trait Graphic: fmt::Debug {
    fn draw(&self);
}

/// 叶子节点——圆形
#[derive(Debug)]
struct Circle {
    x: i32,
    y: i32,
    radius: i32,
}

impl Graphic for Circle {
    fn draw(&self) {
        println!("  绘制圆形: 位置({}, {}), 半径 {}", self.x, self.y, self.radius);
    }
}

/// 叶子节点——矩形
#[derive(Debug)]
struct Rectangle {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl Graphic for Rectangle {
    fn draw(&self) {
        println!("  绘制矩形: 位置({}, {}), 宽高({}, {})", self.x, self.y, self.width, self.height);
    }
}

/// 组合节点——图形组
struct GraphicGroup {
    name: String,
    children: Vec<Box<dyn Graphic>>,
}

impl fmt::Debug for GraphicGroup {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "GraphicGroup({})", self.name)
    }
}

impl Graphic for GraphicGroup {
    fn draw(&self) {
        println!("绘制组 [{}]:", self.name);
        for child in &self.children {
            child.draw();
        }
    }
}

impl GraphicGroup {
    fn new(name: &str) -> Self {
        Self { name: name.into(), children: Vec::new() }
    }

    fn add(mut self, child: Box<dyn Graphic>) -> Self {
        self.children.push(child);
        self
    }
}

fn main() {
    let circle = Circle { x: 10, y: 20, radius: 5 };
    let rect = Rectangle { x: 30, y: 40, width: 100, height: 50 };

    // 组合：组中包含叶子和其他组
    let inner_group = GraphicGroup::new("内层组")
        .add(Box::new(circle));

    let outer_group = GraphicGroup::new("外层组")
        .add(Box::new(rect))
        .add(Box::new(inner_group));

    outer_group.draw();
}
```

---

### 21.2.4 装饰器（Decorator）

```rust
/// 被装饰的组件 trait
trait DataSource {
    fn read_data(&self) -> String;
    fn write_data(&mut self, data: &str);
}

/// 基础数据源——文件
struct FileDataSource {
    filename: String,
    data: String,
}

impl FileDataSource {
    fn new(filename: &str) -> Self {
        Self { filename: filename.into(), data: String::new() }
    }
}

impl DataSource for FileDataSource {
    fn read_data(&self) -> String {
        format!("[从 {} 读取]: {}", self.filename, self.data)
    }

    fn write_data(&mut self, data: &str) {
        self.data = data.into();
    }
}

/// 装饰器——加密
struct EncryptionDecorator<T: DataSource> {
    inner: T,
    key: u8,
}

impl<T: DataSource> EncryptionDecorator<T> {
    fn new(inner: T, key: u8) -> Self {
        Self { inner, key }
    }
}

impl<T: DataSource> DataSource for EncryptionDecorator<T> {
    fn read_data(&self) -> String {
        let data = self.inner.read_data();
        // 简单异或解密
        let decrypted: String = data.chars()
            .map(|c| (c as u8 ^ self.key) as char)
            .collect();
        format!("[解密后] {}", decrypted)
    }

    fn write_data(&mut self, data: &str) {
        // 简单异或加密
        let encrypted: String = data.chars()
            .map(|c| (c as u8 ^ self.key) as char)
            .collect();
        self.inner.write_data(&encrypted);
    }
}

/// 装饰器——压缩
struct CompressionDecorator<T: DataSource> {
    inner: T,
}

impl<T: DataSource> CompressionDecorator<T> {
    fn new(inner: T) -> Self {
        Self { inner }
    }
}

impl<T: DataSource> DataSource for CompressionDecorator<T> {
    fn read_data(&self) -> String {
        let data = self.inner.read_data();
        format!("[解压后] {}", data)
    }

    fn write_data(&mut self, data: &str) {
        let compressed = format!("[压缩]{}", data);
        self.inner.write_data(&compressed);
    }
}

fn main() {
    // 基础数据源
    let file = FileDataSource::new("data.txt");

    // 加密装饰
    let encrypted = EncryptionDecorator::new(file, 0x42);

    // 加密 + 压缩装饰（装饰器链）
    let mut compressed_encrypted = CompressionDecorator::new(encrypted);

    compressed_encrypted.write_data("Hello, Rust!");
    println!("{}", compressed_encrypted.read_data());
}
```

---

### 21.2.5 外观（Facade）

```rust
/// 子系统——CPU
struct Cpu;
impl Cpu {
    fn freeze(&self) { println!("CPU: 冻结处理器"); }
    fn jump(&self, position: u32) { println!("CPU: 跳转到地址 {}", position); }
    fn execute(&self) { println!("CPU: 执行指令"); }
}

/// 子系统——内存
struct Memory;
impl Memory {
    fn load(&self, position: u32, data: &str) {
        println!("内存: 加载数据 '{}' 到地址 {}", data, position);
    }
}

/// 子系统——硬盘
struct HardDrive;
impl HardDrive {
    fn read(&self, lba: u32, size: u32) -> String {
        println!("硬盘: 从扇区 {} 读取 {} 字节", lba, size);
        "boot_data".into()
    }
}

/// 外观——简化启动流程
struct ComputerFacade {
    cpu: Cpu,
    memory: Memory,
    hard_drive: HardDrive,
}

impl ComputerFacade {
    fn new() -> Self {
        Self {
            cpu: Cpu,
            memory: Memory,
            hard_drive: HardDrive,
        }
    }

    /// 一键启动——隐藏子系统交互细节
    fn start(&self) {
        println!("=== 计算机启动 ===");
        self.cpu.freeze();
        let boot_data = self.hard_drive.read(0, 1024);
        self.memory.load(0, &boot_data);
        self.cpu.jump(0);
        self.cpu.execute();
        println!("=== 启动完成 ===");
    }
}

fn main() {
    let computer = ComputerFacade::new();
    computer.start();
    // 客户端无需了解 CPU、内存、硬盘的交互细节
}
```

---

### 21.2.6 享元（Flyweight）

```rust
use std::collections::HashMap;
use std::sync::LazyLock;

/// 享元——共享的字体样式
#[derive(Debug, Clone)]
struct FontStyle {
    font_family: String,
    size: u32,
    bold: bool,
    italic: bool,
}

/// 享元工厂——缓存并共享字体样式
static FONT_FACTORY: LazyLock<std::sync::Mutex<FontStyleFactory>> =
    LazyLock::new(|| std::sync::Mutex::new(FontStyleFactory::new()));

struct FontStyleFactory {
    styles: HashMap<String, FontStyle>,
}

impl FontStyleFactory {
    fn new() -> Self {
        Self { styles: HashMap::new() }
    }

    /// 获取或创建共享的字体样式
    fn get_style(&mut self, font_family: &str, size: u32, bold: bool, italic: bool) -> FontStyle {
        let key = format!("{}-{}-{}-{}", font_family, size, bold, italic);
        self.styles
            .entry(key.clone())
            .or_insert_with(|| FontStyle {
                font_family: font_family.into(),
                size,
                bold,
                italic,
            })
            .clone()
    }
}

/// 使用享元的字符
struct Character {
    char: char,
    style: FontStyle, // 共享引用
    x: i32,
    y: i32,
}

fn main() {
    let mut factory = FONT_FACTORY.lock().unwrap();

    // 创建大量字符，但样式是共享的
    let chars: Vec<Character> = "Hello, Rust!"
        .chars()
        .enumerate()
        .map(|(i, c)| {
            let style = factory.get_style("JetBrains Mono", 14, false, false);
            Character { char: c, style, x: i as i32 * 10, y: 0 }
        })
        .collect();

    println!("创建了 {} 个字符", chars.len());
    println!("共享了 {} 种字体样式", factory.styles.len());
}
```

---

### 21.2.7 代理（Proxy）

```rust
use std::collections::HashMap;

/// 目标接口
trait Database {
    fn get_data(&mut self, key: &str) -> Option<String>;
    fn set_data(&mut self, key: &str, value: String);
}

/// 真实数据库（模拟昂贵操作）
struct RealDatabase {
    data: HashMap<String, String>,
    query_count: u32,
}

impl RealDatabase {
    fn new() -> Self {
        println!("真实数据库: 建立连接...");
        Self { data: HashMap::new(), query_count: 0 }
    }
}

impl Database for RealDatabase {
    fn get_data(&mut self, key: &str) -> Option<String> {
        self.query_count += 1;
        println!("真实数据库: 查询 '{}' (第 {} 次查询)", key, self.query_count);
        // 模拟延迟
        std::thread::sleep(std::time::Duration::from_millis(100));
        self.data.get(key).cloned()
    }

    fn set_data(&mut self, key: &str, value: String) {
        self.data.insert(key.into(), value);
    }
}

/// 缓存代理——延迟初始化 + 缓存
struct CachedDatabase {
    real_db: Option<RealDatabase>,
    cache: HashMap<String, String>,
}

impl CachedDatabase {
    fn new() -> Self {
        // 延迟初始化：不立即连接数据库
        Self { real_db: None, cache: HashMap::new() }
    }

    /// 懒加载真实数据库
    fn ensure_db(&mut self) {
        if self.real_db.is_none() {
            self.real_db = Some(RealDatabase::new());
        }
    }
}

impl Database for CachedDatabase {
    fn get_data(&mut self, key: &str) -> Option<String> {
        // 先查缓存
        if let Some(value) = self.cache.get(key) {
            println!("缓存命中: '{}'", key);
            return Some(value.clone());
        }

        // 缓存未命中，查询真实数据库
        self.ensure_db();
        if let Some(db) = &mut self.real_db {
            if let Some(value) = db.get_data(key) {
                self.cache.insert(key.into(), value.clone());
                return Some(value);
            }
        }
        None
    }

    fn set_data(&mut self, key: &str, value: String) {
        self.ensure_db();
        if let Some(db) = &mut self.real_db {
            db.set_data(key, value.clone());
        }
        // 更新缓存
        self.cache.insert(key.into(), value);
    }
}

fn main() {
    let mut db = CachedDatabase::new();

    db.set_data("name", "Rust".into());
    db.set_data("version", "1.75".into());

    // 第一次查询——缓存未命中
    let _ = db.get_data("name");
    // 第二次查询——缓存命中
    let _ = db.get_data("name");
}
```

---

## 21.3 行为型模式

### 21.3.1 责任链（Chain of Responsibility）

```rust
/// 请求类型
struct Request {
    user_id: String,
    action: String,
    data: String,
}

/// 处理结果
enum HandlerResult {
    Continue(Request),
    Respond(String),
}

/// Handler trait
trait Handler: Send + Sync {
    fn handle(&self, request: Request) -> HandlerResult;
}

/// 认证处理器
struct AuthHandler {
    next: Option<Box<dyn Handler>>,
}

impl AuthHandler {
    fn new(next: Option<Box<dyn Handler>>) -> Self {
        Self { next }
    }
}

impl Handler for AuthHandler {
    fn handle(&self, request: Request) -> HandlerResult {
        if request.user_id.is_empty() {
            HandlerResult::Respond("401 未认证".into())
        } else {
            match &self.next {
                Some(next) => next.handle(request),
                None => HandlerResult::Respond("处理完成".into()),
            }
        }
    }
}

/// 日志处理器
struct LogHandler {
    next: Option<Box<dyn Handler>>,
}

impl LogHandler {
    fn new(next: Option<Box<dyn Handler>>) -> Self {
        Self { next }
    }
}

impl Handler for LogHandler {
    fn handle(&self, request: Request) -> HandlerResult {
        println!("[日志] 用户 {} 执行 {}", request.user_id, request.action);
        match &self.next {
            Some(next) => next.handle(request),
            None => HandlerResult::Respond("处理完成".into()),
        }
    }
}

/// 限流处理器
struct RateLimitHandler {
    next: Option<Box<dyn Handler>>,
    limit: u32,
    count: std::sync::Mutex<u32>,
}

impl RateLimitHandler {
    fn new(next: Option<Box<dyn Handler>>, limit: u32) -> Self {
        Self { next, limit, count: std::sync::Mutex::new(0) }
    }
}

impl Handler for RateLimitHandler {
    fn handle(&self, request: Request) -> HandlerResult {
        let mut count = self.count.lock().unwrap();
        *count += 1;
        if *count > self.limit {
            HandlerResult::Respond("429 请求过多".into())
        } else {
            drop(count);
            match &self.next {
                Some(next) => next.handle(request),
                None => HandlerResult::Respond("处理完成".into()),
            }
        }
    }
}

fn main() {
    // 构建责任链：认证 → 日志 → 限流
    let chain = AuthHandler::new(Some(Box::new(
        LogHandler::new(Some(Box::new(
            RateLimitHandler::new(None, 100)
        )))
    )));

    let request = Request {
        user_id: "user_123".into(),
        action: "get_data".into(),
        data: "".into(),
    };

    match chain.handle(request) {
        HandlerResult::Respond(msg) => println!("响应: {}", msg),
        HandlerResult::Continue(_) => println!("继续处理"),
    }
}
```

---

### 21.3.2 命令（Command）

```rust
/// 命令 trait
trait Command {
    fn execute(&self) -> String;
    fn undo(&self) -> String;
}

/// 文本编辑器
struct TextEditor {
    content: String,
    history: Vec<String>,
}

impl TextEditor {
    fn new() -> Self {
        Self { content: String::new(), history: vec![String::new()] }
    }

    fn set_content(&mut self, content: &str) {
        self.content = content.into();
        self.history.push(self.content.clone());
    }

    fn get_content(&self) -> &str {
        &self.content
    }
}

/// 插入文本命令
struct InsertCommand {
    position: usize,
    text: String,
}

impl InsertCommand {
    fn new(position: usize, text: &str) -> Self {
        Self { position, text: text.into() }
    }
}

impl Command for InsertCommand {
    fn execute(&self) -> String {
        format!("在位置 {} 插入 '{}'", self.position, self.text)
    }
    fn undo(&self) -> String {
        format!("撤销在位置 {} 的插入", self.position)
    }
}

/// 删除文本命令
struct DeleteCommand {
    position: usize,
    length: usize,
    deleted_text: String,
}

impl DeleteCommand {
    fn new(position: usize, length: usize, deleted_text: &str) -> Self {
        Self { position, length, deleted_text: deleted_text.into() }
    }
}

impl Command for DeleteCommand {
    fn execute(&self) -> String {
        format!("在位置 {} 删除 {} 个字符", self.position, self.length)
    }
    fn undo(&self) -> String {
        format!("撤销删除，恢复 '{}'", self.deleted_text)
    }
}

/// 命令调用者
struct Invoker {
    commands: Vec<Box<dyn Command>>,
    current: usize,
}

impl Invoker {
    fn new() -> Self {
        Self { commands: Vec::new(), current: 0 }
    }

    fn execute(&mut self, command: Box<dyn Command>) {
        println!("执行: {}", command.execute());
        self.commands.truncate(self.current);
        self.commands.push(command);
        self.current += 1;
    }

    fn undo(&mut self) {
        if self.current > 0 {
            self.current -= 1;
            println!("撤销: {}", self.commands[self.current].undo());
        }
    }
}

fn main() {
    let mut invoker = Invoker::new();

    invoker.execute(Box::new(InsertCommand::new(0, "Hello")));
    invoker.execute(Box::new(InsertCommand::new(5, ", World")));
    invoker.execute(Box::new(DeleteCommand::new(5, 7, ", World")));

    invoker.undo(); // 撤销删除
}
```

---

### 21.3.3 迭代器（Iterator）

```rust
/// 自定义集合——二叉树
#[derive(Debug)]
enum BinaryTree {
    Leaf(i32),
    Node {
        left: Box<BinaryTree>,
        value: i32,
        right: Box<BinaryTree>,
    },
}

impl BinaryTree {
    fn leaf(value: i32) -> Self {
        BinaryTree::Leaf(value)
    }

    fn node(left: Self, value: i32, right: Self) -> Self {
        BinaryTree::Node {
            left: Box::new(left),
            value,
            right: Box::new(right),
        }
    }
}

/// 中序遍历迭代器
struct InOrderIterator<'a> {
    stack: Vec<&'a BinaryTree>,
}

impl<'a> InOrderIterator<'a> {
    fn new(tree: &'a BinaryTree) -> Self {
        let mut iter = Self { stack: Vec::new() };
        iter.push_left(tree);
        iter
    }

    fn push_left(&mut self, mut node: &'a BinaryTree) {
        while let BinaryTree::Node { left, value, right } = node {
            self.stack.push(node);
            node = left;
        }
        if let BinaryTree::Leaf(_) = node {
            self.stack.push(node);
        }
    }
}

impl<'a> Iterator for InOrderIterator<'a> {
    type Item = i32;

    fn next(&mut self) -> Option<Self::Item> {
        let node = self.stack.pop()?;
        match node {
            BinaryTree::Leaf(value) => Some(*value),
            BinaryTree::Node { left: _, value, right } => {
                self.push_left(right);
                Some(*value)
            }
        }
    }
}

/// 实现 IntoIterator
impl<'a> IntoIterator for &'a BinaryTree {
    type Item = i32;
    type IntoIter = InOrderIterator<'a>;

    fn into_iter(self) -> Self::IntoIter {
        InOrderIterator::new(self)
    }
}

fn main() {
    let tree = BinaryTree::node(
        BinaryTree::node(BinaryTree::leaf(1), 3, BinaryTree::leaf(5)),
        10,
        BinaryTree::node(BinaryTree::leaf(15), 20, BinaryTree::leaf(25)),
    );

    println!("中序遍历: ");
    for value in &tree {
        print!("{} ", value);
    }
    println!();

    // 收集为 Vec
    let values: Vec<i32> = (&tree).into_iter().collect();
    println!("收集: {:?}", values);
}
```

---

### 21.3.4 中介者（Mediator）

```rust
use std::sync::{Arc, Mutex};

/// 中介者 trait
trait ChatMediator: Send + Sync {
    fn send_message(&self, from: &str, message: &str);
    fn register(&self, user: Arc<Mutex<ChatUser>>);
}

/// 用户
struct ChatUser {
    name: String,
    mediator: Option<Arc<dyn ChatMediator>>,
}

impl ChatUser {
    fn new(name: &str) -> Self {
        Self { name: name.into(), mediator: None }
    }

    fn send(&self, message: &str) {
        if let Some(mediator) = &self.mediator {
            mediator.send_message(&self.name, message);
        }
    }

    fn receive(&self, from: &str, message: &str) {
        println!("[{}] 收到来自 {} 的消息: {}", self.name, from, message);
    }
}

/// 聊天室中介者
struct ChatRoom {
    users: Mutex<Vec<Arc<Mutex<ChatUser>>>>,
}

impl ChatRoom {
    fn new() -> Self {
        Self { users: Mutex::new(Vec::new()) }
    }
}

impl ChatMediator for ChatRoom {
    fn send_message(&self, from: &str, message: &str) {
        let users = self.users.lock().unwrap();
        for user in users.iter() {
            let u = user.lock().unwrap();
            if u.name != from {
                u.receive(from, message);
            }
        }
    }

    fn register(&self, user: Arc<Mutex<ChatUser>>) {
        // 设置中介者引用
        user.lock().unwrap().mediator = None; // 简化示例
        self.users.lock().unwrap().push(user);
    }
}

fn main() {
    let room = Arc::new(ChatRoom::new());

    let alice = Arc::new(Mutex::new(ChatUser::new("Alice")));
    let bob = Arc::new(Mutex::new(ChatUser::new("Bob")));
    let charlie = Arc::new(Mutex::new(ChatUser::new("Charlie")));

    room.register(alice.clone());
    room.register(bob.clone());
    room.register(charlie.clone());

    // 通过中介者发送消息
    room.send_message("Alice", "大家好！");
    room.send_message("Bob", "你好 Alice！");
}
```

---

### 21.3.5 备忘录（Memento）

```rust
/// 备忘录——保存编辑器状态
#[derive(Debug, Clone)]
struct EditorMemento {
    content: String,
    cursor_position: usize,
}

/// 编辑器——原发器
struct Editor {
    content: String,
    cursor_position: usize,
    history: Vec<EditorMemento>,
    redo_stack: Vec<EditorMemento>,
}

impl Editor {
    fn new() -> Self {
        Self {
            content: String::new(),
            cursor_position: 0,
            history: vec![EditorMemento { content: String::new(), cursor_position: 0 }],
            redo_stack: Vec::new(),
        }
    }

    fn type_text(&mut self, text: &str) {
        self.content.insert_str(self.cursor_position, text);
        self.cursor_position += text.len();
        self.save();
    }

    fn delete(&mut self, length: usize) {
        let start = self.cursor_position.saturating_sub(length);
        self.content.replace_range(start..self.cursor_position, "");
        self.cursor_position = start;
        self.save();
    }

    /// 保存当前状态
    fn save(&mut self) {
        self.history.push(EditorMemento {
            content: self.content.clone(),
            cursor_position: self.cursor_position,
        });
        self.redo_stack.clear();
    }

    /// 撤销
    fn undo(&mut self) {
        if self.history.len() > 1 {
            let memento = self.history.pop().unwrap();
            self.redo_stack.push(memento);
            let previous = self.history.last().unwrap();
            self.content = previous.content.clone();
            self.cursor_position = previous.cursor_position;
        }
    }

    /// 重做
    fn redo(&mut self) {
        if let Some(memento) = self.redo_stack.pop() {
            self.content = memento.content.clone();
            self.cursor_position = memento.cursor_position;
            self.history.push(memento);
        }
    }

    fn show(&self) {
        println!("内容: '{}' | 光标: {}", self.content, self.cursor_position);
    }
}

fn main() {
    let mut editor = Editor::new();

    editor.type_text("Hello");
    editor.type_text(", World");
    editor.show(); // 内容: 'Hello, World' | 光标: 12

    editor.undo();
    editor.show(); // 内容: 'Hello' | 光标: 5

    editor.redo();
    editor.show(); // 内容: 'Hello, World' | 光标: 12
}
```

---

### 21.3.6 观察者（Observer）

```rust
use std::sync::{Arc, Mutex};

/// 观察者 trait
trait Observer: Send + Sync {
    fn update(&self, event: &str, data: &str);
}

/// 主题——被观察者
struct Subject {
    observers: Vec<Arc<dyn Observer>>,
}

impl Subject {
    fn new() -> Self {
        Self { observers: Vec::new() }
    }

    fn attach(&mut self, observer: Arc<dyn Observer>) {
        self.observers.push(observer);
    }

    fn detach(&mut self, observer: &Arc<dyn Observer>) {
        self.observers.retain(|o| !Arc::ptr_eq(o, observer));
    }

    fn notify(&self, event: &str, data: &str) {
        for observer in &self.observers {
            observer.update(event, data);
        }
    }
}

/// 具体观察者——日志观察者
struct LogObserver {
    name: String,
}

impl LogObserver {
    fn new(name: &str) -> Self {
        Self { name: name.into() }
    }
}

impl Observer for LogObserver {
    fn update(&self, event: &str, data: &str) {
        println!("[{}] 事件: {} 数据: {}", self.name, event, data);
    }
}

/// 具体观察者——邮件通知观察者
struct EmailObserver {
    email: String,
}

impl EmailObserver {
    fn new(email: &str) -> Self {
        Self { email: email.into() }
    }
}

impl Observer for EmailObserver {
    fn update(&self, event: &str, data: &str) {
        println!("发送邮件到 {}: 事件 {} - {}", self.email, event, data);
    }
}

fn main() {
    let mut subject = Subject::new();

    let logger = Arc::new(LogObserver::new("日志器"));
    let emailer = Arc::new(EmailObserver::new("admin@example.com"));

    subject.attach(logger.clone());
    subject.attach(emailer.clone());

    subject.notify("user_login", "用户 Alice 登录");
    subject.notify("order_created", "订单 #1234 已创建");
}
```

---

### 21.3.7 状态（State）

```rust
/// 文档状态——使用 enum 实现状态机
#[derive(Debug, Clone, PartialEq)]
enum DocumentState {
    Draft,
    Moderation,
    Published,
}

/// 文档
struct Document {
    title: String,
    content: String,
    state: DocumentState,
}

impl Document {
    fn new(title: &str) -> Self {
        Self {
            title: title.into(),
            content: String::new(),
            state: DocumentState::Draft,
        }
    }

    fn publish(&mut self) -> Result<(), String> {
        match self.state {
            DocumentState::Draft => {
                self.state = DocumentState::Moderation;
                println!("文档 '{}' 提交审核", self.title);
                Ok(())
            }
            DocumentState::Moderation => {
                self.state = DocumentState::Published;
                println!("文档 '{}' 审核通过并发布", self.title);
                Ok(())
            }
            DocumentState::Published => {
                Err("文档已发布".into())
            }
        }
    }

    fn reject(&mut self) -> Result<(), String> {
        match self.state {
            DocumentState::Moderation => {
                self.state = DocumentState::Draft;
                println!("文档 '{}' 审核被拒绝，退回草稿", self.title);
                Ok(())
            }
            _ => Err("只能在审核状态拒绝".into()),
        }
    }

    fn unpublish(&mut self) -> Result<(), String> {
        match self.state {
            DocumentState::Published => {
                self.state = DocumentState::Draft;
                println!("文档 '{}' 已取消发布", self.title);
                Ok(())
            }
            _ => Err("只能取消已发布的文档".into()),
        }
    }
}

fn main() {
    let mut doc = Document::new("Rust 设计模式");

    doc.publish().unwrap(); // Draft → Moderation
    doc.publish().unwrap(); // Moderation → Published
    doc.unpublish().unwrap(); // Published → Draft

    println!("当前状态: {:?}", doc.state);
}
```

---

### 21.3.8 策略（Strategy）

```rust
/// 排序策略 trait
trait SortStrategy {
    fn sort(&self, data: &mut [i32]);
}

/// 冒泡排序策略
struct BubbleSort;
impl SortStrategy for BubbleSort {
    fn sort(&self, data: &mut [i32]) {
        println!("使用冒泡排序");
        for i in 0..data.len() {
            for j in 0..data.len() - 1 - i {
                if data[j] > data[j + 1] {
                    data.swap(j, j + 1);
                }
            }
        }
    }
}

/// 快速排序策略
struct QuickSort;
impl SortStrategy for QuickSort {
    fn sort(&self, data: &mut [i32]) {
        println!("使用快速排序");
        if data.len() <= 1 { return; }
        let pivot = data[data.len() / 2];
        let mut left = Vec::new();
        let mut middle = Vec::new();
        let mut right = Vec::new();
        for &item in data.iter() {
            if item < pivot { left.push(item); }
            else if item == pivot { middle.push(item); }
            else { right.push(item); }
        }
        self.sort(&mut left);
        self.sort(&mut right);
        let sorted: Vec<i32> = left.into_iter()
            .chain(middle.into_iter())
            .chain(right.into_iter())
            .collect();
        data.copy_from_slice(&sorted);
    }
}

/// 闭包策略——使用闭包代替 trait 对象
struct Sorter<F: Fn(&mut [i32])> {
    strategy: F,
}

impl<F: Fn(&mut [i32])> Sorter<F> {
    fn new(strategy: F) -> Self {
        Self { strategy }
    }

    fn sort(&self, data: &mut [i32]) {
        (self.strategy)(data);
    }
}

fn main() {
    let mut data1 = vec![5, 3, 8, 1, 9, 2];
    let mut data2 = vec![5, 3, 8, 1, 9, 2];

    // trait 策略
    let strategies: Vec<Box<dyn SortStrategy>> = vec![
        Box::new(BubbleSort),
        Box::new(QuickSort),
    ];

    for (i, strategy) in strategies.into_iter().enumerate() {
        let mut data = if i == 0 { data1.clone() } else { data2.clone() };
        strategy.sort(&mut data);
        println!("结果: {:?}", data);
    }

    // 闭包策略
    let closure_sorter = Sorter::new(|data: &mut [i32]| {
        data.sort();
        println!("使用闭包排序");
    });

    let mut data3 = vec![5, 3, 8, 1, 9, 2];
    closure_sorter.sort(&mut data3);
    println!("结果: {:?}", data3);
}
```

---

### 21.3.9 模板方法（Template Method）

```rust
/// 模板 trait——定义算法骨架
trait DataProcessor {
    /// 读取数据（子类实现）
    fn read_data(&self) -> String;
    /// 处理数据（子类实现）
    fn process(&self, data: &str) -> String;
    /// 写入结果（子类实现）
    fn write_result(&self, result: &str);

    /// 模板方法——定义算法骨架
    fn run(&self) {
        println!("=== 开始数据处理 ===");

        let data = self.read_data();
        println!("读取数据: {}", data);

        let result = self.process(&data);
        println!("处理结果: {}", result);

        self.write_result(&result);
        println!("=== 数据处理完成 ===");
    }
}

/// CSV 处理器
struct CsvProcessor {
    filename: String,
}

impl DataProcessor for CsvProcessor {
    fn read_data(&self) -> String {
        format!("CSV 数据来自 {}", self.filename)
    }

    fn process(&self, data: &str) -> String {
        format!("解析 CSV: {}", data)
    }

    fn write_result(&self, result: &str) {
        println!("写入 CSV 结果: {}", result);
    }
}

/// JSON 处理器
struct JsonProcessor {
    filename: String,
}

impl DataProcessor for JsonProcessor {
    fn read_data(&self) -> String {
        format!("JSON 数据来自 {}", self.filename)
    }

    fn process(&self, data: &str) -> String {
        format!("解析 JSON: {}", data)
    }

    fn write_result(&self, result: &str) {
        println!("写入 JSON 结果: {}", result);
    }
}

fn main() {
    let csv = CsvProcessor { filename: "data.csv".into() };
    csv.run();

    println!();

    let json = JsonProcessor { filename: "data.json".into() };
    json.run();
}
```

---

### 21.3.10 访问者（Visitor）

```rust
use std::fmt;

/// AST 节点
#[derive(Debug)]
enum Expr {
    Number(f64),
    Add(Box<Expr>, Box<Expr>),
    Multiply(Box<Expr>, Box<Expr>),
    Negate(Box<Expr>),
}

/// 访问者 trait
trait ExprVisitor {
    type Output;
    fn visit_number(&mut self, value: f64) -> Self::Output;
    fn visit_add(&mut self, left: &Expr, right: &Expr) -> Self::Output;
    fn visit_multiply(&mut self, left: &Expr, right: &Expr) -> Self::Output;
    fn visit_negate(&mut self, expr: &Expr) -> Self::Output;
}

/// Expr 的 accept 方法
impl Expr {
    fn accept<V: ExprVisitor>(&self, visitor: &mut V) -> V::Output {
        match self {
            Expr::Number(v) => visitor.visit_number(*v),
            Expr::Add(l, r) => visitor.visit_add(l, r),
            Expr::Multiply(l, r) => visitor.visit_multiply(l, r),
            Expr::Negate(e) => visitor.visit_negate(e),
        }
    }
}

/// 求值访问者
struct Evaluator;

impl ExprVisitor for Evaluator {
    type Output = f64;

    fn visit_number(&mut self, value: f64) -> f64 { value }

    fn visit_add(&mut self, left: &Expr, right: &Expr) -> f64 {
        left.accept(self) + right.accept(self)
    }

    fn visit_multiply(&mut self, left: &Expr, right: &Expr) -> f64 {
        left.accept(self) * right.accept(self)
    }

    fn visit_negate(&mut self, expr: &Expr) -> f64 {
        -expr.accept(self)
    }
}

/// 格式化访问者
struct Formatter;

impl ExprVisitor for Formatter {
    type Output = String;

    fn visit_number(&mut self, value: f64) -> String {
        format!("{}", value)
    }

    fn visit_add(&mut self, left: &Expr, right: &Expr) -> String {
        format!("({} + {})", left.accept(self), right.accept(self))
    }

    fn visit_multiply(&mut self, left: &Expr, right: &Expr) -> String {
        format!("({} * {})", left.accept(self), right.accept(self))
    }

    fn visit_negate(&mut self, expr: &Expr) -> String {
        format!("(-{})", expr.accept(self))
    }
}

fn main() {
    // 表达式: (1 + 2) * (-3)
    let expr = Expr::Multiply(
        Box::new(Expr::Add(
            Box::new(Expr::Number(1.0)),
            Box::new(Expr::Number(2.0)),
        )),
        Box::new(Expr::Negate(
            Box::new(Expr::Number(3.0)),
        )),
    );

    // 求值
    let mut evaluator = Evaluator;
    let result = expr.accept(&mut evaluator);
    println!("求值结果: {}", result); // -9

    // 格式化
    let mut formatter = Formatter;
    let formatted = expr.accept(&mut formatter);
    println!("格式化: {}", formatted); // ((1 + 2) * (-3))
}
```

---

## 21.4 Rust 惯用模式

### 21.4.1 类型状态模式（Type State）

利用 Rust 的类型系统在编译期追踪状态，实现零开销的状态机：

```rust
use std::marker::PhantomData;

/// 状态标记
pub struct Unconfigured;
pub struct Configured;
pub struct Running;

/// 服务器——类型参数追踪状态
pub struct Server<State> {
    host: Option<String>,
    port: Option<u16>,
    _state: PhantomData<State>,
}

impl Server<Unconfigured> {
    pub fn new() -> Self {
        Self {
            host: None,
            port: None,
            _state: PhantomData,
        }
    }

    /// 只有 Unconfigured 状态才能设置 host
    pub fn host(self, host: impl Into<String>) -> Server<Configured> {
        Server {
            host: Some(host.into()),
            port: self.port,
            _state: PhantomData,
        }
    }
}

impl Server<Configured> {
    /// Configured 状态可以设置端口
    pub fn port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }

    /// Configured 状态可以启动
    pub fn start(self) -> Server<Running> {
        let host = self.host.unwrap();
        let port = self.port.unwrap_or(8080);
        println!("服务器启动: {}:{}", host, port);
        Server {
            host: Some(host),
            port: Some(port),
            _state: PhantomData,
        }
    }
}

impl Server<Running> {
    /// 只有 Running 状态才能停止
    pub fn stop(self) {
        println!("服务器停止");
    }

    /// 只有 Running 状态才能处理请求
    pub fn handle_request(&self, path: &str) -> String {
        format!("处理请求: {}", path)
    }
}

fn main() {
    // 编译通过：正确流程
    let server = Server::new()
        .host("0.0.0.0")
        .port(3000)
        .start();

    server.handle_request("/api/users");
    server.stop();

    // 编译失败：未设置 host 就启动
    // Server::new().start(); // ❌ Server<Unconfigured> 没有 start 方法

    // 编译失败：未启动就处理请求
    // Server::new().host("0.0.0.0").handle_request("/"); // ❌ Server<Configured> 没有 handle_request
}
```

---

### 21.4.2 newtype 模式

```rust
use std::ops::Deref;

/// newtype——类型安全的 ID 包装
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct UserId(String);

impl UserId {
    fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    fn as_str(&self) -> &str {
        &self.0
    }
}

/// newtype——类型安全的温度
#[derive(Debug, Clone, Copy)]
struct Celsius(f64);

#[derive(Debug, Clone, Copy)]
struct Fahrenheit(f64);

impl Celsius {
    fn new(value: f64) -> Self {
        Self(value)
    }

    fn to_fahrenheit(self) -> Fahrenheit {
        Fahrenheit(self.0 * 9.0 / 5.0 + 32.0)
    }
}

impl Fahrenheit {
    fn new(value: f64) -> Self {
        Self(value)
    }

    fn to_celsius(self) -> Celsius {
        Celsius((self.0 - 32.0) * 5.0 / 9.0)
    }
}

/// newtype + Deref——透明包装
struct Html(String);

impl Html {
    fn new(content: impl Into<String>) -> Self {
        Self(content.into())
    }
}

impl Deref for Html {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

// 编译期类型安全：不能混用 UserId 和 OrderId
fn get_user(id: UserId) -> String {
    format!("用户: {}", id.as_str())
}

fn main() {
    let user_id = UserId::new("user_123");
    println!("{}", get_user(user_id));

    // 类型安全：不能传入普通字符串
    // get_user("user_123"); // ❌ 类型不匹配

    let temp = Celsius::new(100.0);
    let fahrenheit = temp.to_fahrenheit();
    println!("100°C = {:?}°F", fahrenheit);

    // Deref 透明访问
    let html = Html::new("<h1>Hello</h1>");
    println!("HTML 长度: {}", html.len()); // 通过 Deref 调用 str::len
}
```

---

### 21.4.3 RAII 模式

Rust 的 RAII（Resource Acquisition Is Initialization）通过 `Drop` trait 实现自动资源管理：

```rust
use std::fs::File;
use std::io::Write;

/// RAII 文件锁——自动释放
struct FileLock {
    file: File,
    path: String,
}

impl FileLock {
    fn acquire(path: &str) -> std::io::Result<Self> {
        println!("获取文件锁: {}", path);
        let file = File::create(path)?;
        Ok(Self {
            file,
            path: path.into(),
        })
    }

    fn write_data(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.file.write_all(data)
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        println!("释放文件锁: {}", self.path);
        // Drop 自动调用，无需手动释放
    }
}

/// RAII 数据库事务——自动回滚
struct Transaction<'a> {
    db: &'a Database,
    committed: bool,
}

struct Database {
    name: String,
}

impl Database {
    fn begin_transaction(&self) -> Transaction {
        println!("开始事务");
        Transaction {
            db: self,
            committed: false,
        }
    }
}

impl Transaction<'_> {
    fn commit(&mut self) {
        println!("提交事务");
        self.committed = true;
    }
}

impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.committed {
            println!("事务未提交，自动回滚");
        }
    }
}

/// RAII 作用域守卫
struct ScopeGuard<F: FnOnce()>(Option<F>);

impl<F: FnOnce()> ScopeGuard<F> {
    fn new(f: F) -> Self {
        Self(Some(f))
    }

    /// 取消防护（不执行清理函数）
    fn dismiss(mut self) {
        self.0.take();
    }
}

impl<F: FnOnce()> Drop for ScopeGuard<F> {
    fn drop(&mut self) {
        if let Some(f) = self.0.take() {
            f();
        }
    }
}

fn main() {
    // RAII 文件锁
    {
        let mut lock = FileLock::acquire("/tmp/test.lock").unwrap();
        lock.write_data(b"Hello, RAII!").unwrap();
        // 离开作用域时自动释放锁
    }
    println!("---");

    // RAII 事务
    let db = Database { name: "mydb".into() };
    {
        let mut tx = db.begin_transaction();
        tx.commit();
        // 提交后不会回滚
    }
    println!("---");

    {
        let _tx = db.begin_transaction();
        // 未提交，离开作用域自动回滚
    }
    println!("---");

    // 作用域守卫
    {
        let _guard = ScopeGuard::new(|| {
            println!("清理资源");
        });
        println!("执行操作");
        // 离开作用域自动执行清理
    }
}
```

---

## 小结

| 模式 | Rust 实现要点 | 适用场景 |
|------|-------------|---------|
| 单例 | `LazyLock<Mutex<T>>` | 全局配置、连接池 |
| 工厂方法 | trait + 泛型 | 对象创建逻辑复杂 |
| 抽象工厂 | 关联类型 trait | 多平台 UI 组件 |
| 建造者 | 消费型 Builder / 类型状态 | 复杂对象构建 |
| 原型 | `Clone` trait | 对象克隆 |
| 适配器 | trait 适配 / newtype | 接口不兼容 |
| 桥接 | trait 分离抽象与实现 | 多维度变化 |
| 组合 | `enum` + `Box<dyn Trait>` | 树形结构 |
| 装饰器 | trait 包装 | 动态扩展功能 |
| 外观 | 简化 API 封装 | 复杂子系统 |
| 享元 | `Arc` 共享 / `LazyLock` | 大量相似对象 |
| 代理 | 懒加载 / 缓存代理 | 访问控制 |
| 责任链 | Handler trait 链 | 请求处理管道 |
| 命令 | trait 对象队列 | 撤销/重做 |
| 迭代器 | `Iterator` trait | 自定义遍历 |
| 中介者 | channel 消息传递 | 组件解耦 |
| 备忘录 | `Clone` 快照 | 状态恢复 |
| 观察者 | `Arc<dyn Observer>` | 事件通知 |
| 状态 | `enum` 状态机 / 类型状态 | 状态转换 |
| 策略 | trait / 闭包 | 算法切换 |
| 模板方法 | trait 默认实现 | 算法骨架 |
| 访问者 | `enum` + `match` | AST 操作 |
| 类型状态 | 泛型 + `PhantomData` | 编译期状态机 |
| newtype | 元组结构体 + `Deref` | 类型安全包装 |
| RAII | `Drop` trait | 自动资源管理 |