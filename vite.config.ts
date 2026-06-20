// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

function addCspSources(policy: string, directive: string, sources: string[]) {
  return policy.replace(new RegExp(`(${directive}\\s+)([^;]+)`), (_match, prefix: string, value: string) => {
    const next = new Set([...value.trim().split(/\s+/), ...sources])
    return `${prefix}${Array.from(next).join(' ')}`
  })
}

function devLocalSupabaseCsp() {
  const localHttp = 'http://127.0.0.1:54321'
  const localWs = 'ws://127.0.0.1:54321'

  return {
    name: 'stockwise-dev-local-supabase-csp',
    apply: 'serve' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/,
        (_match, open: string, policy: string, close: string) => {
          let next = addCspSources(policy, 'connect-src', [localHttp, localWs])
          next = addCspSources(next, 'img-src', [localHttp])
          next = addCspSources(next, 'frame-src', [localHttp])
          next = addCspSources(next, 'media-src', [localHttp])
          return `${open}${next}${close}`
        },
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), devLocalSupabaseCsp()],
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
