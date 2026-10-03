# Documento 6 — Plano de implementação

## 1. Estrutura de pastas

```text
/
├─ docs/                          # estes documentos
├─ backend/
│  ├─ ScreenShare.sln
│  ├─ Directory.Build.props       # nullable, warnings as errors, versão .NET 10
│  ├─ src/
│  │  ├─ ScreenShare.Api/             # Program.cs, endpoints, auth, rate limit, webhooks, ProblemDetails
│  │  ├─ ScreenShare.Application/     # casos de uso (CreateRoom, JoinRoom, HandleSfuEvent...)
│  │  ├─ ScreenShare.Domain/          # Room, Participant, StreamSession, MediaPolicy, RoomCode
│  │  └─ ScreenShare.Infrastructure/  # EF Core, Redis, LiveKitGateway, JWT, BackgroundServices
│  └─ tests/
│     ├─ ScreenShare.UnitTests/         # xUnit
│     └─ ScreenShare.IntegrationTests/  # WebApplicationFactory + Testcontainers (Postgres, Redis, LiveKit)
├─ frontend/
│  ├─ index.html, vite.config.ts, package.json
│  ├─ src/
│  │  ├─ app/            # router, providers, layout
│  │  ├─ pages/          # HomePage, RoomPage (PreJoin → Connecting → InRoom)
│  │  ├─ api/            # cliente HTTP + tipos dos contratos
│  │  ├─ media/          # RoomClient, ScreenShareController, QualityController,
│  │  │                  # StatsCollector, Capabilities, ReconnectManager, presets.ts
│  │  ├─ features/       # participants, stage, controls, share-dialog, quality, connection-indicator, diagnostics
│  │  ├─ store/          # Zustand
│  │  ├─ components/ui/  # botões, diálogo, tooltip, toast
│  │  └─ styles/
│  └─ tests/
│     ├─ unit/           # Vitest + Testing Library
│     └─ e2e/            # Playwright
├─ infra/
│  ├─ docker-compose.yml, docker-compose.override.yml, docker-compose.prod.yml
│  ├─ livekit/livekit.yaml
│  ├─ coturn/turnserver.conf
│  ├─ traefik/ (traefik.yml, dynamic/)
│  ├─ prometheus/prometheus.yml
│  └─ grafana/ (provisioning, dashboards)
├─ loadtest/
│  ├─ lk/          # cenários com LiveKit CLI (lk load-test)
│  ├─ browsers/    # bots Playwright (navegadores reais) para medir latência ponta a ponta
│  └─ api/         # k6 para a API REST
├─ .env.example
└─ README.md
```

## 2. Estratégia de testes

### Backend

| Área | Tipo | Casos |
|---|---|---|
| Criação de sala | Unit + integração | código válido/único, colisão resolvida, rate limit 429, expiração calculada |
| Entrada | Integração | sala inexistente 404, expirada 410, apelido inválido 422, sucesso retorna token + policy |
| Limite de 20 | Integração (LiveKit real em Testcontainers ou fake do `ISfuGateway`) | 20 entram, 21º recebe 409; 25 joins concorrentes → exatamente 20 aceitos |
| Token | Unit | claims corretos (sala, identity, sources, sem admin), assinatura, `exp` = 10 min |
| Expiração de token | Unit | token expirado rejeitado pelo validador; relógio controlado (`TimeProvider`) |
| Autorização | Integração | sem cookie → 401; token de uma sala não serve para outra; webhook sem assinatura → 401; reuso de `participantId` de outra sessão → 403 |

### Frontend

| Área | Tipo | Casos |
|---|---|---|
| Criação de sala | Vitest + API falsa | botão → link exibido → copiar |
| Entrada | Vitest + API e RoomClient falsos | validação do nome, "Sala cheia", estados Conectando/Verificando/Conectado |
| Compartilhamento | Vitest com `RoomClient` falso + Playwright | inicia, mostra "Transmitindo", sem áudio não gera erro, cancelamento do seletor não gera erro |
| Parar | idem | botão, e evento `ended` da track (barra nativa) |
| Qualidade | Unit do `QualityController` | presets filtrados por capacidade; `applyConstraints`/`setParameters` chamados com valores certos; degrau adaptativo com histerese |
| Reconexão | Unit do `ReconnectManager` (timers falsos) + Playwright (derrubar rede com `context.setOffline`) | "Tentativa 1/3", sucesso, falha → "Tentar novamente", share republicado sem seletor |

### WebRTC (Playwright, navegadores reais)

Chromium e Edge com `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (o `getDisplayMedia` devolve uma tela sintética com áudio); Firefox com `media.navigator.streams.fake` (tela sintética **sem** áudio, como o Firefox real). Cada pessoa é um contexto de navegador próprio (cookies próprios) e cada teste usa navegadores novos. "Vídeo chegando" = dimensão > 0 e tempo de reprodução avançando (o Firefox devolve sempre 0 em `getVideoPlaybackQuality` para WebRTC). O caminho ICE é conferido pelas estatísticas do próprio `RTCPeerConnection`.

Implementados na Fase 3 (`frontend/e2e`): Chromium→Chromium com e sem áudio; Chromium→Edge+Firefox; Firefox→Chromium; Edge→Firefox; parar pela barra nativa; HTTPS pelo IP da LAN; só TURN.

Fase 8 (latência): Uma aba "fonte" renderiza um relógio em milissegundos + padrão móvel; os espectadores leem o relógio do frame recebido (OCR simples ou código visual) → **latência ponta a ponta real**.

| Cenário | Critério de aprovação |
|---|---|
| 1 transmissor + 1 espectador | vídeo em < 3 s após publicar; latência p95 < 200 ms (local) |
| 1 + 5 | idem, sem perda > 1 % |
| 1 + 10 | idem |
| 1 + 20 (21º rejeitado) | 20 conectados, 21º vê "Sala cheia" |
| 2–3 transmissores | cada espectador recebe todos; troca de foco funciona |

### Teste de carga

Ferramentas: **`lk load-test`** (LiveKit CLI — publica vídeo sintético e simula assinantes reais em WebRTC, sem custo de navegador) para volume; bots Playwright para amostrar latência real em paralelo; Prometheus/Grafana para CPU, RAM, banda, perda, RTT, utilização do SFU.

| Etapa | Cenário | Medir / critério |
|---|---|---|
| A | 1 sala, 20 usuários, 1 transmissão 1080p30 | baseline de CPU/RAM/egress do SFU; perda < 1 %; RTT estável |
| B | 5 salas × 20 | crescimento linear; nenhuma sala degrada outra |
| C | 10 salas × 20 | identificar o gargalo (rede × CPU); definir capacidade por nó |
| D (extra) | C + 10 % de clientes com 3 % de perda e 150 ms (via `tc netem`) | espectadores bons não são afetados pelos ruins |

Rodar a partir de máquina(s) **separada(s)** do servidor, para o gerador de carga não disputar CPU com o SFU. Resultado vira `loadtest/RESULTADOS.md` com números e a capacidade recomendada por nó.

## 3. Fases

Cada fase termina com: compilar → subir via Docker Compose → testes automatizados verdes → teste manual do critério → revisão da arquitetura → **sua aprovação** para seguir. Mudança arquitetural relevante é explicada antes (motivo + impacto).

| Fase | Entregas | Critério de saída |
|---|---|---|
| **1. Infraestrutura + Backend + SFU** | Compose com Traefik, Postgres, Redis, LiveKit, coturn, Prometheus; `.env.example`; solução .NET com as 4 camadas; health checks; `LiveKitGateway` (token + Twirp); webhook validado; logs JSON; testes do token | `docker compose up` sobe tudo saudável; teste de integração conecta um cliente do `lk` CLI com token gerado pelo backend; TURN validado com `turnutils_uclient` |
| **2. Criação e entrada em salas** | Sessões, `POST /rooms`, `GET /rooms/{code}`, `POST /join`, `/leave`, limite de 20 com lock, rate limiting, EF migrations; frontend Vite com Home, "Sala criada", PreJoin, Conectando/Conectado, lista de participantes | Criar sala no navegador, abrir link em outra aba, os dois se veem na lista; 21º recebe "Sala cheia" (teste automatizado) |
| **3. WebRTC e compartilhamento** | `RoomClient`, `ScreenShareController`, diálogo de share, `getDisplayMedia` com áudio opcional (tracks separadas), palco de vídeo, "🔴 Transmitindo", parar (botão e barra nativa), aviso de áudio indisponível | 1 transmissor + 1 espectador em Chrome, Edge e Firefox; com e sem áudio |
| **4. Múltiplos participantes** | Estados watching/sharing/reconnecting/disconnected; múltiplos shares simultâneos (palco + miniaturas, adaptive stream); volume/mudo local; E2E 1+5, 1+10, 1+20 | Testes E2E de 1+20 verdes; dois transmissores simultâneos |
| **5. Qualidade / FPS / bitrate** | `Capabilities`, presets, `QualityController` (manual + adaptativo), simulcast, `contentHint`/`degradationPreference`, H.264 com backupCodec quando há hardware, `StatsCollector`, indicador 🟢🟡🔴 com tooltip, painel de diagnóstico (inclui A/V sync), telemetria | Trocar 360p↔1080p e 15↔60 FPS sem reabrir seletor; com banda limitada (DevTools/netem) a qualidade cai e volta sem desconectar |
| **6. Reconexão e erros** | `ReconnectManager` (3 níveis, 1/3…3/3, Tentar novamente), share sobrevive à reconexão, sessão-fantasma derrubada, mensagens de erro para todos os casos de falha (permissão negada, sala expirada, SFU indisponível) | E2E com rede offline/online; Wi-Fi trocado manualmente no notebook |
| **7. Interface final** | Identidade visual própria, tema escuro padrão, responsividade (espectador no celular), acessibilidade (teclado, contraste, `aria-live` para status), polimento | Revisão visual em desktop, notebook, tablet e celular |
| **8. Testes de carga** | Cenários A–D, dashboards, relatório de capacidade, ajustes de configuração | `RESULTADOS.md` com números e recomendação de dimensionamento |

## 4. Fora do MVP (arquitetura já preparada)

Voz/microfone, chat, contas, moderador/expulsar/bloquear, senha/sala privada, gravação (LiveKit Egress, fora do caminho de baixa latência), histórico na UI, seleção manual de codec (VP9/AV1), escolha de qualidade pelo espectador, estatísticas avançadas, multi-região.

## 5. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| CPU de quem transmite em 1080p60/1440p por software | Detecção de encoder via `mediaCapabilities`; presets pesados desabilitados com motivo; adaptativo por `qualityLimitationReason=cpu` |
| Diferenças entre navegadores (áudio, `applyConstraints`) | Detecção em tempo de execução, nunca por user agent; matriz testada na Fase 3 |
| Docker Desktop no Windows com UDP | Faixa pequena de portas + `node_ip` em dev; produção em Linux com `network_mode: host` |
| Mudança de API/config do LiveKit | Versão fixada; `ISfuGateway` e `RoomClient` isolam o resto do código |
| Custo de banda (egress/TURN) | Simulcast, dynacast, adaptive stream; métricas de uso de TURN |
