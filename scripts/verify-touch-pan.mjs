// Probe: on a phone, a one-finger drag on the empty canvas pans the map.
// Before the change the gesture fell through to the left-button marquee
// path and the browser stole the move (pointercancel) — the canvas
// never moved. Uses real CDP touch events, not synthetic PointerEvents,
// so `touch-action` and the browser's gesture recognizer are in play.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(300)

const cdp = await context.newCDPSession(page)

async function touchDrag(x0, y0, x1, y1, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x0, y: y0, id: 1 }],
  })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps, id: 1 }],
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(120)
}

const offset = () =>
  page.evaluate(() => {
    const t = document.querySelector('.zm-world')?.style.transform || ''
    const m = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  })

// Find a point on the canvas that is not a node / toolbar / control.
const start = await page.evaluate(() => {
  const canvas = document.querySelector('.zm-canvas')
  const r = canvas.getBoundingClientRect()
  for (let y = r.top + 60; y < r.bottom - 60; y += 20) {
    for (let x = r.left + 30; x < r.right - 30; x += 20) {
      const el = document.elementFromPoint(x, y)
      if (!el) continue
      if (el.closest('.zm-node, .zm-toolbar, button, input, textarea, .zm-relations')) continue
      return { x, y }
    }
  }
  return null
})
if (!start) {
  console.error('no empty canvas point found')
  await browser.close()
  process.exit(1)
}

const before = await offset()
await touchDrag(start.x, start.y, start.x - 90, start.y - 60)
const after = await offset()
const dx = after.x - before.x
const dy = after.y - before.y
console.log(`pan delta: dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)

if (Math.abs(dx + 90) > 12 || Math.abs(dy + 60) > 12) {
  console.error('FAIL: canvas did not follow the finger')
  console.error('errors:', errors.join(' | ') || '(none)')
  await browser.close()
  process.exit(1)
}
console.log('canvas pans with one finger: ✓')

// A tap (no movement) must NOT pan the canvas.
const tapBefore = await offset()
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: start.x, y: start.y, id: 1 }],
})
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await page.waitForTimeout(150)
const tapAfter = await offset()
if (tapAfter.x !== tapBefore.x || tapAfter.y !== tapBefore.y) {
  console.error(`FAIL: tap moved the canvas (${tapBefore.x}→${tapAfter.x})`)
  await browser.close()
  process.exit(1)
}
console.log('tap does not pan: ✓')

// Dragging a NODE on touch must still drag the node, not pan the canvas.
const nodeBox = await page.locator('.zm-node').nth(1).boundingBox()
const nodeOffsetBefore = await offset()
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2, id: 1 }],
})
for (let i = 1; i <= 8; i++) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      {
        x: nodeBox.x + nodeBox.width / 2 + i * 6,
        y: nodeBox.y + nodeBox.height / 2 + i * 4,
        id: 1,
      },
    ],
  })
  await page.waitForTimeout(16)
}
const ghostVisible = await page
  .locator('.zm-drag-ghost')
  .first()
  .isVisible()
  .catch(() => false)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await page.waitForTimeout(120)
const nodeOffsetAfter = await offset()

if (!ghostVisible) {
  console.error('FAIL: node drag ghost never appeared on touch')
  await browser.close()
  process.exit(1)
}
if (nodeOffsetAfter.x !== nodeOffsetBefore.x || nodeOffsetAfter.y !== nodeOffsetBefore.y) {
  console.error('FAIL: dragging a node panned the canvas')
  await browser.close()
  process.exit(1)
}
console.log('node drag on touch still drags the node: ✓')

if (errors.length) {
  console.error('console errors:', errors.join(' | '))
  await browser.close()
  process.exit(1)
}

console.log('all touch checks passed')
await browser.close()
