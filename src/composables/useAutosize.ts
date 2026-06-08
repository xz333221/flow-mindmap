/**
 * Tiny autosize helper for textareas.  Usage:
 *
 *   const taRef = ref<HTMLTextAreaElement | null>(null)
 *   useAutosize(taRef, { minRows: 4, maxRows: 12 })
 *
 * The composable listens to the textarea's `input` event, sets
 * its height to its scrollHeight (clamped to the row range), and
 * also re-runs when the bound value changes from outside so a
 * parent that resets `.value` (e.g. on node switch) still sizes
 * correctly.
 */
import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

export interface AutosizeOptions {
  /** Minimum visible rows when the textarea is empty.  Default 3. */
  minRows?: number
  /** Maximum visible rows before the textarea starts scrolling.
   *  Default 12.  Set to 0 for "no cap". */
  maxRows?: number
}

const DEFAULT_LINE_HEIGHT = 20 // matches panel font 12px / line-height ~1.55

function syncHeight(el: HTMLTextAreaElement, opts: Required<AutosizeOptions>) {
  // Reset so scrollHeight reflects full content (not the previous
  // capped height).
  el.style.height = 'auto'
  const min = opts.minRows * DEFAULT_LINE_HEIGHT
  const cap = opts.maxRows > 0 ? opts.maxRows * DEFAULT_LINE_HEIGHT : Infinity
  const desired = Math.max(min, Math.min(cap, el.scrollHeight))
  el.style.height = desired + 'px'
  el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden'
}

export function useAutosize(
  refEl: Ref<HTMLTextAreaElement | null>,
  options: AutosizeOptions = {}
) {
  const opts: Required<AutosizeOptions> = {
    minRows: options.minRows ?? 3,
    maxRows: options.maxRows ?? 12,
  }

  function resize() {
    const el = refEl.value
    if (!el) return
    syncHeight(el, opts)
  }

  function onInput() {
    resize()
  }

  onMounted(async () => {
    await nextTick()
    const el = refEl.value
    if (!el) return
    el.addEventListener('input', onInput)
    resize()
  })

  // Re-sync when the bound value changes from outside (e.g. a
  // different node is selected and the parent resets `.value`).
  watch(
    () => refEl.value?.value,
    () => resize()
  )

  onBeforeUnmount(() => {
    const el = refEl.value
    if (el) el.removeEventListener('input', onInput)
  })
}
