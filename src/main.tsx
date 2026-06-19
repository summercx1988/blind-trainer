import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createWebApi } from './web/webApi'
import './index.css'
import App from './App.tsx'

if (typeof window !== 'undefined' && !(window as unknown as { electronAPI?: unknown }).electronAPI) {
  const api = createWebApi()
  ;(window as unknown as { mobileAPI: typeof api }).mobileAPI = api
  api.init().catch((e) => console.error('[mobileAPI] 初始化失败:', e))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
