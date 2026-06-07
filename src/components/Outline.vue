<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MindMapNode } from '../types'

const props = withDefaults(
  defineProps<{
    /** Root of the mind map. */
    data: MindMapNode
    /** Highlight the node with this id (the one selected on the main canvas). */
    selectedId?: string | null
    /** When true, hide a node's children in the outline. (Future use — currently all children render.) */
    collapsedIds?: Set<string>
  }>(),
  { selectedId: null, collapsedIds: () => new Set<string>() }
)

const emit = defineEmits<{
  /** Emitted when the user clicks a node in the outline. The parent can
   *  use this to drive the main canvas (e.g. select + scroll to it). */
  (e: 'select', node: MindMapNode): void
  /** Toggle a node's collapsed state on the main canvas. */
  (e: 'toggleCollapse', id: string): void
}>()

interface FlatRow {
  id: string
  text: string
  depth: number
  /** Zero-based position among the parent's children — used to label
   *  rows with `1., 2., 3., …` for orientation.  Root is always 0. */
  siblingIndex: number
  hasChildren: boolean
  collapsed: boolean
  node: MindMapNode
}

const rows = computed<FlatRow[]>(() => {
  const out: FlatRow[] = []
  const walk = (n: MindMapNode, depth: number, siblingIndex: number) => {
    const hasChildren = n.children.length > 0
    const collapsed = props.collapsedIds.has(n.id)
    out.push({
      id: n.id,
      text: n.text || '(无标题)',
      depth,
      siblingIndex,
      hasChildren,
      collapsed,
      node: n,
    })
    if (hasChildren && !collapsed) {
      n.children.forEach((c, i) => walk(c, depth + 1, i))
    }
  }
  walk(props.data, 0, 0)
  return out
})

// "copied" feedback for the per-row copy button — keyed by node id.
const copiedId = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for environments without clipboard API
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } finally {
      document.body.removeChild(ta)
    }
    return ok
  }
}

async function copyNodeText(e: MouseEvent, text: string, id: string) {
  e.stopPropagation()
  const ok = await copyText(text)
  if (!ok) return
  copiedId.value = id
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copiedId.value = null), 1200)
}

/** Build a plain-text outline of the whole tree (regardless of
 *  collapsedIds) using indentation. */
const plainText = computed(() => {
  const lines: string[] = []
  const walk = (n: MindMapNode, depth: number) => {
    const indent = '  '.repeat(depth)
    const bullet = depth === 0 ? '' : '- '
    lines.push(indent + bullet + (n.text || ''))
    for (const c of n.children) walk(c, depth + 1)
  }
  walk(props.data, 0)
  return lines.join('\n')
})

const copyingOutline = ref(false)
let outlineTimer: ReturnType<typeof setTimeout> | null = null

async function copyOutline() {
  const ok = await copyText(plainText.value)
  if (!ok) return
  copyingOutline.value = true
  if (outlineTimer) clearTimeout(outlineTimer)
  outlineTimer = setTimeout(() => (copyingOutline.value = false), 1200)
}
</script>

<template>
  <div class="zm-outline-root">
    <div class="zm-outline-actions">
      <button
        class="zm-outline-action-btn"
        :class="{ 'is-success': copyingOutline }"
        title="复制完整大纲为纯文本"
        @click="copyOutline"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect v-if="!copyingOutline" x="9" y="9" width="13" height="13" rx="2" />
          <path v-else d="M5 12 L10 17 L19 7" />
          <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
        </svg>
        <span>{{ copyingOutline ? '已复制' : '复制大纲' }}</span>
      </button>
    </div>
    <ul class="zm-outline">
      <li
        v-for="row in rows"
        :key="row.id"
        class="zm-outline-row"
        :class="{
          'is-selected': row.id === selectedId,
          'is-root': row.depth === 0,
        }"
        :style="{ paddingLeft: 12 + row.depth * 16 + 'px' }"
        @click="emit('select', row.node)"
      >
        <button
          v-if="row.hasChildren"
          class="zm-outline-toggle"
          :title="row.collapsed ? '展开' : '折叠'"
          @click.stop="emit('toggleCollapse', row.id)"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline v-if="!row.collapsed" points="6 9 12 15 18 9" />
            <polyline v-else points="9 6 15 12 9 18" />
          </svg>
        </button>
        <span v-else class="zm-outline-dot" />
        <span class="zm-outline-index">{{ row.siblingIndex + 1 }}.</span>
        <span class="zm-outline-text">{{ row.text }}</span>
        <button
          class="zm-outline-row-copy"
          :class="{ 'is-success': copiedId === row.id }"
          :title="copiedId === row.id ? '已复制' : '复制节点文本'"
          @click="(e) => copyNodeText(e, row.text, row.id)"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect v-if="copiedId !== row.id" x="9" y="9" width="13" height="13" rx="2" />
            <path v-else d="M5 12 L10 17 L19 7" />
            <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
          </svg>
        </button>
      </li>
    </ul>
  </div>
</template>

<style>
.zm-outline-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.zm-outline-actions {
  display: flex;
  justify-content: flex-end;
  padding: 8px 10px 4px;
  flex-shrink: 0;
}
.zm-outline-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: inherit;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-outline-action-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
}
.zm-outline-action-btn.is-success {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}
.zm-outline {
  list-style: none;
  margin: 0;
  padding: 4px 0 8px;
  font-size: 13px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.zm-outline-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 6px;
  padding-top: 4px;
  padding-bottom: 4px;
  cursor: pointer;
  color: #334155;
  border-radius: 4px;
  margin: 0 6px;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.1s;
}
.zm-outline-row:hover {
  background: #f1f5f9;
}
.zm-outline-row.is-root {
  font-weight: 600;
  color: #0f172a;
}
.zm-outline-row.is-selected {
  background: #eff6ff;
  color: #1d4ed8;
}
.zm-outline-row.is-selected .zm-outline-toggle,
.zm-outline-row.is-selected .zm-outline-dot,
.zm-outline-row.is-selected .zm-outline-row-copy {
  color: #1d4ed8;
}
.zm-outline-toggle {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
}
.zm-outline-toggle:hover {
  background: #e2e8f0;
  color: #475569;
}
.zm-outline-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #cbd5e1;
  flex-shrink: 0;
  margin: 0 6px;
}
.zm-outline-index {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  min-width: 22px;
  flex-shrink: 0;
  user-select: none;
}
.zm-outline-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.zm-outline-row-copy {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  padding: 0;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s, color 0.1s;
}
.zm-outline-row:hover .zm-outline-row-copy,
.zm-outline-row.is-selected .zm-outline-row-copy {
  opacity: 1;
}
.zm-outline-row-copy:hover {
  background: #e2e8f0;
  color: #475569;
}
.zm-outline-row-copy.is-success {
  opacity: 1;
  color: #047857;
  background: #ecfdf5;
}
</style>
