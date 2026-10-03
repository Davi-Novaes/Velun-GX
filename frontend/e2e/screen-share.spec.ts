import { expect, test } from '@playwright/test'
import {
  closeBrowsers,
  createRoom,
  expectVideoFlowing,
  hasLiveShareAudio,
  instrumentDisplayCapture,
  join,
  person,
  simulateNativeStop,
  startShare,
} from './support'

// Critério de saída da Fase 3: 1 transmissor + 1 espectador em Chrome, Edge e Firefox, com e sem áudio.

// navegador novo a cada teste: reaproveitar o Firefox depois de fechar contextos com WebRTC ativo é instável
test.afterEach(closeBrowsers)

test('Chromium → Chromium: tela + áudio chegam, "transmitindo" aparece e parar limpa o palco', async ({ baseURL }) => {
  const maria = await person('Maria', 'chromium', baseURL!)
  const joao = await person('João', 'chromium', baseURL!)
  const code = await createRoom(maria)
  await join(maria, code)
  await join(joao, code)

  await startShare(maria, { audio: true })

  const panel = maria.page.getByRole('region', { name: 'Sua transmissão' })
  await expect(panel.getByText('Transmitindo')).toBeVisible()
  await expect(panel.getByText(/🔊 Ativado/)).toBeVisible()
  await expectVideoFlowing(maria, 'Sua tela (prévia)')

  const received = await expectVideoFlowing(joao, 'Tela de Maria')
  expect(received.height).toBeLessThanOrEqual(1080)
  await expect.poll(() => hasLiveShareAudio(joao), { message: 'João deveria receber o áudio' }).toBe(true)
  await expect(joao.page.getByRole('region', { name: /Participantes/ }).getByText('transmitindo')).toBeVisible()

  // desativar só o áudio mantém o vídeo
  await panel.getByRole('button', { name: 'Desativar áudio' }).click()
  await expect(panel.getByText(/Desativado/)).toBeVisible()
  await expectVideoFlowing(joao, 'Tela de Maria')

  await panel.getByRole('button', { name: 'Parar compartilhamento' }).click()
  await expect(joao.page.getByText('Ninguém está compartilhando a tela.')).toBeVisible()
  await expect(maria.page.getByRole('button', { name: 'Compartilhar tela' })).toBeVisible()
})

test('Chromium → Chromium: sem áudio funciona normalmente', async ({ baseURL }) => {
  const maria = await person('Maria', 'chromium', baseURL!)
  const joao = await person('João', 'chromium', baseURL!)
  const code = await createRoom(maria)
  await join(maria, code)
  await join(joao, code)

  await startShare(maria, { audio: false })

  await expect(maria.page.getByRole('region', { name: 'Sua transmissão' }).getByText(/Desligado/)).toBeVisible()
  await expectVideoFlowing(joao, 'Tela de Maria')
  expect(await hasLiveShareAudio(joao)).toBe(false)
})

test('Chromium transmite; Edge e Firefox assistem', async ({ baseURL }) => {
  const maria = await person('Maria', 'chromium', baseURL!)
  const edu = await person('Edu', 'msedge', baseURL!)
  const fabi = await person('Fabi', 'firefox', baseURL!)
  const code = await createRoom(maria)
  await join(maria, code)
  await join(edu, code)
  await join(fabi, code)

  await startShare(maria, { audio: true })

  await expectVideoFlowing(edu, 'Tela de Maria')
  await expectVideoFlowing(fabi, 'Tela de Maria')
  await expect.poll(() => hasLiveShareAudio(edu)).toBe(true)
  await expect.poll(() => hasLiveShareAudio(fabi)).toBe(true)
})

test('Firefox transmite (sem opção de áudio) e Chromium assiste', async ({ baseURL }) => {
  const fabi = await person('Fabi', 'firefox', baseURL!)
  const joao = await person('João', 'chromium', baseURL!)
  const code = await createRoom(fabi)
  await join(fabi, code)
  await join(joao, code)

  await fabi.page.getByRole('button', { name: 'Compartilhar tela' }).click()
  const dialog = fabi.page.getByRole('dialog', { name: 'Compartilhar tela' })
  await expect(dialog.getByText(/não compartilha áudio/)).toBeVisible()
  await expect(dialog.getByLabel('Compartilhar áudio')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Compartilhar' }).click()

  await expect(fabi.page.getByRole('region', { name: 'Sua transmissão' })).toBeVisible()
  await expectVideoFlowing(joao, 'Tela de Fabi')
  expect(await hasLiveShareAudio(joao)).toBe(false)
})

test('Edge transmite com áudio; Firefox assiste', async ({ baseURL }) => {
  const edu = await person('Edu', 'msedge', baseURL!)
  const fabi = await person('Fabi', 'firefox', baseURL!)
  const code = await createRoom(edu)
  await join(edu, code)
  await join(fabi, code)

  await startShare(edu, { audio: true })

  await expectVideoFlowing(fabi, 'Tela de Edu')
  await expect.poll(() => hasLiveShareAudio(fabi)).toBe(true)
})

test('parar pela barra nativa do navegador encerra a transmissão para todos', async ({ baseURL }) => {
  const maria = await person('Maria', 'chromium', baseURL!)
  const joao = await person('João', 'chromium', baseURL!)
  await instrumentDisplayCapture(maria)
  const code = await createRoom(maria)
  await join(maria, code)
  await join(joao, code)
  await startShare(maria, { audio: true })
  await expectVideoFlowing(joao, 'Tela de Maria')

  await simulateNativeStop(maria)

  await expect(maria.page.getByRole('region', { name: 'Sua transmissão' })).toHaveCount(0)
  await expect(maria.page.getByRole('button', { name: 'Compartilhar tela' })).toBeVisible()
  await expect(joao.page.getByText('Ninguém está compartilhando a tela.')).toBeVisible()
  // a captura de áudio também foi liberada (indicador do sistema some)
  const liveTracks = await maria.page.evaluate(() =>
    (window as unknown as { __captures: MediaStream[] }).__captures.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length,
  )
  expect(liveTracks).toBe(0)
})

test('quem assiste pode silenciar, ajustar o volume e ver em tela cheia', async ({ baseURL }) => {
  const maria = await person('Maria', 'chromium', baseURL!)
  const joao = await person('João', 'chromium', baseURL!)
  const code = await createRoom(maria)
  await join(maria, code)
  await join(joao, code)
  await startShare(maria, { audio: true })
  await expectVideoFlowing(joao, 'Tela de Maria')
  await expect.poll(() => hasLiveShareAudio(joao)).toBe(true)
  const audio = joao.page.locator('audio[data-share-audio]')

  const stage = joao.page.locator('figure.share-video-large')
  await stage.hover()
  await joao.page.getByRole('button', { name: 'Silenciar transmissão' }).click()
  expect(await audio.evaluate((a: HTMLAudioElement) => a.muted)).toBe(true)
  // silenciar é só local: Maria continua transmitindo áudio
  await expect(maria.page.getByRole('region', { name: 'Sua transmissão' }).getByText(/Ativado/)).toBeVisible()

  await joao.page.getByLabel('Volume da transmissão').fill('40')
  expect(await audio.evaluate((a: HTMLAudioElement) => ({ muted: a.muted, volume: a.volume }))).toEqual({ muted: false, volume: 0.4 })

  await joao.page.getByRole('button', { name: 'Tela cheia' }).click()
  await expect.poll(() => joao.page.evaluate(() => document.fullscreenElement?.getAttribute('data-share-id') ?? null)).not.toBeNull()
  await expectVideoFlowing(joao, 'Tela de Maria')

  await joao.page.keyboard.press('f')
  await expect.poll(() => joao.page.evaluate(() => document.fullscreenElement)).toBeNull()
})
