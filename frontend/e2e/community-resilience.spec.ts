import { expect, test } from '@playwright/test'
import { closeBrowsers, expectVideoFlowing, instrumentDisplayCapture, person, type Person } from './support'

test.afterEach(closeBrowsers)
async function call(p: Person, path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['X-CSRF-Token'] = (await (await p.context.request.get('/api/v1/auth/csrf')).json()).token
  const response = await p.context.request.fetch(`/api/v1${path}`, { method, headers, data: body })
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true)
  return response.status() === 204 ? undefined : response.json()
}

test('reconecta presença, remove membro do SFU e exclui canal ativo sem fantasmas', async ({ baseURL }) => {
  test.setTimeout(150000)
  const a = await person('Owner', 'chromium', baseURL!)
  const b = await person('Member', 'chromium', baseURL!)
  const suffix = Date.now()
  const owner = await call(a, '/auth/register', 'POST', { username: `Owner_${suffix}`, password: 'resilience-password-2026', confirmPassword: 'resilience-password-2026' })
  const member = await call(b, '/auth/register', 'POST', { username: `Member_${suffix}`, password: 'resilience-password-2026', confirmPassword: 'resilience-password-2026' })
  const server = await call(a, '/servers', 'POST', { name: 'Resiliência' })
  try {
    const invite = await call(a, `/servers/${server.id}/invites`, 'POST', {})
    await call(b, `/invites/${invite.code}/accept`, 'POST')
    const details = await call(a, `/servers/${server.id}`)
    const channel = details.channels[0]
    for (const p of [a, b]) {
      await instrumentDisplayCapture(p)
      await p.page.goto(`/app/${server.id}`)
      await p.page.getByRole('button', { name: /#\s*Geral/ }).click()
      await expect(p.page.getByRole('button', { name: /Compartilhar tela/ })).toBeEnabled()
    }
    await b.page.getByRole('button', { name: /Compartilhar tela/ }).click()
    await b.page.getByRole('dialog').getByRole('button', { name: 'Começar transmissão' }).click()
    await expectVideoFlowing(a, `Tela de ${member.username}`)
    // offline do navegador testa queda de signaling/presença, não simula perda de UDP no roteador.
    await a.context.setOffline(true)
    await a.page.waitForTimeout(2500)
    await a.context.setOffline(false)
    await expect.poll(async () => (await call(a, `/servers/${server.id}/presence`))[0].participants.length).toBe(2)
    await expectVideoFlowing(a, `Tela de ${member.username}`)
    await call(a, `/servers/${server.id}/members/${member.id}`, 'DELETE')
    await expect(a.page.locator('.stream-grid .stream-tile')).toHaveCount(0)
    await expect(b.page.getByRole('button', { name: 'Sair do canal' })).toHaveCount(0)
    await expect.poll(async () => (await call(a, `/servers/${server.id}/presence`))[0].participants.map((p: { userId: string }) => p.userId)).toEqual([owner.id])
    await call(a, `/channels/${channel.id}`, 'DELETE')
    await expect(a.page.getByRole('button', { name: 'Sair do canal' })).toHaveCount(0)
    await expect(a.page.getByRole('button', { name: /#\s*Geral/ })).toHaveCount(0)
  } finally { await call(a, `/servers/${server.id}`, 'DELETE') }
})
