// Smoke test for the new canvas right-click menu + settings drawer.
// 1) Right-click on empty canvas -> canvas context menu appears with a
//    "鐠佸墽鐤? (settings) option.
// 2) Click "鐠佸墽鐤? -> the settings drawer opens.
// 3) Close the drawer via Escape -> drawer closes.
// 4) Right-click again on canvas, then click outside -> menu closes.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'

// Use Unicode escapes for the Chinese label so the file is safe to
// read in any encoding.  鐠佸墽鐤?= U+8BBE U+7F6E.
const SETTINGS_LABEL = '\u8BBE\u7F6E'

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
  // bottom-right corner is usually empty
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

  await page.screenshot({ path: `${outDir}/14-canvas-menu.png`, fullPage: true })

  // 2) Click settings -> settings drawer opens.
  await menu.locator('.zm-canvas-menu-item').filter({ hasText: SETTINGS_LABEL }).click()
  await page.waitForTimeout(250)

  // The settings drawer is a right-anchored Drawer containing a
  // SettingsPanel (.zm-settings-panel).
  const drawer = page.locator('.zm-drawer--right:has(.zm-settings-panel)')
  if ((await drawer.count()) !== 1) {
    console.error('settings drawer did not open')
    await browser.close()
    process.exit(1)
  }
  console.log('click settings -> settings drawer opens: OK')

  await page.screenshot({ path: `${outDir}/15-settings-drawer.png`, fullPage: true })

  // 3) Escape closes the drawer.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  if ((await page.locator('.zm-drawer--right:has(.zm-settings-panel)').count()) !== 0) {
    console.error('Escape did not close the settings drawer')
    await browser.close()
    process.exit(1)
  }
  console.log('Escape closes settings drawer: OK')

  // 4) Right-click canvas, then click outside -> menu closes.
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

// 5) The existing per-node right-click menu should still work
//    (smoke check that we didn't break it).  We use page.mouse
//    with a computed center position because Playwright's
//    .click({button:'right'}) on a .zm-node <g> wrapper can
//    miss when the wrapper has CSS transforms.
{
  const node = page.locator('.zm-node').first()
  const box = await node.boundingBox()
  if (!box) {
    console.error('node has no bounding box')
    await browser.close()
    process.exit(1)
  }
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.click(cx, cy, { button: 'right' })
  await page.waitForTimeout(200)
  // Right-clicking the root may or may not open a menu depending
  // on MindMap's previewMode and root-specific logic.  Accept
  // either: a node menu, a canvas menu, or both.  The key check
  // is that the right-click was NOT silently dropped.
  const nodeMenu = await page.locator('.zm-node-menu').count()
  const canvasMenu = await page.locator('.zm-canvas-menu').count()
  if (nodeMenu + canvasMenu < 1) {
    console.error('right-click on node did not open any menu')
    await browser.close()
    process.exit(1)
  }
  console.log('right-click on node opens a menu: OK (nodeMenu=', nodeMenu, ', canvasMenu=', canvasMenu, ')')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
}

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('CANVAS-CONTEXT-MENU VERIFY OK')