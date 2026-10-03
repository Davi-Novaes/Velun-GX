import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'livekit-client'
import { LiveKitScreenShare } from './LiveKitScreenShare'
import { joinResponse } from '../test/fakes'
import type { ShareOptions } from './RoomClient'

const options: ShareOptions = { resolution: '1080p', fps: 60, audio: false, audioScope: 'shared', surface: 'any' }
class Video extends EventTarget {
  id = Math.random().toString()
  contentHint = ''
  readyState = 'live'
  settings: MediaTrackSettings = { width: 1920, height: 1080, frameRate: 60, displaySurface: 'monitor' }
  constraints: MediaTrackConstraints = {}
  getSettings = () => this.settings
  getConstraints = () => this.constraints
  stop = vi.fn(() => { this.readyState = 'ended' })
  applyConstraints = vi.fn(async (c: MediaTrackConstraints) => {
    this.constraints = c
    this.settings = { ...this.settings, width: typeof c.width === 'object' ? Number(c.width.max) : 1920, height: typeof c.height === 'object' ? Number(c.height.max) : 1080, frameRate: typeof c.frameRate === 'object' ? Number(c.frameRate.max) : 60 }
  })
}
function setup() {
  const video = new Video()
  const stream = (track: Video) => ({ getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] })
  const capture = vi.fn(async () => stream(video))
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: capture } })
  let current = video
  const sender = { getParameters: vi.fn(() => ({ encodings: [{ rid: 'q', scaleResolutionDownBy: 3, maxBitrate: 1000000, maxFramerate: 15 }, { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 12000000, maxFramerate: 60 }] })), setParameters: vi.fn(async () => undefined) }
  const wrapper = { get mediaStreamTrack() { return current }, sender, setDegradationPreference: vi.fn(async () => undefined), replaceTrack: vi.fn(async (next: Video) => { current = next }) }
  const publish = vi.fn(async () => ({ videoTrack: wrapper, track: wrapper }))
  const unpublish = vi.fn(async () => undefined)
  const room = { localParticipant: { identity: 'p_local', publishTrack: publish, unpublishTrack: unpublish }, remoteParticipants: new Map() } as unknown as Room
  const change = vi.fn()
  const sharing = new LiveKitScreenShare(room, joinResponse().policy, change)
  return { video, stream, capture, sender, wrapper, publish, unpublish, sharing }
}
afterEach(() => vi.unstubAllGlobals())
describe('qualidade e fonte sem recriar publicação', () => {
  it('altera constraints e RTP na mesma track, sem publicar de novo', async () => {
    const s = setup(); await s.sharing.start(options)
    const result = await s.sharing.updateQuality({ ...options, resolution: '720p', fps: 30 })
    expect(result).toMatchObject({ width: 1280, height: 720, fps: 30 })
    expect(s.publish).toHaveBeenCalledTimes(1)
    expect(s.unpublish).not.toHaveBeenCalled()
    expect(s.video.stop).not.toHaveBeenCalled()
    expect(s.sender.setParameters).toHaveBeenLastCalledWith(expect.objectContaining({ encodings: expect.arrayContaining([expect.objectContaining({ rid: 'f', maxBitrate: 3500000, maxFramerate: 30 })]) }))
  })
  it('Original pode restaurar a resolução da fonte depois de reduzir', async () => {
    const s = setup(); await s.sharing.start(options)
    await s.sharing.updateQuality({ ...options, resolution: '480p', fps: 15 })
    const result = await s.sharing.updateQuality({ ...options, resolution: 'original', fps: 30 })
    expect(result).toMatchObject({ width: 1920, height: 1080, fps: 30 })
  })
  it('cancelar seletor mantém a fonte antiga e não desconecta', async () => {
    const s = setup(); await s.sharing.start(options)
    s.capture.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'))
    await expect(s.sharing.switchSource(options)).rejects.toMatchObject({ kind: 'cancelled' })
    expect(s.video.stop).not.toHaveBeenCalled(); expect(s.unpublish).not.toHaveBeenCalled(); expect(s.sharing.state).not.toBeNull()
  })
  it('troca fonte por replaceTrack e libera somente captura anterior', async () => {
    const s = setup(); await s.sharing.start(options)
    const next = new Video(); s.capture.mockResolvedValueOnce(s.stream(next))
    await s.sharing.switchSource(options)
    expect(s.wrapper.replaceTrack).toHaveBeenCalledWith(next, { userProvidedTrack: true })
    expect(s.video.stop).toHaveBeenCalledOnce(); expect(next.stop).not.toHaveBeenCalled()
    expect(s.publish).toHaveBeenCalledOnce(); expect(s.unpublish).not.toHaveBeenCalled()
  })
  it('constraints recusadas restauram configuração, sem encerrar transmissão', async () => {
    const s = setup(); await s.sharing.start(options)
    // recusa real = o navegador nega o tamanho exato E o modo com teto
    s.video.applyConstraints
      .mockRejectedValueOnce(new DOMException('too large', 'OverconstrainedError'))
      .mockRejectedValueOnce(new DOMException('too large', 'OverconstrainedError'))
    await expect(s.sharing.updateQuality({ ...options, resolution: '720p', fps: 30 })).rejects.toMatchObject({ kind: 'failed' })
    expect(s.sharing.state?.quality).toEqual({ resolution: '1080p', fps: 60 })
    expect(s.video.getSettings()).toMatchObject({ width: 1920, height: 1080, frameRate: 60 })
    expect(s.unpublish).not.toHaveBeenCalled()
  })
  it('tamanho exato recusado cai para o modo com teto e aplica a qualidade', async () => {
    const s = setup(); await s.sharing.start(options)
    s.video.applyConstraints.mockRejectedValueOnce(new DOMException('exact', 'OverconstrainedError'))
    await expect(s.sharing.updateQuality({ ...options, resolution: '720p', fps: 30 })).resolves.toMatchObject({ quality: { resolution: '720p', fps: 30 } })
    expect(s.unpublish).not.toHaveBeenCalled()
  })
  it('parada nativa encerra publicação e libera a captura', async () => {
    const s = setup(); await s.sharing.start(options)
    s.video.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => expect(s.sharing.state).toBeNull())
    expect(s.unpublish).toHaveBeenCalledOnce()
  })
})
