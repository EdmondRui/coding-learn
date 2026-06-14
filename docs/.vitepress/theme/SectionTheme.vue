<script setup>
import { watch, onMounted } from 'vue'
import { useRoute, useData } from 'vitepress'

const route = useRoute()
const { isDark } = useData()

const sections = {
  go: {
    light: {
      '--vp-c-brand-1': '#16A34A',
      '--vp-c-brand-2': '#15803D',
      '--vp-c-brand-3': '#166534',
      '--vp-c-brand-soft': 'rgba(22, 163, 74, 0.10)'
    },
    dark: {
      '--vp-c-brand-1': '#22C55E',
      '--vp-c-brand-2': '#4ADE80',
      '--vp-c-brand-3': '#86EFAC',
      '--vp-c-brand-soft': 'rgba(34, 197, 94, 0.14)'
    }
  },
  python: {
    light: {
      '--vp-c-brand-1': '#3776AB',
      '--vp-c-brand-2': '#306998',
      '--vp-c-brand-3': '#264f7a',
      '--vp-c-brand-soft': 'rgba(55, 118, 171, 0.10)'
    },
    dark: {
      '--vp-c-brand-1': '#3776AB',
      '--vp-c-brand-2': '#4B8BBE',
      '--vp-c-brand-3': '#6FA8D6',
      '--vp-c-brand-soft': 'rgba(55, 118, 171, 0.14)'
    }
  },
  typescript: {
    light: {
      '--vp-c-brand-1': '#3178C6',
      '--vp-c-brand-2': '#235A97',
      '--vp-c-brand-3': '#1B4B7A',
      '--vp-c-brand-soft': 'rgba(49, 120, 198, 0.10)'
    },
    dark: {
      '--vp-c-brand-1': '#3178C6',
      '--vp-c-brand-2': '#5B9BD5',
      '--vp-c-brand-3': '#7DB8E8',
      '--vp-c-brand-soft': 'rgba(49, 120, 198, 0.14)'
    }
  },
  rust: {
    light: {
      '--vp-c-brand-1': '#CE422B',
      '--vp-c-brand-2': '#A3361F',
      '--vp-c-brand-3': '#7D2A18',
      '--vp-c-brand-soft': 'rgba(206, 66, 43, 0.10)'
    },
    dark: {
      '--vp-c-brand-1': '#E5533B',
      '--vp-c-brand-2': '#F07153',
      '--vp-c-brand-3': '#F5A08E',
      '--vp-c-brand-soft': 'rgba(229, 83, 59, 0.14)'
    }
  },
  default: {
    light: {
      '--vp-c-brand-1': '#6366F1',
      '--vp-c-brand-2': '#4F46E5',
      '--vp-c-brand-3': '#4338CA',
      '--vp-c-brand-soft': 'rgba(99, 102, 241, 0.10)'
    },
    dark: {
      '--vp-c-brand-1': '#818CF8',
      '--vp-c-brand-2': '#6366F1',
      '--vp-c-brand-3': '#A5B4FC',
      '--vp-c-brand-soft': 'rgba(129, 140, 248, 0.14)'
    }
  }
}

function applyTheme() {
  const path = route.path
  let section = 'default'

  if (path.includes('/go/')) section = 'go'
  else if (path.includes('/python/')) section = 'python'
  else if (path.includes('/rust/')) section = 'rust'
  else if (path.includes('/typescript/')) section = 'typescript'

  const mode = isDark.value ? 'dark' : 'light'
  const colors = sections[section][mode]
  const root = document.documentElement

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value)
  }
}

onMounted(applyTheme)
watch(() => route.path, applyTheme)
watch(isDark, applyTheme)
</script>

<template>
  <!-- No visual output — only sets CSS custom properties -->
</template>