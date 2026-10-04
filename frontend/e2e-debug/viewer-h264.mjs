// Espectador de teste para o autoteste do app (VELUN_SMOKE_SHARE): entra pelo convite gravado pelo app,
// assiste à transmissão H.264 feita pela placa de vídeo e confere se o vídeo chega e se mexe.
// Uso: node e2e-debug/viewer-h264.mjs <arquivo-do-convite> <arquivo-de-saida>
import { chromium } from '@playwright/test'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const [inviteFile, outFile] = process.argv.slice(2)
const base = 'http://localhost'
for (let i = 0; i < 120 && !existsSync(inviteFile); i++) await new Promise((r) => setTimeout(r, 500))
const { invite, server, sharer } = JSON.parse(readFileSync(inviteFile, 'utf8'))
const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: base, viewport: { width: 1920, height: 1080 } })
const page = await context.newPage()
const csrf = async () => (await (await context.request.get('/api/v1/auth/csrf')).json()).token
const post = async (path, data) => { const r = await context.request.post('/api/v1' + path, { headers: { 'X-CSRF-Token': await csrf() }, data }); if (!r.ok()) throw new Error(path + ' ' + r.status()) }
let result
try {
  await post('/auth/register', { username: 'olho_' + Date.now(), password: 'teste-local-velun-2026', confirmPassword: 'teste-local-velun-2026' })
  await post(`/invites/${invite}/accept`, {})
  await page.goto(`/app/${server}`)
  await page.getByRole('button', { name: /#\s*Geral/ }).click()
  const video = page.getByLabel(`Tela de ${sharer}`)
  await video.waitFor({ timeout: 30000 })
  const sample = () => video.evaluate((v) => ({ w: v.videoWidth, h: v.videoHeight, t: v.currentTime, frames: v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0 }))
  let first = await sample()
  for (let i = 0; i < 40 && !first.w; i++) { await page.waitForTimeout(500); first = await sample() }
  // assiste grande (destaque), como em tela cheia: deve pedir a camada mais alta
  await page.getByLabel(`Transmissão de ${sharer}`).dblclick()
  const timeline = []
  for (const at of [3, 8, 15, 22]) { await page.waitForTimeout(at === 3 ? 3000 : (at - [3, 8, 15, 22][[3, 8, 15, 22].indexOf(at) - 1]) * 1000); const s = await sample(); timeline.push(`${at}s: ${s.w}x${s.h}`) }
  const second = await sample()
  const codec = await page.evaluate(async () => {
    for (const pc of window.__pcs ?? []) { const s = await pc.getStats(); for (const x of s.values()) if (x.type === 'inbound-rtp' && x.kind === 'video') return s.get(x.codecId)?.mimeType + ' ' + (s.get(x.codecId)?.sdpFmtpLine ?? '') }
    return 'não medido'
  })
  result = { linhaDoTempo: timeline, recebe: first.w > 0, resolucao: `${second.w}x${second.h}`, avancou: second.t > first.t, quadrosNovos: second.frames - first.frames, codec }
} catch (error) {
  result = { error: String(error) }
}
writeFileSync(outFile, JSON.stringify(result))
await browser.close()
