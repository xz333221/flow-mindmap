export interface MindMapNode {
  id: string
  text: string
  children: MindMapNode[]
  collapsed?: boolean
  /**
   * Reserved for the layout algorithm — do not set or read from
   * your own code.  After a drag, MindMap writes the dragged
   * node's offset into the data tree so a subsequent layout with
   * `preservePositions: true` can keep the node where the user
   * put it.  Cleared on the next data-mutating action (add,
   * remove, edit, import) so unrelated re-layouts don't keep
   * stale overrides around.
   */
  _x?: number
  _y?: number
  /**
   * Optional embedded image shown above the node text.  The
   * image is stored as either a remote URL (preferred) or a
   * data: URL (fallback for local-file uploads); width/height
   * reflect the rendered size, which the user can resize via
   * a drag handle.  naturalW/naturalH preserve the source
   * aspect ratio so a resize keeps the original proportions.
   */
  image?: MindMapImage
  /**
   * Optional external link.  When set, the node renders a
   * small link icon next to its text; clicking the icon
   * navigates to `url` in a new tab.  No validation is
   * performed at write time — the rendering layer is
   * responsible for rejecting dangerous schemes (javascript:,
   * data:, …) before following the link.
   */
  link?: { url: string }
  /**
   * Optional free-form note.  When set, the node renders a
   * small note icon next to its text; clicking the icon
   * expands an inline textarea below the node for editing,
   * hovering the icon shows a tooltip preview.  An empty
   * `text` field is treated as "no note" by the UI.
   */
  note?: { text: string }
  /**
   * Optional rich body.  When set, the node renders the raw
   * markdown payload in a small framed block under the title
   * (code fences get monospace styling, lists get bullet
   * markers, tables get a mini grid, paragraphs get plain
   * text).  Produced by `markdownToRichMindMap` so a whole
   * markdown document can be previewed as a mindmap without
   * losing its body content.  The first line of `raw` is
   * still available as `text` so the node always has a
   * meaningful label.
   */
  richContent?: RichContent
  /**
   * Optional marker icons (priority, progress, flag, star, etc.).
   * Each entry is a marker id like 'priority-1', 'progress-50',
   * 'flag', 'star', 'smile', 'people', 'arrow'.  Rendered as
   * small 14px icons before the node text.  Order is preserved.
   */
  markers?: string[]
  /**
   * Optional text tags rendered as small colored pills below
   * the node title.  Each entry is a short label string; the
   * pill color is derived from a hash of the label text.
   */
  tags?: string[]
}

/**
 * A node body that came from a markdown block.  `raw` is the
 * original markdown source for the block (preserved verbatim so
 * `mindMapToMarkdown` can re-emit it byte-for-byte).  `kind`
 * tells the renderer which layout to use.
 */
export interface RichContent {
  kind: 'code' | 'list' | 'table' | 'paragraph'
  /** Original markdown source.  Always non-empty. */
  raw: string
  /**
   * Optional language tag for code blocks (the info string after
   * the opening fence).  `undefined` for non-code kinds.
   */
  lang?: string
}

export interface MindMapImage {
  /** Remote URL or data URL.  Always a string — never undefined. */
  src: string
  /** Source image intrinsic size, in px.  Used to lock aspect
   *  ratio during a user-driven resize. */
  naturalW: number
  naturalH: number
  /** Current rendered size, in px.  Drag handle writes to these
   *  fields.  Clamped to a sane range by the layout (≥24, ≤400). */
  width: number
  height: number
}

export interface MindMapOptions {
  data: MindMapNode
  theme?: MindMapTheme
}

export interface MindMapTheme {
  rootBg?: string
  rootText?: string
  branchBg?: string
  branchText?: string
  lineColor?: string
  bgColor?: string
  fontSize?: number
/** Stroke width of SVG connecting paths at the *parent-end* of the
   *  edge, in px.  Default 2.2. */
  lineWidthStart?: number
  /** Stroke width at the *child-end* of the edge, in px.  Default 0.8. */
  lineWidthEnd?: number
  /**
   * When true, each top-level branch gets its own color (root stays
   * neutral, every child[0] of root takes a different hue, and that
   * hue propagates down the subtree).  Default false.
   */
  rainbowBranch?: boolean
}

export type LineStyle = 'curve' | 'straight' | 'arc' | 'elbow' | 'rounded-elbow'
export type LayoutMode = 'mindmap' | 'tree' | 'org'
/** Where root-originated edges start on the root node.
 *  'edge' = left/right mid-edge (default, XMind classic),
 *  'center' = root node center — the line emerges from underneath
 *  the root box, covered by it.
 *  'proportional' = the exit point on the root edge is projected
 *  from the child's position (ray-cast), so children above the
 *  center exit from the upper part of the edge and vice versa. */
export type LineOrigin = 'edge' | 'center' | 'proportional'

/** Identifier for a branch palette — the id of a built-in (e.g.
 *  'default', 'classic', 'vivid', 'dev', 'mint') or a user-defined
 *  custom palette.  Strings rather than a string union so users
 *  can add their own ids without recompiling the type. */
export type BranchPaletteId = string

/**
 * A named 8-color palette cycled across top-level branches when
 * `rainbowBranch` is on.  Exposed in the public API so the library
 * consumer can register their own scheme (e.g. a corporate brand
 * palette) via `setBranchPalette` / `customPalettes`.
 */
export interface BranchPalette {
  id: BranchPaletteId
  name: string
  /** Hex colors cycled across top-level branches, in display order.
   *  When a palette has fewer than the number of branches, colors
   *  wrap around with modulo. */
  colors: string[]
}

export interface MindMapSettings {
  /** When the user adds a new node or finishes a drag, automatically
   *  snap the layout back to balanced mode.  Default false. */
  autoBalanceOnChange: boolean
  /** Stroke width of SVG edges at the parent end. */
  lineWidthStart: number
  /** Stroke width of SVG edges at the child end. */
  lineWidthEnd: number
  /** Color-cycle the top-level branches. */
  rainbowBranch: boolean
  /** Which named palette to use when rainbowBranch is on.  Built-in
   *  ids: 'default' | 'classic' | 'vivid' | 'dev' | 'mint'.  Any
   *  custom palette id in `customPalettes` is also valid.  Default
   *  'default'. */
  branchPaletteId: BranchPaletteId
  /** User-defined palettes.  The settings panel lets the user add,
   *  edit (via a textarea of hex codes), and delete entries.  The
   *  canvas treats these as first-class palettes alongside the
   *  built-ins.  Persisted by the host app. */
  customPalettes: BranchPalette[]
  /** Edge shape between parent and child.
   *  'curve' = S-shaped cubic bezier (XMind default),
   *  'straight' = direct diagonal line segment,
   *  'arc' = smooth rounded arc with semicircular caps (bubble look),
   *  'elbow' = orthogonal right-angle routing (org-chart style). */
  /** Line style for edges between NON-root nodes (i.e. level-1→
   *  level-2, level-2→level-3, …).  'rounded-elbow' = orthogonal
   *  routing with rounded corners (default, modern org-chart look). */
  lineStyle: LineStyle
  /** Line style for edges that originate FROM the root node.
   *  Default 'arc' — smooth rainbow arcs fanning out from the root. */
  rootLineStyle: LineStyle
  /** Where root-originated edges start. 'edge' (default) = the
   *  left/right mid-edge of the root node; 'center' = the root
   *  node's geometric center — the line is drawn from the center
   *  but visually covered by the root box, so it appears to emerge
   *  from underneath the root; 'proportional' = the exit point is
   *  projected from the child's position so each child exits the
   *  root at the closest edge point (fan / ray-cast). */
  lineOrigin: LineOrigin
  /** Layout mode (1.html parity).  'mindmap' = center + left/right
   *  fans; 'tree' = single column expanding to the right; 'org' =
   *  downward hierarchy.  Default 'mindmap'. */
  layoutMode: LayoutMode
  /** When true (default), each edge tapers independently — its
   *  parent-end width comes from the parent node's tier and its
   *  child-end width comes from `lineWidthEnd`.  Visually you get
   *  discrete ribbons where the parent side of a level-2 edge can
   *  be thicker than the child side of a level-1 edge.
   *  When false, the whole tree forms a single tapered band:
   *  every edge's parent end = the previous edge's child end, so
   *  widths interpolate continuously from root to leaves. */
  taperedEdge: boolean
  /** When true, every node shows a small badge with its zero-based
   *  position in its parent's children array ("1.", "2.", "3.").
   *  Default false — useful when verifying the data-tree order
   *  against the visual layout. */
  showOrderBadge: boolean
  /** Canvas background colour.  Falls back to theme.bgColor when
   *  undefined.  Set via the settings panel. */
  canvasBg?: string
}

export interface NodeStyle {
  bg?: string
  textColor?: string
  borderColor?: string
  fontWeight?: number
  fontSize?: number
}

export interface MindMapExpose {
  addChild: (parentId: string) => void
  addSibling: (nodeId: string) => void
  removeNode: (nodeId: string) => void
  duplicateNode: (nodeId: string) => void
  /** Set a node's text (no-op if unchanged).  Used by the outline
   *  panel's inline edit; the canvas has its own dblclick → input
   *  flow. */
  setNodeText: (nodeId: string, text: string) => void
  /** Move a node to a new location.  `position` is relative to
   *  `targetId`: 'before' / 'after' insert as siblings, 'child'
   *  makes it the last child of target.  Used by the outline panel's
   *  drag-and-drop.  Returns true on success, false (no-op) if the
   *  move would create a cycle or hit another invalid case. */
  moveNode: (srcId: string, targetId: string, position: 'before' | 'after' | 'child') => boolean
  getData: () => MindMapNode
  /** Does this node carry any of the drawer-editable extras
   *  (note / link / image / rich body)?  Plain text nodes return
   *  false.  Hosts use this to gate the right-side inspector so
   *  it only opens for nodes with something to edit. */
  nodeHasContent: (id: string) => boolean
  /** Currently selected node ids (empty when nothing is selected).
   *  The first id is the "primary" — toolbar buttons (add child /
   *  sibling, image controls) act on it. */
  getSelectedIds: () => string[]
  /** Copy the given subtrees into the canvas's clipboard buffer.
   *  No-op if any id is the root. */
  copyNodes: (ids: string[]) => void
  /** Cut the given subtrees (copy + remove from tree, immediately).
   *  No-op if any id is the root. */
  cutNodes: (ids: string[]) => void
  /** Paste the clipboard buffer under `targetId` (or root when null).
   *  No-op when the buffer is empty. */
  pasteNodes: (targetId: string | null) => void
  setData: (data: MindMapNode) => void
  resetView: () => void
  exportData: () => string
  importData: (json: string) => boolean
  /** Serialize the current data tree as markdown. */
  getMarkdown: () => string
  /** Replace the data tree with the result of parsing `md`.  The
   *  `emitMarkdownChange` flag (default true) controls whether the
   *  change is also echoed via `markdownChange` — set false to
   *  avoid feedback loops when the host just wrote back the
   *  value the component emitted. */
  setMarkdown: (md: string, emitMarkdownChange?: boolean) => void
  setBalanced: (value: boolean) => void
  isBalanced: () => boolean
  balance: () => void
  /** Apply or update the per-node style override (empty object clears it). */
  applyNodeStyle: (nodeId: string, style: NodeStyle) => void
  /** Read the current per-node style override. */
  getNodeStyle: (nodeId: string) => NodeStyle
  /** Set a node's external link.  Pass an empty string to clear. */
  applyNodeLink: (nodeId: string, url: string) => void
  /** Remove a node's link (no-op if absent). */
  removeNodeLink: (nodeId: string) => void
  /** Set a node's note text.  Pass an empty string to clear. */
  applyNodeNote: (nodeId: string, text: string) => void
  /** Remove a node's note (no-op if absent). */
  removeNodeNote: (nodeId: string) => void
  /** Set a node's image from a URL or data: URI.  Fetches the
   *  asset to read its natural dimensions; clamps to IMG_MAX_W
   *  with a preserved aspect ratio.  Empty string removes the
   *  image. */
  applyNodeImageByUrl: (nodeId: string, url: string) => void
  /** Set a node's image from a fully-resolved MindMapImage.
   *  Used by the file-picker flow (readImageFile) and the drag
   *  resize handle.  Prefer `applyNodeImageByUrl` from the
   *  panel — it fetches the natural dimensions for you. */
  applyNodeImage: (nodeId: string, image: MindMapImage) => void
  /** Remove a node's image (no-op if absent). */
  removeNodeImage: (nodeId: string) => void
  /** Set a node's rich body (code block or table).  Pass `null`
   *  to remove the body.  The renderer reads `kind` to decide
   *  which preview layout to use. */
  applyNodeRichContent: (
    nodeId: string,
    content: { kind: 'code' | 'table'; raw: string; lang?: string } | null
  ) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  /** Apply a partial settings object — keys you omit are left as-is. */
  applySettings: (s: Partial<MindMapSettings>) => void
  /** Read the current effective settings. */
  getSettings: () => MindMapSettings
  /** Set the active branch palette by id.  The id may be a built-in
   *  ('default' / 'classic' / 'vivid' / 'dev' / 'mint') or a custom
   *  palette id from `customPalettes`.  No-op if the id is unknown. */
  setBranchPalette: (id: BranchPaletteId) => void
  /** Read the active palette id. */
  getBranchPalette: () => BranchPaletteId
  /** Read every palette the canvas knows about — built-ins first,
   *  then the user's custom palettes.  Useful for the host app to
   *  render a picker. */
  getBranchPalettes: () => BranchPalette[]
  /** Stroke width used for the parent end of an edge that starts at
   *  a node of the given depth. Lets the canvas taper sharply
   *  (root → 1st → 2nd → 3rd+) instead of using a single global
   *  width. */
  lineWidthForDepth: (depth: number) => number
  /** Stroke width used for the child end of an edge that ends at
   *  a node of the given depth. */
  endWidthForDepth: (depth: number) => number
  /** Add a marker to a node (no-op if already present).  Marker
   *  ids follow the convention 'priority-1' … 'priority-9',
   *  'progress-0' / 'progress-25' / 'progress-50' / 'progress-75'
   *  / 'progress-100', 'flag', 'star', 'smile', 'people',
   *  'arrow-up' / 'arrow-down' / 'arrow-left' / 'arrow-right'. */
  addNodeMarker: (nodeId: string, marker: string) => void
  /** Remove a specific marker from a node. */
  removeNodeMarker: (nodeId: string, marker: string) => void
  /** Toggle a marker on/off.  Returns true if the marker is now
   *  present, false if it was removed. */
  toggleNodeMarker: (nodeId: string, marker: string) => boolean
  /** Read the markers on a node (empty array when none). */
  getNodeMarkers: (nodeId: string) => string[]
  /** Set the tags on a node.  Pass an empty array to clear. */
  setNodeTags: (nodeId: string, tags: string[]) => void
  /** Read the tags on a node (empty array when none). */
  getNodeTags: (nodeId: string) => string[]
  /** Export the current canvas as a PNG image and trigger a
   *  download.  `scale` (default 2) controls the pixel density. */
  exportPNG: (scale?: number) => void
  /** Export the current canvas as an SVG file and trigger a
   *  download. */
  exportSVG: () => void
  /** Search the data tree for nodes whose text or note contains
   *  the query (case-insensitive).  Returns an array of matching
   *  node ids in tree-walk order.  Automatically expands any
   *  collapsed ancestors so matches are visible.  Does NOT
   *  modify the data tree. */
  searchNodes: (query: string) => string[]
  /** Read-only snapshot of the current search result node ids.
   *  Empty when no search is active.  Useful for external UIs
   *  (e.g. outline panel) to highlight matches. */
  getSearchResults: () => string[]
  /** The zero-based index of the currently focused search match,
   *  or -1 when no match is focused. */
  getSearchIndex: () => number
}
