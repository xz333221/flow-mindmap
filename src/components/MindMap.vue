<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { layout, LAYOUT, type LayoutNode } from '../core/layout'
import { addChild, addSibling, removeNode, findNode, findParent, clone } from '../tree'
import type { MindMapNode, MindMapTheme, MindMapExpose } from '../types'

const props = withDefaults(
  defineProps<{
    data: MindMapNode
    readonly?: boolean
    theme?: MindMapTheme
  }>(),
  { readonly: false }
)

const emit = defineEmits<{
  (e: 'change', data: MindMapNode): void
  (e: 'select', node: MindMapNode | null): void
}>()

defineExpose<MindMapExpose>({
  addChild: (parentId: string) => doAddChild(parentId),
  addSibling: (nodeId: string) => doAddSibling(nodeId),
  removeNode: (nodeId: string) => doRemove(nodeId),
  getData: () => dataRef.value,
  setData: (d) => {
    dataRef.value = clone(d)
    triggerRef()
  },
  resetView: () => resetView(),
})

const dataRef = ref<MindMapNode>(clone(props.data))
const containerRef = ref<HTMLElement | null>(null)
const wrapperRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editText = ref('')
const selectedId = ref<string | null>(null)
const collapsedIds = ref<Set<string>>(new Set())

// pan/zoom
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const isPanning = ref(false)
const panStart = reactive<{ x: number; y: number; ox: number; oy: number }>({ x: 0, y: 0, ox: 0, oy: 0 })

const theme = computed<Required<MindMapTheme>>(() => ({
  rootBg: props.theme?.rootBg ?? '#1f2937',
  rootText: props.theme?.rootText ?? '#ffffff',
  branchBg: props.theme?.branchBg ?? '#ffffff',
  branchText: props.theme?.branchText ?? '#1f2937',
  lineColor: props.theme?.lineColor ?? '#94a3b8',
  bgColor: props.theme?.bgColor ?? '#f8fafc',
  fontSize: props.theme?.fontSize ?? 14,
}))

const layoutVersion = ref(0)
function triggerRef() {
  collapsedIds.value = new Set(collapsedIds.value)
  layoutVersion.value++
}

watch(
  () => props.data,
  (v) => {
    dataRef.value = clone(v)
    triggerRef()
  },
  { deep: false }
)

const layoutResult = computed(() => {
  // apply collapse
  const data = clone(dataRef.value)
  applyCollapse(data)
  return layout(data)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void layoutVersion.value
})

function applyCollapse(n: MindMapNode) {
  if (collapsedIds.value.has(n.id)) {
    n.children = []
    n.collapsed = true
    return
  }
  n.collapsed = false
  for (const c of n.children) applyCollapse(c)
}

const allNodes = computed<LayoutNode[]>(() => {
  const out: LayoutNode[] = []
  const walk = (n: LayoutNode) => {
    out.push(n)
    n.children.forEach(walk)
  }
  walk(layoutResult.value.root)
  return out
})

const nodesById = computed(() => {
  const m = new Map<string, LayoutNode>()
  for (const n of allNodes.value) m.set(n.id, n)
  return m
})

const edges = computed(() => {
  const out: { from: LayoutNode; to: LayoutNode; key: string }[] = []
  for (const n of allNodes.value) {
    for (const c of n.children) {
      out.push({ from: n, to: c, key: `${n.id}->${c.id}` })
    }
  }
  return out
})

// svg viewBox centered on root
const viewBox = computed(() => {
  const r = layoutResult.value
  return `${r.vbX} ${r.vbY} ${r.vbW} ${r.vbH}`
})

// drag state for node
const draggingNodeId = ref<string | null>(null)
const dragStart = reactive<{ x: number; y: number; sx: number; sy: number }>({ x: 0, y: 0, sx: 0, sy: 0 })
const dragDelta = ref<{ x: number; y: number } | null>(null)

function startNodeDrag(e: MouseEvent, n: LayoutNode) {
  if (props.readonly) return
  e.stopPropagation()
  draggingNodeId.value = n.id
  dragStart.x = e.clientX
  dragStart.y = e.clientY
  dragStart.sx = n.x
  dragStart.sy = n.y
  dragDelta.value = { x: 0, y: 0 }
  window.addEventListener('mousemove', onNodeDragMove)
  window.addEventListener('mouseup', onNodeDragEnd)
}

function onNodeDragMove(e: MouseEvent) {
  if (!draggingNodeId.value) return
  const scaleFix = 1 / scale.value
  dragDelta.value = {
    x: (e.clientX - dragStart.x) * scaleFix,
    y: (e.clientY - dragStart.y) * scaleFix,
  }
}

function onNodeDragEnd() {
  draggingNodeId.value = null
  window.removeEventListener('mousemove', onNodeDragMove)
  window.removeEventListener('mouseup', onNodeDragEnd)
  setTimeout(() => (dragDelta.value = null), 0)
}

function nodePos(n: LayoutNode) {
  const d = dragDelta.value
  if (d && draggingNodeId.value === n.id) {
    return { x: n.x + d.x, y: n.y + d.y }
  }
  return { x: n.x, y: n.y }
}

function startPan(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.zm-node, .zm-toolbar, button')) return
  isPanning.value = true
  panStart.x = e.clientX
  panStart.y = e.clientY
  panStart.ox = offsetX.value
  panStart.oy = offsetY.value
  window.addEventListener('mousemove', onPanMove)
  window.addEventListener('mouseup', endPan)
  selectedId.value = null
  emit('select', null)
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

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = -e.deltaY * 0.001
  const next = Math.min(3, Math.max(0.2, scale.value * (1 + delta)))
  // zoom towards cursor
  const rect = wrapperRef.value!.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top
  const wx = (cx - offsetX.value) / scale.value
  const wy = (cy - offsetY.value) / scale.value
  scale.value = next
  offsetX.value = cx - wx * next
  offsetY.value = cy - wy * next
}

function zoomIn() {
  scale.value = Math.min(3, scale.value * 1.2)
}
function zoomOut() {
  scale.value = Math.max(0.2, scale.value / 1.2)
}
function resetView() {
  if (!wrapperRef.value) return
  const rect = wrapperRef.value.getBoundingClientRect()
  const padding = 60
  const { width, height } = layoutResult.value
  const sx = (rect.width - padding * 2) / width
  const sy = (rect.height - padding * 2) / height
  const fit = Math.min(1, Math.max(0.3, Math.min(sx, sy)))
  scale.value = fit
  // center root (layout x=0, y=layoutResult.root.y) in the viewport
  offsetX.value = rect.width / 2
  offsetY.value = rect.height / 2 - layoutResult.value.root.y * fit
}

onMounted(() => {
  nextTick(() => resetView())
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

// re-center view when layout dimensions change
watch(
  () => layoutResult.value.width,
  () => nextTick(() => resetView())
)

function onKey(e: KeyboardEvent) {
  if (editingId.value) return
  if (props.readonly) return
  if (e.key === 'Tab') {
    e.preventDefault()
    if (selectedId.value) doAddChild(selectedId.value)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (selectedId.value) doAddSibling(selectedId.value)
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId.value && selectedId.value !== dataRef.value.id) {
    e.preventDefault()
    doRemove(selectedId.value)
  } else if (e.key === 'F2' && selectedId.value) {
    e.preventDefault()
    startEdit(selectedId.value)
  } else if (e.key === 'Escape') {
    selectedId.value = null
    emit('select', null)
  }
}

function doAddChild(parentId: string) {
  const n = addChild(dataRef.value, parentId, '新节点')
  if (n) {
    triggerRef()
    emit('change', dataRef.value)
    nextTick(() => startEdit(n.id))
  }
}
function doAddSibling(nodeId: string) {
  if (nodeId === dataRef.value.id) {
    doAddChild(nodeId)
    return
  }
  const n = addSibling(dataRef.value, nodeId, '新节点')
  if (n) {
    triggerRef()
    emit('change', dataRef.value)
    nextTick(() => startEdit(n.id))
  }
}
function doRemove(nodeId: string) {
  if (nodeId === dataRef.value.id) return
  removeNode(dataRef.value, nodeId)
  if (selectedId.value === nodeId) selectedId.value = null
  triggerRef()
  emit('change', dataRef.value)
}

function startEdit(id: string) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  editingId.value = id
  editText.value = n.text
}

function commitEdit() {
  if (!editingId.value) return
  const n = findNode(dataRef.value, editingId.value)
  if (n) {
    n.text = editText.value.trim() || ' '
    emit('change', dataRef.value)
  }
  editingId.value = null
}

function cancelEdit() {
  editingId.value = null
}

function toggleCollapse(id: string) {
  if (collapsedIds.value.has(id)) collapsedIds.value.delete(id)
  else collapsedIds.value.add(id)
  triggerRef()
}

function onNodeClick(e: MouseEvent, n: LayoutNode) {
  e.stopPropagation()
  selectedId.value = n.id
  const data = findNode(dataRef.value, n.id)
  emit('select', data)
}

function isCollapsed(id: string) {
  return collapsedIds.value.has(id)
}

function nodeHasChildren(n: LayoutNode) {
  const data = findNode(dataRef.value, n.id)
  return !!data && data.children.length > 0
}

function bezierPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = (to.x - from.x) * 0.5
  const sx = from.x + dx
  const ex = to.x - dx
  return `M ${from.x} ${from.y} C ${sx} ${from.y}, ${ex} ${to.y}, ${to.x} ${to.y}`
}

function lineAnchor(n: LayoutNode, side: 'in' | 'out' = 'in'): { x: number; y: number } {
  const y = n.y
  if (n.isRoot) {
    return { x: side === 'out' ? n.x + n.width / 2 : n.x - n.width / 2, y }
  }
  // for non-root: x is the right edge of the node on the connecting side
  // we use LayoutNode.side — out means from this node to its children, in means from parent
  const dir = (n.parent?.children.indexOf(n) ?? 0) % 2 === 0 ? 1 : -1
  if (side === 'out') {
    return { x: n.x + (dir === 1 ? n.width / 2 : -n.width / 2), y }
  }
  return { x: n.x - (dir === 1 ? n.width / 2 : -n.width / 2), y }
}
</script>

<template>
  <div
    ref="containerRef"
    class="zm-mindmap"
    :style="{ background: theme.bgColor, fontSize: theme.fontSize + 'px' }"
  >
    <div
      ref="wrapperRef"
      class="zm-canvas"
      @mousedown="startPan"
      @wheel="onWheel"
    >
      <div
        class="zm-world"
        :style="{
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
        }"
      >
        <svg
          class="zm-svg"
          :viewBox="viewBox"
          preserveAspectRatio="xMidYMid meet"
          :width="layoutResult.vbW"
          :height="layoutResult.vbH"
          :style="{
            left: layoutResult.vbX + 'px',
            top: layoutResult.vbY + 'px',
          }"
        >
          <g class="zm-edges">
            <path
              v-for="e in edges"
              :key="e.key"
              :d="bezierPath(lineAnchor(e.from, 'out'), lineAnchor(e.to, 'in'))"
              fill="none"
              :stroke="theme.lineColor"
              stroke-width="1.4"
            />
          </g>
        </svg>

        <div
          v-for="n in allNodes"
          :key="n.id"
          class="zm-node"
          :class="{
            'is-root': n.isRoot,
            'is-selected': selectedId === n.id,
            'is-editing': editingId === n.id,
          }"
          :style="{
            left: nodePos(n).x - n.width / 2 + 'px',
            top: nodePos(n).y - LAYOUT.NODE_H / 2 + 'px',
            width: n.width + 'px',
            height: LAYOUT.NODE_H + 'px',
            background: n.isRoot ? theme.rootBg : theme.branchBg,
            color: n.isRoot ? theme.rootText : theme.branchText,
            borderColor: n.isRoot ? theme.rootBg : theme.lineColor,
          }"
          @mousedown="(e) => startNodeDrag(e, n)"
          @click="(e) => onNodeClick(e, n)"
          @dblclick="(e) => { e.stopPropagation(); if (!readonly) startEdit(n.id) }"
        >
          <span v-if="editingId !== n.id" class="zm-text">{{ n.text }}</span>
          <input
            v-else
            class="zm-input"
            v-model="editText"
            autofocus
            @blur="commitEdit"
            @keydown.enter="commitEdit"
            @keydown.esc="cancelEdit"
            @mousedown.stop
            @click.stop
          />

          <button
            v-if="!readonly && !n.isRoot && nodeHasChildren(n)"
            class="zm-btn zm-collapse"
            :title="isCollapsed(n.id) ? '展开' : '折叠'"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >
            <Icon :name="isCollapsed(n.id) ? 'expand' : 'collapse'" :size="12" />
          </button>

          <template v-if="!readonly">
            <button
              class="zm-btn zm-add"
              :title="'添加子节点 (Tab)'"
              @mousedown.stop
              @click.stop="doAddChild(n.id)"
            >
              <Icon name="add" :size="12" />
            </button>
            <button
              v-if="!n.isRoot"
              class="zm-btn zm-del"
              :title="'删除 (Del)'"
              @mousedown.stop
              @click.stop="doRemove(n.id)"
            >
              <Icon name="delete" :size="12" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <div class="zm-toolbar">
      <button class="zm-tb-btn" title="放大" @click="zoomIn"><Icon name="zoom-in" /></button>
      <button class="zm-tb-btn" title="缩小" @click="zoomOut"><Icon name="zoom-out" /></button>
      <button class="zm-tb-btn" title="重置视图" @click="resetView"><Icon name="reset" /></button>
      <span class="zm-tb-divider" />
      <button v-if="!readonly" class="zm-tb-btn" title="添加子节点 (Tab)" @click="selectedId && doAddChild(selectedId)">
        <Icon name="add" />
      </button>
      <button v-if="!readonly" class="zm-tb-btn" title="添加同级 (Enter)" @click="selectedId && doAddSibling(selectedId)">
        <Icon name="edit" />
      </button>
      <span class="zm-tb-tip">{{ Math.round(scale * 100) }}%</span>
    </div>
  </div>
</template>

<style>
.zm-mindmap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  user-select: none;
}
.zm-canvas {
  position: absolute;
  inset: 0;
  cursor: grab;
}
.zm-canvas:active {
  cursor: grabbing;
}
.zm-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.zm-svg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  overflow: visible;
}
.zm-node {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 28px;
  border-radius: 8px;
  border: 1px solid;
  font-size: 0.9em;
  line-height: 1.2;
  cursor: move;
  transition: box-shadow 0.15s, transform 0.05s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  white-space: nowrap;
  z-index: 1;
}
.zm-node:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 2;
}
.zm-node.is-root {
  font-weight: 600;
  font-size: 1em;
}
.zm-node.is-selected {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  z-index: 3;
}
.zm-text {
  pointer-events: none;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zm-input {
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
  width: 100%;
  min-width: 40px;
}
.zm-btn {
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: #3b82f6;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, transform 0.15s;
  z-index: 4;
}
.zm-node:hover .zm-btn,
.zm-node.is-selected .zm-btn {
  opacity: 1;
}
.zm-btn:hover {
  transform: scale(1.15);
}
.zm-add {
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
}
.zm-add:hover {
  transform: translateY(-50%) scale(1.15);
}
.zm-collapse {
  left: -8px;
  top: 50%;
  transform: translateY(-50%);
  background: #64748b;
}
.zm-collapse:hover {
  transform: translateY(-50%) scale(1.15);
}
.zm-del {
  right: -8px;
  top: -8px;
  background: #ef4444;
}
.zm-del:hover {
  transform: scale(1.15);
}
.zm-toolbar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  z-index: 10;
}
.zm-tb-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: #475569;
}
.zm-tb-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.zm-tb-divider {
  width: 1px;
  height: 18px;
  background: #e2e8f0;
  margin: 0 4px;
}
.zm-tb-tip {
  font-size: 12px;
  color: #64748b;
  min-width: 38px;
  text-align: center;
}
</style>
