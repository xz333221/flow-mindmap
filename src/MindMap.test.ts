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
    expect(nodeEl(wrapper, 'b').classes()).toContain('is-selected-secondary')

    // Toggling 'a' off via shift+click — 'b' remains the primary.
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