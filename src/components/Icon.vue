<script setup lang="ts">
import { computed } from 'vue'

defineProps<{
  name: string
  size?: number | string
  stroke?: number | string
}>()
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke ?? 1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- add: plus in circle -->
    <template v-if="name === 'add'">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </template>
    <!-- minus -->
    <template v-else-if="name === 'minus'">
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </template>
    <!-- delete: trash -->
    <template v-else-if="name === 'delete'">
      <polyline points="4 7 20 7" />
      <path d="M9 7 V5 a1 1 0 0 1 1 -1 h4 a1 1 0 0 1 1 1 V7" />
      <path d="M6 7 l1 12 a1 1 0 0 0 1 1 h8 a1 1 0 0 0 1 -1 l1 -12" />
      <line x1="10" y1="11" x2="10" y2="18" />
      <line x1="14" y1="11" x2="14" y2="18" />
    </template>
    <!-- edit: pencil -->
    <template v-else-if="name === 'edit'">
      <path d="M4 20 l4 -1 11 -11 -3 -3 -11 11 z" />
      <line x1="14" y1="6" x2="18" y2="10" />
    </template>
    <!-- collapse: chevron up/down (rotate via :transform) -->
    <template v-else-if="name === 'collapse'">
      <polyline points="6 9 12 15 18 9" />
    </template>
    <!-- expand: chevron right -->
    <template v-else-if="name === 'expand'">
      <polyline points="9 6 15 12 9 18" />
    </template>
    <!-- collapse-all: 4 diagonal arrows pointing INWARD to the
         center (4,4) (20,4) (20,20) (4,20) → (10,10) (14,10)
         (14,14) (10,14).  Reads as "compress all to center". -->
    <template v-else-if="name === 'collapse-all'">
      <line x1="4" y1="4" x2="10" y2="10" />
      <polyline points="6 10 10 10 10 6" />
      <line x1="20" y1="4" x2="14" y2="10" />
      <polyline points="14 6 14 10 18 10" />
      <line x1="20" y1="20" x2="14" y2="14" />
      <polyline points="14 18 14 14 18 14" />
      <line x1="4" y1="20" x2="10" y2="14" />
      <polyline points="6 14 10 14 10 18" />
    </template>
    <!-- expand-all: mirror of collapse-all — 4 diagonal arrows
         pointing OUTWARD from the center.  Reads as "expand to
         bounds". -->
    <template v-else-if="name === 'expand-all'">
      <line x1="10" y1="10" x2="4" y2="4" />
      <polyline points="4 6 4 4 6 4" />
      <line x1="14" y1="10" x2="20" y2="4" />
      <polyline points="20 6 20 4 18 4" />
      <line x1="14" y1="14" x2="20" y2="20" />
      <polyline points="20 18 20 20 18 20" />
      <line x1="10" y1="14" x2="4" y2="20" />
      <polyline points="4 18 4 20 6 20" />
    </template>
    <!-- expand-level-1: 1 root dot + 3 children dots (2-level tree,
         root centered at top, 3 children at the bottom row). -->
    <template v-else-if="name === 'expand-level-1'">
      <circle cx="12" cy="5" r="1.8" fill="currentColor" stroke="none" />
      <line x1="12" y1="7" x2="12" y2="11" />
      <line x1="12" y1="11" x2="5" y2="17" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="12" y1="11" x2="19" y2="17" />
      <circle cx="5" cy="19" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19" cy="19" r="1.8" fill="currentColor" stroke="none" />
    </template>
    <!-- expand-level-2: 1 root + 3 children + 3 grandchildren
         (3-level tree).  Lines fan out from each child to its
         single grandchild, giving a symmetric "tree" silhouette. -->
    <template v-else-if="name === 'expand-level-2'">
      <circle cx="12" cy="3" r="1.4" fill="currentColor" stroke="none" />
      <line x1="12" y1="4.5" x2="12" y2="7" />
      <line x1="12" y1="7" x2="5" y2="11" />
      <line x1="12" y1="7" x2="12" y2="11" />
      <line x1="12" y1="7" x2="19" y2="11" />
      <line x1="5" y1="11" x2="3" y2="16" />
      <line x1="5" y1="11" x2="7" y2="16" />
      <line x1="12" y1="11" x2="10" y2="16" />
      <line x1="12" y1="11" x2="14" y2="16" />
      <line x1="19" y1="11" x2="17" y2="16" />
      <line x1="19" y1="11" x2="21" y2="16" />
      <circle cx="5" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="3" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="7" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="14" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="21" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </template>
    <!-- zoom in -->
    <template v-else-if="name === 'zoom-in'">
      <circle cx="11" cy="11" r="7" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </template>
    <!-- zoom out -->
    <template v-else-if="name === 'zoom-out'">
      <circle cx="11" cy="11" r="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </template>
    <!-- reset: 4 corner brackets pointing inward — "fit to view"
         glyph: reads as "snap the canvas back into the frame". -->
    <template v-else-if="name === 'reset'">
      <polyline points="4 9 4 4 9 4" />
      <polyline points="15 4 20 4 20 9" />
      <polyline points="20 15 20 20 15 20" />
      <polyline points="9 20 4 20 4 15" />
    </template>
    <!-- database: classic cylinder — reads as “view data / data
                 source”.  Stroke-only; matches the other monoline
         icons. -->
    <template v-else-if="name === 'database'">
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6 V18 C5 19.4 8 20.5 12 20.5 C16 20.5 19 19.4 19 18 V6" />
      <path d="M5 12 C5 13.4 8 14.5 12 14.5 C16 14.5 19 13.4 19 12" />
    </template>
    <!-- settings: gear / cog — Lucide-style single-path gear with
         a center hole.  Reads as “settings / preferences” at any
         size and stays crisp at 13 px. -->
    <template v-else-if="name === 'settings'">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <!-- markdown: rounded rect with “M↓” — the standard Markdown
                 logo mark.  Clean and recognizable at small sizes. -->
    <template v-else-if="name === 'markdown'">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 15 V9 L9 12 L12 9 V15" />
      <path d="M15 15 V9 L18 12 V9 M15 12 L18 15" />
    </template>
    <!-- txt: a page with horizontal lines, reads as plain text.
         Slightly different from 'note' (no folded corner). -->
    <template v-else-if="name === 'txt'">
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </template>
    <!-- eye: open eye -- used for the canvas preview toggle button.
         Reads as "click to enter preview mode" (the eye is "open",
         i.e. seeing the canvas in full). -->
    <template v-else-if="name === 'eye'">
      <path d="M2 12 C4 6 8 3 12 3 C16 3 20 6 22 12 C20 18 16 21 12 21 C8 21 4 18 2 12 Z" />
      <circle cx="12" cy="12" r="3.2" />
    </template>
    <!-- eye-off: closed/slashed eye -- used for "exit preview"
         in the same button slot.  When the canvas is in preview
         mode, the button shows this icon to signal "click to go
         back to the editable view". -->
    <template v-else-if="name === 'eye-off'">
      <path d="M3 3 L21 21" />
      <path d="M10.5 6.2 C11 6.1 11.5 6 12 6 C16 6 19.5 8.5 21 12 C20.4 13.2 19.6 14.3 18.7 15.2" />
      <path d="M6.6 6.6 C4 8.2 2.7 10.2 2 12 C3 14.5 5.2 16.8 8 18.3 C9.2 19 10.6 19.4 12 19.4 C13.5 19.4 14.9 19 16.2 18.3" />
      <path d="M9.5 9.5 C9.1 10.2 9 11.1 9 12 C9 13.7 9.8 15.2 11 16.1" />
    </template>
    <!-- outline: document with a list -- the left-drawer trigger.
         Reads as "click to show the outline / sidebar view". -->
    <template v-else-if="name === 'outline'">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </template>
    <!-- mindmap logo: branched node -->    <!-- mindmap logo: branched node -->
    <template v-else-if="name === 'logo'">
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="4" cy="5" r="1.6" />
      <circle cx="20" cy="5" r="1.6" />
      <circle cx="4" cy="19" r="1.6" />
      <circle cx="20" cy="19" r="1.6" />
      <line x1="10.5" y1="10.8" x2="5.2" y2="6.4" />
      <line x1="13.5" y1="10.8" x2="18.8" y2="6.4" />
      <line x1="10.5" y1="13.2" x2="5.2" y2="17.6" />
      <line x1="13.5" y1="13.2" x2="18.8" y2="17.6" />
    </template>
    <!-- import: arrow down into tray -->
    <template v-else-if="name === 'import'">
      <path d="M12 4 V15" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M4 19 H20" />
    </template>
    <!-- export: arrow up out of tray -->
    <template v-else-if="name === 'export'">
      <path d="M12 15 V4" />
      <polyline points="7 9 12 4 17 9" />
      <path d="M4 19 H20" />
    </template>
    <!-- balance: two arrows pointing inward, suggesting even distribution -->
    <template v-else-if="name === 'balance'">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
      <polyline points="9 4 5 6 9 8" />
      <polyline points="15 4 19 6 15 8" />
      <polyline points="9 10 5 12 9 14" />
      <polyline points="15 10 19 12 15 14" />
      <polyline points="9 16 5 18 9 20" />
      <polyline points="15 16 19 18 15 20" />
    </template>
    <!-- mindmap: central node with 4 diagonal branches to outer
         nodes — classic radial / hub-and-spoke silhouette. -->
    <template v-else-if="name === 'mindmap'">
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <line x1="13.4" y1="10.6" x2="18.5" y2="5.5" />
      <line x1="13.4" y1="13.4" x2="18.5" y2="18.5" />
      <line x1="10.6" y1="10.6" x2="5.5" y2="5.5" />
      <line x1="10.6" y1="13.4" x2="5.5" y2="18.5" />
      <circle cx="19.5" cy="4.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="19.5" cy="19.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="4.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="19.5" r="1.8" fill="currentColor" stroke="none" />
    </template>
    <!-- tree: root on the left, 3 children on the right, joined
         with right-angled lines — clearly reads as "expand right". -->
    <template v-else-if="name === 'tree'">
      <circle cx="5" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="19" cy="19" r="2" fill="currentColor" stroke="none" />
      <line x1="7" y1="12" x2="12" y2="12" />
      <line x1="12" y1="12" x2="12" y2="5" />
      <line x1="12" y1="12" x2="12" y2="19" />
      <line x1="12" y1="5" x2="17" y2="5" />
      <line x1="12" y1="19" x2="17" y2="19" />
    </template>
    <!-- org: top-down hierarchy (1.html btnLayoutOrg) -->
    <template v-else-if="name === 'org'">
      <circle cx="12" cy="5" r="2" fill="currentColor" stroke="none" />
      <circle cx="6" cy="19" r="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="19" r="2" fill="currentColor" stroke="none" />
      <line x1="12" y1="7" x2="12" y2="13" />
      <line x1="6" y1="13" x2="18" y2="13" />
      <line x1="6" y1="13" x2="6" y2="17" />
      <line x1="12" y1="13" x2="12" y2="17" />
      <line x1="18" y1="13" x2="18" y2="17" />
    </template>
    <!-- image: rectangle + sun + mountain, picture glyph -->
    <template v-else-if="name === 'image'">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="1.6" />
      <polyline points="3 17 9 12 13 15 16 13 21 17" />
    </template>
    <!-- x: simple cross -->
    <template v-else-if="name === 'x'">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </template>
    <!-- link: chain link glyph -->
    <template v-else-if="name === 'link'">
      <path d="M10 13 a4 4 0 0 0 5.66 0 l3 -3 a4 4 0 1 0 -5.66 -5.66 l-1 1" />
      <path d="M14 11 a4 4 0 0 0 -5.66 0 l-3 3 a4 4 0 1 0 5.66 5.66 l1 -1" />
    </template>
    <!-- note: lined note / page -->
    <template v-else-if="name === 'note'">
      <path d="M6 4 h9 l3 3 v13 a1 1 0 0 1 -1 1 h-11 a1 1 0 0 1 -1 -1 v-15 a1 1 0 0 1 1 -1 z" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </template>
    <!-- search: magnifying glass -->
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </template>
    <!-- svg-export: document with angle brackets — reads as
         "export vector/SVG". -->
    <template v-else-if="name === 'svg-export'">
      <path d="M6 3 h8 l4 4 v14 a1 1 0 0 1 -1 1 h-11 a1 1 0 0 1 -1 -1 v-15 a1 1 0 0 1 1 -1 z" />
      <polyline points="14 3 14 7 18 7" />
      <polyline points="8 14 6 16 8 18" />
      <polyline points="14 14 16 16 14 18" />
    </template>
  </svg>
</template>
