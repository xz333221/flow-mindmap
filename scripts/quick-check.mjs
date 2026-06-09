import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage()
p.on('response', r => {
  if (r.status() >= 400) console.log('HTTP', r.status(), r.url())
})
p.on('pageerror', e => console.log('PAGEERR', e.message))
p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE_ERR', m.text()) })
await p.goto('http://localhost:7851/')
await p.waitForTimeout(3000)
const n = await p.locator('.zm-node').count()
console.log('NODES', n)
await p.close()
await b.close()
