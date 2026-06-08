<script setup lang="ts">
/**
 * Node panel — body of the right-side drawer.  Renders every
 * payload of the selected node, each section is editable:
 *
 *   1. note  — editable textarea
 *   2. link  — URL input (display: chip; click to expand)
 *   3. image — URL input + live preview
 *   4. code  — textarea (raw markdown) with a syntax-highlighted
 *              preview that re-renders as the user types
 *   5. table — CSV-ish textarea with a live preview; column
 *              headers in the preview are clickable to sort the
 *              rows (asc → desc → off, doesn't write back to raw)
 *
 * Sections that aren't set on the selected node are hidden, so
 * the panel collapses to just the note when nothing else exists.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { MindMapNode } from '../types'
import {
  codeLang,
  highlightCode,
  rowsToTable,
  sortTable,
  stripCodeFence,
  tableRows,
  type SortDir,
} from '../composables/useRichContent'

const props = defineProps<{
  /** The currently selected node.  `null` means nothing is
   *  selected; the panel renders an empty-state in that case. */
  selectedNode: MindMapNode | null
  /** Disable all edit controls (read-only mode). */
  readonly?: boolean
  /** Bumped by the parent (App.vue) on each select change.  The
   *  panel uses this as a "focus the textarea" signal so the
   *  user can start typing immediately after picking a node. */
  focusTick?: number
}>()

const emit = defineEmits<{
  /** Note edit committed (blur / Ctrl+Enter).  Empty string clears it. */
  (e: 'apply', text: string): void
  /** Note removed. */
  (e: 'remove'): void
  /** Link URL edited (empty string removes the link). */
  (e: 'set-link', url: string): void
  /** Image src edited (empty string removes the image). */
  (e: 'set-image', src: string): void
  /** Rich body (code / table) raw markdown edited.  Pass the
   *  whole `richContent` payload so the parent can refresh the
   *  kind + lang tag too; pass `null` to remove the body. */
  (
    e: 'set-rich',
    payload: { kind: 'code' | 'table'; raw: string; lang?: string } | null
  ): void
}>()

// ---------------------------------------------------------------------------
// Note (the only always-editable field)
// ---------------------------------------------------------------------------
const draft = ref('')
const isEmpty = computed(() => !draft.value || draft.value.trim() === '')

watch(
  () => [props.selectedNode?.id, props.selectedNode?.note?.text],
  () => {
    draft.value = props.selectedNode?.note?.text ?? ''
  },
  { immediate: true }
)

watch(
  () => props.focusTick,
  async () => {
    if (props.readonly) return
    await nextTick()
    const ta = document.querySelector<HTMLTextAreaElement>('.zm-note-panel textarea.zm-note-textarea')
    if (ta) {
      ta.focus()
      const len = ta.value.length
      ta.setSelectionRange(len, len)
    }
  }
)

function commitNote() {
  if (props.readonly) return
  const next = draft.value
  const current = props.selectedNode?.note?.text ?? ''
  if (next === current) return
  emit('apply', next)
}
function onNoteKeydown(e: KeyboardEvent) {
  if (props.readonly) return
  if (e.key === 'Escape') {
    e.preventDefault()
    draft.value = props.selectedNode?.note?.text ?? ''
    ;(e.target as HTMLTextAreaElement).blur()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    commitNote()
    ;(e.target as HTMLTextAreaElement).blur()
  }
}
function onRemoveNote() {
  if (props.readonly) return
  if (!confirm('移除该节点的笔记?')) return
  draft.value = ''
  emit('remove')
}

// ---------------------------------------------------------------------------
// Section visibility flags
// ---------------------------------------------------------------------------
const hasLink = computed(() => !!props.selectedNode?.link?.url)
const hasImage = computed(() => !!props.selectedNode?.image?.src)
const richKind = computed(() => props.selectedNode?.richContent?.kind)
const hasCode = computed(() => richKind.value === 'code')
const hasTable = computed(() => richKind.value === 'table')

// ---------------------------------------------------------------------------
// Link edit
// ---------------------------------------------------------------------------
const linkDraft = ref('')
watch(
  () => [props.selectedNode?.id, props.selectedNode?.link?.url],
  () => {
    linkDraft.value = props.selectedNode?.link?.url ?? ''
  },
  { immediate: true }
)
function commitLink() {
  if (props.readonly) return
  const next = linkDraft.value.trim()
  const current = props.selectedNode?.link?.url ?? ''
  if (next === current) return
  emit('set-link', next)
}

// ---------------------------------------------------------------------------
// Image edit
// ---------------------------------------------------------------------------
const imageDraft = ref('')
watch(
  () => [props.selectedNode?.id, props.selectedNode?.image?.src],
  () => {
    imageDraft.value = props.selectedNode?.image?.src ?? ''
  },
  { immediate: true }
)
function commitImage() {
  if (props.readonly) return
  const next = imageDraft.value.trim()
  const current = props.selectedNode?.image?.src ?? ''
  if (next === current) return
  emit('set-image', next)
}
function onImageError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}
function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.display = ''
}

// ---------------------------------------------------------------------------
// Code edit — textarea holds the raw markdown (with or without
// the ``` fence), preview re-highlights as the user types.  On
// commit we re-derive the lang tag from the opening fence and
// emit a new richContent payload.
// ---------------------------------------------------------------------------
const codeDraft = ref('')
watch(
  () => [props.selectedNode?.id, props.selectedNode?.richContent?.raw],
  () => {
    codeDraft.value = props.selectedNode?.richContent?.raw ?? ''
  },
  { immediate: true }
)
const codePreviewHtml = computed(() => {
  return highlightCode(stripCodeFence(codeDraft.value), codeLang(codeDraft.value))
})
function commitCode() {
  if (props.readonly) return
  const next = codeDraft.value
  const current = props.selectedNode?.richContent?.raw ?? ''
  if (next === current) return
  const lang = codeLang(next) || undefined
  emit('set-rich', next ? { kind: 'code', raw: next, lang } : null)
}

// ---------------------------------------------------------------------------
// Table edit — textarea holds the raw markdown; preview is
// sortable but only in-memory (raw stays untouched).
// ---------------------------------------------------------------------------
const tableDraft = ref('')
const sortCol = ref(-1)
const sortDir = ref<SortDir>('asc')
watch(
  () => [props.selectedNode?.id, props.selectedNode?.richContent?.raw],
  () => {
    tableDraft.value = props.selectedNode?.richContent?.raw ?? ''
    // Switching nodes resets the sort UI.
    sortCol.value = -1
    sortDir.value = 'asc'
  },
  { immediate: true }
)
function commitTable() {
  if (props.readonly) return
  const next = tableDraft.value
  const current = props.selectedNode?.richContent?.raw ?? ''
  if (next === current) return
  emit('set-rich', next ? { kind: 'table', raw: next } : null)
}

// Live parse for the table preview.  Uses textarea content so the
// preview reflects in-progress edits before commit.
const tableParsedRows = computed(() => tableRows(tableDraft.value))
const sortedRows = computed(() => {
  const rows = tableParsedRows.value
  if (sortCol.value < 0 || rows.length <= 1) return rows
  return sortTable(rows, sortCol.value, sortDir.value)
})
function toggleSort(col: number) {
  if (sortCol.value !== col) {
    sortCol.value = col
    sortDir.value = 'asc'
  } else if (sortDir.value === 'asc') {
    sortDir.value = 'desc'
  } else {
    sortCol.value = -1
  }
}

// ---------------------------------------------------------------------------
// Header summary
// ---------------------------------------------------------------------------
const summary = computed(() => {
  const parts: string[] = []
  if (!isEmpty.value) parts.push(`${draft.value.length} 字`)
  if (hasLink.value) parts.push('1 链接')
  if (hasImage.value) parts.push('1 图片')
  if (hasCode.value) parts.push('代码块')
  if (hasTable.value) parts.push('表格')
  if (parts.length === 0) return '节点没有额外内容'
  return parts.join(' · ')
})
</script>

<template>
  <div class="zm-note-panel">
    <div v-if="!selectedNode" class="zm-note-empty">
      <p>请先在画布上选中一个节点。</p>
      <p class="zm-note-hint">
        选中节点后，会在这里展示并可编辑节点的笔记、链接、图片、代码块、表格。
      </p>
    </div>
    <template v-else>
      <div class="zm-note-header">
        <div class="zm-note-title-row">
          <span class="zm-note-label">节点</span>
          <span class="zm-note-name">{{ selectedNode.text || '(无标题)' }}</span>
        </div>
        <div class="zm-note-meta">{{ summary }}</div>
      </div>

      <div class="zm-note-scroll">
        <!-- Note -->
        <section class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">笔记</span>
            <span class="zm-note-section-hint">Ctrl+Enter 提交, Esc 取消</span>
          </header>
          <textarea
            v-model="draft"
            class="zm-note-textarea"
            :placeholder="'写点什么吧…'"
            spellcheck="false"
            :disabled="readonly"
            @blur="commitNote"
            @keydown="onNoteKeydown"
          />
          <div v-if="!readonly && !isEmpty" class="zm-note-section-actions">
            <button class="zm-note-action-btn is-danger" @click="onRemoveNote">移除笔记</button>
          </div>
        </section>

        <!-- Link -->
        <section v-if="hasLink || !readonly" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">链接</span>
          </header>
          <input
            v-model="linkDraft"
            class="zm-note-input"
            type="url"
            :placeholder="'https://…'"
            :disabled="readonly"
            @blur="commitLink"
            @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
          />
          <a
            v-if="hasLink"
            class="zm-note-link-chip"
            :href="selectedNode.link?.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="selectedNode.link?.url"
          >{{ selectedNode.link?.url }}</a>
        </section>

        <!-- Image -->
        <section v-if="hasImage || !readonly" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">图片</span>
          </header>
          <input
            v-model="imageDraft"
            class="zm-note-input"
            type="url"
            :placeholder="'data:image/… 或 https://…'"
            :disabled="readonly"
            @blur="commitImage"
            @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
          />
          <img
            v-if="hasImage"
            class="zm-note-image"
            :src="selectedNode.image?.src"
            :alt="selectedNode.text"
            @error="onImageError"
            @load="onImageLoad"
          />
        </section>

        <!-- Code -->
        <section v-if="hasCode || !readonly" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">代码块</span>
            <span v-if="codeLang(codeDraft)" class="zm-note-section-tag">{{ codeLang(codeDraft) }}</span>
          </header>
          <textarea
            v-model="codeDraft"
            class="zm-note-input zm-note-input-code"
            :placeholder="'```ts\nconsole.log(123)\n```'"
            spellcheck="false"
            :disabled="readonly"
            @blur="commitCode"
          />
          <pre v-if="codeDraft.trim()" class="zm-note-code"><code v-html="codePreviewHtml"></code></pre>
        </section>

        <!-- Table -->
        <section v-if="hasTable || !readonly" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">表格</span>
            <span class="zm-note-section-hint">点击表头排序</span>
          </header>
          <textarea
            v-model="tableDraft"
            class="zm-note-input zm-note-input-code"
            :placeholder="'| 列1 | 列2 |\n| --- | --- |\n| a | b |'"
            spellcheck="false"
            :disabled="readonly"
            @blur="commitTable"
          />
          <table v-if="tableParsedRows.length" class="zm-note-table">
            <tbody>
              <tr v-for="(row, ri) in sortedRows" :key="ri">
                <th
                  v-if="ri === 0"
                  v-for="(cell, ci) in row"
                  :key="`h${ci}`"
                  class="zm-note-table-sort"
                  :class="{
                    'is-sorted': sortCol === ci,
                    'is-asc': sortCol === ci && sortDir === 'asc',
                    'is-desc': sortCol === ci && sortDir === 'desc',
                  }"
                  @click="toggleSort(ci)"
                >
                  <span>{{ cell }}</span>
                  <span class="zm-note-table-sort-mark" aria-hidden="true">
                    {{ sortCol === ci ? (sortDir === 'asc' ? '▲' : '▼') : '↕' }}
                  </span>
                </th>
                <td
                  v-else
                  v-for="(cell, ci) in row"
                  :key="`c${ci}`"
                >{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>

<style>
@import 'highlight.js/styles/github.css';

.zm-note-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 12px 16px;
  gap: 10px;
  background: #f8fafc;
}
.zm-note-empty {
  padding: 20px 12px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}
.zm-note-empty p {
  margin: 0 0 6px;
}
.zm-note-hint {
  color: #94a3b8;
  font-size: 12px;
}
.zm-note-header {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.zm-note-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.zm-note-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  flex-shrink: 0;
}
.zm-note-name {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.zm-note-meta {
  font-size: 11px;
  color: #94a3b8;
}
.zm-note-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}
.zm-note-section {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zm-note-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.zm-note-section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  flex: 1;
  min-width: 0;
}
.zm-note-section-hint {
  font-size: 10px;
  color: #94a3b8;
}
.zm-note-section-tag {
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  color: #475569;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 1px 6px;
  line-height: 1.4;
}
.zm-note-section-actions {
  display: flex;
  justify-content: flex-end;
}

.zm-note-textarea {
  width: 100%;
  min-height: 120px;
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}
.zm-note-textarea:focus {
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.zm-note-textarea:disabled {
  background: #f8fafc;
  color: #94a3b8;
  cursor: not-allowed;
}
.zm-note-textarea::placeholder {
  color: #94a3b8;
  white-space: pre-line;
}

.zm-note-input {
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}
.zm-note-input:focus {
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
.zm-note-input:disabled {
  background: #f8fafc;
  color: #94a3b8;
  cursor: not-allowed;
}
.zm-note-input-code {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 11px;
  min-height: 90px;
  resize: vertical;
  white-space: pre;
}

.zm-note-link-chip {
  display: inline-block;
  max-width: 100%;
  padding: 6px 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  color: #1d4ed8;
  font-size: 12px;
  text-decoration: none;
  word-break: break-all;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.1s;
}
.zm-note-link-chip:hover {
  background: #dbeafe;
}

.zm-note-image {
  display: block;
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
  border-radius: 6px;
  background: #f1f5f9;
  margin: 0 auto;
}

.zm-note-code {
  margin: 0;
  padding: 10px 12px;
  background: #f6f8fa;
  color: #24292e;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}
.zm-note-code code {
  font: inherit;
  color: inherit;
  background: transparent;
  padding: 0;
}

.zm-note-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  color: #1e293b;
  table-layout: auto;
}
.zm-note-table td {
  border: 1px solid #e2e8f0;
  padding: 5px 8px;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}
.zm-note-table-sort {
  background: #f1f5f9;
  font-weight: 600;
  padding: 5px 8px;
  border: 1px solid #e2e8f0;
  text-align: left;
  cursor: pointer;
  user-select: none;
  position: relative;
}
.zm-note-table-sort:hover {
  background: #e2e8f0;
}
.zm-note-table-sort.is-sorted {
  background: #dbeafe;
  color: #1d4ed8;
}
.zm-note-table-sort-mark {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: #94a3b8;
}
.zm-note-table-sort.is-sorted .zm-note-table-sort-mark {
  color: #1d4ed8;
}

.zm-note-action-btn {
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  color: #ffffff;
  background: #3b82f6;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-note-action-btn.is-danger {
  color: #b91c1c;
  background: #ffffff;
  border-color: #fca5a5;
}
.zm-note-action-btn.is-danger:hover {
  background: #fee2e2;
  border-color: #f87171;
}
</style>
