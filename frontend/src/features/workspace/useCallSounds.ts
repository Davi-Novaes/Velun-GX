import { useEffect, useRef } from 'react'
import type { ConnectionPhase } from '../../media/RoomClient'
import { type CallSnapshot, callSoundsFor, playSound } from './sounds'

/** Logo após conectar, a lista de quem já estava no canal ainda chega aos poucos: não é "entrada" de ninguém. */
const SETTLE_MS = 1500
/**
 * Transmissão que some e volta logo (troca automática do formato de vídeo, ~1 s) não é "parou e começou":
 * o som de parar espera esse tempo e é cancelado se ela voltar.
 */
const STOP_GRACE_MS = 2000

/** Toca os sons da call conforme a conexão, quem está no canal e quem transmite mudam. */
export function useCallSounds(phase: ConnectionPhase, participants: { identity: string }[], shares: { id: string }[]): void {
  const snapshot = useRef<CallSnapshot | null>(null)
  const previousPhase = useRef(phase)
  const connectedAt = useRef(0)
  const pendingStop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(pendingStop.current), [])

  useEffect(() => {
    const before = previousPhase.current
    previousPhase.current = phase
    if (phase === 'connected') {
      connectedAt.current = Date.now()
      // reconexão não é entrada: só toca quando você entra de fato no canal
      if (before !== 'connected' && before !== 'reconnecting') playSound('join')
    } else {
      snapshot.current = null
      if (phase === 'disconnected' && (before === 'connected' || before === 'reconnecting')) playSound('leave')
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'connected') return
    const next = { participants: participants.map((p) => p.identity), shares: shares.map((s) => s.id) }
    if (Date.now() - connectedAt.current >= SETTLE_MS) {
      for (const sound of callSoundsFor(snapshot.current, next)) {
        if (sound === 'stream-stop') {
          clearTimeout(pendingStop.current)
          pendingStop.current = setTimeout(() => { pendingStop.current = undefined; playSound('stream-stop') }, STOP_GRACE_MS)
        } else if (sound === 'stream-start' && pendingStop.current) {
          // voltou logo depois de sumir: era só a troca de formato, sem som nenhum
          clearTimeout(pendingStop.current)
          pendingStop.current = undefined
        } else {
          playSound(sound)
        }
      }
    }
    snapshot.current = next
  }, [phase, participants, shares])
}
