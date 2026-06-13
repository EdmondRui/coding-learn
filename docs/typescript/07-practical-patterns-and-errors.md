# 第 7 章：实战建模与常见报错

## 7.1 给接口返回值写类型

```ts
type User = {
  id: number;
  name: string;
};

type ApiResponse<T> = {
  code: number;
  message: string;
  data: T;
};

async function fetchUser(): Promise<ApiResponse<User>> {
  return {
    code: 200,
    message: "ok",
    data: {
      id: 1,
      name: "Tom"
    }
  };
}
```

这是泛型在真实项目中的典型应用。

## 7.2 配置对象建模

```ts
type AppConfig = {
  apiBase: string;
  timeout: number;
  retry: boolean;
};

const config: AppConfig = {
  apiBase: "/api",
  timeout: 5000,
  retry: true
};
```

配置对象非常适合用来练习对象建模。

## 7.3 表单和状态建模

推荐使用判别联合：

```ts
type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; orderId: string }
  | { status: "error"; message: string };
```

不推荐：

```ts
type SubmitState = {
  loading: boolean;
  orderId?: string;
  error?: string;
};
```

后者容易产生非法状态组合。

## 7.4 处理可空值

```ts
type User = {
  name: string;
  email?: string;
};

function sendEmail(user: User) {
  if (!user.email) {
    return;
  }

  console.log(`send to ${user.email}`);
}
```

不要轻易使用非空断言 `!`。  
只有在你非常确定值一定存在时才使用。

## 7.5 第三方库没有类型怎么办

先看三件事：

1. 这个库是否自带类型
2. 是否存在 `@types/xxx`
3. 如果都没有，再自己写声明

示例：

```ts
declare module "some-legacy-lib" {
  export function start(): void;
}
```

## 7.6 常见报错理解

### `Type 'A' is not assignable to type 'B'`

实际值和目标类型不兼容。

### `Property 'xxx' does not exist on type ...`

你在当前类型上访问了不存在的属性，通常是因为没有收窄，或者类型定义本身不对。

### `Object literal may only specify known properties`

你给对象字面量传了多余字段。

### `Argument of type ... is not assignable to parameter of type ...`

传给函数的参数不符合函数要求。

## 7.7 读 TypeScript 报错的顺序

建议始终按这个顺序看：

1. 哪一行报错
2. 实际类型是什么
3. 预期类型是什么
4. 差异在哪个字段或哪个分支

长报错不要慌，核心信息一般就这几项。

## 7.8 高风险坏习惯

- 遇错就改 `any`
- 用断言消除错误而不是解决错误
- 状态建模只靠一堆可选字段
- 关闭严格模式
- 不理解数据结构就先写代码

## 7.9 小型实战示例

```ts
type Role = "admin" | "user";

type User = {
  id: number;
  name: string;
  role: Role;
  email?: string;
};

type ApiResponse<T> =
  | { status: "success"; data: T }
  | { status: "error"; message: string };

function getUserDisplayName(user: User): string {
  return `${user.name}(${user.role})`;
}

function sendWelcomeEmail(user: User): void {
  if (!user.email) {
    console.log("No email provided");
    return;
  }

  console.log(`Send email to ${user.email}`);
}

function handleResponse(response: ApiResponse<User>) {
  if (response.status === "success") {
    console.log(getUserDisplayName(response.data));
  } else {
    console.error(response.message);
  }
}
```

这个例子把对象建模、可选属性、泛型、判别联合和收窄串了起来。
