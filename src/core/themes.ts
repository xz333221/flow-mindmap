// =====================================================================
// Canvas theme presets — the two default "skins" the canvas ships
// with.  A preset only carries the colours that define the map's
// look (canvas, root card, branch card, body text, connecting lines);
// every other knob (line width, palette, layout) is orthogonal and
// carried by `MindMapSettings`.
//
// Two ways to consume them:
//   1. `<MindMap :theme="DARK_THEME" />` — host owns the choice.
//   2. Settings panel → 画布 → 主题, which flips
//      `MindMapSettings.themeMode` and picks the preset internally.
// A host-provided `theme` prop always wins field-by-field, so a
// custom brand colour can ride on top of either preset.
// =====================================================================

import type { MindMapTheme } from '../types'

export type ThemeMode = 'light' | 'dark'

/** The six colours a preset owns.  Kept as a `Required<…>` slice of
 *  `MindMapTheme` so a preset is directly usable as a `theme` prop. */
export type ThemeColors = Required<
  Pick<
    MindMapTheme,
    'rootBg' | 'rootText' | 'branchBg' | 'branchText' | 'lineColor' | 'bgColor'
  >
>

export interface ThemePreset {
  id: ThemeMode
  name: string
  theme: ThemeColors
}

/** Light skin — the long-standing default (slate-tinted paper). */
export const LIGHT_THEME: ThemeColors = {
  rootBg: '#1f2937',
  rootText: '#ffffff',
  branchBg: '#ffffff',
  branchText: '#1f2937',
  lineColor: '#94a3b8',
  bgColor: '#f8fafc',
}

/**
 * Dark skin — deep navy paper, elevated root card, light body text.
 *
 * The branch nodes keep using the rainbow tints (they are drawn as
 * translucent fills over the paper), but their *text* has to move
 * the opposite way from the light skin: on light paper a branch hue
 * is darkened for contrast, on dark paper it is lightened.  That
 * swap lives in `MindMap.vue` (`nodeFg`), keyed off `themeMode`.
 */
export const DARK_THEME: ThemeColors = {
  rootBg: '#334155',
  rootText: '#f8fafc',
  branchBg: '#1e293b',
  branchText: '#e2e8f0',
  lineColor: '#64748b',
  bgColor: '#0f172a',
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'light', name: '浅色', theme: LIGHT_THEME },
  { id: 'dark', name: '深色', theme: DARK_THEME },
] as const

/** Resolve a preset by id; unknown / undefined falls back to light
 *  (matches the historical default, so existing callers that never
 *  set `themeMode` render exactly as before). */
export function resolveThemePreset(id: string | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0]
}
