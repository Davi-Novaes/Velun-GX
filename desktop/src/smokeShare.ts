import { app, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'

/**
 * Autoteste de transmissão real (VELUN_SMOKE_SHARE=1, só contra o site LOCAL de desenvolvimento): cria uma conta
 * de teste, um servidor, entra no canal, liga a aceleração de hardware, transmite a tela (VELUN_SMOKE_PICK=1
 * escolhe a primeira) e lê no painel de informações qual formato e quem está codificando.
 */
export function runShareSmoke(window: BrowserWindow): void {
  window.webContents.once('did-finish-load', async () => {
    const step = (code: string) => window.webContents.executeJavaScript(code, true)
    let result: unknown
    try {
      const created = await step(`(async () => {
        const csrf = async () => (await (await fetch('/api/v1/auth/csrf')).json()).token
        const post = async (path, body) => { const r = await fetch('/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf() }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(path + ' ' + r.status); return r.json() }
        const name = 'smoke_' + Date.now()
        await post('/auth/register', { username: name, password: 'teste-local-velun-2026', confirmPassword: 'teste-local-velun-2026' })
        localStorage.setItem('tj:hardwareEncoding', ${JSON.stringify(process.env.VELUN_SMOKE_HW ?? '1')})
        localStorage.removeItem('tj:h264Hardware')
        if (${JSON.stringify(process.env.VELUN_SMOKE_VP9 === '1')}) { localStorage.removeItem('tj:vp9TooHeavy'); localStorage.setItem('tj:encoderBench', JSON.stringify({ vp9: 200, vp8: 250, cores: navigator.hardwareConcurrency, at: Date.now() })) }
        const server = (await post('/servers', { name: 'Autoteste' })).id
        const invite = (await post('/servers/' + server + '/invites', {})).code
        return { server, invite, name }
      })()`)
      const { server: serverId, invite, name } = created as { server: string; invite: string; name: string }
      // VELUN_SMOKE_INVITE_OUT: um espectador de teste (navegador separado) entra por este convite
      if (process.env.VELUN_SMOKE_INVITE_OUT) writeFileSync(process.env.VELUN_SMOKE_INVITE_OUT, JSON.stringify({ invite, server: serverId, sharer: name }))
      await window.loadURL(new URL(`/app/${serverId}`, window.webContents.getURL()).toString())
      result = await step(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        const find = async (fn, ms = 15000) => { for (let t = 0; t < ms; t += 250) { const el = fn(); if (el) return el; await wait(250) } throw new Error('não achou elemento') }
        const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text) && !b.disabled)
        ;(await find(() => [...document.querySelectorAll('button')].find((b) => /#\\s*Geral/.test(b.textContent)))).click()
        ;(await find(() => button('Compartilhar tela'))).click()
        ;(await find(() => button('Tela inteira'))).click()
        await wait(Number(${JSON.stringify(process.env.VELUN_SMOKE_HOLD_MS ?? '9000')}))
        const tile = await find(() => document.querySelector('.stage-tile.is-local'))
        tile.querySelector('[aria-label^="Menu de"]').click()
        ;(await find(() => [...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('Informações')))).click()
        const panel = await find(() => document.querySelector('.stream-info-panel'))
        await wait(4500)
        const rows = {}
        const dts = panel.querySelectorAll('dt'); dts.forEach((dt) => { rows[dt.textContent] = dt.nextElementSibling?.textContent })
        return { formato: rows['Formato de vídeo'], motivo: rows['Por que esse formato'], enviando: rows['Vídeo codificado'], fps: rows['FPS reais de envio'], limitacao: rows['Limitação no emissor'], memoria: localStorage.getItem('tj:h264Hardware'), h264Saiu: localStorage.getItem('tj:lastH264Encoder') }
      })()`)
    } catch (error) {
      result = { error: String(error) }
    }
    const line = `VELUN_SMOKE_SHARE ${JSON.stringify(result)}\n`
    if (process.env.VELUN_SMOKE_OUT) writeFileSync(process.env.VELUN_SMOKE_OUT, line)
    else process.stdout.write(line)
    app.exit(0)
  })
}
