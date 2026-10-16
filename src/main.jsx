// First import on purpose: this reads the email-link credentials out of the
// URL before HashRouter or the Supabase client can touch them.
import './lib/authLink'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import './index.css'

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
