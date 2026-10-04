import { useState, type FormEvent } from 'react'
import type { AccountProfile } from '../../api/accounts'
import { useServices } from '../../app/services'

/** Trocar a própria senha. Os outros logins (outros PCs, app) saem; este continua dentro. */
export function PasswordForm({ onSaved, required = false }: { onSaved: (profile: AccountProfile) => void; required?: boolean }) {
  const { accounts } = useServices()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (next !== confirm) { setMessage({ kind: 'error', text: 'As senhas novas não coincidem.' }); return }
    setBusy(true)
    setMessage(null)
    try {
      const saved = await accounts.changePassword(current, next, confirm)
      setCurrent(''); setNext(''); setConfirm('')
      setMessage({ kind: 'ok', text: 'Senha trocada. Se você estava conectado em outro PC ou no app, entre lá de novo com a senha nova.' })
      onSaved(saved)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível trocar a senha.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="password-form" onSubmit={(e) => void submit(e)} aria-label="Trocar senha">
      <h3>{required ? 'Crie sua senha nova' : 'Trocar senha'}</h3>
      {required && <p role="alert" className="password-required">O administrador definiu uma senha provisória para sua conta. Crie a sua senha para continuar.</p>}
      <label className="field-label" htmlFor="password-current">{required ? 'Senha provisória' : 'Senha atual'}</label>
      <input id="password-current" className="input" type="password" required autoComplete="current-password" maxLength={128} value={current} disabled={busy} onChange={(e) => { setCurrent(e.target.value); setMessage(null) }} />
      <label className="field-label" htmlFor="password-new">Senha nova</label>
      <input id="password-new" className="input" type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={next} disabled={busy} onChange={(e) => { setNext(e.target.value); setMessage(null) }} />
      <label className="field-label" htmlFor="password-confirm">Confirmar senha nova</label>
      <input id="password-confirm" className="input" type="password" required maxLength={128} autoComplete="new-password" value={confirm} disabled={busy} onChange={(e) => { setConfirm(e.target.value); setMessage(null) }} />
      <small className="muted">Use ao menos 10 caracteres.</small>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'error-text' : 'muted small'}>{message.text}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Trocar senha'}</button>
    </form>
  )
}
