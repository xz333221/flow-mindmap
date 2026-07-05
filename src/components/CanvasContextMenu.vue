<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    /** Cursor X in viewport coords (clientX). */
    x: number
    /** Cursor Y in viewport coords (clientY). */
    y: number
    /** Container the menu should not escape.  Used to clamp the
     *  position so the menu stays on-screen. */
    container: HTMLElement | null
  }>(),
  {}
)

const emit = defineEmits<{
  (e: 'openSettings'): void
  (e: 'openData'): void
  (e: 'openImport', mode: 'markdown' | 'json' | 'txt'): void
  (e: 'close'): void
}>()

interface ClampedPos { left: number; top: number }
const clamped = computed<ClampedPos>(() => {
  // Default: place top-left at the cursor with a small offset so
  // the cursor isn't right on the first item.
  let left = props.x + 2
  let top = props.y + 2
  // Clamp to the container if provided -- keeps the menu inside
  // the canvas instead of spilling off-screen.
  if (props.container) {
    const rect = props.container.getBoundingClientRect()
    // The main menu grows with content; 160 is enough for the
    // three items including the caret on the middle one.
    const menuWidth = 160
    const menuHeight = 4 + 3 * 28
    if (left + menuWidth > rect.right) {
      left = Math.max(rect.left + 4, props.x - menuWidth - 2)
    }
    if (top + menuHeight > rect.bottom) {
      top = Math.max(rect.top + 4, props.y - menuHeight - 2)
    }
    if (left < rect.left + 2) left = rect.left + 2
    if (top < rect.top + 2) top = rect.top + 2
  }
  return { left, top }
})

// ============================================================================
// Cascading import submenu
// ============================================================================
//
// On hover of the "导入" item, a submenu slides out to the right
// listing the three import modes.  We use a short time-based
// debounce so the submenu doesn't flicker when the cursor moves
// between the parent item and the submenu.  The submenu is
// absolutely positioned inside the parent item (CSS: left:100%,
// top:-4px, margin-left:4px) so it always sits flush against the
// parent with only a small 4px gap -- no more huge hard-coded
// offset, no more gap to the main menu.

const submenuOpen = ref(false)

// Ref to the import item container.  Used to compute the
// submenu's position so it sits flush against the parent's right
// edge and stays on-screen even when the main menu is near the
// viewport's right edge.
const importItemRef = ref<HTMLElement | null>(null)

// Computed style for the submenu.  We measure the parent item
// each time the submenu opens and pick a position that keeps the
// submenu inside the viewport.  When the parent is near the right
// edge, we flip the submenu to the left of the parent.
const submenuStyle = computed<Record<string, string>>(() => {
  if (!importItemRef.value) return { left: '-9999px', top: '-9999px', display: 'none' }
  const rect = importItemRef.value.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Approximate the submenu dimensions.  We don't measure the
  // element itself because it's not yet rendered (v-if is false at
  // the moment we compute).  176 = min-width 160 + 2 * border 1
  // + 2 * padding 4 + a small safety margin.
  const subW = 176
  const subH = 4 + 3 * 28
  // Prefer the right of the parent.  If that would push the
  // submenu past the viewport's right edge, flip to the left.
  let left = rect.right
  if (left + subW > vw - 4) {
    left = Math.max(4, rect.left - subW)
  }
  // Vertically: align with the parent top minus 4px.
  let top = rect.top - 4
  if (top + subH > vh - 4) {
    top = Math.max(4, vh - subH - 4)
  }
  return { left: left + 'px', top: top + 'px', display: 'block' }
})
let submenuEnterTimer: ReturnType<typeof setTimeout> | null = null
let submenuLeaveTimer: ReturnType<typeof setTimeout> | null = null

function onSubmenuEnter() {
  if (submenuLeaveTimer) {
    clearTimeout(submenuLeaveTimer)
    submenuLeaveTimer = null
  }
  submenuEnterTimer = setTimeout(() => {
    submenuOpen.value = true
  }, 60)
}
function onSubmenuLeave() {
  if (submenuEnterTimer) {
    clearTimeout(submenuEnterTimer)
    submenuEnterTimer = null
  }
  submenuLeaveTimer = setTimeout(() => {
    submenuOpen.value = false
  }, 120)
}

onBeforeUnmount(() => {
  if (submenuEnterTimer) clearTimeout(submenuEnterTimer)
  if (submenuLeaveTimer) clearTimeout(submenuLeaveTimer)
})

// ============================================================================
// Outside-click / Esc / scroll dismissal
// ============================================================================
//
// Wire window-level listeners to close the menu on outside click /
// Esc / scroll.  Caller invokes `emit('close')` to dismiss; the
// parent flips `showMenu` to false and unmounts us.
function onWindowMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (target && target.closest('.zm-canvas-menu')) return
  emit('close')
}
function onWindowKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
function onWindowScroll() {
  emit('close')
}
window.addEventListener('mousedown', onWindowMouseDown, true)
window.addEventListener('keydown', onWindowKey, true)
window.addEventListener('wheel', onWindowScroll, true)
window.addEventListener('scroll', onWindowScroll, true)
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowMouseDown, true)
  window.removeEventListener('keydown', onWindowKey, true)
  window.removeEventListener('wheel', onWindowScroll, true)
  window.removeEventListener('scroll', onWindowScroll, true)
})

function run(handler: () => void) {
  // Accept any function shape: items that don't take args
  // (openSettings, openData) and items that do (openImport
  // passes the mode).  We call with no args and let the handler
  // ignore any extra parameters.
  ;(handler as (...args: unknown[]) => void)()
  emit('close')
}
</script>

<template>
  <div
    class="zm-canvas-menu"
    :style="{ left: clamped.left + 'px', top: clamped.top + 'px' }"
    @contextmenu.prevent
  >
    <button class="zm-canvas-menu-item" @click.stop="run(() => emit('openData'))"><Icon name="database" :size="13" :stroke="1.6" /><span>查看数据</span></button>
    <div
      ref="importItemRef"
      class="zm-canvas-menu-item zm-canvas-menu-item-has-submenu"
      :class="{ 'is-open': submenuOpen }"
      @mouseenter="onSubmenuEnter"
      @mouseleave="onSubmenuLeave"
    >
      <Icon name="import" :size="13" :stroke="1.6" /><span>导入</span>
      <svg class="zm-canvas-menu-caret" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2.5 1.8 5.2 4 2.5 6.2" /></svg>
      <div
        v-if="submenuOpen"
        class="zm-canvas-submenu"
        :style="submenuStyle"
        @mouseenter="onSubmenuEnter"
        @mouseleave="onSubmenuLeave"
      >
        <button class="zm-canvas-menu-item" @click.stop="run(() => emit('openImport', 'markdown'))"><Icon name="markdown" :size="13" :stroke="1.6" /><span>Markdown 导入</span></button>
        <button class="zm-canvas-menu-item" @click.stop="run(() => emit('openImport', 'json'))"><Icon name="data" :size="13" :stroke="1.6" /><span>JSON 文件导入</span></button>
        <button class="zm-canvas-menu-item" @click.stop="run(() => emit('openImport', 'txt'))"><Icon name="txt" :size="13" :stroke="1.6" /><span>TXT 文件导入</span></button>
      </div>
    </div>
    <button class="zm-canvas-menu-item" @click.stop="run(() => emit('openSettings'))"><Icon name="settings" :size="13" :stroke="1.6" /><span>设置</span></button>
  </div>
</template>

<style>
.zm-canvas-menu {
  position: fixed;
  z-index: 40;
  min-width: 140px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  /* box-sizing: border-box so the menu's own padding is
   * included in its declared width.  Combined with the same on
   * .zm-canvas-menu-item below, this keeps every item flush
   * with the menu's right border (no 20px overhang from the
   * item's own padding). */
  box-sizing: border-box;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: #1e293b;
  user-select: none;
}
.zm-canvas-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  border-radius: 4px;
  cursor: pointer;
  width: 100%;
  /* box-sizing: border-box so width: 100% includes the item's
   * own padding (10px on each side).  Without this, the item's
   * 20px of padding sticks out past the menu's right edge --
   * which is what made the hover background look like it was
   * hanging off the side of the menu. */
  box-sizing: border-box;
  transition: background 0.1s;
}
.zm-canvas-menu-item:hover:not(:disabled) {
  background: #f1f5f9;
}
.zm-canvas-menu-item:active:not(:disabled) {
  background: #e2e8f0;
}
.zm-canvas-menu-item:disabled {
  color: #94a3b8;
  cursor: not-allowed;
}
.zm-canvas-menu-item-has-submenu {
  /* Anchor for the positioned submenu.  The submenu renders
   * right of this item and is clamped to the viewport.
   * box-sizing: border-box keeps the item the same width as the
   * other items (otherwise the has-submenu's caret would push
   * it wider). */
  position: relative;
  box-sizing: border-box;
}
.zm-canvas-menu-item-has-submenu.is-open,
.zm-canvas-menu-item-has-submenu:hover {
  background: #f1f5f9;
}
.zm-canvas-menu-caret {
  margin-left: auto;
  color: #94a3b8;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  /* The caret is 8x8 -- small and balanced with the 13px icons. */
}
.zm-canvas-submenu {
  /* Anchored to the right of the parent item, aligned with its
   * top edge.  No gap to the main menu -- the cursor can move
   * between the parent and the submenu without losing hover.
   * The 4px top offset aligns the submenu's top with the
   * parent's text (slightly indented from the parent's padding). */
  position: fixed;  /* top/left set by submenuStyle */
  z-index: 41;
  min-width: 160px;
  padding: 4px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  /* box-sizing: border-box so the menu's own padding is
   * included in its declared width.  Combined with the same on
   * .zm-canvas-menu-item below, this keeps every item flush
   * with the menu's right border (no 20px overhang from the
   * item's own padding). */
  box-sizing: border-box;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: #1e293b;
  user-select: none;
  /* small entrance animation */
  animation: zm-submenu-in 0.12s ease-out;
}
@keyframes zm-submenu-in {
  from { opacity: 0; transform: translateX(-4px); }
  to   { opacity: 1; transform: translateX(0); }
}
</style>