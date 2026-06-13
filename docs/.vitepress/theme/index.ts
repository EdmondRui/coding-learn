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

function restoreScroll(path: string) {
  if (typeof sessionStorage === 'undefined') return
  // Try both path formats: with and without .html
  const saved = sessionStorage.getItem(SCROLL_KEY(path))
    || sessionStorage.getItem(SCROLL_KEY(path.replace(/\.html$/, '')))
    || sessionStorage.getItem(SCROLL_KEY(path + '.html'))
  if (saved) {
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.scrollTo(0, Number(saved))
      }, 300)
    })
  }
}

/**
 * Intercept hamburger clicks to open sidebar instead of NavScreen.
 * Uses VitePress's internal sidebar state via DOM class observation.
 */
function setupHamburgerToSidebar() {
  if (typeof window === 'undefined') return

  function handleHamburgerClick(e: MouseEvent) {
    // Only on mobile
    if (window.innerWidth >= 768) return

    const target = e.target as HTMLElement
    const hamburger = target.closest('.VPNavBarHamburger')
    if (!hamburger) return

    // Prevent default NavScreen behavior
    e.preventDefault()
    e.stopPropagation()

    // Toggle sidebar via VPLocalNav's menu button
    const menuButton = document.querySelector('.VPLocalNav .menu') as HTMLButtonElement
    if (menuButton) {
      menuButton.click()
    }
  }

  // Use capture phase to intercept before VitePress handler
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
      // Restore scroll position on initial load
      requestAnimationFrame(() => {
        restoreScroll(route.path)
      })
      // Setup hamburger → sidebar on mobile
      cleanupHamburger = setupHamburgerToSidebar()
    })

    onBeforeUnmount(() => {
      window.removeEventListener('scroll', onScroll)
      if (scrollTimer) clearTimeout(scrollTimer)
      if (cleanupHamburger) cleanupHamburger()
    })

    // Restore scroll position after route change
    watch(() => route.path, (path) => {
      nextTick(() => {
        restoreScroll(path)
      })
    })
  },

  enhanceApp({ app, router }: EnhanceAppContext) {
    app.component('SectionTheme', SectionTheme)
    app.component('HubHome', HubHome)

    if (router) {
      // Save scroll position BEFORE navigation (before VitePress scrolls to top)
      router.onBeforeRouteChange = (to: string) => {
        if (typeof window !== 'undefined') {
          saveScroll(window.location.pathname)
        }
      }

      // Restore scroll position AFTER navigation completes
      router.onAfterRouteChanged = (to: string) => {
        if (typeof window === 'undefined') return
        // Use a longer delay to ensure content is fully rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            restoreScroll(to)
          }, 300)
        })
      }
    }
  }
}