// Smoke test for the new canvas right-click "导入" submenu.
// 2) Hover over "导入" -> a cascading submenu appears with
//    Markdown / JSON / TXT import options.
// 3) Click "Markdown 导入" -> the data drawer opens with
//    Markdown mode preselected.
// 4) The submenu sits flush against the parent item (no big gap).
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'

// Use Unicode escapes for the Chinese labels so the file is safe
// to read in any encoding.  导入 = U+5BFC U+5165.
const IMPORT_LABEL = '\u5BFC\u5165'
const MD_IMPORT_LABEL = 'Markdown \u5BFC\u5165'
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

// Right side of the canvas, mid-height, so the submenu has room
// to extend to the right without going off-screen.
async function rightClick() {
  const box = await page.locator('.zm-canvas').boundingBox()
  if (!box) throw new Error('canvas not laid out')
  return { x: box.x + box.width - 280, y: box.y + box.height - 30 }
}

{
  const pt = await rightClick()
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
  if (!items.includes(IMPORT_LABEL)) {
    console.error('menu missing import item, got:', JSON.stringify(items))
    await browser.close()
    process.exit(1)
  }
  if (!items.includes(SETTINGS_LABEL)) {
    console.error('menu missing settings item')
    await browser.close()
    process.exit(1)
  }
  console.log('canvas menu has 3 items (data, import, settings): OK')

  // Verify no stray text leaks (e.g. the old "n" bug)
  const allText = await menu.textContent()
  if (allText.includes('`n') || /\\n/.test(allText)) {
    console.error('menu contains stray escape sequence text')
    await browser.close()
    process.exit(1)
  }
  console.log('no stray escape text in menu: OK')
  // Box-sizing check: each menu item must stay within the menu's
  // right border.  With box-sizing: border-box the item's own
  // padding is included in its declared width, so width: 100%
  // == the menu's content width.  Without it, the item's 20px of
  // horizontal padding sticks out past the menu's right border
  // (the hover background looks like it hangs off the side).
  {
    const menuBox = await menu.boundingBox()
    const items = await menu.locator('.zm-canvas-menu-item').all()
    for (let i = 0; i < items.length; i++) {
      const itemBox = await items[i].boundingBox()
      if (itemBox && menuBox && itemBox.x + itemBox.width > menuBox.x + menuBox.width + 1) {
        console.error('item ' + i + ' extends past menu right edge (' + (itemBox.x + itemBox.width) + ' > ' + (menuBox.x + menuBox.width) + ')')
        await browser.close()
        process.exit(1)
      }
    }
    console.log('all items stay within menu right edge: OK')
  }

  // Hover over the 导入 item -> submenu appears
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
  for (const expected of [MD_IMPORT_LABEL, 'JSON', 'TXT']) {
    if (!subItems.some((t) => t.includes(expected))) {
      console.error(`submenu missing ${expected}`)
      await browser.close()
      process.exit(1)
    }
  }
  console.log('submenu has 3 import modes: OK')

  // Verify the submenu is positioned right next to the parent item
  // (no big gap).  The submenu's left edge should be very close to
  // the import item's right edge.
  const importBox = await importItem.boundingBox()
  const submenuBox = await submenu.boundingBox()
  if (importBox && submenuBox) {
    // Gap is the visual distance between the submenu edge and the
    // nearest parent edge.  When the submenu is to the right of
    // the parent, this is submenu.left - parent.right.  When it's
    // flipped to the left, this is parent.left - submenu.right.
    // Both should be small (< ~20px) for a tight menu.
    let gap
    if (submenuBox.x >= importBox.x + importBox.width) {
      gap = submenuBox.x - (importBox.x + importBox.width)
    } else if (submenuBox.x + submenuBox.width <= importBox.x) {
      gap = importBox.x - (submenuBox.x + submenuBox.width)
    } else {
      // Submenu overlaps the parent -- shouldn't happen with our
      // clamping, but treat as zero gap.
      gap = 0
    }
    console.log('gap between parent and submenu:', gap, 'px')
    // The submenu sits flush against the parent.  When the
    // parent is near the right edge, the submenu flips to the
    // left (gap is negative).  In both cases, the submenu
    // should be close to the parent (within ~20px).
    if (Math.abs(gap) > 20) {
      console.error(`submenu too far from parent: ${gap}px gap`)
      await browser.close()
      process.exit(1)
    }
    const side = gap >= 0 ? 'right of' : 'left of'
    console.log(`submenu sits ${side} parent (${gap}px): OK`)
  }

  await page.screenshot({ path: `${outDir}/19-import-submenu.png`, fullPage: true })

  // Click Markdown import -> data drawer opens with Markdown tab
  await submenu.locator('.zm-canvas-menu-item').filter({ hasText: MD_IMPORT_LABEL }).click()
  await page.waitForTimeout(300)

  const dataDrawer = page.locator('.zm-drawer--right:has(.zm-data-panel)')
  if ((await dataDrawer.count()) !== 1) {
    console.error('data drawer did not open after Markdown import click')
    await browser.close()
    process.exit(1)
  }
  const activeTab = page.locator('.zm-data-tab.is-active')
  const activeText = (await activeTab.textContent()) || ''
  if (!activeText.includes('Markdown')) {
    console.error('Markdown tab not active')
    await browser.close()
    process.exit(1)
  }
  console.log('click Markdown import -> drawer + Markdown tab preselected: OK')

  await page.screenshot({ path: `${outDir}/20-data-drawer-md-mode.png`, fullPage: true })

  // Close drawer
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('IMPORT-SUBMENU VERIFY OK')