<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { MindMapSettings, LineStyle, LineOrigin, BranchPalette, NodeStyle } from '../types'
import { BUILTIN_PALETTES, parsePaletteInput } from '../core/palettes'

const props = defineProps<{
  settings: MindMapSettings
  /** true when a node is selected — the per-node panel is shown too. */
  hasSelection: boolean
  selectedNodeText?: string
  /** Current per-node style, read from the canvas so the panel
   *  reflects the live state (immediate-apply model). */
  nodeStyle?: NodeStyle
}>()

const emit = defineEmits<{
  (e: 'update:settings', s: Partial<MindMapSettings>): void
  (e: 'update:nodeStyle', s: Partial<NodeStyle>): void
  (e: 'reset'): void
}>()

function set<K extends keyof MindMapSettings>(key: K, value: MindMapSettings[K]) {
  emit('update:settings', { [key]: value })
}

/** Line style picker options. The icon shows the line shape; the
 *  label is the Chinese name. */
const LINE_STYLE_OPTIONS: { value: LineStyle; label: string; viewBox: string }[] = [
  { value: 'arc', label: '圆弧', viewBox: '0 0 28 14' },
  { value: 'rounded-elbow', label: '圆角折线', viewBox: '0 0 28 14' },
  { value: 'elbow', label: '折线', viewBox: '0 0 28 14' },
  { value: 'straight', label: '直线', viewBox: '0 0 28 14' },
  { value: 'curve', label: 'S曲线', viewBox: '0 0 28 14' },
]

/** Root line style picker — same options as LINE_STYLE_OPTIONS. */
const ROOT_LINE_STYLE_OPTIONS = LINE_STYLE_OPTIONS

/** Line origin picker options. 'edge' = the root's left/right
 *  mid-edge (default), 'center' = the root's geometric center
 *  (line is covered by the root box), 'proportional' = the exit
 *  point is projected from the child's position (fan / ray-cast). */
const LINE_ORIGIN_OPTIONS: { value: LineOrigin; label: string }[] = [
  { value: 'edge', label: '左右中点' },
  { value: 'center', label: '节点正中心' },
  { value: 'proportional', label: '按比例计算' },
]

// Font weight options for the per-node select.
const FONT_WEIGHT_OPTIONS = [
  { value: 100, label: '100' },
  { value: 200, label: '200' },
  { value: 300, label: '300' },
  { value: 400, label: '400 (常规)' },
  { value: 500, label: '500' },
  { value: 600, label: '600 (半粗)' },
  { value: 700, label: '700 (粗体)' },
  { value: 800, label: '800' },
  { value: 900, label: '900' },
]

/** Immediate-apply: emit the style delta right away so the canvas
 *  updates without a separate "apply" button.  Pass `undefined` to
 *  clear a field. */
function applyNodeStyleDelta(delta: Partial<NodeStyle>) {
  emit('update:nodeStyle', delta)
}

// =====================================================================
// Palette picker — now a dropdown <select>
// =====================================================================

const allPalettes = computed<BranchPalette[]>(() => [
  ...BUILTIN_PALETTES,
  ...props.settings.customPalettes,
])

// Custom palette draft management (same as before — textarea for
// editing hex codes, save commits).
const customDrafts = reactive<Record<string, string>>({})

function draftFor(p: BranchPalette): string {
  if (customDrafts[p.id] === undefined) {
    customDrafts[p.id] = p.colors.join('\n')
  }
  return customDrafts[p.id]
}

function commitCustomPalette(p: BranchPalette) {
  const draft = customDrafts[p.id] ?? ''
  const colors = parsePaletteInput(draft)
  if (colors.length === 0) {
    customDrafts[p.id] = p.colors.join('\n')
    return
  }
  const next = props.settings.customPalettes.map((q) =>
    q.id === p.id ? { ...q, colors } : q
  )
  emit('update:settings', { customPalettes: next })
}

function addCustomPalette() {
  const active = allPalettes.value.find(
    (p) => p.id === props.settings.branchPaletteId
  )
  const seed = active ? [...active.colors] : [...BUILTIN_PALETTES[0].colors]
  const baseId = 'custom-'
  let id = baseId + (props.settings.customPalettes.length + 1)
  while (
    BUILTIN_PALETTES.some((p) => p.id === id) ||
    props.settings.customPalettes.some((p) => p.id === id)
  ) {
    id = baseId + Math.random().toString(36).slice(2, 7)
  }
  const palette: BranchPalette = {
    id,
    name: `我的配色 ${props.settings.customPalettes.length + 1}`,
    colors: seed,
  }
  emit('update:settings', {
    customPalettes: [...props.settings.customPalettes, palette],
    branchPaletteId: id,
  })
  customDrafts[id] = seed.join('\n')
}

function deleteCustomPalette(p: BranchPalette) {
  const next = props.settings.customPalettes.filter((q) => q.id !== p.id)
  const active = props.settings.branchPaletteId === p.id
    ? 'default'
    : props.settings.branchPaletteId
  emit('update:settings', {
    customPalettes: next,
    ...(active !== props.settings.branchPaletteId ? { branchPaletteId: active } : {}),
  })
  delete customDrafts[p.id]
}

// Swatch palette for node bg/text color buttons
const PALETTE = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#818cf8', '#c084fc', '#1e2937', '#f8fafc', '#94a3b8']

// Canvas background color presets
const CANVAS_BG_PRESETS = ['#f8fafc', '#ffffff', '#e2e8f0', '#1e2937', '#0f172a', '#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#f1f5f9']

/** Build a tiny 4-line preview that mirrors the canvas taper. */
const PREVIEW_DEPTHS = [0, 1, 2, 3] as const
const PREVIEW_PALETTE = ['#f87171', '#fb923c', '#34d399', '#818cf8']
function widthAt(depth: number, total: number, start: number, end: number): number {
  if (total <= 1) return start
  const t = depth / (total - 1)
  return start + (end - start) * t
}
function taperedParentW(depth: number, start: number, end: number, taper: number): number {
  const w = start * Math.pow(taper, depth)
  return Math.max(end, w)
}
const previewLines = computed(() => {
  const start = props.settings.lineWidthStart
  const end = props.settings.lineWidthEnd
  const tapered = props.settings.taperedEdge
  const total = PREVIEW_DEPTHS.length
  const left = 8
  const right = 192
  const active = allPalettes.value.find(
    (p) => p.id === props.settings.branchPaletteId
  )
  const colors = active && active.colors.length
    ? active.colors
    : PREVIEW_PALETTE
  return PREVIEW_DEPTHS.map((d, i) => {
    const y = 10 + (i * 60) / (total - 1)
    return {
      x1: left,
      y1: y,
      x2: right,
      y2: y,
      w: tapered ? taperedParentW(d, start, end, props.settings.lineWidthTaper) : widthAt(d, total, start, end),
      color: props.settings.rainbowBranch
        ? colors[i % colors.length]
        : '#94a3b8',
    }
  })
})
</script>

<template>
  <div class="zm-settings-panel">
    <!-- ============================================================
         CANVAS / GLOBAL settings
         ============================================================ -->
    <section class="zm-settings-section">
      <h4 class="zm-settings-section-title">画布</h4>

      <!-- Canvas background color -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">画布背景色</span>
        <div class="zm-settings-control">
          <label class="zm-color-input-wrap">
            <input
              type="color"
              class="zm-color-input"
              :value="settings.canvasBg || '#f8fafc'"
              @input="(e) => set('canvasBg', (e.target as HTMLInputElement).value)"
            />
            <span class="zm-color-input-text">{{ settings.canvasBg || '默认' }}</span>
          </label>
        </div>
      </div>
      <div class="zm-swatch-row zm-swatch-row--compact">
        <button
          v-for="c in CANVAS_BG_PRESETS"
          :key="'cbg-' + c"
          class="zm-swatch"
          :class="{ 'is-active': (settings.canvasBg || '#f8fafc') === c }"
          :style="{ background: c }"
          :title="c"
          @click="set('canvasBg', c)"
        />
        <button
          class="zm-swatch is-reset"
          title="恢复默认"
          @click="set('canvasBg', undefined)"
        >∅</button>
      </div>

      <div class="zm-settings-divider" />

      <!-- Line width start (root) -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">线条粗端 (根部)</span>
        <input
          class="zm-settings-number"
          type="number"
          step="0.2"
          :value="settings.lineWidthStart"
          @change="(e) => set('lineWidthStart', parseFloat((e.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="zm-slider">
        <div class="zm-slider-track" />
        <input
          type="range"
          min="0.4"
          max="20"
          step="0.2"
          :value="settings.lineWidthStart"
          @input="(e) => set('lineWidthStart', parseFloat((e.target as HTMLInputElement).value))"
        />
      </div>

      <!-- Line width end (leaf) -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">线条细端 (子端)</span>
        <input
          class="zm-settings-number"
          type="number"
          step="0.2"
          :value="settings.lineWidthEnd"
          @change="(e) => set('lineWidthEnd', parseFloat((e.target as HTMLInputElement).value) || 0)"
        />
      </div>
      <div class="zm-slider">
        <div class="zm-slider-track" />
        <input
          type="range"
min="0.1"
max="6"
step="0.1"
:value="settings.lineWidthEnd"
          @input="(e) => set('lineWidthEnd', parseFloat((e.target as HTMLInputElement).value))"
        />
      </div>

      <div class="zm-settings-divider" />

      <!-- Root line style -->
      <div class="zm-settings-field zm-line-style-field">
        <span class="zm-settings-label">根节点线条</span>
        <div class="zm-line-style-group">
          <button
            v-for="opt in ROOT_LINE_STYLE_OPTIONS"
            :key="opt.value"
            class="zm-line-style-btn"
            :class="{ 'is-on': settings.rootLineStyle === opt.value }"
            :title="opt.label"
            @click="set('rootLineStyle', opt.value)"
          >
            <svg :viewBox="opt.viewBox" width="28" height="14" preserveAspectRatio="none">
              <path
                v-if="opt.value === 'arc'"
                d="M 0 12 Q 14 2, 28 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
              <path
                v-else-if="opt.value === 'rounded-elbow'"
                d="M 0 10 L 12 10 Q 16 10 16 6 L 16 4 L 28 4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                v-else-if="opt.value === 'elbow'"
                d="M 0 10 L 16 10 L 16 4 L 28 4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                v-else-if="opt.value === 'curve'"
                d="M 0 12 C 8 0, 20 0, 28 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
              <line
                v-else
                x1="0" y1="12" x2="28" y2="12"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
            </svg>
            <span class="zm-line-style-label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <!-- Line style (other nodes) -->
      <div class="zm-settings-field zm-line-style-field">
        <span class="zm-settings-label">非根节点线条</span>
        <div class="zm-line-style-group">
          <button
            v-for="opt in LINE_STYLE_OPTIONS"
            :key="opt.value"
            class="zm-line-style-btn"
            :class="{ 'is-on': settings.lineStyle === opt.value }"
            :title="opt.label"
            @click="set('lineStyle', opt.value)"
          >
            <svg :viewBox="opt.viewBox" width="28" height="14" preserveAspectRatio="none">
              <path
                v-if="opt.value === 'arc'"
                d="M 0 12 Q 14 2, 28 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
              <path
                v-else-if="opt.value === 'rounded-elbow'"
                d="M 0 10 L 12 10 Q 16 10 16 6 L 16 4 L 28 4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                v-else-if="opt.value === 'elbow'"
                d="M 0 10 L 16 10 L 16 4 L 28 4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                v-else-if="opt.value === 'curve'"
                d="M 0 12 C 8 0, 20 0, 28 12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
              <line
                v-else
                x1="0" y1="12" x2="28" y2="12"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
              />
            </svg>
            <span class="zm-line-style-label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <!-- Elbow corner radius (only when rounded-elbow is active) -->
      <div v-if="settings.lineStyle === 'rounded-elbow' || settings.rootLineStyle === 'rounded-elbow'" class="zm-settings-field">
        <span class="zm-settings-label">圆角大小 <span class="zm-settings-sub">{{ settings.elbowRadius }}px</span></span>
        <input
          class="zm-settings-number"
          type="number"
          step="1"
min="2"
max="40"
:value="settings.elbowRadius"
@change="(e) => set('elbowRadius', parseFloat((e.target as HTMLInputElement).value) || 20)"
        />
      </div>
      <div v-if="settings.lineStyle === 'rounded-elbow' || settings.rootLineStyle === 'rounded-elbow'" class="zm-slider">
        <div class="zm-slider-track" />
        <input
          type="range"
min="2"
max="40"
step="1"
:value="settings.elbowRadius"
          @input="(e) => set('elbowRadius', parseFloat((e.target as HTMLInputElement).value))"
        />
      </div>

      <!-- Line origin -->
      <div class="zm-settings-field zm-line-style-field">
        <span class="zm-settings-label">线条起点</span>
        <div class="zm-line-style-group">
          <button
            v-for="opt in LINE_ORIGIN_OPTIONS"
            :key="opt.value"
            class="zm-line-style-btn"
            :class="{ 'is-on': settings.lineOrigin === opt.value }"
            :title="opt.label"
            @click="set('lineOrigin', opt.value)"
          >
            <svg viewBox="0 0 28 18" width="28" height="18" preserveAspectRatio="none">
              <!-- Root node rectangle -->
              <rect x="8" y="6" width="12" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5" />
              <path
                v-if="opt.value === 'edge'"
                d="M 8 9 L 0 9 M 20 9 L 28 9"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
              <path
                v-else-if="opt.value === 'center'"
                d="M 14 9 L 0 9 M 14 9 L 28 9"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
              <path
                v-else
                d="M 8 7 L 0 4 M 8 9 L 0 9 M 8 11 L 0 14 M 20 7 L 28 4 M 20 9 L 28 9 M 20 11 L 28 14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            <span class="zm-line-style-label">{{ opt.label }}</span>
          </button>
        </div>
      </div>

      <!-- Rainbow branches -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">一级分支彩虹色</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.rainbowBranch }"
          @click="set('rainbowBranch', !settings.rainbowBranch)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </div>

      <!-- Palette picker -->
      <div v-if="settings.rainbowBranch" class="zm-palette-picker">
        <div class="zm-settings-field">
          <span class="zm-settings-label">配色方案</span>
        </div>
        <div class="zm-palette-list">
          <button
            v-for="p in allPalettes"
            :key="p.id"
            class="zm-palette-option"
            :class="{ 'is-active': settings.branchPaletteId === p.id }"
            @click="set('branchPaletteId', p.id)"
          >
            <span class="zm-palette-option-name">{{ p.name }}</span>
            <span class="zm-palette-option-swatches">
              <span
                v-for="(c, i) in p.colors"
                :key="i"
                class="zm-palette-option-swatch"
                :style="{ background: c }"
              />
            </span>
          </button>
        </div>

        <!-- Custom palette editor (only show when a custom palette is active) -->
        <div
          v-if="settings.customPalettes.find(p => p.id === settings.branchPaletteId)"
          class="zm-palette-custom-editor"
        >
          <textarea
            class="zm-palette-textarea"
            rows="3"
            spellcheck="false"
            placeholder="一行一个 hex,例如 #f87171"
            :value="draftFor(settings.customPalettes.find(p => p.id === settings.branchPaletteId)!)"
            @input="(e) => (customDrafts[settings.customPalettes.find(p => p.id === settings.branchPaletteId)!.id] = (e.target as HTMLTextAreaElement).value)"
          />
          <div class="zm-palette-custom-actions">
            <button
              type="button"
              class="zm-data-btn is-primary"
              @click="commitCustomPalette(settings.customPalettes.find(p => p.id === settings.branchPaletteId)!)"
            >保存</button>
            <button
              type="button"
              class="zm-data-btn"
              @click="deleteCustomPalette(settings.customPalettes.find(p => p.id === settings.branchPaletteId)!)"
            >删除</button>
          </div>
        </div>

        <button
          type="button"
          class="zm-palette-add"
          @click="addCustomPalette"
        >+ 新建配色</button>
      </div>

      <div class="zm-settings-divider" />

      <!-- Tapered edge -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">每条连线独立渐变</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.taperedEdge }"
          @click="set('taperedEdge', !settings.taperedEdge)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </div>

      <!-- Line width taper ratio (only relevant in tapered mode) -->
      <div v-if="settings.taperedEdge" class="zm-settings-field">
        <span class="zm-settings-label">层级衰减 <span class="zm-settings-sub">{{ Math.round(settings.lineWidthTaper * 100) }}%</span></span>
        <input
          class="zm-settings-number"
          type="number"
          step="0.05"
min="0.1"
max="1"
:value="settings.lineWidthTaper"
@change="(e) => set('lineWidthTaper', parseFloat((e.target as HTMLInputElement).value) || 0.67)"
        />
      </div>
      <div v-if="settings.taperedEdge" class="zm-slider">
        <div class="zm-slider-track" />
        <input
          type="range"
min="0.1"
max="1"
step="0.01"
:value="settings.lineWidthTaper"
          @input="(e) => set('lineWidthTaper', parseFloat((e.target as HTMLInputElement).value))"
        />
      </div>

      <!-- Uniform non-root line width (only relevant in tapered mode) -->
      <div v-if="settings.taperedEdge" class="zm-settings-field">
        <span class="zm-settings-label">非根节点相同粗细</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.uniformLineWidth }"
          @click="set('uniformLineWidth', !settings.uniformLineWidth)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </div>

      <!-- Order badge -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">显示节点序号</span>
        <button
          class="zm-toggle"
          :class="{ 'is-on': settings.showOrderBadge }"
          @click="set('showOrderBadge', !settings.showOrderBadge)"
        >
          <span class="zm-toggle-knob" />
        </button>
      </div>

      <!-- Preview -->
      <div class="zm-settings-preview">
        <svg viewBox="0 0 200 70" width="100%" height="70" preserveAspectRatio="none">
          <line
            v-for="(seg, i) in previewLines"
            :key="i"
            :x1="seg.x1" :y1="seg.y1" :x2="seg.x2" :y2="seg.y2"
            :stroke="settings.rainbowBranch ? seg.color : '#94a3b8'"
            :stroke-width="seg.w"
            stroke-linecap="butt"
          />
        </svg>
        <div class="zm-settings-preview-labels">
          <span>根</span>
          <span>1级</span>
          <span>2级</span>
          <span>3级</span>
        </div>
      </div>
    </section>

    <!-- ============================================================
         NODE-LEVEL overrides — only when a node is selected.
         Immediate-apply: every control emits on change.
         ============================================================ -->
    <section v-if="hasSelection" class="zm-settings-section">
      <h4 class="zm-settings-section-title">
        节点
        <span v-if="selectedNodeText" class="zm-settings-section-sub">"{{ selectedNodeText }}"</span>
      </h4>

      <!-- Background color -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">背景颜色</span>
        <span class="zm-settings-value-tag">{{ nodeStyle?.bg || '默认' }}</span>
      </div>
      <div class="zm-swatch-row">
        <button
          v-for="c in PALETTE"
          :key="'bg-' + c"
          class="zm-swatch"
          :class="{ 'is-active': nodeStyle?.bg === c }"
          :style="{ background: c }"
          :title="c"
          @click="applyNodeStyleDelta({ bg: c })"
        />
        <label class="zm-swatch zm-swatch--custom" title="自定义颜色">
          <input
            type="color"
            :value="nodeStyle?.bg || '#ffffff'"
            @input="(e) => applyNodeStyleDelta({ bg: (e.target as HTMLInputElement).value })"
          />
        </label>
        <button
          class="zm-swatch is-reset"
          title="清除"
          @click="applyNodeStyleDelta({ bg: undefined })"
        >∅</button>
      </div>

      <!-- Text color -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">文字颜色</span>
        <span class="zm-settings-value-tag">{{ nodeStyle?.textColor || '默认' }}</span>
      </div>
      <div class="zm-swatch-row">
        <button
          v-for="c in PALETTE"
          :key="'fg-' + c"
          class="zm-swatch"
          :class="{ 'is-active': nodeStyle?.textColor === c }"
          :style="{ background: c }"
          :title="c"
          @click="applyNodeStyleDelta({ textColor: c })"
        />
        <label class="zm-swatch zm-swatch--custom" title="自定义颜色">
          <input
            type="color"
            :value="nodeStyle?.textColor || '#1e2937'"
            @input="(e) => applyNodeStyleDelta({ textColor: (e.target as HTMLInputElement).value })"
          />
        </label>
        <button
          class="zm-swatch is-reset"
          title="清除"
          @click="applyNodeStyleDelta({ textColor: undefined })"
        >∅</button>
      </div>

      <div class="zm-settings-divider" />

      <!-- Font weight -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">字重</span>
        <select
          class="zm-select"
          :value="nodeStyle?.fontWeight ?? 400"
          @change="(e) => applyNodeStyleDelta({ fontWeight: parseInt((e.target as HTMLSelectElement).value) })"
        >
          <option v-for="opt in FONT_WEIGHT_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <!-- Font size -->
      <div class="zm-settings-field">
        <span class="zm-settings-label">文字大小</span>
        <input
          class="zm-settings-number"
          type="number"
          step="1"
          min="8"
          max="48"
          :value="nodeStyle?.fontSize ?? 14"
          @change="(e) => applyNodeStyleDelta({ fontSize: parseInt((e.target as HTMLInputElement).value) || 14 })"
        />
      </div>
      <div class="zm-slider">
        <div class="zm-slider-track" />
        <input
          type="range"
          min="8"
          max="48"
          step="1"
          :value="nodeStyle?.fontSize ?? 14"
          @input="(e) => applyNodeStyleDelta({ fontSize: parseInt((e.target as HTMLInputElement).value) })"
        />
      </div>

      <p class="zm-settings-hint">仅作用于当前节点,不影响子节点。</p>
    </section>

    <section class="zm-settings-section zm-settings-section--actions">
      <button class="zm-settings-reset" @click="emit('reset')">恢复默认设置</button>
    </section>
  </div>
</template>

<style scoped>
.zm-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 16px 24px;
}
.zm-settings-section {
  background: #ffffff;
  border: 1px solid #eef0f3;
  border-radius: 12px;
  padding: 16px;
}
.zm-settings-section--actions {
  background: transparent;
  border: none;
  padding: 0;
}
.zm-settings-section-title {
  margin: 0 0 14px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.01em;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.zm-settings-section-sub {
  font-size: 11px;
  font-weight: 500;
  color: #64748b;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Field row — label on left, control on right */
.zm-settings-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0;
  font-size: 13px;
  color: #1e293b;
  min-height: 32px;
}
.zm-settings-label {
  flex: 1;
  color: #334155;
  font-weight: 500;
}
.zm-settings-sub {
  font-size: 11px;
  color: #64748b;
  font-weight: 400;
  font-family: ui-monospace, monospace;
  margin-left: 4px;
}
.zm-settings-value-tag {
  font-size: 11px;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 2px 8px;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
}

/* Number input */
.zm-settings-number {
  font-size: 12px;
  color: #0f172a;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 5px 10px;
  width: 64px;
  text-align: right;
  -moz-appearance: textfield;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.zm-settings-number::-webkit-outer-spin-button,
.zm-settings-number::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.zm-settings-number:focus {
  outline: none;
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* Select dropdown */
.zm-select {
  font-size: 12px;
  font-family: inherit;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
  outline: none;
  transition: border-color 0.12s, box-shadow 0.12s;
  min-width: 100px;
}
.zm-select:focus,
.zm-select:hover {
  border-color: #3b82f6;
}
.zm-select:focus {
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* Hint text */
.zm-settings-hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.5;
}

/* Divider */
.zm-settings-divider {
  height: 1px;
  background: #f1f5f9;
  margin: 12px 0;
}

/* Slider — fixed track visibility */
.zm-slider {
  position: relative;
  height: 22px;
  display: flex;
  align-items: center;
  margin: 2px 0 6px;
}
.zm-slider-track {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 4px;
  background: #e2e8f0;
  border-radius: 999px;
  pointer-events: none;
}
.zm-slider input[type='range'] {
  position: relative;
  width: 100%;
  margin: 0;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  height: 22px;
  cursor: pointer;
  z-index: 1;
}
.zm-slider input[type='range']::-webkit-slider-runnable-track {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: transparent;
  border-radius: 999px;
}
.zm-slider input[type='range']::-moz-range-track {
  height: 4px;
  background: transparent;
  border-radius: 999px;
}
.zm-slider input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #3b82f6;
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.2);
  cursor: pointer;
  margin-top: -6px;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.zm-slider input[type='range']::-webkit-slider-thumb:hover {
  border-color: #2563eb;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}
.zm-slider input[type='range']::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  border: 2px solid #3b82f6;
  box-shadow: 0 1px 4px rgba(59, 130, 246, 0.2);
  cursor: pointer;
}

/* Toggle switch */
.zm-toggle {
  position: relative;
  width: 38px;
  height: 22px;
  border: none;
  background: #cbd5e1;
  border-radius: 999px;
  padding: 0;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.zm-toggle.is-on {
  background: #3b82f6;
}
.zm-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  transition: transform 0.15s;
}
.zm-toggle.is-on .zm-toggle-knob {
  transform: translateX(16px);
}

/* Color swatch row */
.zm-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 4px 0 10px;
}
.zm-swatch-row--compact {
  gap: 4px;
  margin-bottom: 6px;
}
.zm-swatch {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  border: 1.5px solid #e2e8f0;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: transform 0.1s, border-color 0.12s, box-shadow 0.12s;
}
.zm-swatch:hover {
  transform: scale(1.12);
  border-color: #94a3b8;
}
.zm-swatch.is-active {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}
.zm-swatch.is-reset {
  background: #ffffff;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.zm-swatch.is-reset:hover {
  color: #ef4444;
  border-color: #fca5a5;
}
.zm-swatch--custom {
  position: relative;
  overflow: hidden;
  background: conic-gradient(from 0deg, #f87171, #fbbf24, #34d399, #22d3ee, #818cf8, #c084fc, #f87171);
  border: 1.5px solid #e2e8f0;
}
.zm-swatch--custom input[type='color'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}

/* Color input wrap (for canvas bg) */
.zm-color-input-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.zm-color-input {
  width: 28px;
  height: 22px;
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  cursor: pointer;
  padding: 0;
  background: none;
}
.zm-color-input-text {
  font-size: 11px;
  color: #64748b;
  font-family: ui-monospace, monospace;
}

/* Line style buttons */
.zm-settings-field.zm-line-style-field {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.zm-line-style-field .zm-settings-label {
  flex: none;
}

.zm-line-style-group {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 4px;
  width: 100%;
}
.zm-line-style-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 4px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  color: #94a3b8;
  transition: all 0.12s;
  font-family: inherit;
}
.zm-line-style-btn:hover {
  border-color: #cbd5e1;
  color: #475569;
  background: #ffffff;
}
.zm-line-style-btn.is-on {
  border-color: #3b82f6;
  background: #eff6ff;
  color: #3b82f6;
}
.zm-line-style-label {
  font-size: 11px;
  font-weight: 500;
}

/* Preview */
.zm-settings-preview {
  margin-top: 12px;
  background: #f8fafc;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  padding: 10px 10px 8px;
}
.zm-settings-preview svg {
  display: block;
}
.zm-settings-preview-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #94a3b8;
  margin-top: 4px;
  padding: 0 2px;
}

/* Palette picker section */
.zm-palette-picker {
  margin: 8px 0;
  padding: 12px;
  background: #f8fafc;
  border-radius: 10px;
  border: 1px solid #eef0f3;
}
.zm-palette-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.zm-palette-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
  width: 100%;
}
.zm-palette-option:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}
.zm-palette-option.is-active {
  border-color: #3b82f6;
  background: #eff6ff;
  box-shadow: 0 0 0 1px #3b82f6;
}
.zm-palette-option-name {
  font-size: 12px;
  font-weight: 500;
  color: #1e293b;
  min-width: 36px;
  flex-shrink: 0;
}
.zm-palette-option-swatches {
  display: flex;
  gap: 2px;
  flex: 1;
  height: 14px;
  border-radius: 3px;
  overflow: hidden;
}
.zm-palette-option-swatch {
  flex: 1;
  min-width: 0;
  height: 100%;
}
.zm-palette-custom-editor {
  margin-top: 8px;
}
.zm-palette-textarea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #0f172a;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 7px 8px;
  resize: vertical;
  min-height: 36px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.1s, box-shadow 0.1s;
}
.zm-palette-textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.zm-palette-custom-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.zm-palette-add {
  margin-top: 8px;
  width: 100%;
  padding: 7px 8px;
  font-size: 12px;
  font-family: inherit;
  font-weight: 500;
  color: #3b82f6;
  background: #ffffff;
  border: 1px dashed #bfdbfe;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-palette-add:hover {
  background: #eff6ff;
  border-color: #3b82f6;
}

/* Buttons */
.zm-data-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: inherit;
  color: #475569;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-data-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
  border-color: #cbd5e1;
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
.zm-settings-reset {
  width: 100%;
  padding: 10px 12px;
  font-size: 12px;
  font-family: inherit;
  font-weight: 500;
  color: #64748b;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.1s;
}
.zm-settings-reset:hover {
  background: #fef2f2;
  color: #ef4444;
  border-color: #fecaca;
}
</style>
