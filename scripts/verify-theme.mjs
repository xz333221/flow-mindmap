// Probe: the two built-in skins (浅色 / 深色) and the picker that
// toggles them.  Saves screenshots under tmp/shots/ so they can be
// eyeballed side by side.
//
// Checks (beyond "it renders"):
//   1. dark mode actually repaints the canvas paper, and
//   2. branch text flips to a LIGHT hue (darkening it, the light-mode
//      direction, paints near-black text on a near-black canvas).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = fileURLToPath(new URL('../tmp/shots/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url + '?theme=light', { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/theme-light.png` })

const readCanvas = () =>
  page.evaluate(() => {
    const root = document.querySelector('.zm-mindmap')
    // Skip the root card: its text is white in BOTH skins, so it
    // would never catch the dark/light text direction.
    const branch = document.querySelector('.zm-node:not(.is-root)')
    const label = branch?.querySelector('.zm-text-label') ?? branch
    const path = document.querySelector('.zm-svg path')
    return {
      theme: root.getAttribute('data-theme'),
      paper: getComputedStyle(root).backgroundColor,
      text: label ? getComputedStyle(label).color : null,
      line: path ? getComputedStyle(path).stroke : null,
    }
  })

const light = await readCanvas()
console.log('light:', JSON.stringify(light))

// Flip to dark through the real settings drawer (not a JS shortcut),
// so the picker wiring is exercised too.  The drawer is opened from
// the canvas context menu — that is the demo app's only entry point.
await page.mouse.click(1200, 780, { button: 'right' })
await page.waitForSelector('.zm-canvas-menu', { timeout: 4000 })
await page.locator('.zm-canvas-menu-item', { hasText: '设置' }).first().click()
await page.waitForTimeout(500)
await page.locator('.zm-theme-btn', { hasText: '深色' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/theme-picker.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/theme-dark.png` })

const dark = await readCanvas()
console.log('dark:', JSON.stringify(dark))

function lum(rgb) {
  const m = rgb.match(/\d+/g)
  if (!m) return null
  const [r, g, b] = m.slice(0, 3).map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exitCode = 1
}

if (light.theme !== 'light' || dark.theme !== 'dark') fail(`data-theme not switched (${light.theme} → ${dark.theme})`)
if (!(lum(light.paper) > 200)) fail(`light paper is not light: ${light.paper}`)
if (!(lum(dark.paper) < 60)) fail(`dark paper is not dark: ${dark.paper}`)
if (!(lum(dark.text) > 140)) fail(`dark branch text too dark for the dark paper: ${dark.text}`)
if (!(lum(light.text) < 120)) fail(`light branch text should stay dark: ${light.text}`)

if (errors.length) fail('console errors: ' + errors.join(' | '))
if (!process.exitCode) console.log('theme probe OK')
await browser.close()
