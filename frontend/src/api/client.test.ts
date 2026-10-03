import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSfuUrl, sortParticipants } from '../media/RoomClient'
import { participant } from '../test/fakes'
import { api, ApiError, describeError, resetSessionForTests } from './client'

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    resetSessionForTests()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('cria a sessão antes de criar a sala (uma vez só)', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { guestId: 'g' }))
    fetchMock.mockResolvedValueOnce(json(201, { code: 'A' }))
    fetchMock.mockResolvedValueOnce(json(201, { code: 'B' }))

    await api.createRoom()
    await api.createRoom()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/sessions', '/api/v1/rooms', '/api/v1/rooms'])
  })

  it('traduz ProblemDetails em ApiError com código e Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { code: 'RATE_LIMITED', detail: 'Aguarde' }, { 'Retry-After': '17' }))

    const error = await api.getRoom('ABC').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 17 })
    expect(describeError(error)).toBe('Muitas tentativas. Aguarde 17 segundos.')
  })

  it('renova a sessão expirada e repete a chamada uma vez', async () => {
    fetchMock.mockResolvedValueOnce(json(201, {}))
    fetchMock.mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }))
    fetchMock.mockResolvedValueOnce(json(200, {}))
    fetchMock.mockResolvedValueOnce(json(200, { participant: { id: 'p' } }))

    const joined = await api.joinRoom('ABC', 'Maria')

    expect(joined.participant.id).toBe('p')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('falha de rede vira NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api.getRoom('ABC')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})

describe('RoomClient helpers', () => {
  it('usa a mesma origem quando o backend não informa a URL do SFU', () => {
    expect(resolveSfuUrl('', { protocol: 'https:', host: 'tela.exemplo.com' })).toBe('wss://tela.exemplo.com')
    expect(resolveSfuUrl('', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173')
    expect(resolveSfuUrl('wss://sfu.regiao.exemplo.com', { protocol: 'https:', host: 'x' })).toBe('wss://sfu.regiao.exemplo.com')
  })

  it('ordena: você, quem transmite, depois por nome', () => {
    const sorted = sortParticipants([
      participant({ name: 'bruno' }),
      participant({ name: 'Ana' }),
      participant({ name: 'Zé', isSharing: true }),
      participant({ name: 'Eu', isLocal: true }),
    ])
    expect(sorted.map((p) => p.name)).toEqual(['Eu', 'Zé', 'Ana', 'bruno'])
  })
})
