import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } })
await page.goto('http://localhost:7851/#rich', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const data = await page.evaluate(() => {
  const svg = document.querySelector('.zm-svg-layer svg')
  const paths = Array.from(svg.querySelectorAll('path'))
  const p = paths.find(pp => pp.getAttribute('fill') === '#fbbf24')
  return { d: p?.getAttribute('d') }
})
console.log(JSON.stringify(data, null, 2))
await browser.close()
