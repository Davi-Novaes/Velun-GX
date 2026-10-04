// Folga de reprodução de quem assiste.
// Sem folga, o navegador toca cada quadro assim que chega: quando um pacote se perde no caminho (Wi-Fi, provedor),
// a imagem PARA até o reenvio chegar ou até vir um quadro-chave novo — a "travadinha" com o FPS caindo para 20–30.
// Com ~150 ms de folga o reenvio (que leva 1 ida e volta, ~20–60 ms) chega antes da hora de mostrar o quadro.
// Vídeo e áudio da transmissão recebem a mesma folga para continuarem sincronizados.

export const PLAYOUT_SMOOTHING_MS = 150

/** Aplica a folga no receptor (Chrome/Edge/Electron 114+). Navegador sem suporte segue sem folga. */
export function smoothPlayout(receiver: RTCRtpReceiver | undefined): void {
  if (!receiver || !('jitterBufferTarget' in receiver)) return
  try { (receiver as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = PLAYOUT_SMOOTHING_MS } catch { /* valor recusado: segue o padrão */ }
}

/** Travadas (congelamentos de imagem) no último minuto, a partir do contador acumulado freezeCount. */
export class FreezeWindow {
  private samples: { at: number; count: number }[] = []
  constructor(private readonly windowMs = 60_000) {}

  add(at: number, count: number): number {
    // contador zerou (nova assinatura): recomeça a janela
    if (this.samples.length && count < this.samples[this.samples.length - 1]!.count) this.samples = []
    this.samples.push({ at, count })
    while (this.samples.length > 1 && at - this.samples[0]!.at > this.windowMs) this.samples.shift()
    return count - this.samples[0]!.count
  }
}
