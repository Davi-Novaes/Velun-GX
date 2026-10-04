import { expect, test } from '@playwright/test'
import { closeBrowsers, expectVideoFlowing, instrumentDisplayCapture, person, type Person } from './support'

test.afterEach(closeBrowsers)
async function api(p: Person, path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['X-CSRF-Token'] = (await (await p.context.request.get('/api/v1/auth/csrf')).json()).token
  const r = await p.context.request.fetch(`/api/v1${path}`, { method, headers, data: body })
  expect(r.ok(), `${method} ${path}: ${r.status()}`).toBe(true)
  return r.status() === 204 ? undefined : r.json()
}

test('aceleração de hardware sem placa de vídeo cai para VP9/VP8 sem derrubar a transmissão', async ({ baseURL }) => {
  test.setTimeout(150000)
  const a = await person('Emissor', 'chromium', baseURL!)
  const b = await person('Espectador', 'chromium', baseURL!)
  const suffix = Date.now()
  const names = [`Codec_${suffix}`, `Olho_${suffix}`]
  for (const [i, p] of [a, b].entries()) {
    p.page.setDefaultTimeout(15000)
    await instrumentDisplayCapture(p)
    await api(p, '/auth/register', 'POST', { username: names[i], password: 'formato-video-2026', confirmPassword: 'formato-video-2026' })
  }
  const server = await api(a, '/servers', 'POST', { name: 'Formatos' })
  try {
    const invite = await api(a, `/servers/${server.id}/invites`, 'POST', {})
    await api(b, `/invites/${invite.code}/accept`, 'POST')
    for (const p of [a, b]) { await p.page.goto(`/app/${server.id}`); await p.page.getByRole('button', { name: /#\s*Geral/ }).click(); await expect(p.page.getByRole('button', { name: 'Compartilhar tela', exact: true })).toBeEnabled() }
    await a.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).click()
    const dialog = a.page.getByRole('dialog')
    await dialog.getByLabel('Aceleração de hardware (placa de vídeo)').check()
    await dialog.getByRole('button', { name: 'Tela inteira', exact: false }).click()
    await expectVideoFlowing(b, `Tela de ${names[0]}`)
    // o navegador de teste não tem codificador na placa: o app percebe e troca o formato sozinho
    const ownTile = a.page.getByLabel(`Transmissão de ${names[0]}`)
    await ownTile.hover()
    await a.page.getByRole('button', { name: `Menu de ${names[0]}` }).click()
    await a.page.getByRole('menuitem', { name: 'Informações da transmissão' }).click()
    const panel = a.page.getByRole('region', { name: `Diagnóstico de ${names[0]}` })
    await expect(panel).toContainText(/Placa de vídeo sem codificador/, { timeout: 30000 })
    await expect(panel).toContainText(/Formato de vídeo(VP9|VP8) · processador/, { timeout: 15000 })
    // quem assiste continua recebendo, já no formato novo
    await expectVideoFlowing(b, `Tela de ${names[0]}`)
    await b.page.getByLabel(`Transmissão de ${names[0]}`).hover()
    await b.page.getByRole('button', { name: `Menu de ${names[0]}` }).click()
    await b.page.getByRole('menuitem', { name: 'Informações da transmissão' }).click()
    await expect(b.page.getByRole('region', { name: `Diagnóstico de ${names[0]}` })).toContainText(/Formato de vídeo(VP9|VP8)/, { timeout: 15000 })
    // a próxima transmissão já começa sem tentar a placa (o app lembrou)
    expect(await a.page.evaluate(() => localStorage.getItem('tj:h264Hardware'))).toBe('no')
  } finally {
    await api(a, `/servers/${server.id}`, 'DELETE').catch(() => undefined)
  }
})
