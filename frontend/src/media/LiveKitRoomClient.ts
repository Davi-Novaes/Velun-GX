import {
  ConnectionQuality,
  DisconnectReason,
  type Participant,
  type AudioTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
} from 'livekit-client'
import { readReport } from './telemetry'
import type { JoinResponse } from '../api/contracts'
import { APP_BUILD } from '../build'
import { LiveKitScreenShare } from './LiveKitScreenShare'
import {
  type ConnectionQualityLevel,
  type DisconnectCause,
  type LocalShare,
  type ParticipantView,
  type RoomClient,
  RoomConnectError,
  type RoomEvents,
  type ShareOptions,
  ShareError,
  type ShareView,
  type ShareViewer,
  resolveSfuUrl,
  sortParticipants,
} from './RoomClient'

type Handlers = { [E in keyof RoomEvents]: Set<RoomEvents[E]> }

export class LiveKitRoomClient implements RoomClient {
  private room: Room | null = null
  private screenShare: LiveKitScreenShare | null = null
  private readonly handlers: Handlers = {
    phaseChanged: new Set(),
    participantsChanged: new Set(),
    sharesChanged: new Set(),
    localShareChanged: new Set(),
    audioPlaybackChanged: new Set(),
  }
  private leaving = false
  private watchingShares = new Set<string>()
  private previewVersion = 0
  private diagnosticSamples = new Map<string, { bytes: number; timestamp: number }>()
  private appPingMs: number | undefined
  private reportedAt = 0
  private viewTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private viewQualities = new Map<string, VideoQuality>()
  private viewingSizes = new Map<string, { width: number; height: number }>()
  private pendingQualities = new Map<string, VideoQuality>()
  private sampleTask: Promise<StreamDiagnostic[]> | null = null
  /** Players de áudio das transmissões dos outros, para pausar enquanto o app transmite o som do PC (eco). */
  private attachedAudio = new Map<HTMLAudioElement, AudioTrack>()
  private remoteAudioSuppressed = false
  /** Última lista de transmissões assistidas enviada à sala (atributo screen.watching). */
  private publishedWatching = ''
  private watchingTimer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly publishing?: { authorize: () => Promise<void>; release: () => Promise<void> }) {}

  setSignalingPing(ms: number): void { this.appPingMs = ms }

  /** Debounce impede resize/foco de alternar camadas em cada frame. O SFU ainda adapta à banda. */
  setViewingSize(id: string, width: number, height: number): void {
    if (!this.publishing) return // preserva adaptiveStream da experiência legada
    this.viewingSizes.set(id, { width, height })
    const sourceHeight = readReport(this.room?.remoteParticipants.get(id)?.attributes['screen.report'])?.captureHeight ?? 1080
    const target = height < 160 ? VideoQuality.LOW : width > 900 || height > 480 || sourceHeight <= 720 ? VideoQuality.HIGH : VideoQuality.MEDIUM
    if (this.viewQualities.get(id) === target) {
      clearTimeout(this.viewTimers.get(id))
      this.viewTimers.delete(id)
      this.pendingQualities.delete(id)
      return
    }
    if (this.pendingQualities.get(id) === target) return
    clearTimeout(this.viewTimers.get(id))
    this.pendingQualities.set(id, target)
    this.viewTimers.set(id, setTimeout(() => {
      this.viewQualities.set(id, target)
      this.remotePublication(id, Track.Source.ScreenShare)?.setVideoQuality(target)
      this.viewTimers.delete(id)
      this.pendingQualities.delete(id)
    }, target === VideoQuality.HIGH ? 500 : 2500))
  }

  async updateQuality(options: ShareOptions): Promise<LocalShare> {
    if (!this.screenShare) throw new ShareError('not_connected', 'Você não está conectado.')
    return this.screenShare.updateQuality(options)
  }
  async switchSource(options: ShareOptions): Promise<LocalShare> {
    if (!this.screenShare) throw new ShareError('not_connected', 'Você não está conectado.')
    return this.screenShare.switchSource(options)
  }

  setWatchingShare(identity: string | null): void {
    this.setWatchingShares(identity ? [identity] : [])
  }

  setWatchingShares(identities: string[]): void {
    this.watchingShares = new Set(identities)
    this.updateSubscriptions()
  }

  private updateSubscriptions(): void {
    for (const p of this.room?.remoteParticipants.values() ?? []) {
      for (const publication of p.trackPublications.values()) {
        if (publication.source !== Track.Source.ScreenShare && publication.source !== Track.Source.ScreenShareAudio) continue
        const wanted = this.watchingShares.has(p.identity)
        if (publication.isDesired !== wanted) publication.setSubscribed(wanted)
        const size = this.viewingSizes.get(p.identity)
        if (wanted && publication.source === Track.Source.ScreenShare && size) this.setViewingSize(p.identity, size.width, size.height)
      }
    }
    this.publishWatching()
  }

  /** Conta para a sala quais transmissões esta pessoa está recebendo (para mostrar "quem está assistindo"). */
  private publishWatching(): void {
    const room = this.room
    if (!this.publishing || !room) return
    const watched = [...room.remoteParticipants.values()]
      .filter((p) => this.watchingShares.has(p.identity) && p.getTrackPublication(Track.Source.ScreenShare))
      .map((p) => p.identity)
      .sort()
    const value = JSON.stringify(watched)
    clearTimeout(this.watchingTimer)
    if (value === this.publishedWatching) return
    // agrupa mudanças rápidas (ex.: "Ver todas") numa só atualização
    this.watchingTimer = setTimeout(() => {
      if (room !== this.room || room.state !== 'connected') return
      this.publishedWatching = value
      void room.localParticipant.setAttributes({ 'screen.watching': value }).catch(() => { this.publishedWatching = '' })
    }, 400)
  }

  private viewersOf(room: Room, shareId: string): ShareViewer[] | undefined {
    if (!this.publishing) return undefined
    const viewers: ShareViewer[] = []
    for (const p of room.remoteParticipants.values()) {
      if (p.identity !== shareId && readWatching(p.attributes['screen.watching']).includes(shareId)) viewers.push({ identity: p.identity, name: p.name || p.identity, isLocal: false })
    }
    if (shareId !== room.localParticipant.identity && this.watchingShares.has(shareId)) viewers.push({ identity: room.localParticipant.identity, name: 'Você', isLocal: true })
    return viewers.sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
  }

  on<E extends keyof RoomEvents>(event: E, handler: RoomEvents[E]): () => void {
    const set = this.handlers[event] as Set<RoomEvents[E]>
    set.add(handler)
    return () => set.delete(handler)
  }

  async connect(join: JoinResponse): Promise<void> {
    await this.disconnect()
    this.leaving = false
    this.publishedWatching = ''

    const room = new Room({
      // cada espectador recebe a camada de simulcast do tamanho em que o vídeo aparece na tela
      adaptiveStream: this.publishing ? false : true,
      // camadas que ninguém assiste deixam de ser codificadas por quem transmite
      dynacast: true,
      disconnectOnPageLeave: true,
    })
    this.room = room
    this.screenShare = new LiveKitScreenShare(room, join.policy, (share) => {
      // som do PC (sem o Discord) inclui o que este app toca: o som das outras transmissões voltaria para a sala
      this.setRemoteAudioSuppressed(share?.desktopAudio === 'exclude-discord' && share.audioEnabled)
      this.previewVersion++
      this.emit('localShareChanged', share)
      this.refresh()
    }, this.publishing ? async () => {
      await this.publishing!.authorize()
      const until = Date.now() + 4000
      while (!room.localParticipant.permissions?.canPublish) {
        if (Date.now() > until) throw new Error('A permissão de transmissão não chegou. Tente novamente.')
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    } : undefined, this.publishing?.release)
    this.wire(room)

    this.emit('phaseChanged', 'connecting')
    try {
      await room.connect(resolveSfuUrl(join.sfu.url), join.sfu.token, {
        autoSubscribe: false,
        // diagnóstico: força toda a mídia pelo TURN (simula rede corporativa que bloqueia UDP direto)
        ...(forceRelay() ? { rtcConfig: { iceTransportPolicy: 'relay' } } : {}),
      })
    } catch (error) {
      this.room = null
      this.screenShare = null
      throw toConnectError(error)
    }
    this.emit('phaseChanged', 'connected')
    this.refresh()
    this.emit('audioPlaybackChanged', !room.canPlaybackAudio)
  }

  async disconnect(): Promise<void> {
    for (const timer of this.viewTimers.values()) clearTimeout(timer)
    this.viewTimers.clear(); this.viewQualities.clear(); this.viewingSizes.clear(); this.pendingQualities.clear(); this.diagnosticSamples.clear(); this.reportedAt = 0
    const room = this.room
    if (!room) return
    this.leaving = true
    await this.screenShare?.stop()
    this.room = null
    this.screenShare = null
    await room.disconnect()
  }

  async startScreenShare(options: ShareOptions): Promise<LocalShare> {
    if (!this.screenShare || !this.room) throw new ShareError('not_connected', 'Você não está conectado à sala.')
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      throw new ShareError('unsupported', 'Este navegador não permite compartilhar a tela.')
    }
    return this.screenShare.start(options)
  }

  async stopScreenShare(): Promise<void> {
    await this.screenShare?.stop()
  }

  async setShareAudioEnabled(enabled: boolean): Promise<void> {
    await this.screenShare?.setAudioEnabled(enabled)
  }

  attachShareVideo(shareId: string, element: HTMLVideoElement): () => void {
    const room = this.room
    if (!room) return () => undefined

    if (shareId === room.localParticipant.identity) {
      // prévia local direto da captura: sem ida e volta pelo SFU
      const track = this.screenShare?.previewTrack()
      if (!track) return () => undefined
      element.srcObject = new MediaStream([track])
      void element.play().catch(() => undefined)
      return () => {
        element.srcObject = null
      }
    }

    const track = this.remotePublication(shareId, Track.Source.ScreenShare)?.videoTrack
    if (!track) return () => undefined
    // attach() permite ao adaptive stream observar o tamanho do elemento e pedir a camada certa
    track.attach(element)
    return () => {
      track.detach(element)
    }
  }

  attachShareAudio(shareId: string, element: HTMLAudioElement): () => void {
    const track = this.remotePublication(shareId, Track.Source.ScreenShareAudio)?.audioTrack
    if (!track) return () => undefined
    this.attachedAudio.set(element, track)
    if (!this.remoteAudioSuppressed) track.attach(element)
    return () => {
      this.attachedAudio.delete(element)
      track.detach(element)
    }
  }

  /** Enquanto suprimido, o som das transmissões dos outros não toca neste computador. */
  get isRemoteAudioSuppressed(): boolean {
    return this.remoteAudioSuppressed
  }

  private setRemoteAudioSuppressed(suppressed: boolean): void {
    if (suppressed === this.remoteAudioSuppressed) return
    this.remoteAudioSuppressed = suppressed
    for (const [element, track] of this.attachedAudio) {
      if (suppressed) track.detach(element)
      else track.attach(element)
    }
  }

  async startAudio(): Promise<void> {
    await this.room?.startAudio()
  }

  private remotePublication(identity: string, source: Track.Source): RemoteTrackPublication | undefined {
    return this.room?.remoteParticipants.get(identity)?.getTrackPublication(source)
  }

  private wire(room: Room): void {
    const refresh = () => this.refresh()
    room
      .on(RoomEvent.SignalConnected, () => this.emit('phaseChanged', 'verifying'))
      .on(RoomEvent.Reconnecting, () => this.emit('phaseChanged', 'reconnecting'))
      .on(RoomEvent.SignalReconnecting, () => this.emit('phaseChanged', 'reconnecting'))
      .on(RoomEvent.Reconnected, () => {
        this.publishedWatching = '' // reenvia a lista após reconectar
        this.emit('phaseChanged', 'connected')
        refresh()
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        if (this.room === room) {
          this.room = null
          void this.screenShare?.stop()
          this.screenShare = null
        }
        this.emit('sharesChanged', [])
        this.emit('phaseChanged', 'disconnected', this.leaving ? 'left' : toCause(reason))
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.emit('audioPlaybackChanged', !room.canPlaybackAudio))
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ParticipantNameChanged, refresh)
      .on(RoomEvent.ParticipantMetadataChanged, refresh)
      .on(RoomEvent.ParticipantAttributesChanged, refresh)
      .on(RoomEvent.ConnectionQualityChanged, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
  }

  private refresh(): void {
    const room = this.room
    if (!room) return
    const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()]
    this.emit('participantsChanged', sortParticipants(all.map((p) => toView(p, p === room.localParticipant))))
    this.emit('sharesChanged', this.shares(room))
    this.updateSubscriptions()
  }

  private shares(room: Room): ShareView[] {
    const shares: ShareView[] = []
    const local = this.screenShare?.state
    if (local) {
      shares.push({
        id: room.localParticipant.identity,
        ownerIdentity: room.localParticipant.identity,
        ownerName: room.localParticipant.name || 'Você',
        isLocal: true,
        videoReady: true,
        hasAudio: local.hasAudio,
        audioReady: false,
        audioMuted: !local.audioEnabled,
        trackVersion: this.previewVersion,
        report: { quality: local.quality, captureWidth: local.width, captureHeight: local.height },
        viewers: this.viewersOf(room, room.localParticipant.identity),
      })
    }
    for (const p of room.remoteParticipants.values()) {
      const video = p.getTrackPublication(Track.Source.ScreenShare)
      if (!video) continue
      const audio = p.getTrackPublication(Track.Source.ScreenShareAudio)
      shares.push({
        id: p.identity,
        ownerIdentity: p.identity,
        ownerName: p.name || p.identity,
        isLocal: false,
        videoReady: video.isSubscribed && video.videoTrack !== undefined,
        hasAudio: audio !== undefined,
        audioReady: audio?.isSubscribed === true && audio.audioTrack !== undefined,
        audioMuted: audio?.isMuted ?? true,
        trackVersion: video.videoTrack?.mediaStreamTrack.id,
        audioTrackVersion: audio?.audioTrack?.mediaStreamTrack.id,
        report: readReport(p.attributes['screen.report']),
        viewers: this.viewersOf(room, p.identity),
      })
    }
    return shares
  }

  private emit<E extends keyof RoomEvents>(event: E, ...args: Parameters<RoomEvents[E]>): void {
    for (const handler of this.handlers[event]) {
      ;(handler as (...a: Parameters<RoomEvents[E]>) => void)(...args)
    }
  }

  /** Estatísticas RTP reais. RTT não representa a latência ponta a ponta da imagem. */
  async diagnostics(): Promise<StreamDiagnostic[]> {
    if (this.sampleTask) return this.sampleTask
    this.sampleTask = this.collectDiagnostics()
    try { return await this.sampleTask } finally { this.sampleTask = null }
  }

  private async collectDiagnostics(): Promise<StreamDiagnostic[]> {
    if (!this.room) return []
    const room = this.room
    const capture = this.screenShare?.refreshCapture()
    const output: StreamDiagnostic[] = []
    for (const p of [this.room.localParticipant, ...this.room.remoteParticipants.values()]) {
      const publication = p.getTrackPublication(Track.Source.ScreenShare)
      const track = publication?.videoTrack
      if (!track) continue
      const local = p === this.room.localParticipant
      const report = 'sender' in track ? await track.sender?.getStats() : await track.getRTCStatsReport()
      if (!report) continue
      const rtt = networkRtt(report)
      report.forEach((s: Record<string, unknown>) => {
        if (s.type !== (local ? 'outbound-rtp' : 'inbound-rtp') || (s.kind !== 'video' && s.mediaType !== 'video')) return
        const id = `${p.identity}:${String(s.id)}`
        const bytes = Number(local ? s.bytesSent : s.bytesReceived)
        const timestamp = Number(s.timestamp)
        const previous = this.diagnosticSamples.get(id)
        this.diagnosticSamples.set(id, { bytes, timestamp })
        const packets = Number(s.packetsReceived ?? 0), lost = Math.max(0, Number(s.packetsLost ?? 0))
        const remote = s.remoteId ? report.get(String(s.remoteId)) : undefined
        const remoteLost = Number(remote?.packetsLost ?? 0)
        output.push({ identity: p.identity, name: p.name || p.identity, local, rttMs: rtt, jitterMs: typeof s.jitter === 'number' ? s.jitter * 1000 : undefined, lossPercent: local ? senderLossPercent(remote, Number(s.packetsSent ?? 0), remoteLost) : packets + lost > 0 ? lost / (packets + lost) * 100 : undefined, mbps: previous && timestamp > previous.timestamp ? Math.max(0, (bytes - previous.bytes) * 8 / (timestamp - previous.timestamp) / 1000) : undefined, fps: typeof s.framesPerSecond === 'number' ? s.framesPerSecond : undefined, width: typeof s.frameWidth === 'number' ? s.frameWidth : undefined, height: typeof s.frameHeight === 'number' ? s.frameHeight : undefined, limitation: typeof s.qualityLimitationReason === 'string' ? s.qualityLimitationReason : undefined })
      })
    }
    // Simulcast gera vários outbound-rtp: mostrar a maior camada e somar sua banda.
    const aggregated: StreamDiagnostic[] = []
    for (const identity of new Set(output.map((s) => s.identity))) {
      const samples = output.filter((s) => s.identity === identity).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
      aggregated.push({ ...samples[0]!, mbps: samples.some((s) => s.mbps !== undefined) ? samples.reduce((sum, s) => sum + (s.mbps ?? 0), 0) : undefined })
    }
    if (this.publishing && room === this.room && room.state === 'connected' && Date.now() - this.reportedAt >= 5000) {
      this.reportedAt = Date.now()
      const sending = aggregated.find((s) => s.local)
      void room.localParticipant.setAttributes({ 'screen.report': JSON.stringify({ quality: capture?.quality, captureWidth: capture?.width, captureHeight: capture?.height, sendWidth: sending?.width, sendHeight: sending?.height, fps: sending?.fps, sourceWidth: capture?.sourceWidth, sourceHeight: capture?.sourceHeight, locked: capture?.captureLocked, app: APP_BUILD, rttMs: sending?.rttMs, appPingMs: this.appPingMs, lossPercent: sending?.lossPercent, mbps: sending?.mbps, limitation: sending?.limitation }) }).catch(() => undefined)
    }
    return aggregated
  }
}

export interface StreamDiagnostic { identity: string; name: string; local: boolean; rttMs?: number; jitterMs?: number; lossPercent?: number; mbps?: number; fps?: number; width?: number; height?: number; limitation?: string }

/**
 * RTT de rede até o SFU, em ms: o do par ICE em uso (pacotes STUN, medidos pelo próprio navegador).
 * O RTT do RTCP (remote-inbound-rtp) só é usado se não houver par ICE: ele depende dos relatórios de tempo do
 * servidor e, quando o servidor pausa ou atrasa esses relatórios, chega a mostrar centenas de ms a mais que a rede.
 */
export function networkRtt(report: RTCStatsReport): number | undefined {
  let selectedPairId: string | undefined
  let selectedRtt: number | undefined
  let nominatedRtt: number | undefined
  let rtcpRtt: number | undefined
  report.forEach((s: Record<string, unknown>) => {
    if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string') selectedPairId = s.selectedCandidatePairId
  })
  report.forEach((s: Record<string, unknown>) => {
    if (s.type === 'candidate-pair' && typeof s.currentRoundTripTime === 'number') {
      if (s.id === selectedPairId) selectedRtt = s.currentRoundTripTime * 1000
      else if (s.state === 'succeeded' && s.nominated === true) nominatedRtt = s.currentRoundTripTime * 1000
    }
    if (s.type === 'remote-inbound-rtp' && typeof s.roundTripTime === 'number') rtcpRtt = s.roundTripTime * 1000
  })
  return selectedRtt ?? nominatedRtt ?? rtcpRtt
}

function toView(p: Participant, isLocal: boolean): ParticipantView {
  const quality = toQuality(p.connectionQuality)
  return {
    identity: p.identity,
    name: p.name || p.identity,
    role: roleOf(p.metadata),
    isLocal,
    connection: quality === 'lost' ? 'reconnecting' : 'connected',
    isSharing: p.getTrackPublication(Track.Source.ScreenShare) !== undefined,
    quality,
    report: readReport(p.attributes['screen.report']),
  }
}

function roleOf(metadata: string | undefined): ParticipantView['role'] {
  try {
    return (JSON.parse(metadata ?? '{}') as { role?: string }).role === 'owner' ? 'owner' : 'member'
  } catch {
    return 'member'
  }
}

function toQuality(q: ConnectionQuality): ConnectionQualityLevel {
  switch (q) {
    case ConnectionQuality.Excellent:
      return 'excellent'
    case ConnectionQuality.Good:
      return 'good'
    case ConnectionQuality.Poor:
      return 'poor'
    case ConnectionQuality.Lost:
      return 'lost'
    default:
      return 'unknown'
  }
}

function toCause(reason: DisconnectReason | undefined): DisconnectCause {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return 'left'
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'replaced'
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'removed'
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return 'room_closed'
    default:
      return 'lost'
  }
}

function toConnectError(error: unknown): RoomConnectError {
  const message = error instanceof Error ? error.message : String(error)
  if (/full|max.*participants/i.test(message)) return new RoomConnectError('room_full', message)
  if (/401|403|unauthori[sz]ed|permission|not allowed/i.test(message)) return new RoomConnectError('unauthorized', message)
  if (/could not establish|unreachable|failed to fetch|websocket|timeout|timed out/i.test(message)) {
    return new RoomConnectError('unreachable', message)
  }
  return new RoomConnectError('unknown', message)
}

/** Chave de diagnóstico: localStorage['ss:forceRelay'] = '1' faz a mídia passar só pelo TURN. */
export const FORCE_RELAY_KEY = 'ss:forceRelay'

function forceRelay(): boolean {
  try {
    return localStorage.getItem(FORCE_RELAY_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Perda no envio, em %. O relatório do servidor (remote-inbound-rtp) não tem "pacotes recebidos":
 * usar perdidos / (recebidos + perdidos) dava 100% com um único pacote perdido. Usa a fração recente
 * informada pelo servidor; sem ela, o acumulado de perdidos sobre os pacotes enviados.
 */
export function senderLossPercent(remote: Record<string, unknown> | undefined, packetsSent: number, packetsLost: number): number | undefined {
  if (!remote) return undefined
  if (typeof remote.fractionLost === 'number' && Number.isFinite(remote.fractionLost)) return Math.max(0, Math.min(1, remote.fractionLost)) * 100
  return packetsSent > 0 ? Math.max(0, packetsLost) / packetsSent * 100 : undefined
}

/** Lista de transmissões assistidas publicada por um participante; ignora valores malformados. */
export function readWatching(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}
