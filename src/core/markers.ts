/**
 * Marker library — defines the visual icon for each marker id.
 *
 * Markers are rendered as 14×14 SVG icons that sit to the LEFT of
 * the node text.  Each entry in `MARKER_LIB` maps a category to a
 * list of markers, each with an id, a human-readable label, and
 * an inline SVG string (the inner markup of a 24×24 viewBox).
 *
 * The renderer (MindMap.vue) uses `markerSvg(id)` to look up the
 * icon markup; the context menu (NodeContextMenu.vue) iterates
 * `MARKER_LIB` to build the picker grid.
 */

export interface MarkerDef {
  /** Stable id stored on the data tree, e.g. 'priority-1'. */
  id: string
  /** Human-readable label shown in the picker tooltip. */
  label: string
  /**
   * Inner SVG markup for a 24×24 viewBox.  The outer <svg> wrapper
   * is added by the renderer.  Use `fill` / `stroke` attributes
   * directly so the icon is self-contained.
   */
  svg: string
}

export interface MarkerGroup {
  /** Group label shown as a section header in the picker. */
  label: string
  markers: MarkerDef[]
}

// ── Priority (1-9) — filled circles with the number inside ──
const PRIORITY_COLORS: Record<number, string> = {
  1: '#ef4444', // red
  2: '#f97316', // orange
  3: '#f59e0b', // amber
  4: '#eab308', // yellow
  5: '#84cc16', // lime
  6: '#22c55e', // green
  7: '#14b8a6', // teal
  8: '#3b82f6', // blue
  9: '#6366f1', // indigo
}

const priorityGroup: MarkerGroup = {
  label: '优先级',
  markers: Array.from({ length: 9 }, (_, i) => {
    const n = i + 1
    const color = PRIORITY_COLORS[n]
    return {
      id: `priority-${n}`,
      label: `优先级 ${n}`,
      svg: `<circle cx="12" cy="12" r="10" fill="${color}"/><text x="12" y="16" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="sans-serif">${n}</text>`,
    }
  }),
}

// ── Progress (0/25/50/75/100 %) — pie-chart style ──
function progressSvg(pct: number): string {
  if (pct === 0) {
    return `<circle cx="12" cy="12" r="10" fill="none" stroke="#94a3b8" stroke-width="2"/>`
  }
  if (pct === 100) {
    return `<circle cx="12" cy="12" r="10" fill="#22c55e"/>`
  }
  // Pie slice: angle = pct/100 * 360 degrees
  const angle = (pct / 100) * 2 * Math.PI
  const x = 12 + 10 * Math.sin(angle)
  const y = 12 - 10 * Math.cos(angle)
  const largeArc = pct > 50 ? 1 : 0
  return `<circle cx="12" cy="12" r="10" fill="none" stroke="#e2e8f0" stroke-width="2"/>` +
    `<path d="M 12 12 L 12 2 A 10 10 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z" fill="#3b82f6"/>` +
    `<circle cx="12" cy="12" r="10" fill="none" stroke="#cbd5e1" stroke-width="1"/>`
}

const progressGroup: MarkerGroup = {
  label: '进度',
  markers: [0, 25, 50, 75, 100].map((pct) => ({
    id: `progress-${pct}`,
    label: `进度 ${pct}%`,
    svg: progressSvg(pct),
  })),
}

// ── Flags — colored flag icons ──
const flagColors: { id: string; label: string; color: string }[] = [
  { id: 'flag-red', label: '红旗', color: '#ef4444' },
  { id: 'flag-orange', label: '橙旗', color: '#f97316' },
  { id: 'flag-yellow', label: '黄旗', color: '#eab308' },
  { id: 'flag-green', label: '绿旗', color: '#22c55e' },
  { id: 'flag-blue', label: '蓝旗', color: '#3b82f6' },
  { id: 'flag-gray', label: '灰旗', color: '#94a3b8' },
]

const flagGroup: MarkerGroup = {
  label: '旗帜',
  markers: flagColors.map((f) => ({
    id: f.id,
    label: f.label,
    svg: `<path d="M6 3 V21" stroke="#475569" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M6 4 H18 L15 7 L18 10 H6 Z" fill="${f.color}" stroke="${f.color}" stroke-width="1" stroke-linejoin="round"/>`,
  })),
}

// ── Stars — filled / half / empty ──
const starGroup: MarkerGroup = {
  label: '星标',
  markers: [
    {
      id: 'star',
      label: '星标',
      svg: `<path d="M12 2 L14.5 8.5 L21 9 L16 13.5 L17.5 20 L12 16.5 L6.5 20 L8 13.5 L3 9 L9.5 8.5 Z" fill="#f59e0b" stroke="#f59e0b" stroke-width="1" stroke-linejoin="round"/>`,
    },
    {
      id: 'star-half',
      label: '半星',
      svg: `<path d="M12 2 L14.5 8.5 L21 9 L16 13.5 L17.5 20 L12 16.5 L6.5 20 L8 13.5 L3 9 L9.5 8.5 Z" fill="#e2e8f0" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/>` +
        `<path d="M12 2 L12 16.5 L6.5 20 L8 13.5 L3 9 L9.5 8.5 Z" fill="#f59e0b" stroke="none"/>`,
    },
  ],
}

// ── Smiley / people / arrows / other ──
const miscGroup: MarkerGroup = {
  label: '其他',
  markers: [
    {
      id: 'smile',
      label: '微笑',
      svg: `<circle cx="12" cy="12" r="10" fill="#fef3c7" stroke="#f59e0b" stroke-width="1.5"/>` +
        `<circle cx="9" cy="10" r="1.2" fill="#92400e"/>` +
        `<circle cx="15" cy="10" r="1.2" fill="#92400e"/>` +
        `<path d="M8 14 Q12 17 16 14" stroke="#92400e" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    },
    {
      id: 'people',
      label: '人员',
      svg: `<circle cx="9" cy="8" r="2.5" fill="#3b82f6"/>` +
        `<circle cx="16" cy="8" r="2.5" fill="#3b82f6"/>` +
        `<path d="M4 19 C4 15 6 13 9 13 C12 13 14 15 14 19" fill="#3b82f6"/>` +
        `<path d="M14 19 C14 15.5 15.5 13.5 17.5 13.5 C19.5 13.5 21 15.5 21 19" fill="#3b82f6"/>`,
    },
    {
      id: 'arrow-up',
      label: '上箭头',
      svg: `<circle cx="12" cy="12" r="10" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>` +
        `<path d="M12 17 V7 M8 11 L12 7 L16 11" stroke="#3b82f6" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
      id: 'arrow-down',
      label: '下箭头',
      svg: `<circle cx="12" cy="12" r="10" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>` +
        `<path d="M12 7 V17 M8 13 L12 17 L16 13" stroke="#3b82f6" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
      id: 'arrow-right',
      label: '右箭头',
      svg: `<circle cx="12" cy="12" r="10" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>` +
        `<path d="M7 12 H17 M13 8 L17 12 L13 16" stroke="#3b82f6" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    {
      id: 'arrow-left',
      label: '左箭头',
      svg: `<circle cx="12" cy="12" r="10" fill="#dbeafe" stroke="#3b82f6" stroke-width="1.5"/>` +
        `<path d="M17 12 H7 M11 8 L7 12 L11 16" stroke="#3b82f6" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
  ],
}

export const MARKER_LIB: MarkerGroup[] = [
  priorityGroup,
  progressGroup,
  flagGroup,
  starGroup,
  miscGroup,
]

// Flat lookup map for O(1) access by id
const MARKER_MAP: Record<string, MarkerDef> = {}
for (const g of MARKER_LIB) {
  for (const m of g.markers) {
    MARKER_MAP[m.id] = m
  }
}

/** Look up a marker definition by id.  Returns undefined if the
 *  id is not in the library. */
export function markerDef(id: string): MarkerDef | undefined {
  return MARKER_MAP[id]
}

/** Get the inner SVG markup for a marker id.  Returns an empty
 *  string for unknown ids so the renderer can safely inline it. */
export function markerSvg(id: string): string {
  return MARKER_MAP[id]?.svg ?? ''
}

/** Get the label for a marker id. */
export function markerLabel(id: string): string {
  return MARKER_MAP[id]?.label ?? id
}

/** Derive a stable color from a tag string for tag pill rendering.
 *  Uses a simple hash → HSL so the same tag always gets the same
 *  color, and different tags get visually distinct hues.
 *  Returns an object with keys that are valid Vue `:style` / CSS
 *  property names so the result can be spread directly into a
 *  style binding. */
export function tagColor(tag: string): { background: string; borderColor: string; color: string } {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = (hash << 5) - hash + tag.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return {
    background: `hsl(${hue}, 85%, 92%)`,
    borderColor: `hsl(${hue}, 60%, 70%)`,
    color: `hsl(${hue}, 55%, 30%)`,
  }
}
