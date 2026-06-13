# 第 1 章：认识 TypeScript 与环境搭建

## 1.1 TypeScript 是什么

TypeScript 是 JavaScript 的超集。它保留了 JavaScript 的语法和运行方式，同时增加了静态类型系统，让很多错误可以在编写阶段被发现，而不是等代码运行后才暴露。

你可以把它理解成：

- 你写的是更严格、更清晰的 JavaScript
- TypeScript 编译后仍然是 JavaScript
- 它的价值主要体现在工程协作、代码维护和重构安全上

## 1.2 为什么要学 TypeScript

TypeScript 最重要的价值有三点：

- 更早发现错误
- 更好地表达代码意图
- 更强的编辑器支持

示例：

```ts
function add(a: number, b: number) {
  return a + b;
}

add(1, 2);
add("1", 2); // 编译时报错
```

在 JavaScript 中，这种问题往往拖到运行时才出现。TypeScript 把问题提前了。

## 1.3 初学者应该建立的认知

学习 TypeScript 时，不要一开始就把目标定成“掌握所有高级语法”。更现实的路径是：

1. 学会给常见数据写类型
2. 学会给函数写参数和返回值类型
3. 学会看懂错误信息
4. 学会用类型描述真实业务结构

TypeScript 的核心不是语法，而是建模能力。

## 1.4 安装 TypeScript

你需要先安装 Node.js。然后有两种常见安装方式。

全局安装：

```bash
npm install -g typescript
```

项目内安装：

```bash
npm install -D typescript
```

更推荐项目内安装，因为项目之间可以使用不同版本。

查看版本：

```bash
tsc -v
```

## 1.5 第一个 TypeScript 文件

创建 `index.ts`：

```ts
const message: string = "Hello TypeScript";
console.log(message);
```

编译：

```bash
tsc index.ts
```

执行：

```bash
node index.js
```

## 1.6 `tsconfig.json` 是什么

`tsconfig.json` 是 TypeScript 项目的配置文件，用来控制编译规则、严格程度、模块格式和输出目录等。

初始化：

```bash
tsc --init
```

一个基础配置：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

建议你现在先记住这些配置：

- `target`：编译后的 JavaScript 版本
- `module`：模块系统
- `strict`：严格模式总开关，建议始终开启
- `outDir`：输出目录
- `include`：哪些文件参与编译

## 1.7 推荐的学习工作流

初学 TypeScript，建议采用这种练习流程：

1. 每个知识点单独写一个 `.ts` 文件
2. 用 `tsc --noEmit` 只做类型检查
3. 修正错误后再执行代码
4. 比较“编译期报错”和“运行时行为”的差异

示例：

```bash
tsc --noEmit
```

## 1.8 学习本章的目标

学完这一章，你应该知道：

- TypeScript 和 JavaScript 的关系
- 它解决什么问题
- 怎么安装和运行 TypeScript
- `tsconfig.json` 的基本作用
- 为什么严格模式很重要

如果这些点还不熟，不要急着学泛型。先把开发环境和基本工作流用顺。
