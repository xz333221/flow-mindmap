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

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('VERIFY OK')
