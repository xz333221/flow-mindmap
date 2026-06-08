/**
 * Shared utilities for the rich body of a MindMap node (code /
 * table / list / paragraph).  Used by both the canvas (MindMap.vue)
 * and the right-side panel (NotePanel.vue) so the on-canvas
 * preview and the panel preview render the same way.
 */
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// Register the languages we actually expect to see.  Each
// registration is ~1-3KB minified, so the cost of importing all
// 12 stays well under 100KB.  Add more here when needed.
const langs: Record<string, unknown> = {
  bash, sh: bash, shell: bash,
  css,
  go, golang: go,
  java,
  javascript: javascript, js: javascript,
  json,
  markdown: markdown, md: markdown,
  python: python, py: python,
  rust: rust, rs: rust,
  sql,
  typescript: typescript, ts: typescript,
  xml, html: xml,
  yaml: yaml, yml: yaml,
}
for (const [name, def] of Object.entries(langs)) {
  hljs.registerLanguage(name, def as never)
}

/** Strip the opening and closing ``` fences from a code block,
 *  returning just the body.  Handles both ``` and ~~~ markers. */
export function stripCodeFence(raw: string): string {
  const lines = raw.split('\n')
  if (/^(`{3,}|~{3,})/.test(lines[0] ?? '')) lines.shift()
  if (/^(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1] ?? '')) lines.pop()
  return lines.join('\n').replace(/\n+$/, '')
}

/** Detect the info-string from the opening fence.  Returns an
 *  empty string when the block has no fence or the language
 *  isn't one of our registered ones (so callers can fall back
 *  to a plain `<pre>`). */
export function codeLang(raw: string): string {
  const m = /^(`{3,}|~{3,})([^\s`~]*)/.exec(raw.split('\n')[0] ?? '')
  const tag = (m?.[2] ?? '').toLowerCase()
  if (!tag) return ''
  return langs[tag] ? tag : ''
}

/** Run highlight.js on a code body and return sanitized HTML.
 *  Falls back to an escaped plain-text version when the language
 *  isn't registered — never throws.  `body` should already be
 *  fence-stripped (see `stripCodeFence`). */
export function highlightCode(body: string, lang: string): string {
  const tag = lang && langs[lang] ? lang : ''
  try {
    if (tag) {
      return hljs.highlight(body, { language: tag, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(body).value
  } catch {
    return escapeHtml(body)
  }
}

/** Split a pipe-delimited table into rows of cells, dropping the
 *  alignment separator row.  Each inner array is the cells of one
 *  row.  The first row is conventionally the header. */
export function tableRows(raw: string): string[][] {
  return raw
    .split('\n')
    .filter(l => l.trim().length > 0)
    .filter(l => !/^\s*\|?\s*(:?-+:?\s*\|\s*)+(:?-+:?)(\s*\|)?\s*$/.test(l))
    .map(l =>
      l
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map(c => c.trim())
    )
}

/** Re-join a 2-D cell array into pipe-delimited markdown.  Used
 *  when the user edits a table in CSV/textarea form and we need
 *  to push it back into `richContent.raw`. */
export function rowsToTable(rows: string[][]): string {
  return rows.map(r => '| ' + r.join(' | ') + ' |').join('\n')
}

/** Tiny HTML escaper for the no-language fallback path. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Sort a 2-D cell array in place around a chosen column.  The
 *  first row is the header and stays pinned at the top.
 *  Direction is `'asc'` | `'desc'`.  When every value in the
 *  column parses as a finite number the sort is numeric,
 *  otherwise lexical (locale-aware).  Stable across equal keys.
 *  Doesn't mutate the input. */
export type SortDir = 'asc' | 'desc'
export function sortTable(
  rows: string[][],
  col: number,
  dir: SortDir
): string[][] {
  if (rows.length <= 1) return rows.slice()
  const [head, ...body] = rows
  const sample = body.map(r => r[col] ?? '')
  const allNumeric =
    sample.length > 0 &&
    sample.every(v => v.trim() !== '' && !Number.isNaN(Number(v)))
  const sign = dir === 'asc' ? 1 : -1
  const sorted = body.slice().sort((a, b) => {
    const av = a[col] ?? ''
    const bv = b[col] ?? ''
    if (allNumeric) {
      return (Number(av) - Number(bv)) * sign
    }
    return av.localeCompare(bv, 'zh-Hans-CN', { numeric: true }) * sign
  })
  return [head, ...sorted]
}

