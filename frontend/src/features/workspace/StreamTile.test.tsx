import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveKitRoomClient } from '../../media/LiveKitRoomClient'
import { networkRtt } from '../../media/LiveKitRoomClient'
import { share } from '../../test/fakes'
import { StreamTile } from './StreamGrid'

const client = {
  attachShareVideo: () => () => undefined,
  setViewingSize: () => undefined,
  startAudio: async () => undefined,
} as unknown as LiveKitRoomClient

class NoopResizeObserver {
  observe() {}
  disconnect() {}
}

function stats(entries: Record<string, unknown>[]): RTCStatsReport {
  const map = new Map(entries.map((e) => [e.id as string, e]))
  return map as unknown as RTCStatsReport
}

describe('ping exibido = RTT de rede do par ICE', () => {
  it('usa o par ICE selecionado, não o RTT do RTCP', () => {
    const report = stats([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'CP1' },
      { id: 'CP1', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.034 },
      { id: 'CP2', type: 'candidate-pair', state: 'succeeded', nominated: false, currentRoundTripTime: 0.2 },
      { id: 'RI1', type: 'remote-inbound-rtp', roundTripTime: 0.905 },
    ])
    expect(networkRtt(report)).toBeCloseTo(34)
  })

  it('sem transporte informado, usa o par ICE nomeado', () => {
    const report = stats([
      { id: 'CP1', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.05 },
      { id: 'RI1', type: 'remote-inbound-rtp', roundTripTime: 0.9 },
    ])
    expect(networkRtt(report)).toBeCloseTo(50)
  })

  it('só recorre ao RTCP quando não há par ICE', () => {
    expect(networkRtt(stats([{ id: 'RI1', type: 'remote-inbound-rtp', roundTripTime: 0.12 }]))).toBeCloseTo(120)
    expect(networkRtt(stats([]))).toBeUndefined()
  })
})

describe('tela cheia: barras só aparecem ao mexer o mouse', () => {
  let fullscreenElement: Element | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', NoopResizeObserver)
    fullscreenElement = null
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: async function (this: HTMLElement) {
        fullscreenElement = this
        document.dispatchEvent(new Event('fullscreenchange'))
      },
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: async () => {
        fullscreenElement = null
        document.dispatchEvent(new Event('fullscreenchange'))
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function enterFullscreen() {
    render(<div className="workspace"><StreamTile share={share({ ownerName: 'Ana' })} client={client} focus={() => undefined} /></div>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Tela cheia de Ana' })) })
    return screen.getByRole('region', { name: 'Transmissão de Ana' })
  }

  it('ao entrar em tela cheia, começa só com o vídeo', async () => {
    const tile = await enterFullscreen()
    expect(tile).toHaveClass('chrome-hidden')
  })

  it('mexer o mouse mostra as barras, e elas somem após 2,5 s parado', async () => {
    const tile = await enterFullscreen()

    fireEvent.mouseMove(tile, { movementX: 5, movementY: 3 })
    expect(tile).not.toHaveClass('chrome-hidden')

    act(() => { vi.advanceTimersByTime(2400) })
    expect(tile).not.toHaveClass('chrome-hidden')
    act(() => { vi.advanceTimersByTime(200) })
    expect(tile).toHaveClass('chrome-hidden')
  })

  it('mousemove sem movimento real (mudança de layout) não mostra as barras', async () => {
    const tile = await enterFullscreen()
    fireEvent.mouseMove(tile, { movementX: 0, movementY: 0 })
    expect(tile).toHaveClass('chrome-hidden')
  })

  it('com o mouse sobre a barra, ela não some', async () => {
    const tile = await enterFullscreen()
    fireEvent.mouseMove(tile, { movementX: 4, movementY: 4 })
    const footer = tile.querySelector('.stream-card-footer')!
    fireEvent.mouseEnter(footer)

    act(() => { vi.advanceTimersByTime(5000) })
    expect(tile).not.toHaveClass('chrome-hidden')
  })

  it('fora da tela cheia, as barras ficam sempre visíveis', async () => {
    const tile = await enterFullscreen()
    await act(async () => { await document.exitFullscreen() })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(tile).not.toHaveClass('chrome-hidden')
  })
})
