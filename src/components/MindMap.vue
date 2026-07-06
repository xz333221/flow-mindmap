<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
// Reuse the add-node icons from the outline panel.  Vite ?url
// gives a stable URL we can pass to <img src=…>; the buttons
// stay styled by .zm-tb-btn.
import addNodeIcon from '../assets/svg/add-node.svg?url'
import addSubNodeIcon from '../assets/svg/add-sub-node.svg?url'
import { layout, type LayoutNode } from '../core/layout'
import { BUILTIN_PALETTES, resolvePalette, type BranchPalette } from '../core/palettes'
import {
  addChild,
  addSibling,
  addSiblingBefore,
  removeNode,
  setNodeText,
  moveNode,
  findNode,
  findParent,
  duplicateNode,
  clone,
  cloneSubtree,
  reassignIds,
  DEFAULT_NEW_NODE_TEXT,
  markdownToMindMap,
  mindMapToMarkdown,
} from '../tree'
import type { MindMapNode, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, MindMapImage } from '../types'
import { usePanZoom } from '../composables/usePanZoom'
import { useKeyboard } from '../composables/useKeyboard'
import { useHistory } from '../composables/useHistory'
import NodeContextMenu from './NodeContextMenu.vue'
import CanvasContextMenu from './CanvasContextMenu.vue'
import {
  codeLang,
  highlightCode,
  sortTable,
  stripCodeFence,
  tableRows,
  type SortDir,
} from '../composables/useRichContent'
import { markerSvg, markerLabel, tagColor, MARKER_LIB } from '../core/markers'

const props = withDefaults(
  defineProps<{
    data: MindMapNode
    theme?: MindMapTheme
    /**
     * When true, hides the MindMap's own toolbar and disables every
     * edit operation (add/remove/edit/drag/paste/rich-edit/note
     * edit/context menu).  Expand/collapse stays available so the
     * user can still navigate a large tree.  The app-level top
     * toolbar / drawers are controlled by the parent (App.vue).
     */
    previewMode?: boolean
    /**
     * Optional raw markdown source.  When set, the component parses
     * it into the data tree and ignores `data` (use one or the
     * other).  Editing nodes on the canvas emits `markdownChange`
     * with the re-serialized form, so the host can keep its
     * markdown source in sync without polling.  Pass an empty
     * string to clear.
     */
    markdown?: string
    /**
     * Optional per-edge color list.  When set, top-level branches
     * draw their edges (and their descendant edges under
     * `rainbowBranch`) using these colors in order, wrapping
     * around.  Overrides the palette picked by `branchPaletteId`
     * / `customPalettes`.  Pass an empty array to fall back to
     * the palette pipeline.
     */
    lineColors?: string[]
    /**
     * When true, hides the built-in canvas action buttons
     * (top-right preview toggle, top-left outline view).  Use this
     * when the consumer already exposes equivalent controls in
     * their surrounding chrome and doesn't want duplicates.  Default
     * false so the npm package ships with a discoverable, ready-to-use
     * UI.
     */
    hideCanvasActions?: boolean
  }>(),
  { previewMode: false, hideCanvasActions: false }
)

const emit = defineEmits<{
  (e: 'change', data: MindMapNode): void
  /** Fires on every selection change. The payload is the full set of
   *  selected data nodes — never empty; null means "nothing selected".
   *  Hosts should treat this as the source of truth for "what's picked
   *  right now"; the [0] entry is the primary selection for one-target
   *  actions (toolbar buttons, drawer, etc). */
  (e: 'select', nodes: MindMapNode[] | null): void
  /** Fired when the user clicks a node's note icon or picks
   *  "添加笔记" / "编辑笔记" from the right-click menu.  The
   *  parent is expected to open the right-side note drawer
   *  scoped to the given node. */
  (e: 'edit-note', nodeId: string): void
  /** Fired when `markdown` is in use and the underlying data
   *  changes (user edit, import, etc).  The string is the
   *  re-serialized markdown representation. */
  (e: 'markdownChange', markdown: string): void
  /** Fired when the user clicks the canvas action buttons
   *  (top-right preview toggle, top-left outline view) or
   *  corresponding entries on the canvas context menu.  The
   *  parent decides how to render them (drawer / dialog /
   *  separate route) — MindMap only signals intent. */
  (e: 'canvas-toggle-preview'): void
  (e: 'canvas-outline'): void
  (e: 'canvas-settings'): void
  (e: 'canvas-data'): void
  (e: 'canvas-import', mode: 'markdown' | 'json' | 'txt'): void
}>()

const wrapperRef = ref<HTMLElement | null>(null)
const editingId = ref<string | null>(null)
const editText = ref('')
// Multi-select model: a Set of node ids.  `selectedId` is a
// computed view of the set's first entry — kept for backward-compat
// reads (template's `selectedId === n.id` checks, single-id toolbar
// gating, image-control v-if).  The first id is the "primary"
// selection — toolbar buttons (add child / sibling) operate on it.
const selectedIds = ref<Set<string>>(new Set())
const selectedId = computed<string | null>(() => {
  const first = selectedIds.value.values().next().value
  return first ?? null
})
const collapsedIds = ref<Set<string>>(new Set())
// True when the cursor is over the canvas.  In preview mode the
// bottom toolbar fades in on hover; in non-preview mode this is
// ignored (the toolbar stays put).
const canvasHovered = ref(false)

// Drag-to-reparent state.  Set on pointerdown over a non-root
// node, cleared on pointerup.  pointerOffset is the cursor's
// position relative to the source node's screen-space centre, so
// the ghost doesn't snap-to-center but tracks the grab point.
// srcText is captured at pickup time so the ghost can render
// without re-running findNode on every pointermove.
const dragState = ref<{
  srcId: string
  srcText: string
  pointerOffsetX: number
  pointerOffsetY: number
  currentTargetId: string | null
} | null>(null)
const dragGhostX = ref(0)
const dragGhostY = ref(0)

// Clipboard buffer.  Holds a list of cloned subtrees (with fresh
// ids) ready to paste, plus the originals' pre-clone ids so the
// cycle guard can detect "target was a descendant of the copied
// subtree".  Per-instance — multi-instance MindMaps in the same
// page each have their own buffer.
interface ClipboardBuffer {
  nodes: MindMapNode[]
  originalIds: Set<string>
}
const clipboard = ref<ClipboardBuffer | null>(null)

// Text-overflow tooltip: shows the full text of a node whose label
// is truncated by `max-width: 200px`.  We use text length as the
// gate (DOM measurement via scrollWidth works but fights Vue's
// patch lifecycle), and read the node's screen rect on demand for
// positioning.  The tooltip is rendered as a fixed-position
// element on the wrapper so it escapes the zoom transform on the
// inner layer.
const tooltip = ref<{ text: string; x: number; y: number; above: boolean } | null>(null)

// In-place rich body edit: which node has its code/table flipped
// into edit mode, and the live draft text.  Only one node can be
// in this state at a time.  Sort state is also per-node so the
// same node keeps its sort across re-renders.  Both are plain
// Maps keyed by node id — they hold no data-tree state.
const richEditingId = ref<string | null>(null)
const richEditDraft = ref('')
const sortState = ref<Map<string, { col: number; dir: SortDir }>>(new Map())
const dataRef = ref<MindMapNode>(clone(props.data))
// Post-render measurements of each node's rich body
// (<div class="zm-rich">).  Populated by `measureRichBodies()`
// after every layout-affecting mutation, consumed by `layout()`
// via the `richHeights` / `richWidths` options.  Re-rendering
// after the size changes re-lays out the tree so neighbouring
// nodes don't collide with the new box.
const richHeights = ref<Record<string, number>>({})
const richWidths = ref<Record<string, number>>({})
// `usingMarkdown` is true when the current dataRef was derived from
// the `markdown` prop.  Used by the change-watcher below to decide
// whether to emit `markdownChange` after a user edit.
const usingMarkdown = ref(props.markdown !== undefined)
// Set when the watcher on props.markdown writes into dataRef, so the
// dataRef watcher can ignore that write-back and not emit a
// markdownChange loop.
let suppressMarkdownEmit = false

watch(
  () => props.markdown,
  (md) => {
    if (md === undefined) {
      usingMarkdown.value = false
      return
    }
    usingMarkdown.value = true
    // Parse and replace the data tree, but mark the change as
    // "internal" so the dataRef watcher doesn't echo it back as
    // markdownChange.
    const parsed = markdownToMindMap(md || '')
    suppressMarkdownEmit = true
    dataRef.value = clone(parsed)
    selectedIds.value = new Set()
    collapsedIds.value = new Set()
    triggerRef()
    nextTick(() => {
      suppressMarkdownEmit = false
      resetView()
    })
  },
)

// After any data-mutating path (addChild, removeNode, edit, import,
// paste, …), the `change` emit is fired.  When the user is in
// markdown mode we also fire `markdownChange` with the re-serialized
// form so the host can keep its source in sync.
watch(
  dataRef,
  () => {
    if (usingMarkdown.value && !suppressMarkdownEmit) {
      emit('markdownChange', mindMapToMarkdown(dataRef.value))
    }
  },
  { deep: true },
)
// Debug overlay: sibling-order badge on every node, gated behind
// the showOrderBadge setting (default off — toggled in the
// settings panel).  When on, each rendered node shows a small
// "1./2./3." with its zero-based position in its parent's
// children array, so you can see whether the layout's left/right
// split matches the data-tree order.
const showOrderBadge = computed(() => settings.showOrderBadge === true)
// Per-node style overrides.  Keyed by node id.  Stored in a reactive
// Map (not Vue reactive Map) so .set/.delete work; the template re-
// reads via the ref-of-Map we wrap it in.
const nodeStylesRef = ref<Map<string, NodeStyle>>(new Map())
const nodeStyles = nodeStylesRef.value
function applyNodeStyle(id: string, style: NodeStyle) {
// shallow copy to keep the public surface pure
const cleaned: NodeStyle = {}
if (style.bg) cleaned.bg = style.bg
if (style.textColor) cleaned.textColor = style.textColor
if (style.borderColor) cleaned.borderColor = style.borderColor
if (style.fontWeight) cleaned.fontWeight = style.fontWeight
if (style.fontSize) cleaned.fontSize = style.fontSize
  if (Object.keys(cleaned).length === 0) {
    nodeStyles.delete(id)
  } else {
    nodeStyles.set(id, cleaned)
  }
  // bump ref so reactive consumers re-render
  nodeStylesRef.value = new Map(nodeStyles)
}
function getNodeStyle(id: string): NodeStyle {
  return nodeStyles.get(id) ?? {}
}
function getNodeStyleOr(id: string, fallback: NodeStyle): NodeStyle {
  return nodeStyles.get(id) ?? fallback
}

// ---------------------------------------------------------------------------
// Node image — embedded picture shown above the node text.  The user picks
// a file via the on-canvas button; we read it as a data URL, capture the
// natural dimensions, and stash it on the data tree.  Width/height are
// user-tweakable via a drag handle on the bottom-right corner of the
// node.  The drag handle writes back through `applyNodeImage`.
// ---------------------------------------------------------------------------
const IMG_MIN_W = 24
const IMG_MAX_W = 400
/** Default rendered width for a freshly uploaded image, capped to a
 *  sane size so a 4000×3000 photo doesn't explode the layout. */
const IMG_DEFAULT_W = 160

function applyNodeImage(id: string, image: MindMapImage) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  n.image = {
    src: image.src,
    naturalW: image.naturalW,
    naturalH: image.naturalH,
    width: clamp(image.width, IMG_MIN_W, IMG_MAX_W),
    height: clamp(image.height, IMG_MIN_W, IMG_MAX_W),
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}

function removeNodeImage(id: string) {
  const n = findNode(dataRef.value, id)
  if (!n || !n.image) return
  delete n.image
  record()
  triggerRef()
  emit('change', dataRef.value)
}

/** Set / replace / clear a node's image from a plain URL or
 *  data: URI.  Used by the right-side panel's image input — the
 *  image picker is still the canvas's file-input flow.  We have
 *  to fetch the asset to read its natural dimensions; on failure
 *  we fall back to IMG_DEFAULT_W squared so the node still has a
 *  visible image shape. */
function applyNodeImageByUrl(id: string, url: string) {
  const trimmed = url.trim()
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!trimmed) {
    removeNodeImage(id)
    return
  }
  const img = new Image()
  img.onload = () => {
    const n2 = findNode(dataRef.value, id)
    if (!n2) return
    // Lock aspect ratio, clamp width to IMG_MAX_W, fall back
    // to a square when the image is broken.
    const aspect = img.naturalWidth && img.naturalHeight
      ? img.naturalWidth / img.naturalHeight
      : 1
    const w = clamp(
      img.naturalWidth || IMG_DEFAULT_W,
      IMG_MIN_W,
      IMG_MAX_W
    )
    const h = Math.round(w / aspect)
    n2.image = {
      src: trimmed,
      naturalW: img.naturalWidth || w,
      naturalH: img.naturalHeight || h,
      width: w,
      height: h,
    }
    record()
    triggerRef()
    emit('change', dataRef.value)
  }
  img.onerror = () => {
    // Keep what was there before, but the panel hides a broken
    // image via its own @error handler.  We could fall back to
    // a 1×1 placeholder; for now just leave the existing image
    // untouched so the user can correct the URL.
  }
  img.src = trimmed
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Read a File into a data URL, decode its natural dimensions, and
 *  call onLoaded({ src, naturalW, naturalH }).  No-op on error. */
function readImageFile(file: File, onLoaded: (img: MindMapImage) => void) {
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result !== 'string') return
    const src = reader.result
    const probe = new window.Image()
    probe.onload = () => {
      const naturalW = probe.naturalWidth || IMG_DEFAULT_W
      const naturalH = probe.naturalHeight || IMG_DEFAULT_W
      // Default rendered width: keep naturalW but cap at IMG_DEFAULT_W.
      const width = clamp(naturalW, IMG_MIN_W, IMG_DEFAULT_W)
      const height = clamp(Math.round((naturalH * width) / naturalW), IMG_MIN_W, IMG_MAX_W)
      onLoaded({ src, naturalW, naturalH, width, height })
    }
    probe.onerror = () => {
      // Some images (SVG, very small) — fall back to a 1:1 box.
      onLoaded({ src, naturalW: IMG_DEFAULT_W, naturalH: IMG_DEFAULT_W, width: IMG_DEFAULT_W, height: IMG_DEFAULT_W })
    }
    probe.src = src
  }
  reader.readAsDataURL(file)
}

/** Click the on-canvas "image" button → open a hidden file picker.
 *  Hidden in the template; we trigger it programmatically. */
function onPickImage(nodeId: string) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    readImageFile(file, (img) => applyNodeImage(nodeId, img))
    document.body.removeChild(input)
  }
  document.body.appendChild(input)
  input.click()
}

// ---------------------------------------------------------------------------
// Per-node link / note — the data model lives on the MindMapNode itself
// (`link?: { url }`, `note?: { text }`).  These helpers mirror the
// applyNodeImage pattern: read the existing node, mutate, snapshot,
// trigger re-layout.
// ---------------------------------------------------------------------------
function applyNodeLink(id: string, url: string) {
  const trimmed = url.trim()
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!trimmed) {
    delete n.link
  } else {
    n.link = { url: trimmed }
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}
function removeNodeLink(id: string) {
  applyNodeLink(id, '')
}
function applyNodeNote(id: string, text: string) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!text) {
    delete n.note
  } else {
    n.note = { text }
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}
function removeNodeNote(id: string) {
  applyNodeNote(id, '')
}
function applyNodeRichContent(id: string, content: { kind: 'code' | 'table'; raw: string; lang?: string } | null) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!content) {
    delete n.richContent
  } else {
    n.richContent = content
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}

// ---------------------------------------------------------------------------
// Context menu — right-click a node to open a small popover with
// "添加/替换图片", "添加/编辑链接", "添加/编辑笔记" actions.
// Each action either triggers a file picker, a prompt(), or the
// inline note editor.  The menu is unmounted on any of: outside
// click, Esc, scroll, or right-click on another node.
// ---------------------------------------------------------------------------
interface MenuState {
  nodeId: string
  /** ClientX of the right-click. */
  x: number
  /** ClientY of the right-click. */
  y: number
}
const contextMenu = ref<MenuState | null>(null)
// Right-click on empty canvas (not on a node) opens a small popover
// with 查看数据 / 导入 / 设置.  No node context, so the state is just
// the cursor position.  Closed by the menu's own outside-click /
// Esc / scroll listeners.
const canvasMenu = ref<{ x: number; y: number } | null>(null)

// Canvas action buttons -- top-right preview toggle and top-left
// outline view.  Always visible so the npm package ships with a
// discoverable, ready-to-use UI; the host just listens to the
// canvas-toggle-preview / canvas-outline events and handles
// preview mode + drawer state itself.  hideCanvasActions lets a
// consumer opt out (e.g. when they already have their own buttons
// in the surrounding chrome).
// Match the bottom toolbar's visibility: always show in non-preview
// mode (the FABs are a discoverable nav control), but only show in
// preview mode while the cursor is over the canvas (otherwise the
// user is just viewing -- don't clutter the chrome).
const fabPreviewClass = computed(() => {
  const visible = !props.hideCanvasActions && (!props.previewMode || canvasHovered.value)
  return ['zm-canvas-fab', 'zm-canvas-fab-preview', visible ? 'is-visible' : '']
    .filter(Boolean)
    .join(' ')
})
const fabOutlineClass = computed(() => {
  const visible = !props.hideCanvasActions && (!props.previewMode || canvasHovered.value)
  return ['zm-canvas-fab', 'zm-canvas-fab-outline', visible ? 'is-visible' : '']
    .filter(Boolean)
    .join(' ')
})
function onNodeContextMenu(e: MouseEvent, n: LayoutNode) {
  if (props.previewMode) return
  e.preventDefault()
  e.stopPropagation()
  // Mutual exclusion: dismiss any open canvas menu so two menus
  // never stack.  Right-clicking a node replaces the canvas menu.
  canvasMenu.value = null
  // Selecting the node is implicit — right-clicking a different
  // node should move the selection to it so the menu actions
  // operate on the right node.  If it's the same node, no-op.
  selectedIds.value = new Set([n.id])
  emitSelection()
  contextMenu.value = { nodeId: n.id, x: e.clientX, y: e.clientY }
}
function closeContextMenu() {
  contextMenu.value = null
}
function onCanvasContextMenu(e: MouseEvent) {
  // The node context-menu handler stopPropagation()'s, so this only
  // fires for right-clicks on the canvas background -- not on a node.
  // Don't open the canvas menu when the right-click lands on a control
  // (toolbar, fab, note button, etc).
  const target = e.target as HTMLElement | null
  if (target?.closest('.zm-toolbar, button, input, textarea, .zm-canvas-fab-preview, .zm-canvas-fab-outline')) return
  // If the right button was just used to drag-pan the canvas (moved
  // beyond the threshold), suppress both our menu AND the native
  // browser context menu — the user intended to pan, not to open a
  // menu.  A simple right-click without movement still shows the menu.
  if (lastPanWasRightButton && panZoom.panMoved.value) {
    lastPanWasRightButton = false
    e.preventDefault()
    return
  }
  e.preventDefault()
  // Mutual exclusion: opening the canvas menu dismisses any open
  // node context menu.
  if (contextMenu.value) contextMenu.value = null
  canvasMenu.value = { x: e.clientX, y: e.clientY }
}
function closeCanvasMenu() {
  canvasMenu.value = null
}
function menuOpenSettings() {
  closeCanvasMenu()
  emit('canvas-settings')
}
function menuOpenData() {
  closeCanvasMenu()
  emit('canvas-data')
}
function menuOpenImport(mode: 'markdown' | 'json' | 'txt') {
  closeCanvasMenu()
  emit('canvas-import', mode)
}

function menuPickImage() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  onPickImage(id)
}
function menuSetLink() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const existing = findNode(dataRef.value, id)?.link?.url ?? ''
  const url = window.prompt('输入链接 URL（留空取消）', existing)
  if (url === null) return // user pressed cancel
  applyNodeLink(id, url)
}
function menuRemoveLink() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  removeNodeLink(id)
}
function menuEditNote() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  emitEditNote(id)
}
function menuRemoveNote() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  removeNodeNote(id)
}
function menuRemoveImage() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  removeNodeImage(id)
}
function menuAddCode() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const existing = findNode(dataRef.value, id)?.richContent
  const cur = existing?.kind === 'code' ? stripCodeFence(existing.raw) : ''
  const lang = existing?.kind === 'code' ? existing.lang || '' : ''
  const header = lang ? '```' + lang + '\n' : '```\n'
  const placeholder = '// 你的代码'
  const raw = window.prompt(
    '输入代码块内容（用 ```lang 包裹；留空取消）',
    cur ? header + cur + (cur.endsWith('```') ? '' : '\n```') : header + placeholder + '\n```'
  )
  if (raw === null) return
  const trimmed = raw.trim()
  if (!trimmed) {
    applyNodeRichContent(id, null)
    return
  }
  // Detect an opening fence to extract the language tag.
  const m = /^```([^\s`]*)/.exec(trimmed)
  const lang2 = m ? m[1] : undefined
  applyNodeRichContent(id, { kind: 'code', raw: trimmed, lang: lang2 })
}
function menuRemoveCode() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  applyNodeRichContent(id, null)
}
function menuAddTable() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const existing = findNode(dataRef.value, id)?.richContent
  const cur = existing?.kind === 'table' ? existing.raw : ''
  const placeholder = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| a | b | c |'
  const raw = window.prompt(
    '输入 markdown 表格（每行以 | 分隔；留空取消）',
    cur || placeholder
  )
  if (raw === null) return
  const trimmed = raw.trim()
  if (!trimmed) {
    applyNodeRichContent(id, null)
    return
  }
  applyNodeRichContent(id, { kind: 'table', raw: trimmed })
}
function menuRemoveTable() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  applyNodeRichContent(id, null)
}

// ---------------------------------------------------------------------------
// Note editing — the actual textarea lives in App.vue's right-side
// "笔记" drawer (NotePanel.vue).  MindMap only knows when the
// user wants to open it, by emitting `edit-note`.  We also keep
// `notePreview` for the icon tooltip.
// ---------------------------------------------------------------------------

/** Ask App.vue to open the note drawer for this node.  The
 *  drawer auto-focuses its textarea on open. */
function emitEditNote(id: string) {
  if (props.previewMode) return
  emit('edit-note', id)
}

/** Truncate the note text to a single-line preview for the icon
 *  tooltip.  Collapses internal whitespace. */
function notePreview(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat || '点击编辑笔记'
  return flat.slice(0, max) + '…'
}

// ---------------------------------------------------------------------------
// Ctrl+V paste — when a node is selected and the clipboard carries
// an image, route it through readImageFile / applyNodeImage.  We
// also intercept text pastes? No: paste-as-text into a selected
// node should NOT replace the node text (that's confusing); the
// user can double-click to enter edit mode and paste there.  This
// handler is image-only.
// ---------------------------------------------------------------------------
function onPaste(e: ClipboardEvent) {
  if (props.previewMode) return
  // Don't hijack paste inside any text-editing surface.
  if (editingId.value) return
  const tgt = e.target as HTMLElement | null
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
    return
  }
  const sel = selectedId.value
  if (!sel) return
  const items = e.clipboardData?.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const file = it.getAsFile()
      if (!file) continue
      e.preventDefault()
      const n = findNode(dataRef.value, sel)
      if (n?.image) {
        if (!window.confirm('该节点已有图片,要用剪贴板里的图片替换吗?')) return
      }
      readImageFile(file, (img) => applyNodeImage(sel, img))
      return
    }
  }
}
onMounted(() => {
  window.addEventListener('paste', onPaste)
  window.addEventListener('keydown', onGlobalKeydown)
  // Initial render doesn't go through any data-mutating path, so
  // triggerRef() never fires on mount — but we still need the
  // post-mount rich-body measurement so the layout picks up real
  // heights for code/table nodes.  Call it once here to start
  // the measure → re-layout cycle for the first paint.
  triggerRef()
})
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste)
  window.removeEventListener('keydown', onGlobalKeydown)
})

/** Global keydown for Ctrl+F — opens the outline drawer (which
 *  contains the search input).  Separate from useKeyboard because
 *  search is a view operation available in preview mode too. */
function onGlobalKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && (e.key === 'f' || e.key === 'F')) {
    const tgt = e.target as HTMLElement | null
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
      return
    }
    e.preventDefault()
    emit('canvas-outline')
  }
}

// ---------------------------------------------------------------------------
// Resize handle — tracks the in-flight drag (live width/height before
// commit).  We don't write to dataRef on every mouse move; instead we
// update the rendered <img> style directly via a CSS class.  On
// mouseup we push the final size through applyNodeImage() so the
// history snapshot and layout recompute fire exactly once.
// ---------------------------------------------------------------------------
interface ResizeState {
  nodeId: string
  startX: number
  startY: number
  startW: number
  startH: number
  naturalW: number
  naturalH: number
  ratio: number
  pendingW: number
  pendingH: number
}
const resizeState = ref<ResizeState | null>(null)
const resizingId = computed(() => resizeState.value?.nodeId ?? null)

function onResizeStart(e: MouseEvent, n: LayoutNode) {
  if (!n.image) return
  e.preventDefault()
  e.stopPropagation()
  const naturalW = n.image.naturalW || n.image.width
  const naturalH = n.image.naturalH || n.image.height
  // Guard against 0-division on malformed data.
  const ratio = naturalH > 0 ? naturalH / naturalW : 1
  resizeState.value = {
    nodeId: n.id,
    startX: e.clientX,
    startY: e.clientY,
    startW: n.image.width,
    startH: n.image.height,
    naturalW,
    naturalH,
    ratio,
    pendingW: n.image.width,
    pendingH: n.image.height,
  }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  const s = resizeState.value
  if (!s) return
  // Convert pixel delta through the current scale so the resize
  // tracks the user's perceived speed at any zoom level.
  const scale = panZoom.scale.value || 1
  const dxScreen = e.clientX - s.startX
  const nextW = clamp(s.startW + dxScreen / scale, IMG_MIN_W, IMG_MAX_W)
  const nextH = clamp(nextW * s.ratio, IMG_MIN_W, IMG_MAX_W)
  s.pendingW = nextW
  s.pendingH = nextH
  // Live-update the DOM directly (faster than going through
  // Vue's render).  The data tree isn't touched yet, so the
  // next layout pass will still see the old size — that's fine
  // because the live <img> is the source of truth during the
  // drag and the node box's height/width are also re-pushed
  // (so the resize handle stays anchored to the corner).
  const el = wrapperRef.value?.querySelector<HTMLElement>(
    `[data-node-id="${s.nodeId}"] .zm-node-img`
  )
  if (el) {
    el.style.width = `${nextW}px`
    el.style.height = `${nextH}px`
  }
  // Also grow the node box so the handle stays put.  The text
  // strip is ~30px (NODE_HEIGHTS for tier 1) plus the 8px gap.
  const nodeEl = wrapperRef.value?.querySelector<HTMLElement>(
    `[data-node-id="${s.nodeId}"]`
  )
  if (nodeEl) {
    const textH = 30
    nodeEl.style.minWidth = `${Math.max(80, Math.ceil(nextW + 28))}px`
    nodeEl.style.height = `${Math.ceil(nextH + 8 + textH)}px`
  }
}

function onResizeEnd() {
  const s = resizeState.value
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  resizeState.value = null
  if (!s) return
  const n = findNode(dataRef.value, s.nodeId)
  if (!n || !n.image) return
  // Commit the new size through the normal mutation path so the
  // history snapshot fires once and the layout recomputes.
  applyNodeImage(s.nodeId, {
    src: n.image.src,
    naturalW: n.image.naturalW,
    naturalH: n.image.naturalH,
    width: s.pendingW,
    height: s.pendingH,
  })
  // The drag's mouseup landed on the canvas, not on the node, so
  // the canvas's click handler will fire next and deselect.  Re-
  // select the node so the resize handle and remove button stay
  // visible after the user lets go of the handle.
  selectedIds.value = new Set([s.nodeId])
  emitSelection()
  // Suppress the very next canvas click — even after re-selecting,
  // the canvas's click handler runs synchronously and would clear
  // the selection we just set.  The flag is checked once and
  // cleared.
  suppressNextCanvasClick = true
}
// Track which node the user is hovering.  The image-upload button
// shows on hover OR when selected, mirroring the collapse-button
// pattern.  We use a ref (not Vue reactive) so the v-for can
// re-render cheaply.
const hoveredId = ref<string | null>(null)
// Set by onResizeEnd: the drag's mouseup lands on the canvas (not
// the node), and the canvas's click handler would otherwise clear
// the selection we just re-set.  Flag is checked once and cleared.
let suppressNextCanvasClick = false
function onNodeMouseEnter(id: string) {
  hoveredId.value = id
}
function onNodeMouseLeave(id: string) {
  if (hoveredId.value === id) hoveredId.value = null
  if (tooltip.value) tooltip.value = null
}

/** Show a floating tooltip with the node's full text when the
 *  label is long enough that `max-width: 200px` would clip it.
 *  Threshold (12 visible chars ≈ 96px in the default font) is
 *  a conservative estimate — the wrapping render path uses the
 *  same max-width, so anything past the cap is almost certainly
 *  clipped.  Position is read from the node element on the
 *  next frame so layout has settled. */
function onNodeTextHover(e: MouseEvent, n: LayoutNode) {
  if (!n.text || n.text.length < 14) return
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const wrapperRect = wrapperRef.value?.getBoundingClientRect()
  if (!wrapperRect) return
  const margin = 10
  const tipWidth = 240
  // Anchor above the node, but flip below if there isn't room.
  const above = rect.top - wrapperRect.top > 60
  // `left` is the tooltip's horizontal CENTER.  CSS handles the
  // -50% offset via `transform: translate(-50%, ...)`, so we just
  // clamp the center to keep the bubble inside the wrapper.
  const centerX = rect.left - wrapperRect.left + rect.width / 2
  const minCenter = margin + tipWidth / 2
  const maxCenter = wrapperRect.width - tipWidth / 2 - margin
  const x = Math.max(minCenter, Math.min(centerX, maxCenter))
  const y = above
    ? rect.top - wrapperRect.top - 8
    : rect.bottom - wrapperRect.top + 8
  tooltip.value = { text: n.text, x, y, above }
}

function isNodeInteractive(id: string): boolean {
  // The image-upload button should appear when the node is hovered
  // OR selected.  Same gate as the collapse button on the canvas.
  return hoveredId.value === id || selectedId.value === id
}
const layoutVersion = ref(0)
// Compact layout is the default. The user clicks "balance" to snap
// everything into the balanced layout and re-center the view — the
// layout reverts on the next data change unless the caller opts in
// via setBalanced(true).
const balanced = ref(false)

/** Undo/redo stack.  Every mutation calls `record()` AFTER applying the
 *  change; undo() / redo() then swap dataRef with a previous snapshot. */
const history = useHistory(100)

/** Snapshot the current tree so the next mutation can be undone.
 *  Selection is recorded too so undo / redo restores both the
 *  data and the highlight ring the user was looking at. */
function record() {
  history.record({
    data: dataRef.value,
    selectedIds: [...selectedIds.value],
  })
}

/** Apply a new tree, push to emit, refresh layout.  Used by mutations
 *  and by undo/redo (where the tree already came from history). */
function applyData(next: MindMapNode, opts: { resetCollapsed?: boolean; resetSelection?: boolean } = {}) {
  dataRef.value = clone(next)
  if (opts.resetCollapsed) collapsedIds.value = new Set()
  if (opts.resetSelection) {
    selectedIds.value = new Set()
    emitSelection()
  }
  triggerRef()
  emit('change', dataRef.value)
}

function triggerRef() {
  collapsedIds.value = new Set(collapsedIds.value)
  layoutVersion.value++
  // Re-measure rich body heights once the DOM has settled, then
  // bump layoutVersion again so a height change forces another
  // re-layout (the loop terminates because the heights are
  // stable on the second pass).
  //
  // Why a *double* nextTick: the first await flushes the layout
  // computed (synchronous) into Vue's render queue, the second
  // await flushes the actual DOM patch — the `.zm-rich` elements
  // we read `offsetHeight` from only exist AFTER both ticks.  A
  // single `nextTick().then(measure)` runs before the DOM is
  // patched, finds zero `.zm-rich` elements, and the layout
  // falls back to its pre-render `richH` estimate forever (the
  // "rich body never resizes to fit content" bug).  Two ticks
  // guarantees the DOM is up-to-date.
  void nextTick()
    .then(() => nextTick())
    .then(() => measureRichBodies())
    .then(() => {
      // The measure above wrote fresh richHeights/richWidths.
      // Bump layoutVersion so allNodes re-derives from the latest
      // layout result.  layoutResult itself is reactive on
      // richHeights, so it has already re-run; this bump is the
      // belt-and-suspenders that makes the change visible even
      // when the measure values are stable.
      layoutVersion.value++
    })
}

// Walk every rendered `.zm-rich` element, read its current
// pixel size, and write it into `richHeights` / `richWidths`
// so the next layout pass reserves the right amount of space.
// Runs in the post-render tick (after Vue has flushed the DOM
// for the latest dataRef change).  The function is idempotent
// — only writes when a value actually changed — so it doesn't
// cause a layout feedback loop.
function measureRichBodies() {
  const els = document.querySelectorAll<HTMLElement>('.zm-rich')
  const nextH: Record<string, number> = {}
  const nextW: Record<string, number> = {}
  let anyChanged = false
  els.forEach((el) => {
    // The node id is stamped on the parent `.zm-node` div as
    // `data-node-id` by the renderer below.  We walk up to
    // find it.
    let cur: HTMLElement | null = el
    let id: string | null = null
    while (cur && !id) {
      id = cur.getAttribute('data-node-id')
      cur = cur.parentElement
    }
    if (!id) return
    // Use `offsetWidth` / `offsetHeight` (the un-transformed
    // box size), not `getBoundingClientRect()` — the canvas's
    // pan/zoom wrapper applies `transform: scale()` so the
    // bounding rect reports the visually-scaled size and would
    // over-reserve when the user is zoomed in.
    const h = el.offsetHeight
    // scrollWidth is needed for width: the `.zm-rich` element
    // itself is capped at `max-width: 260px` (so very wide
    // tables get a horizontal scrollbar in the rich body, and
    // the box stays compact).  We want to size the box to fit
    // the content, so we read the scroll content's width
    // instead of the capped width.
    const w = el.scrollWidth
    // Round to a half-pixel to keep the map stable — sub-pixel
    // jitter from antialiasing would otherwise force a layout
    // recompute on every render.
    const rH = Math.round(h * 2) / 2
    const rW = Math.round(w * 2) / 2
    nextH[id] = rH
    nextW[id] = rW
    if (richHeights.value[id] !== rH) anyChanged = true
    if (richWidths.value[id] !== rW) anyChanged = true
  })
  // Always write the new map back so the first paint — which
  // happens BEFORE any rich body is mounted in the DOM, so
  // `els` is empty and `anyChanged` stays `false` — still
  // replaces the ref.  Without this, the early-return path
  // skips the assignment and the layout keeps seeing the
  // stale `{}` (or the last-paint values) instead of an
  // empty map it can re-derive on the next pass.  A
  // redundant replacement is cheap (Vue's reactivity
  // short-circuits same-content updates) so we just always
  // write.
  richHeights.value = nextH
  richWidths.value = nextW
}

const theme = computed<Required<MindMapTheme>>(() => ({
rootBg: props.theme?.rootBg ?? '#1f2937',
rootText: props.theme?.rootText ?? '#ffffff',
branchBg: props.theme?.branchBg ?? '#ffffff',
branchText: props.theme?.branchText ?? '#1f2937',
lineColor: props.theme?.lineColor ?? '#94a3b8',
bgColor: props.theme?.bgColor ?? '#f8fafc',
fontSize: props.theme?.fontSize ?? 14,
lineWidthStart: props.theme?.lineWidthStart ?? 2.2,
lineWidthEnd: props.theme?.lineWidthEnd ?? 0.8,
rainbowBranch: props.theme?.rainbowBranch ?? false,
}))

const effectiveBg = computed(() => settings.canvasBg || theme.value.bgColor)

// ---------------------------------------------------------------------------
// User-controllable settings (settings panel / applySettings)
// ---------------------------------------------------------------------------
const settings = reactive<MindMapSettings>({
  autoBalanceOnChange: true,
  lineWidthStart: 12.0,
  lineWidthEnd: 3.6,
  rainbowBranch: true,
  branchPaletteId: 'default',
  customPalettes: [],
  lineStyle: 'curve',
  layoutMode: 'mindmap',
  taperedEdge: true,
  showOrderBadge: false,
  canvasBg: undefined,
})

// Two width strategies, selected by `settings.taperedEdge`:
//
// (a) tapered (default, true): each edge tapers INDEPENDENTLY.  Its
//     parent-end width is a per-tier function of the parent's depth
//     (root=start, level-1=0.67×start, level-2=0.42×start, leaf=end),
//     and its child-end width is the global `lineWidthEnd`.  Visually
//     you get discrete ribbons — a level-2 edge can be THICKER at the
//     parent side than a level-1 edge is at the child side.
//
// (b) continuous (false): the whole tree forms a single tapered band
//     from `lineWidthStart` at the root to `lineWidthEnd` at the
//     leaves.  The parent-end of every edge is the same width as the
//     child-end of the edge that landed on that node, so widths
//     interpolate smoothly.
function lineWidthForDepth(depth: number): number {
  return settings.taperedEdge
    ? taperedParentWidth(depth)
    : continuousWidth(depth)
}
function endWidthForDepth(depth: number): number {
  return settings.taperedEdge
    ? settings.lineWidthEnd
    : continuousWidth(depth)
}
function taperedParentWidth(depth: number): number {
  // Per-tier parent-side width.  The child side is always
  // `lineWidthEnd` (set by endWidthForDepth above).
  if (depth <= 0) return settings.lineWidthStart
  if (depth === 1) return Math.max(1.5, settings.lineWidthStart * 0.67)
  if (depth === 2) return Math.max(0.8, settings.lineWidthStart * 0.42)
  return settings.lineWidthEnd
}
function continuousWidth(depth: number): number {
  // depth 0 = root → start; depth >= 3 = leaf → end; in between
  // interpolate.  Mirror the preview math in SettingsPanel.vue.
  if (depth <= 0) return settings.lineWidthStart
  if (depth >= 3) return settings.lineWidthEnd
  const t = depth / 3
  return settings.lineWidthStart + (settings.lineWidthEnd - settings.lineWidthStart) * t
}

/** Cubic Bezier point at parameter t in [0,1].  P0=P(from),
 *  P1=(x1,y1), P2=(x2,y2), P3=P(to). */
function cubicAt(
  t: number,
  from: { x: number; y: number },
  c: { x1: number; y1: number; x2: number; y2: number },
  to: { x: number; y: number }
) {
  const u = 1 - t
  const x = u * u * u * from.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * to.x
  const y = u * u * u * from.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * to.y
  return { x, y }
}

/** Build a single closed-fill SVG path that visually represents the
 *  cubic Bezier from `from` to `to` with a stroke width that tapers
 *  linearly from `startW` (parent end, thick) to `endW` (child end,
 *  thin).  32 samples along the curve, offset along the normal, give
 *  a smooth filled ribbon — restores the "粗端(根部) 细端(子端)"
 *  taper that the simple-stroke bezier was missing.
 *
 *  For 'down' (org mode) the control points sit on the parent/child
 *  x line, offset on y by 45% of the gap (1.html parity). */
function variableWidthPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  startW: number,
  endW: number,
  n = 32,
  style: 'curve' | 'straight' = 'curve',
  dir: 'right' | 'left' | 'down' = 'right'
): string {
  if (style === 'curve') {
    let c: { x1: number; y1: number; x2: number; y2: number }
    if (dir === 'right' || dir === 'left') {
      // 1.html: control points sit on the parent/child y line,
      // offset on x by 45% of the gap.  This gives the long
      // horizontal "fish gill" look.
      const dx = Math.abs(to.x - from.x)
      const cpx = dx * 0.45
      const sign = dir === 'right' ? 1 : -1
      c = { x1: from.x + sign * cpx, y1: from.y, x2: to.x - sign * cpx, y2: to.y }
    } else {
      // 'down' — vertical control points (45% of the y gap).
      const dy = Math.abs(to.y - from.y)
      const cpy = dy * 0.45
      c = { x1: from.x, y1: from.y + cpy, x2: to.x, y2: to.y - cpy }
    }
    const deriv = (t: number) => {
      const u = 1 - t
      const dx2 = -3 * u * u * from.x + 3 * (u * u - 2 * u * t) * c.x1 + 3 * (2 * u * t - t * t) * c.x2 + 3 * t * t * to.x
      const dy2 = -3 * u * u * from.y + 3 * (u * u - 2 * u * t) * c.y1 + 3 * (2 * u * t - t * t) * c.y2 + 3 * t * t * to.y
      return { dx: dx2, dy: dy2 }
    }
    const left: { x: number; y: number }[] = []
    const right: { x: number; y: number }[] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const p = i === 0 ? from : i === n ? to : cubicAt(t, from, c, to)
      const d = deriv(t)
      let dlen = Math.hypot(d.dx, d.dy)
      if (dlen < 1e-6) dlen = 1
      const nxn = -d.dy / dlen
      const nyn = d.dx / dlen
      const halfW = (startW + (endW - startW) * t) / 2
      left.push({ x: p.x + nxn * halfW, y: p.y + nyn * halfW })
      right.push({ x: p.x - nxn * halfW, y: p.y - nyn * halfW })
    }
    let d2 = `M ${left[0].x.toFixed(2)} ${left[0].y.toFixed(2)}`
    for (let i = 1; i <= n; i++) d2 += ` L ${left[i].x.toFixed(2)} ${left[i].y.toFixed(2)}`
    for (let i = n; i >= 0; i--) d2 += ` L ${right[i].x.toFixed(2)} ${right[i].y.toFixed(2)}`
    d2 += ' Z'
    return d2
  }

  // 'straight' fallback: a simple quad with no curve at all.
  const dx = to.x - from.x
  const dy = to.y - from.y
  let len = Math.hypot(dx, dy)
  if (len < 1e-6) len = 1
  const nx = -dy / len
  const ny = dx / len
  const halfStart = startW / 2
  const halfEnd = endW / 2
  const a = { x: from.x + nx * halfStart, y: from.y + ny * halfStart }
  const b = { x: from.x - nx * halfStart, y: from.y - ny * halfStart }
  const c = { x: to.x - nx * halfEnd, y: to.y - ny * halfEnd }
  const d = { x: to.x + nx * halfEnd, y: to.y + ny * halfEnd }
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${d.x.toFixed(2)} ${d.y.toFixed(2)} L ${c.x.toFixed(2)} ${c.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`
}

const lrRootChildren = computed<LayoutNode[]>(() => layoutResult.value.root.children)
// (intentionally no rootEdgeAnchor — 1.html uses simple rect-edge
// midpoints.  The fan geometry is in the bezier control points.)

const RAINBOW_FALLBACK = BUILTIN_PALETTES[0].colors

// Active palette resolved from settings.branchPaletteId + settings.customPalettes.
// Falls back to the built-in 'default' palette if the id is unknown
// (e.g. a custom palette was deleted).  Recomputed reactively so a
// settings change in the panel re-themes the canvas immediately.
const activePalette = computed<BranchPalette>(() =>
  resolvePalette(settings.branchPaletteId, settings.customPalettes)
)

const branchColor = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  if (!settings.rainbowBranch) return m
  // lineColors prop wins over the palette pipeline: if the host
  // hands us an explicit list, use it verbatim (modulo the
  // wrap-around).  An empty / undefined list falls back to the
  // palette lookup.
  const explicit = props.lineColors
  const colors = (explicit && explicit.length > 0)
    ? explicit
    : activePalette.value.colors.length > 0
      ? activePalette.value.colors
      : RAINBOW_FALLBACK
  for (let i = 0; i < lrRootChildren.value.length; i++) {
    const c = lrRootChildren.value[i]
    m.set(c.id, colors[i % colors.length])
  }
  const walk = (n: LayoutNode, hue: string) => {
    m.set(n.id, hue)
    for (const c of n.children) walk(c, hue)
  }
  for (let i = 0; i < lrRootChildren.value.length; i++) {
    const c = lrRootChildren.value[i]
    walk(c, colors[i % colors.length])
  }
  return m
})

function lineColorFor(_parent: LayoutNode, child: LayoutNode): string {
  if (settings.rainbowBranch) {
    return branchColor.value.get(child.id) ?? theme.value.lineColor
  }
  return theme.value.lineColor
}

function nodeBg(n: LayoutNode): string {
  const s = getNodeStyle(n.id)
  if (s.bg) return s.bg
  if (n.isRoot) return theme.value.rootBg
  if (settings.rainbowBranch) {
    const hue = branchColor.value.get(n.id)
    if (hue) return hexWithAlpha(hue, 0.18)
  }
  return theme.value.branchBg
}
function nodeFg(n: LayoutNode): string {
  const s = getNodeStyle(n.id)
  if (s.textColor) return s.textColor
  if (n.isRoot) return theme.value.rootText
  if (settings.rainbowBranch) {
    const hue = branchColor.value.get(n.id)
    if (hue) return darken(hue, 0.55)
  }
  return theme.value.branchText
}
function nodeBorder(n: LayoutNode): string {
  const s = getNodeStyle(n.id)
  if (s.borderColor) return s.borderColor
  if (n.isRoot) return theme.value.rootBg
  if (settings.rainbowBranch) {
    const hue = branchColor.value.get(n.id)
    if (hue) return darken(hue, 0.3)
  }
  return theme.value.lineColor
}
function nodeFontWeight(n: LayoutNode): number {
const s = getNodeStyle(n.id)
return s.fontWeight ?? (n.isRoot ? 600 : 400)
}

function nodeFontSize(n: LayoutNode): number {
const s = getNodeStyle(n.id)
return s.fontSize ?? theme.value.fontSize
}

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 6 ? h : h.split('').map((c) => c + c).join('')
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 6 ? h : h.split('').map((c) => c + c).join('')
  const r = Math.round(parseInt(full.slice(0, 2), 16) * (1 - amount))
  const g = Math.round(parseInt(full.slice(2, 4), 16) * (1 - amount))
  const b = Math.round(parseInt(full.slice(4, 6), 16) * (1 - amount))
  return `rgb(${r}, ${g}, ${b})`
}

// pan / zoom
const panZoom = usePanZoom({ getContainer: () => wrapperRef.value })
panZoom.setOnMarqueeEnd(onMarqueeEnd)

// keyboard
useKeyboard({
  isEditing: () => editingId.value !== null,
  isReadonly: () => props.previewMode,
  getSelectedId: () => selectedId.value,
  getSelectedIds: () => [...selectedIds.value],
  // If nothing is selected, default Tab/Enter to the root so the user
  // can build a tree from scratch without first clicking somewhere.
  defaultTargetId: () => dataRef.value.id,
  onAddChild: doAddChild,
  onAddSibling: doAddSibling,
  onAddSiblingBefore: doAddSiblingBefore,
  onRemove: doRemove,
  onStartEdit: startEdit,
  onClearSelection: () => {
    selectedIds.value = new Set()
    emitSelection()
  },
  onDuplicate: doDuplicate,
  onCopy: doCopy,
  onCut: doCut,
  onPaste: doPaste,
  hasClipboard: () => !!clipboard.value && clipboard.value.nodes.length > 0,
  onUndo: doUndo,
  onRedo: doRedo,
  onNavigate: doNavigate,
  onSelectRoot: () => {
    selectedIds.value = new Set([dataRef.value.id])
    emitSelection()
  },
})

// layout
const layoutResult = computed(() => {
  const data = clone(dataRef.value)
  applyCollapse(data)
  return layout(data, {
    mode: settings.layoutMode,
    baseFontSize: theme.value.fontSize,
    richHeights: richHeights.value,
    richWidths: richWidths.value,
  })
})

// Walk the layout in one pass, building both the flat node list and the lookup map
const allNodesComputed = ref<LayoutNode[]>([])
const allNodes = computed<LayoutNode[]>(() => {
  // touch layoutVersion so updates propagate
  void layoutVersion.value
  return allNodesComputed.value
})
watch(
  layoutResult,
  (r) => {
    const list: LayoutNode[] = []
    const walk = (n: LayoutNode) => {
      list.push(n)
      for (const c of n.children) walk(c)
    }
    walk(r.root)
    allNodesComputed.value = list
  },
  { immediate: true }
)

const edges = computed(() => {
  const out: { from: LayoutNode; to: LayoutNode; key: string }[] = []
  for (const n of allNodes.value) {
    for (const c of n.children) {
      out.push({ from: n, to: c, key: `${n.id}->${c.id}` })
    }
  }
  return out
})

const viewBox = computed(
  () =>
    `${layoutResult.value.vbX} ${layoutResult.value.vbY} ${layoutResult.value.vbW} ${layoutResult.value.vbH}`
)

function applyCollapse(n: MindMapNode) {
  if (collapsedIds.value.has(n.id)) {
    n.children = []
    n.collapsed = true
    return
  }
  n.collapsed = false
  for (const c of n.children) applyCollapse(c)
}

function startEdit(id: string) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  editingId.value = id
  editText.value = n.text
  // The input is mounted conditionally; once it appears we have to focus
  // it ourselves.  Use nextTick so the v-else branch has rendered.
  nextTick(() => {
    const el = document.querySelector('.zm-input') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}

function commitEdit() {
  if (!editingId.value) return
  const n = findNode(dataRef.value, editingId.value)
  if (n && n.text !== (editText.value.trim() || ' ')) {
    n.text = editText.value.trim() || ' '
    record()
    emit('change', dataRef.value)
  }
  editingId.value = null
}

function cancelEdit() {
  editingId.value = null
}

// ---------------------------------------------------------------------------
// In-place rich body edit (code block / table).  Dblclick the
// rich body to flip into a textarea; blur or Enter commits,
// Escape cancels.  Writes back through the same
// `applyNodeRichContent` helper the context menu / NotePanel
// use, so undo and the change emit fire once.
// ---------------------------------------------------------------------------
function startRichEdit(id: string) {
  if (props.previewMode) return
  const n = findNode(dataRef.value, id)
  if (!n?.richContent) return
  richEditingId.value = id
  richEditDraft.value = n.richContent.raw
  nextTick(() => {
    const ta = document.querySelector<HTMLTextAreaElement>(
      '.zm-node .zm-rich textarea'
    )
    ta?.focus()
  })
}
function commitRichEdit() {
  if (!richEditingId.value) return
  const id = richEditingId.value
  const n = findNode(dataRef.value, id)
  const next = richEditDraft.value
  if (n && n.richContent && n.richContent.raw !== next) {
    if (n.richContent.kind === 'code') {
      const lang = codeLang(next) || undefined
      applyNodeRichContent(id, { kind: 'code', raw: next, lang })
    } else {
      applyNodeRichContent(id, { kind: 'table', raw: next })
    }
  }
  richEditingId.value = null
}
function cancelRichEdit() {
  richEditingId.value = null
}
function onRichEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    cancelRichEdit()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    commitRichEdit()
  }
}

// Sort UI for the on-canvas table.  Same asc/desc/off cycle as
// the panel; state is per-node so different tables can be sorted
// independently.
function toggleNodeSort(id: string, col: number) {
  const cur = sortState.value.get(id)
  if (!cur || cur.col !== col) {
    sortState.value.set(id, { col, dir: 'asc' })
  } else if (cur.dir === 'asc') {
    sortState.value.set(id, { col, dir: 'desc' })
  } else {
    sortState.value.delete(id)
  }
}
// Apply the per-node sort (if any) before the template iterates.
function sortedTableRows(id: string, rows: string[][]): string[][] {
  const s = sortState.value.get(id)
  if (!s || rows.length <= 1) return rows
  return sortTable(rows, s.col, s.dir)
}
function sortMark(id: string, col: number): string {
  const s = sortState.value.get(id)
  if (!s || s.col !== col) return '↕'
  return s.dir === 'asc' ? '▲' : '▼'
}

function onEditKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    e.preventDefault()
    doUndo()
  } else if (
    (mod && e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
    (mod && (e.key === 'y' || e.key === 'Y') && !e.shiftKey)
  ) {
    e.preventDefault()
    doRedo()
  }
}

function doAddChild(parentId: string) {
  const n = addChild(dataRef.value, parentId, DEFAULT_NEW_NODE_TEXT)
  if (n) {
    record()
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
  const n = addSibling(dataRef.value, nodeId, DEFAULT_NEW_NODE_TEXT)
  if (n) {
    record()
    triggerRef()
    emit('change', dataRef.value)
    nextTick(() => startEdit(n.id))
  }
}

function doAddSiblingBefore(nodeId: string) {
  // root has no siblings to insert before — fall back to addChild
  if (nodeId === dataRef.value.id) {
    doAddChild(nodeId)
    return
  }
  const n = addSiblingBefore(dataRef.value, nodeId, DEFAULT_NEW_NODE_TEXT)
  if (n) {
    record()
    triggerRef()
    emit('change', dataRef.value)
    nextTick(() => startEdit(n.id))
  }
}

function doDuplicate(nodeId: string) {
  if (nodeId === dataRef.value.id) return
  const n = duplicateNode(dataRef.value, nodeId)
  if (n) {
    record()
    selectedIds.value = new Set([n.id])
    emitSelection()
    emit('change', dataRef.value)
    triggerRef()
  }
}

// ── Clipboard (Ctrl+C / Ctrl+X / Ctrl+V) ─────────────────────
//
// Per-instance clipboard — copying in one MindMap doesn't leak
// into another on the same page.  The buffer holds a list of
// cloned subtrees (with fresh ids) plus the originals' pre-clone
// ids so the cycle guard in paste can detect "target is a
// descendant of one of the copied subtrees".

/** Filter a list of ids to those that are valid copy/cut targets
 *  (not the root, still in the tree).  Preserves the input order
 *  so the caller can keep its preorder semantics. */
function clipboardableIds(ids: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (id === dataRef.value.id) continue
    if (seen.has(id)) continue
    if (!findNode(dataRef.value, id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Reorder ids to preorder (root-first, depth-first) so paste
 *  produces a visually predictable insertion order. */
function preorderIds(ids: string[]): string[] {
  const want = new Set(ids)
  const out: string[] = []
  const walk = (n: MindMapNode) => {
    if (want.has(n.id)) out.push(n.id)
    for (const c of n.children) walk(c)
  }
  walk(dataRef.value)
  return out
}

function doCopy(ids: string[]) {
  const clean = preorderIds(clipboardableIds(ids))
  if (clean.length === 0) return
  const subs: MindMapNode[] = []
  for (const id of clean) {
    const sub = cloneSubtree(dataRef.value, id)
    if (sub) subs.push(sub)
  }
  if (subs.length === 0) return
  clipboard.value = { nodes: subs, originalIds: new Set(clean) }
  triggerRef()
}

function doCut(ids: string[]) {
  const clean = preorderIds(clipboardableIds(ids))
  if (clean.length === 0) return
  const subs: MindMapNode[] = []
  for (const id of clean) {
    const sub = cloneSubtree(dataRef.value, id)
    if (sub) subs.push(sub)
  }
  if (subs.length === 0) return
  record()
  // Immediate-delete semantics: remove originals now, drop the
  // selection.  Undo restores both via the history snapshot.
  for (const id of clean) removeNode(dataRef.value, id)
  selectedIds.value = new Set()
  emitSelection()
  clipboard.value = { nodes: subs, originalIds: new Set(clean) }
  triggerRef()
  emit('change', dataRef.value)
}

function doPaste(targetId: string | null) {
  const buf = clipboard.value
  if (!buf || buf.nodes.length === 0) return
  const tid = targetId ?? dataRef.value.id
  const target = findNode(dataRef.value, tid)
  if (!target) return
  // Cycle guard — only meaningful when the original subtrees are
  // still in the tree (copy case).  In the cut case the originals
  // have been removed from `dataRef`, so no node can be a
  // descendant of them and the cycle is impossible.  Walk the
  // live tree from each original id and refuse if `tid` lives
  // underneath it.
  for (const origId of buf.originalIds) {
    const origNode = findNode(dataRef.value, origId)
    if (origNode && findNode(origNode, tid)) return
  }
  record()
  for (const sub of buf.nodes) {
    const fresh = clone(sub)
    reassignIds(fresh)
    target.children.push(fresh)
  }
  // Consume the buffer — paste is a single-shot operation.
  // Subsequent Ctrl+V is a no-op until the user copies / cuts
  // again.
  clipboard.value = null
  triggerRef()
  emit('change', dataRef.value)
}

function doUndo() {
  const restored = history.undo()
  if (restored) {
    dataRef.value = restored.data
    // Restore selection from history when present (older
    // snapshots without it default to empty).
    selectedIds.value = new Set(restored.selectedIds ?? [])
    emitSelection()
    triggerRef()
    emit('change', dataRef.value)
  }
}

function doRedo() {
  const restored = history.redo()
  if (restored) {
    dataRef.value = restored.data
    selectedIds.value = new Set(restored.selectedIds ?? [])
    emitSelection()
    triggerRef()
    emit('change', dataRef.value)
  }
}

/** Resolve the current `selectedIds` Set into a concrete array of
 *  MindMapNode references (filtered to nodes that still exist),
 *  then emit `select`.  Empty selection → null.  Hosts read this
 *  to keep their drawer / outline / status panel in sync. */
function emitSelection() {
  const arr: MindMapNode[] = []
  for (const id of selectedIds.value) {
    const n = findNode(dataRef.value, id)
    if (n) arr.push(n)
  }
  emit('select', arr.length > 0 ? arr : null)
}

function doNavigate(dx: number, dy: number) {
  const cur = selectedId.value ?? dataRef.value.id
  const node = findNode(dataRef.value, cur)
  if (!node) return
  let nextId: string | null = null
  if (dy === +1) {
    // next sibling
    const p = findParent(dataRef.value, node.id)
    if (p) {
      const i = p.children.findIndex((c) => c.id === node.id)
      if (i >= 0 && i < p.children.length - 1) nextId = p.children[i + 1].id
    }
  } else if (dy === -1) {
    // previous sibling
    const p = findParent(dataRef.value, node.id)
    if (p) {
      const i = p.children.findIndex((c) => c.id === node.id)
      if (i > 0) nextId = p.children[i - 1].id
    }
  } else if (dx === +1) {
    // parent (up the tree)
    const p = findParent(dataRef.value, node.id)
    if (p) nextId = p.id
  } else if (dx === -1) {
    // first child
    if (node.children.length > 0) nextId = node.children[0].id
  }
  if (nextId) {
    selectedIds.value = new Set([nextId])
    emitSelection()
  }
}

// ── rich body helpers ────────────────────────────────────────
//
// Convert a richContent.raw payload into the fragments the
// template renders.  Kept as plain functions (not computed) so
// the template can call them inline and re-runs are cheap
// (each block is ≤ a few KB of markdown).

/** Strip the bullet/number marker from each list line so the
 *  template can render the items in its own <ul>. */
function listLines(raw: string): string[] {
  return raw
    .split('\n')
    .map(l => l.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim())
    .filter(l => l.length > 0)
}

/** Collapse a multi-line paragraph into a single line (the
 *  node body shows a short summary; the full text is still
 *  available via richContent.raw for round-tripping). */
function paragraphText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function doRemove(nodeId: string) {
  if (nodeId === dataRef.value.id) return
  if (removeNode(dataRef.value, nodeId)) {
    record()
    // If the removed node was in the selection set, drop it.
    if (selectedIds.value.has(nodeId)) {
      const next = new Set(selectedIds.value)
      next.delete(nodeId)
      selectedIds.value = next
      emitSelection()
    }
    triggerRef()
    emit('change', dataRef.value)
  }
}

function toggleCollapse(id: string) {
  if (collapsedIds.value.has(id)) collapsedIds.value.delete(id)
  else collapsedIds.value.add(id)
  triggerRef()
}

/** Walk the data tree, calling `visit(node, depth)` for each node.
 *  Depth of the root is 1.  Used by the bulk expand/collapse
 *  toolbar buttons below. */
function walkTreeDepth(visit: (n: MindMapNode, depth: number) => void) {
  const stack: Array<{ n: MindMapNode; depth: number }> = [{ n: dataRef.value, depth: 1 }]
  while (stack.length) {
    const { n, depth } = stack.pop()!
    visit(n, depth)
    // Push children in reverse so the natural left-to-right order
    // is preserved on a depth-first traversal.
    for (let i = n.children.length - 1; i >= 0; i--) {
      stack.push({ n: n.children[i], depth: depth + 1 })
    }
  }
}

/** Collapse every node that has children, leaving only the root
 *  expanded.  Click again to peek at branches. */
function collapseAll() {
  collapsedIds.value = new Set()
  walkTreeDepth((n) => {
    if (n.children.length > 0) {
      collapsedIds.value.add(n.id)
    }
  })
  triggerRef()
}

/** Expand only the top-level (level-1) branches.  Every node at
 *  depth >= 2 is collapsed.  Useful for the "鸟瞰" view. */
function expandToLevel(maxDepth: number) {
  collapsedIds.value = new Set()
  walkTreeDepth((n, depth) => {
    if (depth > maxDepth && n.children.length > 0) {
      collapsedIds.value.add(n.id)
    }
  })
  triggerRef()
}

/** Expand every node in the tree. */
function expandAll() {
  collapsedIds.value = new Set()
  triggerRef()
}

/** External edit hook (used by the outline panel's inline edit).
 *  No-op if the text is unchanged or the id doesn't exist. */
function doSetText(id: string, text: string) {
  if (setNodeText(dataRef.value, id, text)) {
    record()
    triggerRef()
    emit('change', dataRef.value)
  }
}

/** External move hook (used by the outline panel's drag-and-drop).
 *  position: 'before' / 'after' / 'child'.  Returns true on success. */
function doMove(srcId: string, targetId: string, position: 'before' | 'after' | 'child'): boolean {
  if (moveNode(dataRef.value, srcId, targetId, position)) {
    record()
    triggerRef()
    emit('change', dataRef.value)
    return true
  }
  return false
}

function onNodeClick(e: MouseEvent, n: LayoutNode) {
  e.stopPropagation()
  // Shift+click toggles membership in the multi-select set; plain
  // click replaces the set with just this node.  Note: the
  // pointerdown handler does NOT touch selection anymore (see
  // `onNodePointerDown` comment), so a plain click-without-drag
  // path is `pointerdown (no-op) → click (this handler)`.
  if (e.shiftKey) {
    const next = new Set(selectedIds.value)
    if (next.has(n.id)) next.delete(n.id)
    else next.add(n.id)
    selectedIds.value = next
  } else {
    selectedIds.value = new Set([n.id])
  }
  emitSelection()
}

// --------------------------------------------------------------------
// Drag-to-reparent (edit mode only).  pointerdown on a non-root
// node starts a drag; the source node is auto-selected, and a
// small ghost chip follows the pointer.  Releasing over another
// node reparents the source under that target via doMove (which
// already handles undo + change event).  Releasing over empty
// canvas or the source itself is a no-op.  Preview mode disables
// the gesture entirely; root is never draggable.
// --------------------------------------------------------------------

/** Find the topmost node under a world-space pointer position.
 *  Iterates in render order (root-first) and returns the LAST
 *  hit so overlapping nodes resolve to the visually-topmost
 *  sibling.  Skips `excludeId` (the drag source). */
function getNodeAtPointer(wx: number, wy: number, excludeId: string | null): LayoutNode | null {
  let hit: LayoutNode | null = null
  for (const n of allNodes.value) {
    if (n.id === excludeId) continue
    const halfW = n.width / 2
    const halfH = n.height / 2
    if (
      wx >= n.x - halfW && wx <= n.x + halfW &&
      wy >= n.y - halfH && wy <= n.y + halfH
    ) {
      hit = n
    }
  }
  return hit
}

// Pending drag state — set on pointerdown, promoted to the reactive
// `dragState` only after the pointer moves beyond DRAG_THRESHOLD.
// This prevents the ghost chip and source-dimming from flashing on a
// simple click/press.  A plain object (not reactive) since it's only
// read by the three drag handlers below.
interface PendingDrag {
  srcId: string
  srcText: string
  pointerOffsetX: number
  pointerOffsetY: number
  startX: number
  startY: number
}
let pendingDrag: PendingDrag | null = null
const DRAG_THRESHOLD = 4 // px of movement before a drag becomes "active"

function onNodePointerDown(e: PointerEvent, n: LayoutNode) {
  if (props.previewMode) return
  if (n.isRoot) return
  if (e.button !== 0) return
  // The resize handle is a child of .zm-node; bail so the user
  // can drag the corner handle without reparenting.
  const target = e.target as HTMLElement | null
  if (target?.closest('.zm-img-resize-handle')) return
  e.stopPropagation()

  // DO NOT touch the selection set here.  Drag-pickup is an
  // internal gesture — selection only lands on the user's explicit
  // intent (clean click → `onNodeClick`, successful drop →
  // `onDragPointerUp`).  Auto-selecting on mousedown made the
  // blue ring flash before any drag actually started, which felt
  // jittery.

  // Resolve pointer offset inside the source box (in wrapper
  // screen coords) so the ghost tracks the grab point, not the
  // node centre.
  const wrapperRect = wrapperRef.value!.getBoundingClientRect()
  const sourceScreenX = n.x * panZoom.scale.value + panZoom.offsetX.value
  const sourceScreenY = n.y * panZoom.scale.value + panZoom.offsetY.value
  const pointerOffsetX = e.clientX - wrapperRect.left - sourceScreenX
  const pointerOffsetY = e.clientY - wrapperRect.top - sourceScreenY

  // Record a pending drag — DON'T set dragState yet.  The ghost
  // and source-dimming only appear once the pointer moves past
  // DRAG_THRESHOLD, so a plain press/click doesn't flash the
  // drag UI.
  pendingDrag = {
    srcId: n.id,
    srcText: n.text,
    pointerOffsetX,
    pointerOffsetY,
    startX: e.clientX,
    startY: e.clientY,
  }

  // Listen on window so we catch move/up regardless of which DOM
  // element the pointer is over (incl. the empty canvas).  Using
  // setPointerCapture would be nicer but it's flaky on touch.
  window.addEventListener('pointermove', onDragPointerMove)
  window.addEventListener('pointerup', onDragPointerUp)
  window.addEventListener('pointercancel', onDragPointerUp)
}

function onDragPointerMove(e: PointerEvent) {
  // If we have a pending drag, check whether it should be promoted
  // to an active drag (pointer moved past the threshold).
  if (pendingDrag) {
    const dx = e.clientX - pendingDrag.startX
    const dy = e.clientY - pendingDrag.startY
    if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) {
      return // still within the dead-zone — not a drag yet
    }
    // Promote: show the ghost, dim the source, add the grabbing cursor.
    dragState.value = {
      srcId: pendingDrag.srcId,
      srcText: pendingDrag.srcText,
      pointerOffsetX: pendingDrag.pointerOffsetX,
      pointerOffsetY: pendingDrag.pointerOffsetY,
      currentTargetId: null,
    }
    document.body.classList.add('is-dragging')
    pendingDrag = null
  }

  const state = dragState.value
  if (!state) return
  const wrapperRect = wrapperRef.value!.getBoundingClientRect()
  dragGhostX.value = e.clientX - wrapperRect.left - state.pointerOffsetX
  dragGhostY.value = e.clientY - wrapperRect.top - state.pointerOffsetY

  // Screen → world for hit-testing against the layout.
  const wx = (e.clientX - wrapperRect.left - panZoom.offsetX.value) / panZoom.scale.value
  const wy = (e.clientY - wrapperRect.top - panZoom.offsetY.value) / panZoom.scale.value
  const hit = getNodeAtPointer(wx, wy, state.srcId)
  state.currentTargetId = hit?.id ?? null
}

function onDragPointerUp(_e: PointerEvent) {
  window.removeEventListener('pointermove', onDragPointerMove)
  window.removeEventListener('pointerup', onDragPointerUp)
  window.removeEventListener('pointercancel', onDragPointerUp)

  // If there's still a pending drag, the user never moved past the
  // threshold — this was a click, not a drag.  Just clean up.
  if (pendingDrag) {
    pendingDrag = null
    return
  }

  const state = dragState.value
  if (!state) return

  if (state.currentTargetId) {
    doMove(state.srcId, state.currentTargetId, 'child')
    // The drag's pointerdown didn't emit 'select' (see
    // onNodePointerDown).  Now that the drop succeeded, broadcast
    // the new selection so the host's right-side drawer /
    // outline / status bar reflect the moved node.  Replace any
    // prior selection with just the moved node — drag is a
    // single-node gesture.
    selectedIds.value = new Set([state.srcId])
    emitSelection()
  }

  dragState.value = null
  dragGhostX.value = 0
  dragGhostY.value = 0
  document.body.classList.remove('is-dragging')
}

/** Click on the canvas background (not on a node) — clear the
 *  current selection and tell the parent. */
// Tracks whether the most recent canvas pan was started with the
// right mouse button.  Set in onCanvasMouseDown (button 2 → startPan),
// consumed by onCanvasContextMenu to decide whether to suppress the
// menu after a drag-pan.  Reset to false on any non-right-button press.
let lastPanWasRightButton = false

function onCanvasMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  // Don't start a canvas-level gesture when the press lands on a
  // node, the toolbar, or any control button — those have their
  // own handlers (drag-node, button click, etc).
  if (target.closest('.zm-node, .zm-toolbar, button, input, textarea')) return
  if (e.button === 2) {
    // Right button: pan the canvas.
    lastPanWasRightButton = true
    panZoom.startPan(e)
    return
  }
  lastPanWasRightButton = false
  if (e.button !== 0) return
  // Left button: start a marquee (rectangle selection) anchored
  // at the press point. Convert screen → world coords through the
  // current scale / offset.  Pass shiftKey so the end handler can
  // decide between "extend" and "replace".
  const rect = wrapperRef.value!.getBoundingClientRect()
  const wx = (e.clientX - rect.left - panZoom.offsetX.value) / panZoom.scale.value
  const wy = (e.clientY - rect.top - panZoom.offsetY.value) / panZoom.scale.value
  panZoom.startMarquee(wx, wy, { shift: e.shiftKey })
}

function onCanvasClick(e: MouseEvent) {
  // A resize drag just finished: skip this click so the user's
  // re-select (in onResizeEnd) sticks.  We always return early
  // because the click target here is the empty canvas (the drag
  // ended outside the node), so there's nothing useful to do.
  if (suppressNextCanvasClick) {
    suppressNextCanvasClick = false
    return
  }
  const target = e.target as HTMLElement | null
  if (!target) return
  // Ignore clicks that land on a node or its control buttons.
  if (target.closest('.zm-node')) return
  // If a marquee just finished (drag was wide enough to count as
  // a real selection gesture), keep whatever the marquee picked.
  // Only treat a *tiny* marquee — i.e. a click with no real drag —
  // as a deselect.
  const m = panZoom.marquee
  if (m.width >= 4 || m.height >= 4) return
  if (selectedIds.value.size > 0) {
    selectedIds.value = new Set()
    emitSelection()
  }
}

// When a marquee ends, intersect the marquee rectangle with
// every node's world-space bbox and select all that overlap.
// Shift held at pickup (m.shiftKey) extends the existing set;
// otherwise the new hit list REPLACES the prior selection.
function onMarqueeEnd() {
  const m = panZoom.marquee
  if (m.width < 4 && m.height < 4) {
    // Treat tiny drags as a click — fall through to onCanvasClick.
    return
  }
  // Compute marquee corners.
  const x1 = m.x
  const y1 = m.y
  const x2 = m.x + m.width
  const y2 = m.y + m.height
  const hit: string[] = []
  for (const n of allNodes.value) {
    const halfW = n.width / 2
    const halfH = n.height / 2
    // AABB intersect: a node is hit if its bbox overlaps the
    // marquee in BOTH axes.  Standard AABB intersection check, so
    // partially-encroached nodes (the common case) are also
    // selected.
    const nLeft = n.x - halfW
    const nRight = n.x + halfW
    const nTop = n.y - halfH
    const nBottom = n.y + halfH
    const overlaps =
      nLeft <= x2 && nRight >= x1 && nTop <= y2 && nBottom >= y1
    if (overlaps) hit.push(n.id)
  }
  // Replace or extend the selection set per shift state captured
  // at pickup time.  `m.shiftKey` is on the marquee object itself
  // (usePanZoom stashes it on startMarquee).
  selectedIds.value = m.shiftKey
    ? new Set([...selectedIds.value, ...hit])
    : new Set(hit)
  emitSelection()
}

function isCollapsed(id: string) {
  return collapsedIds.value.has(id)
}

function nodeHasChildren(n: LayoutNode) {
  const data = findNode(dataRef.value, n.id)
  return !!data && data.children.length > 0
}

/** How many direct children a collapsed node is hiding.  Reads from
 *  the original data tree (the layout tree's `n.children` is empty
 *  for a collapsed node, so it would always be 0).  Returns 0 if
 *  the node doesn't exist or has no children, so callers can use
 *  the result as a v-if guard. */
function collapsedChildCount(id: string): number {
  const data = findNode(dataRef.value, id)
  if (!data) return 0
  return data.children.length
}

/** Zero-based index of the node in its parent's children array.
 *  Returns 0 for the root (no parent).  Used by the order badge
 *  to label each rendered node with its data-tree position. */
function siblingIndexOf(id: string): number {
  const data = findNode(dataRef.value, id)
  if (!data) return 0
  // findNode doesn't return the parent; walk again to find it.
  const root = dataRef.value
  const stack: MindMapNode[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    const idx = n.children.findIndex((c) => c.id === id)
    if (idx >= 0) return idx
    for (const c of n.children) stack.push(c)
  }
  return 0
}

// =====================================================================
// Edge anchor — 1.html JS L608-626.  For horizontal children (right or
// left), the line lands on the side mid-edge of the parent and child.
// For 'down' (org mode), it lands on the top/bottom mid-edge.  No fan
// geometry on the root — the previous `rootEdgeAnchor` ray-cast is
// gone; 1.html just uses the rect-edge midpoint and lets the bezier
// control points do the smoothing.
// =====================================================================
function lineAnchor(
  n: LayoutNode,
  side: 'in' | 'out',
  dir?: 1 | -1,
  child?: LayoutNode
): { x: number; y: number } {
  const childDir = child?._dir ?? n._dir
  if (childDir === 'down') {
    // Vertical layout (org mode): line lands on top/bottom mid-edge
    if (side === 'out') return { x: n.x, y: n.y + n.height / 2 }
    return { x: n.x, y: n.y - n.height / 2 }
  }
  // Horizontal (mindmap / tree): line lands on left/right mid-edge
  let d: 1 | -1
  if (side === 'in') d = (-n.side) as 1 | -1
  else if (dir !== undefined) d = dir
  else d = n.side
  // Inset the 'in' anchor a few pixels inside the box so a
  // thick ribbon (especially at high zoom) can't visually
  // pierce the child rectangle — the ribbon's normal-width
  // lands cleanly inside the visible border.
  //
  // For code/table nodes the box's *visible* content (the
  // `.zm-rich` framed body) sits well inside the geometric
  // box edge.  Layout stamps `_richInsetX` with the gap from
  // the box edge to the rich body edge (see layout.ts
  // `buildLayout`); the line tip lands ON the rich body
  // outer left edge, which is what we want — the ribbon
  // visually "touches" the framed body without piercing it.
  // For plain nodes (no rich body) the geometric box edge IS
  // the visible frame, so the default is 0 (line tip on the
  // box edge) — symmetric with the rich-body case so all
  // node types line up at the same horizontal position.
  const inset = side === 'in' ? (n._richInsetX ?? 0) : 0
  return { x: n.x + d * (n.width / 2 - inset), y: n.y }
}

function resetView() {
  const r = layoutResult.value
  panZoom.resetView(r.width, r.height, r.root.y)
}

function runBalance() {
  // 1. apply balanced layout (re-runs the layout computed with
  //    { balanced: true })
  balanced.value = true
  // 2. record this so Ctrl+Z can restore the pre-balance state
  record()
  // 3. force a layoutVersion bump so the computed re-runs immediately
  triggerRef()
  // 4. re-center the view so the user sees the result
  nextTick(() => resetView())
}

// 1.html-style layout mode switcher.  Changes settings.layoutMode
// and re-runs the layout.  Triggering nextTick+resetView is the
// same dance runBalance() does.
function setLayoutMode(mode: 'mindmap' | 'tree' | 'org') {
  if (settings.layoutMode === mode) return
  settings.layoutMode = mode
  triggerRef()
  nextTick(() => resetView())
}

function exportData(): string {
  return JSON.stringify(dataRef.value, null, 2)
}

/** True when the node carries any of the "extra" content fields
 *  the right-side drawer edits — note, link, image, or rich body
 *  (code / table / list / paragraph).  Plain nodes (just text +
 *  children) return false, so a host can use this to gate the
 *  drawer / inspector on "the user picked a node with something
 *  to edit" rather than "the user picked any node at all". */
function nodeHasContent(id: string): boolean {
  const n = findNode(dataRef.value, id)
  if (!n) return false
  if (n.note && n.note.text) return true
  if (n.link && n.link.url) return true
  if (n.image && n.image.src) return true
  if (n.richContent && n.richContent.raw) return true
  if (n.markers && n.markers.length > 0) return true
  if (n.tags && n.tags.length > 0) return true
  return false
}

function importData(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as MindMapNode
    if (!parsed.id || !Array.isArray(parsed.children)) return false
    history.reset()
    dataRef.value = clone(parsed)
    selectedIds.value = new Set()
    collapsedIds.value = new Set()
    triggerRef()
    nextTick(() => resetView())
    emit('change', dataRef.value)
    return true
  } catch {
    return false
  }
}

function importFromFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  input.onchange = () => {
    const f = input.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        if (!importData(reader.result)) alert('导入失败:JSON 格式无效')
      }
    }
    reader.readAsText(f)
  }
  input.click()
}

function exportToFile() {
  const blob = new Blob([exportData()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${dataRef.value.text || 'mindmap'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Search — walk the data tree for nodes whose text or note contains
// the query (case-insensitive).  Matching node ids are stored in
// `searchResults`; `searchIndex` tracks the currently-focused match.
// Collapsed ancestors of matches are auto-expanded so every hit is
// visible.  The view recenters on the current match.
// ---------------------------------------------------------------------------
const searchQuery = ref('')
const searchResults = ref<string[]>([])
const searchIndex = ref(-1)

function performSearch(query: string) {
  searchQuery.value = query
  const trimmed = query.trim()
  if (!trimmed) {
    searchResults.value = []
    searchIndex.value = -1
    return
  }
  const lower = trimmed.toLowerCase()
  const results: string[] = []
  const walk = (n: MindMapNode) => {
    if (
      n.text.toLowerCase().includes(lower) ||
      (n.note?.text && n.note.text.toLowerCase().includes(lower))
    ) {
      results.push(n.id)
    }
    for (const c of n.children) walk(c)
  }
  walk(dataRef.value)
  searchResults.value = results
  searchIndex.value = results.length > 0 ? 0 : -1
  if (results.length > 0) {
    expandAncestorsOfMatches(results)
    nextTick(() => centerOnMatch(0))
  }
}

function searchNext() {
  if (searchResults.value.length === 0) return
  searchIndex.value = (searchIndex.value + 1) % searchResults.value.length
  centerOnMatch(searchIndex.value)
}

function searchPrev() {
  if (searchResults.value.length === 0) return
  searchIndex.value =
    (searchIndex.value - 1 + searchResults.value.length) % searchResults.value.length
  centerOnMatch(searchIndex.value)
}

function clearSearch() {
  searchQuery.value = ''
  searchResults.value = []
  searchIndex.value = -1
}

function isSearchHit(id: string): boolean {
  return searchResults.value.includes(id)
}

function isCurrentSearchHit(id: string): boolean {
  return searchIndex.value >= 0 && searchResults.value[searchIndex.value] === id
}

function isSearchDimmed(id: string): boolean {
  return (
    searchQuery.value.trim().length > 0 &&
    searchResults.value.length > 0 &&
    !searchResults.value.includes(id)
  )
}

function expandAncestorsOfMatches(matchIds: string[]) {
  if (matchIds.length === 0) return
  const matchSet = new Set(matchIds)
  const toExpand = new Set<string>()
  const walk = (n: MindMapNode): boolean => {
    let hasMatch = matchSet.has(n.id)
    for (const c of n.children) {
      if (walk(c)) hasMatch = true
    }
    if (hasMatch && n.children.length > 0 && collapsedIds.value.has(n.id)) {
      toExpand.add(n.id)
    }
    return hasMatch
  }
  walk(dataRef.value)
  if (toExpand.size > 0) {
    for (const id of toExpand) collapsedIds.value.delete(id)
    triggerRef()
  }
}

function centerOnMatch(idx: number) {
  const id = searchResults.value[idx]
  if (!id) return
  const node = allNodes.value.find((n) => n.id === id)
  if (!node) return
  selectedIds.value = new Set([id])
  emitSelection()
  panZoom.centerOn(node.x, node.y, node.width, node.height)
}

// ---------------------------------------------------------------------------
// Markers — add / remove / toggle marker icons on a node.  Markers
// are stored as `node.markers?: string[]` on the data tree.  Each
// mutation goes through the standard record → triggerRef → emit
// pipeline so undo and markdown sync work.
// ---------------------------------------------------------------------------
function applyNodeMarker(id: string, marker: string) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (!n.markers) n.markers = []
  if (n.markers.includes(marker)) return
  n.markers.push(marker)
  record()
  triggerRef()
  emit('change', dataRef.value)
}

function removeNodeMarkerData(id: string, marker: string) {
  const n = findNode(dataRef.value, id)
  if (!n || !n.markers) return
  const idx = n.markers.indexOf(marker)
  if (idx < 0) return
  n.markers.splice(idx, 1)
  if (n.markers.length === 0) delete n.markers
  record()
  triggerRef()
  emit('change', dataRef.value)
}

function toggleNodeMarkerData(id: string, marker: string): boolean {
  const n = findNode(dataRef.value, id)
  if (!n) return false
  if (!n.markers) n.markers = []
  const idx = n.markers.indexOf(marker)
  if (idx >= 0) {
    n.markers.splice(idx, 1)
    if (n.markers.length === 0) delete n.markers
    record()
    triggerRef()
    emit('change', dataRef.value)
    return false
  }
  n.markers.push(marker)
  record()
  triggerRef()
  emit('change', dataRef.value)
  return true
}

function getNodeMarkersData(id: string): string[] {
  const n = findNode(dataRef.value, id)
  return n?.markers ? [...n.markers] : []
}

function hasNodeMarker(id: string, marker: string): boolean {
  const n = findNode(dataRef.value, id)
  return !!n?.markers?.includes(marker)
}

// Context-menu bridge: the menu emits marker toggle events; we
// apply them to the node that was right-clicked.
function menuToggleMarker(marker: string) {
  const id = contextMenu.value?.nodeId
  if (!id) return
  toggleNodeMarkerData(id, marker)
  // Don't close the menu — let the user toggle multiple markers.
}

function menuClearMarkers() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const n = findNode(dataRef.value, id)
  if (!n || !n.markers) return
  delete n.markers
  record()
  triggerRef()
  emit('change', dataRef.value)
  closeContextMenu()
}

// ---------------------------------------------------------------------------
// Tags — set / clear text tags on a node.  Tags are stored as
// `node.tags?: string[]`.
// ---------------------------------------------------------------------------
function setNodeTagsData(id: string, tags: string[]) {
  const n = findNode(dataRef.value, id)
  if (!n) return
  if (tags.length === 0) {
    if (n.tags) delete n.tags
  } else {
    n.tags = [...tags]
  }
  record()
  triggerRef()
  emit('change', dataRef.value)
}

function getNodeTagsData(id: string): string[] {
  const n = findNode(dataRef.value, id)
  return n?.tags ? [...n.tags] : []
}

function menuAddTag() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  const n = findNode(dataRef.value, id)
  const existing = n?.tags?.join(', ') ?? ''
  const raw = window.prompt('输入标签（多个用逗号分隔）', existing)
  if (raw === null) return
  const tags = raw
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  setNodeTagsData(id, tags)
  closeContextMenu()
}

function menuRemoveTags() {
  const id = contextMenu.value?.nodeId
  if (!id) return
  setNodeTagsData(id, [])
  closeContextMenu()
}

// ---------------------------------------------------------------------------
// Export PNG / SVG — serialize the canvas into a standalone image.
//
// SVG export builds a new <svg> element from the existing edge
// paths + each node rendered as native SVG elements (<rect>,
// <text>, nested <svg> for markers).  PNG export draws the SVG
// onto a <canvas> at the requested pixel density and triggers a
// download.  We use native SVG elements instead of foreignObject
// because foreignObject taints the canvas, causing SecurityError
// on canvas.toBlob().
// ---------------------------------------------------------------------------
function buildExportSVG(): SVGSVGElement {
  const r = layoutResult.value
  const svgNS = 'http://www.w3.org/2000/svg'
  const svgEl = document.createElementNS(svgNS, 'svg')
  svgEl.setAttribute('xmlns', svgNS)
  svgEl.setAttribute('viewBox', `${r.vbX} ${r.vbY} ${r.vbW} ${r.vbH}`)
  svgEl.setAttribute('width', String(r.vbW))
  svgEl.setAttribute('height', String(r.vbH))

  // Background rect
  const bg = document.createElementNS(svgNS, 'rect')
  bg.setAttribute('x', String(r.vbX))
  bg.setAttribute('y', String(r.vbY))
  bg.setAttribute('width', String(r.vbW))
  bg.setAttribute('height', String(r.vbH))
  bg.setAttribute('fill', effectiveBg.value)
  svgEl.appendChild(bg)

  // Edges
  for (const e of edges.value) {
    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute(
      'd',
      variableWidthPath(
        lineAnchor(e.from, 'out', e.to.side, e.to),
        lineAnchor(e.to, 'in'),
        lineWidthForDepth(e.from.depth),
        endWidthForDepth(e.to.depth),
        32,
        settings.lineStyle,
        e.to._dir
      )
    )
    path.setAttribute('fill', lineColorFor(e.from, e.to))
    path.setAttribute('stroke', 'none')
    svgEl.appendChild(path)
  }

  // Nodes as native SVG elements.  We deliberately avoid
  // <foreignObject> here because drawing an SVG that contains
  // foreignObject onto a <canvas> taints the canvas (the HTML
  // content inside foreignObject is treated as cross-origin),
  // which makes canvas.toBlob() throw a SecurityError — breaking
  // PNG export entirely.  Native SVG elements (<rect>, <text>,
  // nested <svg>) do not have this restriction.
  const FONT_FAMILY = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"

  // Helper: estimate text width for positioning markers and tags.
  // CJK characters are roughly full-width (≈ fontSize); Latin
  // characters are about 0.55 × fontSize.  This is only an
  // approximation — the layout engine already sized the node to
  // fit, so exact measurement isn't critical for export.
  function estTextWidth(text: string, fontSize: number): number {
    let w = 0
    for (const ch of text) {
      if (/[\u4e00-\u9fff\u3000-\u30ff\uff00-\uffef]/.test(ch)) {
        w += fontSize
      } else {
        w += fontSize * 0.55
      }
    }
    return w
  }

  for (const n of allNodes.value) {
    const nx = n.x - n.width / 2
    const ny = n.y - n.height / 2

    // Node background rect with rounded corners + border
    const rect = document.createElementNS(svgNS, 'rect')
    rect.setAttribute('x', String(nx))
    rect.setAttribute('y', String(ny))
    rect.setAttribute('width', String(n.width))
    rect.setAttribute('height', String(n.height))
    rect.setAttribute('rx', '8')
    rect.setAttribute('fill', nodeBg(n))
    rect.setAttribute('stroke', nodeBorder(n))
    rect.setAttribute('stroke-width', '1')
    svgEl.appendChild(rect)

    const hasTags = !!(n.tags && n.tags.length > 0)
    const hasMarkers = !!(n.markers && n.markers.length > 0)
    const hasImage = !!n.image
    const hasRich = !!(n.richContent && (n.richContent.kind === 'code' || n.richContent.kind === 'table'))

    // -- Rich body (code / table) rendered ABOVE the title --
    // Matches the on-canvas layout where .zm-rich-above sits
    // between the image and the text label.
    let richH = 0
    let richW = 0
    if (hasRich) {
      const rc = n.richContent!
      const richFontSize = n.fontSize * 0.78 * 0.92  // .zm-rich 0.78em * .zm-rich-code/table 0.92em
      const richPadX = 6   // .zm-rich padding 4px 6px + .zm-rich-code padding 6px 8px → ~6-8px
      const richPadY = 4
      const richMarginBottom = 2  // .zm-rich-above margin-bottom
      const richGap = 6  // .zm-rich margin-top (not used for above, but gap from image)

      if (rc.kind === 'code') {
        const codeStr = stripCodeFence(rc.raw)
        const lang = codeLang(rc.raw)
        const codeLines = codeStr.split('\n')
        const lineHeight = richFontSize * 1.35
        // Estimate max line width for the code block
        let maxLineW = 0
        for (const line of codeLines) {
          maxLineW = Math.max(maxLineW, estTextWidth(line, richFontSize))
        }
        richW = Math.min(maxLineW + richPadX * 2 + 4, n.width - 4)
        richH = codeLines.length * lineHeight + richPadY * 2 + richMarginBottom

        const richX = n.x - richW / 2
        let richY = ny + 4  // small top padding
        // If there is an image, render rich body below it
        if (hasImage) {
          richY = ny + n.image!.height + richGap
        }

        // Code block background
        const codeBg = document.createElementNS(svgNS, 'rect')
        codeBg.setAttribute('x', String(richX))
        codeBg.setAttribute('y', String(richY))
        codeBg.setAttribute('width', String(richW))
        codeBg.setAttribute('height', String(richH - richMarginBottom))
        codeBg.setAttribute('rx', '6')
        codeBg.setAttribute('fill', 'rgba(255,255,255,0.55)')
        codeBg.setAttribute('stroke', nodeBorder(n))
        codeBg.setAttribute('stroke-width', '1')
        svgEl.appendChild(codeBg)

        // Language tag (top-right corner)
        if (lang) {
          const langText = document.createElementNS(svgNS, 'text')
          langText.setAttribute('x', String(richX + richW - richPadX))
          langText.setAttribute('y', String(richY + richPadY + 4))
          langText.setAttribute('text-anchor', 'end')
          langText.setAttribute('fill', nodeFg(n))
          langText.setAttribute('font-size', String(richFontSize * 0.8))
          langText.setAttribute('font-family', FONT_FAMILY)
          langText.setAttribute('opacity', '0.5')
          langText.textContent = lang
          svgEl.appendChild(langText)
        }

        // Code lines
        const monoFont = "'JetBrains Mono','Fira Code',Consolas,monospace"
        for (let li = 0; li < codeLines.length; li++) {
          const codeText = document.createElementNS(svgNS, 'text')
          codeText.setAttribute('x', String(richX + richPadX))
          codeText.setAttribute('y', String(richY + richPadY + (li + 0.5) * lineHeight + 2))
          codeText.setAttribute('dominant-baseline', 'central')
          codeText.setAttribute('fill', nodeFg(n))
          codeText.setAttribute('font-size', String(richFontSize))
          codeText.setAttribute('font-family', monoFont)
          // Truncate long lines to fit the code block width
          let displayLine = codeLines[li]
          const maxChars = Math.floor((richW - richPadX * 2) / (richFontSize * 0.6))
          if (displayLine.length > maxChars) {
            displayLine = displayLine.substring(0, maxChars - 1) + '…'
          }
          codeText.textContent = displayLine
          svgEl.appendChild(codeText)
        }
      } else if (rc.kind === 'table') {
        const rows = tableRows(rc.raw)
        if (rows.length > 0) {
          const lineHeight = richFontSize * 1.35
          const cellPadX = 6
          const cellPadY = 3
          const colCount = rows[0].length
          // Calculate column widths based on content
          const colWidths = []
          for (let ci = 0; ci < colCount; ci++) {
            let maxW = 0
            for (const row of rows) {
              if (ci < row.length) {
                maxW = Math.max(maxW, estTextWidth(row[ci], richFontSize))
              }
            }
            colWidths.push(maxW + cellPadX * 2)
          }
          richW = Math.min(colWidths.reduce((a, b) => a + b, 0), n.width - 4)
          // Scale columns proportionally if they exceed node width
          const scale = richW / colWidths.reduce((a, b) => a + b, 0)
          for (let ci = 0; ci < colCount; ci++) {
            colWidths[ci] *= scale
          }
          richH = rows.length * (lineHeight + cellPadY * 2) + richMarginBottom

          const richX = n.x - richW / 2
          let richY = ny + 4
          if (hasImage) {
            richY = ny + n.image!.height + richGap
          }

          // Table background
          const tblBg = document.createElementNS(svgNS, 'rect')
          tblBg.setAttribute('x', String(richX))
          tblBg.setAttribute('y', String(richY))
          tblBg.setAttribute('width', String(richW))
          tblBg.setAttribute('height', String(richH - richMarginBottom))
          tblBg.setAttribute('rx', '6')
          tblBg.setAttribute('fill', 'rgba(255,255,255,0.55)')
          tblBg.setAttribute('stroke', nodeBorder(n))
          tblBg.setAttribute('stroke-width', '1')
          svgEl.appendChild(tblBg)

          // Render cells
          let cellX = richX
          let cellY = richY
          for (let ri = 0; ri < rows.length; ri++) {
            const row = rows[ri]
            const rowH = lineHeight + cellPadY * 2
            cellX = richX
            for (let ci = 0; ci < colCount; ci++) {
              const cellW = colWidths[ci]
              const cellText = row[ci] || ''

              // Cell border (right + bottom)
              if (ci < colCount - 1) {
                const vLine = document.createElementNS(svgNS, 'line')
                vLine.setAttribute('x1', String(cellX + cellW))
                vLine.setAttribute('y1', String(cellY))
                vLine.setAttribute('x2', String(cellX + cellW))
                vLine.setAttribute('y2', String(cellY + rowH))
                vLine.setAttribute('stroke', nodeBorder(n))
                vLine.setAttribute('stroke-width', '1')
                svgEl.appendChild(vLine)
              }
              if (ri < rows.length - 1) {
                const hLine = document.createElementNS(svgNS, 'line')
                hLine.setAttribute('x1', String(cellX))
                hLine.setAttribute('y1', String(cellY + rowH))
                hLine.setAttribute('x2', String(cellX + cellW))
                hLine.setAttribute('y2', String(cellY + rowH))
                hLine.setAttribute('stroke', nodeBorder(n))
                hLine.setAttribute('stroke-width', '1')
                svgEl.appendChild(hLine)
              }

              // Header row gets bolder background + text
              if (ri === 0) {
                const hdrBg = document.createElementNS(svgNS, 'rect')
                hdrBg.setAttribute('x', String(cellX))
                hdrBg.setAttribute('y', String(cellY))
                hdrBg.setAttribute('width', String(cellW))
                hdrBg.setAttribute('height', String(rowH))
                hdrBg.setAttribute('fill', 'rgba(255,255,255,0.4)')
                svgEl.appendChild(hdrBg)
              }

              // Cell text
              const tEl = document.createElementNS(svgNS, 'text')
              tEl.setAttribute('x', String(cellX + cellPadX))
              tEl.setAttribute('y', String(cellY + cellPadY + lineHeight / 2 + 2))
              tEl.setAttribute('dominant-baseline', 'central')
              tEl.setAttribute('fill', nodeFg(n))
              tEl.setAttribute('font-size', String(richFontSize))
              tEl.setAttribute('font-family', FONT_FAMILY)
              if (ri === 0) {
                tEl.setAttribute('font-weight', '600')
              }
              // Truncate if too long
              let displayText = cellText
              const maxChars = Math.floor((cellW - cellPadX * 2) / (richFontSize * 0.55))
              if (displayText.length > maxChars && maxChars > 2) {
                displayText = displayText.substring(0, maxChars - 1) + '…'
              }
              tEl.textContent = displayText
              svgEl.appendChild(tEl)

              cellX += cellW
            }
            cellY += rowH
          }
        }
      }
    }

    // -- Node image rendered ABOVE rich body and title --
    let imageH = 0
    if (hasImage) {
      const img = n.image!
      const imgY = ny + 4
      const imgX = n.x - img.width / 2
      // Use <image> element — native SVG, no tainting when
      // the src is a data: URL.  Remote URLs may taint the
      // canvas but most node images are data: URLs.
      const imgEl = document.createElementNS(svgNS, 'image')
      imgEl.setAttribute('x', String(imgX))
      imgEl.setAttribute('y', String(imgY))
      imgEl.setAttribute('width', String(img.width))
      imgEl.setAttribute('height', String(img.height))
      // Use href (SVG2) and xlink:href (SVG1.1 fallback)
      imgEl.setAttribute('href', img.src)
      imgEl.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', img.src)
      imgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      svgEl.appendChild(imgEl)
      imageH = img.height + 6  // image height + gap
    }

    // -- Text label and markers --
    // Vertical center: when image/rich content exists, the text
    // sits in the lower portion of the node box.  When tags are
    // also present, shift up slightly.
    let textRowY = n.y
    const contentAbove = imageH + richH
    if (contentAbove > 0) {
      // Text sits below the image + rich body
      textRowY = ny + contentAbove + (n.height - contentAbove) / 2
    } else if (hasTags) {
      textRowY = n.y - 8
    }

    // Horizontal layout: markers sit to the LEFT of the text
    // label, matching the on-canvas flexbox layout.
    const markerSize = 14
    const markerGap = 2
    const markerMarginRight = 4
    const markerCount = hasMarkers ? n.markers!.length : 0
    const markerRowW = markerCount > 0
      ? markerCount * markerSize + (markerCount - 1) * markerGap + markerMarginRight
      : 0
    const textW = estTextWidth(n.text, n.fontSize)
    const contentW = markerRowW + textW
    const contentStartX = n.x - contentW / 2

    // Markers (if any) — rendered as nested <svg> elements
    if (hasMarkers) {
      let mx = contentStartX
      for (const mid of n.markers!) {
        const inner = markerSvg(mid)
        if (inner) {
          const mSvg = document.createElementNS(svgNS, 'svg')
          mSvg.setAttribute('x', String(mx))
          mSvg.setAttribute('y', String(textRowY - markerSize / 2))
          mSvg.setAttribute('width', String(markerSize))
          mSvg.setAttribute('height', String(markerSize))
          mSvg.setAttribute('viewBox', '0 0 24 24')
          mSvg.setAttribute('color', nodeFg(n))
          const parser = new DOMParser()
          const doc = parser.parseFromString(
            `<svg xmlns="${svgNS}">${inner}</svg>`,
            'image/svg+xml'
          )
          if (!doc.querySelector('parsererror')) {
            while (doc.documentElement.firstChild) {
              mSvg.appendChild(doc.documentElement.firstChild)
            }
          }
          svgEl.appendChild(mSvg)
        }
        mx += markerSize + markerGap
      }
    }

    // Text label
    const textX = hasMarkers ? contentStartX + markerRowW + textW / 2 : n.x
    const text = document.createElementNS(svgNS, 'text')
    text.setAttribute('x', String(textX))
    text.setAttribute('y', String(textRowY))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'central')
    text.setAttribute('fill', nodeFg(n))
    text.setAttribute('font-size', String(nodeFontSize(n)))
    text.setAttribute('font-weight', String(nodeFontWeight(n)))
    text.setAttribute('font-family', FONT_FAMILY)
    text.textContent = n.text
    svgEl.appendChild(text)

    // Tags (if any) — rendered as pill rects + text below the label
    if (hasTags) {
      const tagFontSize = 10
      const tagH = 16
      const tagGap = 3
      const tagsY = n.y + 10
      const tagWidths = n.tags!.map((t) => estTextWidth(t, tagFontSize) + 12)
      const totalTagsW = tagWidths.reduce((a, b) => a + b + tagGap, -tagGap)
      let tagX = n.x - totalTagsW / 2

      for (let i = 0; i < n.tags!.length; i++) {
        const t = n.tags![i]
        const c = tagColor(t)
        const w = tagWidths[i]

        // Pill background
        const pill = document.createElementNS(svgNS, 'rect')
        pill.setAttribute('x', String(tagX))
        pill.setAttribute('y', String(tagsY - tagH / 2))
        pill.setAttribute('width', String(w))
        pill.setAttribute('height', String(tagH))
        pill.setAttribute('rx', String(tagH / 2))
        pill.setAttribute('fill', c.background)
        pill.setAttribute('stroke', c.borderColor)
        pill.setAttribute('stroke-width', '1')
        svgEl.appendChild(pill)

        // Pill text
        const tagText = document.createElementNS(svgNS, 'text')
        tagText.setAttribute('x', String(tagX + w / 2))
        tagText.setAttribute('y', String(tagsY))
        tagText.setAttribute('text-anchor', 'middle')
        tagText.setAttribute('dominant-baseline', 'central')
        tagText.setAttribute('fill', c.color)
        tagText.setAttribute('font-size', String(tagFontSize))
        tagText.setAttribute('font-family', FONT_FAMILY)
        tagText.textContent = t
        svgEl.appendChild(tagText)

        tagX += w + tagGap
      }
    }
  }

  return svgEl
}

function exportSVGFile() {
  const svgEl = buildExportSVG()
  const serializer = new XMLSerializer()
  let svgStr = serializer.serializeToString(svgEl)
  if (!svgStr.startsWith('<?xml')) {
    svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgStr
  }
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${dataRef.value.text || 'mindmap'}.svg`
  a.click()
  URL.revokeObjectURL(url)
}

function exportPNGFile(pngScale = 2) {
  const svgEl = buildExportSVG()
  const r = layoutResult.value
  const serializer = new XMLSerializer()
  let svgStr = serializer.serializeToString(svgEl)
  if (!svgStr.startsWith('<?xml')) {
    svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgStr
  }
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)
  const img = new window.Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(r.vbW * pngScale)
    canvas.height = Math.ceil(r.vbH * pngScale)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      URL.revokeObjectURL(svgUrl)
      return
    }
    ctx.fillStyle = effectiveBg.value
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(svgUrl)
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          // toBlob returned null — fall back to SVG
          exportSVGFile()
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${dataRef.value.text || 'mindmap'}.png`
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    } catch (err) {
      // SecurityError: tainted canvas.  This should no longer
      // happen since we switched from foreignObject to native SVG
      // elements, but keep the fallback as a safety net.
      console.warn('PNG export failed, falling back to SVG:', err)
      exportSVGFile()
    }
  }
  img.onerror = () => {
    URL.revokeObjectURL(svgUrl)
    // Fallback: try SVG export instead
    exportSVGFile()
  }
  img.src = svgUrl
}

defineExpose<MindMapExpose>({
  addChild: (parentId: string) => doAddChild(parentId),
  addSibling: (nodeId: string) => doAddSibling(nodeId),
  removeNode: (nodeId: string) => doRemove(nodeId),
  duplicateNode: (nodeId: string) => doDuplicate(nodeId),
  setNodeText: (nodeId: string, text: string) => doSetText(nodeId, text),
  moveNode: (srcId: string, targetId: string, position: 'before' | 'after' | 'child') =>
    doMove(srcId, targetId, position),
  lineWidthForDepth,
  endWidthForDepth,
  getData: () => dataRef.value,
  /** Does this node carry any of the drawer-editable extras
   *  (note / link / image / rich body)?  Plain text nodes return
   *  false.  Lets hosts gate the right-side inspector on
   *  "selected node has something to edit" instead of opening it
   *  on every selection. */
  nodeHasContent: (id: string): boolean => nodeHasContent(id),
  /** Currently selected node ids (empty when nothing is picked).
   *  The first id is the primary selection — toolbar buttons
   *  (add child / sibling, image controls) act on it.  Hosts
   *  can also read this to drive a multi-select status panel. */
  getSelectedIds: (): string[] => [...selectedIds.value],
  /** Copy the given subtrees into the canvas's clipboard buffer.
   *  No-op if any id is the root or no longer in the tree. */
  copyNodes: (ids: string[]): void => doCopy(ids),
  /** Cut the given subtrees (copy + remove from tree, immediately).
   *  No-op if any id is the root or no longer in the tree.  Undo
   *  restores the originals. */
  cutNodes: (ids: string[]): void => doCut(ids),
  /** Paste the clipboard buffer under `targetId` (or root when
   *  null).  Single-shot: the buffer is consumed, subsequent
   *  calls are no-ops until copy / cut again. */
  pasteNodes: (targetId: string | null): void => doPaste(targetId),
  setData: (d) => {
    history.reset()
    dataRef.value = clone(d)
    selectedIds.value = new Set()
    collapsedIds.value = new Set()
    triggerRef()
    // Record the new data as the undoable baseline so the first edit
    // after a setData can still be undone.
    record()
    nextTick(() => resetView())
  },
  resetView: () => resetView(),
  exportData,
  importData,
  /** Serialize the current data tree as markdown.  Always available
   *  — the same serializer is used to emit `markdownChange`. */
  getMarkdown: () => mindMapToMarkdown(dataRef.value),
  /** Replace the data tree with the result of parsing `md`.  The
   *  flag `emitMarkdownChange` (default true) controls whether the
   *  change is also echoed via `markdownChange` (use false when
   *  the host just set the same value back from the prop). */
  setMarkdown: (md: string, emitMarkdownChange: boolean = true) => {
    const parsed = markdownToMindMap(md || '')
    if (emitMarkdownChange) usingMarkdown.value = true
    suppressMarkdownEmit = !emitMarkdownChange
    history.reset()
    dataRef.value = clone(parsed)
    selectedIds.value = new Set()
    collapsedIds.value = new Set()
    triggerRef()
    record()
    nextTick(() => {
      suppressMarkdownEmit = false
      resetView()
    })
    emit('change', dataRef.value)
  },
  // Make balanced the active layout (sticky).  Subsequent data changes
  // and additions stay in balanced mode.  Pass `false` to revert to the
  // default compact layout.
  setBalanced: (v: boolean) => {
    balanced.value = v
  },
  isBalanced: () => balanced.value,
  // Re-balance now: clear all manual drag offsets, re-run the balanced
  // layout, and re-center the view.  This is the action tied to the
  // "balance" toolbar button.
  balance: () => runBalance(),
  applyNodeStyle: (id: string, style: NodeStyle) => applyNodeStyle(id, style),
  getNodeStyle: (id: string): NodeStyle => getNodeStyle(id),
  applyNodeImage: (id: string, image: MindMapImage) => applyNodeImage(id, image),
  applyNodeImageByUrl: (id: string, url: string) => applyNodeImageByUrl(id, url),
  removeNodeImage: (id: string) => removeNodeImage(id),
  applyNodeLink: (id: string, url: string) => applyNodeLink(id, url),
  removeNodeLink: (id: string) => removeNodeLink(id),
  applyNodeNote: (id: string, text: string) => applyNodeNote(id, text),
  removeNodeNote: (id: string) => removeNodeNote(id),
  applyNodeRichContent: (
    id: string,
    content: { kind: 'code' | 'table'; raw: string; lang?: string } | null
  ) => applyNodeRichContent(id, content),
  addNodeMarker: (nodeId: string, marker: string) => applyNodeMarker(nodeId, marker),
  removeNodeMarker: (nodeId: string, marker: string) => removeNodeMarkerData(nodeId, marker),
  toggleNodeMarker: (nodeId: string, marker: string) => toggleNodeMarkerData(nodeId, marker),
  getNodeMarkers: (nodeId: string) => getNodeMarkersData(nodeId),
  setNodeTags: (nodeId: string, tags: string[]) => setNodeTagsData(nodeId, tags),
  getNodeTags: (nodeId: string) => getNodeTagsData(nodeId),
  exportPNG: (scale?: number) => exportPNGFile(scale),
  exportSVG: () => exportSVGFile(),
  searchNodes: (query: string) => {
    performSearch(query)
    return [...searchResults.value]
  },
  undo: () => doUndo(),
  redo: () => doRedo(),
  canUndo: () => history.canUndo(),
  canRedo: () => history.canRedo(),
  // Settings panel / external mutation hooks
  applySettings: (s: Partial<MindMapSettings>) => {
    if (s.autoBalanceOnChange !== undefined) settings.autoBalanceOnChange = s.autoBalanceOnChange
    if (s.lineWidthStart !== undefined)
      settings.lineWidthStart = Math.max(0.5, Math.min(20, s.lineWidthStart))
    if (s.lineWidthEnd !== undefined)
      settings.lineWidthEnd = Math.max(0.3, Math.min(10, s.lineWidthEnd))
    if (s.rainbowBranch !== undefined) settings.rainbowBranch = s.rainbowBranch
    if (s.branchPaletteId !== undefined) settings.branchPaletteId = s.branchPaletteId
    if (s.customPalettes !== undefined) settings.customPalettes = s.customPalettes
    if (s.lineStyle !== undefined) settings.lineStyle = s.lineStyle
    if (s.taperedEdge !== undefined) settings.taperedEdge = s.taperedEdge
    if (s.showOrderBadge !== undefined) settings.showOrderBadge = s.showOrderBadge
    if (s.canvasBg !== undefined) settings.canvasBg = s.canvasBg
  },
  getSettings: (): MindMapSettings => ({
    autoBalanceOnChange: settings.autoBalanceOnChange,
    lineWidthStart: settings.lineWidthStart,
    lineWidthEnd: settings.lineWidthEnd,
    rainbowBranch: settings.rainbowBranch,
    branchPaletteId: settings.branchPaletteId,
    customPalettes: settings.customPalettes,
    lineStyle: settings.lineStyle,
    layoutMode: settings.layoutMode,
    taperedEdge: settings.taperedEdge,
    showOrderBadge: settings.showOrderBadge,
    canvasBg: settings.canvasBg,
  }),
  setBranchPalette: (id) => {
    if (!id) return
    const known = [...BUILTIN_PALETTES, ...settings.customPalettes].find((p) => p.id === id)
    if (known) settings.branchPaletteId = id
  },
  getBranchPalette: () => settings.branchPaletteId,
  getBranchPalettes: () => [...BUILTIN_PALETTES, ...settings.customPalettes],
  // Expose search state getters for external consumers (e.g. the
  // outline panel highlighting matches).  These are read-only.
  getSearchResults: () => [...searchResults.value],
  getSearchIndex: () => searchIndex.value,
})

watch(
  () => props.data,
  (v) => {
    dataRef.value = clone(v)
    triggerRef()
  },
  { deep: false }
)

onMounted(() => {
  // Record the initial state so the first user action is undoable.
  // Without this, history starts at cursor=-1 and the user can't
  // undo their very first edit (cursor would jump from -1 → 0, and
  // canUndo() requires cursor > 0).
  record()
  nextTick(() => resetView())
})

// re-center when layout dimensions change
// NB: there used to be a `watch(() => layoutResult.value.width, …)`
// that auto-reset the view whenever the layout's overall width
// changed.  It was meant to keep newly-imported data visible, but
// it also fired on EVERY drag (the dragged subtree changes
// vbW) and on every collapse / expand — which silently undid the
// user's zoom + pan.  Callers that need a fresh view already
// trigger it themselves: setData / importData / runBalance /
// onMounted all call resetView() explicitly.
</script>

<template>
  <div
    class="zm-mindmap"
    :style="{ background: effectiveBg, fontSize: theme.fontSize + 'px' }"
  >
    <div
      ref="wrapperRef"
      class="zm-canvas"
      @mousedown="onCanvasMouseDown"
      @contextmenu="onCanvasContextMenu"
      @wheel="panZoom.onWheel"
      @mouseenter="canvasHovered = true"
      @mouseleave="canvasHovered = false"
      @click="onCanvasClick"
    >
      <!-- SVG layer: positioned in world coords (vbX, vbY) scaled by
           panZoom.scale and offset by panZoom.offsetX/Y.  This MUST
           match the .zm-world's translate+scale exactly so that
           SVG edges line up with the DOM node rectangles — without
           this alignment, edges and nodes drift apart at any zoom
           ≠ 1 (the SVG's viewBox-internal (0,0) corresponds to
           (vbX, vbY) in world space, so the SVG element's CSS left
           is vbX*scale + panX, not panX). -->
      <div
        class="zm-svg-layer"
        :style="{
          left: (layoutResult.vbX * panZoom.scale.value + panZoom.offsetX.value) + 'px',
          top: (layoutResult.vbY * panZoom.scale.value + panZoom.offsetY.value) + 'px',
          width: (layoutResult.vbW * panZoom.scale.value) + 'px',
          height: (layoutResult.vbH * panZoom.scale.value) + 'px',
        }"
      >
        <svg
          class="zm-svg"
          :viewBox="viewBox"
          preserveAspectRatio="xMinYMin meet"
          :width="layoutResult.vbW * panZoom.scale.value"
          :height="layoutResult.vbH * panZoom.scale.value"
        >
          <g class="zm-edges">
            <path
              v-for="e in edges"
              :key="e.key"
              :d="variableWidthPath(lineAnchor(e.from, 'out', e.to.side, e.to), lineAnchor(e.to, 'in'), lineWidthForDepth(e.from.depth), endWidthForDepth(e.to.depth), 32, settings.lineStyle, e.to._dir)"
              :fill="lineColorFor(e.from, e.to)"
              stroke="none"
            />
          </g>
        </svg>
      </div>

      <!-- Marquee rectangle: shown when the user is dragging on
           the empty canvas. Positioned in screen-space (does NOT
           follow the world transform) so it tracks the pointer
           1:1 regardless of zoom or pan. -->
      <div
        v-if="panZoom.isMarquee.value"
        class="zm-marquee"
        :style="{
          left: (panZoom.marquee.x * panZoom.scale.value + panZoom.offsetX.value) + 'px',
          top: (panZoom.marquee.y * panZoom.scale.value + panZoom.offsetY.value) + 'px',
          width: (panZoom.marquee.width * panZoom.scale.value) + 'px',
          height: (panZoom.marquee.height * panZoom.scale.value) + 'px',
        }"
      />

      <!-- Drag ghost — follows the pointer, scaled to match the
           canvas so it stays visually consistent as the user zooms. -->
      <div
        v-if="dragState"
        class="zm-drag-ghost"
        :style="{
          left: dragGhostX + 'px',
          top: dragGhostY + 'px',
          transform: `scale(${panZoom.scale.value})`,
          transformOrigin: 'top left',
        }"
      >{{ dragState.srcText }}</div>

      <div
        class="zm-world"
        :style="{
          transform: `translate(${panZoom.offsetX.value}px, ${panZoom.offsetY.value}px) scale(${panZoom.scale.value})`,
        }"
      >
        <div
          v-for="n in allNodes"
          :key="n.id"
          class="zm-node"
          :data-node-id="n.id"
          :class="{
            'is-root': n.isRoot,
            'is-selected': selectedId === n.id,
            'is-selected-secondary': selectedId !== n.id && selectedIds.has(n.id),
            'is-editing': editingId === n.id,
            'has-image': !!n.image,
            'is-resizing': resizingId === n.id,
            'is-dragging-source': dragState?.srcId === n.id,
            'is-drop-target': dragState?.currentTargetId === n.id,
            'is-search-hit': isSearchHit(n.id),
            'is-search-current': isCurrentSearchHit(n.id),
            'is-search-dimmed': isSearchDimmed(n.id),
          }"
          :style="{
            left: n.x + 'px',
            top: n.y + 'px',
            // Pin the box to the layout's reserved width so the
            // SVG edge anchor (which keys off n.width) lands on
            // the visible centre.  Without `width` here the box
            // would grow to fit the rich body's `width: max-content`
            // and the line would pierce the visible frame.
            width: n.width + 'px',
            minWidth: n.width + 'px',
            height: n.height + 'px',
            fontSize: nodeFontSize(n) + 'px',
            background: nodeBg(n),
            color: nodeFg(n),
            borderColor: nodeBorder(n),
            fontWeight: nodeFontWeight(n),
            // Center the box on (x, y) with translate(-50%, -50%)
            transform: `translate(-50%, -50%)`,
          }"
          @click="(e) => onNodeClick(e, n)"
          @pointerdown="(e) => onNodePointerDown(e, n)"
          @dblclick="(e) => { e.stopPropagation(); if (!previewMode) startEdit(n.id) }"
          @contextmenu="(e) => onNodeContextMenu(e, n)"
          @mouseenter="(e) => { onNodeMouseEnter(n.id); onNodeTextHover(e, n) }"
          @mouseleave="onNodeMouseLeave(n.id)"
        >
          <img
            v-if="n.image"
            class="zm-node-img"
            :src="n.image.src"
            :width="n.image.width"
            :height="n.image.height"
            :alt="n.text"
            draggable="false"
          />
          <!--
            Rich body (code / table only): produced by hand-built
            trees (the `#rich` sample in the demo) or by
            `markdownToRichMindMap`.  Rendered as a small framed
            block ABOVE the node title so the title stays
            single-line and the SVG edge anchor (which keys
            off the box centre) doesn't drift.  Only code and
            table kinds render — paragraph / list kinds fall
            through to the plain `text` label so the box
            stays the same size as a regular node.
            Pointer events are disabled on the body so clicks
            fall through to the node (lets the user dblclick
            to edit).
          -->
          <div
            v-if="n.richContent && (n.richContent.kind === 'code' || n.richContent.kind === 'table') && editingId !== n.id"
            class="zm-rich zm-rich-above"
            :class="{ 'zm-rich-no-overflow': n.richContent.kind === 'table' || n.richContent.kind === 'code' }"
            @click.stop
            @dblclick.stop="startRichEdit(n.id)"
            @mousedown.stop
          >
            <!-- Edit mode: textarea overlays the preview, same size. -->
            <textarea
              v-if="richEditingId === n.id"
              v-model="richEditDraft"
              class="zm-rich-edit"
              spellcheck="false"
              @blur="commitRichEdit"
              @keydown="onRichEditKeydown"
            />
            <template v-else>
              <pre
                v-if="n.richContent.kind === 'code'"
                class="zm-rich-code"
              ><code v-html="highlightCode(stripCodeFence(n.richContent.raw), codeLang(n.richContent.raw))"></code></pre>
              <table
                v-else-if="n.richContent.kind === 'table'"
                class="zm-rich-table"
              >
                <tbody>
                  <tr v-for="(row, ri) in sortedTableRows(n.id, tableRows(n.richContent.raw))" :key="ri">
                    <th
                      v-if="ri === 0"
                      v-for="(cell, ci) in row"
                      :key="`h${ci}`"
                      class="zm-rich-table-sort"
                      :class="{
                        'is-sorted': sortState.get(n.id)?.col === ci,
                        'is-asc': sortState.get(n.id)?.col === ci && sortState.get(n.id)?.dir === 'asc',
                        'is-desc': sortState.get(n.id)?.col === ci && sortState.get(n.id)?.dir === 'desc',
                      }"
                      @click.stop="toggleNodeSort(n.id, ci)"
                    >
                      <span>{{ cell }}</span>
                      <span class="zm-rich-sort-mark" aria-hidden="true">{{ sortMark(n.id, ci) }}</span>
                    </th>
                    <td
                      v-else
                      v-for="(cell, ci) in row"
                      :key="`c${ci}`"
                    >{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
          <span v-if="editingId !== n.id" class="zm-text">
            <span
              v-if="n.markers && n.markers.length > 0"
              class="zm-node-markers"
            >
              <span
                v-for="mid in n.markers"
                :key="mid"
                class="zm-node-marker"
                :title="markerLabel(mid)"
                v-html="'<svg viewBox=&quot;0 0 24 24&quot; width=&quot;14&quot; height=&quot;14&quot;>' + markerSvg(mid) + '</svg>'"
              />
            </span>
            <span class="zm-text-label">{{ n.text }}</span>
            <a
              v-if="n.link && !editingId"
              class="zm-node-link"
              :href="n.link.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="`打开链接：${n.link.url}`"
              @click.stop
              @mousedown.stop
            ><Icon name="link" :size="11" :stroke="2" /></a>
            <button
              v-if="n.note && !editingId"
              class="zm-node-note-btn"
              type="button"
              :title="notePreview(n.note.text)"
              @click.stop="emitEditNote(n.id)"
              @mousedown.stop
            ><Icon name="note" :size="11" :stroke="2" /></button>
          </span>
          <input
            v-else
            class="zm-input"
            v-model="editText"
            autofocus
            @blur="commitEdit()"
            @keydown.enter.exact="commitEdit()"
            @keydown.tab.prevent="commitEdit()"
            @keydown.esc="cancelEdit"
            @keydown="onEditKeydown"
            @mousedown.stop
            @click.stop
          />

          <!-- Tags — small colored pills below the title. -->
          <div
            v-if="n.tags && n.tags.length > 0 && editingId !== n.id"
            class="zm-node-tags"
          >
            <span
              v-for="tag in n.tags"
              :key="tag"
              class="zm-node-tag"
              :style="tagColor(tag)"
            >{{ tag }}</span>
          </div>

          <span
            v-if="showOrderBadge"
            class="zm-order-badge"
            :title="`数据顺序：第 ${siblingIndexOf(n.id) + 1} 个`"
          >{{ siblingIndexOf(n.id) + 1 }}</span>

          <span
            v-if="isCollapsed(n.id) && collapsedChildCount(n.id) > 0"
            class="zm-collapse-badge"
            :class="{ 'is-on-left': n.side === -1 }"
            :style="{ background: branchColor.get(n.id) ?? '#64748b' }"
            :title="`展开 ${collapsedChildCount(n.id)} 个子节点`"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >{{ collapsedChildCount(n.id) }}</span>

          <button
            v-if="nodeHasChildren(n) && !isCollapsed(n.id)"
            class="zm-btn zm-collapse"
            :class="{ 'is-on-left': n.side === -1 }"
            :style="{ color: branchColor.get(n.id) ?? '#64748b', borderColor: branchColor.get(n.id) ?? '#64748b' }"
            title="折叠"
            @mousedown.stop
            @click.stop="toggleCollapse(n.id)"
          >
            <Icon name="minus" :size="10" :stroke="2.4" />
          </button>

          <!-- Resize handle — bottom-right corner of the node,
               only on selected image-bearing nodes.  Drag to
               scale the image.  Inline handlers update the DOM
               directly for drag-time fluidity; mouseup commits
               the new size to the data tree. -->
          <span
            v-if="n.image && selectedId === n.id && editingId !== n.id"
            class="zm-img-resize-handle"
            title="拖动调整图片大小"
            @mousedown.stop="(e) => onResizeStart(e, n)"
          />

          <!-- "Remove image" tiny × button.  Sits a couple of
               pixels above the resize handle.  Clears the
               image field and re-runs the layout. -->
          <button
            v-if="n.image && selectedId === n.id && editingId !== n.id"
            class="zm-img-remove-btn"
            title="移除图片"
            @mousedown.stop
            @click.stop="removeNodeImage(n.id)"
          >
            <Icon name="x" :size="9" :stroke="2.2" />
          </button>
        </div>
      </div>

      <!-- Floating tooltip for truncated node labels.  Renders
           above the zoom layer so it isn't affected by the
           canvas's pan/zoom transform.  Position is anchored
           to the node's screen rect at hover time. -->
      <div
        v-if="tooltip"
        class="zm-tooltip"
        :class="{ 'is-below': !tooltip.above }"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >{{ tooltip.text }}</div>

      <!-- Floating context menu — mounted only while the user is
           interacting with it.  Container is the canvas so the
           menu can clamp itself inside the visible area. -->
      <NodeContextMenu
        v-if="contextMenu"
        :x="contextMenu.x"
        :y="contextMenu.y"
        :container="wrapperRef"
        :has-image="!!findNode(dataRef, contextMenu.nodeId)?.image"
        :has-link="!!findNode(dataRef, contextMenu.nodeId)?.link"
        :has-note="!!findNode(dataRef, contextMenu.nodeId)?.note"
        :has-code="findNode(dataRef, contextMenu.nodeId)?.richContent?.kind === 'code'"
        :has-table="findNode(dataRef, contextMenu.nodeId)?.richContent?.kind === 'table'"
        :node-markers="findNode(dataRef, contextMenu.nodeId)?.markers ?? []"
        :node-tags="findNode(dataRef, contextMenu.nodeId)?.tags ?? []"
        @pick-image="menuPickImage"
        @remove-image="menuRemoveImage"
        @set-link="menuSetLink"
        @remove-link="menuRemoveLink"
        @edit-note="menuEditNote"
        @remove-note="menuRemoveNote"
        @add-code="menuAddCode"
        @edit-code="menuAddCode"
        @remove-code="menuRemoveCode"
        @add-table="menuAddTable"
        @edit-table="menuAddTable"
        @remove-table="menuRemoveTable"
        @toggle-marker="menuToggleMarker"
        @clear-markers="menuClearMarkers"
        @add-tag="menuAddTag"
        @remove-tags="menuRemoveTags"
        @close="closeContextMenu"
      />

      <!-- Canvas right-click menu -- rendered only while the user is
           interacting with it.  Container is the canvas so the menu can
           clamp itself inside the visible area.  Actions re-emit to the
           parent (App.vue decides which drawer to open). -->
      <CanvasContextMenu
        v-if="canvasMenu"
        :x="canvasMenu.x"
        :y="canvasMenu.y"
        :container="wrapperRef"
        @open-settings="menuOpenSettings"
        @open-data="menuOpenData"
        @open-import="menuOpenImport"
        @export-png="exportPNGFile"
        @export-svg="exportSVGFile"
        @close="closeCanvasMenu"
      />

      <!-- FABs. See fabPreviewClass and fabOutlineClass. -->
      <button
        :class="fabPreviewClass"
        :title="props.previewMode ? '退出预览模式' : '进入预览模式'"
        @click="emit('canvas-toggle-preview')"
      >
        <Icon :name="props.previewMode ? 'eye-off' : 'eye'" :size="16" />
      </button>
      <button
        :class="fabOutlineClass"
        title="显示大纲视图"
        @click="emit('canvas-outline')"
      >
        <Icon name="outline" :size="16" />
      </button>

    <!-- Bottom toolbar.  Always rendered; the parent's previewMode
         + canvasHovered refs drive visibility:
           - non-preview: toolbar always visible
           - preview:     toolbar fades in on canvas hover, fades
                          out on leave.  Pointer-events follow
                          opacity so the toolbar doesn't catch
                          clicks while invisible.
         Inside, the "secondary" group (add child/sibling, layout
         mode, import) is non-preview-only — those buttons mutate
         data, which preview mode disallows.

         IMPORTANT: this toolbar MUST live inside .zm-canvas (not
         a sibling).  .zm-canvas's @mouseleave fires when the
         cursor moves to a sibling element, which would hide the
         toolbar the moment the user reaches for it.  Sitting
         inside .zm-canvas means the cursor is technically still
         inside the canvas while it's on the toolbar (because
         mouseenter/mouseleave don't fire when moving between
         parent and child). -->
    <div
      class="zm-toolbar"
      :class="{ 'is-preview-only': props.previewMode, 'is-hovered': canvasHovered }"
    >
      <!-- 缩放比例 + 放大 / 缩小 / 重置视图: always visible, also
           show in preview mode (the canvas still needs to be
           navigable in preview). -->
      <span class="zm-tb-tip zm-tb-zoom">{{ Math.round(panZoom.scale.value * 100) }}%</span>
      <button class="zm-tb-btn" title="放大" @click="panZoom.zoomIn">
        <Icon name="zoom-in" />
      </button>
      <button class="zm-tb-btn" title="缩小" @click="panZoom.zoomOut">
        <Icon name="zoom-out" />
      </button>
      <button class="zm-tb-btn" title="重置视图" @click="resetView">
        <Icon name="reset" />
      </button>
      <span class="zm-tb-divider" />

      <!-- Bulk expand/collapse: safe in preview mode (it's a view
           operation, not an edit).  Each button has its own glyph
           so they're visually distinct, not three identical
           right-chevrons:
             全部收起  → 4 chevrons pointing inward (compress)
             展开一级 → 1 root + 3 children (2-level tree)
             展开二级 → 1 root + 3 children + 6 grandchildren
             全部展开  → 4 chevrons pointing outward (expand) -->
      <button class="zm-tb-btn" title="全部收起" @click="collapseAll">
        <Icon name="collapse-all" />
      </button>
      <button class="zm-tb-btn" title="展开一级" @click="expandToLevel(1)">
        <Icon name="expand-level-1" />
      </button>
      <button class="zm-tb-btn" title="展开二级" @click="expandToLevel(2)">
        <Icon name="expand-level-2" />
      </button>
      <button class="zm-tb-btn" title="全部展开" @click="expandAll">
        <Icon name="expand-all" />
      </button>
      <span class="zm-tb-divider" />

      <!-- Export: JSON only on the toolbar.  PNG / SVG live in the
           canvas right-click menu so the toolbar stays clean. -->
      <button class="zm-tb-btn" title="导出 JSON" @click="exportToFile">
        <Icon name="export" />
      </button>

      <!-- Non-preview-only: edit + layout + import.  These mutate
           the data tree or settings, which preview mode disallows. -->
      <template v-if="!props.previewMode">
        <span class="zm-tb-divider" />
        <button
          class="zm-tb-btn"
          title="添加子节点 (Tab)"
          @click="selectedId && doAddChild(selectedId)"
        >
          <img :src="addSubNodeIcon" width="14" height="14" alt="添加子节点" draggable="false" />
        </button>
        <button
          class="zm-tb-btn"
          title="添加同级 (Enter)"
          @click="selectedId && doAddSibling(selectedId)"
        >
          <img :src="addNodeIcon" width="14" height="14" alt="添加同级" draggable="false" />
        </button>
        <span class="zm-tb-divider" />
        <button
          class="zm-tb-btn"
          :class="{ active: settings.layoutMode === 'mindmap' }"
          title="思维导图布局 (中心辐射)"
          @click="setLayoutMode('mindmap')"
        >
          <Icon name="mindmap" />
        </button>
        <button
          class="zm-tb-btn"
          :class="{ active: settings.layoutMode === 'tree' }"
          title="树形布局 (向右展开)"
          @click="setLayoutMode('tree')"
        >
          <Icon name="tree" />
        </button>
        <button
          class="zm-tb-btn"
          :class="{ active: settings.layoutMode === 'org' }"
          title="组织结构布局 (向下展开)"
          @click="setLayoutMode('org')"
        >
          <Icon name="org" />
        </button>
        <span class="zm-tb-divider" />
        <button
          class="zm-tb-btn"
          title="导入 JSON"
          @click="importFromFile"
        >
          <Icon name="import" />
        </button>
      </template>
    </div>
    </div>
  </div>
</template>

<style>
@import 'highlight.js/styles/github.css';

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
}
.zm-svg-layer {
  position: absolute;
  /* Position is set inline via the world→screen mapping
     (vbX*scale + panX, vbY*scale + panY).  No CSS transform here
     so the SVG layer's geometry matches the .zm-world's
     translate+scale exactly. */
  pointer-events: none;
  overflow: visible;
}
.zm-marquee {
  position: absolute;
  border: 1px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  pointer-events: none;
  z-index: 5;
}
.zm-svg {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  overflow: visible;
  shape-rendering: geometricPrecision;
}
.zm-node {
  position: absolute;
  display: flex;
  flex-direction: column;  /* Stack rich body (image / code / table) above title.
                            * When there's no rich body the column only has the
                            * title row, which is centered horizontally and
                            * vertically (justify-content: center on the
                            * cross axis). */
  align-items: center;
  justify-content: center;
  padding: 0 0.8em;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid;
  line-height: 1.2;
  cursor: default;
  transition: box-shadow 0.15s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  white-space: nowrap;
  z-index: 1;
}
.zm-node:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 2;
}

/* Drag-to-reparent: editable nodes invite a grab cursor;
   the dragged source dims out; the hovered target picks up
   a green outline.  Root stays at default cursor. */
.zm-node:not(.is-root):not(.is-editing) { cursor: grab; }
.zm-node.is-root { cursor: default; }
.zm-node.is-dragging-source { opacity: 0.4; cursor: grabbing; }
.zm-node.is-drop-target {
  outline: 2px solid #4caf50;
  outline-offset: 2px;
  transition: outline-color 0.1s ease;
}
.zm-drag-ghost {
  position: absolute;
  pointer-events: none;
  z-index: 10000;
  padding: 4px 10px;
  background: #fff;
  border: 1px solid #4caf50;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: 13px;
  color: #333;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  will-change: transform, left, top;
}
body.is-dragging { cursor: grabbing !important; user-select: none; }
.zm-node.is-root {
  font-weight: 600;
}
.zm-node.is-selected {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
  z-index: 3;
}
/* Multi-select "secondary" ring — softer than the primary so the
 * user can still tell at a glance which node is the primary
 * (the loud blue) while seeing every other picked node. */
.zm-node.is-selected-secondary {
  outline: 2px solid #bfdbfe;
  outline-offset: 2px;
  z-index: 2;
}
.zm-text {
  /* The text span now hosts the text label + inline link/note
   * icons.  `pointer-events: none` is kept on the *label* so a
   * click on text still falls through to the node (lets the
   * user dblclick-to-edit the text).  The icon buttons inside
   * re-enable pointer events explicitly.
   *
   * `display: flex` (not inline-flex): the parent `.zm-node` is
   * `display: flex; flex-direction: column; align-items: center`,
   * and an inline-flex child reports its content size to the
   * parent as ~0 height (the inline formatting context doesn't
   * contribute a line-box here), which collapsed the title to a
   * 0-height strip and clipped the visible text.
   *
   * `min-height: 1em` (belt-and-braces): a flex item's default
   * `min-height: auto` resolves to the content's min-content
   * size, which for an inline-element child can still be 0 if
   * the parent has tight overflow constraints.  Forcing `1em`
   * guarantees the title takes at least one line-box's worth
   * of vertical space so the text is never clipped by the
   * parent box.  The actual `n.height` reservation in
   * `calcNodeSize` accounts for this 1em too. */
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  /* Force the title row to reserve at least one line-box's
   * worth of vertical space.  A flex item's default
   * `min-height: auto` resolves to its content's min-content
   * size, which for an inline-element child of an
   * overflow-constrained flex parent can be 0.  Using
   * `min-height: 1.2em` (matching the parent's line-height)
   * guarantees the title takes the full line-box height so
   * `align-items: center` never clips a taller label.  The
   * layout's `n.height` reservation accounts for this. */
  min-height: 1.2em;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zm-text-label {
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Allow flex to shrink the label so a long string doesn't push
   * the rendered width past the layout's reserved width (which
   * would pull the line anchor off the box edge).  `min-width: 0`
   * is the standard flex-shrink escape hatch. */
  min-width: 0;
  flex-shrink: 1;
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

/* Truncated-label tooltip.  Fixed-positioned on the canvas wrapper
 * (outside the zoom transform).  Dark bubble, white text, with a
 * small arrow pointing at the node when shown above. */
.zm-tooltip {
  position: absolute;
  max-width: 240px;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.94);
  color: #f8fafc;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 6px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  z-index: 1000;
  white-space: normal;
  word-break: break-word;
  transform: translate(-50%, -100%);
  animation: zm-tooltip-in 120ms ease-out;
}
.zm-tooltip.is-below {
  transform: translate(-50%, 0);
}
.zm-tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: rgba(15, 23, 42, 0.94);
}
.zm-tooltip.is-below::after {
  top: auto;
  bottom: 100%;
  border-top-color: transparent;
  border-bottom-color: rgba(15, 23, 42, 0.94);
}
@keyframes zm-tooltip-in {
  from { opacity: 0; transform: translate(-50%, calc(-100% + 4px)); }
  to   { opacity: 1; transform: translate(-50%, -100%); }
}
.zm-tooltip.is-below {
  animation-name: zm-tooltip-in-below;
}
@keyframes zm-tooltip-in-below {
  from { opacity: 0; transform: translate(-50%, -4px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

/* ── rich body ─────────────────────────────────────
 * Shows the markdown payload produced by
 * `markdownToRichMindMap` (or hand-built data) inside the
 * node box, above the title for code/table kinds so the
 * single-line title stays visually centred and the SVG
 * edge anchor doesn't drift.  Pointer events are
 * explicitly disabled via .zm-rich so the node stays
 * clickable for selection / dblclick-to-edit. */
.zm-rich {
  /* The body is editable in place: dblclick flips to a
   * textarea, clickable sort headers in tables.  We stop click
   * propagation in the template so a click on the body doesn't
   * also re-select the node. */
  margin-top: 6px;
  width: max-content;
  /* No height cap: the body grows to fit its content so very long
   * tables / code stay fully visible.  The box's layout-reserved
   * height comes from the measured `richHeights` map (see
   * core/layout.ts), so neighbours don't collide when a table
   * grows.  If you want a safety bound for pathological pastes,
   * add `max-height` here and switch `overflow` back to `auto`. */
  overflow: visible;
  font-size: 0.78em;
  line-height: 1.35;
  text-align: left;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 4px;
  padding: 4px 6px;
  color: inherit;
}
/* When the rich body sits above the title, drop the top
 * margin (no need to separate from a thing that doesn't
 * exist yet) and add a bottom gap before the title. */
.zm-rich-above {
  margin: 0 0 2px 0;
}
/* Both code and table rich bodies grow with their content and
 * never show a scrollbar — the layout's reserved height cap
 * (`richHeights` cap in core/layout.ts) is the only upper bound.
 * Letting the body take its natural height keeps the rendered
 * box in sync with the layout's reservation. */
.zm-rich-no-overflow {
  max-height: none;
  overflow: visible;
}
.zm-rich-code {
  margin: 0;
  padding: 6px 8px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 0.92em;
  white-space: pre-wrap;
  word-break: break-word;
  /* Lifts the code off the node's coloured surface so it
   * stays legible regardless of branch palette.  The
   * translucent white mixes with the node background. */
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid currentColor;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.zm-rich-list {
  margin: 0;
  padding-left: 1.2em;
  list-style: disc;
}
.zm-rich-list li {
  margin: 1px 0;
}
/* Tables should grow with their content and never show a
 * scrollbar — the only thing the layout reserved height
 * gave them was a cap to keep the tree readable.  A short
 * 3-4 row table that fits within the reserved space should
 * just be its natural height. */
.zm-rich-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.92em;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid currentColor;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.zm-rich-table td {
  border-top: 1px solid currentColor;
  border-right: 1px solid currentColor;
  padding: 3px 6px;
  /* Higher than the old 0.7 so cell text reads cleanly against
   * the translucent white fill, but still tinted to the branch
   * palette via currentColor. */
  opacity: 0.9;
}
.zm-rich-table tr:last-child td {
  border-bottom: none;
}
.zm-rich-table td:last-child {
  border-right: none;
}
.zm-rich-table-sort {
  position: relative;
  background: rgba(255, 255, 255, 0.4);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  user-select: none;
  padding: 3px 6px;
  border-bottom: 1px solid currentColor;
  border-right: 1px solid currentColor;
  /* The parent .zm-rich has pointer-events: none so clicks fall
   * through to the node; re-enable here so sort actually works. */
  pointer-events: auto;
}
.zm-rich-table-sort:last-child {
  border-right: none;
}
.zm-rich-table-sort:hover {
  background: rgba(255, 255, 255, 0.65);
}
.zm-rich-table-sort.is-sorted {
  background: rgba(255, 255, 255, 0.7);
}
.zm-rich-sort-mark {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  color: #94a3b8;
}
.zm-rich-table-sort.is-sorted .zm-rich-sort-mark {
  color: #1d4ed8;
}
.zm-rich-edit {
  width: 100%;
  min-height: 90px;
  margin: 0;
  padding: 4px 6px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 0.92em;
  line-height: 1.4;
  color: inherit;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid currentColor;
  border-radius: 3px;
  outline: none;
  resize: vertical;
  white-space: pre;
  box-sizing: border-box;
}
.zm-rich-edit:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}
.zm-rich-paragraph {
  white-space: pre-wrap;
  word-break: break-word;
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
.zm-collapse {
  /* Position the toggle on the "line-out" side of the node:
   *  - right-side node (n.side === 1) → button on the right edge
   *  - left-side node  (n.side === -1) → button on the left edge.
   * Border + icon colour come inline from the node's rainbow branch
   * hue (or grey when rainbow is off); the background is opaque
   * white so the button reads cleanly against any node fill. */
  right: -8px;
  top: 50%;
  width: 14px;
  height: 14px;
  background: #ffffff;
  border: 1.5px solid;
  transform: translateY(-50%);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
}
.zm-collapse.is-on-left {
  right: auto;
  left: -8px;
}
.zm-collapse:hover {
  transform: translateY(-50%) scale(1.15);
  background: #ffffff;
}
/* xmind-style collapsed child-count badge.  Sits on the line-out
 * side of the node (right edge for right-side nodes, left edge for
 * left-side), vertically centered.  Click to expand.  Background
 * colour is set inline from the node's rainbow branch hue. */
.zm-collapse-badge {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: calc(100% + 8px);
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 5px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  user-select: none;
  z-index: 2;
  transition: filter 0.1s;
}
.zm-collapse-badge.is-on-left {
  left: auto;
  right: calc(100% + 8px);
}
.zm-collapse-badge:hover {
  filter: brightness(0.9);
}

/* Has-image layout — switch the node from a row (text-only) to a
 * column (image on top, text below).  Keep both centered so the
 * box still looks like a chip. */
.zm-node.has-image {
  flex-direction: column;
  padding: 8px;
  gap: 6px;
  white-space: normal;
}
.zm-node-img {
  display: block;
  /* Sized by attributes; live-drag override sets style.width /
   * style.height directly.  pointer-events:none so the image
   * never eats a click that should select the node or enter
   * edit mode. */
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  object-fit: contain;
  border-radius: 4px;
}

/* Inline link / note icons that sit next to the node's text.
 * They inherit the node's text color and sit at 14×14 so they
 * match the text's optical weight.  pointer-events is re-enabled
 * on the icons because the parent .zm-text disables it. */
.zm-node-link,
.zm-node-note-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: currentColor;
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  text-decoration: none;
  opacity: 0.75;
  transition: opacity 0.1s, background 0.1s;
  /* Inherit pointer-events from the node (the parent .zm-text has
   * pointer-events: none; the icons need clicks). */
  pointer-events: auto;
}
.zm-node-link:hover,
.zm-node-note-btn:hover {
  opacity: 1;
  background: rgba(15, 23, 42, 0.08);
}
.zm-node-link svg,
.zm-node-note-btn svg {
  display: block;
}

/* Resize handle — small square in the bottom-right of the
 * selected image node.  Always 10×10 in screen space, regardless
 * of zoom (user expects a 10px grab target).  Cursor changes to
 * nwse-resize to telegraph the drag direction. */
.zm-img-resize-handle {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  background: #ffffff;
  border: 1.5px solid #3b82f6;
  border-radius: 2px;
  cursor: nwse-resize;
  z-index: 4;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
}
.zm-node.is-resizing {
  cursor: nwse-resize !important;
}

/* "Remove image" tiny × — sits a bit above the resize handle. */
.zm-img-remove-btn {
  position: absolute;
  right: -5px;
  bottom: 14px;
  width: 14px;
  height: 14px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #64748b;
  padding: 0;
  z-index: 4;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}
.zm-img-remove-btn:hover {
  background: #fee2e2;
  color: #b91c1c;
  border-color: #fca5a5;
}

/* Inline note editor removed in commit 0ec… — the note editor
 * now lives in the right-side drawer (NotePanel.vue).  Keep
 * the section header commented for archaeology. */

/* Debug overlay: draws a small "1./2./3." label on every node
 * showing its position in its parent's children array.  Hidden by
 * default — enable with `?debug=order` in the URL. */
.zm-order-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  color: #475569;
  background: #e2e8f0;
  border-radius: 3px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
  vertical-align: middle;
}
/* Canvas action FABs -- top-right preview toggle, top-left
 * outline view.  Always visible by default so the npm package
 * ships with a discoverable, ready-to-use UI.  Hidden when
 * the consumer passes hideCanvasActions.
 *
 * Styled to match the bottom toolbar (rounded pill, soft
 * shadow, monoline icon).  Position is relative to the
 * .zm-canvas wrapper (which is the offset parent) so the
 * buttons track the canvas regardless of panning / scaling.
 */
.zm-canvas-fab {
  position: absolute;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  color: #475569;
  cursor: pointer;
  z-index: 11;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity 0.18s ease, transform 0.18s ease, background 0.1s, color 0.1s;
}
.zm-canvas-fab.is-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.zm-canvas-fab:hover {
  background: #f1f5f9;
  color: #1e293b;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
}
.zm-canvas-fab:active {
  transform: scale(0.94);
}
.zm-canvas-fab-preview {
  top: 16px;
  right: 16px;
}
.zm-canvas-fab-outline {
  top: 16px;
  left: 16px;
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
  transition: opacity 0.18s ease, transform 0.18s ease;
}
/* In preview mode the toolbar is hidden by default and fades in
   on canvas hover.  We also nudge it down a bit so the entrance
   is a small slide, not a hard pop.  Pointer-events follow
   opacity so the invisible toolbar never intercepts clicks. */
.zm-toolbar.is-preview-only {
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(8px);
}
.zm-toolbar.is-preview-only.is-hovered {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
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
.zm-tb-btn img {
  /* The bundled SVGs use a hardcoded mid-grey fill.  Tint
   * them toward the active text color so the icon visibly
   * responds to the parent button's hover state. */
  filter: invert(20%) sepia(15%) saturate(500%) hue-rotate(180deg);
  transition: filter 0.1s;
}
.zm-tb-btn:hover img {
  filter: invert(15%) sepia(30%) saturate(800%) hue-rotate(180deg);
}
.zm-tb-btn.active {
  background: var(--zm-tb-active, #fff7ed);
  color: var(--zm-tb-active-fg, #c2410c);
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

/* ── Search highlight / dim ──────────────────────────
 * Matching nodes get an orange outline; the current match
 * gets a thicker, brighter outline.  Non-matching nodes
 * dim to 35% opacity so the eye is drawn to hits. */
.zm-node.is-search-hit {
  outline: 2px solid #f59e0b;
  outline-offset: 2px;
  z-index: 3;
}
.zm-node.is-search-current {
  outline: 3px solid #f97316;
  outline-offset: 3px;
  z-index: 4;
  box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.15);
}
.zm-node.is-search-dimmed {
  opacity: 0.35;
}

/* ── Markers ─────────────────────────────────────────
 * Small 14×14 icons sitting to the LEFT of the text label.
 * The container is a flex row so markers line up horizontally
 * with a 2px gap.  pointer-events: none so clicks fall
 * through to the node. */
.zm-node-markers {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  pointer-events: none;
}
.zm-node-marker {
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.zm-node-marker svg {
  display: block;
  width: 14px;
  height: 14px;
}

/* ── Tags ────────────────────────────────────────────
 * A row of small colored pills below the node title.
 * Each pill's bg/border/text color is set inline via
 * tagColor().  The row wraps if it overflows the node
 * width. */
.zm-node-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: center;
  margin-top: 3px;
  max-width: 100%;
  overflow: hidden;
}
.zm-node-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 1.4;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
}
</style>
