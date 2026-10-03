import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Em desenvolvimento o Vite encaminha a API e a sinalização do SFU para a stack do docker compose (Traefik na porta 80).
const stack = process.env.STACK_URL ?? 'http://localhost'
// Contra o servidor publicado (testes do app desktop), as chamadas saem com a origem dele: o backend recusa outras origens.
const asStack = { changeOrigin: true, secure: false, headers: { origin: new URL(stack).origin } }

export default defineConfig({
  plugins: [react()],
  // versão do build (data/hora UTC), enviada no relatório de quem transmite para saber se a pessoa recarregou a página
  define: { __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: stack, ws: true, ...asStack },
      '/rtc': { target: stack, ws: true, ...asStack },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rolldownOptions: {
      output: { codeSplitting: { groups: [
        { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 3 },
        { name: 'media', test: /node_modules[\\/](livekit-client|@livekit|@bufbuild)[\\/]/, priority: 2, maxSize: 500000 },
        { name: 'presence', test: /node_modules[\\/]@microsoft[\\/]signalr[\\/]/, priority: 1 },
      ] } },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
