import { useEffect, useState } from 'react'

export function CopyButton({ text, label = 'Copiar', className = 'btn' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')

  useEffect(() => {
    if (copied === 'idle') return
    const timer = setTimeout(() => setCopied('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }

  return (
    <button type="button" className={className} onClick={copy} aria-live="polite">
      {copied === 'ok' ? 'Copiado!' : copied === 'fail' ? 'Copie manualmente' : label}
    </button>
  )
}
