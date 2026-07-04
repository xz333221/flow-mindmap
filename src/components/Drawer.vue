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
    /**
     * Overlay scope.
     *  - 'page'    : Drawer flows inside its parent (current behavior).
     *               The parent decides where the drawer lives.
     *  - 'canvas'  : Drawer floats over the parent — it becomes
     *               `position: absolute` and a clickable backdrop is
     *               rendered behind it. The backdrop fills the parent
     *               only, not the whole page, so it never covers tool-
     *               bars or sidebars that live outside the canvas.
     *               Default 'page'.
     */
    scope?: 'page' | 'canvas'
    /** Hide the close (×) button. Useful when the host wires keyboard
     *  or another control to close. */
    closable?: boolean
    /** Dismiss the drawer by clicking the backdrop. Default true. */
    closeOnBackdrop?: boolean
  }>(),
  { side: 'left', width: 320, open: true, title: '', scope: 'page', closable: true, closeOnBackdrop: true }
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

function close() {
  emit('update:open', false)
}
function onBackdropClick() {
  emit('update:open', false)
}
</script>

<template>
  <!-- scope=canvas: render the backdrop + the floating aside. Both
       are wrapped in a single root so v-if toggles the whole overlay
       in/out together. -->
  <template v-if="scope === 'canvas'">
    <Transition name="zm-fade">
      <div
        v-if="open"
        class="zm-drawer-canvas-backdrop"
        :aria-hidden="!open"
        @click="closeOnBackdrop && onBackdropClick()"
      />
    </Transition>
    <Transition :name="side === 'left' ? 'zm-slide-left' : 'zm-slide-right'">
      <aside
        v-if="open"
        class="zm-drawer zm-drawer--canvas"
        :class="['zm-drawer--' + side]"
        :style="{ width: width + 'px' }"
        :aria-hidden="!open"
      >
        <div v-if="title || $slots.header" class="zm-drawer-header">
          <h3 v-if="title" class="zm-drawer-title">{{ title }}</h3>
          <slot name="header" />
          <button
            v-if="closable"
            class="zm-drawer-close"
            title="关闭"
            @click="close"
          >
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

  <!-- scope=page: legacy flex-flow aside that takes layout space. -->
  <Transition v-else name="zm-drawer">
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
        <button
          v-if="closable"
          class="zm-drawer-close"
          title="关闭"
          @click="close"
        >
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
.zm-drawer--canvas {
  position: absolute;
  top: 0;
  bottom: 0;
  height: 100%;
  z-index: 40;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}
.zm-drawer--left.zm-drawer--canvas {
  left: 0;
  border-right: 1px solid #e2e8f0;
}
.zm-drawer--right.zm-drawer--canvas {
  right: 0;
  border-right: none;
  border-left: 1px solid #e2e8f0;
}
.zm-drawer-canvas-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.28);
  z-index: 39;
  cursor: pointer;
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
/* canvas-scope slide-in. Each direction uses its own Transition so
   the unused edge stays clean (no half-transformed state). */
.zm-slide-left-enter-active,
.zm-slide-left-leave-active,
.zm-slide-right-enter-active,
.zm-slide-right-leave-active {
  transition: transform 0.22s ease, opacity 0.18s ease;
}
.zm-slide-left-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}
.zm-slide-left-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}
.zm-slide-right-enter-from {
  transform: translateX(100%);
  opacity: 0;
}
.zm-slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
.zm-fade-enter-active,
.zm-fade-leave-active {
  transition: opacity 0.18s ease;
}
.zm-fade-enter-from,
.zm-fade-leave-to {
  opacity: 0;
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
