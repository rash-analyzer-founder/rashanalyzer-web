import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpeedInsights } from '@vercel/speed-insights/react'
import FruitList from './list.tsx'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <FruitList />
    <SpeedInsights />
  </StrictMode>
)
