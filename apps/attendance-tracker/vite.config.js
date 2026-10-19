import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Relative base so the same build works at the repo root, at
// /<repo>/ on GitHub Pages, or behind any reverse proxy.
// The app uses HashRouter, so deep links survive a hard refresh with
// no server-side rewrite rules.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
