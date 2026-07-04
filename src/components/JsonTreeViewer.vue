<script setup lang="ts">
// Recursive JSON tree viewer.  Renders an object / array as a
// collapsible tree with syntax-highlighted keys and values, plus
// a small thumbnail for any value that looks like an image (data
// URL, http(s) URL, or known file extension).
//
// Designed for the MindMap data tree (MindMapNode) but works on
// any plain JS value.  Stateful in two ways:
//   - collapsedPaths: a Set of unique path strings the user has
//     collapsed.  Toggled by clicking the chevron.  Default state
//     for a fresh tree: deep objects/arrays are auto-collapsed at
//     depth >= 3 so the panel doesn't explode on big trees.
//   - query: optional substring filter; matching keys/values are
//     highlighted and non-matching subtrees are hidden.

import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    value: unknown
    /** Initial key for this node; empty string when rendering the root. */
    keyName?: string
    /** When true, the node is at the root of the tree. */
    isRoot?: boolean
    /** Dot-separated path from the root.  Auto-derived when nested. */
    path?: string
    /** Current depth in the tree (root = 0). */
    depth?: number
    /** Current filter query (case-insensitive substring). */
    query?: string
    /** Pre-computed set of collapsed paths (so the parent's state survives
     *  across re-renders when a different subtree is expanded). */
    collapsedPaths?: Set<string>
  }>(),
  { keyName: '', isRoot: true, path: '', depth: 0, query: '', collapsedPaths: () => new Set<string>() }
)

const type = computed(() => {
  if (props.value === null) return 'null'
  if (Array.isArray(props.value)) return 'array'
  return typeof props.value // 'object' | 'string' | 'number' | 'boolean' | 'undefined'
})

/** True when the value is a plain object (not null, not array). */
const isObject = computed(() => type.value === 'object')
const isArray = computed(() => type.value === 'array')
const isPrimitive = computed(() => !isObject.value && !isArray.value)

/** Length / entry count summary for collapsible preview. */
const sizeLabel = computed(() => {
  if (isArray.value) return `Array(${(props.value as unknown[]).length})`
  if (isObject.value) {
    const o = props.value as Record<string, unknown>
    const keys = Object.keys(o)
    return `Object(${keys.length} ${keys.length === 1 ? 'key' : 'keys'})`
  }
  return ''
})

/** Object / array entries rendered as { key, value } pairs. */
const entries = computed<{ key: string; value: unknown }[]>(() => {
  if (isArray.value) {
    return (props.value as unknown[]).map((v, i) => ({ key: String(i), value: v }))
  }
  if (isObject.value) {
    return Object.entries(props.value as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }))
  }
  return []
})

/** Path used as the unique key for collapse state.  When this node
 *  is the root, just use the root key (so the root doesn't get
 *  collapsed by the default heuristic). */
const myPath = computed(() => (props.isRoot ? '<root>' : props.path))

/** True when the value at this path is currently collapsed. */
const isCollapsed = computed(() => props.collapsedPaths.has(myPath.value))

/** Auto-collapse very deep branches by default.  We expand the
 *  top two levels and collapse the rest so the panel fits without
 *  scrolling.  User can always expand manually. */
function applyDefaultCollapse(p: string, val: unknown, d: number) {
  if (p === '<root>') return
  if (d < 2) return
  if (val === null || typeof val !== 'object') return
  // Only collapse if not already explicitly toggled.
  // The collapsedPaths set is shared, so we just check presence
  // (Set.has) -- if absent, we add the default collapse path.
  if (!props.collapsedPaths.has(p)) props.collapsedPaths.add(p)
}

if (!props.isRoot) {
  applyDefaultCollapse(myPath.value, props.value, props.depth)
}

function toggle() {
  if (isCollapsed.value) {
    props.collapsedPaths.delete(myPath.value)
  } else {
    props.collapsedPaths.add(myPath.value)
  }
}

function childPath(key: string): string {
  return myPath.value === '' ? key : `${myPath.value}.${key}`
}

/** True when this primitive value contains the query substring. */
function primitiveMatches(v: unknown): boolean {
  if (!props.query) return true
  const q = props.query.toLowerCase()
  if (typeof v === 'string') return v.toLowerCase().includes(q)
  if (v === null) return 'null'.includes(q)
  return String(v).toLowerCase().includes(q)
}

/** True when this entry's key contains the query substring. */
function keyMatches(k: string): boolean {
  if (!props.query) return true
  return k.toLowerCase().includes(props.query.toLowerCase())
}

/** Decide whether to show a given child entry.  When there's a
 *  query, hide entries whose key and primitive value both miss.
 *  For nested objects/arrays we always show the entry and let the
 *  child itself hide; otherwise the user can't see nested matches. */
function shouldShowEntry(key: string, value: unknown): boolean {
  if (!props.query) return true
  if (keyMatches(key)) return true
  if (value === null || typeof value !== 'object') return primitiveMatches(value)
  // Object/array: show it; the recursive render will hide
  // non-matching children itself.
  return true
}

/** Format a primitive for display.  Long strings get truncated. */
function displayValue(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') {
    const max = 80
    if (v.length > max) return `"${v.slice(0, max)}..."`
    return `"${v}"`
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'undefined') return 'undefined'
  return JSON.stringify(v)
}

/** Detect an image-like value: a string that starts with data:image/,
 *  is an http(s) URL ending in a common image extension, or
 *  contains an image MIME marker. */
function isImageValue(v: unknown): boolean {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (s.startsWith('data:image/')) return true
  if (/^https?:\/\/.+\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(s)) return true
  if (/^https?:\/\/.+/i.test(s) && /\/[^/]+\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(s)) return true
  return false
}

/** True when the entry is a string value that matches a search. */
function highlightMatch(text: string): { before: string; match: string; after: string } | null {
  if (!props.query) return null
  const i = text.toLowerCase().indexOf(props.query.toLowerCase())
  if (i < 0) return null
  return { before: text.slice(0, i), match: text.slice(i, i + props.query.length), after: text.slice(i + props.query.length) }
}
</script>

<template>
  <!-- Root: just the children, no key prefix. -->
  <div v-if="isRoot" class="zm-jtv-root">
    <div v-for="entry in entries" :key="entry.key" class="zm-jtv-row" v-show="shouldShowEntry(entry.key, entry.value)">
      <JsonTreeViewer
        :key-name="entry.key"
        :value="entry.value"
        :path="childPath(entry.key)"
        :depth="depth + 1"
        :query="query"
        :collapsed-paths="collapsedPaths"
        :is-root="false"
      />
    </div>
  </div>

  <!-- Object / array header + children -->
  <div v-else-if="isObject || isArray" class="zm-jtv-branch" :class="{ 'is-collapsed': isCollapsed }">
    <div class="zm-jtv-header" :style="{ paddingLeft: 6 + depth * 12 + 'px' }" @click="toggle">
      <span class="zm-jtv-toggle" :class="{ 'is-leaf': false }">{{ isCollapsed ? '▶' : '▼' }}</span>
      <span v-if="!isArray" class="zm-jtv-key">{{ keyName }}</span>
      <span v-if="!isArray" class="zm-jtv-colon">:</span>
      <span v-if="isArray" class="zm-jtv-key zm-jtv-bracket">[</span>
      <span v-if="isCollapsed" class="zm-jtv-size">{{ sizeLabel }}</span>
      <span v-if="isCollapsed && isArray" class="zm-jtv-bracket">]</span>
      <span v-if="isCollapsed && isObject" class="zm-jtv-brace">}</span>
    </div>
    <div v-if="!isCollapsed" class="zm-jtv-children">
      <div v-for="entry in entries" :key="entry.key" class="zm-jtv-row" v-show="shouldShowEntry(entry.key, entry.value)">
        <JsonTreeViewer
          :key-name="entry.key"
          :value="entry.value"
          :path="childPath(entry.key)"
          :depth="depth + 1"
          :query="query"
          :collapsed-paths="collapsedPaths"
          :is-root="false"
        />
      </div>
    </div>
    <div v-if="!isCollapsed && isArray" class="zm-jtv-footer" :style="{ paddingLeft: 6 + depth * 12 + 'px' }">]</div>
    <div v-if="!isCollapsed && isObject && !isArray" class="zm-jtv-footer" :style="{ paddingLeft: 6 + depth * 12 + 'px' }">}</div>
  </div>

  <!-- Primitive value row -->
  <div v-else class="zm-jtv-leaf" :style="{ paddingLeft: 6 + depth * 12 + 'px' }">
    <span class="zm-jtv-toggle is-leaf">·</span>
    <span class="zm-jtv-key">{{ keyName }}</span>
    <span class="zm-jtv-colon">:</span>
    <span v-if="keyMatches(keyName) && highlightMatch(keyName)" class="zm-jtv-key">
      <span>{{ highlightMatch(keyName)?.before }}</span><mark>{{ highlightMatch(keyName)?.match }}</mark><span>{{ highlightMatch(keyName)?.after }}</span>
    </span>
    <span :class="['zm-jtv-value', `zm-jtv-${type}`]">
      <template v-if="highlightMatch(displayValue(value))">
        <span>{{ highlightMatch(displayValue(value))?.before }}</span><mark>{{ highlightMatch(displayValue(value))?.match }}</mark><span>{{ highlightMatch(displayValue(value))?.after }}</span>
      </template>
      <template v-else>{{ displayValue(value) }}</template>
    </span>
    <span v-if="isImageValue(value)" class="zm-jtv-thumb-wrap" @click.stop>
      <img class="zm-jtv-thumb" :src="String(value)" :alt="keyName" loading="lazy" referrerpolicy="no-referrer" />
      <a class="zm-jtv-thumb-link" :href="String(value)" target="_blank" rel="noopener noreferrer" @click.stop>open</a>
    </span>
  </div>
</template>

<style>
.zm-jtv-root {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #334155;
}
.zm-jtv-row {
  /* each entry is a row, but the JsonTreeViewer inside handles its
     own padding so this is mostly a positioning hook. */
}
.zm-jtv-branch {
  /* nothing extra; children stack vertically. */
}
.zm-jtv-header {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  border-radius: 3px;
  padding-right: 6px;
  user-select: none;
}
.zm-jtv-header:hover {
  background: #f1f5f9;
}
.zm-jtv-toggle {
  display: inline-block;
  width: 12px;
  text-align: center;
  font-size: 9px;
  color: #94a3b8;
  flex-shrink: 0;
}
.zm-jtv-toggle.is-leaf {
  color: #cbd5e1;
}
.zm-jtv-key {
  color: #1d4ed8;
  font-weight: 500;
}
.zm-jtv-colon {
  color: #94a3b8;
  margin-right: 4px;
}
.zm-jtv-size {
  color: #64748b;
  font-style: italic;
}
.zm-jtv-bracket,
.zm-jtv-brace {
  color: #94a3b8;
  font-weight: 500;
  margin-left: 4px;
}
.zm-jtv-footer {
  color: #94a3b8;
  font-weight: 500;
}
.zm-jtv-leaf {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding-right: 6px;
  border-radius: 3px;
}
.zm-jtv-leaf:hover {
  background: #f8fafc;
}
.zm-jtv-value {
  word-break: break-all;
}
.zm-jtv-string { color: #047857; }
.zm-jtv-number { color: #b45309; }
.zm-jtv-boolean { color: #7c3aed; font-weight: 500; }
.zm-jtv-null { color: #94a3b8; font-style: italic; }
.zm-jtv-undefined { color: #94a3b8; font-style: italic; }
.zm-jtv-thumb-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  flex-shrink: 0;
}
.zm-jtv-thumb {
  max-width: 48px;
  max-height: 32px;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  background: #ffffff;
  object-fit: contain;
}
.zm-jtv-thumb-link {
  font-size: 10px;
  color: #3b82f6;
  text-decoration: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.zm-jtv-thumb-link:hover {
  text-decoration: underline;
}
.zm-jtv-leaf mark,
.zm-jtv-key mark {
  background: #fef08a;
  color: #422006;
  padding: 0 1px;
  border-radius: 2px;
}
</style>