import { describe, expect, it } from 'vitest'
import { preferH264Baseline } from './h264Baseline'

const sdp = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 108 109 98',
  'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96',
  'a=rtpmap:102 H264/90000', 'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f', 'a=rtcp-fb:102 nack',
  'a=rtpmap:103 rtx/90000', 'a=fmtp:103 apt=102',
  'a=rtpmap:108 H264/90000', 'a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f', 'a=rtcp-fb:108 nack',
  'a=rtpmap:109 rtx/90000', 'a=fmtp:109 apt=108',
  'a=rtpmap:98 VP9/90000', '',
].join('\r\n')

describe('H.264 pela placa de vídeo (perfil Baseline)', () => {
  it('retira o 42e01f e a retransmissão dele, mantendo 42001f, VP8, VP9 e o áudio', () => {
    const out = preferH264Baseline(sdp)
    expect(out).toContain('m=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 98')
    expect(out).not.toMatch(/a=(rtpmap|fmtp|rtcp-fb):10[89]/)
    expect(out).toContain('profile-level-id=42001f')
    expect(out).toContain('a=rtpmap:96 VP8/90000')
    expect(out).toContain('a=rtpmap:98 VP9/90000')
    expect(out).toContain('m=audio 9 UDP/TLS/RTP/SAVPF 111')
  })

  it('sem 42001f na seção (ex.: Safari), não mexe em nada', () => {
    const safari = sdp.replace('profile-level-id=42001f', 'profile-level-id=640c1f')
    expect(preferH264Baseline(safari)).toBe(safari)
  })
})
