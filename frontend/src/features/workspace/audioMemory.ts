import type { AudioPreference } from './StreamContext'

// Volume/mudo que você escolheu para cada pessoa, lembrado neste navegador: se ela parar e voltar a
// transmitir (ou sair e entrar no canal), a transmissão já começa do jeito que você deixou.

const STORAGE_KEY = 'tj:streamAudio'
export const DEFAULT_AUDIO: AudioPreference = { muted: false, volume: 0.8 }

export type AudioMemory = Record<string, AudioPreference>

export function loadAudioMemory(): AudioMemory {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Partial<AudioPreference>>
    const result: AudioMemory = {}
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value?.volume === 'number' && value.volume >= 0 && value.volume <= 1) result[key] = { muted: value.muted === true, volume: value.volume }
    }
    return result
  } catch {
    return {}
  }
}

export function saveAudioMemory(memory: AudioMemory): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memory)) } catch { /* sem armazenamento: vale só nesta sessão */ }
}

/**
 * Chaves de uma transmissão: a conta da pessoa (estável) e o nome dela (reserva para os primeiros instantes,
 * enquanto a presença ainda não informou de quem é a nova sessão — evita o som começar alto antes de reconhecer).
 */
export function audioKeys(userId: string | undefined, ownerName: string): string[] {
  return [...(userId ? [`u:${userId}`] : []), `n:${ownerName.trim().toLowerCase()}`]
}

export function rememberedAudio(memory: AudioMemory, keys: string[]): AudioPreference | undefined {
  for (const key of keys) if (memory[key]) return memory[key]
  return undefined
}

export function rememberAudio(memory: AudioMemory, keys: string[], patch: Partial<AudioPreference>): AudioMemory {
  const next = { ...DEFAULT_AUDIO, ...rememberedAudio(memory, keys), ...patch }
  const updated = { ...memory }
  for (const key of keys) updated[key] = next
  return updated
}
