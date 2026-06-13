# 第 9 章：`tsconfig` 实用建议与语法速查

## 9.1 推荐重点关注的 `tsconfig` 配置

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

这些配置的作用分别是：

- `strict`：严格模式总开关
- `noImplicitAny`：禁止隐式 `any`
- `strictNullChecks`：让你认真处理空值
- `noUnusedLocals`：发现未使用变量
- `noUnusedParameters`：发现未使用参数
- `noFallthroughCasesInSwitch`：减少 `switch` 漏写 `break` 的问题

如果你的目标是真正学会 TypeScript，建议把严格模式长期打开。

## 9.2 常用命令速查

初始化配置：

```bash
tsc --init
```

检查类型但不输出文件：

```bash
tsc --noEmit
```

编译单个文件：

```bash
tsc index.ts
```

编译整个项目：

```bash
tsc
```

## 9.3 常用语法速查

```ts
let name: string = "Tom";
let age: number = 18;
let ok: boolean = true;

let list: number[] = [1, 2, 3];
let tuple: [number, string] = [1, "a"];

type User = {
  id: number;
  name: string;
  email?: string;
};

interface Product {
  id: number;
  title: string;
}

function add(a: number, b: number): number {
  return a + b;
}

type Status = "idle" | "loading" | "success" | "error";

function identity<T>(value: T): T {
  return value;
}

type Keys = keyof User;
type NameType = User["name"];
type PartialUser = Partial<User>;
type UserPreview = Pick<User, "id" | "name">;
```

## 9.4 初学阶段最值得记住的原则

- 先学会写清楚的类型，不要追求复杂炫技
- 遇到报错先分析，不要先上断言
- 优先使用联合类型和判别联合表达状态
- 能用 `unknown` 就别直接用 `any`
- 函数、对象、接口返回值是最值得认真建模的地方

## 9.5 最后总结

TypeScript 的核心价值不是“让代码更难”，而是：

- 让错误更早暴露
- 让意图更清晰
- 让重构更安全
- 让协作成本更低

如果你把它用于表达真实业务约束，而不是只记零散语法，它会很快成为你开发过程中最稳定的一层保护。
