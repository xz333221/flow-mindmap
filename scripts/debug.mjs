import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:7851/', { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-node', { timeout: 8000 })
await page.waitForTimeout(800)
const info = await page.evaluate(() => {
  const svg = document.querySelector('.zm-svg')
  const svgRect = svg ? svg.getBoundingClientRect() : null
  const world = document.querySelector('.zm-world')
  const worldRect = world ? world.getBoundingClientRect() : null
  const root = document.querySelector('.zm-node.is-root')
  const rootRect = root ? root.getBoundingClientRect() : null
  return {
    svgRect, worldRect, rootRect,
    rootStyle: root ? { left: root.style.left, top: root.style.top, w: root.style.width } : null,
    worldTransform: world?.style.transform,
    viewBox: svg?.getAttribute('viewBox'),
    width: svg?.getAttribute('width'),
    height: svg?.getAttribute('height'),
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()
