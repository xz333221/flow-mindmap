import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } })
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
// Reset zoom by reloading
await page.evaluate(() => location.reload())
await page.waitForTimeout(800)

// Zoom to 250%
const plus = page.locator('button[title="放大"]')
for (let i = 0; i < 7; i++) {
  await plus.click()
  await page.waitForTimeout(120)
}
await page.waitForTimeout(500)
await page.screenshot({ path: 'verify-output/zoom-250-table.png', fullPage: false })

// Check ribbon endpoint relative to table box
const data = await page.evaluate(() => {
  const tbl = document.querySelector('[data-node-id="r_table"]').closest('.zm-node')
  const tr = tbl.getBoundingClientRect()
  // Find root node
  const root = document.querySelector('[data-node-id="r_root"]').closest('.zm-node')
  const rr = root.getBoundingClientRect()
  // Find all paths in SVG
  const svg = document.querySelector('.zm-svg-layer svg')
  const paths = Array.from(svg.querySelectorAll('path'))
  // The path that goes from root to r_table: fill #fbbf24
  const p = paths.find(pp => pp.getAttribute('fill') === '#fbbf24')
  const pr = p ? p.getBoundingClientRect() : null
  // Find the bbox of the path
  return {
    root: { l: rr.left, r: rr.right, t: rr.top, b: rr.bottom },
    table: { l: tr.left, r: tr.right, t: tr.top, b: tr.bottom, w: tr.width, h: tr.height },
    path: pr ? { l: pr.left, r: pr.right, t: pr.top, b: pr.bottom, w: pr.width, h: pr.height } : null,
    pathFill: p?.getAttribute('fill'),
    pathsCount: paths.length,
  }
})
console.log(JSON.stringify(data, null, 2))
await browser.close()
