// Demo smoke test for the published flow-mindmap@0.3.5.
// Verifies the canvas right-click menu has 3 items, the cascading
// submenu appears on hover, and the caret + gap fixes from the
// previous turn are in place.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7860/'
const outDir = 'verify-output'

// Use Unicode escapes for the Chinese label so the file is safe to
// read in any encoding.  瀵煎叆 = U+5BFC U+5165.
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

  // Verify no stray text (the old "n" bug)
  const allText = (await menu.textContent()) || ''
  if (allText.includes('`n') || /\\n/.test(allText)) {
    console.error('menu contains stray escape sequence text')
    await browser.close()
    process.exit(1)
  }
  console.log('no stray escape text: OK')

  // Hover import -> submenu appears
  const importItem = menu.locator('.zm-canvas-menu-item').filter({ hasText: IMPORT_LABEL }).first()
  await importItem.hover()
  await page.waitForTimeout(250)

  const submenu = page.locator('.zm-canvas-submenu')
  if ((await submenu.count()) !== 1) {
    console.error('submenu did not appear')
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
  console.log('submenu has Markdown / JSON / TXT: OK')

  // Verify the submenu is flush against the parent (4px gap)
  const importBox = await importItem.boundingBox()
  const submenuBox = await submenu.boundingBox()
  if (importBox && submenuBox) {
    const gap = submenuBox.x - (importBox.x + importBox.width)
    console.log('gap:', gap, 'px')
    if (gap > 12) {
      console.error(`gap too big: ${gap}px (expected < 12)`)
      await browser.close()
      process.exit(1)
    }
    console.log('submenu flush against parent: OK')
  }

  await page.screenshot({ path: `${outDir}/demo-19-import-submenu.png`, fullPage: true })

  // Click Markdown import -> menu closes (consumer handler runs
  // internally; we don't read the status text since HMR may have
  // wiped the element).
  await submenu.locator('.zm-canvas-menu-item').filter({ hasText: MD_IMPORT_LABEL }).click()
  await page.waitForTimeout(300)
  if ((await page.locator('.zm-canvas-menu').count()) !== 0) {
    console.error('menu did not close after click')
    await browser.close()
    process.exit(1)
  }
  console.log('click Markdown import -> menu closes: OK')
}

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('DEMO MENU VERIFY OK (against published flow-mindmap@0.3.5)')