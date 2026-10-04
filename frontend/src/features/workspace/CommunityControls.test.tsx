import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { communities, type ServerDetails } from '../../api/communities'
import { RoleSettings } from './CommunityControls'

vi.mock('../../api/communities', () => ({ communities: { saveRole: vi.fn(), deleteRole: vi.fn() } }))
const details: ServerDetails = { id: 'server', name: 'Amigos', icon: null, ownerUserId: 'owner', channels: [], members: [{ id: 'owner', name: 'Dono', username: 'dono', role: 'owner' }], roles: [{ id: 'role', serverId: 'server', name: 'Moderador', color: '#aa91ff', position: 1, permissions: 4 }] }
beforeEach(() => vi.resetAllMocks())
describe('edição de cargos', () => {
  it('seleciona uma posição livre para novos cargos', () => {
    render(<RoleSettings details={details} actor="owner" refresh={vi.fn()} fail={vi.fn()} />)
    expect(screen.getByLabelText('Posição na hierarquia')).toHaveValue(2)
  })
  it('salvar mantém o cargo selecionado; salvar de novo atualiza em vez de duplicar', async () => {
    const user = userEvent.setup(), refresh = vi.fn().mockResolvedValue(undefined)
    vi.mocked(communities.saveRole).mockResolvedValue({ ...details.roles![0]!, name: 'Equipe' })
    render(<RoleSettings details={details} actor="owner" refresh={refresh} fail={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Moderador/ }))
    await user.clear(screen.getByLabelText('Nome do cargo')); await user.type(screen.getByLabelText('Nome do cargo'), 'Equipe')
    await user.click(screen.getByRole('button', { name: 'Salvar cargo' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(screen.getByLabelText('Nome do cargo')).toHaveValue('Equipe')
    expect(screen.getByRole('status')).toHaveTextContent('Cargo salvo')
    await user.click(screen.getByRole('button', { name: 'Salvar cargo' }))
    await waitFor(() => expect(communities.saveRole).toHaveBeenCalledTimes(2))
    expect(vi.mocked(communities.saveRole).mock.calls[1]?.[1].id).toBe('role')
  })
  it('erro de autorização aparece junto do formulário e preserva o preenchimento', async () => {
    vi.mocked(communities.saveRole).mockRejectedValue(new Error('Sem permissão para este cargo.'))
    const user = userEvent.setup()
    render(<RoleSettings details={details} actor="owner" refresh={vi.fn()} fail={vi.fn()} />)
    await user.type(screen.getByLabelText('Nome do cargo'), 'Equipe')
    await user.click(screen.getByRole('button', { name: 'Salvar cargo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão')
    expect(screen.getByLabelText('Nome do cargo')).toHaveValue('Equipe')
  })
})
