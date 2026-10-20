// First import on purpose: this reads the email-link credentials out of the
// URL before HashRouter or the Supabase client can touch them.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { markUpdateAvailable } from './lib/appUpdate'
import './index.css'

// Vite raises this when a lazily loaded chunk cannot be fetched. After a
// deploy the old chunk filenames are gone, so any tab opened beforehand
// hits it -- catching it here covers every lazy import, not just the
// Excel one that happens to be the only current caller.
window.addEventListener('vite:preloadError', () => markUpdateAvailable())

// HashRouter rather than BrowserRouter: GitHub Pages serves static files
// with no rewrite rules, so /employee-report would 404 on a hard refresh.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
