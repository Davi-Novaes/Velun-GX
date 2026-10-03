import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { ApiError, type api } from '../api/client'
import type { JoinResponse, RoomInfo } from '../api/contracts'
import { routes } from '../app/App'
import { ServicesProvider } from '../app/services'
import type {
  ConnectionPhase,
  DisconnectCause,
  LocalShare,
  ParticipantView,
  RoomClient,
  RoomEvents,
  ShareOptions,
  ShareView,
} from '../media/RoomClient'

/** RoomClient controlado pelo teste: simula as transições do SFU. */
export class FakeRoomClient implements RoomClient {
  watchingShare: string | null = null
  setWatchingShare(identity: string | null): void { this.watchingShare = identity }
  watchingShares: string[] = []
  setWatchingShares(identities: string[]): void {
    this.watchingShares = identities
    this.watchingShare = identities[0] ?? null
  }
  private readonly handlers: { [E in keyof RoomEvents]: Set<RoomEvents[E]> } = {
    phaseChanged: new Set(),
    participantsChanged: new Set(),
    sharesChanged: new Set(),
    localShareChanged: new Set(),
    audioPlaybackChanged: new Set(),
  }
  shareCalls: ShareOptions[] = []
  /** Próximo resultado de startScreenShare (ou erro). */
  nextShare: LocalShare | Error = localShare()
  stopShareCalls = 0
  audioEnabledCalls: boolean[] = []
  attachedVideos: string[] = []
  startAudioCalls = 0
  connectCalls: JoinResponse[] = []
  disconnectCalls = 0
  /** Resolve/rejeita o connect() pendente. */
  finishConnect: (() => void) | null = null
  failConnect: ((error: Error) => void) | null = null

  on<E extends keyof RoomEvents>(event: E, handler: RoomEvents[E]): () => void {
    const set = this.handlers[event] as Set<RoomEvents[E]>
    set.add(handler)
    return () => set.delete(handler)
  }

  connect(join: JoinResponse): Promise<void> {
    this.connectCalls.push(join)
    this.phase('connecting')
    return new Promise((resolve, reject) => {
      this.finishConnect = () => {
        this.phase('connected')
        resolve()
      }
      this.failConnect = reject
    })
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++
  }

  async startScreenShare(options: ShareOptions): Promise<LocalShare> {
    this.shareCalls.push(options)
    const next = this.nextShare
    if (next instanceof Error) throw next
    this.emit('localShareChanged', next)
    return next
  }

  async stopScreenShare(): Promise<void> {
    this.stopShareCalls++
    this.emit('localShareChanged', null)
  }

  async setShareAudioEnabled(enabled: boolean): Promise<void> {
    this.audioEnabledCalls.push(enabled)
  }

  attachShareVideo(shareId: string): () => void {
    this.attachedVideos.push(shareId)
    return () => undefined
  }

  attachShareAudio(): () => void {
    return () => undefined
  }

  async startAudio(): Promise<void> {
    this.startAudioCalls++
  }

  emit<E extends keyof RoomEvents>(event: E, ...args: Parameters<RoomEvents[E]>) {
    for (const h of this.handlers[event]) (h as (...a: Parameters<RoomEvents[E]>) => void)(...args)
  }

  phase(phase: ConnectionPhase, cause?: DisconnectCause) {
    for (const h of this.handlers.phaseChanged) h(phase, cause)
  }

  participants(list: ParticipantView[]) {
    for (const h of this.handlers.participantsChanged) h(list)
  }
}

export function participant(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    identity: 'p_' + Math.random().toString(16).slice(2),
    name: 'Alguém',
    role: 'member',
    isLocal: false,
    connection: 'connected',
    isSharing: false,
    quality: 'excellent',
    ...overrides,
  }
}

export function joinResponse(overrides: Partial<JoinResponse['participant']> = {}): JoinResponse {
  return {
    participant: { id: 'part-1', identity: 'p_part1', displayName: 'Maria', role: 'owner', ...overrides },
    sfu: { url: '', token: 'token', expiresAt: new Date(Date.now() + 600_000).toISOString() },
    policy: {
      maxParticipants: 20,
      allowedSources: ['screen_share', 'screen_share_audio'],
      maxConcurrentScreenShares: 3,
      video: { maxWidth: 3840, maxHeight: 2160, maxFps: 60, maxBitrateKbps: 16000, preferredCodec: 'vp8', allowHardwareH264: true },
      audio: { enabled: true, maxBitrateKbps: 96 },
    },
  }
}

export function roomInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return { code: 'K7F3QX9M', status: 'active', participantCount: 3, maxParticipants: 20, isFull: false, ...overrides }
}

export function fakeApi(overrides: Partial<typeof api> = {}): typeof api {
  return {
    createRoom: vi.fn(),
    getRoom: vi.fn(async () => roomInfo()),
    joinRoom: vi.fn(async () => joinResponse()),
    leaveRoom: vi.fn(),
    ...overrides,
  } as typeof api
}

export function apiError(code: ApiError['code'], status: number, message = 'erro') {
  return new ApiError(code, status, message)
}

export function renderAt(path: string, services: { api: typeof api; client?: FakeRoomClient }) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const client = services.client ?? new FakeRoomClient()
  const view = render(
    <ServicesProvider services={{ api: services.api, createRoomClient: () => client }}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )
  return { ...view, router, client }
}

export function localShare(overrides: Partial<LocalShare> = {}): LocalShare {
  return {
    surface: 'monitor',
    width: 1920,
    height: 1080,
    fps: 30,
    quality: { resolution: 'auto', fps: 30 },
    audioRequested: true,
    hasAudio: true,
    audioEnabled: true,
    audioScope: 'shared',
    ...overrides,
  }
}

export function share(overrides: Partial<ShareView> = {}): ShareView {
  return {
    id: 'p_joao',
    ownerIdentity: 'p_joao',
    ownerName: 'João',
    isLocal: false,
    videoReady: true,
    hasAudio: false,
    audioReady: false,
    audioMuted: true,
    ...overrides,
  }
}

/** Simula um navegador desktop Chromium (getDisplayMedia + áudio + preferência de superfície). */
export function stubDesktopChromium() {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia: vi.fn(),
      getSupportedConstraints: () => ({ displaySurface: true, suppressLocalAudioPlayback: true }),
    },
  })
  Object.defineProperty(window, 'CaptureController', { configurable: true, value: class {} })
}

export function stubNoScreenShare() {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
  Reflect.deleteProperty(window, 'CaptureController')
}
