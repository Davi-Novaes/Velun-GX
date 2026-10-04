import { writeFileSync } from 'node:fs'
import { app, type BrowserWindow, desktopCapturer } from 'electron'

/**
 * Autoteste (VELUN_SMOKE=1): abre o sistema, confere a ponte, o seletor e o som (sem o Discord) e encerra.
 * Imprime uma linha JSON com o resultado. Não faz login nem transmite nada.
 */
export function runSmoke(window: BrowserWindow): void {
  window.webContents.once('did-finish-load', async () => {
    const result: Record<string, unknown> = { url: window.webContents.getURL() }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 32, height: 18 } })
      result.screens = sources.filter((s) => s.id.startsWith('screen:')).length
      result.windows = sources.filter((s) => s.id.startsWith('window:')).length
      if (process.env.VELUN_SMOKE_UPDATE === '1') {
        // espera o atualizador baixar a versão nova e a página mostrar o aviso
        result.update = await window.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 120; i++) {
            const banner = document.querySelector('.update-banner')
            if (banner) return { banner: banner.textContent, status: await window.velun.update.status() }
            await new Promise((r) => setTimeout(r, 500))
          }
          return { banner: null, status: await window.velun.update.status() }
        })()`)
      }
      result.page = await window.webContents.executeJavaScript(`(async () => {
        const v = window.velun
        if (!v) return { bridge: false }
        const probe = await v.audio.probe()
        // VELUN_SMOKE_TONE: a própria página toca 1000 Hz nos alto-falantes (como o som das transmissões dos outros)
        let tone = null
        if (${process.env.VELUN_SMOKE_TONE === '1'}) {
          const ctx = new AudioContext({ sampleRate: 48000 }); const osc = ctx.createOscillator(); const gain = ctx.createGain()
          osc.frequency.value = 1000; gain.gain.value = 0.2; osc.connect(gain).connect(ctx.destination); osc.start(); await ctx.resume()
          tone = ctx
          await new Promise((r) => setTimeout(r, 800))
        }
        let bytes = 0, sum = 0, count = 0
        const left = []
        const off = v.audio.onData((chunk) => {
          bytes += chunk.length
          const pcm = new Int16Array(chunk.slice().buffer)
          for (let i = 0; i < pcm.length; i++) { sum += pcm[i] * pcm[i]; count++; if (i % 2 === 0) left.push(pcm[i]) }
        })
        const statuses = []
        const offStatus = v.audio.onStatus((s) => statuses.push(s))
        const started = await v.audio.start('system')
        await new Promise((r) => setTimeout(r, 3500))
        off(); await v.audio.stop(); offStatus()
        if (tone) await tone.close()
        const tail = left.slice(48000)
        const goertzel = (f) => { const k = 2 * Math.cos(2 * Math.PI * f / 48000); let s1 = 0, s2 = 0; for (const x of tail) { const s0 = x + k * s1 - s2; s2 = s1; s1 = s0 } return Math.round(Math.sqrt(Math.max(s1 * s1 + s2 * s2 - k * s1 * s2, 0)) / Math.max(tail.length, 1) * 10) / 10 }
        return { bridge: true, version: v.version, updateFailed: v.update && v.update.failed ? await v.update.failed() : 'sem suporte', title: document.title, probe, started, seconds: bytes / 192000, rms: Math.round(Math.sqrt(sum / Math.max(count, 1)) * 10) / 10, hz440: goertzel(440), hz1000: goertzel(1000), statuses }
      })()`)
    } catch (error) {
      result.error = String(error)
    }
    const line = `VELUN_SMOKE ${JSON.stringify(result)}\n`
    // o executável instalado não tem console: VELUN_SMOKE_OUT grava num arquivo
    if (process.env.VELUN_SMOKE_OUT) writeFileSync(process.env.VELUN_SMOKE_OUT, line)
    else process.stdout.write(line)
    app.exit(0)
  })
}
