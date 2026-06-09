import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// 1) Click r_code (has link + note + code)
const codeNode = page.locator('[data-node-id="r_code"]').first()
await codeNode.click()
await page.waitForTimeout(400)
const codePanel = await page.evaluate(() => {
  const sections = Array.from(document.querySelectorAll('.zm-note-section .zm-note-section-title')).map(e => e.textContent?.trim())
  const hasLink = !!document.querySelector('.zm-note-link-chip')
  const hasCode = !!document.querySelector('.zm-note-code')
  const hasImage = !!document.querySelector('.zm-note-image')
  const hasTable = !!document.querySelector('.zm-note-table')
  const headerTitle = document.querySelector('.zm-app-drawer-title, .zm-drawer-title')?.textContent?.trim()
  return { sections, hasLink, hasCode, hasImage, hasTable, headerTitle }
})
console.log('CODE_NODE_PANEL', JSON.stringify(codePanel))
await page.screenshot({ path: 'verify-output/panel-code.png', fullPage: false })

// 2) Click r_image
const imgNode = page.locator('[data-node-id="r_image"]').first()
await imgNode.click()
await page.waitForTimeout(400)
const imgPanel = await page.evaluate(() => {
  const sections = Array.from(document.querySelectorAll('.zm-note-section .zm-note-section-title')).map(e => e.textContent?.trim())
  return { sections }
})
console.log('IMAGE_NODE_PANEL', JSON.stringify(imgPanel))
await page.screenshot({ path: 'verify-output/panel-image.png', fullPage: false })

// 3) Click r_table
const tblNode = page.locator('[data-node-id="r_table"]').first()
await tblNode.click()
await page.waitForTimeout(400)
const tblPanel = await page.evaluate(() => {
  const sections = Array.from(document.querySelectorAll('.zm-note-section .zm-note-section-title')).map(e => e.textContent?.trim())
  return { sections }
})
console.log('TABLE_NODE_PANEL', JSON.stringify(tblPanel))
await page.screenshot({ path: 'verify-output/panel-table.png', fullPage: false })

// 4) Click a plain leaf (r_code_a) — only has no fields, should show just note (empty) + placeholder
const leaf = page.locator('[data-node-id="r_code_a"]').first()
await leaf.click()
await page.waitForTimeout(400)
const leafPanel = await page.evaluate(() => {
  const sections = Array.from(document.querySelectorAll('.zm-note-section .zm-note-section-title')).map(e => e.textContent?.trim())
  const meta = document.querySelector('.zm-note-meta')?.textContent?.trim()
  return { sections, meta }
})
console.log('LEAF_NODE_PANEL', JSON.stringify(leafPanel))
await page.screenshot({ path: 'verify-output/panel-leaf.png', fullPage: false })

// 5) Type in textarea and verify commit emits
const ta = page.locator('.zm-note-textarea').first()
await ta.fill('这是一段新笔记\n多行测试')
await ta.blur()
await page.waitForTimeout(300)
const commitCheck = await page.evaluate(() => {
  // The data tree has been mutated — verify the selected node's note now contains the text
  // by checking the panel's draft
  return document.querySelector('.zm-note-textarea')?.value
})
console.log('LEAF_NOTE_AFTER_EDIT', JSON.stringify(commitCheck))

console.log('ERRORS', JSON.stringify(errors))
await browser.close()
