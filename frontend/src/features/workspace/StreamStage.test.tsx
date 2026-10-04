import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveKitRoomClient } from '../../media/LiveKitRoomClient'
import { share } from '../../test/fakes'
import { StreamStage } from './StreamGrid'

const client = {
  attachShareVideo: vi.fn(() => () => undefined),
  setViewingSize: () => undefined,
  startAudio: async () => undefined,
} as unknown as LiveKitRoomClient

class NoopResizeObserver { observe() {} disconnect() {} }

const streams = [
  share({ id: 'ana', ownerName: 'Ana' }),
  share({ id: 'neguin', ownerName: 'Neguin' }),
  share({ id: 'eu', ownerName: 'Davi', isLocal: true }),
]

function stage(props: Partial<Parameters<typeof StreamStage>[0]> = {}) {
  return <StreamStage streams={streams} viewMode="grid" focusedStreamId={null} onFocus={() => undefined} client={client} hide={() => undefined} {...props} />
}
const tile = (name: string) => screen.getByRole('region', { name: `Transmissão de ${name}` })

describe('palco das transmissões', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
  })

  it('trocar Grade/Destaque e o principal não recria os vídeos (a conexão segue intacta)', () => {
    const view = render(stage())
    const videos = streams.map((s) => screen.getByLabelText(`Tela de ${s.ownerName}`))
    const attaches = vi.mocked(client.attachShareVideo).mock.calls.length
    view.rerender(stage({ viewMode: 'focus', focusedStreamId: 'neguin' }))
    view.rerender(stage({ viewMode: 'focus', focusedStreamId: 'eu' }))
    view.rerender(stage({ viewMode: 'grid', focusedStreamId: 'eu' }))
    streams.forEach((s, i) => expect(screen.getByLabelText(`Tela de ${s.ownerName}`)).toBe(videos[i]))
    expect(vi.mocked(client.attachShareVideo).mock.calls.length).toBe(attaches)
  })

  it('anima só ao trocar modo/destaque, nunca na primeira disposição', () => {
    const view = render(stage())
    const host = () => document.querySelector('.stream-stage')!
    expect(host()).not.toHaveClass('animated')
    view.rerender(stage({ viewMode: 'focus', focusedStreamId: 'ana' }))
    expect(host()).toHaveClass('animated')
  })

  it('no destaque, a escolhida é a principal e as outras viram miniaturas — inclusive a sua, marcada "(Você)"', () => {
    render(stage({ viewMode: 'focus', focusedStreamId: 'neguin' }))
    expect(tile('Neguin')).toHaveClass('is-main')
    expect(tile('Ana')).toHaveClass('is-thumb')
    expect(tile('Davi')).toHaveClass('is-thumb')
    expect(tile('Davi')).toHaveTextContent('Davi (Você)')
    expect(tile('Neguin').style.width).not.toBe('')
  })

  it('clique na miniatura coloca ela em destaque', () => {
    const onFocus = vi.fn()
    render(stage({ viewMode: 'focus', focusedStreamId: 'neguin', onFocus }))
    fireEvent.click(tile('Ana'))
    expect(onFocus).toHaveBeenCalledWith('ana')
  })

  it('na grade, duplo clique destaca; clique simples não', () => {
    const onFocus = vi.fn()
    render(stage({ onFocus }))
    fireEvent.click(tile('Ana'))
    expect(onFocus).not.toHaveBeenCalled()
    fireEvent.doubleClick(tile('Ana'))
    expect(onFocus).toHaveBeenCalledWith('ana')
  })

  it('cliques nos controles não acionam o destaque por baixo', () => {
    const onFocus = vi.fn()
    render(stage({ onFocus }))
    act(() => { fireEvent.doubleClick(screen.getByRole('button', { name: 'Menu de Ana' })) })
    expect(onFocus).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Destacar Ana' }))
    expect(onFocus).toHaveBeenCalledWith('ana')
  })

  it('miniatura não mostra controles técnicos, só nome, AO VIVO e estado do som', () => {
    render(stage({ viewMode: 'focus', focusedStreamId: 'neguin' }))
    expect(screen.queryByRole('button', { name: 'Qualidade de Ana' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Qualidade de Neguin' })).toBeInTheDocument()
    expect(tile('Ana')).toHaveTextContent('AO VIVO')
  })
})
