# 第 4 章：联合类型、类型收窄与类型断言

## 4.1 联合类型

联合类型表示一个值可能是多种类型之一。

```ts
let id: string | number;

id = 1;
id = "A1001";
```

联合类型是 TypeScript 真正开始变得有用的一个分水岭。

## 4.2 字面量类型

```ts
type Status = "idle" | "loading" | "success" | "error";
type Role = "admin" | "editor" | "user";
```

字面量联合比单纯的 `string` 更严格，也更能表达业务范围。

## 4.3 为什么需要类型收窄

如果一个值是 `string | number`，你不能直接调用字符串方法或数字方法。必须先判断。

```ts
function printId(id: string | number) {
  if (typeof id === "string") {
    console.log(id.toUpperCase());
  } else {
    console.log(id.toFixed(2));
  }
}
```

## 4.4 `typeof` 收窄

适合处理原始类型：

- `string`
- `number`
- `boolean`
- `undefined`
- `function`
- `object`

## 4.5 `instanceof` 收窄

```ts
function formatDate(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}
```

适合处理类实例。

## 4.6 `in` 收窄

```ts
type Cat = { meow: () => void };
type Dog = { bark: () => void };

function speak(animal: Cat | Dog) {
  if ("meow" in animal) {
    animal.meow();
  } else {
    animal.bark();
  }
}
```

适合处理对象结构差异。

## 4.7 自定义类型守卫

```ts
type Admin = {
  name: string;
  permissions: string[];
};

type NormalUser = {
  name: string;
  loginTime: Date;
};

function isAdmin(user: Admin | NormalUser): user is Admin {
  return "permissions" in user;
}
```

使用：

```ts
function handleUser(user: Admin | NormalUser) {
  if (isAdmin(user)) {
    console.log(user.permissions);
  } else {
    console.log(user.loginTime);
  }
}
```

这是实战中非常重要的能力。

## 4.8 类型断言

类型断言表示“我比编译器更清楚这个值的类型”。

```ts
const value: unknown = "hello";
const len = (value as string).length;
```

## 4.9 断言不是转换

```ts
const num = "123" as unknown as number;
```

这不会把字符串真正变成数字，它只是让编译器暂时相信你。

## 4.10 什么时候可以用断言

适合：

- 你已经通过逻辑保证类型正确
- DOM 操作
- 第三方库类型不完整
- 从 `unknown` 过渡到明确类型

不适合：

- 单纯为了让报错消失
- 你自己也不确定它是什么类型

## 4.11 判别联合

这是联合类型最实用的模式之一。

```ts
type LoadingState = {
  status: "loading";
};

type SuccessState = {
  status: "success";
  data: string[];
};

type ErrorState = {
  status: "error";
  message: string;
};

type RequestState = LoadingState | SuccessState | ErrorState;
```

使用时：

```ts
function handleState(state: RequestState) {
  switch (state.status) {
    case "loading":
      console.log("Loading...");
      break;
    case "success":
      console.log(state.data);
      break;
    case "error":
      console.log(state.message);
      break;
  }
}
```

它的优势在于能把非法状态排除掉。

## 4.12 本章练习

1. 定义一个 `Role` 联合类型
2. 写一个函数，参数是 `string | number`，并分别处理
3. 写一个自定义类型守卫
4. 用判别联合建模一个请求状态
5. 故意写一个错误断言，理解为什么它危险
