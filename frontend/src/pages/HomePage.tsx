import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { describeError } from '../api/client'
import type { CreatedRoom } from '../api/contracts'
import { useServices } from '../app/services'
import { CopyButton } from '../components/CopyButton'

export function roomLink(code: string): string {
  return `${window.location.origin}/room/${code}`
}

type State = { kind: 'idle' } | { kind: 'creating' } | { kind: 'created'; room: CreatedRoom } | { kind: 'error'; message: string }

export function HomePage() {
  const { api } = useServices()
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function create() {
    setState({ kind: 'creating' })
    try {
      setState({ kind: 'created', room: await api.createRoom() })
    } catch (error) {
      setState({ kind: 'error', message: describeError(error) })
    }
  }

  return (
    <main className="center-page landing">
      <header className="landing-nav"><a className="wordmark" href="/"><span className="brand-mark small" aria-hidden="true" />Tela<span className="wordmark-accent">junto</span></a><Link className="btn btn-ghost" to="/login">Entrar na conta</Link></header>
      <div className="landing-layout">
      <section className="card hero" aria-labelledby="home-title">
        <span className="eyebrow"><span className="dot dot-ok" /> COMPARTILHE O MOMENTO</span>
        <p className="hero-headline">Sua tela.<br /><span>Todo mundo junto.</span></p>
        <h1 id="home-title">Compartilhamento de Tela</h1>
        <p className="muted">Compartilhe sua tela com até 20 pessoas, direto do navegador.</p>

        {state.kind !== 'created' && (
          <button className="btn btn-primary btn-lg" onClick={create} disabled={state.kind === 'creating'}>
            {state.kind === 'creating' ? 'Criando…' : 'Criar sala'}
          </button>
        )}

        {state.kind === 'error' && (
          <p role="alert" className="error-text">
            {state.message}
          </p>
        )}

        {state.kind === 'created' && (
          <div className="created" role="status">
            <h2>Sala criada!</h2>
            <label className="field-label" htmlFor="room-link">
              Link da sala
            </label>
            <div className="link-row">
              <input id="room-link" className="input mono" readOnly value={roomLink(state.room.code)} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton text={roomLink(state.room.code)} label="Copiar link" />
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => navigate(`/room/${state.room.code}`)}>
              Entrar na sala
            </button>
          </div>
        )}
        <div className="hero-facts"><span>Até 20 pessoas</span><span>Sem instalação</span><span>Áudio opcional</span></div>
      </section>
      <aside className="landing-preview" aria-label="Como funciona">
        <div className="preview-top"><span className="preview-dots">● ● ●</span><span>Sua próxima sessão</span><span className="preview-pill">JUNTOS</span></div>
        <div className="preview-scene"><div className="scene-orbit" /><div className="scene-window"><span className="scene-icon">↗</span><strong>Uma tela.<br />Mil possibilidades.</strong><span>Jogue, apresente, explore.</span></div><span className="preview-caption">O melhor lugar é com a sua turma.</span></div>
        <div className="preview-bottom"><div className="avatar-stack"><span>M</span><span>J</span><span>A</span></div><span>Convide quem faz parte</span><span className="preview-share">↗ Compartilhar</span></div>
        <ol className="how-it-works"><li><span>01</span>Crie sua sala</li><li><span>02</span>Envie o link</li><li><span>03</span>Compartilhe a tela</li></ol>
      </aside>
      </div>
      <footer className="landing-footer">Feito para estar perto, mesmo de longe.</footer>
    </main>
  )
}
