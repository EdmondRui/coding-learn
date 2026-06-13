# Coding Learn

一个面向有经验开发者的编程进阶学习站点，整合 Go、Python、TypeScript 等多个语言/技术栈的进阶文档。

## 在线访问

<https://edmondrui.github.io/coding-learn/>

## 本地开发

```bash
npm install
npm run docs:dev
```

## 构建

```bash
npm run docs:build
```

## 项目结构

```
docs/
├── index.md              # 首页（Hub 页面）
├── go/                   # Go 进阶文档
├── python/               # Python 进阶文档
├── typescript/           # TypeScript 进阶文档
└── .vitepress/
    ├── config.mts        # VitePress 配置
    └── theme/            # 自定义主题
```

## 特性

- 单站点管理多语言/技术栈文档
- 路径区分的多侧边栏
- 区段品牌色动态切换（Go 绿 / Python 蓝 / TS 蓝 / 首页 Indigo）
- 移动端侧边栏底部主题切换 + GitHub 链接
- 阅读进度条、回到顶部、滚动位置记忆
- 中文本地搜索
- 深色开发者主题

## 许可证

MIT