import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AccountApiError, type accounts } from '../api/accounts'
import { routes } from '../app/App'
import { ServicesProvider } from '../app/services'

const profile = { id: 'user-1', username: 'Davi', nickname: null, name: 'Davi', avatar: null, createdAt: '', lastLoginAt: null }
function setup(path: string, overrides: Partial<typeof accounts> = {}) {
  const api = { me: vi.fn(async () => profile), register: vi.fn(async () => profile), login: vi.fn(async () => profile), logout: vi.fn(async () => undefined), updateProfile: vi.fn(async () => profile), ...overrides }
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<ServicesProvider services={{ accounts: api }}><RouterProvider router={router} /></ServicesProvider>)
  return { router, api, user: userEvent.setup() }
}

describe('Conta', () => {
  it('cadastra e mostra a conta obtida da API, sem guardar senha no storage', async () => {
    const { user, api, router } = setup('/register?next=/account')
    await user.type(screen.getByLabelText('Nome de usuário'), 'Davi')
    await user.type(screen.getByLabelText('Senha'), 'senha-muito-segura')
    await user.type(screen.getByLabelText('Confirmar senha'), 'senha-muito-segura')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText('Conta conectada')).toBeInTheDocument()
    expect(api.register).toHaveBeenCalledWith('Davi', 'senha-muito-segura', 'senha-muito-segura')
    expect(router.state.location.pathname).toBe('/account')
    expect(localStorage.length).toBe(0)
  })

  it('não envia cadastro se as senhas não coincidem', async () => {
    const { user, api } = setup('/register')
    await user.type(screen.getByLabelText('Nome de usuário'), 'Davi')
    await user.type(screen.getByLabelText('Senha'), 'senha-muito-segura')
    await user.type(screen.getByLabelText('Confirmar senha'), 'senha-diferente')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(screen.getByRole('alert')).toHaveTextContent('As senhas não coincidem.')
    expect(api.register).not.toHaveBeenCalled()
  })

  it('login e logout usam a API real do contrato', async () => {
    const { user, api, router } = setup('/login?next=/account')
    await user.type(screen.getByLabelText('Nome de usuário'), 'Davi')
    await user.type(screen.getByLabelText('Senha'), 'senha-muito-segura')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    await user.click(await screen.findByRole('button', { name: 'Sair da conta' }))
    expect(api.login).toHaveBeenCalledWith('Davi', 'senha-muito-segura')
    expect(api.logout).toHaveBeenCalledOnce()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('restaura conta ao abrir a página e redireciona sessão expirada', async () => {
    const { router } = setup('/account', { me: vi.fn(async () => { throw new AccountApiError(401, 'UNAUTHENTICATED', 'Sessão expirada') }) })
    expect(await screen.findByRole('heading', { name: 'Entrar na conta' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('uma falha de rede não é tratada como logout', async () => {
    setup('/account', { me: vi.fn(async () => { throw new AccountApiError(0, 'NETWORK_ERROR', 'Sem conexão') }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })
})
