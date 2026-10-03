import { useState, type FormEvent } from 'react'
import { type AccountProfile, accounts } from '../../api/accounts'

/** Apelido: o que os outros veem. O login continua sendo o nome de usuário. */
export function NicknameForm({ profile, onSaved }: { profile: AccountProfile; onSaved: (profile: AccountProfile) => void }) {
  const [value, setValue] = useState(profile.nickname ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const changed = value.trim() !== (profile.nickname ?? '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !changed) return
    setBusy(true)
    setMessage(null)
    try {
      const saved = await accounts.updateProfile({ nickname: value.trim() || null })
      setValue(saved.nickname ?? '')
      onSaved(saved)
      setMessage({ kind: 'ok', text: 'Apelido salvo. Na call, ele aparece quando você entrar no canal de novo.' })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o apelido.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="nickname-form" onSubmit={(e) => void submit(e)}>
      <label className="field-label" htmlFor="account-nickname">Apelido</label>
      <div className="nickname-row">
        <input
          id="account-nickname"
          className="input"
          maxLength={64}
          placeholder={profile.username}
          value={value}
          disabled={busy}
          onChange={(e) => { setValue(e.target.value); setMessage(null) }}
        />
        <button className="btn btn-primary" disabled={busy || !changed}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
      <small className="muted">É o nome que os outros veem. Você continua entrando com <strong>{profile.username}</strong>. Deixe vazio para usar o nome de usuário.</small>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'error-text' : 'muted small'}>{message.text}</p>}
    </form>
  )
}
