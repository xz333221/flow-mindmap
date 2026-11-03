// Probe: right-click a branch node → "复制节点及子节点" → the system
// clipboard carries the whole subtree as an indented outline, with
// every per-node extra (note / code / table / link / image) inline.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin })
const page = await context.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })

const node = page.locator('.zm-node:has-text("代码块")').first()
await node.click({ button: 'right' })
await page.waitForTimeout(200)

const labels = (await page.locator('.zm-node-menu .zm-node-menu-item').allTextContents()).map((s) => s.trim())
if (!labels.includes('复制节点及子节点')) {
  console.error('menu item missing. got:', labels.join(' | '))
  await browser.close()
  process.exit(1)
}
console.log('menu item present: ✓')

// Click it.  The menu's window mousedown handler closes on outside
// clicks only, so a click on the item keeps the copy path intact.
await page.locator('.zm-node-menu .zm-node-menu-item:has-text("复制节点及子节点")').click()
await page.waitForTimeout(300)

const text = await page.evaluate(() => navigator.clipboard.readText())
console.log('--- clipboard ---\n' + text + '\n-----------------')

const expect = (cond, msg) => {
  if (!cond) {
    console.error('FAIL: ' + msg)
    process.exitCode = 1
  }
}
expect(text.startsWith('代码块'), 'starts with the right-clicked node text')
expect(/^ {2}- 等宽字体,自动换行$/m.test(text), 'includes a child bullet')
expect(text.includes('笔记:') && text.includes('代码块以 richContent 形式携带'), 'includes the node note')
expect(text.includes('```'), 'includes the rich body raw markdown')

// Depth check from the root: level-1 and level-2 bullets must be
// indented by 2 and 4 spaces respectively.
await page.locator('.zm-canvas').click({ position: { x: 40, y: 40 } })
await page.waitForTimeout(150)
await page.locator('.zm-node:has-text("flow-mindmap 节点能力一览")').first().click({ button: 'right' })
await page.waitForTimeout(200)
await page.locator('.zm-node-menu .zm-node-menu-item:has-text("复制节点及子节点")').click()
await page.waitForTimeout(300)
const rootText = await page.evaluate(() => navigator.clipboard.readText())
expect(/^ {2}- 代码块$/m.test(rootText), 'level-1 child indented 2 spaces')
expect(/^ {4}- 等宽字体,自动换行$/m.test(rootText), 'level-2 child indented 4 spaces')
expect(rootText.includes('  链接: https://github.com/xz333221/flow-mindmap'), 'root link included')

if (process.exitCode === 1) {
  await browser.close()
  process.exit(1)
}

// The menu must close after the action.
const stillOpen = await page.locator('.zm-node-menu').count()
expect(stillOpen === 0, 'menu closes after copying')
if (stillOpen !== 0) {
  await browser.close()
  process.exit(1)
}

await page.screenshot({ path: 'verify-output/37-copy-subtree.png' })
await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('COPY-SUBTREE VERIFY OK')
