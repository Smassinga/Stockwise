// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    allowedHosts: true,
  },
  optimizeDeps: {
    // keep Radix Switch pre-bundled to avoid outdated dep errors
    include: ['@radix-ui/react-switch'],
    // skip lucide-react pre-bundle to avoid missing ./icons/chrome.js export during optimize
    exclude: ['lucide-react'],
  },
})