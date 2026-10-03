// Contratos da API REST (Documento 4). Mantidos em sincronia com o backend.

export interface CreatedRoom {
  code: string
  url: string
  maxParticipants: number
  createdAt: string
  expiresAt: string
}

export interface RoomInfo {
  code: string
  status: 'active'
  participantCount: number
  maxParticipants: number
  isFull: boolean
}

export interface VideoPolicy {
  maxWidth: number
  maxHeight: number
  maxFps: number
  maxBitrateKbps: number
  preferredCodec: 'vp8' | 'h264' | 'vp9' | 'av1'
  allowHardwareH264: boolean
}

export interface AudioPolicy {
  enabled: boolean
  maxBitrateKbps: number
}

export interface JoinResponse {
  participant: {
    id: string
    identity: string
    displayName: string
    role: 'owner' | 'member'
  }
  sfu: {
    /** Vazio = mesma origem da página (/rtc via proxy). */
    url: string
    token: string
    expiresAt: string
  }
  policy: {
    maxParticipants: number
    allowedSources: string[]
    maxConcurrentScreenShares: number
    video: VideoPolicy
    audio: AudioPolicy
  }
}

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_EXPIRED'
  | 'ROOM_FULL'
  | 'ROOM_BUSY'
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN'
  | 'SFU_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'UNAUTHENTICATED'
  | 'CROSS_ORIGIN_FORBIDDEN'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'
