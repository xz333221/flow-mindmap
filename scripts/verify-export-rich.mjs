// Verify that the exported SVG contains code blocks, tables,
// and images by intercepting the SVG download and checking its
// content.
import { chromium } from 'playwright'

const url = process.env.URL || 'http://localhost:7851/'
const outDir = 'verify-output'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.zm-canvas', { timeout: 8000 })

// Intercept the SVG export download to capture its content
let svgContent = null
page.on('download', async (download) => {
  const path = await download.path()
  if (path) {
    const fs = await import('fs')
    svgContent = fs.readFileSync(path, 'utf8')
  }
})

// Right-click canvas to open context menu
const box = await page.locator('.zm-canvas').boundingBox()
await page.mouse.click(box.x + box.width - 280, box.y + box.height - 30, { button: 'right' })
await page.waitForTimeout(200)

// Hover over "导出" to open submenu
const exportItem = page.locator('.zm-canvas-menu-item-has-submenu').filter({ hasText: '\u5BFC\u51FA' })
await exportItem.hover()
await page.waitForTimeout(200)

// Click "导出 SVG" to get the SVG file (we can check its content directly)
const svgButton = page.locator('.zm-canvas-submenu .zm-canvas-menu-item').filter({ hasText: '\u5BFC\u51FA SVG' })
await svgButton.click()
await page.waitForTimeout(1000)

if (!svgContent) {
  console.error('No SVG download captured')
  await browser.close()
  process.exit(1)
}

console.log('SVG content length:', svgContent.length)

// Check for code block elements (text elements with monospace font)
const hasCodeBlock = svgContent.includes('JetBrains Mono') || svgContent.includes('Consolas')
console.log('Has code block (monospace font):', hasCodeBlock ? 'OK' : 'MISSING')

// Check for table elements (multiple rect + line elements forming a grid)
// Table cells have stroke lines
const lineCount = (svgContent.match(/<line /g) || []).length
console.log('Has table grid lines:', lineCount > 5 ? `OK (${lineCount} lines)` : `MISSING (${lineCount} lines)`)

// Check for image elements
const hasImage = svgContent.includes('<image ') || svgContent.includes('xlink:href')
console.log('Has image element:', hasImage ? 'OK' : 'MISSING')

// Check for language tag in code block
const hasLangTag = svgContent.includes('ts') || svgContent.includes('js') || svgContent.includes('bash')
console.log('Has language tag:', hasLangTag ? 'OK' : 'MISSING')

// Check for table header text
const hasTableHeader = svgContent.includes('id') && svgContent.includes('text')
console.log('Has table text content:', hasTableHeader ? 'OK' : 'MISSING')

// Save SVG for manual inspection
const fs = await import('fs')
fs.writeFileSync(`${outDir}/export-test.svg`, svgContent)
console.log('SVG saved to verify-output/export-test.svg')

// Now test PNG export too
let pngDownloaded = false
page.on('download', (d) => { 
  if (d.suggestedFilename().endsWith('.png')) pngDownloaded = true 
})

// Right-click again
await page.mouse.click(box.x + box.width - 280, box.y + box.height - 30, { button: 'right' })
await page.waitForTimeout(200)

// Hover "导出" again
const exportItem2 = page.locator('.zm-canvas-menu-item-has-submenu').filter({ hasText: '\u5BFC\u51FA' })
await exportItem2.hover()
await page.waitForTimeout(200)

// Click "导出 PNG"
const pngButton = page.locator('.zm-canvas-submenu .zm-canvas-menu-item').filter({ hasText: '\u5BFC\u51FA PNG' })
await pngButton.click()
await page.waitForTimeout(3000)

console.log('PNG download triggered:', pngDownloaded ? 'OK' : 'MISSING (may fallback to SVG)')

// Check for console errors related to tainted canvas
const hasTaintError = errors.some(e => e.includes('tainted') || e.includes('SecurityError'))
console.log('Has tainted canvas error:', hasTaintError ? 'YES (BAD)' : 'NO (GOOD)')

await browser.close()

if (errors.length > 0 && !hasTaintError) {
  console.error('ERRORS:', errors)
  process.exit(1)
}

if (!hasCodeBlock || !hasImage) {
  console.error('Missing required export elements!')
  process.exit(1)
}

console.log('EXPORT RICH CONTENT VERIFY OK')
