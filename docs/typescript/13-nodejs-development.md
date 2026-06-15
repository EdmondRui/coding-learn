# 第 13 章：Node.js 开发实践

> 目标读者：有 TypeScript 基础，希望在 Node.js 后端开发中系统运用类型系统的开发者。本章涵盖 HTTP 服务、中间件、数据库、文件系统、流处理等核心实践。

---

## 13.1 项目初始化与工程配置

### 13.1.1 推荐项目结构

```
my-api/
├── src/
│   ├── config/          # 配置
│   │   └── index.ts
│   ├── routes/          # 路由定义
│   │   ├── user.routes.ts
│   │   └── order.routes.ts
│   ├── controllers/     # 控制器
│   │   └── user.controller.ts
│   ├── services/        # 业务逻辑
│   │   └── user.service.ts
│   ├── repositories/    # 数据访问
│   │   └── user.repository.ts
│   ├── middleware/       # 中间件
│   │   ├── auth.ts
│   │   └── error.ts
│   ├── models/          # 数据模型
│   │   └── user.model.ts
│   ├── types/           # 类型定义
│   │   └── express.d.ts
│   ├── utils/           # 工具函数
│   │   └── logger.ts
│   └── app.ts           # 应用入口
├── tests/
├── tsconfig.json
├── package.json
└── .env
```

### 13.1.2 tsconfig.json（Node.js 项目）

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### 13.1.3 package.json 关键配置

```json
{
  "name": "my-api",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "lint": "eslint src/",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.4",
    "tsx": "^4.7",
    "@types/node": "^20",
    "vitest": "^1.3",
    "eslint": "^8"
  }
}
```

---

## 13.2 Fastify 类型安全开发

### 13.2.1 基础设置

```typescript
// src/app.ts
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { userRoutes } from "./routes/user.routes";
import { orderRoutes } from "./routes/order.routes";
import { errorHandler } from "./middleware/error";

const app: FastifyInstance = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  },
});

// 注册插件
await app.register(cors, { origin: true });
await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

// 注册路由
app.register(userRoutes, { prefix: "/api/users" });
app.register(orderRoutes, { prefix: "/api/orders" });

// 错误处理
app.setErrorHandler(errorHandler);

// 启动
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`服务器启动: ${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export default app;
```

### 13.2.2 类型安全的路由与 Schema

```typescript
// src/routes/user.routes.ts
import type { FastifyPluginAsync } from "fastify";
import type { FromSchema } from "json-schema-to-ts";

// JSON Schema 定义——同时用于验证和类型推导
const createUserSchema = {
  body: {
    type: "object",
    required: ["name", "email"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      email: { type: "string", format: "email" },
      role: { type: "string", enum: ["admin", "user"] },
    },
    additionalProperties: false,
  } as const,
  response: {
    201: {
      type: "object",
      required: ["id", "name", "email"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        role: { type: "string" },
        createdAt: { type: "string" },
      },
    } as const,
  },
} as const;

type CreateUserBody = FromSchema<typeof createUserSchema.body>;
type CreateUserResponse = FromSchema<typeof createUserSchema.response["201"]>;

export const userRoutes: FastifyPluginAsync = async (app) => {
  // 创建用户——类型安全
  app.post<{
    Body: CreateUserBody;
    Reply: CreateUserResponse;
  }>("/", { schema: createUserSchema }, async (request, reply) => {
    const { name, email, role } = request.body;
    // request.body 类型自动推断为 { name: string; email: string; role?: "admin" | "user" }

    const user = await app.userService.create({
      name,
      email,
      role: role ?? "user",
    });

    reply.code(201).send(user);
  });

  // 获取用户列表
  app.get("/", async (request, reply) => {
    const users = await app.userService.findAll();
    return users;
  });

  // 获取单个用户
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const user = await app.userService.findById(request.params.id);
    if (!user) {
      reply.code(404).send({ error: "用户不存在" });
      return;
    }
    return user;
  });
};
```

### 13.2.3 扩展 Fastify 实例类型

```typescript
// src/types/fastify.d.ts
import type { UserService } from "../services/user.service";
import type { OrderService } from "../services/order.service";

declare module "fastify" {
  interface FastifyInstance {
    userService: UserService;
    orderService: OrderService;
  }
}
```

---

## 13.3 Express 类型安全开发

### 13.3.1 基础设置

```typescript
// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { userRouter } from "./routes/user.routes";
import { errorHandler } from "./middleware/error";

const app = express();

// 中间件
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// 路由
app.use("/api/users", userRouter);

// 错误处理
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`服务器启动: http://localhost:${PORT}`);
});
```

### 13.3.2 类型安全的路由

```typescript
// src/routes/user.routes.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import { body, param, query, validationResult } from "express-validator";
import { UserController } from "../controllers/user.controller";

export const userRouter = Router();
const controller = new UserController();

// 验证中间件
const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }
  next();
};

// 创建用户
userRouter.post(
  "/",
  body("name").isString().trim().isLength({ min: 1, max: 100 }),
  body("email").isEmail().normalizeEmail(),
  body("role").isIn(["admin", "user"]).optional(),
  validate,
  controller.create
);

// 获取用户列表
userRouter.get(
  "/",
  query("page").isInt({ min: 1 }).optional().default(1),
  query("limit").isInt({ min: 1, max: 100 }).optional().default(20),
  validate,
  controller.list
);

// 获取单个用户
userRouter.get(
  "/:id",
  param("id").isUUID(),
  validate,
  controller.getById
);
```

### 13.3.3 类型安全的 Controller

```typescript
// src/controllers/user.controller.ts
import type { Request, Response } from "express";
import { UserService } from "../services/user.service";

// 请求/响应类型
type CreateUserRequest = Request<
  never,
  never,
  { name: string; email: string; role?: "admin" | "user" }
>;

type ListUsersRequest = Request<
  never,
  never,
  never,
  { page?: number; limit?: number }
>;

type GetUserRequest = Request<{ id: string }>;

export class UserController {
  private service = new UserService();

  create = async (req: CreateUserRequest, res: Response) => {
    const user = await this.service.create(req.body);
    res.status(201).json(user);
  };

  list = async (req: ListUsersRequest, res: Response) => {
    const { page = 1, limit = 20 } = req.query;
    const result = await this.service.findAll({ page, limit });
    res.json(result);
  };

  getById = async (req: GetUserRequest, res: Response) => {
    const user = await this.service.findById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "用户不存在" });
      return;
    }
    res.json(user);
  };
}
```

---

## 13.4 中间件模式

### 13.4.1 认证中间件

```typescript
// src/middleware/auth.ts
import type { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtClaims } from "../auth/jwt";

// 扩展 Express Request 类型
declare module "express" {
  interface Request {
    user?: JwtClaims;
  }
}

// JWT 认证中间件
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "未提供认证令牌" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const claims = verifyToken(token);
    req.user = claims;
    next();
  } catch {
    res.status(401).json({ error: "令牌无效或已过期" });
  }
}

// 角色授权中间件
export function authorize(...roles: JwtClaims["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "未认证" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "权限不足" });
      return;
    }
    next();
  };
}

// 使用
// router.get("/admin", authenticate, authorize("admin"), handler);
// router.get("/profile", authenticate, handler);
```

### 13.4.2 请求日志中间件

```typescript
// src/middleware/logger.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    logger.info({
      method,
      url: originalUrl,
      status: statusCode,
      duration: `${duration}ms`,
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
  });

  next();
}
```

### 13.4.3 错误处理中间件

```typescript
// src/middleware/error.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

// 自定义错误类
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} 不存在`, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    public details?: Record<string, string[]>
  ) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "未授权") {
    super(message, 401, "UNAUTHORIZED");
  }
}

// 全局错误处理
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    logger.warn({ err });
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err instanceof ValidationError && { details: err.details }),
      },
    });
    return;
  }

  // 未知错误
  logger.error({ err, stack: err.stack });
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "服务器内部错误",
    },
  });
}
```

---

## 13.5 数据库操作

### 13.5.1 Prisma 类型安全查询

```typescript
// prisma/schema.prisma
// model User {
//   id        String   @id @default(cuid())
//   email     String   @unique
//   name      String
//   role      Role     @default(USER)
//   posts     Post[]
//   createdAt DateTime @default(now())
//   updatedAt DateTime @updatedAt
// }
//
// model Post {
//   id        String   @id @default(cuid())
//   title     String
//   content   String?
//   published Boolean  @default(false)
//   author    User     @relation(fields: [authorId], references: [id])
//   authorId  String
//   createdAt DateTime @default(now())
//   updatedAt DateTime @updatedAt
// }
//
// enum Role {
//   USER
//   ADMIN
// }

// src/repositories/user.repository.ts
import { PrismaClient, type User, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export class UserRepository {
  // 创建
  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  // 按条件查询
  async findMany(params: {
    where?: Prisma.UserWhereInput;
    skip?: number;
    take?: number;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }) {
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: { posts: { where: { published: true } } },
      }),
      prisma.user.count({ where: params.where }),
    ]);
    return { users, total };
  }

  // 按 ID 查询
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { posts: true },
    });
  }

  // 更新
  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  }

  // 删除
  async delete(id: string): Promise<User> {
    return prisma.user.delete({ where: { id } });
  }
}
```

### 13.5.2 Service 层

```typescript
// src/services/user.service.ts
import { UserRepository } from "../repositories/user.repository";
import { NotFoundError, ValidationError } from "../middleware/error";

type CreateUserDTO = {
  name: string;
  email: string;
  role?: "USER" | "ADMIN";
};

type UpdateUserDTO = {
  name?: string;
  email?: string;
};

type PaginationOptions = {
  page?: number;
  limit?: number;
  role?: "USER" | "ADMIN";
};

export class UserService {
  private repo = new UserRepository();

  async create(data: CreateUserDTO) {
    // 业务验证
    const existing = await this.repo.findMany({
      where: { email: data.email },
    });
    if (existing.total > 0) {
      throw new ValidationError("邮箱已被注册", {
        email: ["该邮箱已存在"],
      });
    }

    return this.repo.create(data);
  }

  async findAll(options: PaginationOptions) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    return this.repo.findMany({
      where: options.role ? { role: options.role } : undefined,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string) {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundError("用户");
    return user;
  }

  async update(id: string, data: UpdateUserDTO) {
    await this.findById(id); // 确保存在
    return this.repo.update(id, data);
  }

  async delete(id: string) {
    await this.findById(id);
    return this.repo.delete(id);
  }
}
```

---

## 13.6 文件系统与流处理

### 13.6.1 类型安全的文件操作

```typescript
// src/utils/file.ts
import { promises as fs } from "fs";
import { join, dirname, extname } from "path";

type FileInfo = {
  name: string;
  path: string;
  size: number;
  extension: string;
  createdAt: Date;
  modifiedAt: Date;
};

// 读取 JSON 文件
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}

// 写入 JSON 文件
export async function writeJsonFile<T>(
  filePath: string,
  data: T,
  pretty = true
): Promise<void> {
  const dir = dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await fs.writeFile(filePath, content, "utf-8");
}

// 获取文件信息
export async function getFileInfo(filePath: string): Promise<FileInfo> {
  const stat = await fs.stat(filePath);
  return {
    name: filePath.split("/").pop() ?? "",
    path: filePath,
    size: stat.size,
    extension: extname(filePath),
    createdAt: stat.birthtime,
    modifiedAt: stat.mtime,
  };
}

// 确保目录存在
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// 安全删除（移到回收站目录）
export async function safeDelete(
  filePath: string,
  trashDir = "/tmp/trash"
): Promise<void> {
  const fileName = filePath.split("/").pop() ?? "unknown";
  const trashPath = join(trashDir, `${Date.now()}-${fileName}`);
  await ensureDir(trashDir);
  await fs.rename(filePath, trashPath);
}
```

### 13.6.2 流式文件上传

```typescript
// src/routes/upload.routes.ts
import { Router } from "express";
import multer from "multer";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";

const upload = multer({
  storage: multer.diskStorage({
    destination: "/tmp/uploads",
    filename: (_req, file, cb) => {
      const ext = file.originalname.split(".").pop();
      cb(null, `${uuid()}.${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

export const uploadRouter = Router();

// 单文件上传
uploadRouter.post("/single", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "未提供文件" });
    return;
  }
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

// 多文件上传
uploadRouter.post("/multiple", upload.array("files", 10), (req, res) => {
  const files = req.files as Express.Multer.File[];
  res.json(
    files.map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
    }))
  );
});

// 流式下载
uploadRouter.get("/download/:filename", async (req, res) => {
  const filePath = join("/tmp/uploads", req.params.filename);
  try {
    const stat = await fs.stat(filePath);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.filename}"`
    );
    await pipeline(createReadStream(filePath), res);
  } catch {
    res.status(404).json({ error: "文件不存在" });
  }
});
```

### 13.6.3 流式数据处理

```typescript
// src/utils/stream.ts
import { Transform, type TransformCallback } from "stream";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";

// JSON Lines 转换流
class JsonLinesParser extends Transform {
  private buffer = "";

  constructor() {
    super({ objectMode: true });
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          this.push(JSON.parse(line));
        } catch {
          // 跳过无效行
        }
      }
    }
    callback();
  }

  _flush(callback: TransformCallback) {
    if (this.buffer.trim()) {
      try {
        this.push(JSON.parse(this.buffer));
      } catch {
        // 忽略
      }
    }
    callback();
  }
}

// 过滤流
class FilterStream<T> extends Transform {
  constructor(private predicate: (item: T) => boolean) {
    super({ objectMode: true });
  }

  _transform(item: T, _encoding: string, callback: TransformCallback) {
    if (this.predicate(item)) {
      this.push(item);
    }
    callback();
  }
}

// 映射流
class MapStream<T, U> extends Transform {
  constructor(private mapper: (item: T) => U) {
    super({ objectMode: true });
  }

  _transform(item: T, _encoding: string, callback: TransformCallback) {
    this.push(this.mapper(item));
    callback();
  }
}

// 使用示例：处理大文件
async function processLargeFile(inputPath: string, outputPath: string) {
  await pipeline(
    createReadStream(inputPath),
    new JsonLinesParser(),
    new FilterStream<{ type: string }>((item) => item.type === "order"),
    new MapStream(({ id, total }: any) => ({ id, total })),
    new Transform({
      objectMode: true,
      transform(item, _enc, cb) {
        this.push(JSON.stringify(item) + "\n");
        cb();
      },
    }),
    createWriteStream(outputPath)
  );
}
```

---

## 13.7 环境变量与配置

### 13.7.1 类型安全的环境变量

```typescript
// src/config/index.ts
import { z } from "zod";

// 环境变量 Schema
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),

  // 数据库
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_SIZE: z.coerce.number().default(10),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // 日志
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["json", "text"]).default("text"),
});

// 解析并验证环境变量
function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ 环境变量验证失败:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();

// 配置对象——类型安全
export const config = {
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === "development",
  isProd: env.NODE_ENV === "production",

  server: {
    port: env.PORT,
    host: env.HOST,
  },

  database: {
    url: env.DATABASE_URL,
    poolSize: env.DATABASE_POOL_SIZE,
  },

  redis: {
    url: env.REDIS_URL,
  },

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  logging: {
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
  },
} as const;
```

### 13.7.2 多环境配置

```typescript
// src/config/database.ts
import { config } from "./index";

type DatabaseConfig = {
  url: string;
  poolSize: number;
  ssl: boolean;
  logging: boolean;
};

function getDatabaseConfig(): DatabaseConfig {
  const base = {
    url: config.database.url,
    poolSize: config.database.poolSize,
  };

  switch (config.env) {
    case "production":
      return { ...base, ssl: true, logging: false };
    case "staging":
      return { ...base, ssl: true, logging: true };
    case "development":
    default:
      return { ...base, ssl: false, logging: true };
  }
}

export const dbConfig = getDatabaseConfig();
```

---

## 13.8 定时任务

### 13.8.1 node-cron 定时任务

```typescript
// src/tasks/scheduler.ts
import cron from "node-cron";
import { logger } from "../utils/logger";

type TaskDefinition = {
  name: string;
  schedule: string; // cron 表达式
  task: () => Promise<void>;
};

class TaskScheduler {
  private tasks: Map<string, cron.ScheduledTask> = new Map();

  register(definition: TaskDefinition): void {
    if (!cron.validate(definition.schedule)) {
      throw new Error(`无效的 cron 表达式: ${definition.schedule}`);
    }

    const task = cron.schedule(definition.schedule, async () => {
      logger.info(`开始执行任务: ${definition.name}`);
      try {
        await definition.task();
        logger.info(`任务完成: ${definition.name}`);
      } catch (error) {
        logger.error({ error, task: definition.name }, "任务执行失败");
      }
    });

    this.tasks.set(definition.name, task);
    logger.info(`注册定时任务: ${definition.name} (${definition.schedule})`);
  }

  stop(name: string): boolean {
    const task = this.tasks.get(name);
    if (task) {
      task.stop();
      return true;
    }
    return false;
  }

  stopAll(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
  }
}

export const scheduler = new TaskScheduler();

// 注册任务
scheduler.register({
  name: "清理过期会话",
  schedule: "0 */6 * * *", // 每 6 小时
  task: async () => {
    // 清理逻辑
  },
});

scheduler.register({
  name: "生成日报",
  schedule: "0 2 * * *", // 每天凌晨 2 点
  task: async () => {
    // 生成逻辑
  },
});
```

---

## 13.9 优雅关停

```typescript
// src/utils/shutdown.ts
import type { Server } from "http";
import { logger } from "./logger";

export function setupGracefulShutdown(server: Server) {
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`收到 ${signal} 信号，开始优雅关停...`);

    // 停止接受新连接
    server.close(() => {
      logger.info("HTTP 服务器已关闭");
    });

    // 设置超时强制退出
    const timeout = setTimeout(() => {
      logger.error("关停超时，强制退出");
      process.exit(1);
    }, 10000); // 10 秒超时

    // 关闭数据库连接等资源
    try {
      // await prisma.$disconnect();
      // await redisClient.quit();
      // scheduler.stopAll();
      logger.info("所有资源已释放");
      clearTimeout(timeout);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "释放资源失败");
      clearTimeout(timeout);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
```

---

## 小结

| 主题 | 关键技术 | 适用场景 |
|------|---------|---------|
| 项目配置 | tsconfig + Zod | 所有 Node.js 项目 |
| HTTP 服务 | Fastify / Express | REST API 开发 |
| 中间件 | 认证/日志/错误处理 | 请求管道 |
| 数据库 | Prisma ORM | 类型安全数据访问 |
| 文件处理 | multer + stream | 文件上传下载 |
| 流处理 | Transform + pipeline | 大文件/实时数据 |
| 配置管理 | Zod + dotenv | 多环境配置 |
| 定时任务 | node-cron | 后台定时任务 |
| 优雅关停 | signal handler | 生产部署 |