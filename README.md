# Compartilhamento de Tela de Baixa Latência

Compartilhamento de tela pelo navegador para até 20 pessoas por sala, com WebRTC + SFU (LiveKit).
Arquitetura e decisões em [docs/](docs/README.md).

## Como usar

A home agora abre a plataforma de contas, servidores e canais. Crie uma conta (sem e-mail), crie um servidor, entre em um canal e gere um convite para os amigos. Cada canal permite **20 pessoas no total e 4 transmissores simultâneos**. As telas remotas aparecem em grade; é possível escolher quais assistir, não assistir a nenhuma, focar uma ou abrir em tela cheia. A prévia própria fica pequena por padrão.

Resolução Original/Auto/1080p/720p/480p/360p e 15/30/60 FPS podem ser alterados durante a transmissão. A fonte pode ser trocada sem sair do canal. A plataforma nova transmite somente vídeo, portanto não captura o som do Discord. Salas antigas continuam em `/legacy` e `/room/{codigo}`, incluindo seu áudio opcional.

Arquitetura e estado final: [reformulação](docs/07-reformulacao-servidores-canais.md). Evidências e limitações: [validação](docs/08-validacao-reformulacao.md). Sem recuperação automática de senha nesta versão.

## Pré-requisitos

- Docker Desktop (ou Docker Engine + Compose v2)
- .NET SDK 10 e Node.js 24 (só para desenvolver/testar fora do Docker)

## Subir o ambiente local

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/init-env.ps1
```

Gera `infra/.env` com segredos aleatórios e o IP da máquina na rede local, usado pelo SFU e pelo TURN.

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

| Serviço | Endereço |
|---|---|
| **Aplicação** | `http://localhost` ou `https://localhost` |
| Aplicação na rede local (outros PCs/celular) | `https://<IP da máquina>` (ver HTTPS abaixo) |
| API (via Traefik) | `http://localhost/api/...` |
| Sinalização do SFU (via Traefik) | `ws://localhost/rtc` |
| Mídia WebRTC | UDP 7882, TCP 7881 |
| TURN | 3478 UDP/TCP, relay UDP 49160–49200 |
| Prometheus | `http://127.0.0.1:9090` |
| API do LiveKit (só local, para testes) | `http://127.0.0.1:7880` |

Estado dos serviços:

```bash
docker compose -f infra/docker-compose.yml ps
```

## HTTPS para testar de outros dispositivos

`getDisplayMedia` só funciona em contexto seguro: `localhost` basta na própria máquina, mas outros dispositivos da rede precisam de HTTPS.

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File infra/scripts/dev-cert.ps1
```

Gera uma CA local e um certificado para `localhost`, o IP da rede local e `screenshare.test`. Depois, reinicie o Traefik:

```bash
docker compose -f infra/docker-compose.yml restart traefik
```

O navegador avisa sobre o certificado na primeira visita (pode aceitar). Para não ver o aviso, importe `infra/certs/dev-ca.crt` como autoridade raiz confiável nos seus dispositivos de teste. O script não faz isso sozinho. O Firewall do Windows precisa liberar 443/tcp, 7881/tcp, 7882/udp, 3478 e 49160–49359/udp na rede privada.

## Desenvolvimento do frontend

Com a stack no ar, o Vite serve o frontend com recarga instantânea e encaminha `/api` e `/rtc` para `http://localhost`:

```bash
npm --prefix frontend run dev
```

## Testes

```bash
dotnet run --project backend/tests/ScreenShare.UnitTests
dotnet run --project backend/tests/ScreenShare.IntegrationTests
```

Testes unitários e de integração (a API real sobre PostgreSQL e Redis em containers descartáveis; precisa do Docker). Os testes de stack são pulados.

```bash
STACK_TESTS=1 dotnet test backend
```

Inclui os testes contra a stack no ar: token aceito/recusado pelo SFU, cliente WebRTC real publicando vídeo, webhooks assinados e rotas internas não expostas pelo proxy.

```bash
npm --prefix frontend test
```

Testes do frontend (Vitest).

```bash
npm --prefix frontend run test:e2e
```

Testes ponta a ponta com navegadores reais (Chromium, Edge e Firefox via Playwright) contra a stack no ar: compartilhamento com e sem áudio entre navegadores, parada pela barra nativa, HTTPS pelo IP da rede e mídia forçada pelo TURN. Na primeira vez, instale os navegadores do Playwright:

```bash
npx --prefix frontend playwright install chromium firefox
```

## Estrutura

```text
backend/   .NET 10 — Api, Application, Domain, Infrastructure + testes
frontend/  React 19 + TypeScript + Vite — páginas, cliente de mídia (LiveKit), testes
infra/     docker compose, Traefik, coturn, Prometheus, scripts
docs/      arquitetura, fluxos, banco, APIs, infraestrutura, plano
```
