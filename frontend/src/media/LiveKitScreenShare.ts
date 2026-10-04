import { type LocalTrackPublication, type Room, Track, type TrackPublishOptions, VideoPreset } from 'livekit-client'
import type { JoinResponse } from '../api/contracts'
import { type DesktopAudio, type DesktopAudioMode, desktopProcessAudio, pcAudioAllowed, startDesktopAudio, velunBridge } from '../desktop/velun'
import { type CodecDecision, chooseCodec, rememberH264Hardware, rememberVp9TooHeavy } from './codecChoice'
import { type EncodingPlan, planEncoding } from './presets'
import { type DisplaySurface, type LocalShare, type ShareOptions, ShareError, toShareError } from './RoomClient'

type Policy = JoinResponse['policy']

/**
 * Captura e publicação do compartilhamento de tela.
 * Vídeo e áudio são SEMPRE tracks separadas (sources screen_share e screen_share_audio), publicadas no
 * mesmo "stream" para o navegador de quem assiste sincronizá-las sem buffer extra.
 */
export class LiveKitScreenShare {
  private videoPublication: LocalTrackPublication | null = null
  private audioPublication: LocalTrackPublication | null = null
  private captured: MediaStream | null = null
  private current: LocalShare | null = null
  private sourceSize = { width: 0, height: 0 }
  /** App Velun Gx: som do PC vindo do componente nativo (sem o Discord), no lugar do áudio do navegador. */
  private desktopAudio: DesktopAudio | null = null
  /** Windows 10: som do PC inteiro vindo do próprio getDisplayMedia (o app entrega o "loopback" do sistema). */
  private pcAudioMode: DesktopAudioMode | undefined
  /** Formato de vídeo em uso e o que é preciso para republicar se ele mudar no meio da transmissão. */
  private codec: CodecDecision | null = null
  private publishContext: { plan: EncodingPlan; width: number; height: number; streamName: string; hardware: boolean } | null = null
  private codecWatch: ReturnType<typeof setInterval> | undefined
  private switchingCodec = false

  constructor(
    private readonly room: Room,
    private readonly policy: Policy,
    private readonly onChange: (share: LocalShare | null) => void,
    private readonly authorize?: () => Promise<void>,
    private readonly release?: () => Promise<void>,
  ) {}

  get state(): LocalShare | null {
    return this.current
  }

  /** Quantos compartilhamentos já existem na sala (limite da política: 3). */
  activeShares(): number {
    let count = this.videoPublication ? 1 : 0
    for (const p of this.room.remoteParticipants.values()) {
      if (p.getTrackPublication(Track.Source.ScreenShare)) count++
    }
    return count
  }

  async start(options: ShareOptions): Promise<LocalShare> {
    if (this.current) await this.stop()
    if (this.activeShares() >= this.policy.maxConcurrentScreenShares) {
      throw new ShareError('limit_reached', `A sala já tem ${this.policy.maxConcurrentScreenShares} compartilhamentos ativos.`)
    }

    const plan = planEncoding(options, {
      maxHeight: this.policy.video.maxHeight,
      maxFps: this.policy.video.maxFps,
      maxBitrateKbps: this.policy.video.maxBitrateKbps,
    })
    const wantAudio = options.audio && this.policy.audio.enabled
    const desktop = velunBridge()
    const path = audioPath(wantAudio, desktop !== null)

    // getDisplayMedia precisa ser a primeira coisa assíncrona depois do clique (ativação do usuário)
    let stream: MediaStream
    try {
      // no app (Windows 10 2004+/11) o som não vem do navegador: vem do componente nativo, que tira a call do Discord
      stream = await navigator.mediaDevices.getDisplayMedia(requestFor(options, plan, path))
    } catch (error) {
      throw toShareError(error)
    }

    const [videoTrack] = stream.getVideoTracks()
    if (!videoTrack) {
      stopAll(stream)
      throw new ShareError('failed', 'O navegador não entregou vídeo da tela.')
    }
    let audioTrack = stream.getAudioTracks()[0] ?? null
    this.captured = stream

    // Primeiro captura a fonte sem impor um retângulo; mede o tamanho REAL dos quadros (getSettings pode vir
    // errado antes do primeiro quadro) e só então calcula a redução proporcional e trava o tamanho.
    try {
      this.sourceSize = await fitCaptureToSource(videoTrack, options, plan, this.policy.video)
    } catch {
      stopAll(stream)
      this.captured = null
      throw new ShareError('failed', 'O navegador não conseguiu aplicar essa resolução. Tente uma resolução menor.')
    }

    videoTrack.contentHint = plan.contentHint
    const settings = videoTrack.getSettings() as MediaTrackSettings & { displaySurface?: string }
    const width = settings.width ?? 0
    const height = settings.height ?? 0
    const streamName = `screen-${this.room.localParticipant.identity}`

    // H.264 pela placa de vídeo se a pessoa ativou; senão VP9/VP8 conforme o processador desta máquina
    this.codec = chooseCodec(plan, { hardware: options.hardwareEncoding === true })
    this.publishContext = { plan, width, height, streamName, hardware: options.hardwareEncoding === true }
    try {
      await this.authorize?.()
      this.videoPublication = await this.room.localParticipant.publishTrack(videoTrack, this.videoPublishOptions(this.codec))
    } catch (error) {
      stopAll(stream)
      this.captured = null
      await this.release?.().catch(() => undefined)
      throw new ShareError('failed', error instanceof Error ? error.message : 'Não foi possível enviar a tela para o servidor.')
    }

    let audioError: string | undefined
    this.pcAudioMode = undefined
    if (path === 'helper') {
      const opened = await this.openDesktopAudio(options)
      audioTrack = opened.track
      // clicou antes de terminar a verificação do Windows: é Windows 10, oferece o som do PC
      audioError = opened.error && desktopProcessAudio() === false ? WINDOWS10_AUDIO : opened.error
    } else if (path === 'pc-blocked') {
      audioError = WINDOWS10_AUDIO
    } else if (path === 'pc-loopback') {
      if (audioTrack) this.pcAudioMode = 'system-loopback'
      else audioError = 'Atualize o Velun Gx (versão 0.2.8 ou mais nova) para transmitir o som do PC no Windows 10.'
    }

    let hasAudio = false
    if (audioTrack) {
      try {
        this.audioPublication = await this.room.localParticipant.publishTrack(audioTrack, {
          source: Track.Source.ScreenShareAudio,
          name: `screen-audio:${this.room.localParticipant.identity}`,
          stream: streamName,
          // áudio de sistema/música: sem DTX (não corta no silêncio), RED contra perda, estéreo
          dtx: false,
          red: true,
          forceStereo: true,
          audioPreset: { maxBitrate: Math.min(this.policy.audio.maxBitrateKbps, 128) * 1000 },
        })
        hasAudio = true
      } catch {
        // áudio é opcional: segue só com vídeo
        audioTrack.stop()
        this.closeDesktopAudio()
      }
    }

    // botão "Parar compartilhamento" da barra nativa do navegador
    videoTrack.addEventListener('ended', () => { if (this.captured === stream) void this.stop() }, { once: true })

    this.current = {
      surface: desktop ? await desktopSurface(settings.displaySurface) : toSurface(settings.displaySurface),
      width,
      height,
      fps: plan.fps,
      quality: { resolution: options.resolution, fps: options.fps },
      audioRequested: wantAudio,
      audioScope: options.audioScope,
      hasAudio,
      audioEnabled: hasAudio,
      desktopAudio: hasAudio ? this.desktopAudio?.mode ?? this.pcAudioMode : undefined,
      audioError,
      codec: this.codec,
    }
    this.watchCodec()
    this.onChange(this.current)
    return this.current
  }

  async stop(): Promise<void> {
    clearInterval(this.codecWatch)
    this.codecWatch = undefined
    this.codec = null
    this.publishContext = null
    const video = this.videoPublication
    const audio = this.audioPublication
    const stream = this.captured
    this.videoPublication = null
    this.audioPublication = null
    this.captured = null
    const wasSharing = this.current !== null
    this.current = null

    await Promise.allSettled([
      video?.track ? this.room.localParticipant.unpublishTrack(video.track, true) : Promise.resolve(),
      audio?.track ? this.room.localParticipant.unpublishTrack(audio.track, true) : Promise.resolve(),
    ])
    if (stream) stopAll(stream) // libera a captura e some o indicador do sistema
    this.closeDesktopAudio()
    if (wasSharing) { this.onChange(null); await this.release?.().catch(() => undefined) }
  }

  /** Mantém a publicação e o canal: somente a captura e os limites RTP mudam. */
  async updateQuality(options: ShareOptions): Promise<LocalShare> {
    const track = this.videoPublication?.videoTrack
    if (!track || !this.current) throw new ShareError('not_connected', 'Inicie uma transmissão primeiro.')
    const plan = planEncoding(options, this.policy.video)
    if (this.publishContext) this.publishContext = { ...this.publishContext, plan }
    const target = captureTarget(this.sourceSize, options, plan, this.policy.video)
    const previousConstraints = track.mediaStreamTrack.getConstraints()
    const previousQuality = this.current.quality
    const previousEncodings = track.sender?.getParameters().encodings.map((e) => ({ rid: e.rid, maxBitrate: e.maxBitrate, maxFramerate: e.maxFramerate }))
    try {
    await applyCaptureSize(track.mediaStreamTrack, target, plan.fps)
    track.mediaStreamTrack.contentHint = plan.contentHint
    await track.setDegradationPreference(plan.degradationPreference)
    if (track.sender) {
      const parameters = track.sender.getParameters()
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = Math.round(plan.maxBitrateKbps * 1000 / (encoding.scaleResolutionDownBy ?? 1) ** 2)
        encoding.maxFramerate = (encoding.scaleResolutionDownBy ?? 1) > 2 ? Math.min(15, plan.fps) : (encoding.scaleResolutionDownBy ?? 1) > 1 ? Math.min(30, plan.fps) : plan.fps
      }
      await track.sender.setParameters(parameters)
    }
    } catch (error) {
      await track.mediaStreamTrack.applyConstraints(previousConstraints).catch(() => undefined)
      await track.setDegradationPreference(planEncoding(previousQuality, this.policy.video).degradationPreference).catch(() => undefined)
      if (track.sender && previousEncodings) {
        const fresh = track.sender.getParameters()
        for (const e of fresh.encodings) { const old = previousEncodings.find((p) => p.rid === e.rid); if (old) { e.maxBitrate = old.maxBitrate; e.maxFramerate = old.maxFramerate } }
        await track.sender.setParameters(fresh).catch(() => undefined)
      }
      throw new ShareError('failed', error instanceof Error ? `Não foi possível alterar a qualidade: ${error.message}` : 'O navegador recusou essa qualidade. A configuração anterior foi mantida.')
    }
    if (!this.current) throw new ShareError('cancelled', 'A transmissão foi encerrada.')
    const settings = track.mediaStreamTrack.getSettings()
    this.current = { ...this.current, width: settings.width ?? target.width, height: settings.height ?? target.height, fps: plan.fps, quality: { resolution: options.resolution, fps: options.fps } }
    if (this.audioPublication && this.current.audioEnabled !== options.audio) await this.setAudioEnabled(options.audio)
    this.onChange(this.current)
    return this.current
  }

  /** Cancelar o seletor não interrompe a fonte atual. A publicação conserva seu SID. */
  async switchSource(options: ShareOptions): Promise<LocalShare> {
    const track = this.videoPublication?.videoTrack
    if (!track || !this.current) throw new ShareError('not_connected', 'Inicie uma transmissão primeiro.')
    let stream: MediaStream
    const desktop = velunBridge()
    const wantAudio = options.audio && this.policy.audio.enabled
    const path = audioPath(wantAudio, desktop !== null)
    try { stream = await navigator.mediaDevices.getDisplayMedia(requestFor(options, planEncoding(options, this.policy.video), path)) }
    catch (error) { throw toShareError(error) }
    const next = stream.getVideoTracks()[0]
    if (!next) { stopAll(stream); throw new ShareError('failed', 'A fonte não forneceu vídeo.') }
    const previous = this.captured
    const previousSize = this.sourceSize
    try {
      const plan = planEncoding(options, this.policy.video)
      this.sourceSize = await fitCaptureToSource(next, options, plan, this.policy.video)
      await track.replaceTrack(next, { userProvidedTrack: true })
    } catch (error) { this.sourceSize = previousSize; stopAll(stream); throw error }
    this.captured = stream
    next.addEventListener('ended', () => { if (this.captured === stream) void this.stop() }, { once: true })
    // Áudio acompanha a nova fonte. Nunca mantém a captura de áudio da fonte antiga.
    const oldAudio = this.audioPublication
    this.audioPublication = null
    if (oldAudio?.track) await this.room.localParticipant.unpublishTrack(oldAudio.track, true).catch(() => undefined)
    this.closeDesktopAudio()
    let audio = stream.getAudioTracks()[0]
    let audioError: string | undefined
    this.pcAudioMode = undefined
    if (path === 'helper') {
      // a nova fonte pode mudar o modo (janela = só aquele programa; tela = PC sem o Discord)
      const opened = await this.openDesktopAudio(options)
      audio = opened.track ?? undefined
      audioError = opened.error && desktopProcessAudio() === false ? WINDOWS10_AUDIO : opened.error
    } else if (path === 'pc-blocked') {
      audioError = WINDOWS10_AUDIO
    } else if (path === 'pc-loopback') {
      if (audio) this.pcAudioMode = 'system-loopback'
      else audioError = 'Atualize o Velun Gx (versão 0.2.8 ou mais nova) para transmitir o som do PC no Windows 10.'
    }
    let hasAudio = false
    if (audio) {
      try {
        this.audioPublication = await this.room.localParticipant.publishTrack(audio, {
          source: Track.Source.ScreenShareAudio, stream: `screen-${this.room.localParticipant.identity}`,
          dtx: false, red: true, forceStereo: true, audioPreset: { maxBitrate: this.policy.audio.maxBitrateKbps * 1000 },
        })
        hasAudio = true
      } catch { audio.stop(); this.closeDesktopAudio() }
    }
    if (previous) stopAll(previous)
    const nextSurface = (next.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface
    this.current = {
      ...this.current,
      surface: desktop ? await desktopSurface(nextSurface) : toSurface(nextSurface),
      audioRequested: options.audio, audioScope: options.audioScope, hasAudio, audioEnabled: hasAudio,
      desktopAudio: hasAudio ? this.desktopAudio?.mode ?? this.pcAudioMode : undefined, audioError,
    }
    return this.updateQuality(options)
  }

  async setAudioEnabled(enabled: boolean): Promise<void> {
    const audio = this.audioPublication
    if (!audio?.track || !this.current) return
    if (enabled) await audio.unmute()
    else await audio.mute()
    this.current = { ...this.current, audioEnabled: enabled }
    this.onChange(this.current)
  }

  private async openDesktopAudio(options: ShareOptions): Promise<{ track: MediaStreamTrack | null; error?: string }> {
    const bridge = velunBridge()
    if (!bridge) return { track: null }
    try {
      this.desktopAudio = await startDesktopAudio(bridge, options.audioScope)
      return { track: this.desktopAudio.track }
    } catch (error) {
      // áudio é opcional: a tela segue sem som e a pessoa vê o motivo
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
      return { track: null, error: message || 'O som do PC não pôde ser capturado.' }
    }
  }

  private closeDesktopAudio(): void {
    this.desktopAudio?.stop()
    this.desktopAudio = null
  }

  private videoPublishOptions(decision: CodecDecision): TrackPublishOptions {
    const { plan, width, height, streamName } = this.publishContext!
    // H.264 pela placa no mesmo limite dos outros formatos: mais bits (já foi 1,25×) só aumentava os pacotes
    // a perder e o tamanho dos quadros-chave, e cada espectador recebe essa camada única inteira
    const maxBitrateKbps = plan.maxBitrateKbps
    const common: TrackPublishOptions = {
      source: Track.Source.ScreenShare,
      name: `screen:${this.room.localParticipant.identity}`,
      stream: streamName,
      screenShareEncoding: { maxBitrate: maxBitrateKbps * 1000, maxFramerate: plan.fps, priority: 'high' },
      degradationPreference: plan.degradationPreference,
    }
    // VP9 numa resolução só (L1T3): com camadas de tamanhos diferentes (L3T3) o Chromium segurava a camada 1080p
    // até a banda estimada subir, e quem assistia ficava em 540p. A adaptação à rede passa a ser só por quadros/s.
    // O servidor mantém uma cópia VP8 para quem não decodificar VP9.
    if (decision.codec === 'vp9') return { ...common, videoCodec: 'vp9', scalabilityMode: 'L1T3', backupCodec: { codec: 'vp8' } }
    // H.264 pela placa: uma camada só — com várias camadas (simulcast) o Chromium volta a codificar no processador
    if (decision.codec === 'h264') return { ...common, videoCodec: 'h264', simulcast: false }
    return { ...common, videoCodec: decision.codec, simulcast: true, screenShareSimulcastLayers: screenLayers(plan, width, height) }
  }

  /**
   * Confere o formato durante a transmissão: H.264 sem placa de vídeo de verdade (o navegador caiu para o
   * codificador do processador) troca para VP9/VP8; VP9 com o processador no limite por ~10 s troca para VP8.
   */
  private watchCodec(): void {
    clearInterval(this.codecWatch)
    let cpuStrikes = 0
    let hardwareChecked = false
    this.codecWatch = setInterval(() => {
      void (async () => {
        const sender = this.videoPublication?.videoTrack?.sender
        if (!sender || !this.codec || this.switchingCodec) return
        const report = await sender.getStats().catch(() => null)
        let top: Record<string, unknown> | undefined
        report?.forEach((s: Record<string, unknown>) => {
          if (s.type === 'outbound-rtp' && s.kind === 'video' && Number(s.frameWidth ?? 0) >= Number(top?.frameWidth ?? -1)) top = s
        })
        if (!top) return
        if (this.codec.codec === 'h264' && !hardwareChecked && Number(top.framesEncoded ?? 0) > 30) {
          hardwareChecked = true
          // alguns navegadores não informam quem codifica: sem a informação, mantém o H.264 (não conclui "sem placa")
          if (typeof top.powerEfficientEncoder !== 'boolean') return
          const onCard = top.powerEfficientEncoder
          rememberH264Hardware(onCard)
          if (!onCard) {
            const fallback = chooseCodec(this.publishContext!.plan, { hardware: true })
            // diagnóstico: qual codificador o navegador usou no H.264 (fica guardado neste navegador)
            try { localStorage.setItem('tj:lastH264Encoder', String(top.encoderImplementation ?? 'não informado')) } catch { /* sem armazenamento */ }
            await this.switchCodec(fallback)
          }
          return
        }
        if (this.codec.codec === 'vp9') {
          cpuStrikes = top.qualityLimitationReason === 'cpu' ? cpuStrikes + 1 : 0
          if (cpuStrikes >= 5) {
            rememberVp9TooHeavy()
            await this.switchCodec({ codec: 'vp8', reason: 'Processador no limite durante a transmissão: trocado de VP9 para VP8' })
          }
        }
      })()
    }, 2000)
  }

  /** Republica o MESMO vídeo capturado em outro formato (quem assiste vê uma pausa de ~1 s). */
  private async switchCodec(next: CodecDecision): Promise<void> {
    const publication = this.videoPublication
    if (!publication?.track || !this.publishContext || this.switchingCodec || next.codec === this.codec?.codec) return
    this.switchingCodec = true
    const media = publication.track.mediaStreamTrack
    try {
      await this.room.localParticipant.unpublishTrack(publication.track, false)
      if (this.videoPublication !== publication || media.readyState === 'ended') return // parou no meio
      this.videoPublication = await this.room.localParticipant.publishTrack(media, this.videoPublishOptions(next))
      this.codec = next
      if (this.current) { this.current = { ...this.current, codec: next }; this.onChange(this.current) }
      this.watchCodec()
    } catch {
      // não conseguiu no formato novo: volta para o leve, que todo navegador codifica
      if (media.readyState !== 'ended' && this.publishContext) {
        this.videoPublication = await this.room.localParticipant.publishTrack(media, this.videoPublishOptions({ codec: 'vp8', reason: 'Formato anterior falhou' })).catch(() => null)
        this.codec = { codec: 'vp8', reason: 'Formato anterior falhou' }
      }
    } finally {
      this.switchingCodec = false
    }
  }

  /** Prévia local: o próprio stream capturado, sem passar pelo SFU. */
  previewTrack(): MediaStreamTrack | null {
    return this.captured?.getVideoTracks()[0] ?? null
  }

  refreshCapture(): LocalShare | null {
    const track = this.previewTrack()
    const settings = track?.getSettings()
    if (this.current && settings && (settings.width !== this.current.width || settings.height !== this.current.height)) {
      this.current = { ...this.current, width: settings.width ?? this.current.width, height: settings.height ?? this.current.height }
      this.onChange(this.current)
    }
    if (!this.current) return null
    const width = track?.getConstraints().width
    return {
      ...this.current,
      sourceWidth: this.sourceSize.width,
      sourceHeight: this.sourceSize.height,
      captureLocked: typeof width === 'object' && width !== null && 'min' in width && width.min !== undefined,
    }
  }
}

export function displayMediaOptions(options: ShareOptions, plan: EncodingPlan, audio: boolean): DisplayMediaStreamOptions {
  const systemWide = audio && options.audioScope === 'system'
  const video: MediaTrackConstraints & { displaySurface?: string } = {
    // Só a altura é limitada: o navegador reduz mantendo a proporção da fonte (inclusive ultrawide).
    // Limitar também a largura faz o Chrome ajustar a imagem ao retângulo máximo (ex.: 3840x1080 numa tela 16:9).
    frameRate: { ideal: plan.fps, max: plan.fps },
  }
  if (options.surface !== 'any') video.displaySurface = options.surface

  return {
    video,
    audio: audio
      ? ({
          // áudio de sistema/aba: nenhum processamento de voz
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
          // não recaptura o som que a própria aba da sala toca (áudio de outras transmissões) — evita eco
          restrictOwnAudio: true,
        } as MediaTrackConstraints)
      : false,
    // opções do Chromium (ignoradas por quem não suporta)
    // Oferece áudio também para tela inteira; janela continua pedindo apenas o som daquele aplicativo.
    // No desktop, a captura real continua vindo do helper nativo, não desta opção do navegador.
    systemAudio: audio && (systemWide || options.surface === 'monitor') ? 'include' : 'exclude',
    // Janela: só o som daquele app (Chrome 141+ onde o sistema permite), nunca o do computador todo por padrão.
    windowAudio: !audio ? 'exclude' : systemWide ? 'system' : 'window',
    selfBrowserSurface: 'exclude', // não deixa compartilhar a própria aba da sala (eco/espelho infinito)
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  } as DisplayMediaStreamOptions
}

export function fitCapture(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) }
}

function lowLayerPreset(plan: EncodingPlan, width: number, height: number): VideoPreset {
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9
  const layerHeight = Math.min(plan.lowLayer.height, height || plan.lowLayer.height)
  return new VideoPreset(Math.round(layerHeight * aspect), layerHeight, plan.lowLayer.maxBitrateKbps * 1000, plan.lowLayer.fps)
}

function screenLayers(plan: EncodingPlan, width: number, height: number): VideoPreset[] {
  const low = lowLayerPreset(plan, width, height)
  if (height < 900) return [low]
  const midHeight = Math.min(720, Math.round(height * 2 / 3))
  return [low, new VideoPreset(Math.round(midHeight * width / height), midHeight, Math.round(plan.maxBitrateKbps * 450), Math.min(30, plan.fps))]
}

function toSurface(value: string | undefined): DisplaySurface | 'unknown' {
  return value === 'monitor' || value === 'window' || value === 'browser' ? value : 'unknown'
}

/** Mensagem do Windows 10 quando a pessoa ainda não aceitou transmitir o som do PC inteiro. */
export const WINDOWS10_AUDIO = 'Este Windows não permite tirar a call do Discord do som (precisa do Windows 10 versão 2004 ou mais novo). Para transmitir com áudio, ative "Som do PC (inclui a call do Discord)".'

/**
 * De onde vem o som desta captura. Decidido no clique, sem esperar nada (getDisplayMedia precisa da ativação):
 * browser = o navegador entrega; helper = componente nativo do app (Windows 10 2004+/11, sem Discord e sem o app);
 * pc-loopback = app no Windows 10 com o som do PC inteiro aceito; pc-blocked = Windows 10 sem aceitar.
 */
export type AudioPath = 'none' | 'browser' | 'helper' | 'pc-loopback' | 'pc-blocked'
export function audioPath(wantAudio: boolean, desktop: boolean, processAudio = desktopProcessAudio(), allowPc = pcAudioAllowed()): AudioPath {
  if (!wantAudio) return 'none'
  if (!desktop) return 'browser'
  if (processAudio === false) return allowPc ? 'pc-loopback' : 'pc-blocked'
  return 'helper'
}

function requestFor(options: ShareOptions, plan: EncodingPlan, path: AudioPath): DisplayMediaStreamOptions {
  if (path === 'pc-loopback') return displayMediaOptions({ ...options, audioScope: 'system' }, plan, true)
  return displayMediaOptions(options, plan, path === 'browser')
}

/** No app a captura vem do seletor próprio, que sabe se foi tela ou janela (o Chromium nem sempre informa). */
async function desktopSurface(value: string | undefined): Promise<DisplaySurface | 'unknown'> {
  const known = toSurface(value)
  if (known !== 'unknown') return known
  const source = await velunBridge()?.selectedSource().catch(() => null)
  return source?.kind === 'screen' ? 'monitor' : source?.kind === 'window' ? 'window' : 'unknown'
}

function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/**
 * Restrições de captura com tamanho EXATO (mínimo = máximo).
 * Só com "máximo", o Chrome trata a resolução como teto e reduz a captura sozinho quando acha o codificador
 * pesado (ex.: jogo a 60 FPS virando 1080×608 numa transmissão 1080p), sem aparecer como limitação no envio.
 * Com o tamanho fixo ele mantém a nitidez e, se precisar aliviar, reduz FPS (degradationPreference).
 * O FPS continua só com teto: cair de quadros sob carga é preferível a perder resolução.
 */
export function lockedCaptureConstraints(target: { width: number; height: number }, fps: number): MediaTrackConstraints {
  return {
    width: { min: target.width, ideal: target.width, max: target.width },
    height: { min: target.height, ideal: target.height, max: target.height },
    frameRate: { ideal: fps, max: fps },
  }
}

/** Versão anterior (só teto), usada se o navegador recusar o tamanho exato. */
export function flexibleCaptureConstraints(target: { width: number; height: number }, fps: number, aspectRatio?: number): MediaTrackConstraints {
  return {
    width: { ideal: target.width, max: target.width },
    height: { ideal: target.height, max: target.height },
    ...(aspectRatio ? { aspectRatio: { ideal: aspectRatio } } : {}),
    frameRate: { ideal: fps, max: fps },
  }
}

export async function applyCaptureSize(track: MediaStreamTrack, target: { width: number; height: number }, fps: number, aspectRatio?: number): Promise<'locked' | 'flexible'> {
  try {
    await track.applyConstraints(lockedCaptureConstraints(target, fps))
    return 'locked'
  } catch {
    await track.applyConstraints(flexibleCaptureConstraints(target, fps, aspectRatio))
    return 'flexible'
  }
}

/**
 * Tamanho real dos quadros da captura, lido de um <video> fora da tela.
 * Logo após o getDisplayMedia, getSettings() pode trazer a altura errada (ex.: 2560×1920 numa tela 2560×1440,
 * proporção 4:3 padrão antes do primeiro quadro). Calcular a redução com isso derruba a resolução enviada
 * (1080p virava 1440×810). Sem quadro em tempo hábil, usa getSettings().
 */
export async function measureFrameSize(track: MediaStreamTrack, timeoutMs = 1500): Promise<{ width: number; height: number }> {
  const settings = track.getSettings()
  const fallback = { width: settings.width ?? 1920, height: settings.height ?? 1080 }
  if (typeof document === 'undefined' || typeof MediaStream === 'undefined') return fallback
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  // a medição é só uma melhoria: se não for possível medir, nunca derruba a transmissão
  try { video.srcObject = new MediaStream([track]) } catch { return fallback }
  try {
    void video.play().catch(() => undefined)
    await new Promise<void>((resolve) => {
      if (video.videoWidth > 0) return resolve()
      const timer = setTimeout(resolve, timeoutMs)
      const done = () => { clearTimeout(timer); resolve() }
      video.addEventListener('loadedmetadata', done, { once: true })
      video.addEventListener('resize', done, { once: true })
    })
    return video.videoWidth > 0 && video.videoHeight > 0 ? { width: video.videoWidth, height: video.videoHeight } : fallback
  } finally {
    video.pause()
    video.srcObject = null
  }
}

/** Alvo de captura para a qualidade escolhida, mantendo a proporção da fonte. */
export function captureTarget(source: { width: number; height: number }, options: ShareOptions, plan: EncodingPlan, limits: { maxWidth: number; maxHeight: number }): { width: number; height: number } {
  const maxWidth = Math.min(options.outputWidth ?? (options.resolution === 'original' ? source.width : Math.round(plan.maxHeight * 16 / 9)), limits.maxWidth)
  const maxHeight = Math.min(options.outputHeight ?? plan.maxHeight, limits.maxHeight)
  return fitCapture(source.width, source.height, maxWidth, maxHeight)
}

/**
 * Mede a fonte, aplica o tamanho travado e confere o resultado: se a proporção entregue não bate com a pedida
 * (a fonte informada estava errada), recalcula uma vez com a proporção real dos quadros.
 */
export async function fitCaptureToSource(track: MediaStreamTrack, options: ShareOptions, plan: EncodingPlan, limits: { maxWidth: number; maxHeight: number }): Promise<{ width: number; height: number }> {
  let source = await measureFrameSize(track)
  let target = captureTarget(source, options, plan, limits)
  await applyCaptureSize(track, target, plan.fps, source.width / source.height)
  const delivered = await measureFrameSize(track, 1000)
  const wanted = target.width / target.height, got = delivered.width / delivered.height
  if (Math.abs(got - wanted) / wanted > 0.02) {
    source = { width: source.width, height: Math.round(source.width / got) }
    const corrected = captureTarget(source, options, plan, limits)
    if (corrected.width !== target.width || corrected.height !== target.height) {
      target = corrected
      await applyCaptureSize(track, target, plan.fps, got)
    }
  }
  return source
}
