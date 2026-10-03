// Detecção de recursos do navegador para compartilhamento — sempre por feature detection, nunca por user agent.
// A verdade final vem depois da captura (displaySurface real, se veio track de áudio).

export interface ShareCapabilities {
  /** getDisplayMedia existe (não existe em iOS/Android). */
  canShare: boolean
  /** O navegador aceita pedir áudio junto da tela (Chromium). Firefox e Safari não entregam áudio. */
  canShareAudio: boolean
  /** O navegador respeita a preferência de tipo (tela/janela/aba) e oferece aba do navegador. */
  canHintSurface: boolean
}

export function detectShareCapabilities(): ShareCapabilities {
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  const canShare = typeof devices?.getDisplayMedia === 'function'
  const supported = (devices?.getSupportedConstraints?.() ?? {}) as Record<string, boolean | undefined>
  const chromiumCapture = typeof window !== 'undefined' && 'CaptureController' in window
  return {
    canShare,
    canShareAudio: canShare && (supported.suppressLocalAudioPlayback === true || chromiumCapture),
    canHintSurface: canShare && (supported.displaySurface === true && chromiumCapture),
  }
}
