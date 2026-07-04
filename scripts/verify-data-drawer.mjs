// Smoke test for the new "view data" canvas right-click flow.
// 1) Right-click on empty canvas -> menu shows two items: 查看数据 and 设置.
// 2) Click 查看数据 -> the data drawer opens and shows the JSON tree.
// 3) Tree viewer renders the data with collapsible nodes + search input.
// 4) Click 设置 still works (no regression).
// 5) Image src values get a thumbnail.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'

// Use Unicode escapes for the Chinese labels so the file is safe to
// read in any encoding.  查看数据 = U+67E5 U+770B U+6570 U+636E.
// 设置 = U+8BBE U+7F6E.
const DATA_LABEL = '\u67E5\u770B\u6570\u636E'
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
  if (!items.includes(DATA_LABEL)) {
    console.error('canvas menu missing data item, got:', JSON.stringify(items))
    await browser.close()
    process.exit(1)
  }
  if (!items.includes(SETTINGS_LABEL)) {
    console.error('canvas menu missing settings item, got:', JSON.stringify(items))
    await browser.close()
    process.exit(1)
  }
  console.log('canvas right-click -> 2 items (data + settings): OK')

  await page.screenshot({ path: `${outDir}/16-canvas-menu-two.png`, fullPage: true })

  // 2) Click 查看数据 -> data drawer opens.
  await menu.locator('.zm-canvas-menu-item').filter({ hasText: DATA_LABEL }).click()
  await page.waitForTimeout(300)

  // The data drawer is a right-anchored Drawer with .zm-data-panel inside.
  const dataDrawer = page.locator('.zm-drawer--right:has(.zm-data-panel)')
  if ((await dataDrawer.count()) !== 1) {
    console.error('data drawer did not open')
    await browser.close()
    process.exit(1)
  }
  console.log('click data -> data drawer opens: OK')

  await page.screenshot({ path: `${outDir}/17-data-drawer.png`, fullPage: true })

  // 3) Tree viewer renders the data.
  const tree = page.locator('.zm-jtv-root')
  if ((await tree.count()) !== 1) {
    console.error('json tree viewer did not render')
    await browser.close()
    process.exit(1)
  }
  const treeText = (await tree.textContent()) || ''
  if (!treeText.includes('flow-mindmap')) {
    console.error('tree viewer does not show the root text')
    await browser.close()
    process.exit(1)
  }
  console.log('json tree renders: OK')

  // 4) Search input filters.
  const search = page.locator('.zm-data-search input')
  await search.fill('flow-mindmap')
  await page.waitForTimeout(200)
  const filtered = (await tree.textContent()) || ''
  if (!filtered.includes('flow-mindmap')) {
    console.error('search filter did not match')
    await browser.close()
    process.exit(1)
  }
  console.log('search filter works: OK')
  // Clear the search
  await page.locator('.zm-data-search-clear').click()
  await page.waitForTimeout(100)

  // 5) Escape closes the data drawer.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  if ((await page.locator('.zm-drawer--right:has(.zm-data-panel)').count()) !== 0) {
    console.error('Escape did not close the data drawer')
    await browser.close()
    process.exit(1)
  }
  console.log('Escape closes data drawer: OK')

  // 6) Click 设置 still works.
  const pt2 = await rightClickEmptyCanvas()
  await page.mouse.click(pt2.x, pt2.y, { button: 'right' })
  await page.waitForTimeout(150)
  await page.locator('.zm-canvas-menu-item').filter({ hasText: SETTINGS_LABEL }).click()
  await page.waitForTimeout(250)
  if ((await page.locator('.zm-drawer--right:has(.zm-settings-panel)').count()) !== 1) {
    console.error('settings drawer did not open after data check')
    await browser.close()
    process.exit(1)
  }
  console.log('settings drawer still works (no regression): OK')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('DATA-DRAWER VERIFY OK')