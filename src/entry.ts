import MindMap from './components/MindMap.vue'
import Outline from './components/Outline.vue'
import Drawer from './components/Drawer.vue'
import DataPanel from './components/DataPanel.vue'
import MarkdownPanel from './components/MarkdownPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import NotePanel from './components/NotePanel.vue'
import MindMapApp from './App.vue'
import type { App } from 'vue'
import type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, LineStyle, LayoutMode, BranchPalette, BranchPaletteId, RichContent } from './types'
import { uid, clone, findNode, findParent, removeNode, addChild, addSibling, markdownToMindMap, mindMapToMarkdown, markdownToRichMindMap, richBlockToMarkdown } from './tree'
import { MARKER_LIB, markerSvg, markerLabel, markerDef, tagColor } from './core/markers'
import type { MarkerGroup, MarkerDef } from './core/markers'

export type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, LineStyle, LayoutMode, BranchPalette, BranchPaletteId, RichContent, MarkerGroup, MarkerDef }
export { MindMap, Outline, Drawer, DataPanel, MarkdownPanel, SettingsPanel, NotePanel, MindMapApp }
export { uid, clone, findNode, findParent, removeNode, addChild, addSibling, markdownToMindMap, mindMapToMarkdown, markdownToRichMindMap, richBlockToMarkdown }
export { MARKER_LIB, markerSvg, markerLabel, markerDef, tagColor }

/** Package version, injected at build time from package.json. */
export const VERSION = __PKG_VERSION__

const plugin = {
  install(app: App) {
    app.component('FlowMindMap', MindMap)
    app.component('FlowMindMapOutline', Outline)
    app.component('FlowMindMapDrawer', Drawer)
    app.component('FlowMindMapDataPanel', DataPanel)
    app.component('FlowMindMapMarkdownPanel', MarkdownPanel)
    app.component('FlowMindMapSettingsPanel', SettingsPanel)
    app.component('FlowMindMapNotePanel', NotePanel)
    app.component('FlowMindMapApp', MindMapApp)
  },
}

export default plugin
