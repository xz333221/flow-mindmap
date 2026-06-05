export interface LayoutNode {
  id: string
  text: string
  depth: number
  x: number
  y: number
  width: number
  height: number
  isRoot: boolean
  collapsed?: boolean
  side: 1 | -1
  children: LayoutNode[]
  parent: LayoutNode | null
}

import type { MindMapNode } from '../types'

const NODE_W = 140
const NODE_H = 36
const H_GAP = 60
const V_GAP = 14
const SIDE_PADDING = 24

export function layout(root: MindMapNode): { root: LayoutNode; width: number; height: number; vbX: number; vbY: number; vbW: number; vbH: number } {
  const lr = buildLayout(root, 0, null, 1)
  const subH = new Map<LayoutNode, number>()
  function sh(n: LayoutNode): number {
    if (n.collapsed || n.children.length === 0) {
      subH.set(n, NODE_H)
      return NODE_H
    }
    let total = 0
    for (const c of n.children) total += sh(c)
    total += V_GAP * (n.children.length - 1)
    subH.set(n, total)
    return total
  }
  sh(lr)
  function assignX(n: LayoutNode, px: number) {
    n.x = n.isRoot ? 0 : px + n.side * (NODE_W + H_GAP)
    for (const c of n.children) assignX(c, n.x)
  }
  assignX(lr, 0)
  function layoutChildren(n: LayoutNode, startY: number) {
    if (n.collapsed || n.children.length === 0) return
    let y = startY
    for (const c of n.children) {
      const h = subH.get(c) ?? NODE_H
      c.y = y + h / 2
      layoutChildren(c, y)
      y += h + V_GAP
    }
  }
  layoutChildren(lr, 0)
  const rootH = subH.get(lr) ?? NODE_H
  lr.y = rootH / 2
  layoutChildren(lr, lr.y - rootH / 2)

  // compute bounds
  const stack: LayoutNode[] = [lr]
  let minY = Infinity, maxY = -Infinity, maxX = 0
  while (stack.length) {
    const cur = stack.pop()!
    minY = Math.min(minY, cur.y)
    maxY = Math.max(maxY, cur.y)
    maxX = Math.max(maxX, Math.abs(cur.x))
    stack.push(...cur.children)
  }
  // bounds in center-y coords. shift y so that top = NODE_H/2 + PAD
  const topPad = NODE_H / 2 + SIDE_PADDING
  const yShift = topPad - minY
  const s2: LayoutNode[] = [lr]
  while (s2.length) {
    const cur = s2.pop()!
    cur.y += yShift
    s2.push(...cur.children)
  }
  minY += yShift
  maxY += yShift
  const vbX = -maxX - NODE_W / 2 - SIDE_PADDING
  const vbY = -SIDE_PADDING
  const vbW = (maxX + NODE_W / 2) * 2 + SIDE_PADDING * 2
  const vbH = maxY + NODE_H / 2 + SIDE_PADDING
  return {
    root: lr,
    width: vbW,
    height: vbH,
    vbX,
    vbY,
    vbW,
    vbH,
  }
}

function buildLayout(node: MindMapNode, depth: number, parent: LayoutNode | null, side: 1 | -1): LayoutNode {
  const ln: LayoutNode = {
    id: node.id,
    text: node.text,
    depth,
    x: 0,
    y: 0,
    width: NODE_W,
    height: NODE_H,
    isRoot: depth === 0,
    collapsed: node.collapsed,
    side,
    children: [],
    parent,
  }
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i]
    const childSide: 1 | -1 = ln.isRoot ? (i % 2 === 0 ? 1 : -1) : (side as 1 | -1)
    ln.children.push(buildLayout(c, depth + 1, ln, childSide))
  }
  return ln
}

export const LAYOUT = { NODE_W, NODE_H, H_GAP, V_GAP, SIDE_PADDING }
