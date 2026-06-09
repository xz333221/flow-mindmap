import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// 1) Code block on the canvas should have hljs spans
const codeHljs = await page.evaluate(() => {
  const code = document.querySelector('[data-node-id="r_code"] .zm-rich-code code')
  if (!code) return { error: 'no code' }
  return {
    hasHljsSpans: code.innerHTML.includes('hljs-'),
    html: code.innerHTML.slice(0, 200),
  }
})
console.log('CODE_HLJS', JSON.stringify(codeHljs))

// 2) Table on the canvas should have clickable sort headers
const tblSort = await page.evaluate(() => {
  const ths = document.querySelectorAll('[data-node-id="r_table"] .zm-rich-table-sort')
  return { thCount: ths.length, firstMark: ths[0]?.querySelector('.zm-rich-sort-mark')?.textContent }
})
console.log('TBL_SORT', JSON.stringify(tblSort))

// 3) Click a column header — sort should toggle
const beforeRows = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-node-id="r_table"] .zm-rich-table tr'))
  return rows.map(r => Array.from(r.children).map(c => c.textContent?.trim()))
})
await page.locator('[data-node-id="r_table"] .zm-rich-table-sort').first().click()
await page.waitForTimeout(200)
const afterRows = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-node-id="r_table"] .zm-rich-table tr'))
  return rows.map(r => Array.from(r.children).map(c => c.textContent?.trim()))
})
console.log('TBL_BEFORE', JSON.stringify(beforeRows))
console.log('TBL_AFTER_ASC', JSON.stringify(afterRows))

// Click again — desc
await page.locator('[data-node-id="r_table"] .zm-rich-table-sort').first().click()
await page.waitForTimeout(200)
const afterDesc = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-node-id="r_table"] .zm-rich-table tr'))
  return rows.map(r => Array.from(r.children).map(c => c.textContent?.trim()))
})
console.log('TBL_AFTER_DESC', JSON.stringify(afterDesc))

// 4) Panel: code block should be highlighted (click the title span, not the rich body)
const codeNode = page.locator('[data-node-id="r_code"] .zm-text').first()
await codeNode.click()
await page.waitForTimeout(400)
const panelHljs = await page.evaluate(() => {
  const code = document.querySelector('.zm-note-code code')
  if (!code) return { error: 'no panel code' }
  return {
    hasHljsSpans: code.innerHTML.includes('hljs-'),
    html: code.innerHTML.slice(0, 200),
  }
})
console.log('PANEL_CODE_HLJS', JSON.stringify(panelHljs))

// 5) Panel: link section has input + chip
const panelLink = await page.evaluate(() => {
  return {
    hasInput: !!document.querySelector('.zm-note-section input[type="url"]'),
    hasChip: !!document.querySelector('.zm-note-link-chip'),
  }
})
console.log('PANEL_LINK', JSON.stringify(panelLink))

// 6) Panel: edit code textarea and verify re-highlight
const codeTextarea = page.locator('.zm-note-input-code').first()
await codeTextarea.fill('```js\nconst foo = 42\n```')
await page.waitForTimeout(300)
const liveHl = await page.evaluate(() => {
  const code = document.querySelector('.zm-note-code code')
  return code?.innerHTML.includes('hljs-')
})
console.log('PANEL_LIVE_REHIGHLIGHT', liveHl)

// 7) Sort the table from the panel
const tblNode = page.locator('[data-node-id="r_table"] .zm-text').first()
await tblNode.click()
await page.waitForTimeout(300)
const beforePanelTbl = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.zm-note-table tr')).map(r =>
    Array.from(r.children).map(c => c.textContent?.trim())
  )
})
console.log('PANEL_TBL_BEFORE_SORT', JSON.stringify(beforePanelTbl))
await page.locator('.zm-note-table-sort').first().click()
await page.waitForTimeout(200)
const afterPanelSort = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.zm-note-table tr')).map(r =>
    Array.from(r.children).map(c => c.textContent?.trim())
  )
})
console.log('PANEL_TBL_AFTER_ASC', JSON.stringify(afterPanelSort))

// 8) Dblclick the on-canvas code block → edit textarea appears
const canvasCode = page.locator('[data-node-id="r_code"] .zm-rich-code')
await canvasCode.dblclick()
await page.waitForTimeout(300)
const editVisible = await page.evaluate(() => {
  return !!document.querySelector('[data-node-id="r_code"] .zm-rich-edit')
})
console.log('CANVAS_EDIT_OPENED', editVisible)
// Commit by pressing Escape
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
const editClosed = await page.evaluate(() => {
  return !document.querySelector('[data-node-id="r_code"] .zm-rich-edit')
})
console.log('CANVAS_EDIT_CLOSED', editClosed)

await page.screenshot({ path: 'verify-output/panel-with-hl.png', fullPage: false })
await page.locator('[data-node-id="r_code"] .zm-rich-table-sort, [data-node-id="r_code"] .zm-rich-code').first().scrollIntoViewIfNeeded()
await page.screenshot({ path: 'verify-output/canvas-with-hl.png', fullPage: false })

console.log('ERRORS', JSON.stringify(errors))
await browser.close()
