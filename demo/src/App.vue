<script setup lang="ts">
// Consumer demo — verifies the published flow-mindmap package.
// With builtInDrawers (default true), MindMap renders its own
// Drawer + Panel components for settings / data / markdown / note
// / outline — no manual event wiring needed.
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { MindMap, VERSION } from 'flow-mindmap'
import 'flow-mindmap/style.css'
import type { MindMapNode, MindMapSettings } from 'flow-mindmap'

// =====================================================================
// i18n — minimal zh/en dictionary for the left debug panel.
// =====================================================================
const lang = ref<'zh' | 'en'>('zh')
function setLang(l: 'zh' | 'en') { lang.value = l }
const t = (zh: string, en: string) => (lang.value === 'zh' ? zh : en)

// =====================================================================
// Initial data — used for "reset" and as the default tree.
// =====================================================================
const initialData: MindMapNode = {
  id: 'root',
  text: 'flow-mindmap 消费测试',
  children: [
    {
      id: 'a', text: '核心功能', children: [
        { id: 'a1', text: '节点增删改', children: [] },
        { id: 'a2', text: '拖拽布局', children: [] },
        { id: 'a3', text: '缩放与平移', children: [] },
      ],
    },
    {
      id: 'b', text: '扩展', children: [
        { id: 'b1', text: '节点图片', children: [] },
        { id: 'b2', text: '超链接', children: [] },
        { id: 'b3', text: '节点笔记', children: [] },
      ],
    },
    {
      id: 'c', text: '设置', children: [
        { id: 'c1', text: '布局模式', children: [] },
        { id: 'c2', text: '连线样式', children: [] },
        { id: 'c3', text: '彩虹分支', children: [] },
      ],
    },
  ],
}

const data = ref<MindMapNode>(initialData)
const mmRef = ref<InstanceType<typeof MindMap> | null>(null)
const selectedId = ref<string | null>(null)
const selectedIds = computed<string[]>(() => mmRef.value?.getSelectedIds() ?? [])
const lastEvent = ref<string>('(none)')
const previewMode = ref(false)

const theme = reactive({
  rootBg: '#0f172a',
  rootText: '#ffffff',
  branchBg: '#ffffff',
  branchText: '#1e293b',
  bgColor: '#f8fafc',
  fontSize: 14,
  lineWidthStart: 12,
  lineWidthEnd: 0.6,
  rainbowBranch: true,
})

const markdownInput = ref<string>('')
const lastMarkdownEmitted = ref<string>('')
const lineColorsInput = ref<string>('')

const settings = reactive<MindMapSettings>({
  autoBalanceOnChange: true,
  lineWidthStart: 12,
  lineWidthEnd: 0.6,
  rainbowBranch: true,
  branchPaletteId: 'default',
  customPalettes: [],
  lineStyle: 'curve',
  layoutMode: 'mindmap',
  taperedEdge: true,
  showOrderBadge: false,
})

const canUndo = ref(false)
const canRedo = ref(false)
function refreshHistoryFlags() {
  canUndo.value = mmRef.value?.canUndo() ?? false
  canRedo.value = mmRef.value?.canRedo() ?? false
}

// Collapsible section state — each section can be toggled open/closed.
const collapsedSections = ref(new Set<string>())
function toggleSection(id: string) {
  const next = new Set(collapsedSections.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedSections.value = next
}
function isSectionOpen(id: string) {
  return !collapsedSections.value.has(id)
}

// =====================================================================
// Event handlers — only for the debug panel.  The built-in drawers
// (settings / data / markdown / note / outline) are handled entirely
// inside MindMap via the builtInDrawers prop (default true).
// =====================================================================
function onChange(d: MindMapNode) {
  data.value = d
  refreshHistoryFlags()
  lastEvent.value = `change — ${countNodes(d)} 节点`
}

function onSelect(nodes: MindMapNode[] | null) {
  const primary = nodes && nodes.length > 0 ? nodes[0] : null
  selectedId.value = primary?.id ?? null
  lastEvent.value = primary ? `select — ${primary.id} (${primary.text})` : 'select — null'
}

function onMarkdownChange(md: string) {
  lastMarkdownEmitted.value = md
  lastEvent.value = `markdownChange — ${md.length} chars`
}

function applyMarkdown() {
  mmRef.value?.setMarkdown(markdownInput.value, false)
  lastEvent.value = `setMarkdown — ${markdownInput.value.length} chars`
}

const lineColorsList = computed<string[]>(() => {
  const raw = lineColorsInput.value.trim()
  if (!raw) return []
  return raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)
})

function countNodes(n: MindMapNode): number {
  return 1 + n.children.reduce((acc, c) => acc + countNodes(c), 0)
}

const totalNodes = computed(() => countNodes(data.value))

function act(name: string, fn: () => void) {
  try {
    fn()
    lastEvent.value = `${name} — ok (${totalNodes.value} 节点)`
  } catch (e) {
    lastEvent.value = `${name} — ERR: ${(e as Error).message}`
  }
  refreshHistoryFlags()
}

function actGet<T>(name: string, fn: () => T): T | undefined {
  try {
    const v = fn()
    lastEvent.value = `${name} — ${JSON.stringify(v).slice(0, 200)}`
    return v
  } catch (e) {
    lastEvent.value = `${name} — ERR: ${(e as Error).message}`
    return undefined
  }
}

const selectedNode = computed(() => {
  if (!selectedId.value) return null
  return findNode(data.value, selectedId.value) ?? null
})

function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const r = findNode(c, id)
    if (r) return r
  }
  return null
}

function selectRoot() {
  selectedId.value = 'root'
  lastEvent.value = 'selectRoot (manual)'
}

onMounted(() => {
  mmRef.value?.applySettings(settings)
  refreshHistoryFlags()

  const canvas = document.querySelector('.demo-canvas')
  if (canvas) {
    const mo = new MutationObserver(() => {
      const sel = canvas.querySelector('.is-selected') as HTMLElement | null
      const id = sel?.getAttribute('data-node-id') ?? null
      if (id !== null && id !== selectedId.value) {
        selectedId.value = id
        lastEvent.value = `select — ${id} (DOM)`
      } else if (id === null && selectedId.value !== null) {
        if (selectedId.value === 'root') return
        selectedId.value = null
        lastEvent.value = 'select — null (DOM)'
      }
    })
    mo.observe(canvas, { subtree: true, attributes: true, attributeFilter: ['class'] })
    ;(window as unknown as Record<string, unknown>).__mo = mo
  }

  ;(window as unknown as Record<string, unknown>).__demo = {
    getSelected: () => selectedId.value,
    getTotalNodes: () => totalNodes.value,
    getLastEvent: () => lastEvent.value,
    getDataJson: () => JSON.stringify(data.value),
    getSettings: () => mmRef.value?.getSettings() ?? settings,
    getNodeText: (id: string) => findNode(data.value, id)?.text,
    getNodeLink: (id: string) => findNode(data.value, id)?.link?.url,
    getNodeNote: (id: string) => findNode(data.value, id)?.note?.text,
    getNodeStyle: (id: string) => mmRef.value?.getNodeStyle(id) ?? {},
    getCurrentPalette: () => mmRef.value?.getBranchPalette() ?? '',
    getPalettes: () => mmRef.value?.getBranchPalettes() ?? [],
    getMarkdown: () => mmRef.value?.getMarkdown() ?? '',
    getLastMarkdownEmitted: () => lastMarkdownEmitted.value,
    getFontSize: () => theme.fontSize,
    setMarkdownEcho: (md: string) => mmRef.value?.setMarkdown(md, true),
  }
})

onBeforeUnmount(() => {
  ;(window as unknown as { __mo?: { disconnect?: () => void } }).__mo?.disconnect?.()
  delete (window as unknown as Record<string, unknown>).__mo
  delete (window as unknown as Record<string, unknown>).__demo
})
</script>

<template>
  <div class="demo">
    <header class="demo-header">
      <div class="demo-header-left">
        <h1>flow-mindmap</h1>
        <span class="demo-version">v{{ VERSION }}</span>
      </div>
      <div class="demo-header-right">
        <span class="demo-status">
          {{ t('节点', 'Nodes') }}: <b data-testid="total-nodes">{{ totalNodes }}</b> ·
          {{ t('选中', 'Sel') }}: <b data-testid="selected-id">{{ selectedId ?? '∅' }}</b> ·
          {{ t('最后事件', 'Last') }}: <b data-testid="last-event">{{ lastEvent }}</b>
        </span>
        <div class="demo-lang-toggle">
          <button :class="{ active: lang === 'zh' }" @click="setLang('zh')">中</button>
          <button :class="{ active: lang === 'en' }" @click="setLang('en')">EN</button>
        </div>
      </div>
    </header>

    <main class="demo-main">
      <!-- ============ Left debug panel ============ -->
      <aside class="demo-panel">
        <!-- Props -->
        <details class="demo-section" open>
          <summary class="demo-section-title" @click.prevent="toggleSection('props')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('props') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('属性', 'Props') }}
          </summary>
          <div v-if="isSectionOpen('props')" class="demo-section-body">
            <label class="demo-toggle">
              <input type="checkbox" v-model="previewMode" data-testid="prop-preview" />
              <span>previewMode ({{ t('隐藏画布工具栏,禁用编辑', 'hide canvas toolbar, disable editing') }})</span>
            </label>
          </div>
        </details>

        <!-- Settings -->
        <details class="demo-section" open>
          <summary class="demo-section-title" @click.prevent="toggleSection('settings')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('settings') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('设置', 'Settings') }}
          </summary>
          <div v-if="isSectionOpen('settings')" class="demo-section-body">
            <label class="demo-field">
              <span class="demo-field-label">layoutMode</span>
              <select v-model="settings.layoutMode" data-testid="set-layoutmode" @change="mmRef?.applySettings({ layoutMode: settings.layoutMode })">
                <option value="mindmap">mindmap</option>
                <option value="tree">tree</option>
                <option value="org">org</option>
              </select>
            </label>
            <label class="demo-field">
              <span class="demo-field-label">lineStyle</span>
              <select v-model="settings.lineStyle" data-testid="set-linestyle" @change="mmRef?.applySettings({ lineStyle: settings.lineStyle })">
                <option value="curve">curve</option>
                <option value="straight">straight</option>
              </select>
            </label>
            <label class="demo-toggle">
              <input type="checkbox" v-model="settings.rainbowBranch" data-testid="set-rainbow" @change="mmRef?.applySettings({ rainbowBranch: settings.rainbowBranch })" />
              <span>rainbowBranch</span>
            </label>
            <label class="demo-toggle">
              <input type="checkbox" v-model="settings.taperedEdge" data-testid="set-tapered" @change="mmRef?.applySettings({ taperedEdge: settings.taperedEdge })" />
              <span>taperedEdge</span>
            </label>
            <label class="demo-toggle">
              <input type="checkbox" v-model="settings.showOrderBadge" data-testid="set-orderbadge" @change="mmRef?.applySettings({ showOrderBadge: settings.showOrderBadge })" />
              <span>showOrderBadge</span>
            </label>
            <label class="demo-field">
              <span class="demo-field-label">palette</span>
              <select :value="settings.branchPaletteId" data-testid="set-palette" @change="(e) => { settings.branchPaletteId = (e.target as HTMLSelectElement).value; mmRef?.setBranchPalette(settings.branchPaletteId) }">
                <option value="default">default</option>
                <option value="classic">classic</option>
                <option value="vivid">vivid</option>
                <option value="dev">dev</option>
                <option value="mint">mint</option>
              </select>
            </label>
          </div>
        </details>

        <!-- Node ops -->
        <details class="demo-section" open>
          <summary class="demo-section-title" @click.prevent="toggleSection('nodeops')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('nodeops') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('节点操作', 'Node ops') }}
          </summary>
          <div v-if="isSectionOpen('nodeops')" class="demo-section-body">
            <div class="demo-btn-grid">
              <button data-testid="op-select-root" @click="selectRoot">selectRoot</button>
              <button data-testid="op-addchild" :disabled="!selectedId" @click="act('addChild', () => { if (selectedId) mmRef?.addChild(selectedId) })">addChild</button>
              <button data-testid="op-addsibling" :disabled="!selectedId || selectedId === 'root'" @click="act('addSibling', () => { if (selectedId) mmRef?.addSibling(selectedId) })">addSibling</button>
              <button data-testid="op-remove" :disabled="!selectedId || selectedId === 'root'" @click="act('removeNode', () => { if (selectedId) mmRef?.removeNode(selectedId) })">removeNode</button>
              <button data-testid="op-duplicate" :disabled="!selectedId" @click="act('duplicateNode', () => { if (selectedId) mmRef?.duplicateNode(selectedId) })">duplicateNode</button>
              <button data-testid="op-settext" :disabled="!selectedId" @click="act('setNodeText', () => { if (selectedId) mmRef?.setNodeText(selectedId, `编辑于 ${Date.now() % 10000}`) })">setNodeText</button>
            </div>
            <button class="demo-btn demo-btn--full" data-testid="op-move" :disabled="!selectedNode" @click="act('moveNode', () => { if (selectedId && selectedId !== 'root') mmRef?.moveNode(selectedId, 'root', 'child') })">{{ t('移动到根节点子级', 'moveNode → root child') }}</button>
          </div>
        </details>

        <!-- Node extension -->
        <details class="demo-section" open>
          <summary class="demo-section-title" @click.prevent="toggleSection('nodeext')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('nodeext') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('节点扩展', 'Node extension') }}
          </summary>
          <div v-if="isSectionOpen('nodeext')" class="demo-section-body">
            <div class="demo-btn-grid">
              <button data-testid="op-style" :disabled="!selectedId" @click="act('applyNodeStyle', () => { if (selectedId) mmRef?.applyNodeStyle(selectedId, { bg: '#fef08a', borderColor: '#ca8a04', fontWeight: 600 }) })">{{ t('高亮样式', 'Style highlight') }}</button>
              <button data-testid="op-style-clear" :disabled="!selectedId" @click="act('clearStyle', () => { if (selectedId) mmRef?.applyNodeStyle(selectedId, {}) })">{{ t('清除样式', 'Clear style') }}</button>
              <button data-testid="op-link" :disabled="!selectedId" @click="act('applyNodeLink', () => { if (selectedId) mmRef?.applyNodeLink(selectedId, 'https://example.com') })">{{ t('设置链接', 'setLink') }}</button>
              <button data-testid="op-link-clear" :disabled="!selectedId" @click="act('removeLink', () => { if (selectedId) mmRef?.removeNodeLink(selectedId) })">{{ t('清除链接', 'clearLink') }}</button>
              <button data-testid="op-note" :disabled="!selectedId" @click="act('applyNodeNote', () => { if (selectedId) mmRef?.applyNodeNote(selectedId, 'demo note text') })">{{ t('设置笔记', 'setNote') }}</button>
              <button data-testid="op-note-clear" :disabled="!selectedId" @click="act('removeNote', () => { if (selectedId) mmRef?.removeNodeNote(selectedId) })">{{ t('清除笔记', 'clearNote') }}</button>
            </div>
          </div>
        </details>

        <!-- View & Data -->
        <details class="demo-section">
          <summary class="demo-section-title" @click.prevent="toggleSection('view')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('view') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('视图与数据', 'View & Data') }}
          </summary>
          <div v-if="isSectionOpen('view')" class="demo-section-body">
            <div class="demo-btn-grid">
              <button data-testid="op-resetview" @click="act('resetView', () => mmRef?.resetView())">resetView</button>
              <button data-testid="op-getdata" @click="actGet('getData', () => { const d = mmRef?.getData(); return { nodes: d ? countNodes(d) : 0 } })">getData</button>
            </div>
            <button class="demo-btn demo-btn--full" data-testid="op-setdata" @click="act('setData', () => mmRef?.setData(initialData))">{{ t('重置数据', 'setData(initial)') }}</button>
          </div>
        </details>

        <!-- History -->
        <details class="demo-section">
          <summary class="demo-section-title" @click.prevent="toggleSection('history')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('history') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('历史', 'History') }}
          </summary>
          <div v-if="isSectionOpen('history')" class="demo-section-body">
            <div class="demo-btn-grid">
              <button data-testid="op-undo" :disabled="!canUndo" @click="act('undo', () => mmRef?.undo())">undo</button>
              <button data-testid="op-redo" :disabled="!canRedo" @click="act('redo', () => mmRef?.redo())">redo</button>
            </div>
          </div>
        </details>

        <!-- Multi-select -->
        <details class="demo-section">
          <summary class="demo-section-title" @click.prevent="toggleSection('multi')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('multi') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('多选', 'Multi-select') }}
            <span v-if="selectedIds.length" class="demo-badge">{{ selectedIds.length }}</span>
          </summary>
          <div v-if="isSectionOpen('multi')" class="demo-section-body">
            <small data-testid="sel-count" class="demo-hint">{{ t('已选', 'Selected') }} <b>{{ selectedIds.length }}</b> {{ t('个节点', 'node(s)') }}</small>
            <div class="demo-btn-grid">
              <button data-testid="op-copy" :disabled="selectedIds.length === 0" @click="act('copyNodes', () => mmRef?.copyNodes(selectedIds))">{{ t('复制', 'copy') }}</button>
              <button data-testid="op-cut" :disabled="selectedIds.length === 0" @click="act('cutNodes', () => mmRef?.cutNodes(selectedIds))">{{ t('剪切', 'cut') }}</button>
              <button data-testid="op-paste" :disabled="!selectedId" @click="act('pasteNodes', () => mmRef?.pasteNodes(selectedId))">{{ t('粘贴→选中', 'paste → sel') }}</button>
              <button data-testid="op-paste-root" @click="act('pasteNodes', () => mmRef?.pasteNodes(null))">{{ t('粘贴→根', 'paste → root') }}</button>
            </div>
          </div>
        </details>

        <!-- Import/Export -->
        <details class="demo-section">
          <summary class="demo-section-title" @click.prevent="toggleSection('io')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('io') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('导入 / 导出', 'Import / Export') }}
          </summary>
          <div v-if="isSectionOpen('io')" class="demo-section-body">
            <div class="demo-btn-grid">
              <button data-testid="op-export" @click="actGet('exportData', () => mmRef?.exportData()?.slice(0, 80))">exportData</button>
              <button data-testid="op-import" @click="act('importData', () => { const ok = mmRef?.importData(mmRef?.exportData() ?? '{}'); return ok })">importData</button>
            </div>
          </div>
        </details>

        <!-- Theme -->
        <details class="demo-section">
          <summary class="demo-section-title" @click.prevent="toggleSection('theme')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('theme') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            {{ t('主题', 'Theme') }}
          </summary>
          <div v-if="isSectionOpen('theme')" class="demo-section-body">
            <label class="demo-field">
              <span class="demo-field-label">fontSize</span>
              <input data-testid="theme-fontsize" type="number" v-model.number="theme.fontSize" min="10" max="32" />
            </label>
            <p class="demo-hint">{{ t('节点大小按 fontSize/14 等比缩放', 'Node size scales by fontSize/14') }}</p>
          </div>
        </details>

        <!-- Markdown -->
        <details class="demo-section">
          <summary class="demo-section-title" @click.prevent="toggleSection('markdown')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('markdown') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            Markdown
          </summary>
          <div v-if="isSectionOpen('markdown')" class="demo-section-body">
            <textarea
              data-testid="markdown-input"
              v-model="markdownInput"
              rows="4"
              :placeholder="t('粘贴 markdown, 点击 setMarkdown 替换数据', 'Paste markdown, click setMarkdown to replace data')"
              class="demo-textarea"
            ></textarea>
            <button class="demo-btn demo-btn--full" data-testid="op-setmarkdown" @click="applyMarkdown">setMarkdown</button>
            <p class="demo-hint">{{ t('已回传', 'Emitted') }}: <span data-testid="md-emitted-len">{{ lastMarkdownEmitted.length }}</span> chars</p>
          </div>
        </details>

        <!-- lineColors -->
        <details class="demo-section">
          <summary class="demo-section-title" @click.prevent="toggleSection('linecolors')">
            <svg class="demo-section-chevron" :class="{ 'is-collapsed': !isSectionOpen('linecolors') }" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2.5 3 5 6 7.5 3" /></svg>
            lineColors
          </summary>
          <div v-if="isSectionOpen('linecolors')" class="demo-section-body">
            <textarea
              data-testid="linecolors-input"
              v-model="lineColorsInput"
              rows="2"
              placeholder="#f87171, #34d399, #60a5fa"
              class="demo-textarea"
            ></textarea>
            <p class="demo-hint">{{ t('留空 = 走 palette。优先级: lineColors > branchPaletteId', 'Empty = use palette. Priority: lineColors > branchPaletteId') }}</p>
          </div>
        </details>
      </aside>

      <!-- ============ Canvas — builtInDrawers is true by default,
           so all drawers (settings/data/markdown/note/outline) are
           handled internally by MindMap.  No manual event wiring. ============ -->
      <section class="demo-canvas" :class="{ preview: previewMode }">
        <MindMap
          ref="mmRef"
          :data="data"
          :preview-mode="previewMode"
          :theme="theme"
          :line-colors="lineColorsList"
          @change="onChange"
          @select="onSelect"
          @canvas-toggle-preview="previewMode = !previewMode"
          @markdown-change="onMarkdownChange"
          style="width: 100%; height: 100%"
        />
      </section>
    </main>
  </div>
</template>

<style>
html, body, #app { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.demo { display: flex; flex-direction: column; height: 100%; }

/* Header */
.demo-header {
  padding: 8px 16px;
  background: #0f172a;
  color: #f1f5f9;
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}
.demo-header-left { display: flex; align-items: center; gap: 8px; }
.demo-header h1 { font-size: 14px; margin: 0; font-weight: 700; }
.demo-version {
  font-size: 10px;
  font-weight: 600;
  color: #818cf8;
  background: rgba(99, 102, 241, 0.15);
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.02em;
}
.demo-header-right { display: flex; align-items: center; gap: 12px; }
.demo-status { font-size: 11px; color: #94a3b8; }
.demo-status b { color: #f8fafc; font-weight: 600; margin-right: 4px; }

/* Language toggle */
.demo-lang-toggle {
  display: flex;
  border: 1px solid #334155;
  border-radius: 6px;
  overflow: hidden;
}
.demo-lang-toggle button {
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  cursor: pointer;
  transition: all 0.1s;
}
.demo-lang-toggle button.active {
  background: #6366f1;
  color: #ffffff;
}
.demo-lang-toggle button:not(.active):hover {
  background: #1e293b;
  color: #f1f5f9;
}

/* Layout */
.demo-main { display: flex; flex: 1; min-height: 0; }

/* Left panel */
.demo-panel {
  width: 280px;
  border-right: 1px solid #e2e8f0;
  background: #f8fafc;
  overflow-y: auto;
  flex-shrink: 0;
  padding: 6px 0;
}

/* Collapsible section */
.demo-section { border-bottom: 1px solid #eef0f3; }
.demo-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  user-select: none;
  list-style: none;
  transition: background 0.1s;
}
.demo-section-title::-webkit-details-marker { display: none; }
.demo-section-title:hover { background: #eef2ff; }
.demo-section-chevron { flex-shrink: 0; color: #94a3b8; transition: transform 0.15s; }
.demo-section-chevron.is-collapsed { transform: rotate(-90deg); }
.demo-section-body { padding: 4px 14px 10px; display: flex; flex-direction: column; gap: 6px; }

/* Badge */
.demo-badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  color: #4f46e5;
  background: #e0e7ff;
  padding: 1px 7px;
  border-radius: 999px;
  line-height: 1.4;
}

/* Form fields */
.demo-field { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #475569; }
.demo-field-label { flex-shrink: 0; width: 70px; font-weight: 500; }
.demo-field select,
.demo-field input[type="number"] {
  flex: 1;
  padding: 3px 6px;
  font: inherit;
  font-size: 11px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  background: #ffffff;
  color: #1e293b;
  outline: none;
  transition: border-color 0.1s;
}
.demo-field select:focus,
.demo-field input[type="number"]:focus { border-color: #6366f1; }

/* Toggle (checkbox + label) */
.demo-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #475569; cursor: pointer; padding: 2px 0; }
.demo-toggle input { accent-color: #6366f1; }

/* Hint */
.demo-hint { font-size: 10px; color: #94a3b8; line-height: 1.5; margin: 2px 0; }
.demo-hint b { color: #64748b; }

/* Textarea */
.demo-textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.5;
  padding: 5px 6px;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  background: #ffffff;
  color: #1e293b;
  resize: vertical;
  outline: none;
  transition: border-color 0.1s;
}
.demo-textarea:focus { border-color: #6366f1; }

/* Buttons */
.demo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 8px;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #334155;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.1s;
}
.demo-btn:hover:not(:disabled) { background: #eef2ff; border-color: #818cf8; color: #4f46e5; }
.demo-btn:active:not(:disabled) { transform: scale(0.97); }
.demo-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.demo-btn--full { width: 100%; margin-top: 2px; }

/* Button grid — 2 columns */
.demo-btn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.demo-btn-grid .demo-btn { width: 100%; }

/* Canvas */
.demo-canvas { flex: 1; position: relative; min-width: 0; background: #f8fafc; }

/* Scrollbar */
.demo-panel::-webkit-scrollbar { width: 5px; }
.demo-panel::-webkit-scrollbar-track { background: transparent; }
.demo-panel::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.demo-panel::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
</style>
