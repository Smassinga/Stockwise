// src/main.tsx
import { Sentry, sentryEnabled } from './lib/sentry'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppErrorFallback } from './components/AppErrorFallback'
import { AuthProvider } from './hooks/useAuth'
import { Toaster } from 'react-hot-toast'
import './index.css' // Tailwind + theme
import { I18nProvider } from './lib/i18n'
import { supabase } from './lib/supabase'
import { SEOProvider } from './lib/seo'   // <-- add

// Expose supabase in dev for quick JWT debugging in the browser console
if (import.meta.env.DEV) {
  ;(window as any).supabase = supabase
}

const rootOptions = sentryEnabled
  ? {
      onUncaughtError: Sentry.reactErrorHandler(),
      onCaughtError: Sentry.reactErrorHandler(),
      onRecoverableError: Sentry.reactErrorHandler(),
    }
  : undefined

ReactDOM.createRoot(document.getElementById('root')!, rootOptions).render(
  <React.StrictMode>
    <I18nProvider>
      <Sentry.ErrorBoundary fallback={<AppErrorFallback />} showDialog={false}>
        <SEOProvider
          siteName="StockWise"
          baseUrl={import.meta.env.VITE_SITE_URL || 'https://stockwiseapp.com'}
        >
          <BrowserRouter>
            <AuthProvider>
              <App />
              <Toaster position="top-right" />
            </AuthProvider>
          </BrowserRouter>
        </SEOProvider>
      </Sentry.ErrorBoundary>
    </I18nProvider>
  </React.StrictMode>
)
