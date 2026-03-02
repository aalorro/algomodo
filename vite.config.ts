import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/algomodo/',
  build: {
    target: 'esnext',
    minify: 'terser',
    assetsInlineLimit: 4096,
    outDir: 'docs',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'zustand'],
        }
      }
    }
  },
  server: {
    open: true,
  }
})
