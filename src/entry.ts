import MindMap from './components/MindMap.vue'
import type { App } from 'vue'
import type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, LineStyle, LayoutMode, BranchPalette, BranchPaletteId, RichContent } from './types'
import { uid, clone, findNode, findParent, removeNode, addChild, addSibling, markdownToMindMap, mindMapToMarkdown, markdownToRichMindMap, richBlockToMarkdown } from './tree'

export type { MindMapNode, MindMapOptions, MindMapTheme, MindMapExpose, MindMapSettings, NodeStyle, LineStyle, LayoutMode, BranchPalette, BranchPaletteId, RichContent }
export { MindMap }
export { uid, clone, findNode, findParent, removeNode, addChild, addSibling, markdownToMindMap, mindMapToMarkdown, markdownToRichMindMap, richBlockToMarkdown }

const plugin = {
  install(app: App) {
    app.component('FlowMindMap', MindMap)
  },
}

export default plugin
