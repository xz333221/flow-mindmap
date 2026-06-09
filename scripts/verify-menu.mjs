import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// 1) Verify table has NO scrollbar
const tableOverflow = await page.evaluate(() => {
  const tbl = document.querySelector('[data-node-id="r_table"]')
  if (!tbl) return { error: 'no table' }
  const rich = tbl.querySelector('.zm-rich')
  if (!rich) return { error: 'no rich' }
  const cs = getComputedStyle(rich)
  return {
    overflowX: cs.overflowX,
    overflowY: cs.overflowY,
    maxHeight: cs.maxHeight,
    classList: Array.from(rich.classList),
    scrollH: rich.scrollHeight,
    clientH: rich.clientHeight,
  }
})
console.log('TABLE_RICH_STYLE', JSON.stringify(tableOverflow))

// 2) Open context menu on a regular text node
const target = page.locator('[data-node-id="r_root"]').first()
const box = await target.boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
await page.waitForTimeout(300)

const menuItems = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.zm-node-menu .zm-node-menu-item'))
  return items.map(i => i.textContent?.trim())
})
console.log('MENU_ITEMS', JSON.stringify(menuItems))
await page.screenshot({ path: 'verify-output/context-menu.png', fullPage: false })

// 3) Click "添加代码块" — set up dialog handler first
page.once('dialog', async dialog => {
  await dialog.accept('```ts\nconst x = 1\n```')
})
const codeBtn = page.locator('.zm-node-menu-item', { hasText: /代码块/ })
await codeBtn.first().click()
await page.waitForTimeout(500)

// 4) Check that a NEW node with code richContent was added
const hasCodeNode = await page.evaluate(() => {
  // Look at all nodes, find one with richContent.kind === 'code' that wasn't r_code
  const all = document.querySelectorAll('.zm-node')
  for (const el of all) {
    const id = el.getAttribute('data-node-id')
    if (id === 'r_code') continue
    const rich = el.querySelector('.zm-rich-code')
    if (rich) return { id, hasRich: true }
  }
  return null
})
console.log('NEW_CODE_NODE', JSON.stringify(hasCodeNode))

console.log('ERRORS', JSON.stringify(errors))
await browser.close()
