import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { closeBrowsers, createRoom, expectVideoFlowing, instrumentPeerConnections, join, person, selectedIcePaths, startShare } from './support'

test.afterEach(closeBrowsers)

/** IP da máquina na rede local (o mesmo que o SFU anuncia), lido de infra/.env. */
function lanUrl(): string {
  if (process.env.E2E_LAN_URL) return process.env.E2E_LAN_URL
  const env = readFileSync(new URL('../../infra/.env', import.meta.url), 'utf8')
  const ip = env.match(/^LIVEKIT_NODE_IP=(.+)$/m)?.[1]?.trim()
  if (!ip) throw new Error('LIVEKIT_NODE_IP não encontrado em infra/.env')
  return `https://${ip}`
}

test('HTTPS pelo IP da rede local (caminho de outro dispositivo): compartilha e assiste', async () => {
  const maria = await person('Maria', 'chromium', lanUrl())
  const joao = await person('João', 'firefox', lanUrl())
  const code = await createRoom(maria)
  await join(maria, code)
  await join(joao, code)

  await startShare(maria, { audio: true })

  await expectVideoFlowing(joao, 'Tela de Maria')
})

test('só TURN (UDP direto proibido): a mídia passa pelo coturn', async ({ baseURL }) => {
  const maria = await person('Maria', 'chromium', baseURL!, { forceRelay: true })
  const joao = await person('João', 'chromium', baseURL!, { forceRelay: true })
  await instrumentPeerConnections(joao)
  const code = await createRoom(maria)
  await join(maria, code)
  await join(joao, code)

  await startShare(maria, { audio: false })
  await expectVideoFlowing(joao, 'Tela de Maria')

  // Com iceTransportPolicy=relay o navegador só pode usar candidatos do TURN. O candidato local aparece como
  // "relay" ou "prflx": o coturn anuncia o IP externo mas fala com o SFU pelo IP interno, e o navegador aprende
  // esse caminho (ainda pelo TURN) como peer-reflexive. O destino é o IP interno do SFU, só alcançável via coturn.
  const paths = await selectedIcePaths(joao)
  test.info().annotations.push({ type: 'caminho ICE', description: JSON.stringify(paths) })
  expect(paths.length).toBeGreaterThan(0)
  for (const path of paths) {
    expect(path.policy).toBe('relay')
    expect(path.usesTurnServer).toBe(true)
    expect(['relay', 'prflx']).toContain(path.localCandidate)
    expect(path.bytesReceived).toBeGreaterThan(0)
  }
})
