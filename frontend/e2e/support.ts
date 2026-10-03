import { type Browser, type BrowserContext, chromium, expect, firefox, type Page } from '@playwright/test'

export type BrowserKind = 'chromium' | 'msedge' | 'firefox'

const CHROMIUM_ARGS = [
  // aceita captura de tela/áudio sem o seletor nativo e entrega uma "tela" sintética
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
]

const FIREFOX_PREFS = {
  'media.navigator.permission.disabled': true,
  'media.navigator.streams.fake': true,
  'media.autoplay.default': 0,
}

const browsers = new Map<BrowserKind, Browser>()
const people: Person[] = []

export async function launch(kind: BrowserKind): Promise<Browser> {
  const existing = browsers.get(kind)
  if (existing) return existing
  const browser =
    kind === 'firefox'
      ? await firefox.launch({ firefoxUserPrefs: FIREFOX_PREFS })
      : await chromium.launch({ args: CHROMIUM_ARGS, ...(kind === 'msedge' ? { channel: 'msedge' } : {}) })
  browsers.set(kind, browser)
  return browser
}

/** Fecha as páginas de cada teste: conexões WebRTC abertas acumulam CPU e derrubam o navegador. */
export async function closePeople(): Promise<void> {
  await Promise.allSettled(people.splice(0).map((p) => p.context.close()))
}

export async function closeBrowsers(): Promise<void> {
  await closePeople()
  await Promise.all([...browsers.values()].map((b) => b.close()))
  browsers.clear()
}

export interface Person {
  name: string
  kind: BrowserKind
  context: BrowserContext
  page: Page
}

/** Cada pessoa = contexto próprio (cookies/sessão próprios), como navegadores diferentes. */
export async function person(name: string, kind: BrowserKind, baseURL: string, options: { forceRelay?: boolean } = {}): Promise<Person> {
  const context = await (await launch(kind)).newContext({
    baseURL,
    viewport: { width: 1280, height: 800 },
    // HTTPS de dev usa a CA local (infra/certs), que os navegadores de teste não conhecem
    ignoreHTTPSErrors: true,
  })
  if (options.forceRelay) await context.addInitScript(() => localStorage.setItem('ss:forceRelay', '1'))
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error(`[${name}/${kind}] pageerror:`, error.message))
  const p = { name, kind, context, page }
  people.push(p)
  return p
}

export async function createRoom(p: Person): Promise<string> {
  await p.page.goto('/legacy')
  await p.page.getByRole('button', { name: 'Criar sala' }).click()
  const link = await p.page.getByLabel('Link da sala').inputValue()
  const code = link.split('/room/')[1]
  expect(code).toMatch(/^[0-9A-Z]{8}$/)
  return code!
}

export async function join(p: Person, code: string): Promise<void> {
  await p.page.goto(`/room/${code}`)
  await p.page.getByLabel('Nome').fill(p.name)
  await p.page.getByRole('button', { name: 'Entrar' }).click()
  await expect(p.page.getByRole('button', { name: 'Sair' })).toBeVisible()
}

export async function startShare(p: Person, options: { audio: boolean }): Promise<void> {
  await p.page.getByRole('button', { name: 'Compartilhar tela' }).click()
  const dialog = p.page.getByRole('dialog', { name: 'Compartilhar tela' })
  const audio = dialog.getByLabel('Compartilhar áudio')
  if (await audio.count()) await audio.setChecked(options.audio)
  await dialog.getByRole('button', { name: 'Compartilhar' }).click()
  await expect(p.page.getByRole('region', { name: 'Sua transmissão' })).toBeVisible()
}

/**
 * O vídeo recebido tem dimensão e continua andando (não é um quadro congelado).
 * O tempo de reprodução de um MediaStream só avança com quadros chegando; o contador de quadros ajuda onde existe
 * (Firefox devolve sempre 0 em getVideoPlaybackQuality para WebRTC e expõe mozPaintedFrames).
 */
export async function expectVideoFlowing(p: Person, label: string): Promise<{ width: number; height: number }> {
  const video = p.page.getByLabel(label, { exact: true })
  await expect(video).toBeVisible()
  const read = () =>
    video.evaluate((v: HTMLVideoElement) => ({
      width: v.videoWidth,
      height: v.videoHeight,
      time: v.currentTime,
      frames: Math.max(v.getVideoPlaybackQuality().totalVideoFrames, (v as unknown as { mozPaintedFrames?: number }).mozPaintedFrames ?? 0),
    }))
  await expect
    .poll(async () => { const r = await read(); return r.width > 0 && r.time > 0.5 }, { message: `${p.name} deveria receber vídeo de "${label}"` })
    .toBe(true)
  let first = await read()
  // Uma troca de camada simulcast pode reiniciar o relógio do elemento sem encerrar a transmissão.
  await expect.poll(async () => {
    const next = await read()
    const flowing = next.time - first.time > 0.5 && next.frames > first.frames
    if (!flowing && (next.time < first.time || next.frames < first.frames)) first = next
    return flowing
  }, { message: `${p.name}: quadros de "${label}" deveriam continuar chegando`, intervals: [1000, 1000, 1500] }).toBe(true)
  const second = await read()
  return { width: second.width, height: second.height }
}

/** Existe elemento de áudio do compartilhamento com uma track de áudio ativa. */
export async function hasLiveShareAudio(p: Person): Promise<boolean> {
  return p.page.evaluate(() =>
    [...document.querySelectorAll<HTMLAudioElement>('audio[data-share-audio]')].some((a) => {
      const stream = a.srcObject as MediaStream | null
      return stream?.getAudioTracks().some((t) => t.readyState === 'live') ?? false
    }),
  )
}

/** Registra as RTCPeerConnection criadas na página (para inspecionar o caminho ICE escolhido). */
export async function instrumentPeerConnections(p: Person): Promise<void> {
  await p.context.addInitScript(() => {
    const Original = window.RTCPeerConnection
    const list: RTCPeerConnection[] = []
    ;(window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = list
    const Patched = function (this: unknown, config?: RTCConfiguration) {
      const pc = new Original(config)
      list.push(pc)
      return pc
    } as unknown as typeof RTCPeerConnection
    Patched.prototype = Original.prototype
    Object.setPrototypeOf(Patched, Original)
    window.RTCPeerConnection = Patched
  })
}

export interface IcePath {
  policy: RTCIceTransportPolicy | undefined
  usesTurnServer: boolean
  localCandidate: string | undefined
  remote: string | undefined
  bytesReceived: number
}

/** Caminho ICE selecionado de cada conexão conectada. */
export async function selectedIcePaths(p: Person): Promise<IcePath[]> {
  return p.page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs?: RTCPeerConnection[] }).__pcs ?? []
    const paths = []
    for (const pc of pcs) {
      if (pc.connectionState !== 'connected') continue
      const stats = await pc.getStats()
      const byId = new Map<string, Record<string, unknown>>()
      let pairId: string | undefined
      stats.forEach((s: Record<string, unknown>) => {
        byId.set(s.id as string, s)
        if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId as string
      })
      const pair = pairId ? byId.get(pairId) : undefined
      const local = pair ? byId.get(pair.localCandidateId as string) : undefined
      const remote = pair ? byId.get(pair.remoteCandidateId as string) : undefined
      const config = pc.getConfiguration()
      paths.push({
        policy: config.iceTransportPolicy,
        usesTurnServer: (config.iceServers ?? []).some((s) => [s.urls].flat().some((u) => u.startsWith('turn:') || u.startsWith('turns:'))),
        localCandidate: local?.candidateType as string | undefined,
        remote: remote ? `${remote.address}:${remote.port}` : undefined,
        bytesReceived: Number(pair?.bytesReceived ?? 0),
      })
    }
    return paths
  })
}

/** Guarda as capturas de tela da página, para simular o botão nativo "Parar compartilhamento" do navegador. */
export async function instrumentDisplayCapture(p: Person): Promise<void> {
  await p.context.addInitScript(() => {
    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
    const captured: MediaStream[] = []
    ;(window as unknown as { __captures: MediaStream[] }).__captures = captured
    navigator.mediaDevices.getDisplayMedia = async (options?: DisplayMediaStreamOptions) => {
      const stream = await original(options)
      captured.push(stream)
      return stream
    }
  })
}

/** O que a barra nativa do navegador faz ao clicar em "Parar compartilhamento": encerra a track de vídeo. */
export async function simulateNativeStop(p: Person): Promise<void> {
  await p.page.evaluate(() => {
    for (const stream of (window as unknown as { __captures: MediaStream[] }).__captures) {
      for (const track of stream.getVideoTracks()) {
        track.stop()
        track.dispatchEvent(new Event('ended'))
      }
    }
  })
}
