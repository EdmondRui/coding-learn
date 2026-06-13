import DefaultTheme from 'vitepress/theme'
import SidebarBottom from './SidebarBottom.vue'
import BackToTop from './BackToTop.vue'
import ReadingProgress from './ReadingProgress.vue'
import SectionTheme from './SectionTheme.vue'
import HubHome from './HubHome.vue'
import { h, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import type { EnhanceAppContext } from 'vitepress'
import './custom.css'

const SCROLL_KEY = (path: string) => `scroll:${path}`

function saveScroll(path: string) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(SCROLL_KEY(path), String(window.scrollY))
}

function restoreScroll(path: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  const saved = sessionStorage.getItem(SCROLL_KEY(path))
  if (saved) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.scrollTo(0, Number(saved))
      }, 300)
    })
    return true
  }
  return false
}

function setupHamburgerToSidebar() {
  if (typeof window === 'undefined') return

  function handleHamburgerClick(e: MouseEvent) {
    if (window.innerWidth >= 960) return

    const target = e.target as HTMLElement
    const hamburger = target.closest('.VPNavBarHamburger')
    if (!hamburger) return

    const sidebar = document.querySelector('.VPSidebar')
    if (!sidebar) return

    e.preventDefault()
    e.stopPropagation()

    const navScreen = document.querySelector('.VPNavScreen') as HTMLElement
    if (navScreen) {
      navScreen.style.display = 'none'
    }

    const backdrop = document.querySelector('.VPBackdrop') as HTMLElement
    if (backdrop) {
      backdrop.style.display = 'none'
    }

    hamburger.classList.remove('active')
    hamburger.setAttribute('aria-expanded', 'false')

    sidebar.classList.add('open')
    if (backdrop) {
      backdrop.style.display = ''
      backdrop.classList.add('show')
    }
  }

  document.addEventListener('click', handleHamburgerClick, true)

  return () => {
    document.removeEventListener('click', handleHamburgerClick, true)
  }
}

export default {
  extends: DefaultTheme,

  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => h(SectionTheme),
      'sidebar-nav-after': () => h(SidebarBottom),
      'layout-bottom': () => h(BackToTop),
      'nav-bar-title-after': () => h(ReadingProgress)
    })
  },

  setup() {
    const route = useRoute()
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    let cleanupHamburger: (() => void) | undefined

    function onScroll() {
      if (scrollTimer) clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        saveScroll(route.path)
      }, 150)
    }

    onMounted(() => {
      window.addEventListener('scroll', onScroll, { passive: true })
      requestAnimationFrame(() => {
        restoreScroll(route.path)
      })
      cleanupHamburger = setupHamburgerToSidebar()
    })

    onBeforeUnmount(() => {
      window.removeEventListener('scroll', onScroll)
      if (scrollTimer) clearTimeout(scrollTimer)
      if (cleanupHamburger) cleanupHamburger()
    })

    watch(() => route.path, (path) => {
      nextTick(() => {
        restoreScroll(path)
      })
    })
  },

  enhanceApp({ app }: EnhanceAppContext) {
    app.component('SectionTheme', SectionTheme)
    app.component('HubHome', HubHome)
  }
}