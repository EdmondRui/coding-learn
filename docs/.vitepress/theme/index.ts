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
 * On mobile (< 960px), intercept hamburger clicks to toggle the sidebar.
 * Provides open/close functionality via:
 * - Hamburger button (toggle)
 * - Backdrop click (close)
 * - Sidebar link click (close after navigation)
 */
function setupHamburgerToSidebar() {
  if (typeof window === 'undefined') return

  function closeSidebar() {
    const sidebar = document.querySelector('.VPSidebar') as HTMLElement
    const backdrop = document.querySelector('.VPBackdrop') as HTMLElement
    const navScreen = document.querySelector('.VPNavScreen') as HTMLElement
    const hamburger = document.querySelector('.VPNavBarHamburger') as HTMLElement

    if (sidebar) sidebar.classList.remove('open')
    if (backdrop) {
      backdrop.classList.remove('show')
      backdrop.style.display = 'none'
    }
    if (navScreen) {
      navScreen.style.display = 'none'
      navScreen.classList.remove('open')
    }
    if (hamburger) {
      hamburger.classList.remove('active')
      hamburger.setAttribute('aria-expanded', 'false')
    }
  }

  function openSidebar() {
    const sidebar = document.querySelector('.VPSidebar') as HTMLElement
    const backdrop = document.querySelector('.VPBackdrop') as HTMLElement
    const navScreen = document.querySelector('.VPNavScreen') as HTMLElement

    // Force close nav screen first
    if (navScreen) {
      navScreen.style.display = 'none'
      navScreen.classList.remove('open')
    }

    if (sidebar) {
      sidebar.classList.add('open')
    }
    if (backdrop) {
      backdrop.style.display = ''
      backdrop.classList.add('show')
    }
  }

  function handleHamburgerClick(e: MouseEvent) {
    // Only on mobile
    if (window.innerWidth >= 960) return

    const target = e.target as HTMLElement
    const hamburger = target.closest('.VPNavBarHamburger')
    if (!hamburger) return

    // Check if current page has a sidebar
    const sidebar = document.querySelector('.VPSidebar')
    if (!sidebar) return

    // Always prevent default (would open VPNavScreen)
    e.preventDefault()
    e.stopPropagation()

    // Toggle: if sidebar is open, close it; otherwise open it
    const isOpen = sidebar.classList.contains('open')
    if (isOpen) {
      closeSidebar()
    } else {
      openSidebar()
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('.VPBackdrop')) {
      closeSidebar()
    }
  }

  function handleSidebarLinkClick(e: MouseEvent) {
    // Close sidebar when clicking a link inside it (for SPA navigation)
    const target = e.target as HTMLElement
    const link = target.closest('.VPSidebar a')
    if (link) {
      // Small delay to let navigation happen first
      setTimeout(closeSidebar, 100)
    }
  }

  // Use capture phase to intercept before VitePress handler
  document.addEventListener('click', handleHamburgerClick, true)
  document.addEventListener('click', handleBackdropClick, true)
  document.addEventListener('click', handleSidebarLinkClick, true)

  return () => {
    document.removeEventListener('click', handleHamburgerClick, true)
    document.removeEventListener('click', handleBackdropClick, true)
    document.removeEventListener('click', handleSidebarLinkClick, true)
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