<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MindMapNode } from '../types'
import { markdownToMindMap } from '../tree'
import JsonTreeViewer from './JsonTreeViewer.vue'

const props = withDefaults(defineProps<{
  data: MindMapNode
  /** Optional hint from the parent: when set, the paste panel
   *  auto-opens on next mount with this mode preselected.  Used
   *  by the canvas right-click 'Import' submenu.  Cleared by
   *  the parent after we emit 'consumed-mode'. */
  pendingMode?: 'json' | 'markdown' | 'txt' | null
}>(),
{ pendingMode: null }
)

const emit = defineEmits<{
  /** Fired when the user wants to replace the current data with a new tree. */
  (e: 'import', data: MindMapNode): void
  /** Fired when we have read pendingMode.  Parent resets the hint
   *  so subsequent openings of the drawer start in default mode. */
  (e: 'consumed-mode'): void
}>()

// formatted JSON for the read-only view
const json = computed(() => JSON.stringify(props.data, null, 2))

const pasteText = ref('')
const pasteError = ref<string | null>(null)
const pasteOpen = ref(false)
/** 'json' (default) or 'markdown'.  Drives the paste textarea
 *  placeholder, the error text, and which parser applyPaste()
 *  uses.  Pick from a small two-button tab in the paste panel. */
const pasteMode = ref<'json' | 'markdown' | 'txt'>('json')
const copyState = ref<'idle' | 'copied'>('idle')

// JsonTreeViewer shared state.  Holding the collapse set and
// search query in the parent lets the viewer's collapsed nodes
// survive across re-renders (e.g. when a child of the tree
// toggles and triggers a re-render of its sibling).
const collapsedPaths = ref<Set<string>>(new Set<string>())
const searchQuery = ref('')

// React to the parent's pendingMode hint.  When the canvas
// right-click 'Import' submenu fires, the parent sets this and
// we auto-open the paste panel with the right mode.  After we
// consume the hint we emit 'consumed-mode' so the parent can
// clear it for next time.
watch(
  () => props.pendingMode,
  (mode) => {
    if (!mode) return
    pasteOpen.value = true
    pasteMode.value = mode
    emit('consumed-mode')
  },
  { immediate: true }
)

async function copyAll() {
  try {
    await navigator.clipboard.writeText(json.value)
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 1500)
  } catch {
    // Fallback for environments without clipboard API
    const ta = document.createElement('textarea')
    ta.value = json.value
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      copyState.value = 'copied'
      setTimeout(() => (copyState.value = 'idle'), 1500)
    } finally {
      document.body.removeChild(ta)
    }
  }
}

function downloadJson() {
  const blob = new Blob([json.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.data.text || 'mindmap'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function applyPaste() {
  pasteError.value = null
  const text = pasteText.value.trim()
  if (!text) return
  // txt mode is a special case of markdown: plain text gets the
  // same parser, but we explicitly support .txt files that have
  // no markdown structure -- in that case the whole text becomes
  // the root text with no children.
  if (pasteMode.value === 'markdown' || pasteMode.value === 'txt') {
    // Markdown → MindMapNode tree.  Headings become nodes; a body
    // line under a heading becomes a single child of that heading.
    try {
      const parsed = markdownToMindMap(text)
      emit('import', parsed)
      pasteText.value = ''
      pasteOpen.value = false
    } catch (e) {
      pasteError.value = (pasteMode.value === 'txt' ? 'TXT 解析失败:' : 'Markdown 解析失败:') + (e as Error).message
    }
    return
  }
  try {
    const parsed = JSON.parse(text) as MindMapNode
    if (!parsed.id || !Array.isArray(parsed.children)) {
      pasteError.value = 'JSON 缺少 id 或 children 字段'
      return
    }
    emit('import', parsed)
    pasteText.value = ''
    pasteOpen.value = false
  } catch (e) {
    pasteError.value = 'JSON 解析失败:' + (e as Error).message
  }
}

function countNodes(n: MindMapNode): number {
  return 1 + n.children.reduce((acc, c) => acc + countNodes(c), 0)
}
const totalNodes = computed(() => countNodes(props.data))
const charCount = computed(() => json.value.length)

function pickFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        pasteText.value = reader.result
        applyPaste()
      }
    }
    reader.readAsText(f)
  }
  input.click()
}
</script>

<template>  <div class="zm-data-panel">
    <div class="zm-data-header">
      <div class="zm-data-title">
        <span class="zm-data-title-text">数据 JSON</span>
        <span class="zm-data-title-meta">{{ totalNodes }} 节点 · {{ charCount }} chars</span>
      </div>
    </div>

    <div class="zm-data-toolbar">
      <button
        class="zm-data-btn is-icon"
        :class="{ 'is-success': copyState === 'copied' }"
        :title="copyState === 'copied' ? '已复制' : '复制 JSON 到剪贴板'"
        @click="copyAll"
      >
        <svg v-if="copyState === 'idle'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
        </svg>
        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="5 12 10 17 19 7" />
        </svg>
        <span class="zm-data-btn-label">复制</span>
      </button>
      <button class="zm-data-btn is-icon" title="导出为 JSON 文件" @click="downloadJson">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 4 V15" />
          <polyline points="7 9 12 4 17 9" />
          <path d="M4 19 H20" />
        </svg>
        <span class="zm-data-btn-label">导出</span>
      </button>
      <button class="zm-data-btn is-icon" title="从 JSON 文件导入" @click="pickFile">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 15 V4" />
          <polyline points="7 9 12 4 17 9" />
          <path d="M4 19 H20" />
        </svg>
        <span class="zm-data-btn-label">导入</span>
      </button>
      <button
        class="zm-data-btn is-icon"
        :class="{ 'is-active': pasteOpen }"
        title="粘贴 JSON 或 Markdown 替换当前数据"
        @click="pasteOpen = !pasteOpen"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 4 H15 V8 H9 Z" />
          <path d="M9 8 H4 V20 H9" />
          <path d="M15 8 H20 V20 H15" />
        </svg>
        <span class="zm-data-btn-label">粘贴</span>
      </button>
      <div class="zm-data-toolbar-spacer" />
      <div class="zm-data-search" :class="{ 'is-active': searchQuery.length > 0 }">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="20" y1="20" x2="16" y2="16" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="过滤 (键 / 值)"
          spellcheck="false"
        />
        <button
          v-if="searchQuery"
          class="zm-data-search-clear"
          title="清空过滤"
          @click="searchQuery = ''"
        >×</button>
      </div>
    </div>

    <div v-if="pasteOpen" class="zm-data-paste">
      <div class="zm-data-tabs">
        <button
          class="zm-data-tab"
          :class="{ 'is-active': pasteMode === 'json' }"
          @click="pasteMode = 'json'"
        >JSON</button>
        <button
          class="zm-data-tab"
          :class="{ 'is-active': pasteMode === 'markdown' }"
          @click="pasteMode = 'markdown'"
        >Markdown</button>
      </div>
      <textarea
        v-model="pasteText"
                :placeholder="pasteMode === 'json' ? 'paste a JSON tree to replace current data' : 'paste markdown - # / ## / ### become nodes'"
        spellcheck="false"
      />
      <div v-if="pasteError" class="zm-data-error">{{ pasteError }}</div>
      <div class="zm-data-paste-actions">
        <button class="zm-data-btn is-primary" :disabled="!pasteText" @click="applyPaste">应用</button>
        <button class="zm-data-btn" @click="pasteText = ''; pasteError = null">清空</button>
        <button class="zm-data-btn" @click="pasteOpen = false">关闭</button>
      </div>
    </div>

    <div class="zm-data-tree">
      <JsonTreeViewer
        :value="data"
        :query="searchQuery"
        :collapsed-paths="collapsedPaths"
      />
    </div>

    <div class="zm-data-footer">
      <span class="zm-data-footer-hint">
        图片支持
        <code>data:image/...</code>
        /
        <code>https://...</code>
        /
        <code>/imgs/foo.png</code>
        (同源)。本地 <code>file://</code> 路径被浏览器拒绝。
      </span>
    </div>
  </div></template>

<style>.zm-data-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
}
.zm-data-header {
  display: flex;
  align-items: center;
  padding: 8px 12px 6px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
  flex-shrink: 0;
}
.zm-data-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.zm-data-title-text {
  font-size: 12px;
  font-weight: 600;
  color: #1e293b;
  letter-spacing: 0.02em;
}
.zm-data-title-meta {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}
.zm-data-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid #f1f5f9;
  background: #ffffff;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.zm-data-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 12px;
  font-family: inherit;
  color: #475569;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-data-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
}
.zm-data-btn.is-icon {
  padding: 4px 8px;
}
.zm-data-btn.is-active {
  background: #eff6ff;
  color: #1d4ed8;
  border-color: #bfdbfe;
}
.zm-data-btn.is-success {
  background: #ecfdf5;
  color: #047857;
  border-color: #a7f3d0;
}
.zm-data-btn.is-primary {
  background: #3b82f6;
  color: #ffffff;
  border-color: #3b82f6;
}
.zm-data-btn.is-primary:hover {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}
.zm-data-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.zm-data-btn-label {
  font-size: 11px;
}
.zm-data-toolbar-spacer {
  flex: 1;
  min-width: 4px;
}
.zm-data-search {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  transition: all 0.1s;
  flex: 0 1 160px;
  min-width: 0;
}
.zm-data-search:focus-within,
.zm-data-search.is-active {
  background: #ffffff;
  border-color: #3b82f6;
}
.zm-data-search svg {
  color: #94a3b8;
  flex-shrink: 0;
}
.zm-data-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 11px;
  color: #1e293b;
  padding: 0;
}
.zm-data-search input::placeholder {
  color: #94a3b8;
}
.zm-data-search-clear {
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  border-radius: 2px;
}
.zm-data-search-clear:hover {
  background: #e2e8f0;
  color: #1e293b;
}
.zm-data-paste {
  padding: 8px 10px 10px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
  flex-shrink: 0;
}
.zm-data-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}
.zm-data-tab {
  font: inherit;
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  background: #ffffff;
  color: #475569;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-data-tab:hover {
  background: #f1f5f9;
}
.zm-data-tab.is-active {
  background: #1e293b;
  border-color: #1e293b;
  color: #ffffff;
}
.zm-data-paste textarea {
  width: 100%;
  min-height: 60px;
  max-height: 160px;
  padding: 6px 8px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  background: #ffffff;
  resize: vertical;
  box-sizing: border-box;
}
.zm-data-paste textarea:focus {
  outline: none;
  border-color: #3b82f6;
}
.zm-data-paste-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.zm-data-error {
  margin-top: 6px;
  font-size: 11px;
  color: #dc2626;
}
.zm-data-tree {
  flex: 1;
  overflow: auto;
  padding: 8px 4px 8px 6px;
  background: #ffffff;
}
.zm-data-footer {
  padding: 6px 12px;
  border-top: 1px solid #f1f5f9;
  background: #f8fafc;
  font-size: 10px;
  color: #94a3b8;
  line-height: 1.5;
  flex-shrink: 0;
}
.zm-data-footer-hint code {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  padding: 0 3px;
  border-radius: 3px;
  color: #475569;
  margin: 0 1px;
}</style>
