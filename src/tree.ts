export function uid(): string {
  return 'n_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o))
}

export function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const r = findNode(c, id)
    if (r) return r
  }
  return null
}

export function findParent(root: MindMapNode, id: string, parent: MindMapNode | null = null): MindMapNode | null {
  if (root.id === id) return parent
  for (const c of root.children) {
    const r = findParent(c, id, root)
    if (r !== null) return r
  }
  return null
}

export function removeNode(root: MindMapNode, id: string): boolean {
  const idx = root.children.findIndex((c) => c.id === id)
  if (idx >= 0) {
    root.children.splice(idx, 1)
    return true
  }
  for (const c of root.children) {
    if (removeNode(c, id)) return true
  }
  return false
}

export function addChild(root: MindMapNode, parentId: string, text = '新节点'): MindMapNode | null {
  const p = findNode(root, parentId)
  if (!p) return null
  const node: MindMapNode = { id: uid(), text, children: [] }
  p.children.push(node)
  return node
}

export function addSibling(root: MindMapNode, nodeId: string, text = '新节点'): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const node: MindMapNode = { id: uid(), text, children: [] }
  parent.children.push(node)
  return node
}

export function countDescendants(n: MindMapNode): number {
  return n.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0)
}

import type { MindMapNode } from './types'
