import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { apiError, fakeApi, renderAt } from '../test/fakes'

const created = {
  code: 'K7F3QX9M',
  url: 'http://localhost/room/K7F3QX9M',
  maxParticipants: 20,
  createdAt: '2026-09-29T12:00:00Z',
  expiresAt: '2026-09-30T12:00:00Z',
}

describe('HomePage', () => {
  it('cria a sala, mostra o link, copia e entra', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const api = fakeApi({ createRoom: vi.fn(async () => created) })
    const { router } = renderAt('/legacy', { api })

    expect(screen.getByRole('heading', { name: 'Compartilhamento de Tela' })).toBeInTheDocument()
    expect(screen.getByText(/até 20 pessoas/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Criar sala' }))

    expect(await screen.findByRole('heading', { name: 'Sala criada!' })).toBeInTheDocument()
    const link = `${window.location.origin}/room/K7F3QX9M`
    expect(screen.getByLabelText('Link da sala')).toHaveValue(link)

    await user.click(screen.getByRole('button', { name: 'Copiar link' }))
    expect(writeText).toHaveBeenCalledWith(link)
    expect(screen.getByRole('button', { name: 'Copiado!' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Entrar na sala' }))
    expect(router.state.location.pathname).toBe('/room/K7F3QX9M')
  })

  it('mostra o erro quando a criação é limitada', async () => {
    const user = userEvent.setup()
    const error = apiError('RATE_LIMITED', 429)
    Object.assign(error, { retryAfterSeconds: 42 })
    renderAt('/legacy', { api: fakeApi({ createRoom: vi.fn(async () => Promise.reject(error)) }) })

    await user.click(screen.getByRole('button', { name: 'Criar sala' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Aguarde 42 segundos')
    expect(screen.getByRole('button', { name: 'Criar sala' })).toBeEnabled()
  })
})
