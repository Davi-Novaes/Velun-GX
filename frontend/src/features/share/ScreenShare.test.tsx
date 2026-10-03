import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareError } from '../../media/RoomClient'
import { FakeRoomClient, fakeApi, localShare, renderAt, share, stubDesktopChromium, stubNoScreenShare } from '../../test/fakes'

async function enterRoom(client: FakeRoomClient) {
  const user = userEvent.setup()
  renderAt('/room/K7F3QX9M', { api: fakeApi(), client })
  await user.type(await screen.findByLabelText('Nome'), 'Maria')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
  act(() => client.finishConnect!())
  await screen.findByText('Conectado!')
  return user
}

describe('Compartilhamento de tela', () => {
  beforeEach(() => stubDesktopChromium())
  afterEach(() => stubNoScreenShare())

  it('abre o diálogo com tipo, áudio, qualidade e FPS, e compartilha com as opções escolhidas', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    const dialog = screen.getByRole('dialog', { name: 'Compartilhar tela' })
    await user.click(within(dialog).getByLabelText('Aba do navegador'))
    expect(within(dialog).getByLabelText('Compartilhar áudio')).toBeChecked()
    await user.selectOptions(within(dialog).getByLabelText('Qualidade'), '1080p')
    await user.selectOptions(within(dialog).getByLabelText('Taxa de quadros'), '60')
    await user.click(within(dialog).getByRole('button', { name: 'Compartilhar' }))

    expect(client.shareCalls).toEqual([{ surface: 'browser', audio: true, audioScope: 'shared', resolution: '1080p', fps: 60 }])
  })

  it('mostra claramente que está transmitindo, com resolução, FPS e áudio', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Compartilhar' }))

    const panel = await screen.findByRole('region', { name: 'Sua transmissão' })
    expect(within(panel).getByText('Transmitindo')).toBeInTheDocument()
    expect(within(panel).getByText(/1920x1080/)).toBeInTheDocument()
    expect(within(panel).getByText(/30 FPS/)).toBeInTheDocument()
    expect(within(panel).getByText(/Ativado/)).toBeInTheDocument()
    // o botão principal vira "Parar compartilhamento"
    expect(screen.getAllByRole('button', { name: 'Parar compartilhamento' })).toHaveLength(2)
  })

  it('desativa só o áudio e para a transmissão', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)
    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Compartilhar' }))

    await user.click(await screen.findByRole('button', { name: 'Desativar áudio' }))
    expect(client.audioEnabledCalls).toEqual([false])

    await user.click(within(screen.getByRole('region', { name: 'Sua transmissão' })).getByRole('button', { name: 'Parar compartilhamento' }))
    expect(client.stopShareCalls).toBe(1)
    expect(screen.queryByRole('region', { name: 'Sua transmissão' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compartilhar tela' })).toBeInTheDocument()
  })

  it('segue só com vídeo e avisa quando o navegador não entregou áudio', async () => {
    const client = new FakeRoomClient()
    client.nextShare = localShare({ surface: 'window', audioRequested: true, hasAudio: false, audioEnabled: false })
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Compartilhar' }))

    expect(await screen.findByText(/O áudio não está disponível para este tipo de compartilhamento neste navegador/)).toBeInTheDocument()
    const panel = screen.getByRole('region', { name: 'Sua transmissão' })
    expect(within(panel).getByText(/Indisponível/)).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Desativar áudio' })).not.toBeInTheDocument()
  })

  it('cancelar o seletor do navegador não mostra erro', async () => {
    const client = new FakeRoomClient()
    client.nextShare = new ShareError('cancelled', 'Compartilhamento cancelado.')
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Compartilhar' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Compartilhar tela' })).toBeInTheDocument()
  })

  it('falha de captura vira aviso de erro', async () => {
    const client = new FakeRoomClient()
    client.nextShare = new ShareError('failed', 'Não foi possível capturar a tela.')
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Compartilhar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível capturar a tela.')
  })

  it('exibe a tela de quem compartilha no palco', async () => {
    const client = new FakeRoomClient()
    await enterRoom(client)

    act(() => client.emit('sharesChanged', [share({ ownerName: 'João' })]))

    expect(screen.getByLabelText('Tela de João')).toBeInTheDocument()
    expect(client.attachedVideos).toContain('p_joao')
    expect(screen.queryByText('Ninguém está compartilhando a tela.')).not.toBeInTheDocument()

    act(() => client.emit('sharesChanged', []))
    expect(screen.getByText('Ninguém está compartilhando a tela.')).toBeInTheDocument()
  })

  it('mantém a escolha ao surgir uma transmissão e troca apenas por clique', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)

    act(() => client.emit('sharesChanged', [share({ id: 'p_a', ownerName: 'Ana' })]))
    act(() => client.emit('sharesChanged', [share({ id: 'p_a', ownerName: 'Ana' }), share({ id: 'p_b', ownerName: 'Bia' })]))

    const strip = screen.getByRole('list', { name: 'Outros compartilhamentos' })
    expect(within(strip).getByLabelText('Ver tela de Bia')).toBeInTheDocument()

    await user.click(within(strip).getByLabelText('Ver tela de Bia'))
    expect(within(screen.getByRole('list', { name: 'Outros compartilhamentos' })).getByLabelText('Ver tela de Ana')).toBeInTheDocument()
    expect(client.watchingShare).toBe('p_b')
  })

  it('não assistir cancela a assinatura e permanece pausado quando surge outra tela', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)
    act(() => client.emit('sharesChanged', [share()]))
    await user.click(screen.getByRole('button', { name: /Não assistir a nenhuma/ }))
    expect(client.watchingShare).toBeNull()
    expect(screen.queryByLabelText('Tela de João')).not.toBeInTheDocument()
    act(() => client.emit('sharesChanged', [share(), share({ id: 'p_ana', ownerName: 'Ana' })]))
    expect(client.watchingShare).toBeNull()
    await user.click(screen.getByRole('button', { name: /Ana.*Clique para assistir/ }))
    expect(client.watchingShare).toBe('p_ana')
    expect(screen.getByLabelText('Tela de Ana')).toBeInTheDocument()
  })

  it('bloqueia novo compartilhamento quando a sala já tem 3', async () => {
    const client = new FakeRoomClient()
    await enterRoom(client)

    act(() => client.emit('sharesChanged', [share({ id: 'a' }), share({ id: 'b' }), share({ id: 'c' })]))

    expect(screen.getByRole('button', { name: 'Compartilhar tela' })).toBeDisabled()
  })

  it('combina telas em grade, remove uma, foca só uma e pausa todas', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)
    const a = share({ id: 'a', ownerName: 'Ana', hasAudio: true, audioReady: true })
    const b = share({ id: 'b', ownerName: 'Bia', hasAudio: true, audioReady: true })
    act(() => client.emit('sharesChanged', [a, b]))
    await user.click(screen.getByRole('button', { name: 'Adicionar tela de Bia à grade' }))
    expect(client.watchingShares).toEqual(['a', 'b'])
    expect(screen.getByLabelText('Tela de Ana')).toBeInTheDocument()
    expect(screen.getByLabelText('Tela de Bia')).toBeInTheDocument()
    expect(document.querySelectorAll('audio')).toHaveLength(2)
    expect(document.querySelector('.watch-grid-multiple')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remover tela de Ana da grade' }))
    expect(client.watchingShares).toEqual(['b'])
    await user.click(screen.getByRole('button', { name: /Assistir a todas/ }))
    expect(client.watchingShares).toEqual(['a', 'b'])
    await user.click(screen.getByRole('button', { name: 'Ver somente Ana' }))
    expect(client.watchingShares).toEqual(['a'])
    act(() => client.emit('sharesChanged', [a, b, share({ id: 'c', ownerName: 'Caio' })]))
    expect(client.watchingShares).toEqual(['a'])
    await user.click(screen.getByRole('button', { name: /Não assistir a nenhuma/ }))
    expect(client.watchingShares).toEqual([])
    expect(document.querySelectorAll('video, audio')).toHaveLength(0)
  })

  it('libera o áudio bloqueado pelo navegador com um clique', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)

    act(() => {
      client.emit('sharesChanged', [share({ hasAudio: true, audioReady: true, audioMuted: false })])
      client.emit('audioPlaybackChanged', true)
    })
    await user.click(screen.getByRole('button', { name: /Clique para ouvir/ }))

    expect(client.startAudioCalls).toBe(1)
  })
})

describe('Dispositivo sem compartilhamento de tela (celular)', () => {
  beforeEach(() => stubNoScreenShare())

  it('não oferece o botão e explica que dá para assistir', async () => {
    await enterRoom(new FakeRoomClient())

    expect(screen.queryByRole('button', { name: 'Compartilhar tela' })).not.toBeInTheDocument()
    expect(screen.getByText(/não permite compartilhar a tela/)).toBeInTheDocument()
  })
})

describe('Navegador sem áudio no compartilhamento (Firefox/Safari)', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: () => undefined, getSupportedConstraints: () => ({}) },
    })
  })
  afterEach(() => stubNoScreenShare())

  it('não mostra a opção de áudio nem de aba e avisa que será só vídeo', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    const dialog = screen.getByRole('dialog')

    expect(within(dialog).queryByLabelText('Compartilhar áudio')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Aba do navegador')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/não compartilha áudio/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Compartilhar' }))
    expect(client.shareCalls[0]).toMatchObject({ surface: 'any', audio: false })
  })
})

describe('Controles de quem assiste', () => {
  beforeEach(() => stubDesktopChromium())
  afterEach(() => stubNoScreenShare())

  function audioOf(id: string) {
    return document.querySelector<HTMLAudioElement>(`audio[data-share-audio="${id}"]`)!
  }

  it('silencia e ajusta o volume só para você', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)
    act(() => client.emit('sharesChanged', [share({ hasAudio: true, audioReady: true, audioMuted: false })]))

    await user.click(screen.getByRole('button', { name: 'Silenciar transmissão' }))
    expect(audioOf('p_joao').muted).toBe(true)
    expect(screen.getByRole('button', { name: 'Ativar som da transmissão' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Ativar som da transmissão' }))
    expect(audioOf('p_joao').muted).toBe(false)

    fireEvent.change(screen.getByLabelText('Volume da transmissão'), { target: { value: '30' } })
    expect(audioOf('p_joao').volume).toBeCloseTo(0.3)
    expect(audioOf('p_joao').muted).toBe(false)

    // arrastar até 0 = silenciar; reativar volta num volume audível
    fireEvent.change(screen.getByLabelText('Volume da transmissão'), { target: { value: '0' } })
    expect(audioOf('p_joao').muted).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Ativar som da transmissão' }))
    expect(audioOf('p_joao').volume).toBeCloseTo(0.5)
  })

  it('atalho M silencia; digitando num campo não dispara', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)
    act(() => client.emit('sharesChanged', [share({ hasAudio: true, audioReady: true, audioMuted: false })]))

    await user.keyboard('m')
    expect(audioOf('p_joao').muted).toBe(true)
    await user.keyboard('M')
    expect(audioOf('p_joao').muted).toBe(false)
  })

  it('tela cheia pelo botão, pelo atalho F e por duplo clique', async () => {
    const requestFullscreen = vi.fn(async function (this: HTMLElement) {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: this })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const exitFullscreen = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })

    const client = new FakeRoomClient()
    const user = await enterRoom(client)
    act(() => client.emit('sharesChanged', [share()]))

    await user.click(screen.getByRole('button', { name: 'Tela cheia' }))
    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(requestFullscreen.mock.contexts[0]).toBe(document.querySelector('figure[data-share-id="p_joao"]'))
    expect(await screen.findByRole('button', { name: 'Sair da tela cheia' })).toBeInTheDocument()

    await user.keyboard('f')
    expect(exitFullscreen).toHaveBeenCalledTimes(1)

    await user.dblClick(screen.getByLabelText('Tela de João'))
    expect(requestFullscreen).toHaveBeenCalledTimes(2)
  })

  it('sem áudio na transmissão, só a tela cheia aparece', async () => {
    const client = new FakeRoomClient()
    await enterRoom(client)
    act(() => client.emit('sharesChanged', [share({ hasAudio: false })]))

    expect(screen.queryByRole('button', { name: 'Silenciar transmissão' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tela cheia' })).toBeInTheDocument()
  })

  it('na própria prévia não há controle de som (a prévia não toca áudio)', async () => {
    const client = new FakeRoomClient()
    await enterRoom(client)
    act(() => client.emit('sharesChanged', [share({ id: 'me', isLocal: true, hasAudio: true })]))

    expect(screen.queryByRole('button', { name: 'Silenciar transmissão' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tela cheia' })).toBeInTheDocument()
  })
})

describe('Som do compartilhamento sem pegar a call do Discord', () => {
  beforeEach(() => stubDesktopChromium())
  afterEach(() => stubNoScreenShare())

  it('por padrão transmite só o som do que é compartilhado', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText(/Só da aba ou janela compartilhada/)).toBeChecked()
    expect(within(dialog).getByText(/Não inclui Discord/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Compartilhar' }))

    expect(client.shareCalls[0]).toMatchObject({ audio: true, audioScope: 'shared' })
  })

  it('som do computador todo só se a pessoa escolher, com aviso de que inclui a call', async () => {
    const client = new FakeRoomClient()
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByLabelText(/Todo o som do computador/))
    expect(within(dialog).getByText(/até a call do Discord/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Compartilhar' }))

    expect(client.shareCalls[0]).toMatchObject({ audio: true, audioScope: 'system' })
  })

  it('tela inteira sem o som do computador segue sem áudio e explica o porquê', async () => {
    const client = new FakeRoomClient()
    client.nextShare = localShare({ surface: 'monitor', audioScope: 'shared', audioRequested: true, hasAudio: false, audioEnabled: false })
    const user = await enterRoom(client)

    await user.click(screen.getByRole('button', { name: 'Compartilhar tela' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Compartilhar' }))

    expect(await screen.findByText(/compartilhe a aba ou a janela/)).toBeInTheDocument()
  })
})
