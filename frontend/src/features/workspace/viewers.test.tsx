import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readWatching } from '../../media/LiveKitRoomClient'
import { ViewersBadge } from './StreamGrid'

describe('quem está assistindo', () => {
  it('lê a lista publicada por cada participante e ignora valores inválidos', () => {
    expect(readWatching(JSON.stringify(['ana', 'davi']))).toEqual(['ana', 'davi'])
    expect(readWatching(undefined)).toEqual([])
    expect(readWatching('não é json')).toEqual([])
    expect(readWatching(JSON.stringify({ ana: true }))).toEqual([])
    expect(readWatching(JSON.stringify(['ana', 3, null]))).toEqual(['ana'])
  })

  it('mostra quantos assistem e, ao clicar, os nomes', () => {
    render(<ViewersBadge isLocal viewers={[{ identity: 'a', name: 'Ana', isLocal: false }, { identity: 'n', name: 'Neguin', isLocal: false }]} />)
    const badge = screen.getByRole('button', { name: '2 pessoas assistindo' })
    expect(badge).toHaveAttribute('title', 'Assistindo: Ana, Neguin')
    fireEvent.click(badge)
    expect(screen.getByRole('dialog', { name: 'Quem está assistindo' })).toHaveTextContent('Assistindo você')
    expect(screen.getByText('Neguin')).toBeInTheDocument()
  })

  it('avisa quando ninguém está assistindo a sua transmissão', () => {
    render(<ViewersBadge isLocal viewers={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '0 pessoas assistindo' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Ninguém está assistindo sua transmissão agora.')
  })
})
