<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const showButton = ref(false)
const scrollY = ref(0)

function handleScroll() {
  scrollY.value = window.scrollY
  showButton.value = window.scrollY > 300
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <button
    class="back-to-top"
    :class="{ visible: showButton }"
    @click="scrollToTop"
    title="回到顶部"
    aria-label="回到顶部"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="18 15 12 9 6 15"></polyline>
    </svg>
  </button>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.25s ease, transform 0.25s ease, color 0.2s, border-color 0.2s, background 0.2s;
  pointer-events: none;
  z-index: 99;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.back-to-top.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.back-to-top:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

@media (max-width: 959px) {
  .back-to-top {
    bottom: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
  }
}
</style>