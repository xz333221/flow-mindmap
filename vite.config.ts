import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'
  const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))
  const pkg = JSON.parse(readFileSync(r('./package.json'), 'utf-8'))

  return {
    plugins: [vue()],
    define: {
      __PKG_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': r('./src'),
      },
    },
    server: {
      port: 7851,
      strictPort: false,
      host: '0.0.0.0',
    },
    build: isLib
      ? {
          lib: {
            entry: r('src/entry.ts'),
            name: 'FlowMind',
            fileName: (format) =>
              format === 'es' ? 'flow-mindmap.js' : `flow-mindmap.${format}.cjs`,
            formats: ['es', 'umd'],
          },
          rollupOptions: {
            external: ['vue'],
            output: {
              exports: 'named',
              globals: { vue: 'Vue' },
              assetFileNames: (assetInfo) =>
                assetInfo.name === 'style.css' ? 'style.css' : 'assets/[name][extname]',
            },
          },
          cssCodeSplit: false,
          emptyOutDir: false,
        }
      : {
          outDir: 'demo-dist',
        },
  }
})
