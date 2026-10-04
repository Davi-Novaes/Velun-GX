// Sons da call, no estilo do Discord: alguém entra/sai do canal em que você está, ou começa/para de transmitir.

export type CallSound = 'join' | 'leave' | 'stream-start' | 'stream-stop'

export interface SoundPrefs { enabled: boolean; volume: number }

const PREFS_KEY = 'tj:sounds'
const DEFAULT_PREFS: SoundPrefs = { enabled: true, volume: 0.5 }

export function loadSoundPrefs(): SoundPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<SoundPrefs> | null
    if (!saved) return DEFAULT_PREFS
    return {
      enabled: saved.enabled !== false,
      volume: typeof saved.volume === 'number' && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : DEFAULT_PREFS.volume,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function saveSoundPrefs(prefs: SoundPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* sem armazenamento: vale só nesta sessão */ }
}

const lastPlayed = new Map<CallSound, number>()

/** Toca um som curto. Nunca falha: sem permissão de áudio ou sem suporte, fica em silêncio. */
export function playSound(name: CallSound, prefs: SoundPrefs = loadSoundPrefs()): void {
  if (!prefs.enabled || prefs.volume <= 0 || typeof Audio === 'undefined') return
  // vários eventos juntos (ex.: reconexão de alguém) tocam uma vez só
  const now = Date.now()
  if (now - (lastPlayed.get(name) ?? 0) < 400) return
  lastPlayed.set(name, now)
  try {
    const audio = new Audio(`/sounds/${name}.ogg`)
    audio.volume = prefs.volume
    void audio.play()?.catch(() => undefined)
  } catch {
    // ambiente sem áudio
  }
}

export interface CallSnapshot {
  /** Identidades de quem está no canal (inclui você). */
  participants: string[]
  /** Identidades de quem está transmitindo (inclui você). */
  shares: string[]
}

/** Sons a tocar entre dois momentos da mesma call. Sem momento anterior (acabou de conectar) não toca nada. */
export function callSoundsFor(previous: CallSnapshot | null, next: CallSnapshot): CallSound[] {
  if (!previous) return []
  const sounds: CallSound[] = []
  const had = (list: string[]) => new Set(list)
  const before = had(previous.participants), after = had(next.participants)
  if (next.participants.some((id) => !before.has(id))) sounds.push('join')
  if (previous.participants.some((id) => !after.has(id))) sounds.push('leave')
  const sharing = had(previous.shares), nowSharing = had(next.shares)
  if (next.shares.some((id) => !sharing.has(id))) sounds.push('stream-start')
  if (previous.shares.some((id) => !nowSharing.has(id))) sounds.push('stream-stop')
  return sounds
}
