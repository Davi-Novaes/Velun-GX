import { expect, test } from '@playwright/test'
import { closeBrowsers, createRoom, expectVideoFlowing, instrumentPeerConnections, join, person, startShare } from './support'

test.afterEach(closeBrowsers)

test('transmissão direta usa UDP 7882 sem TURN', async ({ baseURL }) => {
  const sender = await person('Transmissor', 'chromium', baseURL!)
  const viewer = await person('Espectador', 'chromium', baseURL!)
  await instrumentPeerConnections(viewer)
  const code = await createRoom(sender)
  await join(sender, code)
  await join(viewer, code)
  await startShare(sender, { audio: false })
  const size = await expectVideoFlowing(viewer, 'Tela de Transmissor')
  // A tela sintética é 16:9: limitar a captura não pode transformá-la em quadrada.
  expect(size.width / size.height).toBeCloseTo(16 / 9, 1)
  const paths = await viewer.page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs
    const paths = []
    for (const pc of pcs) {
      const stats = await pc.getStats()
      for (const stat of stats.values()) {
        if (stat.type !== 'transport' || !stat.selectedCandidatePairId) continue
        const pair = stats.get(stat.selectedCandidatePairId)
        const local = stats.get(pair.localCandidateId)
        const remote = stats.get(pair.remoteCandidateId)
        paths.push({ localType: local.candidateType, remoteType: remote.candidateType, protocol: remote.protocol, port: remote.port, address: remote.address })
      }
    }
    return paths
  })
  expect(paths.length).toBeGreaterThan(0)
  for (const path of paths) {
    expect(path.protocol).toBe('udp')
    expect(path.port).toBe(7882)
    expect(path.localType).not.toBe('relay')
    expect(path.remoteType).not.toBe('relay')
  }
  console.log('Caminho direto:', JSON.stringify(paths))
  await viewer.page.getByRole('button', { name: /Não assistir a nenhuma/ }).click()
  await expect(viewer.page.getByText('Você não está assistindo a nenhuma tela.')).toBeVisible()
  await expect(viewer.page.locator('video')).toHaveCount(0)
  await viewer.page.waitForTimeout(2000)
  const incoming = () => viewer.page.evaluate(async () => {
    let bytes = 0
    for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) {
      const stats = await pc.getStats()
      stats.forEach((s) => { if (s.type === 'inbound-rtp') bytes += s.bytesReceived ?? 0 })
    }
    return bytes
  })
  const before = await incoming()
  await viewer.page.waitForTimeout(2000)
  expect((await incoming()) - before).toBeLessThan(10000)
  await viewer.page.getByRole('button', { name: /Transmissor.*Clique para assistir/ }).click()
  await expectVideoFlowing(viewer, 'Tela de Transmissor')
  const second = await person('Segunda tela', 'chromium', baseURL!)
  await join(second, code)
  await startShare(second, { audio: false })
  await viewer.page.getByRole('button', { name: 'Adicionar tela de Segunda tela à grade' }).click()
  await expectVideoFlowing(viewer, 'Tela de Segunda tela')
  await expectVideoFlowing(viewer, 'Tela de Transmissor')
  await expect(viewer.page.locator('video')).toHaveCount(2)
  await viewer.page.screenshot({ path: 'ui-grid-desktop.png' })
  await viewer.page.setViewportSize({ width: 390, height: 844 })
  await viewer.page.screenshot({ path: 'ui-grid-mobile.png', fullPage: true })
  await viewer.page.setViewportSize({ width: 1280, height: 800 })
  await viewer.page.getByRole('button', { name: 'Remover tela de Segunda tela da grade' }).click()
  await expect(viewer.page.locator('video')).toHaveCount(1)
  await viewer.page.waitForTimeout(2000)
  const videoBytes = () => viewer.page.evaluate(async () => {
    const bytes: Record<string, number> = {}
    for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) {
      const stats = await pc.getStats()
      stats.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') bytes[s.id] = s.bytesReceived ?? 0 })
    }
    return bytes
  })
  const bytesBefore = await videoBytes()
  await viewer.page.waitForTimeout(2000)
  const bytesAfter = await videoBytes()
  // Apenas uma transmissão continua recebendo mídia; receptores WebRTC podem permanecer reutilizáveis.
  expect(Object.entries(bytesAfter).filter(([id, bytes]) => bytes - (bytesBefore[id] ?? 0) > 1000)).toHaveLength(1)
  await viewer.page.getByRole('button', { name: /Não assistir a nenhuma/ }).click()
  await expect(viewer.page.locator('video')).toHaveCount(0)
  await viewer.page.getByRole('button', { name: /Assistir a todas/ }).click()
  // Aguarda as novas assinaturas: o elemento pode ainda ter a faixa anterior durante a negociação.
  await expect.poll(async () => {
    const values = await videoBytes()
    await viewer.page.waitForTimeout(500)
    const next = await videoBytes()
    return Object.entries(next).filter(([id, bytes]) => bytes - (values[id] ?? 0) > 1000).length
  }).toBe(2)
  await expectVideoFlowing(viewer, 'Tela de Transmissor')
  await expectVideoFlowing(viewer, 'Tela de Segunda tela')
})
