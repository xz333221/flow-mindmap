<script setup lang="ts">
// 7860 consumer demo. 库 0.3.1 只导出 <MindMap>,demo 侧自己拼按钮和状态栏。
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { MindMap, Outline, Drawer, NotePanel } from 'flow-mindmap'
import 'flow-mindmap/style.css'
import type {
  MindMapNode,
  MindMapSettings,
  NodeStyle,
  BranchPalette,
} from 'flow-mindmap'

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
const lastEvent = ref<string>('(none)')
const previewMode = ref(false)
const showOutline = ref(false)
const outlineCollapsed = ref(new Set<string>())
// Note drawer — opens on node select / 右键"添加笔记"; reads + writes
// the selected node's note/link/image/code/table via the library's
// <NotePanel>.  noteFocusTick++ tells NotePanel to focus its textarea
// after the drawer has been toggled open.
const showNote = ref(false)
const noteFocusTick = ref(0)
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

const onChange = (d: MindMapNode) => {
  data.value = d
  refreshHistoryFlags()
  lastEvent.value = `change — ${countNodes(d)} 节点`
}
const onSelect = (n: MindMapNode | null) => {
  selectedId.value = n?.id ?? null
  // Mirror the library's built-in App: clicking a node opens the
  // note drawer; clicking empty canvas closes it.  We ALSO gate
  // the open on `nodeHasContent` so plain text nodes don't pop
  // the drawer at all — clicking a leaf should stay
  // non-destructive.  The right-side drawer is only useful when
  // the node has note / link / image / rich body to edit.
  // `nodeHasContent` is exposed on the MindMap instance so the
  // source of truth is the data tree (which the library just
  // updated), not a stale snapshot.
  // previewMode also closes the drawer — gated on the Drawer's
  // :open expression so we don't need to do anything special here.
  showNote.value = !!n && (mmRef.value?.nodeHasContent(n.id) ?? false)
  lastEvent.value = n ? `select — ${n.id} (${n.text})` : 'select — null'
}

const openSettings = () => { lastEvent.value = 'canvas-settings' }
const openDataDrawer = () => { lastEvent.value = 'canvas-data' }
const openImport = (_mode: 'markdown' | 'json' | 'txt') => { lastEvent.value = 'canvas-import' }

const onEditNote = (id: string) => {
  // MindMap 的右键菜单走的路径可能比 `select` 先到,做一次 lookup 兜底
  // 让 NotePanel 立刻显示正确的节点内容。
  if (!selectedId.value || selectedId.value !== id) {
    const n = findNode(data.value, id)
    if (n) selectedId.value = id
  }
  showNote.value = true
  noteFocusTick.value++
  lastEvent.value = `edit-note — ${id}`
}
const onMarkdownChange = (md: string) => {
  lastMarkdownEmitted.value = md
  lastEvent.value = `markdownChange — ${md.length} chars`
}

function applyMarkdown() {
  mmRef.value?.setMarkdown(markdownInput.value, false)
  lastEvent.value = `setMarkdown — ${markdownInput.value.length} chars`
}

// NotePanel → MindMap mutations.  Each is a one-liner that forwards
// to the corresponding expose() method on the MindMap instance.
function onNoteApply(text: string) {
  if (!selectedId.value) return
  mmRef.value?.applyNodeNote(selectedId.value, text)
}
function onNoteRemove() {
  if (!selectedId.value) return
  mmRef.value?.removeNodeNote(selectedId.value)
}
function onLinkSet(url: string) {
  if (!selectedId.value) return
  mmRef.value?.applyNodeLink(selectedId.value, url)
}
function onImageSet(src: string) {
  if (!selectedId.value) return
  mmRef.value?.applyNodeImageByUrl(selectedId.value, src)
}
function onRichSet(payload: { kind: 'code' | 'table'; raw: string; lang?: string } | null) {
  if (!selectedId.value) return
  mmRef.value?.applyNodeRichContent(selectedId.value, payload)
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

// 手动选中根节点:画布上根节点的点击库有时不会 emit select,
// 留这个按钮可以快速验证整条 expose 链路。
function selectRoot() {
  selectedId.value = 'root'
  lastEvent.value = 'selectRoot (manual)'
}

onMounted(() => {
  mmRef.value?.applySettings(settings)
  refreshHistoryFlags()

  // 旁路 DOM 选中检测:无论库 emit 与否,只要画布上有
  // .is-selected 类的节点,就把 selectedId 同步过去。
  const canvas = document.querySelector('.demo-canvas')
  if (canvas) {
    const mo = new MutationObserver(() => {
      const sel = canvas.querySelector('.is-selected') as HTMLElement | null
      const id = sel?.getAttribute('data-node-id') ?? null
      if (id !== null && id !== selectedId.value) {
        selectedId.value = id
        lastEvent.value = `select — ${id} (DOM)`
      } else if (id === null && selectedId.value !== null) {
        // 取消选中时不要清掉手动选中的 root
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
  ;(window as unknown as Record<string, unknown>).__mo?.disconnect?.()
  delete (window as unknown as Record<string, unknown>).__mo
  delete (window as unknown as Record<string, unknown>).__demo
})
</script>

<template>
  <div class="demo">
    <header class="demo-header">
      <h1>flow-mindmap consumer demo</h1>
      <span class="demo-status">
        节点: <b data-testid="total-nodes">{{ totalNodes }}</b> ·
        选中: <b data-testid="selected-id">{{ selectedId ?? '∅' }}</b> ·
        最后事件: <b data-testid="last-event">{{ lastEvent }}</b>
      </span>
    </header>

    <main class="demo-main">
      <aside class="demo-panel">
        <section>
          <h2>Props</h2>
          <label>
            <input type="checkbox" v-model="previewMode" data-testid="prop-preview" />
            previewMode(隐藏库顶栏,禁用编辑)
          </label>
        </section>

        <section>
          <h2>Settings</h2>
          <label>
            layoutMode:
            <select v-model="settings.layoutMode" data-testid="set-layoutmode" @change="mmRef?.applySettings({ layoutMode: settings.layoutMode })">
              <option value="mindmap">mindmap</option>
              <option value="tree">tree</option>
              <option value="org">org</option>
            </select>
          </label>
          <label>
            lineStyle:
            <select v-model="settings.lineStyle" data-testid="set-linestyle" @change="mmRef?.applySettings({ lineStyle: settings.lineStyle })">
              <option value="curve">curve</option>
              <option value="straight">straight</option>
            </select>
          </label>
          <label>
            <input type="checkbox" v-model="settings.rainbowBranch" data-testid="set-rainbow" @change="mmRef?.applySettings({ rainbowBranch: settings.rainbowBranch })" />
            rainbowBranch
          </label>
          <label>
            <input type="checkbox" v-model="settings.taperedEdge" data-testid="set-tapered" @change="mmRef?.applySettings({ taperedEdge: settings.taperedEdge })" />
            taperedEdge
          </label>
          <label>
            <input type="checkbox" v-model="settings.showOrderBadge" data-testid="set-orderbadge" @change="mmRef?.applySettings({ showOrderBadge: settings.showOrderBadge })" />
            showOrderBadge
          </label>
          <label>
            branchPaletteId:
            <select :value="settings.branchPaletteId" data-testid="set-palette" @change="(e) => { settings.branchPaletteId = (e.target as HTMLSelectElement).value; mmRef?.setBranchPalette(settings.branchPaletteId) }">
              <option value="default">default</option>
              <option value="classic">classic</option>
              <option value="vivid">vivid</option>
              <option value="dev">dev</option>
              <option value="mint">mint</option>
            </select>
          </label>
        </section>

        <section>
          <h2>Node ops (expose)</h2>
          <button data-testid="op-select-root" @click="selectRoot">selectRoot(手动)</button>
          <button data-testid="op-addchild" :disabled="!selectedId" @click="act('addChild', () => { if (selectedId) mmRef?.addChild(selectedId) })">addChild(选中)</button>
          <button data-testid="op-addsibling" :disabled="!selectedId || selectedId === 'root'" @click="act('addSibling', () => { if (selectedId) mmRef?.addSibling(selectedId) })">addSibling(选中)</button>
          <button data-testid="op-remove" :disabled="!selectedId || selectedId === 'root'" @click="act('removeNode', () => { if (selectedId) mmRef?.removeNode(selectedId) })">removeNode(选中)</button>
          <button data-testid="op-duplicate" :disabled="!selectedId" @click="act('duplicateNode', () => { if (selectedId) mmRef?.duplicateNode(selectedId) })">duplicateNode(选中)</button>
          <button data-testid="op-settext" :disabled="!selectedId" @click="act('setNodeText', () => { if (selectedId) mmRef?.setNodeText(selectedId, `编辑于 ${Date.now() % 10000}`) })">setNodeText(选中)</button>
          <button data-testid="op-move" :disabled="!selectedNode" @click="act('moveNode → root child', () => { if (selectedId && selectedId !== 'root') mmRef?.moveNode(selectedId, 'root', 'child') })">moveNode(选中 → root 子)</button>
        </section>

        <section>
          <h2>Node extension</h2>
          <button data-testid="op-style" :disabled="!selectedId" @click="act('applyNodeStyle', () => { if (selectedId) mmRef?.applyNodeStyle(selectedId, { bg: '#fef08a', borderColor: '#ca8a04', fontWeight: 600 }) })">applyNodeStyle(高亮)</button>
          <button data-testid="op-style-clear" :disabled="!selectedId" @click="act('applyNodeStyle(clear)', () => { if (selectedId) mmRef?.applyNodeStyle(selectedId, {}) })">applyNodeStyle(清除)</button>
          <button data-testid="op-link" :disabled="!selectedId" @click="act('applyNodeLink', () => { if (selectedId) mmRef?.applyNodeLink(selectedId, 'https://example.com') })">applyNodeLink</button>
          <button data-testid="op-link-clear" :disabled="!selectedId" @click="act('removeNodeLink', () => { if (selectedId) mmRef?.removeNodeLink(selectedId) })">removeNodeLink</button>
          <button data-testid="op-note" :disabled="!selectedId" @click="act('applyNodeNote', () => { if (selectedId) mmRef?.applyNodeNote(selectedId, 'demo note text') })">applyNodeNote</button>
          <button data-testid="op-note-clear" :disabled="!selectedId" @click="act('removeNodeNote', () => { if (selectedId) mmRef?.removeNodeNote(selectedId) })">removeNodeNote</button>
        </section>

        <section>
          <h2>View</h2>
          <button data-testid="op-resetview" @click="act('resetView', () => mmRef?.resetView())">resetView()</button>
          <button data-testid="op-getdata" @click="actGet('getData', () => { const d = mmRef?.getData(); return { nodes: d ? countNodes(d) : 0 } })">getData()</button>
          <button data-testid="op-setdata" @click="act('setData(initialData)', () => mmRef?.setData(initialData))">setData(initial)</button>
        </section>

        <section>
          <h2>History</h2>
          <button data-testid="op-undo" :disabled="!canUndo" @click="act('undo', () => mmRef?.undo())">undo</button>
          <button data-testid="op-redo" :disabled="!canRedo" @click="act('redo', () => mmRef?.redo())">redo</button>
        </section>

        <section>
          <h2>Import/Export</h2>
          <button data-testid="op-export" @click="actGet('exportData', () => mmRef?.exportData()?.slice(0, 80))">exportData()</button>
          <button data-testid="op-import" @click="act('importData', () => { const ok = mmRef?.importData(mmRef?.exportData() ?? '{}'); return ok })">importData(exportData)</button>
        </section>

        <section>
          <h2>Theme</h2>
          <label>fontSize <input data-testid="theme-fontsize" type="number" v-model.number="theme.fontSize" min="10" max="32" /></label>
          <small style="color:#64748b;font-size:11px">节点大小会按 fontSize/14 等比缩放</small>
        </section>

        <section>
          <h2>Markdown</h2>
          <textarea
            data-testid="markdown-input"
            v-model="markdownInput"
            rows="5"
            placeholder="粘贴 markdown 内容,点击 setMarkdown 替换数据"
            style="width:100%;font-family:ui-monospace,monospace;font-size:11px;padding:4px"
          ></textarea>
          <button data-testid="op-setmarkdown" @click="applyMarkdown">setMarkdown(textarea)</button>
          <small style="color:#64748b;font-size:11px">已回传的 markdown: <span data-testid="md-emitted-len">{{ lastMarkdownEmitted.length }}</span> chars</small>
        </section>

        <section>
          <h2>lineColors</h2>
          <textarea
            data-testid="linecolors-input"
            v-model="lineColorsInput"
            rows="2"
            placeholder="逗号或换行分隔:#f87171, #34d399, #60a5fa"
            style="width:100%;font-family:ui-monospace,monospace;font-size:11px;padding:4px"
          ></textarea>
          <small style="color:#64748b;font-size:11px">留空 = 走 palette。优先级: lineColors &gt; branchPaletteId</small>
        </section>
      </aside>

      <section class="demo-canvas" :class="{ preview: previewMode }">
        <MindMap
          ref="mmRef"
          :data="data"
          :preview-mode="previewMode"
          :theme="theme"
          :line-colors="lineColorsList"
          @change="onChange"
          @select="onSelect"
          @edit-note="onEditNote"
            @canvas-settings="openSettings"
            @canvas-data="openDataDrawer"
            @canvas-import="openImport"
            @canvas-toggle-preview="previewMode = !previewMode"
            @canvas-outline="showOutline = !showOutline"
          @markdown-change="onMarkdownChange"
          style="width: 100%; height: 100%"
        />

        <!-- Right-side note drawer.  scope="canvas" anchors it to
             .demo-canvas with a backdrop overlay — zero layout
             surgery.  previewMode also closes it via the :open
             expression. -->
        <Drawer
          side="right"
          scope="canvas"
          :width="360"
          :open="showNote && !previewMode"
          title="节点内容"
          @update:open="(v) => (showNote = v)"
        >
          <NotePanel
            :selected-node="selectedNode"
            :focus-tick="noteFocusTick"
            @apply="onNoteApply"
            @remove="onNoteRemove"
            @set-link="onLinkSet"
            @set-image="onImageSet"
            @set-rich="onRichSet"
          />
        </Drawer>
      </section>


      <div v-if="showOutline" class="demo-outline-backdrop" @click="showOutline = false" />
      <aside v-if="showOutline" class="demo-outline-drawer">
        <div class="demo-outline-header">
          <span class="demo-outline-title">大纲</span>
          <button class="demo-outline-close" title="关闭" @click="showOutline = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6 L18 18 M18 6 L6 18" /></svg>
          </button>
        </div>
        <div class="demo-outline-body">
          <Outline :data="data" :selected-id="selectedId" :collapsed-ids="outlineCollapsed" readonly />
        </div>
      </aside>
    </main>
  </div>
</template>

<style>
html, body, #app { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.demo { display: flex; flex-direction: column; height: 100%; }
.demo-header { padding: 8px 14px; background: #0f172a; color: #f1f5f9; display: flex; gap: 16px; align-items: center; }
.demo-header h1 { font-size: 14px; margin: 0; font-weight: 600; }
.demo-status { font-size: 12px; color: #cbd5e1; }
.demo-status b { color: #f8fafc; font-weight: 600; margin-right: 6px; }
.demo-main { display: flex; flex: 1; min-height: 0; }
.demo-panel { width: 320px; border-right: 1px solid #e2e8f0; background: #ffffff; overflow-y: auto; padding: 8px 12px 24px; flex-shrink: 0; }
.demo-panel h2 { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; margin: 14px 0 6px; }
.demo-panel section + section { border-top: 1px dashed #e2e8f0; }
.demo-panel label { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; }
.demo-panel select, .demo-panel input[type="number"] { flex: 1; padding: 2px 4px; font: inherit; }
.demo-panel button { display: block; width: 100%; text-align: left; padding: 4px 8px; margin: 2px 0; font: inherit; font-size: 12px; border: 1px solid #cbd5e1; background: #f8fafc; color: #1e293b; border-radius: 4px; cursor: pointer; }
.demo-panel button:hover:not(:disabled) { background: #e0e7ff; border-color: #818cf8; }
.demo-panel button:disabled { opacity: 0.4; cursor: not-allowed; }
.demo-canvas { flex: 1; position: relative; min-width: 0; background: #f8fafc; }


/* Outline drawer (slides in from the left when the user clicks the
 * canvas fab).  Overlay backdrop dims the rest of the page; the
 * drawer holds the read-only <Outline> tree. */
.demo-outline-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.18);
  z-index: 50;
}
.demo-outline-drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 320px;
  max-width: 90vw;
  background: #ffffff;
  border-right: 1px solid #e2e8f0;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  display: flex;
  flex-direction: column;
  z-index: 51;
  font-size: 13px;
}
.demo-outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
}
.demo-outline-title {
  font-weight: 600;
  color: #1e293b;
}
.demo-outline-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: #64748b;
  cursor: pointer;
}
.demo-outline-close:hover {
  background: #f1f5f9;
  color: #1e293b;
}
.demo-outline-body {
  flex: 1;
  overflow: auto;
  padding: 6px 0;
}
</style>
