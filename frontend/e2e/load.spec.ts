import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { closeBrowsers, instrumentPeerConnections, person, type Person } from './support'

/** Carga opt-in sobre canais reais; aumenta em etapas e nunca roda sem solicitação explícita da CLI. */
test('carga de canais com participantes WebRTC reais', async ({ baseURL }) => {
  test.skip(process.env.E2E_LOAD !== '1', 'Defina E2E_LOAD=1 para executar a carga.')
  test.setTimeout(600000)
  const rooms = Number(process.env.LOAD_ROOMS ?? '1')
  const users = Number(process.env.LOAD_USERS ?? '20')
  const seconds = Number(process.env.LOAD_SECONDS ?? '20')
  if (![1, 5, 10].includes(rooms) || users < 2 || users > 20 || seconds < 5 || seconds > 300) throw new Error('Use 1/5/10 salas, 2–20 usuários por sala e 5–300 segundos.')
  const created: { owner: Person; id: string }[] = []
  const viewers: Person[] = []
  async function mutation<T>(p: Person, path: string, body?: unknown, method = 'POST') {
    const csrf = await p.context.request.get('/api/v1/auth/csrf')
    const token = ((await csrf.json()) as { token: string }).token
    const response = await p.context.request.fetch(`/api/v1${path}`, { method, headers: { 'X-CSRF-Token': token }, data: body })
    expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true)
    return response.status() === 204 ? undefined as T : await response.json() as T
  }
  async function account(label: string) {
    const p = await person(label, 'chromium', baseURL!); await instrumentPeerConnections(p)
    const username = `load_${Date.now()}_${label}`.slice(0, 32)
    await mutation(p, '/auth/register', { username, password: 'senha-teste-carga-2026', confirmPassword: 'senha-teste-carga-2026' })
    return p
  }
  const before = () => {
    try { return execFileSync('docker', ['stats', '--no-stream', '--format', '{{.Name}} CPU={{.CPUPerc}} RAM={{.MemUsage}} NET={{.NetIO}}'], { encoding: 'utf8' }).trim() } catch { return 'docker stats indisponível' }
  }
  async function received(p: Person) {
    return p.page.evaluate(async () => {
      const pcs = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? []
      let bytes = 0, packets = 0, lost = 0, frames = 0, rtt = 0
      for (const pc of pcs) {
        const stats = await pc.getStats()
        stats.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') { bytes += s.bytesReceived ?? 0; packets += s.packetsReceived ?? 0; lost += Math.max(0, s.packetsLost ?? 0); frames += s.framesDecoded ?? 0 } if (s.type === 'candidate-pair' && s.state === 'succeeded') rtt = Math.max(rtt, (s.currentRoundTripTime ?? 0) * 1000) })
      }
      return { bytes, packets, lost, frames, rtt }
    })
  }
  try {
    for (let room = 0; room < rooms; room++) {
      const owner = await account(`${room}_0`)
      const server = await mutation<{ id: string }>(owner, '/servers', { name: `Carga ${room}` }); created.push({ owner, id: server.id })
      const invite = await mutation<{ code: string }>(owner, `/servers/${server.id}/invites`, {})
      const people = [owner]
      for (let i = 1; i < users; i++) { const p = await account(`${room}_${i}`); people.push(p); viewers.push(p); await mutation(p, `/invites/${invite.code}/accept`) }
      for (const p of people) {
        await p.page.goto(`/app/${server.id}`)
        await p.page.getByRole('button', { name: /#\s*Geral/ }).click()
        await expect(p.page.getByRole('button', { name: /Compartilhar tela/ })).toBeEnabled()
      }
      await owner.page.getByRole('button', { name: /Compartilhar tela/ }).click()
      await owner.page.getByRole('dialog').getByRole('button', { name: 'Tela inteira', exact: false }).click()
      await expect(owner.page.locator('.stage-tile.is-local')).toBeVisible()
      for (const p of people.slice(1)) await expect.poll(async () => (await received(p)).frames).toBeGreaterThan(0)
    }
    const startStats = before(), start = await Promise.all(viewers.map(received))
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    const end = await Promise.all(viewers.map(received)), endStats = before()
    end.forEach((s, i) => { expect(s.frames).toBeGreaterThan(start[i]!.frames); expect(s.bytes).toBeGreaterThan(start[i]!.bytes) })
    const summary = { rooms, usersPerRoom: users, senders: rooms, viewers: viewers.length, seconds, receivedMbps: end.reduce((sum, s, i) => sum + s.bytes - start[i]!.bytes, 0) * 8 / seconds / 1000000, maxRttMs: Math.max(...end.map((s) => s.rtt)), lossPercent: end.reduce((sum, s) => sum + s.lost, 0) / Math.max(1, end.reduce((sum, s) => sum + s.packets + s.lost, 0)) * 100, startStats, endStats }
    console.log('Carga real:', JSON.stringify(summary, null, 2))
    await test.info().attach('carga-real.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' })
  } finally {
    // Somente os servidores criados por este teste são removidos; contas de teste são preservadas para auditoria.
    for (const { owner, id } of created) await mutation(owner, `/servers/${id}`, undefined, 'DELETE').catch(() => undefined)
    await closeBrowsers()
  }
})
