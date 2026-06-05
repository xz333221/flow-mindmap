import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/01-initial.png`, fullPage: true })

// count nodes
const nodeCount = await page.locator('.zm-node').count()
console.log(`rendered nodes: ${nodeCount}`)

// check SVG edges
const edgeCount = await page.locator('.zm-edges path').count()
console.log(`rendered edges: ${edgeCount}`)

// hover a node to show buttons, then add a child
const firstNode = page.locator('.zm-node').nth(1)
await firstNode.hover()
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/02-hover.png` })

// click a branch node (e.g. "核心功能") and press Tab to add child
await firstNode.click()
await page.waitForTimeout(150)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/03-after-add.png` })
const nodeCountAfter = await page.locator('.zm-node').count()
console.log(`nodes after add: ${nodeCountAfter}`)

// type a name and press Enter to commit
await page.keyboard.type('Tab 创建的子节点')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/04-after-edit.png` })

// zoom in via toolbar
await page.locator('.zm-tb-btn').first().click()
await page.locator('.zm-tb-btn').first().click()
await page.waitForTimeout(150)
await page.screenshot({ path: `${outDir}/05-zoomed.png` })

// reset view
await page.locator('.zm-tb-btn[title="重置视图"]').click()
await page.waitForTimeout(150)
await page.screenshot({ path: `${outDir}/06-reset.png`, fullPage: true })

// drag persistence: drag the "核心功能" node and check it stays moved
const target = page.locator('.zm-node').nth(1)
const before = await target.boundingBox()
await target.hover()
await page.mouse.down()
await page.mouse.move(before.x + 250, before.y - 80, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const after = await target.boundingBox()
const dx = after.x - before.x
const dy = after.y - before.y
console.log(`drag delta: dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)
if (Math.abs(dx) < 100 || Math.abs(dy) < 50) {
  console.error('drag did not persist!')
  process.exit(1)
}
await page.screenshot({ path: `${outDir}/07-after-drag.png`, fullPage: true })

// debug: log all node positions
const positions = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.zm-node')).map((n) => {
    const r = n.getBoundingClientRect()
    return { text: n.textContent?.trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y) }
  })
})
console.log('positions after drag:')
for (const p of positions) console.log(' ', p)

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('VERIFY OK')
