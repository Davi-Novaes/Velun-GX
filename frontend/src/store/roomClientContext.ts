import { createContext, useContext } from 'react'
import type { RoomClient } from '../media/RoomClient'

/** O RoomClient da sala atual (para componentes que ligam vídeo/áudio a elementos). */
export const RoomClientContext = createContext<RoomClient | null>(null)

export function useRoomClient(): RoomClient {
  const client = useContext(RoomClientContext)
  if (!client) throw new Error('useRoomClient fora de RoomClientContext')
  return client
}
