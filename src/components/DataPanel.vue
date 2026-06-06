<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MindMapNode } from '../types'

const props = defineProps<{
  data: MindMapNode
}>()

const emit = defineEmits<{
  /** Fired when the user wants to replace the current data with a new tree. */
  (e: 'import', data: MindMapNode): void
}>()

// formatted JSON for the read-only view
const json = computed(() => JSON.stringify(props.data, null, 2))

const pasteText = ref('')
const pasteError = ref<string | null>(null)
const pasteOpen = ref(false)
const copyState = ref<'idle' | 'copied'>('idle')

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
  try {
    const parsed = JSON.parse(pasteText.value) as MindMapNode
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

<template>
  <div class="zm-data-panel">
    <div class="zm-data-toolbar">
      <button class="zm-data-btn" :class="{ 'is-success': copyState === 'copied' }" @click="copyAll">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect v-if="copyState === 'idle'" x="9" y="9" width="13" height="13" rx="2" />
          <path v-else d="M5 12 L10 17 L19 7" />
          <path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
        </svg>
        <span>{{ copyState === 'copied' ? '已复制' : '复制 JSON' }}</span>
      </button>
      <button class="zm-data-btn" @click="downloadJson">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 4 V15" />
          <polyline points="7 9 12 4 17 9" />
          <path d="M4 19 H20" />
        </svg>
        <span>导出文件</span>
      </button>
      <button class="zm-data-btn" @click="pickFile">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 15 V4" />
          <polyline points="7 9 12 4 17 9" />
          <path d="M4 19 H20" />
        </svg>
        <span>从文件导入</span>
      </button>
      <button class="zm-data-btn" :class="{ 'is-active': pasteOpen }" @click="pasteOpen = !pasteOpen">
        <span>粘贴 JSON</span>
      </button>
    </div>

    <div v-if="pasteOpen" class="zm-data-paste">
      <textarea
        v-model="pasteText"
        placeholder='粘贴 JSON,例如 {"id":"r","text":"标题","children":[]}'
        spellcheck="false"
      />
      <div v-if="pasteError" class="zm-data-error">{{ pasteError }}</div>
      <div class="zm-data-paste-actions">
        <button class="zm-data-btn is-primary" :disabled="!pasteText" @click="applyPaste">应用</button>
        <button class="zm-data-btn" @click="pasteText = ''; pasteError = null">清空</button>
      </div>
    </div>

    <pre class="zm-data-pre"><code>{{ json }}</code></pre>
  </div>
</template>

<style>
.zm-data-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.zm-data-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
}
.zm-data-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
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
.zm-data-paste {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
}
.zm-data-paste textarea {
  width: 100%;
  min-height: 80px;
  max-height: 200px;
  padding: 8px;
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
  gap: 6px;
  margin-top: 6px;
}
.zm-data-error {
  margin-top: 6px;
  font-size: 11px;
  color: #dc2626;
}
.zm-data-pre {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: #ffffff;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #334155;
  white-space: pre;
}
.zm-data-pre code {
  font-family: inherit;
}
</style>
