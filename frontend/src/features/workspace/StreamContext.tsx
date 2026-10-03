import { createContext, useContext, useEffect, useRef } from 'react'
import type { LiveKitRoomClient, StreamDiagnostic } from '../../media/LiveKitRoomClient'
import type { ShareView } from '../../media/RoomClient'
export interface AudioPreference { muted: boolean; volume: number }
export const StreamContext = createContext({ samples: [] as StreamDiagnostic[], audio: {} as Record<string, AudioPreference>, changeAudio: (_id: string, _patch: Partial<AudioPreference>) => {} })
export const useStreamContext = () => useContext(StreamContext)
/** Um player de áudio por pessoa, independente de grade/foco/miniaturas. */
export function StreamAudio({ share, client }: { share: ShareView; client: LiveKitRoomClient }) {
  const ref = useRef<HTMLAudioElement>(null)
  const { audio } = useStreamContext()
  const preference = audio[share.id] ?? { muted: false, volume: 0.8 }
  useEffect(() => { if (ref.current && share.audioReady) return client.attachShareAudio(share.id, ref.current) }, [client, share.id, share.audioReady, share.audioTrackVersion])
  useEffect(() => { if (ref.current) ref.current.volume = preference.volume }, [preference.volume])
  return <audio ref={ref} autoPlay muted={preference.muted} aria-label={`Áudio de ${share.ownerName}`} />
}
