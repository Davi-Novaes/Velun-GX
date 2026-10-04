import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ServicesProvider } from './app/services'
// fonte da interface: Noto Sans (a mesma reserva que o Discord usa; a gg sans dele é exclusiva)
import '@fontsource-variable/noto-sans'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider>
      <App />
    </ServicesProvider>
  </StrictMode>,
)
