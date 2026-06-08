<script setup lang="ts">
/**
 * Node panel — body of the right-side drawer.  Renamed in spirit
 * from "笔记" to "节点内容" because it now shows ALL of a node's
 * payload, not just the note:
 *
 *   1. note  — editable textarea (the only field the user can
 *              edit from this panel; right-click on the canvas
 *              node handles the rest)
 *   2. link  — read-only URL chip; clicking opens in a new tab
 *   3. image — read-only preview thumbnail
 *   4. code  — read-only fenced code block
 *   5. table — read-only mini grid
 *
 * Sections that aren't set on the selected node are hidden, so
 * the panel collapses to just the note when nothing else exists.
 */
import { computed, ref, watch, nextTick } from 'vue'
import type { MindMapNode } from '../types'

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
  /** User edited the note.  `text` may be empty (clears the note). */
  (e: 'apply', text: string): void
  /** User removed the note entirely. */
  (e: 'remove'): void
}>()

const draft = ref('')
const isEmpty = computed(() => !draft.value || draft.value.trim() === '')

// Keep the draft in sync with the bound node.  Whenever the
// selected id changes (or the underlying note field changes via
// undo/redo), the draft re-seeds.
watch(
  () => [props.selectedNode?.id, props.selectedNode?.note?.text],
  () => {
    draft.value = props.selectedNode?.note?.text ?? ''
  },
  { immediate: true }
)

// Focus the textarea when the parent signals a fresh open.  We
// use a `tick` prop rather than auto-focusing on mount so that
// re-selecting a node while the drawer is already open also
// re-focuses.
watch(
  () => props.focusTick,
  async () => {
    if (props.readonly) return
    await nextTick()
    const ta = document.querySelector<HTMLTextAreaElement>('.zm-note-panel textarea')
    if (ta) {
      ta.focus()
      // Don't select all on re-focus — the user might just want
      // the cursor at the end.  Place caret at the end of the
      // current text instead.
      const len = ta.value.length
      ta.setSelectionRange(len, len)
    }
  }
)

function commit() {
  if (props.readonly) return
  const next = draft.value
  const current = props.selectedNode?.note?.text ?? ''
  if (next === current) return
  emit('apply', next)
}

function onKeydown(e: KeyboardEvent) {
  if (props.readonly) return
  if (e.key === 'Escape') {
    e.preventDefault()
    // Revert local draft and lose focus.  Parent keeps the
    // drawer open so the user can re-open the editor.
    draft.value = props.selectedNode?.note?.text ?? ''
    ;(e.target as HTMLTextAreaElement).blur()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    commit()
    ;(e.target as HTMLTextAreaElement).blur()
  }
}

function onRemove() {
  if (props.readonly) return
  if (!confirm('移除该节点的笔记?')) return
  draft.value = ''
  emit('remove')
}

// Which previews have content?  The template skips any section
// whose flag is false, so an empty node shows only the textarea.
const hasLink = computed(() => !!props.selectedNode?.link?.url)
const hasImage = computed(() => !!props.selectedNode?.image?.src)
const richKind = computed(() => props.selectedNode?.richContent?.kind)
const hasCode = computed(() => richKind.value === 'code')
const hasTable = computed(() => richKind.value === 'table')

// Pull a table's pipe rows out of the raw markdown.  Same logic
// as MindMap.vue's tableRows() — duplicated here rather than
// exported so the panel can be used without pulling layout code.
function splitTableRows(raw: string): string[][] {
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^\|/.test(l) && !/^\|\s*[-:]+\s*\|/.test(l))
    .map(l =>
      l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(c => c.trim())
    )
}

// Strip the opening/closing ``` fences from a code block so the
// preview shows the body, not the fence markers.
function stripCodeFence(raw: string): string {
  const lines = raw.split('\n')
  if (/^(`{3,}|~{3,})/.test(lines[0] ?? '')) lines.shift()
  if (/^(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1] ?? '')) lines.pop()
  return lines.join('\n').replace(/\n+$/, '')
}
</script>

<template>
  <div class="zm-note-panel">
    <div v-if="!selectedNode" class="zm-note-empty">
      <p>请先在画布上选中一个节点。</p>
      <p class="zm-note-hint">
        选中节点后，会在这里展示节点的笔记、链接、图片、代码块、表格。
      </p>
    </div>
    <template v-else>
      <div class="zm-note-header">
        <div class="zm-note-title-row">
          <span class="zm-note-label">节点</span>
          <span class="zm-note-name">{{ selectedNode.text || '(无标题)' }}</span>
        </div>
        <div class="zm-note-meta">
          {{ isEmpty && !hasLink && !hasImage && !hasCode && !hasTable
              ? '节点没有额外内容'
              : `${isEmpty ? '' : draft.length + ' 字'}${hasLink ? ' · 1 链接' : ''}${hasImage ? ' · 1 图片' : ''}${hasCode ? ' · 代码块' : ''}${hasTable ? ' · 表格' : ''}` }}
        </div>
      </div>

      <div class="zm-note-scroll">
        <!-- Note: the only editable field. -->
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
            @blur="commit"
            @keydown="onKeydown"
          />
          <div v-if="!readonly && !isEmpty" class="zm-note-section-actions">
            <button
              class="zm-note-action-btn is-danger"
              title="移除笔记"
              @click="onRemove"
            >移除笔记</button>
          </div>
        </section>

        <!-- Link: read-only chip; click to follow. -->
        <section v-if="hasLink" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">链接</span>
          </header>
          <a
            class="zm-note-link-chip"
            :href="selectedNode.link?.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="selectedNode.link?.url"
          >{{ selectedNode.link?.url }}</a>
        </section>

        <!-- Image: read-only preview at natural width, capped. -->
        <section v-if="hasImage" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">图片</span>
          </header>
          <img
            class="zm-note-image"
            :src="selectedNode.image?.src"
            :alt="selectedNode.text"
          />
        </section>

        <!-- Code: read-only fenced block, monospace. -->
        <section v-if="hasCode" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">代码块</span>
            <span v-if="selectedNode.richContent?.lang" class="zm-note-section-tag">
              {{ selectedNode.richContent?.lang }}
            </span>
          </header>
          <pre class="zm-note-code"><code>{{ stripCodeFence(selectedNode.richContent?.raw || '') }}</code></pre>
        </section>

        <!-- Table: read-only mini grid. -->
        <section v-if="hasTable" class="zm-note-section">
          <header class="zm-note-section-head">
            <span class="zm-note-section-title">表格</span>
          </header>
          <table class="zm-note-table">
            <tbody>
              <tr v-for="(row, ri) in splitTableRows(selectedNode.richContent?.raw || '')" :key="ri">
                <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>

<style>
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

/* Scroll container for the previews so the textarea + cards
 * can grow beyond the drawer height.  The header stays pinned
 * outside this container. */
.zm-note-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
  /* Pull the scrollbar a bit inside the panel gutter. */
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
  background: #0f172a;
  color: #e2e8f0;
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
.zm-note-table tr:first-child td {
  background: #f1f5f9;
  font-weight: 600;
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
