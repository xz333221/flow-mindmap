import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Let the preview harness pick a free port when 7860 is taken by
  // another session.  Default remains 7860 so existing links work.
  server: { port: 7860, strictPort: false, host: '0.0.0.0' },
})
