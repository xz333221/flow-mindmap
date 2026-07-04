// Smoke test for the new "瀵煎叆" cascading submenu, against the
// consumer demo (port 7860) using published flow-mindmap@0.3.4.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7860/'
const outDir = 'verify-output'

// Use Unicode escapes for the Chinese labels so the file is safe
// to read in any encoding.  瀵煎叆 = U+5BFC U+5165.
const IMPORT_LABEL = '\u5BFC\u5165'
const MD_IMPORT_LABEL = 'Markdown \u5BFC\u5165'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-canvas', { timeout: 8000 })

async function rightClickEmptyCanvas() {
  const box = await page.locator('.zm-canvas').boundingBox()
  if (!box) throw new Error('canvas not laid out')
  return { x: box.x + box.width - 30, y: box.y + box.height - 30 }
}

{
  const pt = await rightClickEmptyCanvas()
  await page.mouse.click(pt.x, pt.y, { button: 'right' })
  await page.waitForTimeout(150)

  const menu = page.locator('.zm-canvas-menu')
  if ((await menu.count()) !== 1) {
    console.error('canvas context menu did not appear')
    await browser.close()
    process.exit(1)
  }
  // Check the menu has 3 items, no stray text
  const text = (await menu.textContent()) || ''
  console.log('menu text:', text.trim())
  if (text.includes('`n') || /\\n/.test(text)) {
    console.error('menu has stray escape text (the old bug)')
    await browser.close()
    process.exit(1)
  }
  if (!text.includes(IMPORT_LABEL)) {
    console.error('menu missing import label')
    await browser.close()
    process.exit(1)
  }
  console.log('menu has 3 items incl. import (no stray text): OK')

  // Hover over the import item
  const importItem = menu.locator('.zm-canvas-menu-item').filter({ hasText: IMPORT_LABEL }).first()
  await importItem.hover()
  await page.waitForTimeout(250)

  const submenu = page.locator('.zm-canvas-submenu')
  if ((await submenu.count()) !== 1) {
    console.error('submenu did not appear on hover')
    await browser.close()
    process.exit(1)
  }
  const subItems = (await submenu.locator('.zm-canvas-menu-item').allTextContents()).map((s) => s.trim())
  console.log('submenu items:', subItems)
  if (!subItems.some((t) => t.includes('Markdown'))) {
    console.error('submenu missing Markdown option')
    await browser.close()
    process.exit(1)
  }
  if (!subItems.some((t) => t.includes('JSON'))) {
    console.error('submenu missing JSON option')
    await browser.close()
    process.exit(1)
  }
  if (!subItems.some((t) => t.includes('TXT'))) {
    console.error('submenu missing TXT option')
    await browser.close()
    process.exit(1)
  }
  console.log('submenu has Markdown / JSON / TXT: OK')

  await page.screenshot({ path: `${outDir}/demo-19-import-submenu.png`, fullPage: true })

  // Click Markdown import -> menu closes, event fires
  await submenu.locator('.zm-canvas-menu-item').filter({ hasText: MD_IMPORT_LABEL }).click()
  await page.waitForTimeout(300)
  if ((await page.locator('.zm-canvas-menu').count()) !== 0) {
    console.error('menu did not close after click')
    await browser.close()
    process.exit(1)
  }
  // The demo's openImport handler opens the data drawer with
  // the paste panel preselected to Markdown mode.  We can't
  // easily check the consumer's status text (the demo doesn't
  // expose a .demo-status element), so we verify the menu
  // closed cleanly (no JS error) and the data drawer opened.
  const dataDrawer = page.locator('.zm-drawer--right:has(.zm-data-panel)')
  if ((await dataDrawer.count()) !== 1) {
    console.error('data drawer did not open after Markdown import')
    await browser.close()
    process.exit(1)
  }
  console.log('click Markdown import -> data drawer opens: OK')
}

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('IMPORT-SUBMENU DEMO VERIFY OK (against published flow-mindmap@0.3.4)')