# 第 12 章：高级类型系统

> 目标读者：已掌握 TypeScript 泛型、联合类型、基础工具类型的开发者。本章深入条件类型、`infer`、递归类型、模板字面量类型等高级特性，并通过实战类型体操巩固理解。

---

## 12.1 条件类型深入

### 12.1.1 条件类型基础回顾

```typescript
type IsString<T> = T extends string ? true : false;

type A = IsString<"hello">;  // true
type B = IsString<42>;        // false
```

条件类型根据类型关系做分支选择，类似类型层面的三元表达式。

### 12.1.2 分布式条件类型

当条件类型作用于联合类型时，会自动**分布**到每个成员：

```typescript
type ToArray<T> = T extends unknown ? T[] : never;

type Result = ToArray<string | number>; // string[] | number[]
```

**不是** `(string | number)[]`，而是 `string[] | number[]`。

这个特性非常强大——它是很多工具类型的底层机制：

```typescript
// 内置 Extract 和 Exclude 就是基于分布式条件类型
type Extract<T, U> = T extends U ? T : never;
type Exclude<T, U> = T extends U ? never : T;

type NonNullable<T> = T extends null | undefined ? never : T;

type A = Extract<"a" | "b" | "c", "a" | "b">; // "a" | "b"
type B = Exclude<"a" | "b" | "c", "a">;        // "b" | "c"
type C = NonNullable<string | null>;             // string
```

### 12.1.3 阻止分布

用 `[T]` 包裹可以阻止分布行为：

```typescript
// 分布式
type ToArray<T> = T extends unknown ? T[] : never;
type A = ToArray<string | number>; // string[] | number[]

// 非分布式
type ToArrayNoDistribute<T> = [T] extends [unknown] ? T[] : never;
type B = ToArrayNoDistribute<string | number>; // (string | number)[]
```

何时需要阻止分布？当你需要把整个联合类型当作一个整体来判断时。

### 12.1.4 条件类型中的函数重载

```typescript
// 获取函数的返回值类型——处理重载
type ReturnTypeOf<T> = T extends (...args: any[]) => infer R ? R : never;

function fn(x: string): number;
function fn(x: number): string;
function fn(x: string | number): string | number {
  return x;
}

// 对于重载函数，ReturnType 只取最后一个签名
type R = ReturnType<typeof fn>; // string
```

---

## 12.2 `infer` 关键字

`infer` 只能在条件类型的 `extends` 子句中使用，用于在模式匹配中"推断"一个类型。

### 12.2.1 基本用法

```typescript
// 提取函数返回值类型
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;

// 提取 Promise 解析值类型
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T;

type P = Awaited<Promise<Promise<string>>>; // string

// 提取数组元素类型
type ElementOf<T> = T extends (infer E)[] ? E : never;

type E = ElementOf<string[]>; // string
```

### 12.2.2 多个 infer

```typescript
// 提取函数的参数和返回值
type FunctionInfo<T> = T extends (...args: infer Args) => infer Return
  ? { args: Args; return: Return }
  : never;

type Info = FunctionInfo<(x: number, y: string) => boolean>;
// { args: [number, string]; return: boolean }
```

### 12.2.3 infer 与元组

```typescript
// 提取元组的第一个元素
type Head<T> = T extends [infer H, ...any[]] ? H : never;

// 提取元组的最后一个元素
type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;

// 去掉元组第一个元素
type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : never;

type H = Head<[1, 2, 3]>;     // 1
type L = Last<[1, 2, 3]>;     // 3
type T = Tail<[1, 2, 3]>;     // [2, 3]
```

### 12.2.4 infer 约束

TypeScript 4.7+ 支持对 `infer` 添加约束：

```typescript
// 约束推断的类型必须符合特定结构
type FirstString<T> = T extends [infer S extends string, ...unknown[]]
  ? S
  : never;

type A = FirstString<["hello", 42]>;  // "hello"
type B = FirstString<[42, "hello"]>;    // never —— 第一个不是 string
```

---

## 12.3 映射类型深入

### 12.3.1 基础映射类型

```typescript
// 把所有属性变成可选
type MyPartial<T> = {
  [K in keyof T]?: T[K];
};

// 把所有属性变成只读
type MyReadonly<T> = {
  readonly [K in keyof T]: T[K];
};

// 把所有属性变成可写
type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

// 把所有属性变成必填
type MyRequired<T> = {
  [K in keyof T]-?: T[K];
};
```

`+` 和 `-` 修饰符可以添加或移除 `readonly` 和 `?`。

### 12.3.2 键的重映射（Key Remapping）

TypeScript 4.1+ 支持在映射类型中重映射键：

```typescript
// 把所有键加上前缀
type PrefixKeys<T, P extends string> = {
  [K in keyof T as `${P}${Capitalize<string & K>}`]: T[K];
};

type User = { id: number; name: string; age: number };
type PrefixedUser = PrefixKeys<User, "user">;
// { userId: number; userName: string; userAge: number }
```

### 12.3.3 过滤属性

```typescript
// 只保留字符串类型的属性
type OnlyStringProps<T> = {
  [K in keyof T as T[K] extends string ? K : never]: T[K];
};

type Config = {
  host: string;
  port: number;
  debug: boolean;
  name: string;
};

type StringConfig = OnlyStringProps<Config>;
// { host: string; name: string }
```

### 12.3.4 值的变换

```typescript
// 把所有属性变成 Promise
type Promisified<T> = {
  [K in keyof T]: Promise<T[K]>;
};

type User = { id: number; name: string };
type AsyncUser = Promisified<User>;
// { id: Promise<number>; name: Promise<string> }

// 把所有属性变成可空
type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};
```

### 12.3.5 递归映射类型

```typescript
// 深层 Partial
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

type Nested = {
  a: { b: { c: number }; d: string };
  e: number;
};

type PartialNested = DeepPartial<Nested>;
// { a?: { b?: { c?: number }; d?: string }; e?: number }

// 深层 Readonly
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};
```

---

## 12.4 模板字面量类型

### 12.4.1 基础

```typescript
type EventName = "click" | "focus" | "blur";
type HandlerName = `on${Capitalize<EventName>}`;
// "onClick" | "onFocus" | "onBlur"

type CSSProperty = "margin" | "padding";
type Direction = "top" | "right" | "bottom" | "left";
type CSSKey = `${CSSProperty}-${Direction}`;
// "margin-top" | "margin-right" | ... | "padding-left"
```

### 12.4.2 内置字符串操作类型

```typescript
type A = Uppercase<"hello">;      // "HELLO"
type B = Lowercase<"HELLO">;      // "hello"
type C = Capitalize<"hello">;     // "Hello"
type D = Uncapitalize<"Hello">;   // "hello"
```

### 12.12.3 实战：类型安全的事件系统

```typescript
type EventMap = {
  click: { x: number; y: number };
  keydown: { key: string; code: string };
  resize: { width: number; height: number };
};

// 利用模板字面量类型生成 on 方法
type OnMethod<T extends string> = `on${Capitalize<T>}`;

type EventHandlers = {
  [K in keyof EventMap as OnMethod<string & K>]: (event: EventMap[K]) => void;
};
// {
//   onClick: (event: { x: number; y: number }) => void;
//   onKeydown: (event: { key: string; code: string }) => void;
//   onResize: (event: { width: number; height: number }) => void;
// }

class Emitter implements EventHandlers {
  onClick(event: { x: number; y: number }) {
    console.log(`Click at (${event.x}, ${event.y})`);
  }
  onKeydown(event: { key: string; code: string }) {
    console.log(`Key: ${event.key}`);
  }
  onResize(event: { width: number; height: number }) {
    console.log(`Resized to ${event.width}x${event.height}`);
  }
}
```

### 12.4.4 实战：类型安全的 CSS 属性

```typescript
type Length = `${number}px` | `${number}rem` | `${number}em` | `${number}%`;
type Color = `#${string}` | `rgb(${number},${number},${number})`;

type CSSProperties = {
  margin?: Length;
  padding?: Length;
  width?: Length;
  height?: Length;
  color?: Color;
  backgroundColor?: Color;
  fontSize?: Length;
  display?: "block" | "flex" | "grid" | "inline" | "none";
};

// 编译时就能捕获非法值
const style: CSSProperties = {
  margin: "16px",
  color: "#333",
  display: "flex",
  // fontSize: "red", // ❌ 类型错误
};
```

---

## 12.5 递归类型与类型级编程

### 12.5.1 递归条件类型

```typescript
// 递归展开嵌套数组——Flatten
type Flatten<T> = T extends Array<infer U>
  ? Flatten<U>
  : T;

type A = Flatten<[1, [2, [3, [4]]]]>; // 1 | 2 | 3 | 4

// 递归深度路径
type Path<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: Path<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
    }[keyof T & string] | Prefix
  : Prefix;

type Obj = { a: { b: { c: number } }; d: string };
type ObjPath = Path<Obj>;
// "a" | "a.b" | "a.b.c" | "d"
```

### 12.5.2 元组递归操作

```typescript
// 反转元组
type Reverse<T extends any[]> = T extends [infer First, ...infer Rest]
  ? [...Reverse<Rest>, First]
  : [];

type R = Reverse<[1, 2, 3, 4]>; // [4, 3, 2, 1]

// 元组过滤
type Filter<T extends any[], U> = T extends [infer First, ...infer Rest]
  ? First extends U
    ? [First, ...Filter<Rest, U>]
    : Filter<Rest, U>
  : [];

type F = Filter<[1, "a", 2, "b", 3], number>; // [1, 2, 3]

// 元组去重
type Unique<T extends any[], Seen extends any[] = []> = T extends [
  infer First,
  ...infer Rest
]
  ? First extends Seen[number]
    ? Unique<Rest, Seen>
    : [First, ...Unique<Rest, [...Seen, First]>]
  : [];

type U = Unique<[1, 2, 1, 3, 2, 4]>; // [1, 2, 3, 4]
```

### 12.5.3 计数与算术

```typescript
// 利用元组长度做加法
type BuildTuple<L extends number, T extends any[] = []> =
  T["length"] extends L ? T : BuildTuple<L, [...T, unknown]>;

type Add<A extends number, B extends number> =
  [...BuildTuple<A>, ...BuildTuple<B>]["length"];

type Sum = Add<3, 5>; // 8

// 比较大小
type GreaterThan<A extends number, B extends number, T extends any[] = []> =
  T["length"] extends B
    ? false
    : T["length"] extends A
      ? true
      : GreaterThan<A, B, [...T, unknown]>;

type G1 = GreaterThan<5, 3>;  // true
type G2 = GreaterThan<3, 5>;  // false
```

---

## 12.6 类型体操实战

### 12.6.1 实现 DeepPartial

```typescript
type DeepPartial<T> = T extends Function
  ? T
  : T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

// 测试
type Config = {
  server: {
    host: string;
    port: number;
    ssl: { enabled: boolean; cert: string };
  };
  logging: { level: string; file: string };
};

type PartialConfig = DeepPartial<Config>;
// 所有层级都变成可选
const config: PartialConfig = {
  server: {
    ssl: { enabled: true } // 只填部分字段即可
  }
};
```

### 12.6.2 实现 DeepMerge

```typescript
type DeepMerge<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? A[K] extends object
        ? B[K] extends object
          ? DeepMerge<A[K], B[K]>
          : B[K]
        : B[K]
      : B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

type DefaultConfig = {
  server: { host: string; port: number };
  debug: boolean;
};

type UserConfig = {
  server: { port: number };
  debug: boolean;
};

type Merged = DeepMerge<DefaultConfig, UserConfig>;
// { server: { host: string; port: number }; debug: boolean }
```

### 12.6.3 实现 PickByType

```typescript
// 按值类型选取属性
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};

type User = {
  id: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
};

type StringProps = PickByType<User, string>;
// { name: string; email: string }

type NumberProps = PickByType<User, number>;
// { id: number; age: number }
```

### 12.6.4 实现 OmitByType

```typescript
// 按值类型排除属性
type OmitByType<T, U> = {
  [K in keyof T as T[K] extends U ? never : K]: T[K];
};

type User = {
  id: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
};

type WithoutNumbers = OmitByType<User, number>;
// { name: string; email: string; active: boolean }
```

### 12.6.5 实现 RequiredKeys

```typescript
// 提取必填字段的键
type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type User = {
  id: number;
  name: string;
  email?: string;
  age?: number;
};

type R = RequiredKeys<User>; // "id" | "name"
```

### 12.6.6 实现 MutableKeys

```typescript
// 提取可写（非 readonly）字段的键
type MutableKeys<T> = {
  [K in keyof T]: Equal<Readonly<Pick<T, K>>, Pick<T, K>> extends true ? never : K;
}[keyof T];

// 辅助类型：判断两个类型是否相同
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y
  ? 1
  : 2
  ? true
  : false;

type Config = {
  readonly host: string;
  port: number;
  readonly debug: boolean;
  name: string;
};

type M = MutableKeys<Config>; // "port" | "name"
```

### 12.6.7 实现 UnionToIntersection

```typescript
// 把联合类型转为交叉类型
type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

type A = { a: number };
type B = { b: string };
type C = { c: boolean };

type ABC = UnionToIntersection<A | B | C>;
// { a: number } & { b: string } & { c: boolean }
```

### 12.6.8 实现 TupleToUnion

```typescript
type TupleToUnion<T extends readonly any[]> = T[number];

type T = TupleToUnion<["a", "b", "c"]>; // "a" | "b" | "c"
type N = TupleToUnion<[1, 2, 3]>;        // 1 | 2 | 3
```

---

## 12.7 类型守卫与自定义收窄

### 12.7.1 自定义类型守卫

```typescript
interface Dog {
  type: "dog";
  bark(): void;
}

interface Cat {
  type: "cat";
  meow(): void;
}

type Pet = Dog | Cat;

// 自定义类型守卫——使用 is 关键字
function isDog(pet: Pet): pet is Dog {
  return pet.type === "dog";
}

function handlePet(pet: Pet) {
  if (isDog(pet)) {
    pet.bark(); // TypeScript 知道 pet 是 Dog
  } else {
    pet.meow(); // TypeScript 知道 pet 是 Cat
  }
}
```

### 12.7.2 Assertion Functions

```typescript
// 确保值非空的断言函数
function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value == null) {
    throw new Error(message ?? "Expected value to be defined");
  }
}

// 使用
const input: string | undefined = getUserInput();
assertDefined(input, "Input is required");
input.toUpperCase(); // TypeScript 知道 input 是 string

// 确保值是特定类型
function assertType<T>(
  value: unknown,
  check: (v: unknown) => v is T,
  message?: string
): asserts value is T {
  if (!check(value)) {
    throw new Error(message ?? "Type assertion failed");
  }
}
```

### 12.7.3 使用 satisfies 进行类型检查

```typescript
// satisfies 确保值符合类型，但不拓宽类型
type Route = {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  handler: (req: unknown) => unknown;
};

const routes = {
  getUsers: { path: "/users", method: "GET", handler: (req: unknown) => {} },
  createUser: { path: "/users", method: "POST", handler: (req: unknown) => {} },
} satisfies Record<string, Route>;

// routes 的类型保留了具体的字面量类型
routes.getUsers.method; // "GET"（不是 "GET" | "POST" | ...）
```

---

## 12.8 装饰器与元数据

### 12.8.1 类装饰器

```typescript
// TypeScript 5.0+ 原生装饰器语法
function logged(originalMethod: any, context: ClassMethodDecoratorContext) {
  const name = String(context.name);
  return function (this: any, ...args: any[]) {
    console.log(`调用 ${name}，参数: ${JSON.stringify(args)}`);
    const result = originalMethod.call(this, ...args);
    console.log(`${name} 返回: ${JSON.stringify(result)}`);
    return result;
  };
}

class Calculator {
  @logged
  add(a: number, b: number): number {
    return a + b;
  }
}

const calc = new Calculator();
calc.add(2, 3);
// 调用 add，参数: [2,3]
// add 返回: 5
```

### 12.8.2 属性装饰器与自动验证

```typescript
// 使用装饰器实现属性验证
function required(target: any, context: ClassFieldDecoratorContext) {
  const name = String(context.name);
  return function (this: any, initialValue: any) {
    if (initialValue === undefined || initialValue === null) {
      throw new Error(`属性 ${name} 是必填的`);
    }
    return initialValue;
  };
}

function range(min: number, max: number) {
  return function (target: any, context: ClassFieldDecoratorContext) {
    const name = String(context.name);
    return function (this: any, initialValue: any) {
      if (typeof initialValue !== "number" || initialValue < min || initialValue > max) {
        throw new Error(`属性 ${name} 必须在 ${min} 和 ${max} 之间`);
      }
      return initialValue;
    };
  };
}

class User {
  @required
  name: string = "";

  @range(0, 150)
  age: number = 0;
}
```

---

## 12.9 声明文件与类型编程

### 12.9.1 编写高质量声明文件

```typescript
// types/external-lib.d.ts
declare module "external-lib" {
  // 导出类型
  export interface Config {
    apiKey: string;
    baseUrl: string;
    timeout?: number;
  }

  // 导出函数
  export function initialize(config: Config): void;
  export function getData<T>(endpoint: string): Promise<T>;

  // 导出类
  export class Client {
    constructor(config: Config);
    request<T>(method: string, path: string): Promise<T>;
    close(): void;
  }

  // 默认导出
  export default Client;
}

// 全局声明
declare global {
  interface Window {
    myApp: {
      version: string;
      config: import("external-lib").Config;
    };
  }
}
```

### 12.9.2 模块增强

```typescript
// 扩展 Express 的 Request 类型
declare module "express" {
  interface Request {
    userId?: string;
    userRole?: "admin" | "user";
    traceId?: string;
  }
}

// 扩展 Jest 的匹配器
declare module "jest" {
  interface Matchers<R> {
    toBeWithinRange(floor: number, ceiling: number): R;
  }
}
```

### 12.9.3 条件类型与函数重载

```typescript
// 根据输入类型决定输出类型
function query<T extends string | string[]>(
  sql: string,
  params: T
): T extends string ? Row : Row[] {
  // 实现省略
  return {} as any;
}

const one = query("SELECT * FROM users WHERE id = $1", "1");     // Row
const many = query("SELECT * FROM users WHERE id IN ($1)", ["1"]); // Row[]
```

---

## 12.10 类型安全的事件系统

综合运用条件类型、映射类型、泛型约束，构建一个完整的事件系统：

```typescript
// 事件映射定义
type EventMap = {
  "user:login": { userId: string; timestamp: number };
  "user:logout": { userId: string };
  "order:create": { orderId: string; items: string[]; total: number };
  "order:cancel": { orderId: string; reason: string };
  "notification:send": { to: string; message: string };
};

// 类型安全的事件发射器
class TypeSafeEmitter<Events extends Record<string, any>> {
  private handlers = new Map<
    keyof Events,
    Set<(payload: any) => void>
  >();

  // 订阅事件
  on<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // 返回取消订阅函数
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  // 触发事件
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  // 一次性订阅
  once<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void
  ): () => void {
    const wrapper = (payload: Events[K]) => {
      handler(payload);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  // 取消订阅
  off<K extends keyof Events>(
    event: K,
    handler: (payload: Events[K]) => void
  ): void {
    this.handlers.get(event)?.delete(handler);
  }
}

// 使用
const emitter = new TypeSafeEmitter<EventMap>();

// 类型安全——payload 类型自动推断
emitter.on("user:login", (payload) => {
  console.log(`用户 ${payload.userId} 登录`); // payload: { userId: string; timestamp: number }
});

emitter.on("order:create", (payload) => {
  console.log(`订单 ${payload.orderId}，金额 ${payload.total}`);
});

// 编译时错误检查
// emitter.on("user:login", (payload) => {
//   payload.orderId; // ❌ Property 'orderId' does not exist
// });

// emitter.emit("unknown:event", {}); // ❌ Argument of type '"unknown:event"' is not assignable

emitter.emit("user:login", { userId: "u1", timestamp: Date.now() });
emitter.emit("order:create", { orderId: "o1", items: ["book"], total: 29.9 });
```

---

## 12.11 类型安全的 API 客户端

```typescript
// 定义 API 路由
type ApiRoutes = {
  "/users": {
    GET: { response: User[]; query?: { role?: string } };
    POST: { response: User; body: CreateUserDTO };
  };
  "/users/:id": {
    GET: { response: User; params: { id: string } };
    PUT: { response: User; params: { id: string }; body: UpdateUserDTO };
    DELETE: { response: void; params: { id: string } };
  };
  "/orders": {
    GET: { response: Order[]; query?: { status?: string } };
  };
};

type User = { id: string; name: string; email: string; role: "admin" | "user" };
type CreateUserDTO = Omit<User, "id">;
type UpdateUserDTO = Partial<CreateUserDTO>;
type Order = { id: string; userId: string; total: number; status: string };

// 类型安全的请求函数
type Method = "GET" | "POST" | "PUT" | "DELETE";

type ApiRoute = keyof ApiRoutes;
type RouteMethods<R extends ApiRoute> = keyof ApiRoutes[R] & Method;

type RouteConfig<R extends ApiRoute, M extends RouteMethods<R>> =
  ApiRoutes[R][M];

// 提取请求参数
type ExtractParams<R extends ApiRoute> =
  R extends `${string}:${string}`
    ? R extends `${infer Prefix}:${infer Param}/${infer Rest}`
      ? { [K in Param | keyof ExtractParams<Rest>]: string }
      : R extends `${infer Prefix}:${infer Param}`
        ? { [K in Param]: string }
        : never
    : {};

// 类型安全的 fetch 封装
async function api<
  R extends ApiRoute,
  M extends RouteMethods<R>
>(
  route: R,
  method: M,
  options?: {
    params?: ExtractParams<R>;
    query?: RouteConfig<R, M> extends { query?: infer Q } ? Q : never;
    body?: RouteConfig<R, M> extends { body: infer B } ? B : never;
  }
): Promise<RouteConfig<R, M> extends { response: infer Res } ? Res : never> {
  let url: string = route as string;

  // 替换路径参数
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      url = url.replace(`:${key}`, value);
    }
  }

  // 添加查询参数
  if (options?.query) {
    const params = new URLSearchParams(
      Object.entries(options.query).filter(([_, v]) => v !== undefined) as [string, string][]
    );
    url += `?${params.toString()}`;
  }

  const response = await fetch(url, {
    method: method as string,
    headers: { "Content-Type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  return response.json();
}

// 使用——完全类型安全
async function examples() {
  // GET /users —— 返回 User[]
  const users = await api("/users", "GET");
  users[0].name; // ✅ 类型安全

  // GET /users?role=admin
  const admins = await api("/users", "GET", { query: { role: "admin" } });

  // POST /users —— body 类型自动推断
  const newUser = await api("/users", "POST", {
    body: { name: "Tom", email: "tom@example.com", role: "user" },
  });

  // GET /users/:id —— params 必填
  const user = await api("/users/:id", "GET", { params: { id: "123" } });

  // DELETE /users/:id
  await api("/users/:id", "DELETE", { params: { id: "123" } });
}
```

---

## 12.12 类型编程最佳实践

### 12.12.1 何时使用高级类型

| 场景 | 推荐方案 | 示例 |
|------|---------|------|
| 简单属性变换 | 内置工具类型 | `Partial<T>`, `Pick<T, K>` |
| 条件类型判断 | 条件类型 | `T extends U ? X : Y` |
| 从函数/类中提取类型 | `infer` | `ReturnType<T>`, `Parameters<T>` |
| 批量属性变换 | 映射类型 | `{ [K in keyof T]: ... }` |
| 字符串模式匹配 | 模板字面量类型 | `` `on${Capitalize<E>}` `` |
| 复杂类型推导 | 递归条件类型 | `DeepPartial<T>`, `Path<T>` |

### 12.12.2 避免过度类型体操

```typescript
// ❌ 过度复杂——难以理解和维护
type MegaType<T> = T extends Record<string, any>
  ? { [K in keyof T as K extends `${infer P}_${infer R}` ? `${P}${Capitalize<R>}` : K]:
      T[K] extends Array<infer U>
        ? Array<U extends Record<string, any> ? MegaType<U> : U>
        : T[K] extends Record<string, any>
          ? MegaType<T[K]>
          : T[K] }
  : T;

// ✅ 拆分为有意义的步骤
type CamelCase<S extends string> = S extends `${infer P}_${infer R}`
  ? `${P}${Capitalize<CamelCase<R>>}`
  : S;

type DeepCamelCase<T> = T extends Array<infer U>
  ? Array<DeepCamelCase<U>>
  : T extends object
    ? { [K in keyof T as CamelCase<string & K>]: DeepCamelCase<T[K]> }
    : T;
```

### 12.12.3 类型调试技巧

```typescript
// 1. 使用类型断言查看中间结果
type Debug<T> = T; // 在 IDE 中悬停查看

// 2. 利用 never 过滤
type ShowKeys<T> = keyof T; // 查看有哪些键

// 3. 利用函数参数查看推断结果
function debugType<T>(): T { throw new Error("debug"); }
const x = debugType<SomeComplexType>(); // 悬停查看类型

// 4. 使用 @ts-expect-error 测试类型关系
// @ts-expect-error —— 如果下面这行不报错，说明类型关系不对
const _: SomeType = someValue;
```

---

## 小结

| 特性 | 用途 | 难度 |
|------|------|------|
| 条件类型 | 类型分支选择 | ⭐⭐ |
| 分布式条件类型 | 联合类型逐成员处理 | ⭐⭐⭐ |
| `infer` | 模式匹配提取类型 | ⭐⭐⭐ |
| 映射类型 | 批量变换属性 | ⭐⭐ |
| 键重映射 | 过滤/变换键名 | ⭐⭐⭐ |
| 模板字面量类型 | 字符串模式匹配 | ⭐⭐⭐ |
| 递归类型 | 深层类型变换 | ⭐⭐⭐⭐ |
| 类型体操 | 综合运用 | ⭐⭐⭐⭐⭐ |