# 第 10 章：常见技术解决方案

> 目标读者：有 TypeScript 基础的前端/全栈开发者，希望了解如何将类型系统应用到真实项目常见场景中。

---

## 10.1 JWT 认证与授权

JWT（JSON Web Token）是目前最流行的无状态认证方案。TypeScript 可以帮助我们在 JWT 的签发、验证和中间件集成中做到类型安全。

### 类型安全的 Claims

首先定义 Claims 类型，确保 payload 的数据结构清晰可追溯：

```typescript
// auth/types.ts
export type UserRole = "admin" | "user" | "viewer";

export type JwtPayload = {
  sub: string;       // 用户 ID
  role: UserRole;
  permissions: string[];
};

export type JwtClaims = JwtPayload & {
  iat: number;       // 签发时间
  exp: number;       // 过期时间
  iss: string;       // 签发者
};
```

### 签发与验证

使用 `jose` 库（Web 标准兼容，推荐新项目使用）：

```typescript
// auth/jwt.ts
import { SignJWT, jwtVerify } from "jose";
import type { JwtPayload, JwtClaims } from "./types";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
const ISSUER = "my-app";

// 签发 Token（类型安全的 payload）
export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .setIssuer(ISSUER)
    .sign(SECRET);
}

// 验证 Token（类型安全的 claims）
export async function verifyToken(
  token: string
): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, SECRET, {
    issuer: ISSUER,
  });
  return payload as unknown as JwtClaims;
}
```

### Express 中间件

将验证逻辑封装为 Express 中间件，通过 `declare global` 扩展 `Request` 类型：

```typescript
// auth/middleware.ts
import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt";
import type { JwtClaims } from "./types";

// 扩展 Express 的 Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: JwtClaims;
    }
  }
}

// 认证中间件
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "缺少认证令牌" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const claims = await verifyToken(token);
    req.user = claims;
    next();
  } catch (err) {
    res.status(401).json({ error: "令牌无效或已过期" });
  }
}

// 角色授权中间件（高阶函数）
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "权限不足" });
      return;
    }
    next();
  };
}
```

### 使用示例

```typescript
// routes/admin.ts
import { Router } from "express";
import { authenticate, requireRole } from "../auth/middleware";

const router = Router();

router.get(
  "/admin/users",
  authenticate,
  requireRole("admin"),
  (req, res) => {
    // req.user 在这里是类型安全的 JwtClaims
    console.log(`当前操作者: ${req.user!.sub}`);
    res.json({ users: [] });
  }
);
```

> **要点总结**
> - 明确定义 `JwtPayload` 和 `JwtClaims` 类型，区分输入和输出
> - 使用 `declare global` 扩展框架的 Request 类型，获得完整的类型提示
> - 中间件采用"认证 + 授权"分离模式，职责清晰
> - `jose` 库相比 `jsonwebtoken` 更现代化，支持 Web API 标准

---

## 10.2 限流（Rate Limiting）

限流是保护后端服务免受滥用或突发流量冲击的关键手段。这里实现两种主流算法：令牌桶和滑动窗口。

### 令牌桶算法

令牌桶允许一定程度的突发流量，适合大部分 API 场景：

```typescript
// rate-limiter/token-bucket.ts
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number,   // 每秒恢复的令牌数
    private readonly refillInterval: number = 1000 // 恢复间隔(ms)
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = (elapsed / this.refillInterval) * this.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /** 尝试消耗一个令牌，成功返回 true */
  tryConsume(count: number = 1): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /** 当前可用令牌数 */
  get availableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}
```

### 滑动窗口算法

滑动窗口比固定窗口更精确，能有效避免边界突刺：

```typescript
// rate-limiter/sliding-window.ts
export class SlidingWindow {
  private timestamps: Map<string, number[]> = new Map();

  constructor(
    private readonly windowMs: number,   // 窗口大小（毫秒）
    private readonly maxRequests: number  // 窗口内最大请求数
  ) {}

  /** 检查是否允许当前请求 */
  allow(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // 获取该 key 的请求记录，过滤掉窗口外的记录
    const records = (this.timestamps.get(key) || [])
      .filter((ts) => ts > windowStart);

    if (records.length >= this.maxRequests) {
      this.timestamps.set(key, records);
      return false;
    }

    records.push(now);
    this.timestamps.set(key, records);
    return true;
  }

  /** 清理过期记录（定时调用） */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, records] of this.timestamps) {
      const filtered = records.filter((ts) => ts > windowStart);
      if (filtered.length === 0) {
        this.timestamps.delete(key);
      } else {
        this.timestamps.set(key, filtered);
      }
    }
  }
}
```

### Express 集成中间件

```typescript
// rate-limiter/express-middleware.ts
import type { Request, Response, NextFunction } from "express";
import { TokenBucket } from "./token-bucket";

// 每个 IP 一个令牌桶
const buckets = new Map<string, TokenBucket>();

const GLOBAL_BUCKET = new TokenBucket(100, 10); // 100 令牌上限，每秒恢复 10 个

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const key = ip;

  if (!buckets.has(key)) {
    buckets.set(key, new TokenBucket(60, 5)); // 每个 IP 60 令牌上限，每秒恢复 5 个
  }

  const bucket = buckets.get(key)!;

  if (!bucket.tryConsume()) {
    res.status(429).json({
      error: "请求过于频繁，请稍后再试",
      retryAfter: Math.ceil(1000 / bucket["refillRate"]),
    });
    return;
  }

  next();
}
```

> **要点总结**
> - 令牌桶适合允许突发流量的场景，实现简单
> - 滑动窗口精确度更高，适合严格的限流需求
> - 生产环境建议使用 `express-rate-limit` 或 Redis 集群方案
> - 返回 `429` 状态码并附带重试时间，方便客户端处理

---

## 10.3 配置管理

类型安全的配置管理是 TypeScript 工程的基石。使用 `zod` 验证环境变量，让配置错误在启动时就被发现。

### 定义配置 Schema

```typescript
// config/schema.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // 服务器
  PORT: z.coerce.number().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),

  // 数据库
  DATABASE_URL: z.string().url(),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),

  // JWT
  JWT_SECRET: z.string().min(32, "JWT_SECRET 至少 32 个字符"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // Redis
  REDIS_URL: z.string().url().optional(),

  // 日志
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

// 推导出类型安全的配置接口
export type EnvConfig = z.infer<typeof envSchema>;
```

### 类型安全的配置对象

```typescript
// config/index.ts
import "dotenv/config";
import { envSchema, type EnvConfig } from "./schema";

class AppConfig {
  private static instance: AppConfig;
  private config!: EnvConfig;

  private constructor() {
    this.load();
  }

  static getInstance(): AppConfig {
    if (!AppConfig.instance) {
      AppConfig.instance = new AppConfig();
    }
    return AppConfig.instance;
  }

  /** 加载并验证环境变量 */
  private load(): void {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
      console.error("❌ 配置验证失败:");
      for (const issue of result.error.issues) {
        console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }

    this.config = result.data;
  }

  /** 获取完整配置 */
  get all(): EnvConfig {
    return this.config;
  }

  /** 获取单个配置项（类型安全） */
  get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
    return this.config[key];
  }

  /** 是否为开发环境 */
  get isDev(): boolean {
    return this.config.NODE_ENV === "development";
  }

  /** 是否为生产环境 */
  get isProd(): boolean {
    return this.config.NODE_ENV === "production";
  }
}

export const config = AppConfig.getInstance();
```

### 多环境支持

```typescript
// config/env.ts
import { z } from "zod";

// 各环境特有的配置
const envOverrides: Record<string, Partial<Record<string, unknown>>> = {
  development: {
    LOG_LEVEL: "debug",
    DB_POOL_MIN: 1,
    DB_POOL_MAX: 5,
  },
  test: {
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://localhost:5432/myapp_test",
  },
  production: {
    LOG_LEVEL: "info",
    DB_POOL_MIN: 5,
    DB_POOL_MAX: 20,
  },
};

// 合并环境覆盖
export function loadEnvConfig(): Record<string, unknown> {
  const nodeEnv = process.env.NODE_ENV || "development";
  const baseConfig: Record<string, unknown> = { ...process.env };

  const overrides = envOverrides[nodeEnv];
  if (overrides) {
    Object.assign(baseConfig, overrides);
  }

  return baseConfig;
}
```

> **要点总结**
> - 使用 `zod` 做运行时验证，启动即报错，避免运行时出现意外
> - `z.infer` 从 schema 推导类型，保持单一数据源
> - 单例模式确保全局只有一份配置对象
> - 多环境配置通过默认值 + 环境覆盖实现，清晰可控

---

## 10.4 结构化日志

结构化日志（Structured Logging）以 JSON 格式输出日志，便于日志平台（ELK、Datadog 等）的采集与分析。

### 日志类型定义

```typescript
// logger/types.ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: Error;
};
```

### 结构化 Logger 实现

这里模拟 pino/winston 的核心行为，支持上下文追踪：

```typescript
// logger/index.ts
import type { LogLevel, LogContext, LogEntry } from "./types";

type Transport = (entry: LogEntry) => void;

export class Logger {
  private context: LogContext = {};
  private transports: Transport[] = [];

  constructor(
    private readonly name: string,
    private readonly minLevel: LogLevel = "info"
  ) {
    // 默认输出到控制台
    this.addTransport((entry) => {
      const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${this.name}]`;
      const base = `${prefix} ${entry.message}`;

      if (entry.error) {
        console[entry.level === "error" ? "error" : "log"](
          base,
          JSON.stringify(entry.context || {}),
          entry.error
        );
      } else if (entry.context && Object.keys(entry.context).length > 0) {
        console[entry.level === "error" ? "error" : "log"](
          base,
          JSON.stringify(entry.context)
        );
      } else {
        console[entry.level === "error" ? "error" : "log"](base);
      }
    });
  }

  /** 添加日志传输通道 */
  addTransport(transport: Transport): void {
    this.transports.push(transport);
  }

  /** 创建子 Logger，继承父级上下文 */
  child(extraContext: LogContext): Logger {
    const child = new Logger(this.name, this.minLevel);
    child.context = { ...this.context, ...extraContext };
    child.transports = this.transports; // 共享 transports
    return child;
  }

  /** 设置上下文（如请求 ID） */
  setContext(ctx: LogContext): void {
    this.context = { ...this.context, ...ctx };
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    if (levels.indexOf(level) < levels.indexOf(this.minLevel)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: { ...this.context, ...context },
      error,
    };

    for (const transport of this.transports) {
      transport(entry);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.log("error", message, context, error);
  }
}

// 创建默认实例
export const logger = new Logger("app", (process.env.LOG_LEVEL as LogLevel) || "info");
```

### 使用示例与请求追踪

```typescript
// 使用示例
import { logger } from "./logger";

// 基本使用
logger.info("服务启动成功", { port: 3000 });

// 子 Logger + 请求上下文
function handleRequest(requestId: string) {
  const reqLogger = logger.child({ requestId });

  reqLogger.info("收到请求");

  try {
    // 处理业务...
    reqLogger.debug("数据库查询完成", { duration: 42 });
  } catch (err) {
    reqLogger.error("请求处理失败", err as Error, { userId: 123 });
  }
}
```

> **要点总结**
> - 结构化日志以 JSON 格式输出，便于机器解析
> - 使用 `child()` 创建子 Logger 实现上下文透传，避免手动传递
> - 日志级别控制（debug → info → warn → error）避免开发日志刷爆生产
> - 生产环境推荐使用 `pino`（性能最佳）或 `winston`（生态完善）

---

## 10.5 表单验证

表单验证是前端最常见的需求之一。使用 `zod` 可以同时获得运行时验证和类型推导。

### Zod Schema 验证

```typescript
// validation/user-form.ts
import { z } from "zod";

// 定义表单 schema
export const userFormSchema = z.object({
  username: z
    .string()
    .min(3, "用户名至少 3 个字符")
    .max(20, "用户名最多 20 个字符")
    .regex(/^[a-zA-Z0-9_]+$/, "用户名只能包含字母、数字和下划线"),

  email: z
    .string()
    .email("请输入有效的邮箱地址"),

  age: z
    .number()
    .int("年龄必须是整数")
    .min(0, "年龄不能为负")
    .max(150, "年龄不能超过 150"),

  password: z
    .string()
    .min(8, "密码至少 8 个字符")
    .regex(/[A-Z]/, "密码必须包含至少一个大写字母")
    .regex(/[a-z]/, "密码必须包含至少一个小写字母")
    .regex(/[0-9]/, "密码必须包含至少一个数字"),

  confirmPassword: z.string(),

  role: z.enum(["admin", "user", "viewer"]).default("user"),

  tags: z.array(z.string()).max(5, "最多 5 个标签").optional(),
});

// 用 refine 做跨字段验证
export const userFormSchemaWithConfirm = userFormSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "两次密码不一致",
    path: ["confirmPassword"],
  }
);

export type UserFormData = z.infer<typeof userFormSchemaWithConfirm>;
```

### 自定义验证器

```typescript
// validation/custom-validators.ts
import { z } from "zod";

// 手机号验证（中国）
export const phoneSchema = z.string().refine(
  (val) => /^1[3-9]\d{9}$/.test(val),
  { message: "请输入有效的手机号" }
);

// 异步验证（如检查用户名是否已存在）
export const usernameSchema = z.string().superRefine(async (val, ctx) => {
  if (val.length < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 3,
      type: "string",
      inclusive: true,
      message: "用户名至少 3 个字符",
    });
    return;
  }

  // 模拟异步查重
  const exists = await checkUsernameExists(val);
  if (exists) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "该用户名已被注册",
    });
  }
});

async function checkUsernameExists(username: string): Promise<boolean> {
  // 实际开发中调用 API
  return ["admin", "root", "test"].includes(username);
}

// 自定义验证函数
function isValidUrl(val: string): boolean {
  try {
    new URL(val);
    return true;
  } catch {
    return false;
  }
}

export const urlSchema = z.string().refine(isValidUrl, "请输入有效的 URL");
```

### 国际化的错误消息

```typescript
// validation/i18n.ts
import { z } from "zod";

type Locale = "zh-CN" | "en-US";

const messages: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    required: "此项为必填",
    invalid_email: "请输入有效的邮箱地址",
    too_short: "最少需要 {minimum} 个字符",
    too_long: "最多允许 {maximum} 个字符",
  },
  "en-US": {
    required: "This field is required",
    invalid_email: "Please enter a valid email address",
    too_short: "Must be at least {minimum} characters",
    too_long: "Must be at most {maximum} characters",
  },
};

// 自定义错误映射
function formatZodError(error: z.ZodError, locale: Locale = "zh-CN"): Record<string, string> {
  const result: Record<string, string> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (result[path]) continue; // 只保留第一个错误

    switch (issue.code) {
      case z.ZodIssueCode.invalid_type:
        result[path] = messages[locale].required;
        break;
      case z.ZodIssueCode.invalid_string:
        if (issue.validation === "email") {
          result[path] = messages[locale].invalid_email;
        }
        break;
      case z.ZodIssueCode.too_small:
        result[path] = messages[locale].too_short.replace(
          "{minimum}",
          String(issue.minimum)
        );
        break;
      case z.ZodIssueCode.too_big:
        result[path] = messages[locale].too_long.replace(
          "{maximum}",
          String(issue.maximum)
        );
        break;
      default:
        result[path] = issue.message;
    }
  }

  return result;
}

// 使用示例
function validateForm(data: unknown, locale: Locale = "zh-CN") {
  const schema = z.object({
    email: z.string().email(),
    username: z.string().min(3).max(20),
  });

  const result = schema.safeParse(data);

  if (!result.success) {
    return {
      success: false as const,
      errors: formatZodError(result.error, locale),
    };
  }

  return { success: true as const, data: result.data };
}
```

> **要点总结**
> - `z.infer` 从 schema 自动推导类型，确保类型和验证逻辑同步
> - `refine` 用于跨字段验证，`superRefine` 支持异步验证
> - 自定义错误消息可以封装为 i18n 方案，方便多语言
> - `safeParse` 优于 `parse`，避免 try-catch 的样板代码

---

## 10.6 状态管理

前端应用的状态管理有多种模式。这里分别实现简单的 Store、发布订阅模式和 Proxy 响应式方案。

### 简单状态管理

```typescript
// state-manager/simple-store.ts
type Listener<T> = (state: T) => void;

export class SimpleStore<T extends Record<string, unknown>> {
  private state: T;
  private listeners: Set<Listener<T>> = new Set();

  constructor(initialState: T) {
    this.state = { ...initialState };
  }

  /** 获取当前状态 */
  getState(): Readonly<T> {
    return Object.freeze({ ...this.state });
  }

  /** 更新状态（浅合并） */
  setState(partial: Partial<T>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  /** 订阅状态变化 */
  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }

  /** 转换（类似 Redux reducer） */
  update(updater: (prev: T) => T): void {
    this.state = updater(this.state);
    this.notify();
  }
}

// 使用示例
const store = new SimpleStore({ count: 0, name: "app" });

const unsubscribe = store.subscribe((state) => {
  console.log("状态更新:", state);
});

store.setState({ count: 1 }); // 状态更新: { count: 1, name: "app" }
store.update((prev) => ({ ...prev, count: prev.count + 1 }));
unsubscribe();
```

### 发布订阅模式（EventEmitter）

```typescript
// state-manager/event-emitter.ts
type EventHandler = (...args: unknown[]) => void;

export class EventEmitter<T extends Record<string, unknown[]>> {
  private handlers = new Map<keyof T, Set<EventHandler>>();

  /** 订阅事件 */
  on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);

    return () => this.handlers.get(event)?.delete(handler as EventHandler);
  }

  /** 一次性订阅 */
  once<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void {
    const wrapper = (...args: T[K]) => {
      handler(...args);
      this.off(event, wrapper as EventHandler);
    };
    this.on(event, wrapper as EventHandler);
  }

  /** 取消订阅 */
  off<K extends keyof T>(event: K, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /** 触发事件 */
  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    this.handlers.get(event)?.forEach((handler) => handler(...args));
  }

  /** 清除所有订阅 */
  clear(): void {
    this.handlers.clear();
  }
}

// 使用示例
type AppEvents = {
  userLogin: [userId: string, role: string];
  userLogout: [userId: string];
  error: [message: string, code: number];
};

const bus = new EventEmitter<AppEvents>();

bus.on("userLogin", (userId, role) => {
  console.log(`用户 ${userId} 以 ${role} 身份登录`);
});

bus.emit("userLogin", "u001", "admin");
```

### Proxy 响应式状态

```typescript
// state-manager/reactive.ts
type ReactiveListener<T> = (path: string, value: unknown, oldValue: unknown) => void;

export function reactive<T extends Record<string, unknown>>(
  target: T,
  onChange?: ReactiveListener<T>
): T {
  const listeners = new Set<ReactiveListener<T>>();

  if (onChange) {
    listeners.add(onChange);
  }

  function notify(path: string, value: unknown, oldValue: unknown): void {
    for (const listener of listeners) {
      listener(path, value, oldValue);
    }
  }

  function createProxy(obj: Record<string, unknown>, basePath = ""): Record<string, unknown> {
    return new Proxy(obj, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);

        // 如果是对象，递归创建 Proxy（惰性代理）
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return createProxy(
            value as Record<string, unknown>,
            basePath ? `${basePath}.${String(prop)}` : String(prop)
          );
        }

        // 数组特殊处理
        if (Array.isArray(value)) {
          return new Proxy(value, {
            set(target, idx, newVal) {
              const oldVal = Reflect.get(target, idx);
              const result = Reflect.set(target, idx, newVal);
              notify(`${basePath}.${String(prop)}[${String(idx)}]`, newVal, oldVal);
              return result;
            },
          });
        }

        return value;
      },

      set(target, prop, value) {
        const oldValue = Reflect.get(target, prop);
        const result = Reflect.set(target, prop, value);

        const path = basePath ? `${basePath}.${String(prop)}` : String(prop);
        notify(path, value, oldValue);

        return result;
      },
    });
  }

  return createProxy(target) as T;
}

// 使用示例
const state = reactive({
  user: { name: "Alice", age: 25 },
  items: [] as string[],
});

// 监听变化
state as unknown as Record<string, unknown>; // 类型擦除，仅用于演示

// 深度监听
const user = state.user;
user.name = "Bob"; // 触发: user.name: Bob -> Alice

// 数组操作
state.items = ["a"] as unknown as [];
```

> **要点总结**
> - 简单 Store 适合中小型应用，API 简洁
> - EventEmitter 模式适用于跨组件通信，类型参数让事件签名安全
> - Proxy 响应式可以实现深度监听（类似 Vue 3 的 reactivity）
> - 生产环境建议使用 Zustand（轻量）或 Pinia（Vue）/ Redux Toolkit（React）

---

## 10.7 API 集成与类型安全

类型安全的 API 客户端让前后端接口契约在编译期就可被检查。

### 类型定义

```typescript
// api/types.ts
/** API 响应基础结构 */
export type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};

/** 分页参数 */
export type PaginationParams = {
  page: number;
  pageSize: number;
};

/** 分页响应 */
export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** API 错误 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

### 类型安全的 Fetch 封装

```typescript
// api/client.ts
import type { ApiResponse } from "./types";
import { ApiError } from "./types";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

type RequestOptions = {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  timeout?: number;
};

export class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, defaultHeaders: Record<string, string> = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...defaultHeaders,
    };
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      method = "GET",
      headers = {},
      body,
      params,
      signal,
      timeout = 10000,
    } = options;

    // 超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const combinedSignal = signal
      ? combineAbortSignals(signal, controller.signal)
      : controller.signal;

    try {
      const response = await fetch(this.buildUrl(path, params), {
        method,
        headers: { ...this.defaultHeaders, ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: combinedSignal,
      });

      const result: ApiResponse<T> = await response.json();

      if (!response.ok || result.code !== 0) {
        throw new ApiError(
          response.status,
          `ERR_${response.status}`,
          result.message || "请求失败",
          result.data
        );
      }

      return result.data;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      if ((err as Error).name === "AbortError") {
        throw new ApiError(408, "TIMEOUT", "请求超时");
      }

      throw new ApiError(0, "NETWORK_ERROR", "网络异常，请检查连接");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 类型安全的 HTTP 方法
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "PUT", body });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }
}

// 合并多个 AbortSignal
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }

  return controller.signal;
}
```

### 类型安全的业务 API

```typescript
// api/user-api.ts
import { ApiClient } from "./client";
import type { PaginatedResponse, PaginationParams } from "./types";

// 业务实体类型
export type User = {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
};

export type CreateUserDto = {
  username: string;
  email: string;
  password: string;
  role?: "admin" | "user";
};

export type UpdateUserDto = Partial<CreateUserDto>;

// 类型安全的业务 API
class UserApi {
  constructor(private client: ApiClient) {}

  /** 获取用户列表 */
  list(params?: PaginationParams & { role?: string }): Promise<PaginatedResponse<User>> {
    return this.client.get("/users", { params });
  }

  /** 获取单个用户 */
  getById(id: string): Promise<User> {
    return this.client.get(`/users/${id}`);
  }

  /** 创建用户 */
  create(dto: CreateUserDto): Promise<User> {
    return this.client.post("/users", dto);
  }

  /** 更新用户 */
  update(id: string, dto: UpdateUserDto): Promise<User> {
    return this.client.put(`/users/${id}`, dto);
  }

  /** 删除用户 */
  delete(id: string): Promise<void> {
    return this.client.delete(`/users/${id}`);
  }
}

// 使用示例
const api = new ApiClient("https://api.example.com", {
  Authorization: `Bearer ${localStorage.getItem("token")}`,
});

const userApi = new UserApi(api);

async function demo() {
  try {
    const users = await userApi.list({ page: 1, pageSize: 20, role: "admin" });
    console.log(`共 ${users.total} 个管理员`);

    const newUser = await userApi.create({
      username: "newuser",
      email: "new@example.com",
      password: "SecurePass1",
    });

    console.log("创建成功:", newUser.id);
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`API 错误 [${err.code}]: ${err.message}`);
    }
  }
}
```

> **要点总结**
> - Fetch 封装统一处理超时、错误、认证等横切关注点
> - 类型参数让每个 API 方法的返回类型都是确定的
> - 业务 API 类进一步封装路径和参数，调用方无需关心 URL 拼接
> - `ApiError` 类让错误处理集中且类型安全

---

## 10.8 分页与排序

### 基于游标的分页

游标分页（Cursor-based Pagination）相比传统的 offset 分页更稳定，适合大量数据和实时更新的场景：

```typescript
// pagination/cursor.ts
/** 游标编码（Base64 编码，避免暴露内部 ID） */
function encodeCursor(value: string): string {
  return Buffer.from(value).toString("base64");
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, "base64").toString("utf-8");
}

/** 排序方向 */
export type SortDirection = "asc" | "desc";

/** 排序字段定义 */
export type SortField = {
  field: string;
  direction: SortDirection;
};

/** 游标分页请求参数 */
export type CursorPaginationParams = {
  cursor?: string;        // 上次返回的游标
  limit: number;          // 每页数量
  sort?: SortField[];     // 排序字段
};

/** 游标分页响应 */
export type CursorPaginatedResponse<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** 游标分页工具函数 */
export function createCursorPagination<T extends Record<string, unknown>>() {
  return {
    /** 从请求参数解析分页参数 */
    parse(params: Record<string, string | undefined>): CursorPaginationParams {
      return {
        cursor: params.cursor,
        limit: Math.min(Number(params.limit) || 20, 100),
        sort: params.sort
          ? [{ field: params.sort, direction: (params.order as SortDirection) || "asc" }]
          : [{ field: "id", direction: "desc" }],
      };
    },

    /** 从最后一条记录生成下一页游标 */
    getCursor(item: T, sortFields: SortField[]): string {
      // 使用排序字段的组合值作为游标
      const cursorValue = sortFields
        .map((sf) => String(item[sf.field] ?? ""))
        .join("|");
      return encodeCursor(cursorValue);
    },

    /** 构建下一页的查询条件 */
    buildQuery(params: CursorPaginationParams): {
      where: Record<string, unknown>;
      orderBy: Record<string, SortDirection>;
      take: number;
    } {
      const sortFields = params.sort || [{ field: "id", direction: "desc" as const }];
      const orderBy: Record<string, SortDirection> = {};

      for (const sf of sortFields) {
        orderBy[sf.field] = sf.direction;
      }

      let where: Record<string, unknown> = {};

      if (params.cursor) {
        const decoded = decodeCursor(params.cursor);
        const cursorValues = decoded.split("|");

        // 构建游标条件（复合排序时用 OR 连接）
        const cursorConditions = sortFields.map((sf, idx) => ({
          [sf.field]: {
            [sf.direction === "asc" ? "gt" : "lt"]: cursorValues[idx],
          },
        }));

        // 简化处理：仅支持单字段游标
        where = cursorConditions[0] || {};
      }

      return {
        where,
        orderBy,
        take: params.limit + 1, // 多取一条判断 hasMore
      };
    },

    /** 格式化响应 */
    formatResponse<T>(
      items: T[],
      limit: number,
      sortFields: SortField[]
    ): CursorPaginatedResponse<T> {
      const hasMore = items.length > limit;
      const resultItems = hasMore ? items.slice(0, limit) : items;
      const lastItem = resultItems[resultItems.length - 1];

      return {
        items: resultItems,
        nextCursor: lastItem ? this.getCursor(lastItem, sortFields) : null,
        hasMore,
      };
    },
  };
}
```

### 类型安全的分页参数（通用方案）

同时支持游标和 offset 两种分页方式：

```typescript
// pagination/types.ts
/** Offset 分页参数 */
export type OffsetPaginationParams = {
  page: number;
  pageSize: number;
};

/** 分页参数（联合类型） */
export type PaginationParams =
  | { type: "offset"; page: number; pageSize: number }
  | { type: "cursor"; cursor?: string; limit: number };

/** 分页元数据 */
export type PaginationMeta =
  | {
      type: "offset";
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }
  | {
      type: "cursor";
      nextCursor: string | null;
      hasMore: boolean;
    };

/** 通用分页响应 */
export type PaginatedResult<T> = {
  items: T[];
  pagination: PaginationMeta;
};

/** 排序参数 */
export type SortParams = {
  field: string;
  direction: "asc" | "desc";
};

/** 完整的查询参数 */
export type QueryParams = {
  pagination: PaginationParams;
  sort?: SortParams[];
  filters?: Record<string, unknown>;
};
```

> **要点总结**
> - 游标分页比 offset 分页更稳定，适合实时更新的数据集
> - 游标使用 Base64 编码可避免暴露内部 ID
> - 多取一条数据 (`limit + 1`) 是判断 `hasMore` 的常用技巧
> - 使用判别联合类型让 offset 和 cursor 两种分页模式互斥清晰

---

## 10.9 缓存策略

### 简单 Map 缓存

```typescript
// cache/map-cache.ts
export class MapCache<K, V> {
  private cache = new Map<K, V>();

  /** 获取缓存值 */
  get(key: K): V | undefined {
    return this.cache.get(key);
  }

  /** 设置缓存值 */
  set(key: K, value: V): void {
    this.cache.set(key, value);
  }

  /** 检查是否存在 */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /** 删除缓存 */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
  }

  /** 获取缓存大小 */
  get size(): number {
    return this.cache.size;
  }
}
```

### TTL 缓存（带过期时间）

```typescript
// cache/ttl-cache.ts
type CacheEntry<V> = {
  value: V;
  expiresAt: number;
};

export class TtlCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly defaultTtlMs: number = 60_000, // 默认 60 秒
    cleanupIntervalMs: number = 30_000 // 每 30 秒清理过期项
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
  }

  /** 获取缓存值（如果未过期） */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /** 设置缓存值，可指定单独的 TTL */
  set(key: K, value: V, ttlMs?: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  /** 获取或设置缓存（"先查缓存，没有再计算"模式） */
  getOrSet(key: K, factory: () => V, ttlMs?: number): V {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /** 删除缓存 */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
  }

  /** 清理过期条目 */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /** 销毁（释放定时器） */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }
}
```

### 装饰器缓存

使用 TypeScript 装饰器语法实现方法级缓存：

```typescript
// cache/decorator.ts
import { TtlCache } from "./ttl-cache";

// 需要启用 experimentalDecorators
function Cacheable(ttlMs?: number) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value;
    const cache = new TtlCache<string, unknown>();

    descriptor.value = function (...args: unknown[]) {
      const key = `${propertyKey}:${JSON.stringify(args)}`;

      return cache.getOrSet(key, () => {
        return originalMethod.apply(this, args);
      }, ttlMs);
    };

    return descriptor;
  };
}

// 使用示例
class UserService {
  @Cacheable(5000) // 缓存 5 秒
  async getUser(id: string): Promise<{ name: string }> {
    // 模拟数据库查询
    console.log(`查询数据库: ${id}`);
    return { name: `User ${id}` };
  }
}

// 注意：装饰器缓存需要测试确认 this 绑定正确
```

### 缓存失效策略

```typescript
// cache/invalidation.ts
type CacheKey = string;
type CacheTag = string;

/**
 * 基于标签的缓存失效
 * 类似 Redis 的 tag 机制，通过标签批量失效相关缓存
 */
export class TaggedCache<V> {
  private cache = new Map<CacheKey, { value: V; tags: Set<CacheTag> }>();
  private tagIndex = new Map<CacheTag, Set<CacheKey>>();

  /** 设置缓存并关联标签 */
  set(key: CacheKey, value: V, tags: CacheTag[] = []): void {
    const tagSet = new Set(tags);

    // 更新标签索引
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(key);
    }

    this.cache.set(key, { value, tags: tagSet });
  }

  /** 获取缓存 */
  get(key: CacheKey): V | undefined {
    return this.cache.get(key)?.value;
  }

  /** 按标签批量失效 */
  invalidateByTag(tag: CacheTag): void {
    const keys = this.tagIndex.get(tag);
    if (!keys) return;

    for (const key of keys) {
      this.cache.delete(key);
    }

    this.tagIndex.delete(tag);
  }

  /** 按多个标签失效（满足任一标签即失效） */
  invalidateByTags(tags: CacheTag[]): void {
    for (const tag of tags) {
      this.invalidateByTag(tag);
    }
  }

  /** 删除特定 key */
  delete(key: CacheKey): void {
    const entry = this.cache.get(key);
    if (entry) {
      for (const tag of entry.tags) {
        this.tagIndex.get(tag)?.delete(key);
      }
      this.cache.delete(key);
    }
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear();
    this.tagIndex.clear();
  }
}

// 使用示例
const cache = new TaggedCache<unknown>();

// 缓存用户数据，打上相关标签
cache.set("user:1", { id: 1, name: "Alice" }, ["user", "role:admin"]);
cache.set("user:2", { id: 2, name: "Bob" }, ["user", "role:user"]);

// 角色变更时，失效该角色所有用户的缓存
function onRoleChanged(role: string) {
  cache.invalidateByTag(`role:${role}`);
  console.log(`已失效 role:${role} 相关缓存`);
}
```

> **要点总结**
> - 简单场景用 Map 缓存即可，不需要额外依赖
> - TTL 缓存通过定时清理避免内存泄漏
> - 基于标签的失效策略适合复杂业务场景的缓存联动
> - 生产环境建议使用 Redis 或 Memcached 做分布式缓存

---

## 10.10 错误处理与错误边界

良好的错误处理架构是健壮应用的基石。

### 自定义错误类

```typescript
// errors/app-error.ts
/** 应用基础错误 */
export class AppError extends Error {
  public readonly timestamp: string;

  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.timestamp = new Date().toISOString();

    // 确保 instanceof 正常工作（TypeScript 目标 ES2015+ 时）
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 业务错误 */
export class BusinessError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 400, details);
    this.name = "BusinessError";
  }
}

/** 认证错误 */
export class AuthenticationError extends AppError {
  constructor(message = "请先登录") {
    super("UNAUTHORIZED", message, 401);
    this.name = "AuthenticationError";
  }
}

/** 授权错误 */
export class AuthorizationError extends AppError {
  constructor(message = "权限不足") {
    super("FORBIDDEN", message, 403);
    this.name = "AuthorizationError";
  }
}

/** 资源不存在 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      "NOT_FOUND",
      id ? `${resource} #${id} 不存在` : `${resource} 不存在`,
      404
    );
    this.name = "NotFoundError";
  }
}

/** 验证错误 */
export class ValidationError extends AppError {
  public readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>) {
    super("VALIDATION_ERROR", "输入验证失败", 422);
    this.name = "ValidationError";
    this.errors = errors;
  }
}
```

### 错误链

```typescript
// errors/error-chain.ts
import { AppError } from "./app-error";

/** 包装底层错误到应用错误 */
export function wrapError(error: unknown, context?: string): AppError {
  if (error instanceof AppError) {
    // 附加上下文信息
    if (context) {
      error.message = `${context}: ${error.message}`;
    }
    return error;
  }

  if (error instanceof Error) {
    return new AppError(
      "INTERNAL_ERROR",
      context ? `${context}: ${error.message}` : error.message,
      500,
      { originalName: error.name, stack: error.stack }
    );
  }

  return new AppError(
    "UNKNOWN_ERROR",
    context ? `${context}: 未知错误` : "未知错误",
    500,
    { originalValue: String(error) }
  );
}

/** 错误链——保留完整错误堆栈 */
export class ErrorChain {
  private errors: Array<{ error: Error; context?: string }> = [];

  constructor(error: unknown, context?: string) {
    this.add(error, context);
  }

  add(error: unknown, context?: string): this {
    if (error instanceof Error) {
      this.errors.push({ error, context });
    } else {
      this.errors.push({
        error: new Error(String(error)),
        context,
      });
    }
    return this;
  }

  /** 获取最顶层的错误 */
  get root(): Error | undefined {
    return this.errors[0]?.error;
  }

  /** 获取原始错误（最后一个） */
  get original(): Error | undefined {
    return this.errors[this.errors.length - 1]?.error;
  }

  /** 格式化错误链 */
  toString(): string {
    return this.errors
      .map(
        (e, i) =>
          `  [${i}] ${e.context ? `(${e.context}) ` : ""}${e.error.message}`
      )
      .join("\n");
  }
}

// 使用示例
function processData(): never {
  try {
    // 数据库操作
    throw new Error("连接超时");
  } catch (err) {
    const chain = new ErrorChain(err, "数据库查询失败")
      .add("业务处理中断")
      .add("请求处理失败");

    throw wrapError(chain.original, "processData");
  }
}
```

### Result 模式

Result 模式（源自 Rust / functional programming）用类型系统强制调用方处理错误，避免遗漏：

```typescript
// errors/result.ts
/** 成功结果 */
export type Success<T> = {
  ok: true;
  value: T;
};

/** 失败结果 */
export type Failure<E = AppError> = {
  ok: false;
  error: E;
};

/** Result 类型 */
export type Result<T, E = AppError> = Success<T> | Failure<E>;

/** 创建成功结果 */
export function success<T>(value: T): Success<T> {
  return { ok: true, value };
}

/** 创建失败结果 */
export function failure<E = AppError>(error: E): Failure<E> {
  return { ok: false, error };
}

/** Result 工具函数 */
export const Result = {
  /** 尝试执行可能抛出异常的函数，返回 Result */
  try<T>(fn: () => T): Result<T> {
    try {
      return success(fn());
    } catch (err) {
      return failure(wrapError(err));
    }
  },

  /** 尝试执行异步函数 */
  async tryAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      const value = await fn();
      return success(value);
    } catch (err) {
      return failure(wrapError(err));
    }
  },

  /** 解包 Result，如果失败则抛出异常 */
  unwrap<T>(result: Result<T>): T {
    if (result.ok) return result.value;
    throw result.error;
  },

  /** 解包 Result，失败时返回默认值 */
  unwrapOr<T>(result: Result<T>, defaultValue: T): T {
    return result.ok ? result.value : defaultValue;
  },

  /** 转换成功值 */
  map<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
    return result.ok ? success(fn(result.value)) : result;
  },

  /** 链式操作：前一个 Result 成功则继续 */
  andThen<T, U>(
    result: Result<T>,
    fn: (value: T) => Result<U>
  ): Result<U> {
    return result.ok ? fn(result.value) : result;
  },
};

// 使用示例
async function fetchUser(id: string): Promise<Result<{ name: string }>> {
  // 模拟可能失败的操作
  if (!id) {
    return failure(new BusinessError("INVALID_ID", "用户 ID 不能为空"));
  }

  return success({ name: `User ${id}` });
}

async function demo() {
  const result = await fetchUser("123");

  // 必须处理 ok 和 error 两种情况（类型系统强制）
  if (result.ok) {
    console.log("用户姓名:", result.value.name);
  } else {
    console.error("获取用户失败:", result.error.message);
    // 可以根据 error.code 做不同处理
    if (result.error.code === "INVALID_ID") {
      // 特殊处理...
    }
  }

  // 使用工具函数
  const users = await Promise.all([
    fetchUser("1"),
    fetchUser("2"),
    fetchUser(""),
  ]);

  // 过滤出成功的请求
  const validUsers = users
    .filter((r): r is Success<{ name: string }> => r.ok)
    .map((r) => r.value);

  console.log(`成功获取 ${validUsers.length}/${users.length} 个用户`);
}
```

> **要点总结**
> - 自定义错误类层次结构让错误分类清晰，便于中间件统一处理
> - 错误链保留完整的错误上下文，方便调试
> - Result 模式用类型系统强制调用方处理所有错误路径
> - 类型谓词 `r is Success<T>` 结合 `filter` 是处理 Result 数组的惯用技巧
