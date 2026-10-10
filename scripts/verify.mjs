import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${outDir}/01-initial.png`, fullPage: true })

// count nodes
const nodeCount = await page.locator('.zm-node').count()
console.log(`rendered nodes: ${nodeCount}`)

// check SVG edges
const edgeCount = await page.locator('.zm-edges path').count()
console.log(`rendered edges: ${edgeCount}`)

// hover a node to show buttons, then add a child
const firstNode = page.locator('.zm-node').nth(1)
await firstNode.hover()
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/02-hover.png` })

// click a branch node (e.g. "核心功能") and press Tab to add child
await firstNode.click()
await page.waitForTimeout(150)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
await page.screenshot({ path: `${outDir}/03-after-add.png` })
const nodeCountAfter = await page.locator('.zm-node').count()
console.log(`nodes after add: ${nodeCountAfter}`)

// type a name and press Enter to commit
await page.keyboard.type('Tab 创建的子节点')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/04-after-edit.png` })

// zoom in via toolbar (addressed by title — the toolbar's leftmost
// button is the outline trigger, so .first() would miss the zoom-in)
await page.locator('.zm-tb-btn[title="放大"]').click()
await page.locator('.zm-tb-btn[title="放大"]').click()
await page.waitForTimeout(150)
await page.screenshot({ path: `${outDir}/05-zoomed.png` })

// reset view
await page.locator('.zm-tb-btn[title="重置视图"]').click()
await page.waitForTimeout(150)
await page.screenshot({ path: `${outDir}/06-reset.png`, fullPage: true })

// Drag is disabled: a mousedown + drag on a node should not move it
// (this is the post-bug-fix contract — see MindMap.vue).  Assert
// that the node stays put and that the gesture doesn't bleed into
// the canvas (no pan, no marquee).
const target = page.locator('.zm-node').nth(1)
const before = await target.boundingBox()
await target.hover()
await page.mouse.down()
await page.mouse.move(before.x + 250, before.y - 80, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const after = await target.boundingBox()
const dx = after.x - before.x
const dy = after.y - before.y
console.log(`drag delta: dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)
if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
  console.error(`node should NOT move on drag, but moved dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)
  process.exit(1)
}
await page.screenshot({ path: `${outDir}/07-after-drag.png`, fullPage: true })

// debug: log all node positions
const positions = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.zm-node')).map((n) => {
    const r = n.getBoundingClientRect()
    return { text: n.textContent?.trim().slice(0, 12), x: Math.round(r.x), y: Math.round(r.y) }
  })
})
console.log('positions after drag:')
for (const p of positions) console.log(' ', p)

// keyboard: select a branch node, press Tab to add a child (it should
// enter edit mode), type some text, press Enter to commit + add a sibling,
// then Ctrl+Z to undo the add-sibling.
//
// The default demo loads the "rich" fixture (节点能力一览).  We use
// "笔记 (note)" as the target branch — it exists in the rich data.
const techNode = page.locator('.zm-node:has-text("笔记")').first()
await techNode.click()
await page.waitForTimeout(150)
const nodesBefore = await page.locator('.zm-node').count()
await page.keyboard.press('Tab')
await page.waitForTimeout(250)
const nodesAfterTab = await page.locator('.zm-node').count()
if (nodesAfterTab !== nodesBefore + 1) {
  console.error(`Tab should add a child: was ${nodesBefore}, now ${nodesAfterTab}`)
  process.exit(1)
}
await page.keyboard.type('Foo')
await page.keyboard.press('Enter') // commits edit
await page.waitForTimeout(200)
// Enter in edit mode only commits; press Enter again to add a sibling
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
const nodesAfterEnter = await page.locator('.zm-node').count()
if (nodesAfterEnter !== nodesAfterTab + 1) {
  console.error(`Enter should commit + add sibling: ${nodesAfterTab} → ${nodesAfterEnter}`)
  process.exit(1)
}
console.log(`Tab + Enter: ${nodesBefore} → ${nodesAfterTab} → ${nodesAfterEnter}`)

// Ctrl+Z to undo the add-sibling
await page.keyboard.down('Control')
await page.keyboard.press('z')
await page.keyboard.up('Control')
await page.waitForTimeout(250)
const nodesAfterUndo = await page.locator('.zm-node').count()
if (nodesAfterUndo !== nodesAfterTab) {
  console.error(`Ctrl+Z should undo add-sibling: ${nodesAfterTab} → ${nodesAfterUndo}`)
  process.exit(1)
}
console.log(`Ctrl+Z: ${nodesAfterEnter} → ${nodesAfterUndo} ✓`)

// also test that Shift+Enter adds a sibling BEFORE the current node.
// Click "悬浮预览" (first child of 笔记) and press Shift+Enter —
// a new node should be inserted before it.
const vueNode = page.locator('.zm-node:has-text("悬浮预览")').first()
await vueNode.click()
await page.waitForTimeout(150)
const beforeSiblingBefore = await page.locator('.zm-node').count()
await page.keyboard.down('Shift')
await page.keyboard.press('Enter')
await page.keyboard.up('Shift')
await page.waitForTimeout(250)
const afterSiblingBefore = await page.locator('.zm-node').count()
if (afterSiblingBefore !== beforeSiblingBefore + 1) {
  console.error(
    `Shift+Enter should add sibling before: ${beforeSiblingBefore} → ${afterSiblingBefore}`
  )
  process.exit(1)
}
console.log(`Shift+Enter: ${beforeSiblingBefore} → ${afterSiblingBefore} ✓`)
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// NOTE: a "balance" toolbar button used to exist (and verify below
// used to click it).  It was hidden in commit c06c0bc; the assertions
// that follow it were never updated to match.  Removed from this
// smoke test — re-add when/if balance UI returns to the toolbar.

// App layout: drawers are closed by default — open them, then assert
// their content renders.  The outline opens via the leftmost button
// of the bottom toolbar; the data drawer opens via the canvas right-click
// menu → "查看数据".
await page.locator('.zm-tb-outline').click()
await page.waitForTimeout(250)
// Right-click on the canvas background to open the context menu,
// then click "查看数据".
await page.mouse.click(400, 400, { button: 'right' })
await page.waitForTimeout(200)
await page.locator('.zm-canvas-menu-item:has-text("查看数据")').click()
await page.waitForTimeout(250)
const outlineRows = await page.locator('.zm-outline-row').count()
const dataPre = await page.locator('.zm-data-panel').count()
console.log(`outline rows: ${outlineRows}, data panels: ${dataPre}`)
if (outlineRows < 14) {
  console.error(`expected at least 14 outline rows, got ${outlineRows}`)
  process.exit(1)
}
if (dataPre !== 1) {
  console.error(`expected 1 data panel, got ${dataPre}`)
  process.exit(1)
}

// copy button: verify the JSON in clipboard matches the source data
// (We can't read the system clipboard in headless Chromium without a
// permission grant, so instead we assert the copy button flips its
// label/state.)
await page.locator('.zm-data-btn:has-text("复制")').click()
await page.waitForTimeout(200)
const copyState = await page.locator('.zm-data-btn.is-success').count()
if (copyState !== 1) {
  console.error('copy button did not flip to success state')
  process.exit(1)
}

// download export: verify the file gets generated.  Listen on
// page.on('download') and assert the filename.
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('.zm-data-btn:has-text("导出")').click(),
])
console.log(`download filename: ${download.suggestedFilename()}`)
if (!download.suggestedFilename().endsWith('.json')) {
  console.error(`export did not produce a .json file: ${download.suggestedFilename()}`)
  process.exit(1)
}

// close the outline drawer and re-open it via the toolbar button
await page.locator('.zm-drawer--left .zm-drawer-close').click()
await page.waitForTimeout(300)
const outlineAfterClose = await page.locator('.zm-outline-row').count()
if (outlineAfterClose !== 0) {
  console.error(`expected 0 outline rows after close, got ${outlineAfterClose}`)
  process.exit(1)
}
await page.locator('.zm-tb-outline').click()
await page.waitForTimeout(300)
const outlineAfterReopen = await page.locator('.zm-outline-row').count()
if (outlineAfterReopen < 14) {
  console.error(`expected at least 14 outline rows after reopen, got ${outlineAfterReopen}`)
  process.exit(1)
}

// outline row copy: hover the first row, then click its copy button.  We
// can't read the system clipboard in headless Chromium without a
// permission grant, so we assert the row's copy button flips to the
// "is-success" state.
const firstRow = page.locator('.zm-outline-row').first()
await firstRow.hover()
await page.waitForTimeout(100)
const rowCopy = firstRow.locator('.zm-outline-row-copy')
await rowCopy.click()
await page.waitForTimeout(150)
const rowCopySuccess = await rowCopy.evaluate((el) => el.classList.contains('is-success'))
if (!rowCopySuccess) {
  console.error('outline row copy did not flip to success state')
  process.exit(1)
}
console.log('outline row copy: success')

// outline action button "复制大纲"
const outlineAction = page.locator('.zm-outline-action-btn')
await outlineAction.click()
await page.waitForTimeout(150)
const outlineActionSuccess = await outlineAction.evaluate((el) => el.classList.contains('is-success'))
if (!outlineActionSuccess) {
  console.error('outline action copy did not flip to success state')
  process.exit(1)
}
console.log('outline action copy: success')

await page.screenshot({ path: `${outDir}/09-app-drawers.png`, fullPage: true })

// Fan layout: switch the data to the #fan fixture (9 top-level
// branches) so the wide-fan anchors at the root are visible. We
// just set location.hash and let the app's hashchange listener pick
// it up — no need to reload the page.
await page.evaluate(() => {
  location.hash = '#fan'
})
await page.waitForTimeout(700)
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.screenshot({ path: `${outDir}/10-fan-compact.png`, fullPage: true })
// trigger balanced (no-op now that the toolbar balance button is hidden;
// kept the screenshot for visual diff with 11-fan-balanced.png)
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/11-fan-balanced.png`, fullPage: true })

// ---------------------------------------------------------------------------
// Multi-select: every picked node wears the SAME ring, and dragging one
// member of the set carries the rest along.  Reload onto the #fan fixture
// so no drawer is covering the canvas.
await page.goto(`${url}#fan`, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(500)

const nodeIds = (selector) =>
  page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).map((n) => n.dataset.nodeId),
    selector
  )

// 1. Two selected nodes must look identical — the ring used to be split
//    into a loud "primary" and a washed-out "secondary".
await page.locator('[data-node-id="n_a"]').click()
await page.locator('[data-node-id="n_b"]').click({ modifiers: ['Shift'] })
await page.waitForTimeout(200)
const pickedIds = (await nodeIds('.zm-node.is-selected')).sort()
const ringColors = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.zm-node.is-selected')).map(
    (n) => getComputedStyle(n).outlineColor
  )
)
console.log(`selected: ${pickedIds.join(',')} rings: ${ringColors.join(' / ')}`)
if (pickedIds.join(',') !== 'n_a,n_b') {
  console.error(`shift-click should select n_a + n_b, got ${pickedIds.join(',')}`)
  process.exit(1)
}
if (ringColors.length !== 2 || new Set(ringColors).size !== 1) {
  console.error(`selection rings must be identical, got ${ringColors.join(' / ')}`)
  process.exit(1)
}
await page.screenshot({ path: `${outDir}/12-multi-select.png`, fullPage: true })

// 2. Grab ONE of the selected nodes and drop it on a third — both must move.
const centreOf = async (id) => {
  const b = await page.locator(`[data-node-id="${id}"]`).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const from = await centreOf('n_a')
const to = await centreOf('n_c')
await page.mouse.move(from.x, from.y)
await page.mouse.down()
await page.mouse.move(from.x + 30, from.y + 30, { steps: 6 })
await page.mouse.move(to.x, to.y, { steps: 12 })
await page.waitForTimeout(200)
const ghostBadge = (await page.locator('.zm-drag-ghost-count').textContent().catch(() => ''))?.trim()
await page.screenshot({ path: `${outDir}/13-multi-drag.png`, fullPage: true })
if (ghostBadge !== '+1') {
  console.error(`multi-drag ghost should advertise "+1", got "${ghostBadge}"`)
  process.exit(1)
}
await page.mouse.up()
await page.waitForTimeout(400)

// Both dragged nodes stay selected after the drop (a stray canvas click
// used to wipe the selection right after pointerup).
const stillSelected = (await nodeIds('.zm-node.is-selected')).sort()
if (stillSelected.join(',') !== 'n_a,n_b') {
  console.error(`dragged set should stay selected, got ${stillSelected.join(',')}`)
  process.exit(1)
}

// Read the resulting tree back through the outline drawer: its rows are
// the tree flattened depth-first, in DOM order.
await page.locator('.zm-tb-outline').click()
await page.waitForTimeout(300)
const outlineIds = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.zm-outline-row')).map((r) => r.dataset.outlineId)
)
await page.screenshot({ path: `${outDir}/14-after-multi-drag.png`, fullPage: true })
const expectedOrder = ['root', 'n_c', 'n_a', 'n_b', 'n_d', 'n_e', 'n_f', 'n_g', 'n_h', 'n_i']
console.log(`outline after drag: ${outlineIds.join(' ')}`)
if (outlineIds.join(',') !== expectedOrder.join(',')) {
  console.error(
    `multi-drag should nest n_a + n_b under n_c.\n  expected: ${expectedOrder.join(' ')}\n  got:      ${outlineIds.join(' ')}`
  )
  process.exit(1)
}
console.log('multi-select drag: 2 nodes moved as a set ✓')
await page.locator('.zm-drawer--left .zm-drawer-close').click()
await page.waitForTimeout(200)

await browser.close()

if (errors.length) {
  console.error('ERRORS:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}
console.log('VERIFY OK')
