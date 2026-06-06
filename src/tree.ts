import type { MindMapNode } from './types'

export function uid(): string {
  return 'n_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function clone<T>(o: T): T {
  // structuredClone throws on Vue's reactive Proxy wrappers, so always use JSON.
  // MindMapNode is a plain JSON shape (id, text, children[]) — no Date/Map/Set/undefined semantics we need to preserve.
  return JSON.parse(JSON.stringify(o)) as T
}

export function findNode(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const r = findNode(c, id)
    if (r) return r
  }
  return null
}

export function findParent(
  root: MindMapNode,
  id: string,
  parent: MindMapNode | null = null
): MindMapNode | null {
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

export function addChild(
  root: MindMapNode,
  parentId: string,
  text: string = DEFAULT_NEW_NODE_TEXT
): MindMapNode | null {
  const p = findNode(root, parentId)
  if (!p) return null
  const node: MindMapNode = { id: uid(), text, children: [] }
  p.children.push(node)
  return node
}

export function addSibling(
  root: MindMapNode,
  nodeId: string,
  text: string = DEFAULT_NEW_NODE_TEXT
): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const node: MindMapNode = { id: uid(), text, children: [] }
  parent.children.push(node)
  return node
}

/**
 * Insert a new sibling node BEFORE the given node (Shift+Enter in xmind).
 * Returns the new node, or null if the target is the root.
 */
export function addSiblingBefore(
  root: MindMapNode,
  nodeId: string,
  text: string = DEFAULT_NEW_NODE_TEXT
): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const idx = parent.children.findIndex((c) => c.id === nodeId)
  if (idx < 0) return null
  const node: MindMapNode = { id: uid(), text, children: [] }
  parent.children.splice(idx, 0, node)
  return node
}

/**
 * Deep-clone a node (with all its descendants) and insert the copy as a
 * sibling immediately after the original. New ids are generated so the
 * result is a real duplicate. Returns the new node, or null if the
 * target is the root.
 */
export function duplicateNode(root: MindMapNode, nodeId: string): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const idx = parent.children.findIndex((c) => c.id === nodeId)
  if (idx < 0) return null
  const orig = parent.children[idx]
  const copy = clone(orig)
  reassignIds(copy)
  parent.children.splice(idx + 1, 0, copy)
  return copy
}

function reassignIds(n: MindMapNode) {
  n.id = uid()
  for (const c of n.children) reassignIds(c)
}

export function countDescendants(n: MindMapNode): number {
  return n.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0)
}

export const DEFAULT_NEW_NODE_TEXT = '新节点'
