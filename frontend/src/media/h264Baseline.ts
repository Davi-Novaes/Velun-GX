// H.264 pela placa de vídeo: o Chromium só usa o codificador da placa (NVENC/AMF/QuickSync, via Media
// Foundation) no perfil Baseline (42001f). No Constrained Baseline (42e01f), que o servidor de vídeo prefere,
// ele codifica no processador (OpenH264). Retirar o 42e01f das OFERTAS faz o servidor escolher o 42001f.
// Só mexe quando o 42001f existe na mesma seção (senão — ex.: Safari — deixa como está); VP8/VP9/AV1 intactos.

const BASELINE = /profile-level-id=42001f/i
const CONSTRAINED = /profile-level-id=42e01f/i

/** Remove da seção de vídeo os formatos H.264 42e01f (e as retransmissões deles) se houver H.264 42001f. */
export function preferH264Baseline(sdp: string): string {
  const sections = sdp.split(/(?=^m=)/m)
  return sections.map((section) => {
    if (!section.startsWith('m=video')) return section
    const fmtp = new Map<string, string>()
    for (const match of section.matchAll(/^a=fmtp:(\d+) (.*)$/gm)) fmtp.set(match[1]!, match[2]!)
    const baseline = [...fmtp].filter(([, params]) => BASELINE.test(params)).map(([pt]) => pt)
    if (!baseline.length) return section
    const drop = new Set([...fmtp].filter(([, params]) => CONSTRAINED.test(params)).map(([pt]) => pt))
    if (!drop.size) return section
    // retransmissões (rtx) apontam para o formato original por apt=
    for (const [pt, params] of fmtp) { const apt = /apt=(\d+)/.exec(params)?.[1]; if (apt && drop.has(apt)) drop.add(pt) }
    const lines = section.split(/\r\n/)
    const kept = lines.filter((line) => {
      const pt = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)[ \s]/.exec(line)?.[1]
      return !pt || !drop.has(pt)
    })
    kept[0] = kept[0]!.split(' ').filter((token, index) => index < 3 || !drop.has(token)).join(' ')
    return kept.join('\r\n')
  }).join('')
}

let installed = false

/** Aplica preferH264Baseline em toda oferta deste navegador (idempotente). */
export function installH264BaselinePreference(): void {
  if (installed || typeof RTCPeerConnection === 'undefined') return
  installed = true
  const original = RTCPeerConnection.prototype.createOffer
  RTCPeerConnection.prototype.createOffer = async function (this: RTCPeerConnection, ...args: unknown[]) {
    const offer = await (original as (...a: unknown[]) => Promise<RTCSessionDescriptionInit>).apply(this, args)
    return offer?.sdp ? { type: offer.type, sdp: preferH264Baseline(offer.sdp) } : offer
  } as typeof RTCPeerConnection.prototype.createOffer
}
