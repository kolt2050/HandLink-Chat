import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        offscreen: 'offscreen.html',
        background: 'src/extension/background.ts'
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'background' ? 'assets/background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  test: {
    environment: 'jsdom'
  }
})
