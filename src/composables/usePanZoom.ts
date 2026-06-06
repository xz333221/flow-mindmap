import { ref, reactive, type Ref } from 'vue'

export interface PanZoomOptions {
  minScale?: number
  maxScale?: number
  step?: number
  getContainer: () => HTMLElement | null
}

export function usePanZoom(opts: PanZoomOptions) {
  const minScale = opts.minScale ?? 0.2
  const maxScale = opts.maxScale ?? 3
  const step = opts.step ?? 1.2

  const scale: Ref<number> = ref(1)
  const offsetX: Ref<number> = ref(0)
  const offsetY: Ref<number> = ref(0)
  const isPanning = ref(false)
  const panStart = reactive<{ x: number; y: number; ox: number; oy: number }>({
    x: 0,
    y: 0,
    ox: 0,
    oy: 0,
  })

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

  function startPan(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('.zm-node, .zm-toolbar, button, input, textarea')) return
    isPanning.value = true
    panStart.x = e.clientX
    panStart.y = e.clientY
    panStart.ox = offsetX.value
    panStart.oy = offsetY.value
    window.addEventListener('mousemove', onPanMove)
    window.addEventListener('mouseup', endPan)
  }

  function onPanMove(e: MouseEvent) {
    if (!isPanning.value) return
    offsetX.value = panStart.ox + (e.clientX - panStart.x)
    offsetY.value = panStart.oy + (e.clientY - panStart.y)
  }

  function endPan() {
    isPanning.value = false
    window.removeEventListener('mousemove', onPanMove)
    window.removeEventListener('mouseup', endPan)
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
    onWheel,
    zoomIn,
    zoomOut,
    startPan,
    resetView,
  }
}
