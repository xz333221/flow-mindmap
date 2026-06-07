import { ref } from 'vue'
import type { MindMapNode } from '../types'

/**
 * Linear undo/redo history for the mind map.
 *
 * Each entry stores the data tree (full JSON snapshot).
 * Snapshots are deep-cloned JSON strings (one string per state).  The
 * timeline is bounded so a long session doesn't grow without limit.
 */
export interface HistoryState {
  data: MindMapNode
}

export function useHistory(maxSize = 100) {
  const states = ref<string[]>([])
  let cursor = -1

  function canUndo() {
    return cursor > 0
  }
  function canRedo() {
    return cursor < states.value.length - 1
  }

  function record(snapshot: HistoryState) {
    const json = JSON.stringify(snapshot)
    if (cursor < states.value.length - 1) {
      states.value = states.value.slice(0, cursor + 1)
    }
    states.value.push(json)
    cursor = states.value.length - 1
    while (states.value.length > maxSize) {
      states.value.shift()
      cursor--
    }
  }

  function undo(): HistoryState | null {
    if (!canUndo()) return null
    cursor--
    return JSON.parse(states.value[cursor]) as HistoryState
  }

  function redo(): HistoryState | null {
    if (!canRedo()) return null
    cursor++
    return JSON.parse(states.value[cursor]) as HistoryState
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
