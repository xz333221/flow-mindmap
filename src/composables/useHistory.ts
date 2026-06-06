import { ref } from 'vue'
import type { MindMapNode } from '../types'

/**
 * Linear undo/redo history for the mind map data.
 *
 * The model:
 *   - `record(snapshot)` appends a NEW state to the timeline.  Call it
 *     AFTER applying a mutation (so the snapshot reflects the new tree).
 *     The cursor advances to the new state.
 *   - `undo()` returns the previous state, moving the cursor one step
 *     back.  Returns null if the cursor is already at the start.
 *   - `redo()` returns the next state, moving the cursor forward.
 *     Returns null if the cursor is already at the end.
 *
 *   - `record` invalidates any "future" history past the cursor — like
 *     a text editor after a new edit, you can't redo over a branch.
 *
 * Snapshots are deep-cloned JSON strings.  The timeline is bounded so
 * a long session doesn't grow without limit.
 */
export function useHistory(maxSize = 100) {
  // ordered list of all states we've ever recorded (oldest first)
  const states = ref<string[]>([])
  // index into `states` of the current state (-1 = empty)
  let cursor = -1

  function canUndo() {
    return cursor > 0
  }
  function canRedo() {
    return cursor < states.value.length - 1
  }

  function record(snapshot: MindMapNode) {
    const json = JSON.stringify(snapshot)
    // if the cursor isn't at the latest state, drop the "future" first
    if (cursor < states.value.length - 1) {
      states.value = states.value.slice(0, cursor + 1)
    }
    states.value.push(json)
    cursor = states.value.length - 1
    // bound the timeline
    while (states.value.length > maxSize) {
      states.value.shift()
      cursor--
    }
  }

  function undo(): MindMapNode | null {
    if (!canUndo()) return null
    cursor--
    return JSON.parse(states.value[cursor]) as MindMapNode
  }

  function redo(): MindMapNode | null {
    if (!canRedo()) return null
    cursor++
    return JSON.parse(states.value[cursor]) as MindMapNode
  }

  function reset() {
    states.value = []
    cursor = -1
  }

  return {
    canUndo,
    canRedo,
    record,
    undo,
    redo,
    reset,
  }
}
