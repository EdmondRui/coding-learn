# 第 5 章：泛型与工具类型

## 5.1 为什么需要泛型

如果一个函数既要支持数字，也要支持字符串，还要保持“输入什么类型就返回什么类型”，就不能把类型写死。

```ts
function identity<T>(value: T): T {
  return value;
}
```

`T` 就是类型参数。

## 5.2 把泛型理解成“类型的参数”

普通函数参数是值的占位符，泛型参数是类型的占位符。

```ts
const a = identity<number>(123);
const b = identity("hello");
```

第二种写法由 TypeScript 自动推断 `T`。

## 5.3 泛型数组和多个泛型参数

```ts
function getFirst<T>(arr: T[]): T | undefined {
  return arr[0];
}

function pair<K, V>(key: K, value: V): [K, V] {
  return [key, value];
}
```

## 5.4 泛型约束

如果你要求传入的值必须具有 `length` 属性，可以这样写：

```ts
function getLength<T extends { length: number }>(value: T): number {
  return value.length;
}
```

这里的 `extends` 表示约束条件。

## 5.5 泛型接口

```ts
interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

type User = {
  id: number;
  name: string;
};

const response: ApiResponse<User> = {
  code: 200,
  message: "ok",
  data: {
    id: 1,
    name: "Tom"
  }
};
```

这在接口建模中非常常见。

## 5.6 内置工具类型

### `Partial<T>`

把所有属性都变成可选。

```ts
type User = {
  id: number;
  name: string;
  age: number;
};

type UserPatch = Partial<User>;
```

### `Required<T>`

把所有属性都变成必填。

### `Readonly<T>`

把所有属性都变成只读。

### `Pick<T, K>`

从原类型中挑出部分字段。

```ts
type UserPreview = Pick<User, "id" | "name">;
```

### `Omit<T, K>`

去掉某些字段。

```ts
type UserWithoutAge = Omit<User, "age">;
```

### `Record<K, T>`

构造键值映射对象。

```ts
type UserMap = Record<string, { id: number; name: string }>;
```

## 5.7 学工具类型的正确方式

不要死记名字，重点理解它们在做什么：

- `Pick`：挑字段
- `Omit`：去字段
- `Partial`：变可选
- `Readonly`：变只读
- `Record`：构造映射结构

## 5.8 泛型的实战判断标准

当你遇到下面这些情况时，通常说明该考虑泛型：

- 同一套逻辑要适配多种类型
- 你不想把类型写死
- 你希望保留输入和输出之间的类型关系

## 5.9 本章练习

1. 写一个泛型 `identity` 函数
2. 写一个 `getFirst<T>` 函数
3. 写一个 `ApiResponse<T>` 类型
4. 用 `Partial<T>` 表达更新对象
5. 用 `Pick<T, K>` 创建一个简化版用户类型
