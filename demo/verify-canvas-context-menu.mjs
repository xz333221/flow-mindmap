// Smoke test against the consumer demo (port 7860), using the
// *published* flow-mindmap package.  Verifies the canvas
// right-click -> settings flow works end-to-end.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7860/'
const outDir = 'verify-output'

// Use Unicode escapes for the Chinese label so the file is safe to
// read in any encoding.  设置 = U+8BBE U+7F6E.
const SETTINGS_LABEL = '\u8BBE\u7F6E'
const CANVAS_SETTINGS_EVENT = 'canvas-settings'

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
  const items = (await menu.locator('.zm-canvas-menu-item').allTextContents()).map((s) => s.trim())
  console.log('canvas menu items:', items)
  if (!items.includes(SETTINGS_LABEL)) {
    console.error('canvas menu missing settings item, got:', JSON.stringify(items))
    await browser.close()
    process.exit(1)
  }
  console.log('canvas right-click -> settings option: OK')

  await page.screenshot({ path: `${outDir}/demo-14-canvas-menu.png`, fullPage: true })

  // Click settings -> the demo's onCanvasSettings opens the
  // settings drawer.  Verify the drawer opened (handler ran
  // without error).
  await menu.locator('.zm-canvas-menu-item').filter({ hasText: SETTINGS_LABEL }).click()
  await page.waitForTimeout(300)

  const settingsDrawer = page.locator('.zm-drawer--right:has(.zm-settings-panel)')
  if ((await settingsDrawer.count()) !== 1) {
    console.error('settings drawer did not open after click')
    await browser.close()
    process.exit(1)
  }
  console.log('click settings -> settings drawer opens: OK')

  await page.screenshot({ path: `${outDir}/demo-15-settings-drawer.png`, fullPage: true })

  // Escape closes the drawer.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  if ((await page.locator('.zm-drawer--right:has(.zm-settings-panel)').count()) !== 0) {
    console.error('Escape did not close the settings drawer')
    await browser.close()
    process.exit(1)
  }
  console.log('Escape closes settings drawer: OK')

  // Right-click again on canvas, then click outside -> menu closes.
  const pt2 = await rightClickEmptyCanvas()
  await page.mouse.click(pt2.x, pt2.y, { button: 'right' })
  await page.waitForTimeout(150)
  if ((await page.locator('.zm-canvas-menu').count()) !== 1) {
    console.error('canvas menu did not re-appear on second right-click')
    await browser.close()
    process.exit(1)
  }
  await page.mouse.click(20, 20)
  await page.waitForTimeout(150)
  if ((await page.locator('.zm-canvas-menu').count()) !== 0) {
    console.error('outside click did not close the canvas menu')
    await browser.close()
    process.exit(1)
  }
  console.log('outside click closes canvas menu: OK')
}

// The existing per-node right-click menu should still work
// (smoke check that we didn't break it).
{
  const node = page.locator('.zm-node').first()
  const box = await node.boundingBox()
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await page.waitForTimeout(200)
    if ((await page.locator('.zm-node-menu').count()) < 1) {
      console.error('node right-click menu broke')
      await browser.close()
      process.exit(1)
    }
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  console.log('node right-click menu still works: OK')
}

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('CANVAS-CONTEXT-MENU DEMO VERIFY OK (against published flow-mindmap@0.3.4)')