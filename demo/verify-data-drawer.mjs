// Smoke test against the consumer demo (port 7860), using the
// *published* flow-mindmap package.  Verifies the new canvas
// right-click "查看数据" flow works end-to-end through the
// public package.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7860/'
const outDir = 'verify-output'

// Use Unicode escapes for the Chinese label so the file is safe
// to read in any encoding.  查看数据 = U+67E5 U+770B U+6570 U+636E.
const DATA_LABEL = '\u67E5\u770B\u6570\u636E'

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

// 1) Right-click on empty canvas -> canvas context menu shows
//    the new "查看数据" option.
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
  const items = (await menu.locator('.zm-canvas-menu-item').allTextContents()).map((s) => s.trim())
  console.log('canvas menu items:', items)
  if (!items.includes(DATA_LABEL)) {
    console.error('canvas menu missing data item, got:', JSON.stringify(items))
    await browser.close()
    process.exit(1)
  }
  console.log('canvas right-click -> 查看数据 option: OK')
  await page.screenshot({ path: `${outDir}/demo-16-canvas-menu-two.png`, fullPage: true })

  // 2) Click 查看数据 -> menu closes, data drawer opens.
  await menu.locator('.zm-canvas-menu-item').filter({ hasText: DATA_LABEL }).click()
  await page.waitForTimeout(300)
  if ((await page.locator('.zm-canvas-menu').count()) !== 0) {
    console.error('canvas menu did not close after click')
    await browser.close()
    process.exit(1)
  }
  const dataDrawer = page.locator('.zm-drawer--right:has(.zm-data-panel)')
  if ((await dataDrawer.count()) !== 1) {
    console.error('data drawer did not open after click')
    await browser.close()
    process.exit(1)
  }
  console.log('click 查看数据 -> data drawer opens: OK')
  await page.screenshot({ path: `${outDir}/demo-17-data-drawer.png`, fullPage: true })
}

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('DATA-DRAWER DEMO VERIFY OK (against published flow-mindmap@0.3.4)')