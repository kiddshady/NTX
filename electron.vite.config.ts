import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
      // Las fuentes salen siempre como archivo. Vite incrusta como data: todo
      // asset de menos de 4 kB, y la CSP (src/main/index.ts) tiene
      // `font-src 'self'`: ntx-blocks.ttf pesa 2,8 kB y quedaba bloqueada.
      assetsInlineLimit: (file) => (/\.(ttf|woff2?)$/.test(file) ? false : undefined)
    }
  }
})
