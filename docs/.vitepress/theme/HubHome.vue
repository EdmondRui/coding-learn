<script setup>
import { withBase } from 'vitepress'

const sections = [
  {
    name: 'Go',
    href: '/go/',
    firstChapter: '/go/01-concurrency',
    logo: '/go-logo.svg',
    accent: '#22C55E',
    desc: '并发编程 · 接口与泛型 · 性能调优 · 微服务架构',
    chapters: '10 章'
  },
  {
    name: 'Python',
    href: '/python/',
    firstChapter: '/python/01-advanced-features',
    logo: '/python-logo.svg',
    accent: '#3776AB',
    desc: '异步编程 · Web 开发 · 脚本自动化 · 部署运维',
    chapters: '10 章'
  },
  {
    name: 'TypeScript',
    href: '/typescript/',
    firstChapter: '/typescript/01-introduction-and-setup',
    logo: '/ts-logo.svg',
    accent: '#3178C6',
    desc: '类型系统 · 泛型与工具类型 · 实战建模 · 工程化配置',
    chapters: '9 章'
  }
]
</script>

<template>
  <div class="hub">
    <div class="hub-hero">
      <div class="hub-hero-badge">开源 · 免费 · 持续更新</div>
      <h1 class="hub-hero-title">Coding Learn</h1>
      <p class="hub-hero-subtitle">面向开发者的编程进阶指南</p>
      <p class="hub-hero-desc">跳过基础语法，聚焦进阶特性、实战应用与工程化实践</p>
    </div>

    <div class="hub-cards">
      <a
        v-for="s in sections"
        :key="s.name"
        :href="withBase(s.href)"
        class="hub-card"
        :style="{ '--card-accent': s.accent }"
      >
        <div class="hub-card-accent-bar"></div>
        <div class="hub-card-body">
          <img :src="withBase(s.logo)" :alt="s.name" class="hub-card-logo" />
          <h2 class="hub-card-title">{{ s.name }}</h2>
          <p class="hub-card-desc">{{ s.desc }}</p>
          <div class="hub-card-meta">
            <span class="hub-card-chapters">{{ s.chapters }}</span>
          </div>
          <span class="hub-card-cta">开始学习 →</span>
        </div>
      </a>
    </div>

    <div class="hub-footer-note">
      <p>更多语言文档持续添加中 · Rust / Java / Kotlin 敬请期待</p>
    </div>
  </div>
</template>

<style scoped>
.hub {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 24px 80px;
}

.hub-hero {
  text-align: center;
  padding: 60px 0 48px;
}

.hub-hero-badge {
  display: inline-block;
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 999px;
  padding: 4px 14px;
  margin-bottom: 20px;
}

.hub-hero-title {
  font-family: var(--vp-font-family-mono);
  font-size: 3.5rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0 0 16px;
  background: linear-gradient(135deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hub-hero-subtitle {
  font-family: var(--vp-font-family-base);
  font-size: 1.35rem;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
  font-weight: 500;
}

.hub-hero-desc {
  font-family: var(--vp-font-family-base);
  font-size: 1rem;
  color: var(--vp-c-text-2);
  margin: 0;
  font-weight: 400;
}

.hub-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  margin-top: 48px;
}

.hub-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 16px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
}

.hub-card:hover {
  transform: translateY(-4px);
  border-color: var(--card-accent);
  box-shadow: 0 8px 30px -12px var(--card-accent);
}

.hub-card-accent-bar {
  height: 3px;
  background: var(--card-accent);
  transition: height 0.2s ease;
}

.hub-card:hover .hub-card-accent-bar {
  height: 4px;
}

.hub-card-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 24px 28px;
  text-align: center;
}

.hub-card-logo {
  width: 56px;
  height: 56px;
  margin-bottom: 16px;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
}

.hub-card-title {
  font-family: var(--vp-font-family-mono);
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 8px;
  letter-spacing: -0.01em;
}

.hub-card-desc {
  font-family: var(--vp-font-family-base);
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
  line-height: 1.5;
}

.hub-card-meta {
  margin-bottom: 16px;
}

.hub-card-chapters {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-mute);
  padding: 3px 10px;
  border-radius: 999px;
}

.hub-card-cta {
  display: inline-block;
  font-family: var(--vp-font-family-base);
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--card-accent);
  transition: transform 0.15s ease;
}

.hub-card:hover .hub-card-cta {
  transform: translateX(4px);
}

.hub-footer-note {
  text-align: center;
  margin-top: 48px;
  padding-top: 32px;
  border-top: 1px solid var(--vp-c-divider);
}

.hub-footer-note p {
  font-family: var(--vp-font-family-base);
  font-size: 0.88rem;
  color: var(--vp-c-text-3);
  margin: 0;
}

@media (max-width: 768px) {
  .hub {
    padding: 24px 16px 60px;
  }

  .hub-hero {
    padding: 32px 0 32px;
  }

  .hub-hero-title {
    font-size: 2.25rem;
  }

  .hub-hero-subtitle {
    font-size: 1.1rem;
  }

  .hub-cards {
    grid-template-columns: 1fr;
    gap: 16px;
    margin-top: 32px;
  }

  .hub-card-body {
    padding: 24px 20px 20px;
  }

  .hub-card-logo {
    width: 44px;
    height: 44px;
  }

  .hub-card-title {
    font-size: 1.25rem;
  }
}

@media (min-width: 769px) and (max-width: 959px) {
  .hub-cards {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .hub-card-body {
    flex-direction: row;
    text-align: left;
    align-items: center;
    gap: 16px;
    padding: 20px 24px;
  }

  .hub-card-logo {
    margin-bottom: 0;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }

  .hub-card-body > :not(.hub-card-logo) {
    text-align: left;
  }
}
</style>