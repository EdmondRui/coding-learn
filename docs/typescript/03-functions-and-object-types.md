# 第 3 章：函数与对象类型

## 3.1 函数参数和返回值

函数是 TypeScript 中最值得认真写类型的地方。

```ts
function greet(name: string): string {
  return `Hello, ${name}`;
}
```

参数类型控制调用方式，返回值类型控制调用者如何使用结果。

## 3.2 可选参数和默认参数

```ts
function buildName(firstName: string, lastName?: string): string {
  return lastName ? `${firstName} ${lastName}` : firstName;
}

function createUser(name: string, role: string = "user"): string {
  return `${name}-${role}`;
}
```

## 3.3 剩余参数

```ts
function sum(...numbers: number[]): number {
  return numbers.reduce((total, n) => total + n, 0);
}
```

## 3.4 函数类型

函数本身也可以被描述为一种类型。

```ts
let handler: (message: string) => void;

handler = (message) => {
  console.log(message);
};
```

## 3.5 回调函数

```ts
function processUser(name: string, callback: (value: string) => void): void {
  callback(name);
}
```

这类写法在数组方法、事件监听、异步流程中非常常见。

## 3.6 对象类型的基本写法

```ts
let user: { name: string; age: number } = {
  name: "Tom",
  age: 20
};
```

临时对象可以这样写，但一旦结构复杂，就应该提取成独立类型。

## 3.7 类型别名 `type`

```ts
type User = {
  name: string;
  age: number;
};

const user: User = {
  name: "Tom",
  age: 20
};
```

## 3.8 接口 `interface`

```ts
interface User {
  name: string;
  age: number;
}
```

`type` 和 `interface` 都能描述对象结构。初学阶段不必纠结绝对边界，先把对象建模写清楚更重要。

## 3.9 如何选择 `type` 和 `interface`

可以先按这个标准理解：

- 组合联合类型、交叉类型时，`type` 更灵活
- 描述对象协议、类实现关系时，`interface` 很常见
- 团队没有强制规范时，两者都可以

## 3.10 可选属性和只读属性

```ts
type UserProfile = {
  name: string;
  age?: number;
};

type Point = {
  readonly x: number;
  readonly y: number;
};
```

## 3.11 索引签名

当你不知道对象有哪些键，但知道值的类型时，可以用索引签名：

```ts
type StringMap = {
  [key: string]: string;
};
```

但如果键名已知，优先把键写清楚。索引签名不该滥用。

## 3.12 函数参数设计建议

位置参数过多时，推荐改成对象参数：

不推荐：

```ts
function createOrder(userId: string, amount: number, currency: string, note?: string) {}
```

更推荐：

```ts
type CreateOrderParams = {
  userId: string;
  amount: number;
  currency: string;
  note?: string;
};

function createOrder(params: CreateOrderParams) {}
```

这样做的好处：

- 参数含义更清晰
- 便于扩展
- 类型更容易复用

## 3.13 本章练习

1. 写一个 `multiply(a, b)` 函数，参数和返回值都带类型
2. 写一个带默认参数的函数
3. 定义一个 `User` 类型，包含 `name`、`age`、`email?`
4. 写一个接收 `User` 类型参数的函数
5. 把一个 4 个位置参数的函数改成对象参数形式
