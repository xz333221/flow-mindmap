export interface MindMapNode {
  id: string
  text: string
  children: MindMapNode[]
  collapsed?: boolean
}

export interface MindMapOptions {
  data: MindMapNode
  readonly?: boolean
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
}

export interface MindMapExpose {
  addChild: (parentId: string) => void
  addSibling: (nodeId: string) => void
  removeNode: (nodeId: string) => void
  getData: () => MindMapNode
  setData: (data: MindMapNode) => void
  resetView: () => void
}
