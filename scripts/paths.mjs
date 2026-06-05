import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:7851/', { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(800)
const paths = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.zm-edges path')).map(p => p.getAttribute('d'))
})
console.log(paths.join('\n'))
await browser.close()
