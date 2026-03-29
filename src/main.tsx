import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { SettingsWindow } from './App.tsx'

const searchParams = new URLSearchParams(window.location.search)
const windowType = searchParams.get('window')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {windowType === 'settings' ? <SettingsWindow /> : <App />}
  </StrictMode>,
)
