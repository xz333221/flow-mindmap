import { onMounted, onBeforeUnmount } from 'vue'

export interface KeyboardOptions {
  isEditing: () => boolean
  isReadonly: () => boolean
  getSelectedId: () => string | null
  /**
   * Multi-select view of the current selection. Returned in
   * preorder (root-first) so consumers can iterate top-down.
   * Empty when nothing is selected. */
  getSelectedIds: () => string[]
  /**
   * Called when Tab/Enter fires and no node is selected — defaults the
   * action to the root node so the user can build a tree from scratch
   * without first clicking something.
   */
  defaultTargetId?: () => string
  onAddChild: (id: string) => void
  onAddSibling: (id: string) => void
  onAddSiblingBefore: (id: string) => void
  onRemove: (id: string) => void
  onStartEdit: (id: string) => void
  onClearSelection: () => void
  onDuplicate: (id: string) => void
  /** Copy the currently selected subtrees into the host's clipboard
   *  buffer.  No-op when the selection is empty. */
  onCopy: (ids: string[]) => void
  /** Cut the currently selected subtrees (copy + remove from tree).
   *  No-op when the selection is empty. */
  onCut: (ids: string[]) => void
  /** Paste the host's clipboard buffer under `targetId` (defaults to
   *  the primary selected node, or the root when nothing is selected).
   *  `targetId === null` means "default to root". */
  onPaste: (targetId: string | null) => void
  onUndo: () => void
  onRedo: () => void
  /**
   * Move selection to a neighbour.  Returns the new selected id (or null
   * if no neighbour exists in that direction).
   *   dx = -1  → select first child
   *   dx = +1  → select parent
   *   dy = -1  → select previous sibling
   *   dy = +1  → select next sibling
   */
  onNavigate: (dx: number, dy: number) => void
  onSelectRoot: () => void
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

// Either Ctrl (Win/Linux) or Cmd (mac) counts as the primary modifier.
// Both can also be detected for cross-platform muscle memory.
function modKey(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey
}

export function useKeyboard(opts: KeyboardOptions) {
  function targetId(): string | null {
    const sel = opts.getSelectedId()
    if (sel) return sel
    if (opts.defaultTargetId) return opts.defaultTargetId()
    // No getRootId() in the new options shape — fall back to the
    // first selected id (which the multi-select getter would have
    // returned as primary) or null.
    const ids = opts.getSelectedIds()
    return ids.length > 0 ? ids[0] : null
  }

  function onKey(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement | null
    // Ignore when typing in any text input / textarea / contentEditable.
    if (
      tgt &&
      (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)
    ) {
      return
    }
    if (opts.isReadonly()) return
    // The editing-in-input case is the common one (commit edit by Enter,
    // etc.) but our composer has its own keydown handlers on the
    // <input>. We only fall through to global shortcuts when nothing is
    // being edited.
    if (opts.isEditing()) return

    const sel = opts.getSelectedId()
    const id = targetId()
    if (!id) return

    // ----- editing-area commits handled locally -----
    // (none — the inline input is its own input element; the global
    //  listener skips when an <input> is focused, which is the only
    //  editing case.)

    // ----- modifier-based shortcuts -----
    if (modKey(e) && !e.shiftKey) {
      if (e.key === 'd' || e.key === 'D') {
        const rootId = opts.defaultTargetId?.()
        if (sel && sel !== rootId) {
          e.preventDefault()
          opts.onDuplicate(sel)
        }
        return
      }
      if (e.key === 'c' || e.key === 'C') {
        const ids = opts.getSelectedIds()
        if (ids.length > 0) {
          e.preventDefault()
          opts.onCopy(ids)
        }
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        const ids = opts.getSelectedIds()
        if (ids.length > 0) {
          e.preventDefault()
          opts.onCut(ids)
        }
        return
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        const ids = opts.getSelectedIds()
        opts.onPaste(ids.length > 0 ? ids[0] : null)
        return
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        opts.onUndo()
        return
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        opts.onRedo()
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        opts.onSelectRoot()
        return
      }
    }
    if (modKey(e) && e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
      e.preventDefault()
      opts.onRedo()
      return
    }

    // ----- single-key shortcuts -----
    if (e.key === 'Tab') {
      e.preventDefault()
      opts.onAddChild(id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        // Shift+Enter: insert a sibling BEFORE the current node
        const rootId = opts.defaultTargetId?.()
        if (sel && sel !== rootId) opts.onAddSiblingBefore(sel)
      } else {
        opts.onAddSibling(id)
      }
    } else if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      sel &&
      sel !== opts.defaultTargetId?.()
    ) {
      e.preventDefault()
      opts.onRemove(sel)
    } else if (e.key === 'F2' && sel) {
      e.preventDefault()
      opts.onStartEdit(sel)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      opts.onClearSelection()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      opts.onNavigate(0, +1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      opts.onNavigate(0, -1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      opts.onNavigate(+1, 0)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      opts.onNavigate(-1, 0)
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
  })
}
