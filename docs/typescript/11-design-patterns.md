# 第 11 章：设计模式

> 目标读者：有 TypeScript 工程经验的开发者，希望系统掌握 GoF 设计模式在 TypeScript 中的最佳实践，以及利用类型系统实现的惯用模式。

设计模式本质上是"在特定上下文中重复出现的问题的可复用解决方案"。TypeScript 的类型系统让很多经典模式更加安全、可维护。

---

## 创建型模式（Creational Patterns）

创建型模式关注对象的创建机制，让系统与具体类解耦。

### 11.1 单例（Singleton）

单例确保一个类只有一个实例，并提供全局访问点。TypeScript 中模块本身就是天然的单例。

#### 模块级单例

```typescript
// singleton/module-singleton.ts
// 模块级单例——最简单、推荐的方式
class DatabaseConnection {
  private connected = false;

  connect(): void {
    if (this.connected) return;
    console.log("建立数据库连接...");
    this.connected = true;
  }

  query(sql: string): unknown[] {
    if (!this.connected) throw new Error("未连接");
    console.log(`执行查询: ${sql}`);
    return [];
  }
}

// 模块导出即单例
export const db = new DatabaseConnection();
```

#### 类单例（私有构造函数）

```typescript
// singleton/class-singleton.ts
export class AppConfig {
  private static instance: AppConfig | null = null;

  readonly apiUrl: string;
  readonly appName: string;

  private constructor() {
    // 私有构造函数，防止外部 new
    this.apiUrl = process.env.API_URL || "http://localhost:3000";
    this.appName = "MyApp";
  }

  static getInstance(): AppConfig {
    if (!AppConfig.instance) {
      AppConfig.instance = new AppConfig();
    }
    return AppConfig.instance;
  }

  /** 防止克隆 */
  private clone(): void {
    // 空实现，阻止 Object.assign 等克隆操作
  }
}

// 使用
const config = AppConfig.getInstance();
```

#### Symbol + 全局注册表

```typescript
// singleton/registry.ts
const SINGLETON_KEY = Symbol("singleton_registry");

type Constructor<T> = new (...args: unknown[]) => T;

class SingletonRegistry {
  private instances = new Map<symbol, unknown>();

  register<T>(key: symbol, Class: Constructor<T>, ...args: unknown[]): T {
    if (!this.instances.has(key)) {
      this.instances.set(key, new Class(...args));
    }
    return this.instances.get(key) as T;
  }

  get<T>(key: symbol): T | undefined {
    return this.instances.get(key) as T | undefined;
  }
}

export const singletonRegistry = new SingletonRegistry();

// 使用
const DB_KEY = Symbol("db");
class Database {}

const db1 = singletonRegistry.register(DB_KEY, Database);
const db2 = singletonRegistry.register(DB_KEY, Database);
console.log(db1 === db2); // true
```

> **要点总结**
> - TypeScript 中模块导出是天然单例，无特殊需要应优先使用
> - 私有构造函数 + `getInstance` 是经典实现方式
> - 注意单例在测试中可能需要重置，考虑用工厂函数替代

---

### 11.2 工厂方法（Factory Method）

工厂方法定义一个创建对象的接口，让子类决定实例化哪个类。

#### 接口 + 工厂函数

```typescript
// factory-method/logger-factory.ts
// 产品接口
interface Logger {
  log(message: string): void;
}

// 具体产品
class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(`[Console] ${message}`);
  }
}

class FileLogger implements Logger {
  log(message: string): void {
    // 模拟写入文件
    console.log(`[File] ${message}`);
  }
}

class RemoteLogger implements Logger {
  log(message: string): void {
    // 模拟发送到远程
    console.log(`[Remote] ${message}`);
  }
}

// 工厂函数——简单工厂
function createLogger(type: "console" | "file" | "remote"): Logger {
  switch (type) {
    case "console":
      return new ConsoleLogger();
    case "file":
      return new FileLogger();
    case "remote":
      return new RemoteLogger();
  }
}

// 使用
const logger = createLogger("file");
logger.log("工厂方法模式示例");
```

#### 泛型工厂

```typescript
// factory-method/generic-factory.ts
// 工厂注册表——支持泛型
type Factory<T> = new (...args: unknown[]) => T;

class FactoryRegistry<T> {
  private factories = new Map<string, Factory<T>>();

  /** 注册一个产品类型 */
  register(name: string, factory: Factory<T>): void {
    this.factories.set(name, factory);
  }

  /** 创建产品实例 */
  create(name: string, ...args: unknown[]): T {
    const Factory = this.factories.get(name);
    if (!Factory) {
      throw new Error(`未知的产品类型: ${name}`);
    }
    return new Factory(...args);
  }
}

// 使用示例
interface Shape {
  draw(): void;
}

class Circle implements Shape {
  draw(): void { console.log("绘制圆形"); }
}

class Square implements Shape {
  draw(): void { console.log("绘制方形"); }
}

const shapeFactory = new FactoryRegistry<Shape>();
shapeFactory.register("circle", Circle);
shapeFactory.register("square", Square);

const shape = shapeFactory.create("circle");
shape.draw();
```

> **要点总结**
> - 工厂方法将对象的创建和使用分离
> - 泛型工厂注册表可以实现类型安全的"按名创建"
> - 适合创建逻辑复杂、有多个变体的场景

---

### 11.3 抽象工厂（Abstract Factory）

抽象工厂提供创建一系列相关对象的接口，而不指定具体类。

```typescript
// abstract-factory/ui-factory.ts
// ---- 产品族：按钮 ----
interface Button {
  render(): void;
  click(): void;
}

class WinButton implements Button {
  render(): void { console.log("Windows 风格按钮"); }
  click(): void { console.log("Windows 按钮点击"); }
}

class MacButton implements Button {
  render(): void { console.log("macOS 风格按钮"); }
  click(): void { console.log("macOS 按钮点击"); }
}

// ---- 产品族：复选框 ----
interface Checkbox {
  render(): void;
  toggle(): void;
}

class WinCheckbox implements Checkbox {
  render(): void { console.log("Windows 风格复选框"); }
  toggle(): void { console.log("Windows 复选框切换"); }
}

class MacCheckbox implements Checkbox {
  render(): void { console.log("macOS 风格复选框"); }
  toggle(): void { console.log("macOS 复选框切换"); }
}

// ---- 抽象工厂 ----
interface UIFactory {
  createButton(): Button;
  createCheckbox(): Checkbox;
}

// ---- 具体工厂 ----
class WinFactory implements UIFactory {
  createButton(): Button { return new WinButton(); }
  createCheckbox(): Checkbox { return new WinCheckbox(); }
}

class MacFactory implements UIFactory {
  createButton(): Button { return new MacButton(); }
  createCheckbox(): Checkbox { return new MacCheckbox(); }
}

// ---- 使用（通过工厂创建整个 UI） ----
function createUI(factory: UIFactory) {
  const button = factory.createButton();
  const checkbox = factory.createCheckbox();

  button.render();
  checkbox.render();
}

// 根据平台选择工厂
const platform = process.env.PLATFORM || "win";
const factory: UIFactory = platform === "win" ? new WinFactory() : new MacFactory();

createUI(factory);
```

> **要点总结**
> - 抽象工厂确保同一产品族的产品一起使用，避免混搭
> - 适合 UI 组件库、数据库驱动、云服务 SDK 等场景
> - 新增产品族时只需添加新的具体工厂类

---

### 11.4 建造者（Builder）

建造者模式将一个复杂对象的构建与它的表示分离，允许按步骤创建对象。

#### 链式调用 Builder

```typescript
// builder/query-builder.ts
export class SQLQueryBuilder {
  private table = "";
  private fields: string[] = ["*"];
  private whereClauses: string[] = [];
  private orderByFields: string[] = [];
  private limitCount = 0;
  private offsetCount = 0;

  select(...fields: string[]): this {
    this.fields = fields.length > 0 ? fields : ["*"];
    return this;
  }

  from(table: string): this {
    this.table = table;
    return this;
  }

  where(condition: string): this {
    this.whereClauses.push(condition);
    return this;
  }

  andWhere(condition: string): this {
    return this.where(`AND ${condition}`);
  }

  orWhere(condition: string): this {
    return this.where(`OR ${condition}`);
  }

  orderBy(field: string, direction: "ASC" | "DESC" = "ASC"): this {
    this.orderByFields.push(`${field} ${direction}`);
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  /** 构建最终的 SQL 语句 */
  build(): string {
    let sql = `SELECT ${this.fields.join(", ")} FROM ${this.table}`;

    if (this.whereClauses.length > 0) {
      sql += ` WHERE ${this.whereClauses.join(" ")}`;
    }

    if (this.orderByFields.length > 0) {
      sql += ` ORDER BY ${this.orderByFields.join(", ")}`;
    }

    if (this.limitCount > 0) {
      sql += ` LIMIT ${this.limitCount}`;
    }

    if (this.offsetCount > 0) {
      sql += ` OFFSET ${this.offsetCount}`;
    }

    return sql;
  }
}

// 使用示例
const query = new SQLQueryBuilder()
  .select("id", "name", "email")
  .from("users")
  .where("age > 18")
  .andWhere("status = 'active'")
  .orderBy("name", "ASC")
  .limit(10)
  .offset(20)
  .build();

console.log(query);
// SELECT id, name, email FROM users WHERE age > 18 AND status = 'active' ORDER BY name ASC LIMIT 10 OFFSET 20
```

#### 类型安全 Builder（利用泛型追踪构建状态）

```typescript
// builder/type-safe-builder.ts
// 用类型追踪哪些步骤已完成
interface BuilderState {
  readonly tableSet: boolean;
  readonly whereSet: boolean;
  readonly orderSet: boolean;
}

type InitialState = { tableSet: false; whereSet: false; orderSet: false };
type WithTable = { tableSet: true; whereSet: boolean; orderSet: boolean };
type Complete = { tableSet: true; whereSet: boolean; orderSet: boolean };

export class TypeSafeQueryBuilder<S extends BuilderState = InitialState> {
  private config: {
    table?: string;
    where?: string;
    orderBy?: string;
  } = {};

  /** 只有 tableSet 为 true 后才能 build */
  from(table: string): TypeSafeQueryBuilder<S & WithTable> {
    this.config.table = table;
    return this as unknown as TypeSafeQueryBuilder<S & WithTable>;
  }

  where(condition: string): TypeSafeQueryBuilder<S & { whereSet: true }> {
    this.config.where = condition;
    return this as unknown as TypeSafeQueryBuilder<S & { whereSet: true }>;
  }

  orderBy(field: string): TypeSafeQueryBuilder<S & { orderSet: true }> {
    this.config.orderBy = field;
    return this as unknown as TypeSafeQueryBuilder<S & { orderSet: true }>;
  }

  /** 强制要求 table 已设置 */
  build(this: TypeSafeQueryBuilder<Complete>): string {
    return `SELECT * FROM ${this.config.table!}${
      this.config.where ? ` WHERE ${this.config.where}` : ""
    }${this.config.orderBy ? ` ORDER BY ${this.config.orderBy}` : ""}`;
  }
}

// 使用——类型系统强制调用顺序
const qb = new TypeSafeQueryBuilder();
// qb.build(); // ❌ 类型错误：tableSet 为 false
const sql = qb.from("users").where("age > 18").orderBy("name").build();
// qb.from("users").build(); // ❌ 类型错误：缺少 where 和 orderBy

console.log(sql);
```

> **要点总结**
> - Builder 模式适合构造参数多、可选参数多的复杂对象
> - 链式调用（fluent API）是 Builder 的标志性风格
> - 利用泛型可以在类型级别追踪构建步骤，在编译期防止遗漏必填参数

---

### 11.5 原型（Prototype）

原型模式通过复制已有对象来创建新对象，而不是通过 new 实例化。

```typescript
// prototype/shape-prototype.ts
interface Prototype<T> {
  clone(): T;
}

class Shape implements Prototype<Shape> {
  constructor(
    public type: string,
    public color: string,
    public width: number,
    public height: number
  ) {}

  /** 使用 Object.create 实现原型克隆 */
  clone(): this {
    const cloned = Object.create(Object.getPrototypeOf(this));
    return Object.assign(cloned, this);
  }

  describe(): string {
    return `${this.color} ${this.type} (${this.width}x${this.height})`;
  }
}

// 使用
const original = new Shape("矩形", "红色", 100, 50);
console.log(original.describe()); // 红色 矩形 (100x50)

const clone = original.clone();
clone.color = "蓝色";
console.log(clone.describe()); // 蓝色 矩形 (100x50)

console.log(original === clone); // false——不同对象
```

#### structuredClone（深拷贝）

```typescript
// prototype/structured-clone.ts
// TypeScript 4.7+ 支持 structuredClone（现代深拷贝方案）
type Config = {
  appName: string;
  version: string;
  database: {
    host: string;
    port: number;
  };
  features: string[];
};

const defaultConfig: Config = {
  appName: "MyApp",
  version: "1.0.0",
  database: { host: "localhost", port: 5432 },
  features: ["auth", "logging"],
};

// 深拷贝原型
function createConfig(overrides?: Partial<Config>): Config {
  const base = structuredClone(defaultConfig);
  return { ...base, ...overrides };
}

const devConfig = createConfig({
  appName: "MyApp (Dev)",
  database: { host: "dev-db.local", port: 5432 },
  features: ["auth", "logging", "debug"],
});

console.log(devConfig.appName); // MyApp (Dev)
console.log(devConfig.database.host); // dev-db.local
console.log(defaultConfig.database.host); // localhost——互不影响
```

> **要点总结**
> - `Object.create` + `Object.assign` 适合浅拷贝原型
> - `structuredClone` 是现代深拷贝方案，支持 Date、Map、Set、ArrayBuffer 等
> - 原型模式适用于需要创建大量相似对象，且创建成本较高的场景

---

## 结构型模式（Structural Patterns）

结构型模式关注类和对象的组合，形成更大的结构。

### 11.6 适配器（Adapter）

适配器让不兼容的接口能够协同工作。

```typescript
// adapter/payment-adapter.ts
// ---- 目标接口（应用期望的接口） ----
interface PaymentProcessor {
  pay(amount: number, currency: string): Promise<{ success: boolean; transactionId: string }>;
  refund(transactionId: string): Promise<boolean>;
}

// ---- 第三方支付服务（不兼容的接口） ----
class StripeService {
  charge(amountCents: number, currencyCode: string): { id: string; status: string } {
    console.log(`Stripe 扣款: ${amountCents / 100} ${currencyCode}`);
    return { id: `stripe_${Date.now()}`, status: "succeeded" };
  }

  refundCharge(chargeId: string): { status: string } {
    console.log(`Stripe 退款: ${chargeId}`);
    return { status: "succeeded" };
  }
}

class PayPalService {
  makePayment(usdAmount: number): string {
    console.log(`PayPal 支付: $${usdAmount}`);
    return `paypal_${Date.now()}`;
  }

  processRefund(transactionId: string): boolean {
    console.log(`PayPal 退款: ${transactionId}`);
    return true;
  }
}

// ---- 适配器 ----
class StripeAdapter implements PaymentProcessor {
  constructor(private stripe: StripeService) {}

  async pay(amount: number, currency: string): Promise<{ success: boolean; transactionId: string }> {
    const amountCents = Math.round(amount * 100);
    const result = this.stripe.charge(amountCents, currency);
    return { success: result.status === "succeeded", transactionId: result.id };
  }

  async refund(transactionId: string): Promise<boolean> {
    const result = this.stripe.refundCharge(transactionId);
    return result.status === "succeeded";
  }
}

class PayPalAdapter implements PaymentProcessor {
  constructor(private paypal: PayPalService) {}

  async pay(amount: number, currency: string): Promise<{ success: boolean; transactionId: string }> {
    // PayPal 只支持美元，需要转换
    if (currency !== "USD") {
      throw new Error("PayPal 仅支持 USD");
    }
    const transactionId = this.paypal.makePayment(amount);
    return { success: true, transactionId };
  }

  async refund(transactionId: string): Promise<boolean> {
    return this.paypal.processRefund(transactionId);
  }
}

// ---- 使用 ----
async function processOrder(processor: PaymentProcessor, amount: number, currency: string) {
  const result = await processor.pay(amount, currency);
  console.log(`支付结果: ${result.success ? "成功" : "失败"}`);
}

// 根据不同配置选择适配器
const paymentProcessor: PaymentProcessor =
  process.env.PAYMENT_PROVIDER === "stripe"
    ? new StripeAdapter(new StripeService())
    : new PayPalAdapter(new PayPalService());

await processOrder(paymentProcessor, 99.99, "USD");
```

> **要点总结**
> - 适配器不改变原有接口，而是做一次转换
> - 类适配器（继承）和对象适配器（组合）中，**组合优先**
> - 适配器广泛用于对接第三方 SDK、旧系统接口等

---

### 11.7 桥接（Bridge）

桥接将抽象部分与实现部分分离，使两者可以独立变化。

```typescript
// bridge/device-remote.ts
// ---- 实现层 ----
interface Device {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  getVolume(): number;
  setVolume(percent: number): void;
}

class TV implements Device {
  private on = false;
  private volume = 50;

  isEnabled(): boolean { return this.on; }
  enable(): void { this.on = true; console.log("电视已开机"); }
  disable(): void { this.on = false; console.log("电视已关机"); }
  getVolume(): number { return this.volume; }
  setVolume(percent: number): void {
    this.volume = Math.max(0, Math.min(100, percent));
    console.log(`电视音量设为 ${this.volume}`);
  }
}

class Radio implements Device {
  private on = false;
  private volume = 30;

  isEnabled(): boolean { return this.on; }
  enable(): void { this.on = true; console.log("收音机已开机"); }
  disable(): void { this.on = false; console.log("收音机已关机"); }
  getVolume(): number { return this.volume; }
  setVolume(percent: number): void {
    this.volume = Math.max(0, Math.min(100, percent));
    console.log(`收音机音量设为 ${this.volume}`);
  }
}

// ---- 抽象层 ----
class RemoteControl {
  constructor(protected device: Device) {}

  togglePower(): void {
    if (this.device.isEnabled()) {
      this.device.disable();
    } else {
      this.device.enable();
    }
  }

  volumeUp(): void {
    this.device.setVolume(this.device.getVolume() + 10);
  }

  volumeDown(): void {
    this.device.setVolume(this.device.getVolume() - 10);
  }
}

// 扩展抽象
class AdvancedRemoteControl extends RemoteControl {
  mute(): void {
    this.device.setVolume(0);
    console.log("已静音");
  }
}

// 使用
const tv = new TV();
const remote = new AdvancedRemoteControl(tv);

remote.togglePower();   // 电视已开机
remote.volumeUp();      // 电视音量设为 60
remote.mute();          // 已静音
```

> **要点总结**
> - 桥接模式将"抽象"和"实现"放在不同的类层次中
> - 比"为每个组合建一个子类"的方式更灵活
> - 适合跨平台 UI（抽象=窗口，实现=渲染引擎）、多种设备控制等场景

---

### 11.8 组合（Composite）

组合模式将对象组合成树形结构以表示"部分-整体"的层次结构。

```typescript
// composite/file-system.ts
// 组件接口
abstract class FileSystemNode {
  constructor(protected name: string) {}

  abstract getSize(): number;
  abstract print(indent?: string): void;
}

// 叶子节点
class File extends FileSystemNode {
  constructor(name: string, private size: number) {
    super(name);
  }

  getSize(): number {
    return this.size;
  }

  print(indent = ""): void {
    console.log(`${indent}📄 ${this.name} (${this.size} bytes)`);
  }
}

// 容器节点
class Directory extends FileSystemNode {
  private children: FileSystemNode[] = [];

  constructor(name: string) {
    super(name);
  }

  add(node: FileSystemNode): void {
    this.children.push(node);
  }

  remove(node: FileSystemNode): void {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
  }

  getSize(): number {
    return this.children.reduce((sum, child) => sum + child.getSize(), 0);
  }

  print(indent = ""): void {
    console.log(`${indent}📁 ${this.name}/`);
    for (const child of this.children) {
      child.print(indent + "  ");
    }
  }
}

// 使用
const root = new Directory("root");
const home = new Directory("home");
const user = new Directory("user");

const file1 = new File("readme.txt", 100);
const file2 = new File("photo.jpg", 2048);
const file3 = new File("notes.md", 500);

user.add(file1);
user.add(file2);
home.add(user);
home.add(file3);
root.add(home);

root.print();
// 📁 root/
//   📁 home/
//     📁 user/
//       📄 readme.txt (100 bytes)
//       📄 photo.jpg (2048 bytes)
//     📄 notes.md (500 bytes)

console.log(`总大小: ${root.getSize()} bytes`); // 总大小: 2648 bytes
```

> **要点总结**
> - 组合模式让客户端可以统一处理单个对象和组合对象
> - 核心是组件抽象类/接口，叶子和容器都实现它
> - 文件系统、UI 组件树、DOM 树都是组合模式的典型应用

---

### 11.9 装饰器（Decorator）

装饰器动态地给对象添加额外职责，比继承更灵活。TypeScript 支持两种风格的装饰器。

#### 高阶函数装饰器

```typescript
// decorator/function-decorator.ts
// 高阶函数装饰——推荐方式（无需 experimentalDecorators）
type AsyncFunction<A extends unknown[], R> = (...args: A) => Promise<R>;

/** 计时装饰器 */
function withTiming<A extends unknown[], R>(
  fn: AsyncFunction<A, R>,
  label?: string
): AsyncFunction<A, R> {
  return async (...args: A): Promise<R> => {
    const start = performance.now();
    try {
      const result = await fn(...args);
      const duration = performance.now() - start;
      console.log(`[${label || fn.name}] 耗时: ${duration.toFixed(2)}ms`);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      console.error(`[${label || fn.name}] 失败 (${duration.toFixed(2)}ms):`, err);
      throw err;
    }
  };
}

/** 重试装饰器 */
function withRetry<A extends unknown[], R>(
  fn: AsyncFunction<A, R>,
  maxRetries: number = 3,
  delayMs: number = 1000
): AsyncFunction<A, R> {
  return async (...args: A): Promise<R> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          console.warn(`第 ${attempt} 次尝试失败，${delayMs}ms 后重试...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError;
  };
}

/** 缓存装饰器 */
function withCache<A extends unknown[], R>(
  fn: AsyncFunction<A, R>,
  ttlMs: number = 60_000
): AsyncFunction<A, R> {
  const cache = new Map<string, { value: R; timestamp: number }>();

  return async (...args: A): Promise<R> => {
    const key = JSON.stringify(args);
    const cached = cache.get(key);

    if (cached && Date.now() - cached.timestamp < ttlMs) {
      console.log(`[缓存命中] ${fn.name}(${key})`);
      return cached.value;
    }

    const result = await fn(...args);
    cache.set(key, { value: result, timestamp: Date.now() });
    return result;
  };
}

// 使用——函数组合
async function fetchUserData(userId: string): Promise<{ id: string; name: string }> {
  // 模拟 API 请求
  await new Promise((r) => setTimeout(r, 100));

  if (userId === "error") {
    throw new Error("用户不存在");
  }

  return { id: userId, name: `User ${userId}` };
}

// 组合装饰器
const enhancedFetch = withCache(withRetry(withTiming(fetchUserData, "fetchUser")));

await enhancedFetch("123"); // 首次请求
await enhancedFetch("123"); // 缓存命中
```

#### TypeScript 类装饰器语法

```typescript
// decorator/class-decorator.ts
// 需要启用 experimentalDecorators
function Loggable<T extends { new (...args: unknown[]): object }>(target: T): T {
  return class extends target {
    constructor(...args: unknown[]) {
      super(...args);
      console.log(`[构造] ${target.name}`, args);
    }
  };
}

function Readonly(target: unknown, key: string): void {
  Object.defineProperty(target as object, key, { writable: false });
}

@Loggable
class UserService {
  @Readonly
  static VERSION = "1.0";

  constructor(private name: string) {}

  greet(): string {
    return `Hello, ${this.name}`;
  }
}

const service = new UserService("Alice");
console.log(service.greet());

// UserService.VERSION = "2.0"; // 严格模式下运行错误
```

> **要点总结**
> - **高阶函数装饰**（函数组合）是更推荐的 JavaScript/TypeScript 风格
> - 类装饰器 `@Decorator` 语法需要开启 `experimentalDecorators`
> - 多个装饰器的组合顺序需要注意：离函数最近的先执行

---

### 11.10 外观（Facade）

外观为复杂子系统提供一个简化的统一接口。

```typescript
// facade/computer-facade.ts
// 复杂子系统
class CPU {
  freeze(): void { console.log("CPU 冻结"); }
  jump(position: number): void { console.log(`CPU 跳转到 ${position}`); }
  execute(): void { console.log("CPU 执行指令"); }
}

class Memory {
  load(address: number, data: string): void {
    console.log(`内存加载 [${address}]: ${data}`);
  }
}

class HardDrive {
  read(lba: number, size: number): string {
    const data = `数据块(lba=${lba}, size=${size})`;
    console.log(`硬盘读取: ${data}`);
    return data;
  }
}

// 外观
class ComputerFacade {
  private cpu = new CPU();
  private memory = new Memory();
  private hardDrive = new HardDrive();

  private readonly BOOT_ADDRESS = 0x0000;
  private readonly BOOT_SECTOR = 0x0001;
  private readonly SECTOR_SIZE = 512;

  /** 统一启动方法，隐藏子系统的复杂性 */
  start(): void {
    console.log("=== 计算机启动 ===");
    this.cpu.freeze();
    const bootData = this.hardDrive.read(this.BOOT_SECTOR, this.SECTOR_SIZE);
    this.memory.load(this.BOOT_ADDRESS, bootData);
    this.cpu.jump(this.BOOT_ADDRESS);
    this.cpu.execute();
    console.log("=== 启动完成 ===");
  }
}

// 客户端——只和外观交互
const computer = new ComputerFacade();
computer.start();
```

> **要点总结**
> - 外观不隐藏子系统，只是提供更方便的接口
> - 降低客户端与子系统的耦合，减少依赖
> - 常见应用：JS 库的入口 API、复杂业务的门面服务

---

### 11.11 享元（Flyweight）

享元通过共享大量细粒度对象来减少内存占用。

```typescript
// flyweight/text-formatting.ts
// 享元——字符格式
class CharacterStyle {
  constructor(
    readonly font: string,
    readonly size: number,
    readonly bold: boolean,
    readonly italic: boolean,
    readonly color: string
  ) {}

  apply(context: string): string {
    const parts = [`font: ${this.font}`, `size: ${this.size}`];
    if (this.bold) parts.push("bold");
    if (this.italic) parts.push("italic");
    return `[${parts.join(", ")}] ${context}`;
  }
}

// 享元工厂
class CharacterStyleFactory {
  private pool = new Map<string, CharacterStyle>();

  getStyle(
    font: string,
    size: number,
    bold: boolean,
    italic: boolean,
    color: string
  ): CharacterStyle {
    const key = `${font}_${size}_${bold}_${italic}_${color}`;

    if (!this.pool.has(key)) {
      this.pool.set(key, new CharacterStyle(font, size, bold, italic, color));
      console.log(`创建新样式: ${key}`);
    }

    return this.pool.get(key)!;
  }

  get poolSize(): number {
    return this.pool.size;
  }
}

// 使用 WeakMap 的享元
type StyleKey = {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
};

const styleWeakCache = new WeakMap<StyleKey, CharacterStyle>();

function getCachedStyle(key: StyleKey): CharacterStyle {
  let style = styleWeakCache.get(key);

  if (!style) {
    style = new CharacterStyle(key.font, key.size, key.bold, key.italic, key.color);
    styleWeakCache.set(key, style);
  }

  return style;
}

// 使用
const factory = new CharacterStyleFactory();

// 处理文本，每个字符可以有自己的样式
const text = "Hello, 世界!";
const styles: CharacterStyle[] = [];

for (let i = 0; i < text.length; i++) {
  // 共享相同样式的对象
  const style = factory.getStyle(
    i < 5 ? "Arial" : "SimSun",
    12,
    i % 2 === 0,
    false,
    "black"
  );
  styles.push(style);
  console.log(style.apply(text[i]));
}

console.log(`字符数: ${text.length}, 享元池大小: ${factory.poolSize}`);
// 即使样式相同，不重复创建对象
```

> **要点总结**
> - 享元通过共享减少对象数量，适合大量相似对象的场景
> - 享元对象应该是不可变的（所有属性只读）
> - `WeakMap` 适合作为享元缓存，键被回收时缓存自动清理

---

### 11.12 代理（Proxy）

代理为另一个对象提供一个替身/占位符，以控制对这个对象的访问。ES6 `Proxy` 让实现变得非常自然。

```typescript
// proxy/proxy-pattern.ts
// ---- 真实主题 ----
interface Image {
  display(): void;
}

class RealImage implements Image {
  constructor(private filename: string) {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    console.log(`从磁盘加载: ${this.filename}`);
  }

  display(): void {
    console.log(`显示图片: ${this.filename}`);
  }
}

// ---- 虚拟代理（延迟加载） ----
class ImageProxy implements Image {
  private realImage: RealImage | null = null;

  constructor(private filename: string) {}

  display(): void {
    if (!this.realImage) {
      this.realImage = new RealImage(this.filename);
    }
    this.realImage.display();
  }
}

// ---- ES6 Proxy 动态代理 ----
// 访问日志代理
function createLoggingProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      console.log(`[访问日志] ${String(prop)}`);

      // 如果是函数，包装成日志函数
      if (typeof value === "function") {
        return function (this: unknown, ...args: unknown[]) {
          console.log(`[调用日志] ${String(prop)}(${JSON.stringify(args)})`);
          return value.apply(this, args);
        };
      }

      return value;
    },
  });
}

// 验证代理
function createValidationProxy<T extends Record<string, unknown>>(
  target: T,
  validations: Partial<Record<keyof T, (value: unknown) => boolean>>
): T {
  return new Proxy(target, {
    set(obj, prop, value) {
      const validator = validations[prop as keyof T];

      if (validator && !validator(value)) {
        throw new Error(`属性 ${String(prop)} 验证失败`);
      }

      return Reflect.set(obj, prop, value);
    },
  });
}

// ---- 使用 ----
// 1) 虚拟代理
const image = new ImageProxy("photo.jpg");
// 图片还没有真正加载...
image.display(); // 此时才真正加载

// 2) 日志代理
const api = {
  async getUser(id: string) {
    return { id, name: "Alice" };
  },
};
const proxiedApi = createLoggingProxy(api);
await proxiedApi.getUser("123"); // [调用日志] getUser(["123"])

// 3) 验证代理
interface User {
  name: string;
  age: number;
}

const user = createValidationProxy<User>(
  { name: "", age: 0 },
  {
    name: (v) => typeof v === "string" && (v as string).length > 0,
    age: (v) => typeof v === "number" && (v as number) >= 0 && (v as number) < 150,
  }
);

user.name = "Alice"; // OK
// user.age = -1;    // 抛出错误：年龄验证失败
```

> **要点总结**
> - 代理控制对目标对象的访问，不改变目标的行为
> - 常见类型：虚拟代理（延迟加载）、保护代理（权限）、日志代理、缓存代理
> - ES6 `Proxy` + `Reflect` 是动态代理的利器，适合实现 AOP 横切关注点

---

## 行为型模式（Behavioral Patterns）

行为型模式关注对象之间的职责分配和通信。

### 11.13 责任链（Chain of Responsibility）

责任链将请求沿着处理者链传递，直到某个处理者处理它为止。Express/Koa 中间件就是经典的链式处理。

```typescript
// chain-of-responsibility/middleware-chain.ts
// 处理者接口
interface Middleware {
  setNext(next: Middleware): Middleware;
  handle(request: HttpRequest): Promise<HttpRequest | null>;
}

// 请求类型
type HttpRequest = {
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  user?: { role: string };
};

// 基础中间件抽象
abstract class BaseMiddleware implements Middleware {
  private nextHandler: Middleware | null = null;

  setNext(next: Middleware): Middleware {
    this.nextHandler = next;
    return next;
  }

  async handle(request: HttpRequest): Promise<HttpRequest | null> {
    const result = await this.process(request);

    if (result !== null && this.nextHandler) {
      return this.nextHandler.handle(result);
    }

    return result;
  }

  protected abstract process(request: HttpRequest): Promise<HttpRequest | null>;
}

// 具体中间件
class AuthMiddleware extends BaseMiddleware {
  protected async process(request: HttpRequest): Promise<HttpRequest | null> {
    const token = request.headers["authorization"];

    if (!token) {
      console.log("[认证] 未提供令牌");
      return null; // 阻断链
    }

    console.log("[认证] 令牌有效");
    request.user = { role: "user" };
    return request;
  }
}

class RoleMiddleware extends BaseMiddleware {
  constructor(private allowedRoles: string[]) {
    super();
  }

  protected async process(request: HttpRequest): Promise<HttpRequest | null> {
    if (!request.user) {
      console.log("[角色] 未认证");
      return null;
    }

    if (!this.allowedRoles.includes(request.user.role)) {
      console.log(`[角色] 需要角色 ${this.allowedRoles.join(", ")}`);
      return null;
    }

    console.log(`[角色] 角色 ${request.user.role} 通过`);
    return request;
  }
}

class LoggingMiddleware extends BaseMiddleware {
  protected async process(request: HttpRequest): Promise<HttpRequest | null> {
    console.log(`[日志] ${request.method} ${request.path}`);
    return request;
  }
}

// 使用——构建中间件链
const chain = new LoggingMiddleware();
chain
  .setNext(new AuthMiddleware())
  .setNext(new RoleMiddleware(["admin", "user"]));

// 处理请求
async function handleRequest(request: HttpRequest) {
  const result = await chain.handle(request);

  if (result) {
    console.log("✅ 请求处理完成");
  } else {
    console.log("❌ 请求被拦截");
  }
}

await handleRequest({
  path: "/api/data",
  method: "GET",
  headers: { authorization: "Bearer valid-token" },
});

await handleRequest({
  path: "/api/admin",
  method: "POST",
  headers: {},
});
```

> **要点总结**
> - 责任链将发送者和接收者解耦，每个处理者只关注自己的职责
> - 处理者可以选择处理、修改请求或终止传递
> - 中间件、事件过滤器、日志管道等都是典型应用

---

### 11.14 命令（Command）

命令模式将请求封装为对象，从而支持参数化、队列、日志和撤销操作。

```typescript
// command/text-editor.ts
// 命令接口
interface Command {
  execute(): void;
  undo(): void;
}

// 接收者
class TextDocument {
  private content = "";

  insert(position: number, text: string): void {
    this.content =
      this.content.slice(0, position) + text + this.content.slice(position);
  }

  delete(start: number, end: number): void {
    this.content = this.content.slice(0, start) + this.content.slice(end);
  }

  getContent(): string {
    return this.content;
  }
}

// 具体命令
class InsertCommand implements Command {
  private prevContent: string;

  constructor(
    private document: TextDocument,
    private position: number,
    private text: string
  ) {
    this.prevContent = document.getContent();
  }

  execute(): void {
    this.document.insert(this.position, this.text);
  }

  undo(): void {
    // 恢复到插入前的状态
    const current = this.document.getContent();
    this.document.delete(this.position, this.position + this.text.length);
  }
}

class DeleteCommand implements Command {
  private deletedText: string;

  constructor(
    private document: TextDocument,
    private start: number,
    private end: number
  ) {
    this.deletedText = document.getContent().slice(start, end);
  }

  execute(): void {
    this.document.delete(this.start, this.end);
  }

  undo(): void {
    this.document.insert(this.start, this.deletedText);
  }
}

// 调用者——支持撤销/重做
class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  execute(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // 新命令清空重做栈
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (command) {
      command.undo();
      this.redoStack.push(command);
    }
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (command) {
      command.execute();
      this.undoStack.push(command);
    }
  }
}

// 使用
const doc = new TextDocument();
const history = new CommandHistory();

history.execute(new InsertCommand(doc, 0, "Hello"));
console.log(doc.getContent()); // Hello

history.execute(new InsertCommand(doc, 5, " World"));
console.log(doc.getContent()); // Hello World

history.undo();
console.log(doc.getContent()); // Hello

history.redo();
console.log(doc.getContent()); // Hello World
```

> **要点总结**
> - 命令对象封装了执行操作所需的所有信息
> - 每个命令同时实现 `execute` 和 `undo` 即可支持撤销/重做
> - 适用于操作记录、事务、宏录制、异步任务队列等场景

---

### 11.15 迭代器（Iterator）

迭代器提供一种顺序访问聚合对象元素的方法，而不暴露其内部表示。TypeScript 原生支持 `Iterable` 和 `Iterator` 协议。

#### 自定义可迭代对象

```typescript
// iterator/pagination-iterator.ts
class PaginatedIterator<T> implements AsyncIterable<T> {
  constructor(
    private fetchPage: (page: number) => Promise<T[]>,
    private maxPages: number = Infinity
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<T> {
    let currentPage = 0;
    let currentIndex = 0;
    let currentData: T[] = [];
    let done = false;

    return {
      next: async (): Promise<IteratorResult<T>> => {
        if (done) return { value: undefined, done: true };

        // 当前页数据用完时加载下一页
        if (currentIndex >= currentData.length) {
          if (currentPage >= this.maxPages) {
            done = true;
            return { value: undefined, done: true };
          }

          currentPage++;
          currentData = await this.fetchPage(currentPage);
          currentIndex = 0;

          // 空页表示结束
          if (currentData.length === 0) {
            done = true;
            return { value: undefined, done: true };
          }
        }

        return { value: currentData[currentIndex++], done: false };
      },
    };
  }
}

// 使用
async function listAllUsers() {
  const iterator = new PaginatedIterator(
    async (page) => {
      // 模拟分页 API
      const start = (page - 1) * 10;
      if (start >= 50) return []; // 最多 50 条
      return Array.from({ length: 10 }, (_, i) => ({
        id: start + i + 1,
        name: `User ${start + i + 1}`,
      }));
    },
    10 // 最多 10 页
  );

  for await (const user of iterator) {
    console.log(`处理用户: ${user.name}`);
    if (user.id > 25) break; // 可以随时跳出
  }
}

await listAllUsers();
```

#### 生成器实现迭代器

```typescript
// iterator/generator-iterator.ts
// 使用生成器实现斐波那契数列迭代器
function* fibonacciSequence(max: number): Generator<number> {
  let a = 0;
  let b = 1;

  while (a <= max) {
    yield a;
    [a, b] = [b, a + b];
  }
}

// 类型安全的树遍历
interface TreeNode<T> {
  value: T;
  left?: TreeNode<T>;
  right?: TreeNode<T>;
}

function* inOrderTraversal<T>(node: TreeNode<T> | undefined): Generator<T> {
  if (!node) return;

  yield* inOrderTraversal(node.left);
  yield node.value;
  yield* inOrderTraversal(node.right);
}

// 使用
const tree: TreeNode<number> = {
  value: 10,
  left: {
    value: 5,
    left: { value: 2 },
    right: { value: 7 },
  },
  right: {
    value: 15,
    left: { value: 12 },
    right: { value: 20 },
  },
};

const values = [...inOrderTraversal(tree)];
console.log(values); // [2, 5, 7, 10, 12, 15, 20]
```

> **要点总结**
> - `Symbol.iterator` / `Symbol.asyncIterator` 使对象可迭代
> - 生成器（Generator）是实现迭代器最简洁的方式
> - `for...of` / `for await...of` 是消费迭代器的标准方式

---

### 11.16 中介者（Mediator）

中介者通过一个中介对象来封装一组对象之间的交互，减少对象之间的直接耦合。

```typescript
// mediator/chat-room.ts
// 中介者接口
interface ChatMediator {
  sendMessage(sender: User, message: string): void;
  addUser(user: User): void;
  removeUser(user: User): void;
}

// 同事类
class User {
  constructor(
    public readonly name: string,
    private mediator: ChatMediator
  ) {}

  send(message: string): void {
    console.log(`${this.name} 发送: ${message}`);
    this.mediator.sendMessage(this, message);
  }

  receive(sender: User, message: string): void {
    console.log(`${this.name} 收到来自 ${sender.name} 的消息: ${message}`);
  }
}

// 具体中介者
class ChatRoom implements ChatMediator {
  private users: User[] = [];
  private messageLog: string[] = [];

  addUser(user: User): void {
    this.users.push(user);
    this.broadcastSystem(`${user.name} 加入了聊天室`);
  }

  removeUser(user: User): void {
    this.users = this.users.filter((u) => u !== user);
    this.broadcastSystem(`${user.name} 离开了聊天室`);
  }

  sendMessage(sender: User, message: string): void {
    const log = `[${new Date().toLocaleTimeString()}] ${sender.name}: ${message}`;
    this.messageLog.push(log);

    // 广播给除发送者外的所有用户
    for (const user of this.users) {
      if (user !== sender) {
        user.receive(sender, message);
      }
    }
  }

  private broadcastSystem(message: string): void {
    console.log(`[系统] ${message}`);
  }

  getLog(): string[] {
    return [...this.messageLog];
  }
}

// 使用
const chatRoom = new ChatRoom();

const alice = new User("Alice", chatRoom);
const bob = new User("Bob", chatRoom);
const charlie = new User("Charlie", chatRoom);

chatRoom.addUser(alice);
chatRoom.addUser(bob);
chatRoom.addUser(charlie);

alice.send("大家好!");
bob.send("Hi Alice!");
chatRoom.removeUser(charlie);

alice.send("Charlie 走了吗?");
```

#### EventEmitter 作为中介者

```typescript
// mediator/event-bus.ts
type EventCallback = (...args: unknown[]) => void;

class EventBus {
  private listeners = new Map<string, Set<EventCallback>>();

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  removeAll(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

export const eventBus = new EventBus();
```

> **要点总结**
> - 中介者将多对多的交互简化为一对多（对象 ↔ 中介者）
> - EventEmitter/EventBus 是中介者模式的典型实现
> - 缺点是中介者可能变得臃肿，需要合理划分职责

---

### 11.17 备忘录（Memento）

备忘录在不破坏封装的前提下，保存和恢复对象的内部状态。

```typescript
// memento/editor-memento.ts
// 备忘录
class EditorMemento {
  constructor(
    private readonly content: string,
    private readonly cursorPosition: number,
    private readonly timestamp: Date
  ) {}

  getSnapshot(): { content: string; cursorPosition: number } {
    return {
      content: this.content,
      cursorPosition: this.cursorPosition,
    };
  }

  getTimestamp(): Date {
    return this.timestamp;
  }
}

// 原发器
class TextEditor {
  private content = "";
  private cursorPosition = 0;

  type(text: string): void {
    const before = this.content.slice(0, this.cursorPosition);
    const after = this.content.slice(this.cursorPosition);
    this.content = before + text + after;
    this.cursorPosition += text.length;
  }

  moveCursor(position: number): void {
    this.cursorPosition = Math.max(0, Math.min(position, this.content.length));
  }

  delete(): void {
    if (this.cursorPosition > 0 && this.content.length > 0) {
      this.content =
        this.content.slice(0, this.cursorPosition - 1) +
        this.content.slice(this.cursorPosition);
      this.cursorPosition--;
    }
  }

  /** 保存状态到备忘录 */
  save(): EditorMemento {
    return new EditorMemento(this.content, this.cursorPosition, new Date());
  }

  /** 从备忘录恢复状态 */
  restore(memento: EditorMemento): void {
    const snapshot = memento.getSnapshot();
    this.content = snapshot.content;
    this.cursorPosition = snapshot.cursorPosition;
  }

  getContent(): string {
    return this.content;
  }
}

// 负责人（历史记录）
class EditorHistory {
  private history: EditorMemento[] = [];
  private currentIndex = -1;

  save(editor: TextEditor): void {
    // 清空当前位置之后的记录
    this.history = this.history.slice(0, this.currentIndex + 1);
    this.history.push(editor.save());
    this.currentIndex++;
  }

  undo(editor: TextEditor): boolean {
    if (this.currentIndex <= 0) return false;

    this.currentIndex--;
    editor.restore(this.history[this.currentIndex]);
    return true;
  }

  redo(editor: TextEditor): boolean {
    if (this.currentIndex >= this.history.length - 1) return false;

    this.currentIndex++;
    editor.restore(this.history[this.currentIndex]);
    return true;
  }
}

// 使用
const editor = new TextEditor();
const history = new EditorHistory();

editor.type("Hello");
history.save(editor);
console.log(editor.getContent()); // Hello

editor.type(" World");
history.save(editor);
console.log(editor.getContent()); // Hello World

history.undo(editor);
console.log(editor.getContent()); // Hello

history.redo(editor);
console.log(editor.getContent()); // Hello World
```

> **要点总结**
> - 备忘录是**不可变的**快照对象，创建后不应被修改
> - 原发器负责创建和恢复备忘录，负责人只负责存储
> - 适用于文本编辑器撤销、游戏存档、事务回滚等场景

---

### 11.18 观察者（Observer）

观察者定义一对多的依赖关系，当一个对象状态变化时，所有依赖者自动收到通知。

#### EventEmitter 实现

```typescript
// observer/event-emitter-observer.ts
type Observer<T> = (data: T) => void;

class Observable<T> {
  private observers = new Set<Observer<T>>();

  /** 订阅 */
  subscribe(observer: Observer<T>): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  /** 取消订阅 */
  unsubscribe(observer: Observer<T>): void {
    this.observers.delete(observer);
  }

  /** 通知所有观察者 */
  notify(data: T): void {
    for (const observer of this.observers) {
      observer(data);
    }
  }

  /** 清空所有观察者 */
  clear(): void {
    this.observers.clear();
  }
}

// 使用
class StockTicker extends Observable<{ symbol: string; price: number }> {
  private prices: Record<string, number> = {};

  updatePrice(symbol: string, price: number): void {
    this.prices[symbol] = price;
    this.notify({ symbol, price });
  }
}

const ticker = new StockTicker();

// 订阅者
const unsub1 = ticker.subscribe(({ symbol, price }) => {
  console.log(`[订阅者A] ${symbol}: $${price}`);
});

ticker.subscribe(({ symbol, price }) => {
  // 价格变化超过 5% 时告警
  // ... 实际业务逻辑
});

ticker.updatePrice("AAPL", 150.25);
ticker.updatePrice("GOOG", 2750.00);

unsub1(); // 取消订阅
ticker.updatePrice("AAPL", 151.00); // 订阅者A不再收到
```

#### 响应式示例（类似 RxJS Observable 简化版）

```typescript
// observer/rxjs-like.ts
// 简化版 Observable——链式操作
class SimpleObservable<T> {
  constructor(
    private producer: (observer: (value: T) => void) => () => void
  ) {}

  subscribe(next: (value: T) => void): { unsubscribe: () => void } {
    const unsubscribe = this.producer(next);
    return { unsubscribe };
  }

  /** 映射 */
  map<U>(fn: (value: T) => U): SimpleObservable<U> {
    return new SimpleObservable<U>((observer) => {
      return this.subscribe((value) => observer(fn(value))).unsubscribe;
    });
  }

  /** 过滤 */
  filter(predicate: (value: T) => boolean): SimpleObservable<T> {
    return new SimpleObservable<T>((observer) => {
      return this.subscribe((value) => {
        if (predicate(value)) observer(value);
      }).unsubscribe;
    });
  }
}

// 使用
function fromEvent(
  element: { addEventListener: Function; removeEventListener: Function },
  eventName: string
): SimpleObservable<Event> {
  return new SimpleObservable((observer) => {
    const handler = (e: Event) => observer(e);
    element.addEventListener(eventName, handler);
    return () => element.removeEventListener(eventName, handler);
  });
}

// 链式操作
const clicks = fromEvent(document, "click" as any)
  .map((e: Event) => (e as MouseEvent).clientX)
  .filter((x) => x > 200);

const subscription = clicks.subscribe((x) => {
  console.log(`点击在 X > 200: ${x}`);
});

// subscription.unsubscribe();
```

> **要点总结**
> - 观察者模式在 TypeScript 中通常用 EventEmitter 实现
> - 订阅函数返回取消订阅的函数是标准实践
> - RxJS 将观察者模式推向函数响应式编程（FRP）的高度

---

### 11.19 状态（State）

状态模式允许对象在内部状态改变时改变其行为，就像换了一个类一样。

#### 状态机 + 判别联合

```typescript
// state/order-state.ts
// 用类型系统编码状态机

// ---- 定义状态 ----
type OrderState =
  | { status: "pending" }
  | { status: "confirmed"; confirmedAt: Date }
  | { status: "shipped"; trackingNumber: string }
  | { status: "delivered"; deliveredAt: Date }
  | { status: "cancelled"; reason: string };

// ---- 订单类 ----
class Order {
  constructor(
    public readonly id: string,
    private state: OrderState = { status: "pending" }
  ) {}

  getState(): Readonly<OrderState> {
    return this.state;
  }

  /** 确认订单（pending → confirmed） */
  confirm(): void {
    if (this.state.status !== "pending") {
      throw new Error(`无法确认: 当前状态为 ${this.state.status}`);
    }
    this.state = { status: "confirmed", confirmedAt: new Date() };
  }

  /** 发货（confirmed → shipped） */
  ship(trackingNumber: string): void {
    if (this.state.status !== "confirmed") {
      throw new Error(`无法发货: 当前状态为 ${this.state.status}`);
    }
    this.state = { status: "shipped", trackingNumber };
  }

  /** 送达（shipped → delivered） */
  deliver(): void {
    if (this.state.status !== "shipped") {
      throw new Error(`无法送达: 当前状态为 ${this.state.status}`);
    }
    this.state = { status: "delivered", deliveredAt: new Date() };
  }

  /** 取消（可取消状态: pending | confirmed） */
  cancel(reason: string): void {
    if (this.state.status === "shipped" || this.state.status === "delivered") {
      throw new Error(`无法取消: 已发货或已送达`);
    }
    this.state = { status: "cancelled", reason };
  }

  /** 获取状态描述（类型收窄体现价值） */
  getDescription(): string {
    switch (this.state.status) {
      case "pending":
        return "等待确认";
      case "confirmed":
        return `已确认 (${this.state.confirmedAt.toLocaleDateString()})`;
      case "shipped":
        return `已发货，运单号: ${this.state.trackingNumber}`;
      case "delivered":
        return `已送达 (${this.state.deliveredAt.toLocaleDateString()})`;
      case "cancelled":
        return `已取消: ${this.state.reason}`;
    }
  }
}

// 使用
const order = new Order("ORD-001");
console.log(order.getDescription()); // 等待确认

order.confirm();
console.log(order.getDescription()); // 已确认

order.ship("SF-123456");
console.log(order.getDescription()); // 已发货，运单号: SF-123456

order.deliver();
console.log(order.getDescription()); // 已送达
```

> **要点总结**
> - 用判别联合（Discriminated Union）编码所有状态及其附加数据
> - 每个状态迁移在学校法中都有明确的前置条件检查
> - TypeScript 的 switch 穷尽检查确保你处理了所有状态
> - 适用于订单、工作流、游戏角色状态等场景

---

### 11.20 策略（Strategy）

策略模式定义一系列算法，把它们一个个封装起来，并使它们可以互相替换。

#### 接口策略

```typescript
// strategy/compression-strategy.ts
// 策略接口
interface CompressionStrategy {
  compress(data: string): string;
  decompress(data: string): string;
}

// 具体策略
class GzipCompression implements CompressionStrategy {
  compress(data: string): string {
    // 模拟 gzip 压缩
    console.log("使用 Gzip 压缩");
    return `gzip(${data})`;
  }

  decompress(data: string): string {
    console.log("使用 Gzip 解压");
    return data.replace(/^gzip\(([^)]+)\)$/, "$1");
  }
}

class DeflateCompression implements CompressionStrategy {
  compress(data: string): string {
    console.log("使用 Deflate 压缩");
    return `deflate(${data})`;
  }

  decompress(data: string): string {
    console.log("使用 Deflate 解压");
    return data.replace(/^deflate\(([^)]+)\)$/, "$1");
  }
}

class NoCompression implements CompressionStrategy {
  compress(data: string): string {
    console.log("不使用压缩");
    return data;
  }

  decompress(data: string): string {
    return data;
  }
}

// 上下文
class CompressionContext {
  constructor(private strategy: CompressionStrategy) {}

  setStrategy(strategy: CompressionStrategy): void {
    this.strategy = strategy;
  }

  compress(data: string): string {
    return this.strategy.compress(data);
  }

  decompress(data: string): string {
    return this.strategy.decompress(data);
  }
}

// 使用
const context = new CompressionContext(new NoCompression());

const data = "Hello, World!";

let compressed = context.compress(data);

context.setStrategy(new GzipCompression());
compressed = context.compress(data);
console.log(compressed);

context.setStrategy(new DeflateCompression());
compressed = context.compress(data);
console.log(compressed);
```

#### 函数策略（更简洁）

```typescript
// strategy/function-strategy.ts
// 使用函数类型作为策略——更简洁
type FilterStrategy<T> = (item: T) => boolean;

// 策略函数
const priceRangeFilter = (min: number, max: number): FilterStrategy<Product> => {
  return (product) => product.price >= min && product.price <= max;
};

const categoryFilter = (category: string): FilterStrategy<Product> => {
  return (product) => product.category === category;
};

const inStockFilter: FilterStrategy<Product> = (product) => product.stock > 0;

// 组合过滤
type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
};

function filterProducts(
  products: Product[],
  ...strategies: FilterStrategy<Product>[]
): Product[] {
  return products.filter((product) =>
    strategies.every((strategy) => strategy(product))
  );
}

// 使用
const products: Product[] = [
  { id: "1", name: "手机", price: 2999, category: "电子", stock: 10 },
  { id: "2", name: "书籍", price: 59, category: "教育", stock: 0 },
  { id: "3", name: "电脑", price: 5999, category: "电子", stock: 5 },
];

const result = filterProducts(
  products,
  priceRangeFilter(50, 5000),
  inStockFilter
);

console.log(result);
// [{ id: "1", name: "手机", ... }, ...]
```

> **要点总结**
> - 策略模式将算法的定义和使用分离
> - TypeScript 中既可以使用接口，也可以直接使用函数类型（更轻量）
> - 函数策略更函数式，适合逻辑简单的场景

---

### 11.21 模板方法（Template Method）

模板方法在抽象类中定义算法的骨架，将一些步骤延迟到子类中实现。

```typescript
// template-method/data-migrator.ts
// 抽象类——定义迁移骨架
abstract class DataMigrator {
  /** 模板方法——定义了迁移的算法骨架 */
  async migrate(): Promise<void> {
    console.log(`=== 开始 ${this.getMigrationName()} ===`);

    try {
      await this.beforeMigrate();
      const data = await this.extract();
      const transformed = this.transform(data);
      await this.load(transformed);
      await this.afterMigrate();
      console.log(`=== ${this.getMigrationName()} 完成 ===`);
    } catch (err) {
      await this.onError(err as Error);
      throw err;
    }
  }

  // 抽象步骤（子类必须实现）
  protected abstract getMigrationName(): string;
  protected abstract extract(): Promise<unknown[]>;
  protected abstract transform(data: unknown[]): unknown[];
  protected abstract load(data: unknown[]): Promise<void>;

  // 钩子（可选覆盖）
  protected async beforeMigrate(): Promise<void> {}
  protected async afterMigrate(): Promise<void> {}

  protected async onError(error: Error): Promise<void> {
    console.error(`迁移失败: ${error.message}`);
  }
}

// 具体迁移类
class CsvToDatabaseMigration extends DataMigrator {
  private batchSize = 100;

  protected getMigrationName(): string {
    return "CSV → 数据库迁移";
  }

  protected async extract(): Promise<unknown[]> {
    // 模拟读取 CSV
    console.log("读取 CSV 文件...");
    return [
      { id: 1, name: "Alice", email: "alice@example.com" },
      { id: 2, name: "Bob", email: "bob@example.com" },
    ];
  }

  protected transform(data: unknown[]): unknown[] {
    console.log(`转换 ${data.length} 条记录...`);
    return data.map((row: any) => ({
      ...row,
      email: row.email.toLowerCase(),
      created_at: new Date().toISOString(),
    }));
  }

  protected async load(data: unknown[]): Promise<void> {
    console.log(`分批写入数据库 (每批 ${this.batchSize} 条)...`);
    for (let i = 0; i < data.length; i += this.batchSize) {
      const batch = data.slice(i, i + this.batchSize);
      console.log(`  写入第 ${i / this.batchSize + 1} 批 (${batch.length} 条)`);
    }
  }

  protected async afterMigrate(): Promise<void> {
    console.log("记录迁移日志...");
  }
}

// 使用
async function main() {
  const migrator = new CsvToDatabaseMigration();
  await migrator.migrate();
}

main();
```

> **要点总结**
> - 模板方法在抽象类中定义不可变的算法骨架
> - 子类覆盖具体步骤，不能改变算法结构
> - 钩子方法提供可选的扩展点，如 `beforeMigrate`、`onError`

---

### 11.22 访问者（Visitor）

访问者模式将对元素的操作分离到独立的访问者类中，可以在不修改元素类的情况下添加新操作。

#### 双分派实现

```typescript
// visitor/file-visitor.ts
// 元素接口——接收访问者
interface FileElement {
  accept(visitor: FileVisitor): void;
}

// 具体元素
class TextFile implements FileElement {
  constructor(public readonly name: string, public readonly content: string) {}

  accept(visitor: FileVisitor): void {
    visitor.visitTextFile(this);
  }
}

class ImageFile implements FileElement {
  constructor(
    public readonly name: string,
    public readonly width: number,
    public readonly height: number
  ) {}

  accept(visitor: FileVisitor): void {
    visitor.visitImageFile(this);
  }
}

class Directory implements FileElement {
  constructor(
    public readonly name: string,
    public readonly children: FileElement[] = []
  ) {}

  accept(visitor: FileVisitor): void {
    visitor.visitDirectory(this);
  }
}

// 访问者接口
interface FileVisitor {
  visitTextFile(file: TextFile): void;
  visitImageFile(file: ImageFile): void;
  visitDirectory(dir: Directory): void;
}

// 具体访问者
class FileSizeCounter implements FileVisitor {
  private totalSize = 0;

  visitTextFile(file: TextFile): void {
    this.totalSize += file.content.length;
  }

  visitImageFile(file: ImageFile): void {
    this.totalSize += file.width * file.height * 4; // 估算
  }

  visitDirectory(dir: Directory): void {
    for (const child of dir.children) {
      child.accept(this);
    }
  }

  getTotalSize(): number {
    return this.totalSize;
  }
}

class FileLister implements FileVisitor {
  private indent = "";

  visitTextFile(file: TextFile): void {
    console.log(`${this.indent}📄 ${file.name}`);
  }

  visitImageFile(file: ImageFile): void {
    console.log(`${this.indent}🖼️ ${file.name} (${file.width}x${file.height})`);
  }

  visitDirectory(dir: Directory): void {
    console.log(`${this.indent}📁 ${dir.name}/`);
    this.indent += "  ";
    for (const child of dir.children) {
      child.accept(this);
    }
    this.indent = this.indent.slice(0, -2);
  }
}

// 使用
const root = new Directory("root", [
  new TextFile("readme.txt", "Hello"),
  new ImageFile("photo.jpg", 1920, 1080),
  new Directory("subdir", [
    new TextFile("notes.md", "Some notes here"),
    new ImageFile("icon.png", 64, 64),
  ]),
]);

const counter = new FileSizeCounter();
const lister = new FileLister();

root.accept(counter);
root.accept(lister);

console.log(`总大小: ${counter.getTotalSize()} bytes`);
```

#### 判别联合 + 模式匹配（更符合 TypeScript 风格）

```typescript
// visitor/discriminated-visitor.ts
// 使用判别联合——更声明式的访问者
type FileNode =
  | { type: "text"; name: string; content: string }
  | { type: "image"; name: string; width: number; height: number }
  | { type: "directory"; name: string; children: FileNode[] };

// 访问者模式用函数实现——更自然
function visitFile(
  node: FileNode,
  visitors: {
    text: (node: FileNode & { type: "text" }) => void;
    image: (node: FileNode & { type: "image" }) => void;
    directory: (node: FileNode & { type: "directory" }) => void;
  }
): void {
  switch (node.type) {
    case "text":
      visitors.text(node);
      break;
    case "image":
      visitors.image(node);
      break;
    case "directory":
      visitors.directory(node);
      for (const child of node.children) {
        visitFile(child, visitors);
      }
      break;
  }
}

// 使用
const fileTree: FileNode = {
  type: "directory",
  name: "root",
  children: [
    { type: "text", name: "readme.txt", content: "Hello" },
    { type: "image", name: "photo.jpg", width: 1920, height: 1080 },
  ],
};

visitFile(fileTree, {
  text: (node) => console.log(`📄 ${node.name}: ${node.content.length} bytes`),
  image: (node) =>
    console.log(`🖼️ ${node.name}: ${node.width}x${node.height}`),
  directory: (node) => console.log(`📁 ${node.name}/`),
});
```

> **要点总结**
> - 经典访问者通过"双分派"（accept → visit）实现
> - 在 TypeScript 中，判别联合 + 函数访问者更简洁自然
> - 访问者适用于需要对一组对象执行多种不相关操作的场景

---

## TypeScript 惯用模式

这些模式并非 GoF 经典模式，而是 TypeScript 类型系统带来的特有设计范式。

### 11.23 判别联合模式（Discriminated Unions）

判别联合（受歧视联合）是 TypeScript 最强大的类型建模工具之一。

```typescript
// discriminated-union/api-state.ts
// 类型安全的状态机
type AsyncState<T, E = Error> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: E };

// 使用 React/通用风格
function renderState<T, E>(state: AsyncState<T, E>): string {
  // switch 穷尽检查——如果新增状态类型，TypeScript 会报错
  switch (state.status) {
    case "idle":
      return "等待操作...";
    case "loading":
      return "加载中...";
    case "success":
      return `数据: ${JSON.stringify(state.data)}`;
    case "error":
      return `错误: ${state.error}`;
  }
}

// 网络请求的状态建模
type NetworkState =
  | { kind: "disconnected" }
  | { kind: "connecting"; server: string; retryCount: number }
  | { kind: "connected"; sessionId: string; latency: number }
  | { kind: "reconnecting"; server: string; retryCount: number; backoff: number }
  | { kind: "error"; message: string; canRetry: boolean };

function handleNetworkState(state: NetworkState): void {
  // 使用 switch + 穷尽检查
  switch (state.kind) {
    case "disconnected":
      console.log("未连接");
      break;
    case "connecting":
      console.log(`正在连接 ${state.server} (第 ${state.retryCount} 次尝试)`);
      break;
    case "connected":
      console.log(`已连接，会话: ${state.sessionId}`);
      break;
    case "reconnecting":
      console.log(`重连中... ${state.backoff}ms 后重试`);
      break;
    case "error":
      if (state.canRetry) {
        console.log(`可重试的错误: ${state.message}`);
      } else {
        console.error(`不可恢复的错误: ${state.message}`);
      }
      break;
  }
}
```

> **要点总结**
> - 共享的 `status` / `kind` / `type` 字段是区分不同类型状态的"判别式"
> - switch 的穷尽检查（exhaustive check）保证所有状态都被处理
> - 每个状态可以携带不同的附加数据，不会产生非法组合

---

### 11.24 Builder 模式与类型状态

利用泛型在类型级别追踪 Builder 的构建状态，让非法调用在编译期被阻止。

```typescript
// builder-type-state/request-builder.ts
// 类型级别的构建状态标记
type RequestMethod = "GET" | "POST" | "PUT" | "DELETE";

// 构建状态——编译期标记
interface RequestBuilderState {
  method?: "set" | "unset";
  url?: "set" | "unset";
  headers?: "set" | "unset";
  body?: "set" | "unset";
}

type InitialRequestState = {
  method: "unset";
  url: "unset";
  headers: "unset";
  body: "unset";
};

type RequestReady = {
  method: "set";
  url: "set";
};

// 最终请求类型
type BuildRequest = {
  method: RequestMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
};

export class RequestBuilder<S extends RequestBuilderState = InitialRequestState> {
  private data: BuildRequest = {
    method: "GET",
    url: "",
    headers: {},
  };

  /** 设置方法——类型安全的方法列表 */
  setMethod(method: RequestMethod): RequestBuilder<S & { method: "set" }> {
    this.data.method = method;
    return this as unknown as RequestBuilder<S & { method: "set" }>;
  }

  /** 设置 URL */
  setUrl(url: string): RequestBuilder<S & { url: "set" }> {
    this.data.url = url;
    return this as unknown as RequestBuilder<S & { url: "set" }>;
  }

  /** 设置请求头 */
  setHeaders(headers: Record<string, string>): RequestBuilder<S & { headers: "set" }> {
    this.data.headers = { ...this.data.headers, ...headers };
    return this as unknown as RequestBuilder<S & { headers: "set" }>;
  }

  /** 设置请求体 */
  setBody(body: unknown): RequestBuilder<S & { body: "set" }> {
    this.data.body = body;
    return this as unknown as RequestBuilder<S & { body: "set" }>;
  }

  /** 构建请求——只有 method 和 url 都已设置才可调用 */
  build(this: RequestBuilder<S & RequestReady>): BuildRequest {
    return { ...this.data };
  }
}

// 使用
const builder = new RequestBuilder();
// builder.build(); // ❌ 类型错误：method 和 url 未设置

const request = builder
  .setMethod("POST")
  .setUrl("https://api.example.com/users")
  .setHeaders({ "Content-Type": "application/json" })
  .setBody({ name: "Alice" })
  .build();

console.log(request);
// ✅ 编译通过，类型正确

// builder.setMethod("GET").build(); // ❌ 类型错误：url 未设置
```

> **要点总结**
> - 类型状态（Type State）让 Builder 的使用规则由编译器强制执行
> - 使用交叉类型在泛型参数上累积状态标记
> - 适合需要保证调用顺序或必填参数的 API 设计

---

### 11.25 Branded Type 模式（Nominal Typing）

TypeScript 的类型系统是结构化的（structural typing），这意味着如果两个类型结构相同，就认为是兼容的。但在很多业务场景中，我们需要名义类型（nominal typing）来区分不同含义的相同结构（例如 user ID 和 order ID 都是 string）。

Branded Type 通过添加一个"符号标记"来实现名义类型效果。

```typescript
// branded-types/index.ts
// ---- 基本 Branded Type ----
declare const __brand: unique symbol;

type Brand<T, B extends string> = T & { [__brand]: B };

// 定义业务类型
type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;
type Email = Brand<string, "Email">;

// 类型安全的函数
function getUserById(id: UserId): { id: UserId; name: string } {
  return { id, name: "Alice" };
}

function getOrderById(id: OrderId): { id: OrderId; total: number } {
  return { id, total: 99.99 };
}

// ---- 创建 branded 类型的工具函数 ----
function createUserId(id: string): UserId {
  // 运行时是普通 string，编译时是 UserId
  if (!/^\d+$/.test(id)) {
    throw new Error("用户 ID 必须是数字");
  }
  return id as UserId;
}

function createOrderId(id: string): OrderId {
  if (!id.startsWith("ORD-")) {
    throw new Error("订单 ID 必须以 ORD- 开头");
  }
  return id as OrderId;
}

// 不安全的转换需要显式标记
const rawId = "123";
// getUserById(rawId);   // ❌ 类型错误！string 不能赋值给 UserId
getUserById(rawId as UserId); // ⚠️ 显式断言，但应避免

const userId = createUserId("123");
const orderId = createOrderId("ORD-456");

getUserById(userId); // ✅ OK
// getUserById(orderId); // ❌ 类型错误！OrderId 不能赋值给 UserId

// ---- 实用场景：货币金额 ----
type USD = Brand<number, "USD">;
type EUR = Brand<number, "EUR">;
type JPY = Brand<number, "JPY">;

function createUSD(amount: number): USD {
  if (amount < 0) throw new Error("金额不能为负");
  return amount as USD;
}

function addMoney(a: USD, b: USD): USD {
  return (a + b) as USD;
}

const price = createUSD(99.99);
const tax = createUSD(8.50);
const total = addMoney(price, tax); // ✅ 类型安全

// const wrong = addMoney(price, 10 as EUR); // ❌ 类型错误！

// ---- 数据库实体 ID（更复杂的 Branded Type） ----
type EntityId<T extends string> = Brand<string, T>;

class Repository<TEntity extends { id: EntityId<string> }> {
  constructor(private entities: Map<string, TEntity>) {}

  getById(id: EntityId<string>): TEntity | undefined {
    return this.entities.get(id);
  }

  save(entity: TEntity): void {
    this.entities.set(entity.id, entity);
  }
}

// 类型安全的实体
type User = {
  id: EntityId<"User">;
  name: string;
  email: Email;
};

// ---- Zod + Branded Type 集成 ----
import { z } from "zod";

// 自定义 Zod 类型创建 Branded ID
function createBrandedSchema<T extends string>(brand: T) {
  return z.string().transform((val) => val as Brand<string, T>);
}

const UserIdSchema = createBrandedSchema("UserId");
const EmailSchema = z.string().email().transform((val) => val as Email);

type ValidatedUser = {
  id: UserId;
  email: Email;
};

const userResult = z
  .object({
    id: UserIdSchema,
    email: EmailSchema,
  })
  .safeParse({
    id: "42",
    email: "alice@example.com",
  });

if (userResult.success) {
  const user: ValidatedUser = userResult.data;
  console.log(user.id, user.email);
}
```

#### ISO 8601 日期字符串 Branded Type

```typescript
// branded-types/date-string.ts
type IsoDateString = Brand<string, "IsoDateString">;

function toIsoDateString(date: Date): IsoDateString {
  return date.toISOString() as IsoDateString;
}

function isExpired(expiresAt: IsoDateString): boolean {
  return new Date(expiresAt) < new Date();
}

const expiresAt = toIsoDateString(new Date("2025-01-01"));
console.log(isExpired(expiresAt));

// let normalString: string = expiresAt; // ⚠️ 可以赋值给 string
// let _: IsoDateString = "hello";       // ❌ string 不能赋值给 IsoDateString
```

> **要点总结**
> - Branded Type 通过在运行时透明的标记，在编译期阻止不同类型混用
> - 使用 `unique symbol` 声明的 `__brand` 属性保证品牌唯一性
> - 创建函数（如 `createUserId`）是 recommended 的工厂方法，同时做验证
> - 适合：用户/订单/产品 ID、货币类型、邮箱、日期字符串等业务基础类型
> - 与 Zod 等验证库结合使用，可以实现"验证通过即 branded"的安全模式

---

## 章节总结

设计模式是实践经验的高度抽象，而非教条。在 TypeScript 中：

1. **类型系统是第一生产力**：判别联合、泛型、条件类型让很多 GoF 模式在 TypeScript 中更安全、更简洁
2. **函数优先**：当函数类型足够表达时（如策略、访问者），优先用函数而非接口+类
3. **模块即单例**：ES Module 的导出机制天然满足单例需求，无需额外实现
4. **组合优于继承**：高阶函数装饰、Adapter 模式等体现了组合的力量
5. **类型级编程**：Branded Type、类型状态 Builder 展示了 TypeScript 类型系统的表达能力

> **推荐阅读**
> - 《Design Patterns: Elements of Reusable Object-Oriented Software》（GoF）
> - TypeScript 手册的"Type Manipulation"章节
> - 实际开源项目中寻找模式应用：如 NestJS（装饰器 + 依赖注入）、RxJS（观察者 + 迭代器）
