import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'esnext',
    minify: 'terser',
    assetsInlineLimit: 4096,
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
