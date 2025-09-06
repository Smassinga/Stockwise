// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { Toaster } from 'react-hot-toast'
import './index.css' // Tailwind + theme
import { I18nProvider } from './lib/i18n'
import { supabase } from './lib/supabase'  // <-- import supabase

// Expose supabase in dev for quick JWT debugging in the browser console
if (import.meta.env.DEV) {
  ;(window as any).supabase = supabase
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </I18nProvider>
  </React.StrictMode>
)
