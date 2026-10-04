import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'

/**
 * Autoteste do som do PC inteiro (caminho do Windows 10), com VELUN_SMOKE_LOOPBACK=1:
 * a página toca 1000 Hz (papel das transmissões dos outros) e pede getDisplayMedia com áudio; mede quanto de
 * 440 Hz (outro programa, deve entrar) e de 1000 Hz (o próprio app, idealmente fora) chega na captura.
 */
export function runLoopbackSmoke(window: BrowserWindow): void {
  window.webContents.once('did-finish-load', async () => {
    const results: Record<string, unknown> = {}
    for (const restrict of [true, false]) {
      results[`restrictOwnAudio=${restrict}`] = await window.webContents.executeJavaScript(`(async () => {
        const play = new AudioContext({ sampleRate: 48000 }); const osc = play.createOscillator(); const gain = play.createGain()
        osc.frequency.value = 1000; gain.gain.value = 0.2; osc.connect(gain).connect(play.destination); osc.start(); await play.resume()
        await new Promise((r) => setTimeout(r, 800))
        let stream
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false, restrictOwnAudio: ${restrict} }, systemAudio: 'include' })
        } catch (e) { await play.close(); return { error: String(e) } }
        const track = stream.getAudioTracks()[0]
        if (!track) { stream.getTracks().forEach((t) => t.stop()); await play.close(); return { audioTrack: false } }
        const ctx = new AudioContext({ sampleRate: 48000 })
        const source = ctx.createMediaStreamSource(new MediaStream([track]))
        const node = ctx.createScriptProcessor(4096, 2, 1)
        const samples = []
        node.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) samples.push(d[i] * 32768) }
        source.connect(node); node.connect(ctx.destination)
        await new Promise((r) => setTimeout(r, 3000))
        stream.getTracks().forEach((t) => t.stop()); await ctx.close(); await play.close()
        const tail = samples.slice(24000)
        const g = (f) => { const k = 2 * Math.cos(2 * Math.PI * f / 48000); let s1 = 0, s2 = 0; for (const x of tail) { const s0 = x + k * s1 - s2; s2 = s1; s1 = s0 } return Math.round(Math.sqrt(Math.max(s1 * s1 + s2 * s2 - k * s1 * s2, 0)) / Math.max(tail.length, 1) * 10) / 10 }
        return { audioTrack: true, settings: track.getSettings ? Object.keys(track.getSettings()).filter((k) => /restrict|suppress/.test(k)) : [], hz440: g(440), hz1000: g(1000) }
      })()`, true)
    }
    const line = `VELUN_SMOKE_LOOPBACK ${JSON.stringify(results)}\n`
    if (process.env.VELUN_SMOKE_OUT) writeFileSync(process.env.VELUN_SMOKE_OUT, line)
    else process.stdout.write(line)
    app.exit(0)
  })
}
