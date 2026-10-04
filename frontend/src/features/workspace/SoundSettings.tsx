import { useState } from 'react'
import { loadSoundPrefs, playSound, saveSoundPrefs, type SoundPrefs } from './sounds'

/** Liga/desliga e ajusta o volume dos sons de entrada, saída e transmissão (vale só neste computador). */
export function SoundSettings() {
  const [prefs, setPrefs] = useState<SoundPrefs>(loadSoundPrefs)
  function change(next: SoundPrefs) { setPrefs(next); saveSoundPrefs(next) }
  return (
    <fieldset className="sound-settings">
      <legend className="field-label">Sons da call</legend>
      <label className="checkbox">
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => change({ ...prefs, enabled: e.target.checked })} />
        Tocar som quando alguém entra, sai ou começa/para de transmitir
      </label>
      <div className="sound-volume">
        <input type="range" min="0" max="100" aria-label="Volume dos sons" disabled={!prefs.enabled} value={Math.round(prefs.volume * 100)}
          onChange={(e) => change({ ...prefs, volume: Number(e.target.value) / 100 })} />
        <button type="button" className="btn" disabled={!prefs.enabled} onClick={() => playSound('join', prefs)}>Testar</button>
      </div>
    </fieldset>
  )
}
