import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

interface Position { right: number; bottom: number }

const MOVE_THRESHOLD = 5
const MARGIN = 8

function readPosition(key: string): Position | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as Position | null
    return value && Number.isFinite(value.right) && Number.isFinite(value.bottom) ? value : null
  } catch {
    return null
  }
}

/**
 * Painel flutuante que pode ser arrastado dentro do elemento pai (ex.: a prévia da sua transmissão).
 * Arrastar só começa após alguns pixels, então cliques nos botões e no vídeo continuam funcionando;
 * um arraste nunca vira clique. A posição é lembrada por navegador.
 */
export function DraggablePanel({ className, storageKey, label, children }: { className: string; storageKey: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<Position | null>(() => readPosition(storageKey))
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; start: Position; pointerId: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  const clamp = useCallback((p: Position): Position => {
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return p
    const maxRight = Math.max(MARGIN, parent.clientWidth - el.offsetWidth - MARGIN)
    const maxBottom = Math.max(MARGIN, parent.clientHeight - el.offsetHeight - MARGIN)
    return { right: Math.min(Math.max(MARGIN, p.right), maxRight), bottom: Math.min(Math.max(MARGIN, p.bottom), maxBottom) }
  }, [])

  // a janela pode diminuir: mantém o painel visível
  useEffect(() => {
    const fit = () => setPosition((p) => (p ? clamp(p) : p))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [clamp])

  function currentPosition(): Position {
    const el = ref.current!
    const parent = el.parentElement!
    const a = el.getBoundingClientRect(), b = parent.getBoundingClientRect()
    return { right: b.right - a.right, bottom: b.bottom - a.bottom }
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, a, [role="menu"]')) return
    drag.current = { x: event.clientX, y: event.clientY, start: currentPosition(), pointerId: event.pointerId, moved: false }
  }

  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current
    if (!d || d.pointerId !== event.pointerId) return
    const dx = event.clientX - d.x, dy = event.clientY - d.y
    if (!d.moved) {
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD) return
      d.moved = true
      setDragging(true)
      ref.current?.setPointerCapture?.(event.pointerId)
    }
    setPosition(clamp({ right: d.start.right - dx, bottom: d.start.bottom - dy }))
  }

  function onPointerUp(event: React.PointerEvent) {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    suppressClick.current = true
    setDragging(false)
    ref.current?.releasePointerCapture?.(event.pointerId)
    setPosition((p) => {
      if (p) {
        try { localStorage.setItem(storageKey, JSON.stringify(p)) } catch { /* sem armazenamento: só não lembra a posição */ }
      }
      return p
    })
  }

  return (
    <div
      ref={ref}
      className={`${className} draggable-panel${dragging ? ' dragging' : ''}`}
      aria-label={label}
      title="Arraste para mover"
      style={position ? { right: position.right, bottom: position.bottom } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false
          event.stopPropagation()
          event.preventDefault()
        }
      }}
    >
      {children}
    </div>
  )
}
