import { describe, it, expect, beforeEach } from 'vitest'
import {
  uid,
  clone,
  findNode,
  findParent,
  removeNode,
  addChild,
  addSibling,
  addSiblingBefore,
  duplicateNode,
  countDescendants,
  DEFAULT_NEW_NODE_TEXT,
} from './tree'
import type { MindMapNode } from './types'

const makeSample = (): MindMapNode => ({
  id: 'root',
  text: 'Root',
  children: [
    {
      id: 'a',
      text: 'A',
      children: [
        { id: 'a1', text: 'A1', children: [] },
        { id: 'a2', text: 'A2', children: [] },
      ],
    },
    {
      id: 'b',
      text: 'B',
      children: [{ id: 'b1', text: 'B1', children: [] }],
    },
  ],
})

let sample: MindMapNode
beforeEach(() => {
  sample = makeSample()
})

describe('uid', () => {
  it('returns a string with the expected prefix', () => {
    expect(uid()).toMatch(/^n_/)
  })
  it('returns unique values', () => {
    const set = new Set(Array.from({ length: 100 }, () => uid()))
    expect(set.size).toBe(100)
  })
})

describe('clone', () => {
  it('returns a deep copy', () => {
    const c = clone(sample)
    expect(c).toEqual(sample)
    expect(c).not.toBe(sample)
    expect(c.children[0]).not.toBe(sample.children[0])
  })
  it('mutations on the clone do not affect the original', () => {
    const c = clone(sample)
    c.children[0].text = 'changed'
    expect(sample.children[0].text).toBe('A')
  })
})

describe('findNode', () => {
  it('finds the root', () => {
    expect(findNode(sample, 'root')?.text).toBe('Root')
  })
  it('finds a deep descendant', () => {
    expect(findNode(sample, 'a2')?.text).toBe('A2')
  })
  it('returns null when missing', () => {
    expect(findNode(sample, 'zzz')).toBeNull()
  })
})

describe('findParent', () => {
  it('returns null for root', () => {
    expect(findParent(sample, 'root')).toBeNull()
  })
  it('finds the parent of a top-level child', () => {
    expect(findParent(sample, 'a')?.id).toBe('root')
  })
  it('finds the parent of a deep child', () => {
    expect(findParent(sample, 'a1')?.id).toBe('a')
  })
  it('returns null for missing', () => {
    expect(findParent(sample, 'zzz')).toBeNull()
  })
})

describe('removeNode', () => {
  it('removes a top-level child', () => {
    const r = removeNode(sample, 'b')
    expect(r).toBe(true)
    expect(sample.children.find((c) => c.id === 'b')).toBeUndefined()
  })
  it('removes a deep child', () => {
    const r = removeNode(sample, 'a1')
    expect(r).toBe(true)
    expect(sample.children[0].children.find((c) => c.id === 'a1')).toBeUndefined()
  })
  it('returns false for missing', () => {
    expect(removeNode(sample, 'zzz')).toBe(false)
  })
})

describe('addChild', () => {
  it('appends a new child with default text', () => {
    const n = addChild(sample, 'a')
    expect(n).not.toBeNull()
    expect(n?.text).toBe(DEFAULT_NEW_NODE_TEXT)
    expect(sample.children[0].children).toContain(n)
  })
  it('returns null for missing parent', () => {
    expect(addChild(sample, 'zzz')).toBeNull()
  })
  it('uses provided text', () => {
    const n = addChild(sample, 'root', 'hello')
    expect(n?.text).toBe('hello')
  })
})

describe('addSibling', () => {
  it('adds a sibling to a deep node', () => {
    const before = sample.children[0].children.length
    const n = addSibling(sample, 'a1')
    expect(n).not.toBeNull()
    expect(sample.children[0].children.length).toBe(before + 1)
    expect(sample.children[0].children).toContain(n)
  })
  it('returns null for root (no parent)', () => {
    expect(addSibling(sample, 'root')).toBeNull()
  })
})

describe('countDescendants', () => {
  it('counts all descendants of root', () => {
    // a, a1, a2, b, b1 = 5
    expect(countDescendants(sample)).toBe(5)
  })
  it('counts a subtree', () => {
    // a1, a2 = 2
    expect(countDescendants(sample.children[0])).toBe(2)
  })
  it('returns 0 for a leaf', () => {
    expect(countDescendants(sample.children[0].children[0])).toBe(0)
  })
})

describe('addSiblingBefore', () => {
  it('inserts a new sibling before the given node', () => {
    const before = sample.children[0].children.slice()
    const n = addSiblingBefore(sample, 'a1')
    expect(n).not.toBeNull()
    expect(sample.children[0].children[0]).toBe(n) // inserted at index 0
    expect(sample.children[0].children.slice(1)).toEqual(before)
  })
  it('returns null for root (no parent)', () => {
    expect(addSiblingBefore(sample, 'root')).toBeNull()
  })
  it('returns null for missing node', () => {
    expect(addSiblingBefore(sample, 'zzz')).toBeNull()
  })
  it('uses provided text', () => {
    const n = addSiblingBefore(sample, 'a1', 'before-a1')
    expect(n?.text).toBe('before-a1')
  })
})

describe('duplicateNode', () => {
  it('inserts a deep copy after the original', () => {
    const before = sample.children[0].children.length
    const n = duplicateNode(sample, 'a')
    expect(n).not.toBeNull()
    expect(n).not.toBe(sample.children[0]) // new object
    expect(n?.id).not.toBe('a') // new id
    expect(n?.text).toBe('A')
    // children are deep-cloned with new ids
    expect(n?.children.length).toBe(2)
    expect(n?.children[0].id).not.toBe('a1')
    expect(n?.children[0].text).toBe('A1')
    // original was deep-copied (not aliased)
    expect(n?.children[0]).not.toBe(sample.children[0].children[0])
    // root now has one more child (the copy) and 'a' itself is unchanged
    expect(sample.children.length).toBe(3) // [a, copy, b]
    expect(sample.children[0].children.length).toBe(before)
  })
  it('places the copy immediately after the original', () => {
    const n = duplicateNode(sample, 'a')
    expect(sample.children[0].id).toBe('a')
    expect(sample.children[1]).toBe(n) // copy is at index 1
    expect(sample.children[2].id).toBe('b') // original b pushed to index 2
  })
  it('returns null for root', () => {
    expect(duplicateNode(sample, 'root')).toBeNull()
  })
  it('returns null for missing node', () => {
    expect(duplicateNode(sample, 'zzz')).toBeNull()
  })
})
