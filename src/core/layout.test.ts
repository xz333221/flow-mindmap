import { describe, expect, it } from 'vitest'
import { layout, type LayoutNode } from './layout'
import type { MindMapNode } from '../types'

/**
 * `_richInsetX` is intentionally left unset on every node type.
 * The SVG line tip should land on the box's geometric edge for
 * plain, image, code, and table nodes alike — the cosmetic gap
 * between the line and the rich body's framed content is the
 * desired look.  An earlier draft tried to inset the tip to the
 * rich body's outer edge, but the resulting line crossed the
 * visible box border and trailed into the empty band between
 * the box and the rich frame.
 */
describe('layout._richInsetX', () => {
  function findNode(tree: LayoutNode, id: string): LayoutNode | null {
    if (tree.id === id) return tree
    for (const c of tree.children) {
      const r = findNode(c, id)
      if (r) return r
    }
    return null
  }

  it('leaves inset undefined for code nodes', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'code1', text: '代码块', richContent: { kind: 'code', raw: '```ts\nconst x = 1\n```', lang: 'ts' }, children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    expect(findNode(r.root, 'code1')!._richInsetX).toBeUndefined()
  })

  it('leaves inset undefined for table nodes', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'tab1', text: '表格', richContent: { kind: 'table', raw: '| a | b |\n| --- | --- |\n| 1 | 2 |' }, children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    expect(findNode(r.root, 'tab1')!._richInsetX).toBeUndefined()
  })

  it('leaves inset undefined for plain text nodes', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'plain', text: '普通节点', children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    expect(findNode(r.root, 'plain')!._richInsetX).toBeUndefined()
  })

  it('leaves inset undefined for paragraph / list rich content', () => {
    const tree: MindMapNode = {
      id: 'root', text: 'root', children: [
        { id: 'p', text: '段落', richContent: { kind: 'paragraph', raw: '一段文字' }, children: [] },
        { id: 'l', text: '列表', richContent: { kind: 'list', raw: '- a\n- b' }, children: [] },
      ],
    }
    const r = layout(tree, { baseFontSize: 14 })
    expect(findNode(r.root, 'p')!._richInsetX).toBeUndefined()
    expect(findNode(r.root, 'l')!._richInsetX).toBeUndefined()
  })
})
