import { ref, reactive, type Ref } from 'vue'

export interface PanZoomOptions {
  minScale?: number
  maxScale?: number
  step?: number
  getContainer: () => HTMLElement | null
}

export interface MarqueeRect {
  x: number
  y: number
  width: number
  height: number
  /**
   * Captured at the start of the marquee gesture. `true` when the
   * user held Shift while pressing the mouse — the consumer
   * (`onMarqueeEnd`) uses this to decide between extending the
   * existing selection set (shift) and replacing it (no shift).
   */
  shiftKey?: boolean
}

export function usePanZoom(opts: PanZoomOptions) {
  const minScale = opts.minScale ?? 0.2
  // Default zoom-out cap is 0.2 (20%).  No upper cap on zoom-in
  // — users may want to inspect a single node up close.  The
  // call site (MindMap.vue) does not pass `maxScale`, so this
  // default applies.  If a consumer needs a hard cap, they can
  // pass `maxScale: N` and the `Math.min(maxScale, …)` clamps
  // below will still apply.
  const maxScale = opts.maxScale ?? Infinity
  const step = opts.step ?? 1.2

  const scale: Ref<number> = ref(1)
  const offsetX: Ref<number> = ref(0)
  const offsetY: Ref<number> = ref(0)
  const isPanning = ref(false)
  // Tracks whether the current/last pan actually moved the canvas
  // beyond a small threshold.  Used by the caller to suppress the
  // context menu after a right-button drag-pan (so the user can pan
  // without the menu popping up on release).  Reset on every startPan.
  const panMoved = ref(false)
  const panStart = reactive<{ x: number; y: number; ox: number; oy: number }>({
    x: 0,
    y: 0,
    ox: 0,
    oy: 0,
  })

  // Marquee (rectangle selection) state. Set when the user left-presses
  // on the empty canvas, cleared when the pointer goes back up.
  const isMarquee = ref(false)
  const marqueeStart = reactive<{ x: number; y: number }>({ x: 0, y: 0 })
  const marquee = reactive<MarqueeRect & { shiftKey?: boolean }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })
  const marqueeVersion = ref(0) // bump so templates can watch marquee
  // Optional callback fired when a marquee ends. Caller sets this
  // to apply their own selection logic on the final rect.
  let onMarqueeEndCb: (() => void) | null = null
  function setOnMarqueeEnd(cb: (() => void) | null) {
    onMarqueeEndCb = cb
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const container = opts.getContainer()
    if (!container) return
    const delta = -e.deltaY * 0.001
    const next = Math.min(maxScale, Math.max(minScale, scale.value * (1 + delta)))
    const rect = container.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const wx = (cx - offsetX.value) / scale.value
    const wy = (cy - offsetY.value) / scale.value
    scale.value = next
    offsetX.value = cx - wx * next
    offsetY.value = cy - wy * next
  }

  function zoomIn() {
    scale.value = Math.min(maxScale, scale.value * step)
  }
  function zoomOut() {
    scale.value = Math.max(minScale, scale.value / step)
  }

  // Right-button drag on empty canvas → pan the canvas.
  function startPan(e: PointerEvent | MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('.zm-node, .zm-toolbar, button, input, textarea')) return
    isPanning.value = true
    panMoved.value = false
    panStart.x = e.clientX
    panStart.y = e.clientY
    panStart.ox = offsetX.value
    panStart.oy = offsetY.value
    window.addEventListener('mousemove', onPanMove)
    window.addEventListener('mouseup', endPan)
    e.preventDefault?.()
  }

  function onPanMove(e: MouseEvent) {
    if (!isPanning.value) return
    const dx = e.clientX - panStart.x
    const dy = e.clientY - panStart.y
    // Only flag as moved once the cursor travels beyond a small
    // threshold — a tiny jitter on right-click shouldn't suppress
    // the context menu.
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panMoved.value = true
    offsetX.value = panStart.ox + dx
    offsetY.value = panStart.oy + dy
  }

  function endPan() {
    isPanning.value = false
    window.removeEventListener('mousemove', onPanMove)
    window.removeEventListener('mouseup', endPan)
  }

  // Left-button drag on empty canvas → start a marquee selection.
  // Caller passes in the pointer position in *world* coordinates
  // (already converted through scale/offset). We update the
  // marquee rect in real time; when the user releases, the
  // caller reads marquee.value and intersects it against node
  // bboxes to select nodes.
  function startMarquee(worldX: number, worldY: number, opts?: { shift?: boolean }) {
    isMarquee.value = true
    marqueeStart.x = worldX
    marqueeStart.y = worldY
    marquee.x = worldX
    marquee.y = worldY
    marquee.width = 0
    marquee.height = 0
    // Captured at pickup so `onMarqueeEnd` can decide whether to
    // extend the existing selection set or replace it.  Live
    // mouse events don't carry shiftKey state by the time the
    // gesture ends, so we stash it here.
    marquee.shiftKey = !!opts?.shift
    marqueeVersion.value++
    window.addEventListener('mousemove', onMarqueeMove)
    window.addEventListener('mouseup', endMarquee)
  }

  function updateMarquee(worldX: number, worldY: number) {
    if (!isMarquee.value) return
    const x1 = Math.min(marqueeStart.x, worldX)
    const y1 = Math.min(marqueeStart.y, worldY)
    const x2 = Math.max(marqueeStart.x, worldX)
    const y2 = Math.max(marqueeStart.y, worldY)
    marquee.x = x1
    marquee.y = y1
    marquee.width = x2 - x1
    marquee.height = y2 - y1
    marqueeVersion.value++
  }

  function endMarquee() {
    isMarquee.value = false
    window.removeEventListener('mousemove', onMarqueeMove)
    window.removeEventListener('mouseup', endMarquee)
    if (onMarqueeEndCb) onMarqueeEndCb()
  }

  function onMarqueeMove(e: MouseEvent) {
    if (!isMarquee.value) return
    // Convert screen coords back to world coords through the
    // current scale / offset.
    const container = opts.getContainer()
    if (!container) return
    const rect = container.getBoundingClientRect()
    const wx = (e.clientX - rect.left - offsetX.value) / scale.value
    const wy = (e.clientY - rect.top - offsetY.value) / scale.value
    updateMarquee(wx, wy)
  }

  function resetView(
    layoutWidth: number,
    layoutHeight: number,
    rootY: number,
    padding = 60
  ) {
    const container = opts.getContainer()
    if (!container) return
    const rect = container.getBoundingClientRect()
    const sx = (rect.width - padding * 2) / layoutWidth
    const sy = (rect.height - padding * 2) / layoutHeight
    const fit = Math.min(1, Math.max(0.3, Math.min(sx, sy)))
    scale.value = fit
    offsetX.value = rect.width / 2
    offsetY.value = rect.height / 2 - rootY * fit
  }

  return {
    scale,
    offsetX,
    offsetY,
    isPanning,
    panMoved,
    onWheel,
    zoomIn,
    zoomOut,
    startPan,
    startMarquee,
    updateMarquee,
    isMarquee,
    marquee,
    marqueeVersion,
    setOnMarqueeEnd,
    resetView,
  }
}
