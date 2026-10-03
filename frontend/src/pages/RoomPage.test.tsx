import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RoomConnectError } from '../media/RoomClient'
import { apiError, FakeRoomClient, fakeApi, joinResponse, participant, renderAt, roomInfo } from '../test/fakes'

async function enterName(name: string) {
  const user = userEvent.setup()
  const input = await screen.findByLabelText('Nome')
  await user.clear(input)
  await user.type(input, name)
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
  return user
}

describe('RoomPage — entrada', () => {
  it('pede o nome e mostra a ocupação da sala', async () => {
    renderAt('/room/K7F3QX9M', { api: fakeApi() })

    expect(await screen.findByRole('heading', { name: 'Entrar na sala' })).toBeInTheDocument()
    expect(await screen.findByText('3/20 participantes na sala')).toBeInTheDocument()
  })

  it('não entra sem nome', async () => {
    const api = fakeApi()
    renderAt('/room/K7F3QX9M', { api })
    await screen.findByText('3/20 participantes na sala')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar' }))

    expect(screen.getByText('Informe seu nome.')).toBeInTheDocument()
    expect(api.joinRoom).not.toHaveBeenCalled()
  })

  it('avisa que a sala está cheia e bloqueia a entrada', async () => {
    renderAt('/room/K7F3QX9M', { api: fakeApi({ getRoom: vi.fn(async () => roomInfo({ participantCount: 20, isFull: true })) }) })

    expect(await screen.findByRole('alert')).toHaveTextContent('Sala cheia (20/20)')
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeDisabled()
  })

  it('sala inexistente oferece criar outra', async () => {
    renderAt('/room/ZZZZZZZZ', { api: fakeApi({ getRoom: vi.fn(() => Promise.reject(apiError('ROOM_NOT_FOUND', 404))) }) })

    expect(await screen.findByRole('heading', { name: 'Sala indisponível' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Criar nova sala' })).toHaveAttribute('href', '/')
  })

  it('conecta em etapas e mostra os participantes', async () => {
    const api = fakeApi()
    const client = new FakeRoomClient()
    renderAt('/room/K7F3QX9M', { api, client })

    await enterName('  Maria ')

    expect(api.joinRoom).toHaveBeenCalledWith('K7F3QX9M', 'Maria', undefined)
    expect(await screen.findByText('Conectando…')).toBeInTheDocument()

    act(() => client.phase('verifying'))
    expect(screen.getByText('Verificando conexão…')).toHaveClass('active')

    act(() => {
      client.participants([
        participant({ name: 'Maria', isLocal: true, role: 'owner' }),
        participant({ name: 'João', isSharing: true }),
        participant({ name: 'Ana', connection: 'reconnecting', quality: 'lost' }),
      ])
      client.finishConnect!()
    })

    expect(await screen.findByText('Conectado!')).toBeInTheDocument()
    const list = screen.getByRole('region', { name: /Participantes/ })
    expect(within(list).getByText('(3/20)')).toBeInTheDocument()
    expect(within(list).getByText('(você)')).toBeInTheDocument()
    expect(within(list).getByText('anfitrião')).toBeInTheDocument()
    expect(within(list).getByText('transmitindo')).toBeInTheDocument()
    expect(within(list).getByText('reconectando')).toBeInTheDocument()
    expect(within(list).getByText('assistindo')).toBeInTheDocument()
  })

  it('lembra o participante para reconectar na mesma vaga', async () => {
    const api = fakeApi()
    const client = new FakeRoomClient()
    renderAt('/room/K7F3QX9M', { api, client })
    await enterName('Maria')
    act(() => client.finishConnect!())
    await screen.findByText('Conectado!')

    expect(sessionStorage.getItem('ss:participant:K7F3QX9M')).toBe('part-1')
  })

  it('sair desconecta e avisa o servidor', async () => {
    const api = fakeApi()
    const client = new FakeRoomClient()
    renderAt('/room/K7F3QX9M', { api, client })
    const user = await enterName('Maria')
    act(() => client.finishConnect!())

    await user.click(await screen.findByRole('button', { name: 'Sair' }))

    expect(await screen.findByRole('heading', { name: 'Você saiu da sala' })).toBeInTheDocument()
    expect(client.disconnectCalls).toBeGreaterThan(0)
    expect(api.leaveRoom).toHaveBeenCalledWith('K7F3QX9M', 'part-1')
  })

  it('sala cheia no momento do join (409)', async () => {
    renderAt('/room/K7F3QX9M', {
      api: fakeApi({ joinRoom: vi.fn(() => Promise.reject(apiError('ROOM_FULL', 409, 'A sala atingiu o limite de 20 participantes.'))) }),
    })

    await enterName('Maria')

    expect(await screen.findByRole('heading', { name: 'Sala cheia' })).toBeInTheDocument()
  })

  it('SFU recusa por lotação (corrida entre entradas) também vira "Sala cheia"', async () => {
    const api = fakeApi()
    const client = new FakeRoomClient()
    renderAt('/room/K7F3QX9M', { api, client })
    await enterName('Maria')

    await act(async () => client.failConnect!(new RoomConnectError('room_full', 'room is full')))

    expect(await screen.findByRole('heading', { name: 'Sala cheia' })).toBeInTheDocument()
    expect(api.leaveRoom).toHaveBeenCalledWith('K7F3QX9M', 'part-1')
  })

  it('explica quando a mesma pessoa abriu a sala em outra aba', async () => {
    const client = new FakeRoomClient()
    renderAt('/room/K7F3QX9M', { api: fakeApi({ joinRoom: vi.fn(async () => joinResponse()) }), client })
    await enterName('Maria')
    act(() => client.finishConnect!())
    await screen.findByText('Conectado!')

    act(() => client.phase('disconnected', 'replaced'))

    expect(await screen.findByRole('heading', { name: 'Você entrou em outra aba' })).toBeInTheDocument()
  })

  it('mostra "Reconectando…" sem sair da sala', async () => {
    const client = new FakeRoomClient()
    renderAt('/room/K7F3QX9M', { api: fakeApi(), client })
    await enterName('Maria')
    act(() => client.finishConnect!())
    await screen.findByText('Conectado!')

    act(() => client.phase('reconnecting'))
    expect(screen.getByText('Reconectando…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()

    act(() => client.phase('connected'))
    expect(screen.queryByText('Reconectando…')).not.toBeInTheDocument()
  })
})
