// Espera a stack responder antes dos testes: logo após recriar um container, o Traefik só passa a rotear
// para ele depois do primeiro health check (antes disso responde 404).
export default async function globalSetup(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost'
  const deadline = Date.now() + 90_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      const [page, api] = await Promise.all([fetch(`${base}/`), fetch(`${base}/api/v1/rooms/ZZZZZZZZ`)])
      const html = await page.text()
      // a API está de pé quando responde 404 com ProblemDetails (sala inexistente)
      const apiUp = api.status === 404 && (api.headers.get('content-type') ?? '').includes('problem+json')
      if (page.ok && html.includes('<div id="root">') && apiUp) return
      last = `página ${page.status}, api ${api.status}`
    } catch (error) {
      last = String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`A stack não ficou pronta em ${base} (${last}). Rode: docker compose -f infra/docker-compose.yml up -d`)
}
