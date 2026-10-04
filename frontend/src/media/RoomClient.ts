import type { JoinResponse } from '../api/contracts'
import type { FpsPreset, QualityChoice } from './presets'
import type { StreamReport } from './telemetry'

/**
 * Fronteira entre a interface e o SFU. A UI só conhece este contrato (Documento 4);
 * a implementação com LiveKit fica em LiveKitRoomClient.
 */
export interface RoomClient {
  /** Recebe somente vídeo e áudio desta transmissão; null cancela todas as assinaturas de tela. */
  setWatchingShare: (identity: string | null) => void
  setWatchingShares: (identities: string[]) => void
  connect(join: JoinResponse): Promise<void>
  disconnect(): Promise<void>

  /** Abre o seletor nativo e publica vídeo (+ áudio, se veio). Deve ser chamado direto do clique do usuário. */
  startScreenShare(options: ShareOptions): Promise<LocalShare>
  stopScreenShare(): Promise<void>
  /** Silencia/reativa só o áudio do compartilhamento; o vídeo continua. */
  setShareAudioEnabled(enabled: boolean): Promise<void>

  /** Liga um compartilhamento a um elemento de vídeo/áudio. Retorna a função que desliga. */
  attachShareVideo(shareId: string, element: HTMLVideoElement): () => void
  attachShareAudio(shareId: string, element: HTMLAudioElement): () => void
  /** Libera áudio bloqueado pela política de autoplay (precisa de um clique do usuário). */
  startAudio(): Promise<void>

  on<E extends keyof RoomEvents>(event: E, handler: RoomEvents[E]): () => void
}

export type ConnectionPhase =
  | 'connecting' // abrindo a sinalização com o SFU
  | 'verifying' // sinalização ok, estabelecendo o caminho de mídia (ICE/DTLS)
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

export type DisconnectCause =
  | 'left' // o próprio usuário saiu
  | 'replaced' // a mesma pessoa entrou de novo (outra aba) — esta sessão foi encerrada
  | 'removed' // removido da sala
  | 'room_closed'
  | 'lost' // conexão perdida

export type ConnectionQualityLevel = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'

export interface ParticipantView {
  report?: StreamReport
  identity: string
  name: string
  role: 'owner' | 'member'
  isLocal: boolean
  /** Quem está com conexão perdida aparece como "reconectando" até sair da sala. */
  connection: 'connected' | 'reconnecting'
  isSharing: boolean
  quality: ConnectionQualityLevel
}

export type DisplaySurface = 'monitor' | 'window' | 'browser'

export interface ShareOptions extends QualityChoice {
  /** Limites personalizados de saída; a proporção original é preservada. */
  outputWidth?: number
  outputHeight?: number
  /** Preferência de tipo; o usuário escolhe de fato no seletor nativo. */
  surface: DisplaySurface | 'any'
  audio: boolean
  /**
   * shared: só o som do que foi compartilhado (a aba, ou o app da janela). Não pega Discord, chamadas nem notificações.
   * system: todo o som do computador (o sistema operacional mistura tudo; não há como excluir um programa).
   */
  audioScope: AudioScope
  /** H.264 pela placa de vídeo (NVENC/AMF/QuickSync). Desligado: VP9/VP8 escolhido pelo processador. */
  hardwareEncoding?: boolean
}

export type AudioScope = 'shared' | 'system'

/** O que o navegador realmente entregou. */
export interface LocalShare {
  surface: DisplaySurface | 'unknown'
  width: number
  height: number
  fps: FpsPreset
  quality: QualityChoice
  audioRequested: boolean
  hasAudio: boolean
  audioEnabled: boolean
  audioScope: AudioScope
  /** Tamanho original da tela/janela antes de qualquer redução (diagnóstico). */
  sourceWidth?: number
  sourceHeight?: number
  /** A resolução de captura está travada (mín. = máx.)? Sem trava o Chrome pode reduzir a captura sozinho. */
  captureLocked?: boolean
  /** App Velun Gx: de onde vem o som (PC sem o Discord, ou só o programa da janela). */
  desktopAudio?: import('../desktop/velun').DesktopAudioMode
  /** Por que o som pedido não foi transmitido (app desktop). */
  audioError?: string
  /** Formato de vídeo em uso e o motivo da escolha. */
  codec?: import('./codecChoice').CodecDecision | null
}

/** Um compartilhamento na sala (de outra pessoa ou o próprio). Um por participante. */
export interface ShareView {
  report?: StreamReport
  audioTrackVersion?: string
  id: string
  ownerIdentity: string
  ownerName: string
  isLocal: boolean
  /** Vídeo já recebido e pronto para exibir (remotos podem demorar alguns ms após publicar). */
  videoReady: boolean
  hasAudio: boolean
  /** Áudio já recebido (a assinatura pode chegar depois da publicação). */
  audioReady: boolean
  audioMuted: boolean
  /** Só muda quando a captura local muda; não remonta vídeos a cada heartbeat. */
  trackVersion?: number | string
  /** Quem está recebendo esta transmissão agora (canais). Inclui "você" quando você assiste. */
  viewers?: ShareViewer[]
}

export interface ShareViewer {
  identity: string
  name: string
  isLocal: boolean
}

export interface RoomEvents {
  phaseChanged: (phase: ConnectionPhase, cause?: DisconnectCause) => void
  participantsChanged: (participants: ParticipantView[]) => void
  sharesChanged: (shares: ShareView[]) => void
  localShareChanged: (share: LocalShare | null) => void
  audioPlaybackChanged: (blocked: boolean) => void
}

export class RoomConnectError extends Error {
  readonly kind: 'room_full' | 'unauthorized' | 'unreachable' | 'unknown'

  constructor(kind: RoomConnectError['kind'], message: string) {
    super(message)
    this.name = 'RoomConnectError'
    this.kind = kind
  }
}

export class ShareError extends Error {
  /** cancelled: o usuário fechou o seletor — não é erro para mostrar. */
  readonly kind: 'cancelled' | 'denied' | 'unsupported' | 'limit_reached' | 'not_connected' | 'failed'

  constructor(kind: ShareError['kind'], message: string) {
    super(message)
    this.name = 'ShareError'
    this.kind = kind
  }
}

/** URL de sinalização: a informada pelo backend ou, se vazia, a mesma origem da página. */
export function resolveSfuUrl(url: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  if (url) return url
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
}

/** Participantes em ordem estável: você primeiro, depois quem transmite, depois por nome. */
export function sortParticipants(list: ParticipantView[]): ParticipantView[] {
  return [...list].sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1
    if (a.isSharing !== b.isSharing) return a.isSharing ? -1 : 1
    return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  })
}

/** Traduz a falha do getDisplayMedia para algo acionável. */
export function toShareError(error: unknown): ShareError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
      // Chrome/Edge/Firefox usam NotAllowedError tanto para "cancelou" quanto para "bloqueado pela política/SO"
      return new ShareError('cancelled', 'Compartilhamento cancelado.')
    case 'NotFoundError':
    case 'NotReadableError':
    case 'AbortError':
      return new ShareError('failed', 'Não foi possível capturar a tela. Verifique as permissões de gravação de tela do sistema.')
    case 'NotSupportedError':
    case 'TypeError':
      return new ShareError('unsupported', 'Este navegador não permite compartilhar a tela.')
    case 'SecurityError':
      return new ShareError('denied', 'O compartilhamento de tela foi bloqueado pelo navegador.')
    default:
      return new ShareError('failed', 'Não foi possível iniciar o compartilhamento.')
  }
}
