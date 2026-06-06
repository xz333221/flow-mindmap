// Manual interactive test: open the demo, click the settings
// button, click each lineStyle button, capture screenshots, and
// report the resulting canvas state.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

const errors = []
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(500)

// 1. Read the current lineStyle from the MindMap component's
// internal settings (visible via Vue devtools, or by reading the
// emitted fill of edges).  Easier: just read the active class on
// the lineStyle buttons in the settings panel.
const initial = await page.evaluate(() => {
  const settings = document.querySelector('.zm-settings-popover')
  if (!settings) return { open: false }
  const buttons = Array.from(settings.querySelectorAll('.zm-line-style-btn'))
  return {
    open: true,
    active: buttons.find((b) => b.classList.contains('is-on'))?.textContent?.trim(),
    buttons: buttons.map((b) => b.textContent?.trim()),
  }
})
console.log('initial settings panel state:', initial)

// 2. Open the settings popover.
await page.locator('.zm-app-icon-btn[title="显示设置"]').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/manual-01-settings-open.png`, fullPage: true })

// 3. Read the active lineStyle button BEFORE clicking.
const beforeClick = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('.zm-line-style-btn'))
  return buttons.map((b) => ({
    label: b.textContent?.trim(),
    isOn: b.classList.contains('is-on'),
  }))
})
console.log('before click:', beforeClick)

// 4. Click the 圆弧 button (it's the first one).
await page.locator('.zm-line-style-btn').first().click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/manual-02-after-curve-click.png`, fullPage: true })

const afterCurve = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('.zm-line-style-btn'))
  return buttons.map((b) => ({
    label: b.textContent?.trim(),
    isOn: b.classList.contains('is-on'),
  }))
})
console.log('after 圆弧 click:', afterCurve)

// 5. Click the 直线 button (second one).
await page.locator('.zm-line-style-btn').nth(1).click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/manual-03-after-straight-click.png`, fullPage: true })

const afterStraight = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('.zm-line-style-btn'))
  return buttons.map((b) => ({
    label: b.textContent?.trim(),
    isOn: b.classList.contains('is-on'),
  }))
})
console.log('after 直线 click:', afterStraight)

// 6. Compare edge path d attribute between curve and straight:
//    curve should be `M ... C ...`, straight should be `M ... L ... L ...`.
const edgesByStyle = await page.evaluate(() => {
  const out = []
  for (const p of document.querySelectorAll('.zm-edges path')) {
    const d = p.getAttribute('d') || ''
    out.push({ hasC: d.includes(' C '), starts: d.slice(0, 4), length: d.length })
  }
  return out
})
console.log('straight-mode edges:', edgesByStyle.slice(0, 3))

// 7. Click back to 圆弧.
await page.locator('.zm-line-style-btn').first().click()
await page.waitForTimeout(300)
const edgesAfterCurve = await page.evaluate(() => {
  const out = []
  for (const p of document.querySelectorAll('.zm-edges path')) {
    const d = p.getAttribute('d') || ''
    out.push({ hasC: d.includes(' C '), starts: d.slice(0, 4), length: d.length })
  }
  return out
})
console.log('curve-mode edges:', edgesAfterCurve.slice(0, 3))

await browser.close()
if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
