import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { senderLossPercent } from '../../media/LiveKitRoomClient'
import { DraggablePanel } from './DraggablePanel'
import { NETWORK_LABEL, networkLevel } from './network'

describe('cor do indicador de conexão', () => {
  it.each([
    [3, 'good'],
    [18, 'good'],
    [49, 'good'],
    [50, 'fair'],
    [149, 'fair'],
    [150, 'poor'],
    [900, 'poor'],
  ] as const)('%i ms → %s', (ms, level) => {
    expect(networkLevel(ms, 0)).toBe(level)
  })

  it('perda pequena não deixa amarelo com ping baixo; perda relevante sim', () => {
    expect(networkLevel(18, 1)).toBe('good')
    expect(networkLevel(18, 5)).toBe('fair')
    expect(networkLevel(18, 15)).toBe('poor')
  })

  it('sem medição, fica neutro', () => {
    expect(networkLevel(undefined, 50)).toBe('unknown')
    expect(NETWORK_LABEL.good).toBe('Conexão boa')
  })
})

describe('perda de pacotes no envio', () => {
  it('usa a fração recente informada pelo servidor', () => {
    expect(senderLossPercent({ fractionLost: 0.004, packetsLost: 3 }, 1000, 3)).toBeCloseTo(0.4)
  })

  it('um pacote perdido não vira 100% (bug anterior)', () => {
    expect(senderLossPercent({ packetsLost: 1 }, 5000, 1)).toBeCloseTo(0.02)
  })

  it('sem relatório do servidor, não informa', () => {
    expect(senderLossPercent(undefined, 1000, 0)).toBeUndefined()
  })
})

describe('prévia arrastável', () => {
  function setup() {
    const onVideoClick = vi.fn()
    render(
      <div style={{ position: 'relative', width: 1000, height: 600 }}>
        <DraggablePanel className="local-preview" storageKey="test:pos" label="Sua transmissão">
          <video data-testid="video" onClick={onVideoClick} />
          <button>Parar</button>
        </DraggablePanel>
      </div>,
    )
    return { panel: screen.getByLabelText('Sua transmissão'), video: screen.getByTestId('video'), onVideoClick }
  }

  it('arrastar move o painel, lembra a posição e não conta como clique', () => {
    const { panel, video, onVideoClick } = setup()

    fireEvent.pointerDown(video, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(video, { clientX: 60, clientY: 70, pointerId: 1 })
    expect(panel).toHaveClass('dragging')
    fireEvent.pointerUp(video, { clientX: 60, clientY: 70, pointerId: 1 })
    fireEvent.click(video)

    expect(onVideoClick).not.toHaveBeenCalled()
    expect(panel.style.right).not.toBe('')
    expect(localStorage.getItem('test:pos')).not.toBeNull()
  })

  it('clique sem arrastar continua funcionando', () => {
    const { video, onVideoClick } = setup()

    fireEvent.pointerDown(video, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(video, { clientX: 102, clientY: 101, pointerId: 1 })
    fireEvent.pointerUp(video, { clientX: 102, clientY: 101, pointerId: 1 })
    fireEvent.click(video)

    expect(onVideoClick).toHaveBeenCalledOnce()
  })

  it('arrastar a partir de um botão não move o painel', () => {
    const { panel } = setup()
    const button = screen.getByRole('button', { name: 'Parar' })

    fireEvent.pointerDown(button, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(button, { clientX: 10, clientY: 10, pointerId: 1 })

    expect(panel).not.toHaveClass('dragging')
  })
})
