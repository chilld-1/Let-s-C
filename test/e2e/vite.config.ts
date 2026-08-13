import { defineConfig } from 'vite'

// 单独构建 E2E 测试入口（不进入主应用产物）
export default defineConfig({
  build: {
    outDir: '../../out/test',
    emptyOutDir: false,
    lib: {
      entry: 'entry.ts',
      formats: ['iife'],
      name: 'e2e',
      fileName: () => 'e2e.js'
    },
    target: 'chrome120'
  }
})
