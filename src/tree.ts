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

function defaultSiblingText(parent: MindMapNode): string {
  // Smart numbering: if the parent's existing children include plain
  // "新节点" or "新节点 N", the next new sibling is "新节点 (N+1)".
  // Renamed children are ignored, so this won't fight with custom
  // text the user has typed.
  //
  // The "next free number" is:
  //   - max(N) + 1  if any "新节点 N" peers exist, OR
  //   - 2            if only a bare "新节点" peer exists (bare is "1"),
  //   - 1            if no "新节点*" peers exist at all.
  // We don't auto-renumber the existing bare node — adding more just
  // gets "1", "2", "3" from then on.  Keeping the first one bare is
  // intentional: it's what the user sees and renaming is one click.
  const re = /^新节点(?:\s+(\d+))?$/
  let max = 0
  let hasUnnumbered = false
  for (const c of parent.children) {
    const m = c.text.match(re)
    if (!m) continue
    if (m[1]) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    } else {
      hasUnnumbered = true
    }
  }
  if (max === 0 && !hasUnnumbered) return DEFAULT_NEW_NODE_TEXT
  // If we have at least one numbered peer, the next is max+1.
  if (max > 0) return `新节点 ${max + 1}`
  // Only a bare "新节点" peer.  It's slot 1; next slot is 2.
  return '新节点 2'
}

export function addChild(
  root: MindMapNode,
  parentId: string,
  text?: string
): MindMapNode | null {
  const p = findNode(root, parentId)
  if (!p) return null
  const node: MindMapNode = { id: uid(), text: text ?? defaultSiblingText(p), children: [] }
  p.children.push(node)
  return node
}

export function addSibling(
  root: MindMapNode,
  nodeId: string,
  text?: string
): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const idx = parent.children.findIndex((c) => c.id === nodeId)
  if (idx < 0) return null
  const node: MindMapNode = { id: uid(), text: text ?? defaultSiblingText(parent), children: [] }
  // Insert *after* the current node, not at the end of the parent's
  // children list.  Push-to-end would scramble order when adding
  // siblings to nodes that aren't the last child, and would confuse
  // the layout's clockwise sweep.
  parent.children.splice(idx + 1, 0, node)
  return node
}

/**
 * Insert a new sibling node BEFORE the given node (Shift+Enter in xmind).
 * Returns the new node, or null if the target is the root.
 */
export function addSiblingBefore(
  root: MindMapNode,
  nodeId: string,
  text?: string
): MindMapNode | null {
  const parent = findParent(root, nodeId)
  if (!parent) return null
  const idx = parent.children.findIndex((c) => c.id === nodeId)
  if (idx < 0) return null
  const node: MindMapNode = { id: uid(), text: text ?? defaultSiblingText(parent), children: [] }
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
