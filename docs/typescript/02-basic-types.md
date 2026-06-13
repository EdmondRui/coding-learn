# 第 2 章：基础类型

## 2.1 原始类型

TypeScript 最基础的类型包括：

- `string`
- `number`
- `boolean`

```ts
let username: string = "moon";
let age: number = 18;
let isAdmin: boolean = false;
```

如果初始值很明确，TypeScript 也能自动推断：

```ts
let city = "Shanghai";
let score = 100;
let ok = true;
```

## 2.2 数组

```ts
let scores: number[] = [90, 95, 100];
let names: Array<string> = ["Alice", "Bob"];
```

`number[]` 和 `Array<number>` 是等价的。项目里更常见的是前者。

## 2.3 元组

元组适用于“长度固定、每个位置类型固定”的数组。

```ts
let user: [number, string] = [1, "Tom"];
```

常见使用场景：

- `[状态码, 数据]`
- `[key, value]`
- `[lng, lat]`

## 2.4 枚举

```ts
enum Direction {
  Up,
  Down,
  Left,
  Right
}
```

枚举可以用，但现代项目中更推荐联合字面量类型：

```ts
type DirectionType = "up" | "down" | "left" | "right";
```

原因是它更接近 JavaScript，也更轻量。

## 2.5 `any`

`any` 表示关闭类型检查。

```ts
let value: any = 123;
value = "hello";
value = true;
```

问题在于它会让 TypeScript 失去保护能力：

```ts
let data: any = "abc";
data.toFixed(); // 编译不报错，运行时可能报错
```

原则：能不用 `any` 就不用。

## 2.6 `unknown`

`unknown` 表示“类型未知”，比 `any` 安全得多。

```ts
let input: unknown = "hello";
```

你不能直接使用它，必须先判断：

```ts
if (typeof input === "string") {
  console.log(input.toUpperCase());
}
```

当你不确定值的类型时，优先考虑 `unknown`。

## 2.7 `void`

通常用于表示函数没有返回值。

```ts
function logMessage(message: string): void {
  console.log(message);
}
```

## 2.8 `null` 和 `undefined`

严格模式下，它们是独立类型。

```ts
let a: null = null;
let b: undefined = undefined;
```

实际开发中更常见的是联合使用：

```ts
let currentUser: string | null = null;
```

## 2.9 `never`

`never` 表示不可能出现的值。

```ts
function throwError(message: string): never {
  throw new Error(message);
}
```

它常出现在：

- 永远抛异常的函数
- 不会结束的函数
- 被收窄后不可能命中的分支

## 2.10 类型推断与类型注解

TypeScript 会尽量自动推断类型，所以不是每个变量都要手动标注。

推荐：

```ts
const name = "Alice";
const age = 20;
```

不要为了“看起来更严格”而对所有简单变量都强行加类型。

## 2.11 什么时候显式写类型

这些地方建议写：

- 函数参数
- 返回值重要的函数
- 复杂对象
- 对外暴露的 API
- 类型推断不够直观的地方

## 2.12 本章易错点

- 不要把 `any` 当作修错工具
- 不要把所有变量都手写类型
- `null` 和 `undefined` 在严格模式下不能乱用
- `unknown` 不能直接操作，必须先收窄

## 2.13 本章练习

1. 定义一个 `bookTitle` 变量，类型为 `string`
2. 定义一个 `prices` 数组，元素必须是 `number`
3. 定义一个元组，表示 `[id, name]`
4. 定义一个 `unknown` 类型变量，并通过判断后调用字符串方法
5. 写一个返回 `void` 的日志函数
