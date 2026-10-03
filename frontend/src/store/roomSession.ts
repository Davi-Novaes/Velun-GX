import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiError, api as defaultApi, describeError } from '../api/client'
import type { JoinResponse } from '../api/contracts'
import {
  type ConnectionPhase,
  type DisconnectCause,
  type LocalShare,
  type ParticipantView,
  type RoomClient,
  RoomConnectError,
  type ShareOptions,
  ShareError,
  type ShareView,
} from '../media/RoomClient'

export type SessionPhase = 'prejoin' | 'joining' | ConnectionPhase | 'failed'

export type FailureKind = 'room_full' | 'room_not_found' | 'room_expired' | 'other'

export interface RoomSessionState {
  code: string
  phase: SessionPhase
  cause: DisconnectCause | null
  self: JoinResponse['participant'] | null
  policy: JoinResponse['policy'] | null
  participants: ParticipantView[]
  error: { kind: FailureKind; message: string } | null
  shares: ShareView[]
  localShare: LocalShare | null
  /** Compartilhamento em destaque no palco (escolhido pelo usuário ou o mais recente). */
  focusedShareId: string | null
  watchingPaused: boolean
  watchedShareIds: string[]
  toggleWatchShare: (id: string) => void
  watchAllShares: () => void
  stopWatching: () => void
  /** Áudio remoto bloqueado pela política de autoplay até um clique. */
  audioBlocked: boolean
  /** Como VOCÊ ouve cada transmissão (volume e mudo locais; não afeta os outros). */
  listening: Record<string, ListeningPrefs>
  /** Aviso passageiro (ex.: "áudio indisponível"), exibido como toast. */
  notice: { id: number; tone: 'info' | 'error'; message: string } | null

  join: (displayName: string) => Promise<void>
  leave: () => Promise<void>
  startShare: (options: ShareOptions) => Promise<void>
  stopShare: () => Promise<void>
  setShareAudio: (enabled: boolean) => Promise<void>
  focusShare: (id: string) => void
  setShareVolume: (id: string, volume: number) => void
  toggleShareMute: (id: string) => void
  startAudio: () => Promise<void>
  dismissNotice: () => void
  /** Assina os eventos do cliente de mídia; a função retornada desassina e desconecta. */
  start: () => () => void
}

type Api = Pick<typeof defaultApi, 'joinRoom' | 'leaveRoom'>

const participantKey = (code: string) => `ss:participant:${code}`

/** Estado de uma sala (uma instância por página de sala). Toda a mídia passa pelo RoomClient. */
export function createRoomSession(code: string, client: RoomClient, apiClient: Api = defaultApi): StoreApi<RoomSessionState> {
  return createStore<RoomSessionState>((set, get) => {
    return {
      code,
      phase: 'prejoin',
      cause: null,
      self: null,
      policy: null,
      participants: [],
      error: null,
      shares: [],
      localShare: null,
      focusedShareId: null,
      watchingPaused: false,
      watchedShareIds: [],
      audioBlocked: false,
      listening: {},
      notice: null,

      async join(displayName) {
        set({ phase: 'joining', error: null, cause: null })
        let joined: JoinResponse
        try {
          joined = await apiClient.joinRoom(code, displayName.trim(), readParticipantId(code))
        } catch (error) {
          set({ phase: 'failed', error: { kind: failureKind(error), message: describeError(error) } })
          return
        }
        // guardado para reconectar com a mesma identidade (mesma vaga) — Fase 6
        writeParticipantId(code, joined.participant.id)
        set({ self: joined.participant, policy: joined.policy })

        try {
          await client.connect(joined)
        } catch (error) {
          apiClient.leaveRoom(code, joined.participant.id)
          const full = error instanceof RoomConnectError && error.kind === 'room_full'
          set({
            phase: 'failed',
            error: full
              ? { kind: 'room_full', message: 'A sala atingiu o limite de participantes.' }
              : { kind: 'other', message: 'Não foi possível conectar ao servidor de mídia. Verifique sua rede e tente novamente.' },
          })
        }
      },

      async leave() {
        const self = get().self
        await client.disconnect()
        if (self) apiClient.leaveRoom(code, self.id)
        client.setWatchingShares([])
        set({ phase: 'disconnected', cause: 'left', participants: [], shares: [], localShare: null, focusedShareId: null, watchedShareIds: [], watchingPaused: false })
      },

      async startShare(options) {
        try {
          const share = await client.startScreenShare(options)
          if (share.audioRequested && !share.hasAudio) {
            notify(set, 'info', missingAudioMessage(share))
          }
        } catch (error) {
          if (error instanceof ShareError && error.kind === 'cancelled') return
          notify(set, 'error', error instanceof ShareError ? error.message : 'Não foi possível iniciar o compartilhamento.')
        }
      },

      async stopShare() {
        await client.stopScreenShare()
      },

      async setShareAudio(enabled) {
        await client.setShareAudioEnabled(enabled)
      },

      focusShare(id) {
        set({ focusedShareId: id, watchedShareIds: [id], watchingPaused: false })
        client.setWatchingShares([id])
      },

      toggleWatchShare(id) {
        const ids = get().watchedShareIds
        const next = ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id]
        set({ watchedShareIds: next, focusedShareId: next[0] ?? null, watchingPaused: next.length === 0 })
        client.setWatchingShares(next)
      },

      watchAllShares() {
        const ids = get().shares.map((s) => s.id)
        set({ watchedShareIds: ids, focusedShareId: ids[0] ?? null, watchingPaused: ids.length === 0 })
        client.setWatchingShares(ids)
      },

      stopWatching() {
        set({ focusedShareId: null, watchedShareIds: [], watchingPaused: true })
        client.setWatchingShares([])
      },

      setShareVolume(id, volume) {
        const clamped = Math.min(1, Math.max(0, volume))
        // mexer no volume tira do mudo (como em qualquer player); arrastar até 0 é o mesmo que silenciar
        set({ listening: { ...get().listening, [id]: { volume: clamped, muted: clamped === 0 } } })
      },

      toggleShareMute(id) {
        const current = listeningFor(get().listening, id)
        const unmuting = current.muted
        set({
          listening: {
            ...get().listening,
            // ao reativar um áudio que estava no 0, volta num volume audível
            [id]: { muted: !current.muted, volume: unmuting && current.volume === 0 ? 0.5 : current.volume },
          },
        })
      },

      async startAudio() {
        await client.startAudio()
      },

      dismissNotice() {
        set({ notice: null })
      },

      start() {
        const offPhase = client.on('phaseChanged', (phase, cause) => {
          // durante o join inicial, "desconectado" é tratado como falha no catch do join
          if (get().phase === 'prejoin' || get().phase === 'failed') return
          set({ phase, cause: cause ?? null })
        })
        const offParticipants = client.on('participantsChanged', (participants) => set({ participants }))
        const offShares = client.on('sharesChanged', (shares) => {
          const kept = get().watchedShareIds.filter((id) => shares.some((s) => s.id === id))
          const fallback = pickFocus(null, get().shares, shares)
          const next = get().watchingPaused ? [] : kept.length ? kept : fallback ? [fallback] : []
          set({ shares, watchedShareIds: next, focusedShareId: next[0] ?? null })
          client.setWatchingShares(next)
        })
        const offLocalShare = client.on('localShareChanged', (localShare) => set({ localShare }))
        const offAudio = client.on('audioPlaybackChanged', (audioBlocked) => set({ audioBlocked }))
        return () => {
          offPhase()
          offParticipants()
          offShares()
          offLocalShare()
          offAudio()
          void client.disconnect()
        }
      },
    }
  })
}

function failureKind(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) return 'other'
  switch (error.code) {
    case 'ROOM_FULL':
      return 'room_full'
    case 'ROOM_NOT_FOUND':
      return 'room_not_found'
    case 'ROOM_EXPIRED':
      return 'room_expired'
    default:
      return 'other'
  }
}

function readParticipantId(code: string): string | undefined {
  try {
    return sessionStorage.getItem(participantKey(code)) ?? undefined
  } catch {
    return undefined
  }
}

function writeParticipantId(code: string, id: string): void {
  try {
    sessionStorage.setItem(participantKey(code), id)
  } catch {
    // armazenamento indisponível (modo privado): só perde a reconexão na mesma vaga
  }
}

export const RoomSessionContext = createContext<StoreApi<RoomSessionState> | null>(null)

export function useRoomSession<T>(selector: (state: RoomSessionState) => T): T {
  const store = useContext(RoomSessionContext)
  if (!store) throw new Error('useRoomSession fora de RoomSessionContext')
  return useStore(store, selector)
}

let noticeSeq = 0

function notify(set: (partial: Partial<RoomSessionState>) => void, tone: 'info' | 'error', message: string): void {
  set({ notice: { id: ++noticeSeq, tone, message } })
}

/**
 * Mantém o foco escolhido enquanto ele existir. Quando surge um compartilhamento novo de outra pessoa, ele ganha
 * o palco (como no Discord); o próprio compartilhamento só fica em destaque se for o único.
 */
export function pickFocus(current: string | null, before: ShareView[], after: ShareView[]): string | null {
  const known = new Set(before.map((s) => s.id))
  const newRemote = after.find((s) => !s.isLocal && !known.has(s.id))
  if (newRemote) return newRemote.id
  if (current && after.some((s) => s.id === current)) return current
  return after.find((s) => !s.isLocal)?.id ?? after[0]?.id ?? null
}

export interface ListeningPrefs {
  volume: number
  muted: boolean
}

export const DEFAULT_LISTENING: ListeningPrefs = { volume: 1, muted: false }

export function listeningFor(listening: Record<string, ListeningPrefs>, id: string): ListeningPrefs {
  return listening[id] ?? DEFAULT_LISTENING
}

function missingAudioMessage(share: LocalShare): string {
  if (share.audioError) return `A tela segue sem som: ${share.audioError}`
  if (share.surface === 'monitor' && share.audioScope === 'shared') {
    // escolha deliberada: na tela inteira só existe o som do computador todo, que levaria junto a call do Discord
    return 'Na tela inteira só dá para transmitir o som do computador todo (inclusive a call do Discord), então a tela segue sem áudio. Para ter áudio, compartilhe a aba ou a janela.'
  }
  return 'O áudio não está disponível para este tipo de compartilhamento neste navegador. A transmissão segue só com vídeo.'
}
