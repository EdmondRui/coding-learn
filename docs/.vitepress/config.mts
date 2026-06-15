import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Coding Learn',
  description: '面向开发者的编程进阶指南',
  lang: 'zh-CN',
  base: '/coding-learn/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/coding-learn/favicon.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap'
    }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: 'Go', link: '/go/', activeMatch: '/go/' },
      { text: 'Python', link: '/python/', activeMatch: '/python/' },
      { text: 'Rust', link: '/rust/', activeMatch: '/rust/' },
      { text: 'TypeScript', link: '/typescript/', activeMatch: '/typescript/' }
    ],

    sidebar: {
      '/go/': [
        {
          text: '开始',
          items: [
            { text: '阅读指南', link: '/go/' }
          ]
        },
        {
          text: '核心进阶',
          items: [
            { text: '第 1 章 并发编程深入', link: '/go/01-concurrency' },
            { text: '第 2 章 接口与泛型', link: '/go/02-interfaces-generics' },
            { text: '第 3 章 错误处理与测试', link: '/go/03-error-testing' },
            { text: '第 4 章 内存模型与性能调优', link: '/go/04-memory-performance' }
          ]
        },
        {
          text: '实战应用',
          items: [
            { text: '第 5 章 Web 开发', link: '/go/05-web-development' },
            { text: '第 6 章 数据库与缓存', link: '/go/06-database-cache' },
            { text: '第 7 章 微服务架构', link: '/go/07-microservices' },
            { text: '第 8 章 网络编程', link: '/go/08-network-programming' }
          ]
        },
        {
          text: '工程化',
          items: [
            { text: '第 9 章 工程化实践', link: '/go/09-engineering' },
            { text: '第 10 章 高级模式与实战', link: '/go/10-advanced-patterns' }
          ]
        },
        {
          text: '深度剖析',
          items: [
            { text: '第 13 章 Goroutine 深度剖析', link: '/go/13-goroutine-deep-dive' },
            { text: '第 14 章 高级并发模式', link: '/go/14-concurrency-patterns-advanced' },
            { text: '第 15 章 内存管理与 GC 深度', link: '/go/15-memory-gc-deep-dive' },
            { text: '第 16 章 反射、unsafe 与 CGo 进阶', link: '/go/16-reflect-unsafe-cgo' }
          ]
        },
        {
          text: '解决方案与设计模式',
          items: [
            { text: '第 11 章 常见技术解决方案', link: '/go/11-common-solutions' },
            { text: '第 12 章 设计模式', link: '/go/12-design-patterns' }
          ]
        }
      ],

      '/python/': [
        {
          text: '开始',
          items: [
            { text: '阅读指南', link: '/python/' }
          ]
        },
        {
          text: '核心进阶',
          items: [
            { text: '第 1 章 高级特性', link: '/python/01-advanced-features' },
            { text: '第 2 章 异步编程', link: '/python/02-async-programming' },
            { text: '第 3 章 网络编程', link: '/python/03-network-programming' },
            { text: '第 4 章 Web 开发基础', link: '/python/04-web-fundamentals' }
          ]
        },
        {
          text: '实战应用',
          items: [
            { text: '第 5 章 FastAPI 现代开发', link: '/python/05-fastapi-development' },
            { text: '第 6 章 Django 全栈开发', link: '/python/06-django-fullstack' },
            { text: '第 7 章 脚本开发与自动化', link: '/python/07-scripting-automation' },
            { text: '第 8 章 数据库高级操作', link: '/python/08-database-advanced' }
          ]
        },
        {
          text: '工程化',
          items: [
            { text: '第 9 章 测试与性能调优', link: '/python/09-testing-performance' },
            { text: '第 10 章 部署与运维', link: '/python/10-deployment-ops' }
          ]
        },
        {
          text: '解决方案与设计模式',
          items: [
            { text: '第 11 章 常见技术解决方案', link: '/python/11-common-solutions' },
            { text: '第 12 章 设计模式', link: '/python/12-design-patterns' }
          ]
        }
      ],

      '/rust/': [
        {
          text: '开始',
          items: [
            { text: '阅读指南', link: '/rust/' }
          ]
        },
        {
          text: '基础篇',
          items: [
            { text: '第 1 章 入门与环境搭建', link: '/rust/01-getting-started' },
            { text: '第 2 章 基础语法与变量', link: '/rust/02-basic-syntax' },
            { text: '第 3 章 所有权与借用', link: '/rust/03-ownership-borrowing' },
            { text: '第 4 章 结构体、枚举与模式匹配', link: '/rust/04-structs-enums-patterns' },
            { text: '第 5 章 错误处理', link: '/rust/05-error-handling' },
            { text: '第 6 章 特征与泛型', link: '/rust/06-traits-generics' },
            { text: '第 7 章 模块与包管理', link: '/rust/07-modules-crates' }
          ]
        },
        {
          text: '进阶篇',
          items: [
            { text: '第 8 章 集合与迭代器', link: '/rust/08-collections-iterators' },
            { text: '第 9 章 智能指针与生命周期', link: '/rust/09-smart-pointers-lifetimes' },
            { text: '第 10 章 并发编程', link: '/rust/10-concurrency' },
            { text: '第 11 章 异步编程', link: '/rust/11-async-programming' },
            { text: '第 12 章 宏与元编程', link: '/rust/12-macros' },
            { text: '第 13 章 Unsafe Rust 与 FFI', link: '/rust/13-unsafe-ffi' }
          ]
        },
        {
          text: '实战篇',
          items: [
            { text: '第 14 章 Web 开发', link: '/rust/14-web-development' },
            { text: '第 15 章 数据库与缓存', link: '/rust/15-database-cache' },
            { text: '第 16 章 命令行工具开发', link: '/rust/16-cli-development' },
            { text: '第 17 章 系统编程', link: '/rust/17-systems-programming' },
            { text: '第 18 章 测试与基准测试', link: '/rust/18-testing-benchmarking' },
            { text: '第 19 章 部署与最佳实践', link: '/rust/19-deployment-best-practices' }
          ]
        },
        {
          text: '解决方案与设计模式',
          items: [
            { text: '第 20 章 常见技术解决方案', link: '/rust/20-common-solutions' },
            { text: '第 21 章 设计模式', link: '/rust/21-design-patterns' }
          ]
        }
      ],

      '/typescript/': [
        {
          text: '开始',
          items: [
            { text: '阅读指南', link: '/typescript/' }
          ]
        },
        {
          text: '基础篇',
          items: [
            { text: '第 1 章 认识 TypeScript 与环境搭建', link: '/typescript/01-introduction-and-setup' },
            { text: '第 2 章 基础类型', link: '/typescript/02-basic-types' },
            { text: '第 3 章 函数与对象类型', link: '/typescript/03-functions-and-object-types' },
            { text: '第 4 章 联合类型、类型收窄与断言', link: '/typescript/04-unions-narrowing-and-assertions' }
          ]
        },
        {
          text: '进阶篇',
          items: [
            { text: '第 5 章 泛型与工具类型', link: '/typescript/05-generics-and-utility-types' },
            { text: '第 6 章 进阶类型、keyof、类与模块', link: '/typescript/06-advanced-types-and-classes' },
            { text: '第 7 章 实战建模与常见报错', link: '/typescript/07-practical-patterns-and-errors' }
          ]
        },
        {
          text: '工程化',
          items: [
            { text: '第 8 章 学习路线与练习建议', link: '/typescript/08-learning-path-and-exercises' },
            { text: '第 9 章 tsconfig 与语法速查', link: '/typescript/09-tsconfig-and-cheatsheet' }
          ]
        },
        {
          text: '高级篇',
          items: [
            { text: '第 12 章 高级类型系统', link: '/typescript/12-advanced-type-system' },
            { text: '第 13 章 Node.js 开发实践', link: '/typescript/13-nodejs-development' },
            { text: '第 14 章 前端工程化与 React 类型实践', link: '/typescript/14-frontend-engineering' },
            { text: '第 15 章 事件循环与异步机制', link: '/typescript/15-event-loop' },
            { text: '第 16 章 Node.js 事件循环与性能', link: '/typescript/16-nodejs-event-loop' }
          ]
        },
        {
          text: '解决方案与设计模式',
          items: [
            { text: '第 10 章 常见技术解决方案', link: '/typescript/10-common-solutions' },
            { text: '第 11 章 设计模式', link: '/typescript/11-design-patterns' }
          ]
        }
      ]
    },

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            placeholder: '搜索文档',
            translations: {
              button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询条件',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
              }
            }
          }
        }
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/EdmondRui/coding-learn' }
    ],

    editLink: {
      pattern: 'https://github.com/EdmondRui/coding-learn/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页'
    },

    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024-present Coding Learn'
    },

    outline: {
      label: '本章目录',
      level: [2, 3]
    },

    docFooter: {
      prev: '上一章',
      next: '下一章'
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  },

  markdown: {
    lineNumbers: true
  }
})