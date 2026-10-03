import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { accounts } from '../../api/accounts'
import { NicknameForm } from './NicknameForm'

const profile = { id: 'u1', username: 'davi', nickname: null, name: 'davi', avatar: null, createdAt: '', lastLoginAt: null }

describe('NicknameForm', () => {
  it('salva o apelido sem espaços extras e avisa quem usa a tela', async () => {
    const saved = { ...profile, nickname: 'Davi 🎮', name: 'Davi 🎮' }
    const update = vi.spyOn(accounts, 'updateProfile').mockResolvedValue(saved)
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(<NicknameForm profile={profile} onSaved={onSaved} />)
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    await user.type(screen.getByLabelText('Apelido'), '  Davi 🎮 ')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(update).toHaveBeenCalledWith({ nickname: 'Davi 🎮' })
    expect(onSaved).toHaveBeenCalledWith(saved)
    expect(await screen.findByRole('status')).toHaveTextContent('Apelido salvo')
  })

  it('apagar o apelido volta a usar o nome de usuário', async () => {
    const update = vi.spyOn(accounts, 'updateProfile').mockResolvedValue(profile)
    const user = userEvent.setup()
    render(<NicknameForm profile={{ ...profile, nickname: 'Davi', name: 'Davi' }} onSaved={() => {}} />)
    await user.clear(screen.getByLabelText('Apelido'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(update).toHaveBeenCalledWith({ nickname: null })
  })
})
