import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { GameManager } from './GameManager.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameManager />
  </StrictMode>,
)
