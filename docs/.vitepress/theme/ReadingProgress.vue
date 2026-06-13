<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useData } from 'vitepress'

const { frontmatter } = useData()
const progress = ref(0)

function updateProgress() {
  const scrollTop = window.scrollY
  const docHeight = document.documentElement.scrollHeight - window.innerHeight
  if (docHeight > 0) {
    progress.value = Math.min(scrollTop / docHeight, 1)
  } else {
    progress.value = 0
  }
}

onMounted(() => {
  window.addEventListener('scroll', updateProgress, { passive: true })
  updateProgress()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updateProgress)
})
</script>

<template>
  <div
    v-if="frontmatter.layout !== 'home'"
    class="reading-progress"
    :style="{ transform: `scaleX(${progress})` }"
  />
</template>

<style scoped>
.reading-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--vp-c-brand-1);
  transform-origin: left;
  z-index: 100;
  transition: transform 0.1s ease-out;
}
</style>