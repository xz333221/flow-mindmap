// Stress test: load the #stress fixture (7+7 root children spread
// across a large vertical span), take screenshots, and assert that
// every root-edge anchor's y is inside the root box (so the line
// visibly starts on the root rectangle, not floating above/below).
//
// Run after the dev server is up:
//   node scripts/stress.mjs

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

// Switch to the stress fixture.
await page.goto(`${url.replace(/\/$/, '')}/#stress`, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/stress-01-initial.png`, fullPage: true })

const result = await page.evaluate(() => {
  const root = document.querySelector('.zm-node.is-root')
  if (!root) return null
  const r = root.getBoundingClientRect()
  // For every edge path, get its start point in screen coords and
  // the side (left/right of root) the line lives on.
  const edges = []
  for (const p of document.querySelectorAll('.zm-edges path')) {
    const total = p.getTotalLength()
    const startPt = p.getPointAtLength(0)
    const ctm = p.getScreenCTM()
    if (!ctm) continue
    const sx = ctm.a * startPt.x + ctm.c * startPt.y + ctm.e
    const sy = ctm.b * startPt.x + ctm.d * startPt.y + ctm.f
    edges.push({ start: { x: sx, y: sy } })
  }
  return {
    rootTop: r.top,
    rootBottom: r.bottom,
    rootLeft: r.left,
    rootRight: r.right,
    rootWidth: r.width,
    rootHeight: r.height,
    edges,
  }
})

if (!result) {
  console.error('root not found')
  process.exit(1)
}
const { rootTop, rootBottom, rootLeft, rootRight, edges } = result
console.log(
  `root rect: top=${rootTop.toFixed(0)} bot=${rootBottom.toFixed(0)} ` +
    `L=${rootLeft.toFixed(0)} R=${rootRight.toFixed(0)} h=${(rootBottom - rootTop).toFixed(0)}`
)
console.log(`total edges: ${edges.length}`)

// Identify root edges (those whose start x is near rootLeft or rootRight
// within ±25px, OR whose start y is near rootTop or rootBottom within
// ±2px — anchors can now sit on any of the 4 root edges, not just
// left/right).
let rootEdges = 0
let offBox = 0
const offBoxExamples = []
for (const e of edges) {
  const nearLeft = Math.abs(e.start.x - rootLeft) < 25
  const nearRight = Math.abs(e.start.x - rootRight) < 25
  const nearTop = Math.abs(e.start.y - rootTop) < 2
  const nearBottom = Math.abs(e.start.y - rootBottom) < 2
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) continue
  rootEdges++
  // The anchor must be on the root rectangle boundary (not inside
  // or floating outside it). For top/bottom anchors, x must also
  // be inside the root's horizontal extent; for left/right anchors,
  // y must be inside the vertical extent.
  const insideX = e.start.x >= rootLeft - 1 && e.start.x <= rootRight + 1
  const insideY = e.start.y >= rootTop - 1 && e.start.y <= rootBottom + 1
  if (nearTop || nearBottom) {
    if (!insideX) {
      offBox++
      if (offBoxExamples.length < 5) offBoxExamples.push(e.start)
    }
  } else {
    if (!insideY) {
      offBox++
      if (offBoxExamples.length < 5) offBoxExamples.push(e.start)
    }
  }
}
console.log(`root edges: ${rootEdges}, off-box anchors: ${offBox}`)
if (offBox > 0) {
  console.error('FAIL: root-edge anchors outside the root box:', offBoxExamples)
  process.exit(1)
}

// Assert 7+7 = at least 14 root edges are detected.
if (rootEdges < 14) {
  console.error(`expected at least 14 root edges (7+7), got ${rootEdges}`)
  process.exit(1)
}

// Trigger balanced layout and re-check.
await page.locator('.zm-tb-btn[title*="平衡"]').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${outDir}/stress-02-balanced.png`, fullPage: true })

const result2 = await page.evaluate(() => {
  const root = document.querySelector('.zm-node.is-root')
  const r = root.getBoundingClientRect()
  const edges = []
  for (const p of document.querySelectorAll('.zm-edges path')) {
    const startPt = p.getPointAtLength(0)
    const ctm = p.getScreenCTM()
    if (!ctm) continue
    const sx = ctm.a * startPt.x + ctm.c * startPt.y + ctm.e
    const sy = ctm.b * startPt.x + ctm.d * startPt.y + ctm.f
    edges.push({ start: { x: sx, y: sy } })
  }
  return {
    rootTop: r.top,
    rootBottom: r.bottom,
    rootLeft: r.left,
    rootRight: r.right,
    edges,
  }
})
// balanced mode: re-derive
let offBox2 = 0
for (const e of result2.edges) {
  const nearLeft = Math.abs(e.start.x - result2.rootLeft) < 25
  const nearRight = Math.abs(e.start.x - result2.rootRight) < 25
  const nearTop = Math.abs(e.start.y - result2.rootTop) < 2
  const nearBottom = Math.abs(e.start.y - result2.rootBottom) < 2
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) continue
  const insideX = e.start.x >= result2.rootLeft - 1 && e.start.x <= result2.rootRight + 1
  const insideY = e.start.y >= result2.rootTop - 1 && e.start.y <= result2.rootBottom + 1
  if (nearTop || nearBottom) {
    if (!insideX) offBox2++
  } else {
    if (!insideY) offBox2++
  }
}
console.log(`balanced: off-box anchors: ${offBox2}`)
if (offBox2 > 0) {
  console.error('FAIL: in balanced mode, root-edge anchors outside the root box')
  process.exit(1)
}

await browser.close()
if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('STRESS OK')
