import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const data = await page.evaluate(() => {
  const tbl = document.querySelector('[data-node-id="r_table"]')
  const zmNode = tbl.closest('.zm-node')
  const rect = zmNode.getBoundingClientRect()
  const svg = document.querySelector('.zm-svg-layer svg')
  const svgPaths = Array.from(svg.querySelectorAll('path'))
  // Get the path for root -> r_table
  const svgRect = svg.getBoundingClientRect()
  return {
    tableRect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, w: rect.width, h: rect.height },
    svgRect: { left: svgRect.left, right: svgRect.right, top: svgRect.top, bottom: svgRect.bottom, w: svgRect.width, h: svgRect.height },
    paths: svgPaths.map(p => {
      const r = p.getBoundingClientRect()
      return { d: p.getAttribute('d')?.slice(0, 80), bcr: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }, fill: p.getAttribute('fill') }
    }),
  }
})
console.log(JSON.stringify(data, null, 2))
await browser.close()
