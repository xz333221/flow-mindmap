<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 'left' slides in from the left edge, 'right' from the right. */
    side?: 'left' | 'right'
    /** Pixels wide. */
    width?: number
    /** Show or hide the panel. Animation handles the transition. */
    open?: boolean
    /** Optional title shown in the header. */
    title?: string
  }>(),
  { side: 'left', width: 320, open: true, title: '' }
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Transition name="zm-drawer">
    <aside
      v-if="open"
      class="zm-drawer"
      :class="['zm-drawer--' + side, { 'is-open': open }]"
      :style="{ width: width + 'px' }"
      :aria-hidden="!open"
    >
      <div v-if="title || $slots.header" class="zm-drawer-header">
        <h3 v-if="title" class="zm-drawer-title">{{ title }}</h3>
        <slot name="header" />
        <button class="zm-drawer-close" title="关闭" @click="close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M6 6 L18 18 M18 6 L6 18" />
          </svg>
        </button>
      </div>
      <div class="zm-drawer-body">
        <slot />
      </div>
    </aside>
  </Transition>
</template>

<style>
.zm-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  overflow: hidden;
  flex-shrink: 0;
}
.zm-drawer-enter-active,
.zm-drawer-leave-active {
  transition: width 0.22s ease, opacity 0.15s ease;
}
.zm-drawer-enter-from,
.zm-drawer-leave-to {
  width: 0 !important;
  opacity: 0;
  border-right: none;
}
.zm-drawer--right {
  border-right: none;
  border-left: 1px solid #e2e8f0;
}
.zm-drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}
.zm-drawer-title {
  margin: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  letter-spacing: 0.02em;
}
.zm-drawer-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.zm-drawer-close:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.zm-drawer-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
</style>
