import { defineConfig } from '@playwright/test'

// Testes ponta a ponta contra a stack real (docker compose): navegadores reais, WebRTC real, SFU real.
// Captura de tela e áudio são sintéticos (flags de mídia falsa do Chromium / prefs do Firefox).
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // WebRTC é pesado em CPU: evita que testes paralelos distorçam os resultados
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
})
