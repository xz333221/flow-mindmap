import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MindMap from './components/MindMap.vue'
import { layout } from './core/layout'
import type { MindMapNode } from './types'

// happy-dom does not implement layout measurement (getBoundingClientRect
// returns zeros).  We stub it so hit-testing can use real screen coords
// derived from node.x/y.  MindMap's pointer handler does
//   wx = (clientX - rect.left - offsetX) / scale
// which means we must set the wrapper's rect to a known origin
// (here 0,0) and set scale=1, offsetX/Y=0 by mounting with no pan/zoom.
const origGBCR = HTMLElement.prototype.getBoundingClientRect
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0,
      top: 0, left: 0,
      right: 1000, bottom: 1000,
      width: 1000, height: 1000,
      toJSON: () => ({}),
    } as DOMRect
  }
})
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = origGBCR
})

const sampleData = (): MindMapNode => ({
  id: 'root',
  text: 'Root',
  children: [
    { id: 'a', text: 'A', children: [
      { id: 'a1', text: 'A1', children: [] },
    ] },
    { id: 'b', text: 'B', children: [] },
  ],
})

/** Find the rendered .zm-node element for a given node id. */
function nodeEl(wrapper: ReturnType<typeof mount>, id: string) {
  return wrapper.find(`[data-node-id="${id}"]`)
}

/** Dispatch a PointerEvent directly on window.  We can't use
 *  element.trigger() because the component listens for drag
 *  pointermove/pointerup on window (so it catches the gesture
 *  no matter which element the cursor is over). */
function dispatchPointer(type: string, init: PointerEventInit) {
  const ev = new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(ev)
  return Promise.resolve()
}

describe('drag-to-reparent', () => {
  it('pointerdown on a non-root node starts a drag and auto-selects', async () => {
    const data = sampleData()
    const wrapper = mount(MindMap, { props: { data } })
    await flushPromises()

    const aEl = nodeEl(wrapper, 'a')
    expect(aEl.exists()).toBe(true)
    await aEl.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()

    // The drag ghost is deferred until the pointer moves past a
    // small threshold — a plain press should NOT show it yet.
    expect(aEl.classes()).not.toContain('is-dragging-source')
    expect(wrapper.find('.zm-drag-ghost').exists()).toBe(false)

    // Move past the threshold to activate the drag.
    await dispatchPointer('pointermove', { pointerId: 1, clientX: 30, clientY: 30 })
    await flushPromises()

    // Source gets the dragging class.
    expect(aEl.classes()).toContain('is-dragging-source')
    // Ghost element rendered.
    expect(wrapper.find('.zm-drag-ghost').exists()).toBe(true)
  })

  it('pointerdown on root is a no-op (root is not draggable)', async () => {
    const data = sampleData()
    const wrapper = mount(MindMap, { props: { data } })
    await flushPromises()

    const rootEl = nodeEl(wrapper, 'root')
    expect(rootEl.exists()).toBe(true)
    await rootEl.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 5, clientY: 5 })
    await flushPromises()

    expect(rootEl.classes()).not.toContain('is-dragging-source')
    expect(wrapper.find('.zm-drag-ghost').exists()).toBe(false)
  })

  it('previewMode blocks drag start entirely', async () => {
    const data = sampleData()
    const wrapper = mount(MindMap, { props: { data, previewMode: true } })
    await flushPromises()

    await nodeEl(wrapper, 'a').trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()

    expect(wrapper.find('.zm-drag-ghost').exists()).toBe(false)
    expect(nodeEl(wrapper, 'a').classes()).not.toContain('is-dragging-source')
  })

  it('non-left button does not start a drag', async () => {
    const data = sampleData()
    const wrapper = mount(MindMap, { props: { data } })
    await flushPromises()

    await nodeEl(wrapper, 'a').trigger('pointerdown', { button: 2, pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()
    expect(wrapper.find('.zm-drag-ghost').exists()).toBe(false)
  })

  it('drop on another node reparents as child and emits change', async () => {
    const data = sampleData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()

    const aEl = nodeEl(wrapper, 'a')
    const bEl = nodeEl(wrapper, 'b')

    await aEl.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()

    // Resolve b's actual layout coords from the rendered DOM and
    // dispatch pointermove/up at its world-space centre.  MindMap
    // calls resetView() on mount which sets panZoom.scale and
    // offsets based on the wrapper rect (stubbed to 1000x1000 here),
    // so we have to convert world coords to clientX/Y ourselves
    // to match what the runtime hit-test does.
    //
    //   clientX = wx * scale + offsetX + wrapperRect.left
    const bRect = (bEl.element as HTMLElement).getBoundingClientRect()
    // We compute live world→screen from the rendered .zm-world
    // transform; bRect is unused except to ensure the element
    // exists in the DOM.
    void bRect
    // Compute the live transform by reading what resetView() did:
    // it's not exposed, but we can infer by reading the rendered
    // .zm-world element's transform style (the component sets it
    // inline via :style on every render).
    const worldEl = wrapper.find('.zm-world').element as HTMLElement
    const tf = (worldEl.style.transform || '')
    // parse "translate(<x>px, <y>px) scale(<s>)"
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(tf)
    const tx = m ? parseFloat(m[1]) : 0
    const ty = m ? parseFloat(m[2]) : 0
    const sc = m ? parseFloat(m[3]) : 1

    // World coords from layout(): convert to clientX/Y the same way
    // MindMap's runtime hit-test inverts them.
    const r = layout(data, {})
    const findInLayout = (n: { id: string; x: number; y: number; children: any[] }): typeof n | null => {
      if (n.id === 'b') return n
      for (const c of n.children) {
        const f = findInLayout(c)
        if (f) return f
      }
      return null
    }
    const bLayout = findInLayout(r.root)!
    const targetCx = bLayout.x * sc + tx + 0  // + wrapperRect.left (stubbed 0)
    const targetCy = bLayout.y * sc + ty + 0

    await dispatchPointer('pointermove', { pointerId: 1, clientX: targetCx, clientY: targetCy })
    await flushPromises()

    // Target should be highlighted as drop target.
    expect(bEl.classes()).toContain('is-drop-target')

    // Drop on b
    await dispatchPointer('pointerup', { pointerId: 1, clientX: targetCx, clientY: targetCy })
    await flushPromises()

    expect(onChange).toHaveBeenCalled()
    const newTree = onChange.mock.calls.at(-1)?.[0] as MindMapNode
    const bNode = newTree.children.find(c => c.id === 'b')!
    const bChildIds = bNode.children.map(c => c.id)
    expect(newTree.children.map(c => c.id)).not.toContain('a')
    expect(bChildIds).toContain('a')
    // Ghost cleaned up regardless
    expect(wrapper.find('.zm-drag-ghost').exists()).toBe(false)
    expect(aEl.classes()).not.toContain('is-dragging-source')
  })

  it('drop on empty canvas is a no-op (no change emitted)', async () => {
    const data = sampleData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()

    await nodeEl(wrapper, 'a').trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()

    // Move way off-canvas, well past any node bbox.
    await dispatchPointer('pointermove', { pointerId: 1, clientX: 9999, clientY: 9999 })
    await dispatchPointer('pointerup', { pointerId: 1, clientX: 9999, clientY: 9999 })
    await flushPromises()

    expect(onChange).not.toHaveBeenCalled()
    expect(wrapper.find('.zm-drag-ghost').exists()).toBe(false)
  })

  it('drop on the source node itself is a no-op', async () => {
    const data = sampleData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()

    await nodeEl(wrapper, 'a').trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()

    // Move back onto the source's coords: the hit-test excludes
    // the source itself, so currentTargetId stays null and the
    // pointerup is a no-op.
    await dispatchPointer('pointermove', { pointerId: 1, clientX: 10, clientY: 10 })
    await dispatchPointer('pointerup', { pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('the move is recorded in undo history (canUndo true after drop)', async () => {
    const data = sampleData()
    const wrapper = mount(MindMap, { props: { data } })
    await flushPromises()

    const aEl = nodeEl(wrapper, 'a')
    const bEl = nodeEl(wrapper, 'b')

    // Read the live transform applied to .zm-world (set by
    // resetView on mount).
    const worldEl = wrapper.find('.zm-world').element as HTMLElement
    const tf = (worldEl.style.transform || '')
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(tf)
    const tx = m ? parseFloat(m[1]) : 0
    const ty = m ? parseFloat(m[2]) : 0
    const sc = m ? parseFloat(m[3]) : 1

    const r = layout(data, {})
    const findInLayout = (n: { id: string; x: number; y: number; children: any[] }): typeof n | null => {
      if (n.id === 'b') return n
      for (const c of n.children) {
        const f = findInLayout(c)
        if (f) return f
      }
      return null
    }
    const bLayout = findInLayout(r.root)!
    const bCx = bLayout.x * sc + tx
    const bCy = bLayout.y * sc + ty

    await aEl.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await dispatchPointer('pointermove', { pointerId: 1, clientX: bCx, clientY: bCy })
    await dispatchPointer('pointerup', { pointerId: 1, clientX: bCx, clientY: bCy })
    await flushPromises()

    const exposed = wrapper.vm as unknown as { canUndo: () => boolean }
    expect(exposed.canUndo()).toBe(true)
  })
})

/** Dispatch a MouseEvent with the given clientX/Y and shiftKey on
 *  the wrapper (MindMap listens for click on .zm-node). */
async function clickNode(wrapper: ReturnType<typeof mount>, id: string, opts: { shift?: boolean } = {}) {
  const el = nodeEl(wrapper, id)
  await el.trigger('click', {
    button: 0,
    clientX: 0,
    clientY: 0,
    shiftKey: !!opts.shift,
  })
}

describe('press-highlight (no selection on plain press)', () => {
  it('pointerdown without movement does NOT mark the node as selected', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()

    const aEl = nodeEl(wrapper, 'a')
    await aEl.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    await flushPromises()

    // Drag internals fire (ghost, dimmed source) but the
    // is-selected ring does NOT — selection lands on clean click
    // via onNodeClick, not on mousedown.
    expect(aEl.classes()).not.toContain('is-selected')
  })
})

describe('multi-select', () => {
  it('plain click selects exactly one node; shift+click toggles a second', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()

    await clickNode(wrapper, 'a')
    expect(nodeEl(wrapper, 'a').classes()).toContain('is-selected')
    expect(nodeEl(wrapper, 'b').classes()).not.toContain('is-selected')

    await clickNode(wrapper, 'b', { shift: true })
    expect(nodeEl(wrapper, 'a').classes()).toContain('is-selected')
    // Both members of the set wear the same ring — there is no
    // primary/secondary split in the styling.
    expect(nodeEl(wrapper, 'b').classes()).toContain('is-selected')

    // Toggling 'a' off via shift+click — 'b' remains selected.
    await clickNode(wrapper, 'a', { shift: true })
    expect(nodeEl(wrapper, 'a').classes()).not.toContain('is-selected')
    expect(nodeEl(wrapper, 'b').classes()).toContain('is-selected')
  })

  it('getSelectedIds reflects the multi-select set', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = wrapper.vm as unknown as { getSelectedIds: () => string[] }

    await clickNode(wrapper, 'a')
    await clickNode(wrapper, 'b', { shift: true })
    await clickNode(wrapper, 'a1', { shift: true })

    const ids = exposed.getSelectedIds()
    expect(ids.sort()).toEqual(['a', 'a1', 'b'].sort())
  })
})

describe('multi-select drag', () => {
  /** A slightly wider tree than `sampleData`: 'a' has two children
   *  so before/after drops have somewhere unambiguous to land
   *  (targeting a ROOT child would hit the left-side mirroring
   *  rule for the node's own `_dir`). */
  const dragSetData = (): MindMapNode => ({
    id: 'root',
    text: 'Root',
    children: [
      { id: 'a', text: 'A', children: [
        { id: 'a1', text: 'A1', children: [] },
        { id: 'a2', text: 'A2', children: [] },
      ] },
      { id: 'b', text: 'B', children: [] },
      { id: 'c', text: 'C', children: [] },
    ],
  })

  function findIn(n: MindMapNode, id: string): MindMapNode | null {
    if (n.id === id) return n
    for (const c of n.children) {
      const f = findIn(c, id)
      if (f) return f
    }
    return null
  }

  /** Client coords of a node's centre, read back from the DOM the
   *  component actually rendered — a node's inline `left`/`top` ARE
   *  its world position.  Deliberately NOT re-run through
   *  `layout()`: that second copy would drift from the options
   *  MindMap actually lays out with, and the drop would land on
   *  whatever box happens to sit at the stale coordinate.
   *  `halfH` lets a caller aim at the before / child / after zones
   *  the drop logic partitions the box into. */
  function nodePoint(
    wrapper: ReturnType<typeof mount>,
    id: string
  ): { clientX: number; clientY: number; halfH: number } {
    const el = nodeEl(wrapper, id).element as HTMLElement
    const worldEl = wrapper.find('.zm-world').element as HTMLElement
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(
      worldEl.style.transform || ''
    )
    const tx = m ? parseFloat(m[1]) : 0
    const ty = m ? parseFloat(m[2]) : 0
    const sc = m ? parseFloat(m[3]) : 1
    return {
      clientX: parseFloat(el.style.left) * sc + tx,
      clientY: parseFloat(el.style.top) * sc + ty,
      halfH: (parseFloat(el.style.height) / 2) * sc,
    }
  }

  /** pointerdown on `pressId`, then move + release at the target
   *  point.  The press carries dummy coords so the move to the
   *  target clears DRAG_THRESHOLD (a press and a move at the same
   *  point would stay in the click dead-zone and never promote).
   *  Returns the last tree handed to `change`. */
  async function dragOnto(
    wrapper: ReturnType<typeof mount>,
    pressId: string,
    point: { clientX: number; clientY: number },
    onChange: ReturnType<typeof vi.fn>
  ): Promise<MindMapNode> {
    await nodeEl(wrapper, pressId).trigger('pointerdown', {
      button: 0, pointerId: 1, clientX: 5, clientY: 5,
    })
    await flushPromises()
    await dispatchPointer('pointermove', { pointerId: 1, ...point })
    await flushPromises()
    await dispatchPointer('pointerup', { pointerId: 1, ...point })
    await flushPromises()
    return onChange.mock.calls.at(-1)?.[0] as MindMapNode
  }

  it('dragging one member of a multi-selection moves the whole set', async () => {
    const data = dragSetData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()
    const exposed = wrapper.vm as unknown as { getSelectedIds: () => string[] }

    await clickNode(wrapper, 'b')
    await clickNode(wrapper, 'c', { shift: true })
    expect(exposed.getSelectedIds().sort()).toEqual(['b', 'c'])

    const from = nodePoint(wrapper, 'b')
    const to = nodePoint(wrapper, 'a1')
    await nodeEl(wrapper, 'b').trigger('pointerdown', {
      button: 0, pointerId: 1, clientX: from.clientX, clientY: from.clientY,
    })
    await flushPromises()
    await dispatchPointer('pointermove', { pointerId: 1, clientX: to.clientX, clientY: to.clientY })
    await flushPromises()

    // Every source dims, not just the grabbed one, and the ghost
    // advertises the passengers.
    expect(nodeEl(wrapper, 'b').classes()).toContain('is-dragging-source')
    expect(nodeEl(wrapper, 'c').classes()).toContain('is-dragging-source')
    expect(wrapper.find('.zm-drag-ghost-count').text()).toBe('+1')

    await dispatchPointer('pointerup', { pointerId: 1, clientX: to.clientX, clientY: to.clientY })
    await flushPromises()

    const tree = onChange.mock.calls.at(-1)?.[0] as MindMapNode
    expect(tree.children.map((c) => c.id)).toEqual(['a'])
    expect(findIn(tree, 'a1')!.children.map((c) => c.id)).toEqual(['b', 'c'])
    // The moved set stays selected, so the user can drag it again.
    expect(exposed.getSelectedIds().sort()).toEqual(['b', 'c'])
  })

  it('a selected ancestor absorbs its selected descendant (single move)', async () => {
    const data = dragSetData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()

    // 'a' and its own child 'a1' are both selected.  Moving 'a'
    // already carries 'a1' — moving it again would tear the tree.
    await clickNode(wrapper, 'a')
    await clickNode(wrapper, 'a1', { shift: true })

    const from = nodePoint(wrapper, 'a')
    const to = nodePoint(wrapper, 'b')
    await nodeEl(wrapper, 'a').trigger('pointerdown', {
      button: 0, pointerId: 1, clientX: from.clientX, clientY: from.clientY,
    })
    await flushPromises()
    await dispatchPointer('pointermove', { pointerId: 1, clientX: to.clientX, clientY: to.clientY })
    await flushPromises()

    // Only one node is actually being dragged → no "+N" badge.
    expect(wrapper.find('.zm-drag-ghost-count').exists()).toBe(false)
    expect(nodeEl(wrapper, 'a').classes()).toContain('is-dragging-source')
    expect(nodeEl(wrapper, 'a1').classes()).not.toContain('is-dragging-source')

    await dispatchPointer('pointerup', { pointerId: 1, clientX: to.clientX, clientY: to.clientY })
    await flushPromises()

    const tree = onChange.mock.calls.at(-1)?.[0] as MindMapNode
    expect(findIn(tree, 'b')!.children.map((c) => c.id)).toEqual(['a'])
    expect(findIn(tree, 'a')!.children.map((c) => c.id)).toEqual(['a1', 'a2'])
    expect(tree.children.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('pressing a node outside the selection drags only that node', async () => {
    const data = dragSetData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()
    const exposed = wrapper.vm as unknown as { getSelectedIds: () => string[] }

    await clickNode(wrapper, 'b')
    await clickNode(wrapper, 'c', { shift: true })

    // 'a' is not in the selection, so grabbing it picks up 'a' alone
    // (dropping it on 'a1' would be a cycle — a1 lives inside a).
    const to = nodePoint(wrapper, 'b')
    const tree = await dragOnto(wrapper, 'a', to, onChange)

    expect(findIn(tree, 'b')!.children.map((c) => c.id)).toEqual(['a'])
    // 'c' was selected but never grabbed, so it stays put.
    expect(tree.children.map((c) => c.id)).toEqual(['b', 'c'])
    // The selection collapsed onto the node the user actually moved.
    expect(exposed.getSelectedIds()).toEqual(['a'])
  })

  it('multi-drop before a target keeps the on-canvas order', async () => {
    const data = dragSetData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()

    await clickNode(wrapper, 'b')
    await clickNode(wrapper, 'c', { shift: true })

    const t = nodePoint(wrapper, 'a1')
    // Upper third of 'a1' → 'before'.
    const point = { clientX: t.clientX, clientY: t.clientY - t.halfH * 0.6 }
    const tree = await dragOnto(wrapper, 'b', point, onChange)

    // 'moveNode' splices 'before' at the target's slot, so a
    // forward walk is what preserves B-then-C.
    expect(findIn(tree, 'a')!.children.map((c) => c.id)).toEqual(['b', 'c', 'a1', 'a2'])
  })

  it('multi-drop after a target keeps the on-canvas order', async () => {
    const data = dragSetData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()

    await clickNode(wrapper, 'b')
    await clickNode(wrapper, 'c', { shift: true })

    const t = nodePoint(wrapper, 'a2')
    // Lower third of 'a2' → 'after'.
    const point = { clientX: t.clientX, clientY: t.clientY + t.halfH * 0.6 }
    const tree = await dragOnto(wrapper, 'b', point, onChange)

    // 'after' inserts directly behind the target every time, so the
    // list has to be walked backwards for B to end up before C.
    expect(findIn(tree, 'a')!.children.map((c) => c.id)).toEqual(['a1', 'a2', 'b', 'c'])
  })

  it('a drop that would cycle is abandoned whole (no partial move)', async () => {
    const data = dragSetData()
    const onChange = vi.fn()
    const wrapper = mount(MindMap, { props: { data }, attrs: { onChange } })
    await flushPromises()

    // Select 'b' and 'a'; drop onto 'a1', which lives inside 'a'.
    // 'a' cannot legally land there, so the batch is refused rather
    // than moving 'b' on its own.
    await clickNode(wrapper, 'b')
    await clickNode(wrapper, 'a', { shift: true })

    const to = nodePoint(wrapper, 'a1')
    const tree = await dragOnto(wrapper, 'b', to, onChange)

    expect(onChange).not.toHaveBeenCalled()
    expect(tree).toBeUndefined()
    expect(findIn(data, 'b')).toBeTruthy()
  })
})

describe('clipboard (Ctrl+C / Ctrl+X / Ctrl+V)', () => {
  function key(letter: string, opts: { ctrl?: boolean; meta?: boolean } = {}) {
    // Build a KeyboardEvent that matches the listener's gate
    // (modKey returns metaKey on Mac, ctrlKey elsewhere; in the
    // test env platform is non-Mac so ctrlKey is the primary).
    const ev = new KeyboardEvent('keydown', {
      key: letter,
      code: 'Key' + letter.toUpperCase(),
      bubbles: true,
      cancelable: true,
      ctrlKey: !!opts.ctrl,
      metaKey: !!opts.meta,
    })
    window.dispatchEvent(ev)
  }

  it('copy + paste duplicates the subtree under a target with fresh ids', async () => {
    const data = sampleData()
    const wrapper = mount(MindMap, { props: { data } })
    await flushPromises()
    const exposed = wrapper.vm as unknown as {
      getSelectedIds: () => string[]
      copyNodes: (ids: string[]) => void
      pasteNodes: (targetId: string | null) => void
      getData: () => MindMapNode
    }

    // Click 'a' to select it (a has one child a1).
    await clickNode(wrapper, 'a')
    expect(exposed.getSelectedIds()).toEqual(['a'])

    exposed.copyNodes(['a'])
    // Click 'b' to set paste target.
    await clickNode(wrapper, 'b')
    exposed.pasteNodes('b')

    const b = exposed.getData().children.find(c => c.id === 'b')!
    // 'a' was copied under 'b' — and the copy carries a child 'a1'.
    expect(b.children.length).toBe(1)
    const aCopy = b.children[0]
    expect(aCopy.text).toBe('A')
    expect(aCopy.id).not.toBe('a')
    expect(aCopy.children.length).toBe(1)
    expect(aCopy.children[0].text).toBe('A1')
    expect(aCopy.children[0].id).not.toBe('a1')

    // Original 'a' still in tree, untouched.
    expect(exposed.getData().children.find(c => c.id === 'a')).toBeTruthy()
  })

  it('cut removes originals immediately; paste under target', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = wrapper.vm as unknown as {
      cutNodes: (ids: string[]) => void
      pasteNodes: (targetId: string | null) => void
      getData: () => MindMapNode
    }

    exposed.cutNodes(['a'])
    // Original 'a' gone.
    expect(exposed.getData().children.find(c => c.id === 'a')).toBeUndefined()
    expect(exposed.getData().children.find(c => c.id === 'a1')).toBeUndefined()

    // Paste under 'b'.
    exposed.pasteNodes('b')
    const b = exposed.getData().children.find(c => c.id === 'b')!
    expect(b.children.length).toBe(1)
    expect(b.children[0].text).toBe('A')
  })

  it('cut on root is a no-op', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = wrapper.vm as unknown as {
      cutNodes: (ids: string[]) => void
      getData: () => MindMapNode
    }
    const before = JSON.stringify(exposed.getData())
    exposed.cutNodes(['root'])
    expect(JSON.stringify(exposed.getData())).toBe(before)
  })

  it('paste consumes the buffer — second paste is a no-op', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = wrapper.vm as unknown as {
      copyNodes: (ids: string[]) => void
      pasteNodes: (targetId: string | null) => void
      getData: () => MindMapNode
    }
    exposed.copyNodes(['b'])
    exposed.pasteNodes('a')
    const after1 = JSON.stringify(exposed.getData())
    exposed.pasteNodes('a')
    expect(JSON.stringify(exposed.getData())).toBe(after1)
  })
})
describe('relations (联系)', () => {
  interface RelExpose {
    addRelation: (fromId: string, toId: string) => string | null
    removeRelation: (id: string) => void
    updateRelation: (id: string, patch: Record<string, unknown>) => void
    getRelations: () => { id: string; fromId: string; toId: string; label?: string }[]
    removeNode: (id: string) => void
    undo: () => void
    redo: () => void
    exportData: () => string
    importData: (json: string) => boolean
    getData: () => MindMapNode
  }
  const exposeOf = (wrapper: ReturnType<typeof mount>) =>
    wrapper.vm as unknown as RelExpose

  it('addRelation renders a dashed path between the two nodes', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)

    expect(wrapper.find('.zm-relation-path').exists()).toBe(false)
    const id = exposed.addRelation('a', 'b')
    expect(id).toBeTruthy()
    await flushPromises()

    const path = wrapper.find('.zm-relation-path')
    expect(path.exists()).toBe(true)
    expect(path.attributes('d')).toMatch(/^M /)
    // Default arrow: one triangle at the target ('to') end.
    expect(wrapper.findAll('.zm-relation-arrow')).toHaveLength(1)
    // A freshly-created relation is auto-selected → its four
    // handles render (2 endpoint circles + 2 control rects).
    expect(wrapper.findAll('.zm-relation-handle-endpoint')).toHaveLength(2)
    expect(wrapper.findAll('.zm-relation-handle-ctrl')).toHaveLength(2)
  })

  it('relation arrow honours arrow: none / end / both', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)
    const id = exposed.addRelation('a', 'b')!
    await flushPromises()
    expect(wrapper.findAll('.zm-relation-arrow')).toHaveLength(1)

    exposed.updateRelation(id, { arrow: 'none' })
    await flushPromises()
    expect(wrapper.findAll('.zm-relation-arrow')).toHaveLength(0)

    exposed.updateRelation(id, { arrow: 'both' })
    await flushPromises()
    expect(wrapper.findAll('.zm-relation-arrow')).toHaveLength(2)
  })

  it('addRelation rejects self / duplicate / unknown pairs', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)

    expect(exposed.addRelation('a', 'a')).toBeNull()
    expect(exposed.addRelation('a', 'zzz')).toBeNull()
    expect(exposed.addRelation('a', 'b')).toBeTruthy()
    expect(exposed.addRelation('a', 'b')).toBeNull()
    expect(exposed.getRelations()).toHaveLength(1)
  })

  it('updateRelation sets the label, rendered as SVG text', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)

    const id = exposed.addRelation('a', 'b')!
    await flushPromises()
    expect(wrapper.find('.zm-relation-label').exists()).toBe(false)

    exposed.updateRelation(id, { label: '依赖' })
    await flushPromises()
    const label = wrapper.find('.zm-relation-label')
    expect(label.exists()).toBe(true)
    expect(label.text()).toBe('依赖')
  })

  it('removing an endpoint node drops the relation', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)

    exposed.addRelation('a1', 'b')
    exposed.addRelation('a', 'b')
    expect(exposed.getRelations()).toHaveLength(2)

    // Removing 'a' also removes its descendant 'a1' — both
    // relations must go.
    exposed.removeNode('a')
    await flushPromises()
    expect(exposed.getRelations()).toHaveLength(0)
    await flushPromises()
    expect(wrapper.find('.zm-relation-path').exists()).toBe(false)
  })

  it('undo/redo restores and re-removes the relation', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)

    exposed.addRelation('a', 'b')
    expect(exposed.getRelations()).toHaveLength(1)

    exposed.undo()
    await flushPromises()
    expect(exposed.getRelations()).toHaveLength(0)
    expect(wrapper.find('.zm-relation-path').exists()).toBe(false)

    exposed.redo()
    await flushPromises()
    expect(exposed.getRelations()).toHaveLength(1)
    expect(wrapper.find('.zm-relation-path').exists()).toBe(true)
  })

  it('removeRelation deletes the line (and its handles)', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)

    const id = exposed.addRelation('a', 'b')!
    await flushPromises()
    exposed.removeRelation(id)
    await flushPromises()
    expect(exposed.getRelations()).toHaveLength(0)
    expect(wrapper.find('.zm-relation-path').exists()).toBe(false)
    expect(wrapper.find('.zm-relation-handle').exists()).toBe(false)
  })

  it('export/import JSON round-trips relations', async () => {
    const wrapper = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed = exposeOf(wrapper)

    const id = exposed.addRelation('a', 'b')!
    exposed.updateRelation(id, { label: 'L' })
    const json = exposed.exportData()

    const wrapper2 = mount(MindMap, { props: { data: sampleData() } })
    await flushPromises()
    const exposed2 = exposeOf(wrapper2)
    expect(exposed2.importData(json)).toBe(true)
    await flushPromises()
    const rels = exposed2.getRelations()
    expect(rels).toHaveLength(1)
    expect(rels[0].fromId).toBe('a')
    expect(rels[0].toId).toBe('b')
    expect(rels[0].label).toBe('L')
    expect(wrapper2.find('.zm-relation-path').exists()).toBe(true)
  })
})
