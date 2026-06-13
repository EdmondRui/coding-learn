# 第 6 章：进阶类型、`keyof`、类与模块

## 6.1 `keyof`

`keyof` 用来获取一个对象类型的键名联合。

```ts
type User = {
  id: number;
  name: string;
  age: number;
};

type UserKeys = keyof User; // "id" | "name" | "age"
```

## 6.2 索引访问类型

可以取出某个属性对应的类型。

```ts
type UserName = User["name"]; // string
```

## 6.3 `typeof`

在类型上下文里，`typeof` 用来获取变量的类型。

```ts
const config = {
  apiBase: "/api",
  timeout: 5000
};

type Config = typeof config;
```

## 6.4 经典组合写法

```ts
function getValue<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

这是 TypeScript 中非常高频的一种模式。

## 6.5 交叉类型

交叉类型表示同时满足多个类型。

```ts
type Person = {
  name: string;
};

type Employee = {
  employeeId: number;
};

type Staff = Person & Employee;
```

## 6.6 条件类型和映射类型

这是更进阶的内容，现阶段先建立认知即可。

条件类型：

```ts
type IsString<T> = T extends string ? true : false;
```

映射类型：

```ts
type ReadonlyUser<T> = {
  readonly [K in keyof T]: T[K];
};
```

你不需要一开始就完全掌握它们，但要知道很多工具类型都建立在这些机制之上。

## 6.7 类

TypeScript 支持类，但本质上仍然是 JavaScript 类加上类型。

```ts
class User {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet(): string {
    return `Hello, ${this.name}`;
  }
}
```

## 6.8 访问修饰符

```ts
class Account {
  public username: string;
  private password: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
  }
}
```

常见修饰符：

- `public`
- `private`
- `protected`
- `readonly`

## 6.9 参数属性简写

```ts
class Product {
  constructor(
    public name: string,
    public price: number
  ) {}
}
```

## 6.10 继承与抽象类

```ts
class Animal {
  move() {
    console.log("move");
  }
}

class Dog extends Animal {
  bark() {
    console.log("wang");
  }
}
```

抽象类：

```ts
abstract class Shape {
  abstract getArea(): number;
}
```

## 6.11 模块

命名导出：

```ts
export function add(a: number, b: number): number {
  return a + b;
}
```

导入：

```ts
import { add } from "./math";
```

默认导出：

```ts
export default function greet(name: string) {
  return `Hello, ${name}`;
}
```

多数项目里，命名导出通常更利于重构和维护。

## 6.12 本章练习

1. 用 `keyof` 取出某个类型的键
2. 写一个 `getValue` 泛型函数
3. 写一个交叉类型，把两个对象结构合并
4. 写一个简单类，包含构造函数和方法
5. 创建一个导出函数并在另一个文件中导入
