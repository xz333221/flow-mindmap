import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', msg => console.log(`[${msg.type()}]`, msg.text()))
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.screenshot({ path: 'verify-output/zoom-table.png', fullPage: true })

// Find the table node and inspect its box vs layout-reported coords
const data = await page.evaluate(() => {
  const tbl = document.querySelector('[data-node-id="r_table"]')
  if (!tbl) return { error: 'no r_table' }
  const r = tbl.getBoundingClientRect()
  const zmNode = tbl.closest('.zm-node')
  const zmRect = zmNode?.getBoundingClientRect()
  // Find the path that ends near the table node
  const svg = document.querySelector('.zm-svg-layer svg')
  const paths = svg ? Array.from(svg.querySelectorAll('path')) : []
  return {
    tableEl: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height },
    zmNode: zmRect ? { left: zmRect.left, right: zmRect.right, top: zmRect.top, bottom: zmRect.bottom, w: zmRect.width, h: zmRect.height } : null,
    inlineStyle: tbl.closest('.zm-node')?.style?.cssText,
    // rich body box
    richEl: (() => {
      const rich = tbl.querySelector('.zm-rich')
      if (!rich) return null
      const rr = rich.getBoundingClientRect()
      return { left: rr.left, right: rr.right, top: rr.top, bottom: rr.bottom, w: rr.width, h: rr.height, scrollH: rich.scrollHeight, clientH: rich.clientHeight }
    })(),
    pathsCount: paths.length,
  }
})
console.log('INSPECT', JSON.stringify(data, null, 2))
await browser.close()
