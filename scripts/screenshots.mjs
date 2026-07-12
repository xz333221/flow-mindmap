// scripts/screenshots.mjs
//
// README screenshot generator: spin up demo/ dev server (port 7860)
// and use Playwright to capture 5 images into docs/screenshots/.
// The README then references them via jsDelivr CDN so the same
// images render on both GitHub and npm.
//
// One-time setup:
//   pnpm install                     # playwright + browsers
//   pnpm build                       # demo consumes dist/ via file:..
//
// Usage:
//   pnpm screenshots
//
// Output (in docs/screenshots/):
//   - overview.png         default view, mindmap layout, drawers closed
//   - layout-mindmap.png   explicit mindmap layout
//   - layout-tree.png      rightward tree layout
//   - layout-org.png       top-down org chart layout
//   - settings-panel.png   settings drawer open
//
// Re-run before each release and bump the @vX.Y.Z in the README
// CDN URLs to match the new package version.

import { chromium } from "playwright"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT     = resolve(__dirname, "..")
const DEMO_DIR = resolve(ROOT, "demo")
const OUT_DIR  = resolve(ROOT, "docs/screenshots")
const PORT     = 7860
const BASE_URL = "http://localhost:" + PORT + "/"

const VITE_BIN = process.platform === "win32"
  ? "node_modules\\.bin\\vite.cmd"
  : "node_modules/.bin/vite"

console.log("[screenshots] starting vite dev server on :" + PORT)
const dev = spawn(VITE_BIN, ["--port", String(PORT), "--strictPort"], {
  cwd: DEMO_DIR,
  stdio: "inherit",
  shell: true,
})

let killed = false
function killServer() {
  if (killed) return
  killed = true
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(dev.pid), "/T", "/F"], { shell: true })
    } catch (err) { /* taskkill may fail if process already exited */ }
  } else {
    dev.kill("SIGTERM")
  }
}
process.on("exit",   killServer)
process.on("SIGINT",  () => { killServer(); process.exit(130) })
process.on("SIGTERM", () => { killServer(); process.exit(143) })

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" })
      if (res.ok) return true
    } catch (err) { /* server not ready yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("Server at " + url + " did not become ready in " + timeoutMs + "ms")
}

await waitForServer(BASE_URL, 60000)

await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch()
const errors = []
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
  })
  const page = await context.newPage()
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message))
  page.on("console",  (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()) })

  await page.goto(BASE_URL, { waitUntil: "networkidle" })
  await page.waitForTimeout(700)
  async function shot(file, label) {
    await page.waitForTimeout(450)
    const out = resolve(OUT_DIR, file)
    await page.screenshot({ path: out, fullPage: false })
    console.log("[screenshots] wrote docs/screenshots/" + file + " (" + label + ")")
  }

  async function setLayout(value) {
    await page.locator("[data-testid=\"set-layoutmode\"]").selectOption(value)
    await page.waitForTimeout(2500)  // layoutMode -> applySettings -> re-layout
  }

  // 1) overview
  await shot("overview.png", "default overview")

  // 2) mindmap default layout
  await setLayout("mindmap")
  await shot("layout-mindmap.png", "mindmap layout")

  // 3) tree
  await setLayout("tree")
  await shot("layout-tree.png", "tree layout (rightward)")

  // 4) org
  await setLayout("org")
  await shot("layout-org.png", "org layout (top-down)")

  // 5) settings panel: back to mindmap, then open drawer
  await setLayout("mindmap")
  // MindMap draws its built-in drawers but exposes no toolbar button
  // for settings; the entry point is the canvas right-click menu.
  // Find an empty area (bottom-right corner) and right-click there.
  const canvasBox = await page.locator(".zm-mindmap").boundingBox()
  const ctxX = canvasBox.x + canvasBox.width - 80
  const ctxY = canvasBox.y + canvasBox.height - 80
  await page.mouse.click(ctxX, ctxY, { button: "right" })
  await page.waitForTimeout(350)
  // The context menu uses .zm-canvas-menu-item; pick the settings row
  // (the one that contains the translated "设置" label).
  // The canvas context menu uses .zm-canvas-menu-item; pick the settings row.
  await page.locator(".zm-canvas-menu-item", { hasText: /^设置$/ }).first().click()
  await page.waitForTimeout(600)

  // Hide demo left debug panel so README shows only the MindMap canvas.
  await page.evaluate(() => {
    const panel = document.querySelector(".demo-panel")
    if (panel) panel.remove()
  })
  await page.waitForTimeout(150)

  await shot("settings-panel.png", "settings drawer open")

} finally {
  await browser.close()
  killServer()
}

if (errors.length) {
  console.error("[screenshots] page emitted errors:")
  for (const e of errors) console.error("  - " + e)
  process.exitCode = 1
} else {
  console.log("[screenshots] done. output -> docs/screenshots/")
}
