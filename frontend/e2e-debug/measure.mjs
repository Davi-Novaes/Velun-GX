// Medição controlada: 1 transmissor + 1 espectador contra o servidor real.
import { chromium } from '@playwright/test'

const BASE = process.env.BASE ?? 'https://discordmeet.ddns.net:8443'
const RES = process.env.RES ?? '1080p'
const FPS = process.env.FPS ?? '60'
const SECONDS = Number(process.env.SECONDS ?? 40)

const instrument = () => {
  const Original = window.RTCPeerConnection
  window.__pcs = []
  const Patched = function (cfg) { const pc = new Original(cfg); window.__pcs.push(pc); return pc }
  Patched.prototype = Original.prototype
  Object.setPrototypeOf(Patched, Original)
  window.RTCPeerConnection = Patched
}

const sample = () => (async () => {
  const out = { send: [], recv: [], ice: [] }
  for (const pc of window.__pcs ?? []) {
    if (pc.connectionState !== 'connected') continue
    const stats = await pc.getStats()
    const byId = new Map(); stats.forEach((s) => byId.set(s.id, s))
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) {
        const p = byId.get(s.selectedCandidatePairId)
        out.ice.push({ rtt: p?.currentRoundTripTime, avail: p?.availableOutgoingBitrate, local: byId.get(p?.localCandidateId)?.candidateType, proto: byId.get(p?.localCandidateId)?.protocol })
      }
      if (s.type === 'outbound-rtp' && s.kind === 'video') {
        const r = byId.get(s.remoteId)
        out.send.push({ rid: s.rid, w: s.frameWidth, h: s.frameHeight, fps: s.framesPerSecond, bytes: s.bytesSent, ts: s.timestamp, target: s.targetBitrate, lim: s.qualityLimitationReason, rtcpRtt: r?.roundTripTime, lost: r?.packetsLost, nack: s.nackCount, retx: s.retransmittedPacketsSent, encMs: s.totalEncodeTime && s.framesEncoded ? s.totalEncodeTime / s.framesEncoded * 1000 : undefined, active: s.active })
      }
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        out.recv.push({ w: s.frameWidth, h: s.frameHeight, fps: s.framesPerSecond, bytes: s.bytesReceived, ts: s.timestamp, lost: s.packetsLost, jit: s.jitter, jbMs: s.jitterBufferEmittedCount ? s.jitterBufferDelay / s.jitterBufferEmittedCount * 1000 : undefined, freeze: s.freezeCount, pli: s.pliCount, nack: s.nackCount, dropped: s.framesDropped })
      }
    })
  }
  return out
})()

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
async function person(name) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })
  await ctx.addInitScript(instrument)
  const page = await ctx.newPage()
  return { name, page }
}
const ana = await person('Ana'), bia = await person('Bia')
await ana.page.goto(BASE + '/legacy')
await ana.page.getByRole('button', { name: 'Criar sala' }).click()
const code = (await ana.page.getByLabel('Link da sala').inputValue()).split('/room/')[1]
for (const p of [ana, bia]) {
  await p.page.goto(`${BASE}/room/${code}`)
  await p.page.getByLabel('Nome').fill(p.name)
  await p.page.getByRole('button', { name: 'Entrar' }).click()
  await p.page.getByRole('button', { name: 'Sair' }).waitFor({ timeout: 30000 })
}
await ana.page.getByRole('button', { name: 'Compartilhar tela' }).click()
const dialog = ana.page.getByRole('dialog', { name: 'Compartilhar tela' })
const audio = dialog.getByLabel('Compartilhar áudio'); if (await audio.count()) await audio.setChecked(false)
await dialog.getByLabel('Qualidade').selectOption(RES)
await dialog.getByLabel('Taxa de quadros').selectOption(FPS)
await dialog.getByRole('button', { name: 'Compartilhar' }).click()
console.log(`sala ${code} | ${RES} @ ${FPS} FPS | ${SECONDS}s`)
console.log('t(s) | ICE RTT | RTCP RTT | envio Mbps | camadas enviadas (w x h @fps) | limitação | recebido w x h @fps | jitter buf | perdidos rx | congel.')
let prevSend = new Map(), prevRecv = null
for (let t = 0; t < SECONDS; t += 2) {
  await ana.page.waitForTimeout(2000)
  const s = await ana.page.evaluate(sample), r = await bia.page.evaluate(sample)
  let mbps = 0; const layers = []
  for (const o of s.send) { const k = o.rid ?? 'x'; const p = prevSend.get(k); if (p && o.ts > p.ts) mbps += (o.bytes - p.bytes) * 8 / (o.ts - p.ts) / 1000; prevSend.set(k, o); if (o.w) layers.push(`${o.w}x${o.h}@${Math.round(o.fps ?? 0)}`) }
  const rtcp = s.send.map((o) => o.rtcpRtt).filter((x) => x !== undefined)
  const ice = s.ice[0]?.rtt
  const rv = r.recv.sort((a, b) => (b.w ?? 0) - (a.w ?? 0))[0]
  const lim = [...new Set(s.send.map((o) => o.lim))].join('/')
  console.log(`${String(t + 2).padStart(3)} | ${ice === undefined ? '-' : Math.round(ice * 1000) + ' ms'} | ${rtcp.length ? Math.round(Math.max(...rtcp) * 1000) + ' ms' : '-'} | ${mbps.toFixed(1)} | ${layers.join(' ')} | ${lim} | ${rv ? `${rv.w}x${rv.h}@${Math.round(rv.fps ?? 0)}` : '-'} | ${rv?.jbMs ? Math.round(rv.jbMs) + ' ms' : '-'} | ${rv?.lost ?? '-'} | ${rv?.freeze ?? '-'}`)
}
console.log('caminho ICE do transmissor:', JSON.stringify((await ana.page.evaluate(sample)).ice))
await browser.close()
