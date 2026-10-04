import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AccountApiError } from '../api/accounts'
import type { AdminOverview, AdminUser } from '../api/admin'
import { routes } from '../app/App'
import { ServicesProvider } from '../app/services'
import { describeReceiving, describeStream, generatePassword, relativeTime } from './AdminPage'

const now = new Date().toISOString()
const person = (over: Partial<AdminUser>): AdminUser => ({ id: crypto.randomUUID(), username: 'x', nickname: null, name: 'x', createdAt: '2026-10-01T00:00:00Z', lastLoginAt: now, lastSeenAt: now, online: false, clients: [], sessions: 1, servers: [], call: null, bannedAt: null, banReason: null, mustChangePassword: false, ...over })
const overview: AdminOverview = {
  generatedAt: now, sfuAvailable: true,
  totals: { users: 3, online: 2, inCall: 1, streaming: 1, servers: 1, activeToday: 3, banned: 1 },
  users: [
    person({ id: 'id-banida', username: 'chato', name: 'Chato', bannedAt: now, banReason: 'Spam' }),
    person({ id: 'id-quieto', username: 'quieto', name: 'Quieto', lastSeenAt: new Date(Date.now() - 3 * 3600_000).toISOString() }),
    person({ username: 'Mopaz', name: 'Mopaz', online: true, clients: ['Chrome · Windows'], servers: ['Amigos'],
      call: { serverId: 's', server: 'Amigos', channelId: 'c', channel: 'Geral', streaming: false, since: now, stream: null, receiving: [{ from: 'Maatt', fps: 24, freezesPerMinute: 5, lossPercent: 0.8 }] } }),
    person({ username: 'maatt', name: 'Maatt', online: true, clients: ['App Velun Gx 0.2.9 · Windows'], servers: ['Amigos'],
      call: { serverId: 's', server: 'Amigos', channelId: 'c', channel: 'Geral', streaming: true, since: now, stream: { width: 1920, height: 1080, fps: 12, codec: 'VP8', hardware: false, limitation: 'cpu', mbps: 16.4 }, receiving: [] } }),
  ],
  servers: [{ id: 's', name: 'Amigos', owner: 'Mopaz', members: 3, channels: 2, inCall: 1, streaming: 1 }],
}

function setup(overviewFn: () => Promise<AdminOverview>, login = vi.fn(async () => ({ username: 'Mopaz' }))) {
  const router = createMemoryRouter(routes, { initialEntries: ['/admin'] })
  const admin = { overview: vi.fn(overviewFn), login, ban: vi.fn(async () => undefined), unban: vi.fn(async () => undefined), setPassword: vi.fn(async () => undefined), logout: vi.fn(async () => undefined), me: vi.fn(async () => ({ username: 'Mopaz' })) }
  render(<ServicesProvider services={{ admin }}><RouterProvider router={router} /></ServicesProvider>)
  return { router, admin, user: userEvent.setup() }
}
const unauthorized = () => new AccountApiError(401, 'UNAUTHORIZED', 'Entre com o acesso de administrador.')

describe('Painel de administração', () => {
  it('lista quem transmite primeiro, com o formato e o motivo do fps baixo, e filtra', async () => {
    const { user } = setup(async () => overview)
    const rows = await screen.findAllByRole('row', { name: /^(Maatt|Mopaz|Quieto|Chato)$/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Maatt', 'Mopaz', 'Quieto', 'Chato'])
    const maatt = within(rows[0]!)
    expect(maatt.getByText('Transmitindo')).toBeInTheDocument()
    expect(maatt.getByText('Amigos › #Geral')).toBeInTheDocument()
    expect(maatt.getByText(/1920 × 1080 · 12 fps · VP8 processador · 16.4 Mbps/)).toHaveTextContent('processador no limite')
    expect(maatt.getByText('App Velun Gx 0.2.9 · Windows')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Assistindo Maatt: 24 fps · 5 travadas/min · perda 0,8%')).toHaveClass('bad')
    expect(within(rows[2]!).getByText('Há 3 h')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Transmitindo/ }))
    expect(screen.getAllByRole('row', { name: /^(Maatt|Mopaz|Quieto|Chato)$/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /^Todos/ }))
    await user.type(screen.getByLabelText('Buscar pessoa'), 'quie')
    expect(screen.getAllByRole('row', { name: /^(Maatt|Mopaz|Quieto|Chato)$/ }).map((r) => r.getAttribute('aria-label'))).toEqual(['Quieto'])
    expect(screen.getByRole('row', { name: 'Amigos' })).toHaveTextContent('Mopaz')
  })

  it('sem login de painel mostra a tela de acesso própria (não a de contas) e entra com usuário e senha do painel', async () => {
    let logged = false
    const { user, admin, router } = setup(async () => { if (!logged) throw unauthorized(); return overview }, vi.fn(async () => { logged = true; return { username: 'Mopaz' } }))
    expect(await screen.findByRole('heading', { name: 'Acesso administrativo' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin')
    await user.type(screen.getByLabelText('Usuário do painel'), 'Mopaz')
    await user.type(screen.getByLabelText('Senha do painel'), 'senha-do-painel')
    await user.click(screen.getByRole('button', { name: 'Entrar no painel' }))
    expect(admin.login).toHaveBeenCalledWith('Mopaz', 'senha-do-painel')
    expect(await screen.findByRole('heading', { name: 'Quem está usando' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sair do painel' }))
    expect(admin.logout).toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Acesso administrativo' })).toBeInTheDocument()
  })

  it('senha errada mostra o erro e continua na tela de acesso', async () => {
    const { user } = setup(async () => { throw unauthorized() }, vi.fn(async () => { throw new AccountApiError(401, 'INVALID_CREDENTIALS', 'Usuário ou senha incorretos.') }))
    await user.type(await screen.findByLabelText('Usuário do painel'), 'Mopaz')
    await user.type(screen.getByLabelText('Senha do painel'), 'errada')
    await user.click(screen.getByRole('button', { name: 'Entrar no painel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuário ou senha incorretos.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('bane com confirmação e motivo, e desbane quem está banido', async () => {
    const { user, admin } = setup(async () => overview)
    const chato = await screen.findByRole('row', { name: 'Chato' })
    expect(within(chato).getByText('Banida')).toBeInTheDocument()
    expect(within(chato).getByText(/Spam/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Banir Quieto' }))
    expect(admin.ban).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Motivo do banimento (opcional)'), 'Ofensas')
    await user.click(screen.getByRole('button', { name: 'Confirmar banimento' }))
    expect(admin.ban).toHaveBeenCalledWith('id-quieto', 'Ofensas')
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Confirmar banimento' })).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Desbanir Chato' }))
    expect(admin.unban).toHaveBeenCalledWith('id-banida')
    await user.click(screen.getByRole('button', { name: /^Banidas/ }))
    expect(screen.getAllByRole('row', { name: /^(Maatt|Mopaz|Quieto|Chato)$/ }).map((r) => r.getAttribute('aria-label'))).toEqual(['Chato'])
  })

  it('troca a senha de uma conta, gera senha e mostra o resultado só uma vez', async () => {
    const { user, admin } = setup(async () => overview)
    await user.click(await screen.findByRole('button', { name: 'Trocar senha de Quieto' }))
    const field = screen.getByLabelText('Senha nova da conta')
    await user.click(screen.getByRole('button', { name: 'Gerar senha' }))
    const generated = (field as HTMLInputElement).value
    expect(generated).toHaveLength(12)
    await user.clear(field); await user.type(field, 'senha-provisoria-1')
    await user.click(screen.getByRole('checkbox', { name: /criar a própria senha/ }))
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(admin.setPassword).toHaveBeenCalledWith('id-quieto', 'senha-provisoria-1', false)
    const done = await screen.findByRole('status', { name: 'Senha alterada' })
    expect(within(done).getByText('senha-provisoria-1')).toBeInTheDocument()
    await user.click(within(done).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByText('senha-provisoria-1')).not.toBeInTheDocument()
  })

  it('textos de tempo e transmissão', () => {
    const t = Date.parse('2026-10-04T12:00:00Z')
    expect(relativeTime(null, t)).toBe('Nunca')
    expect(relativeTime('2026-10-04T11:59:30Z', t)).toBe('Agora')
    expect(relativeTime('2026-10-04T11:40:00Z', t)).toBe('Há 20 min')
    expect(relativeTime('2026-10-03T12:00:00Z', t)).toBe('Há 1 dia')
    expect(describeStream({ width: null, height: null, fps: 55, codec: 'H264', hardware: true, limitation: 'none', mbps: null })).toBe('55 fps · H.264 placa de vídeo')
    expect(describeStream(null)).toBe('Transmitindo')
    expect(generatePassword()).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{12}$/)
    expect(describeReceiving({ from: 'bifas', fps: 58, freezesPerMinute: 0, lossPercent: 0.1 })).toEqual({ text: 'Assistindo bifas: 58 fps · sem travadas', bad: false })
  })
})
