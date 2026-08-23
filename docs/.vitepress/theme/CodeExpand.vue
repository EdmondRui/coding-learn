<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { onContentUpdated } from 'vitepress'

const open = ref(false)
const lang = ref('')
const codeHtml = ref('')
const copied = ref(false)
const closeButton = ref(null)

const EXPAND_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="15" x2="10" y2="22"/></svg>'

let copyTimer = null

function injectButtons() {
  if (typeof document === 'undefined') return
  document
    .querySelectorAll('.vp-doc div[class*="language-"]')
    .forEach((block) => {
      if (block.querySelector(':scope > .expand-code-btn')) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'expand-code-btn'
      btn.title = '放大查看代码'
      btn.setAttribute('aria-label', '放大查看代码')
      btn.innerHTML = EXPAND_ICON
      block.appendChild(btn)
    })
}

function onDocClick(e) {
  const target = e.target instanceof Element ? e.target : null
  const btn = target?.closest('.expand-code-btn')
  if (!btn) return

  const block = btn.closest('div[class*="language-"]')
  const pre = block?.querySelector('pre')
  if (!block || !pre) return

  lang.value = block.querySelector(':scope > span.lang')?.textContent?.trim() || ''

  const clone = block.cloneNode(true)
  clone.querySelectorAll('.copy, .expand-code-btn, .lang').forEach((el) => el.remove())
  codeHtml.value = clone.outerHTML
  open.value = true
}

async function copyCode() {
  const text = document.querySelector('.code-expand-modal pre')?.textContent || ''
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = false), 2000)
  } catch {
    /* clipboard unavailable */
  }
}

function close() {
  open.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape' && open.value) close()
}

watch(open, (val) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = val ? 'hidden' : ''
  if (!val) return
  nextTick(() => closeButton.value?.focus())
})

onMounted(() => {
  injectButtons()
  document.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
  clearTimeout(copyTimer)
})

onContentUpdated(injectButtons)
</script>

<template>
  <Teleport to="body">
    <Transition name="code-modal">
      <div v-if="open" class="code-modal-backdrop" @click.self="close">
        <section class="code-expand-modal vp-doc" role="dialog" aria-modal="true" aria-label="代码查看器">
          <header class="code-modal-header">
            <span class="code-modal-lang">{{ lang }}</span>
            <div class="code-modal-actions">
              <button type="button" class="code-modal-copy" @click="copyCode">
                {{ copied ? '已复制' : '复制' }}
              </button>
              <button
                ref="closeButton"
                type="button"
                class="code-modal-close"
                aria-label="关闭"
                @click="close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </header>
          <div class="code-modal-body" v-html="codeHtml"></div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.code-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}

.code-expand-modal {
  display: flex;
  flex-direction: column;
  width: min(94vw, 1100px);
  max-height: min(85dvh, 92vh);
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
}

.code-modal-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 8px 8px 16px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.code-modal-lang {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  min-height: 1em;
}

.code-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.code-modal-copy,
.code-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background-color 0.2s;
}

.code-modal-copy {
  min-width: 56px;
  height: 36px;
  padding: 0 12px;
  font-size: 13px;
}

.code-modal-copy:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.code-modal-copy.copied {
  color: var(--vp-c-brand-1);
}

.code-modal-close {
  width: 36px;
  height: 36px;
}

.code-modal-close:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}

.code-modal-body {
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

/* Cloned code block: neutralize margins/radius inside the card */
.code-modal-body :deep(div[class*='language-']) {
  margin: 0 !important;
  border-radius: 0 !important;
}

.code-modal-body :deep(code) {
  padding: 16px 20px;
  font-size: 14px;
}

/* Transition */
.code-modal-enter-active,
.code-modal-leave-active {
  transition: opacity 0.18s ease;
}

.code-modal-enter-active .code-expand-modal,
.code-modal-leave-active .code-expand-modal {
  transition: transform 0.18s ease;
}

.code-modal-enter-from,
.code-modal-leave-to {
  opacity: 0;
}

.code-modal-enter-from .code-expand-modal,
.code-modal-leave-to .code-expand-modal {
  transform: scale(0.96);
}
</style>
