import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'

function installBridge(ready: { version: string } | null) {
  let notify: (update: { version: string }) => void = () => {}
  const update = {
    status: vi.fn(async () => ready),
    onReady: vi.fn((callback: (update: { version: string }) => void) => { notify = callback; return () => {} }),
    install: vi.fn(async () => true),
  }
  ;(window as unknown as { velun: unknown }).velun = { app: 'Velun Gx', version: '0.2.0', update }
  return { update, notify: (version: string) => notify({ version }) }
}

describe('UpdateBanner', () => {
  afterEach(() => { delete (window as unknown as { velun?: unknown }).velun })

  it('não aparece no navegador comum', () => {
    const { container } = render(<UpdateBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('aparece quando a versão nova termina de baixar e instala ao clicar', async () => {
    const { update, notify } = installBridge(null)
    render(<UpdateBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => notify('0.3.0'))
    expect(screen.getByRole('status')).toHaveTextContent('Nova versão do Velun Gx pronta (0.3.0)')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reiniciar e atualizar' }))
    expect(update.install).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Instalando a versão 0.3.0')
  })

  it('mostra o download em andamento e troca pelo botão quando termina', () => {
    let progress: (p: { version: string; percent: number }) => void = () => {}
    const { notify } = installBridge(null)
    const bridge = (window as unknown as { velun: { update: Record<string, unknown> } }).velun
    bridge.update.progress = vi.fn(async () => null)
    bridge.update.onProgress = vi.fn((callback: typeof progress) => { progress = callback; return () => {} })
    render(<UpdateBanner />)
    act(() => progress({ version: '0.3.0', percent: 42 }))
    expect(screen.getByRole('status')).toHaveTextContent('Baixando a versão 0.3.0 do Velun Gx… 42%')
    act(() => notify('0.3.0'))
    expect(screen.getByRole('button', { name: 'Reiniciar e atualizar' })).toBeInTheDocument()
  })

  it('mostra a versão que já estava baixada ao abrir a página', async () => {
    installBridge({ version: '0.3.0' })
    render(<UpdateBanner />)
    expect(await screen.findByRole('button', { name: 'Reiniciar e atualizar' })).toBeInTheDocument()
  })
})
