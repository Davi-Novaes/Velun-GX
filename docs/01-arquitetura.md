# Documento 1 — Arquitetura

> Status: **proposta, aguardando aprovação**. Nenhum código foi escrito ainda.

## 1. Resumo das decisões

| Tema | Decisão | Motivo curto |
|---|---|---|
| Transporte de mídia | WebRTC (UDP, SRTP) | Único padrão de navegador com latência abaixo de 300 ms sem plugin |
| Topologia | **SFU** (sem mesh P2P) | Quem transmite envia 1 stream, independente de quantos assistem |
| SFU | **LiveKit** (self-hosted, OSS, Apache 2.0) | Simulcast + congestion control por assinante + SDK maduro + protocolo de sinalização pronto |
| Sinalização WebRTC | WebSocket do próprio LiveKit (WSS) | Já resolve SDP, ICE trickle, publish/subscribe e resume |
| Sinalização da aplicação | REST (HTTPS) + webhooks do LiveKit | Sem SignalR no MVP: nada que o LiveKit não entregue já |
| Backend | .NET 10 (LTS) + ASP.NET Core Minimal APIs | Pedido do projeto; LTS atual; já instalado |
| Frontend | React 19 + TypeScript + Vite + `livekit-client` | SPA leve, SDK oficial, sem SSR (não precisa) |
| Banco | PostgreSQL 18 + EF Core (Npgsql) | Salas, participantes, histórico de streams |
| Cache / coordenação | Redis 8 | Obrigatório para LiveKit multi-nó; rate limit distribuído; lock de entrada |
| TURN | **coturn** com credenciais efêmeras (segredo compartilhado com o LiveKit) | Fallback para redes restritivas; nunca expõe credencial fixa |
| Reverse proxy / HTTPS | **Traefik v3** + Let's Encrypt | TLS automático, roteamento por labels Docker, proxy de WebSocket |
| Codec de vídeo | **VP8 com simulcast** (padrão); H.264 quando há encoder de hardware (fase 5) | Compatibilidade total e latência baixa; ver §6 |
| Codec de áudio | **Opus** estéreo, sem DTX, com RED | Tempo real, resistente a perda |
| Observabilidade | Serilog (JSON) + OpenTelemetry → Prometheus + Grafana | Métricas do LiveKit, coturn, backend e cliente num só lugar |

## 2. Diagrama geral

```text
                                INTERNET
                                   │
            ┌──────────────────────┼─────────────────────────────┐
            │ HTTPS/WSS :443       │ UDP 7882 (mídia, mux)       │ TURN 3478 UDP/TCP
            │                      │ TCP 7881 (ICE/TCP fallback) │ TURN/TLS 5349 (ou 443 em IP dedicado)
            ▼                      │                             ▼
     ┌──────────────┐              │                      ┌────────────┐
     │   Traefik    │              │                      │   coturn   │
     │ TLS + roteam.│              │                      │  (relay)   │
     └──┬────┬────┬─┘              │                      └─────┬──────┘
        │    │    │ wss://*/rtc     │                            │ relay → SFU
        │    │    └────────────────┼──────────┐                 │
  /     │    │ /api                ▼          ▼                 │
        ▼    ▼                  ┌──────────────────┐            │
 ┌──────────┐ ┌──────────────┐  │     LiveKit      │◄───────────┘
 │ Frontend │ │   Backend    │  │      (SFU)       │
 │ (nginx   │ │ ASP.NET Core │──┤ Twirp API :7880  │  ← backend cria salas, lista
 │  static) │ │              │◄─┤ Webhooks         │     participantes, gera tokens
 └──────────┘ └──┬────────┬──┘  └────────┬─────────┘
                 │        │              │
          ┌──────▼──┐  ┌──▼────┐         │ (roteamento multi-nó, estado)
          │Postgres │  │ Redis │◄────────┘
          └─────────┘  └───────┘

        Navegadores (até 20 por sala)
   ┌────────┐  ┌────────┐  ┌────────┐
   │ User 1 │  │ User 2 │  │ User N │
   │ publica│  │ assiste│  │ assiste│
   └───┬────┘  └───┬────┘  └───┬────┘
       │  1 upload │  N-1 downloads encaminhados (sem transcodificação)
       └───────────┴───────────┴──────► LiveKit (WebRTC: SRTP/UDP)
```

Três canais distintos, com responsabilidades que não se misturam:

1. **App ⇄ Backend (HTTPS REST)**: sessão, sala, entrada, token, telemetria.
2. **App ⇄ SFU (WSS + WebRTC)**: sinalização (SDP/ICE) pelo WebSocket do LiveKit; mídia por UDP direto (ou TURN).
3. **Backend ⇄ SFU (HTTP)**: API de servidor (criar sala, listar/remover participante) e webhooks (entrou, saiu, publicou track).

O backend **nunca** fica no caminho da mídia. Isso é o que mantém a latência baixa e o backend barato.

## 3. Por que SFU, e não P2P

Numa sala com 20 pessoas e 1 transmissor em 1080p30 (~3,5 Mbps):

| Topologia | Upload do transmissor | Conexões no transmissor |
|---|---|---|
| Mesh P2P | 19 × 3,5 = **~66 Mbps** + 19 encodes | 19 PeerConnections |
| SFU | 3,5 + 0,5 (camada baixa) = **~4 Mbps**, 1 encode | 1 (+1 de recepção) |

Mesh é inviável em conexão doméstica. Com SFU, o custo de banda vai para o servidor (egress ≈ 19 × bitrate da camada que cada um recebe), que é onde ele deve estar.

## 4. Escolha do SFU: LiveKit

### Comparação

| Critério | **LiveKit** | mediasoup | Janus | Jitsi (JVB) |
|---|---|---|---|---|
| Latência | Excelente (Go/Pion, forwarding puro) | Excelente (C++ worker) | Excelente (C) | Boa |
| Simulcast / SVC | Nativo, com seleção por assinante | Nativo, mas a lógica de seleção é sua | Suportado, mais manual | Nativo |
| Congestion control por assinante | **Sim** (stream allocator + TWCC) | Parcial, você implementa a política | Básico | Sim |
| Sinalização pronta | **Sim** (protocolo + SDK) | Não, você escreve tudo | Plugins + API JSON própria | Acoplada ao Jitsi Meet |
| SDK cliente | Oficial JS/TS, reconexão/resume embutidos | Só `mediasoup-client` (baixo nível) | `janus.js` (antigo) | lib-jitsi-meet (acoplada) |
| Integração com .NET | Token = JWT HS256 comum; API Twirp/JSON; webhooks assinados | Precisa de um servidor Node no meio | API HTTP/WS | Difícil |
| Multi-nó | Sim, com Redis | Você constrói | Você constrói | Octo/relays |
| Self-hosting | Binário/Docker único | Lib dentro do seu Node | Sim | Pilha grande (prosody, jicofo, jvb) |
| Voz futura | Mesma sala, mesmo token, só mais uma `source` | Você constrói | Plugin AudioBridge/VideoRoom | Sim |
| Documentação | Muito boa | Boa, técnica | Razoável | Razoável para customização |

### Decisão

**LiveKit**. O motivo principal: as partes difíceis de baixa latência com 20 assinantes heterogêneos — escolher a camada de simulcast certa para cada um, reagir a congestionamento do lado do receptor sem afetar os outros, pedir keyframe na troca de camada, pausar camadas que ninguém assiste (*dynacast*), resume de ICE — já existem e já foram testadas em produção. Com mediasoup teríamos a mesma latência, mas escreveríamos tudo isso (e a sinalização) à mão, num servidor Node extra entre o .NET e o SFU.

Riscos aceitos:
- **Protocolo proprietário do LiveKit** (protobuf sobre WSS): isolado atrás de um módulo `media/` no frontend e de uma interface `ISfuGateway` no backend. Trocar de SFU é caro, mas localizado.
- **Sem SDK .NET oficial de servidor**: o token é JWT padrão (`System.IdentityModel.Tokens.Jwt`) e a API é HTTP/JSON (Twirp). Escrevemos um cliente pequeno e tipado (~200 linhas) em vez de depender de pacote comunitário.
- **Uma sala vive num nó só** (LiveKit OSS): suficiente para 20–100 participantes; ver Documento 5, §Escalabilidade.

## 5. Componentes e responsabilidades

### Frontend (SPA)

| Módulo | Responsabilidade |
|---|---|
| `pages/Home` | Criar sala, exibir link, copiar |
| `pages/Room` (PreJoin → Connecting → InRoom) | Pedir apelido, conectar, sala |
| `api/` | Cliente HTTP tipado dos contratos do Documento 4 |
| `media/RoomClient` | **Única** camada que conversa com `livekit-client`. Expõe eventos de domínio (participante entrou, share começou, qualidade mudou). A UI nunca importa `livekit-client` diretamente |
| `media/ScreenShareController` | `getDisplayMedia`, detecção de áudio, publish/unpublish de **tracks separadas** de vídeo e áudio |
| `media/Capabilities` | Detecta suporte a getDisplayMedia, áudio, codecs, encoder de hardware, resolução da fonte |
| `media/QualityController` | Presets de resolução/FPS/bitrate, `applyConstraints`, `setParameters`, controlador adaptativo |
| `media/StatsCollector` | `getStats()` periódico → RTT, jitter, perda, bitrate, FPS, resolução, A/V sync |
| `media/ReconnectManager` | Estado de reconexão, tentativas 1/3, re-publicação sem novo seletor de tela |
| `features/*` | UI: participantes, palco, controles, indicador de conexão, diagnóstico, diálogo de share |
| `store/` (Zustand) | Estado da sala derivado dos eventos do `RoomClient` |

### Backend (ASP.NET Core)

| Camada | Conteúdo |
|---|---|
| `Api` | Endpoints, validação, ProblemDetails, rate limiting, auth por cookie, webhook do LiveKit |
| `Application` | Casos de uso: `CreateRoom`, `JoinRoom`, `LeaveRoom`, `HandleSfuEvent`, `ExpireRooms` |
| `Domain` | `Room`, `Guest`, `Participant`, `StreamSession`, regras (limite, expiração, papéis, política de mídia) |
| `Infrastructure` | EF Core/Postgres, Redis (lock, rate limit), `LiveKitGateway : ISfuGateway` (token + Twirp), `TurnConfig` |

Responsabilidades pedidas × onde ficam: autenticação (sessão de convidado por cookie), criação/gerência de salas, usuários (convidados), permissões (grants no token + papéis), geração de tokens (LiveKit JWT), controle de participantes (limite, remoção via API do SFU), integração com o SFU (`ISfuGateway`), configurações da transmissão (política de mídia devolvida no join). Sinalização WebRTC **não** passa pelo backend.

### SFU (LiveKit)

Recebe os streams WebRTC, encaminha pacotes RTP sem decodificar, escolhe camada de simulcast por assinante, faz controle de congestionamento de saída por assinante, NACK/RTX/PLI, ICE (inclusive ICE/TCP), resume de sessão, aplica `max_participants` como limite rígido, emite webhooks e métricas Prometheus.

### Infraestrutura

Traefik, Postgres, Redis, LiveKit, coturn, Prometheus, Grafana — tudo em Docker Compose (Documento 5).

## 6. Codec

### Opções avaliadas para compartilhamento de tela

| Codec | Compatibilidade | Latência / CPU | Qualidade em tela (texto) | Simulcast/SVC | Veredito |
|---|---|---|---|---|---|
| **VP8** | Chrome, Edge, Firefox, Safari | Encode rápido; hardware em parte das GPUs Intel | Boa | Simulcast maduro em todos | **Padrão** |
| **H.264** | Todos (Firefox via OpenH264) | Melhor com encoder de hardware (quase todo PC/Mac) | Boa | Simulcast ok no Chrome; Firefox tem ressalvas | **Preferido quando há HW** (fase 5) |
| VP9 | Chrome, Edge, Firefox; Safari parcial | Encode por software pesado em 1080p60 | Muito boa (ferramentas de conteúdo de tela) | SVC excelente no Chrome | Futuro, atrás de flag |
| AV1 | Chrome/Edge recentes; Firefox decode; Safari só com HW | Encode por software caro; HW só em GPUs recentes | Excelente | SVC | **Não** como padrão |

### Decisão

1. **Padrão: VP8 + simulcast (2 camadas para tela)**. Funciona em todos os navegadores-alvo, a troca de camada no SFU é instantânea (sem transcodificação), o encode é barato o bastante para 1080p30 em notebook comum.
2. **Fase 5: H.264 automático quando `navigator.mediaCapabilities.encodingInfo({type:'webrtc'})` reportar `powerEfficient: true`** (encoder de hardware) para a resolução/FPS escolhida — importante para 1440p/4K/60 FPS, onde encode por software aumenta latência e trava o PC de quem transmite. Publicado com **VP8 como `backupCodec`**, para que um espectador que não decodifique H.264 receba VP8.
3. **AV1/VP9**: não assumidos como melhores. Ficam como seleção avançada de codec (item "futuro" do requisito). AV1 dá melhor qualidade por bit, mas encode por software aumenta latência e CPU — o oposto da prioridade nº 1.

Áudio: **Opus** (único obrigatório no WebRTC), 48 kHz estéreo, 64–96 kbps, frames de 20 ms, **DTX desligado** (áudio de sistema/música não deve cortar em silêncio), **RED ligado** (redundância, tolera perda sem retransmissão).

## 7. Estratégia de baixa latência

Latência ponta a ponta = captura + encode + rede (up) + SFU + rede (down) + jitter buffer + decode + render. Ações por etapa:

| Etapa | Ação |
|---|---|
| Captura | `getDisplayMedia` nativo; sem canvas, sem processamento de frame em JS |
| Encode | Codec com encoder de hardware quando disponível; `contentHint` correto (`detail` para texto, `motion` para jogos) |
| Rede | UDP primeiro. ICE/TCP (7881) e TURN só como fallback. SFU com IP público e `network_mode: host` em produção (sem NAT do Docker) |
| SFU | Só encaminha RTP (sem transcodificação, gravação ou mixagem). Troca de camada com keyframe sob demanda |
| Perda | NACK/RTX para vídeo, RED para áudio; FEC não obrigatório. Nunca bufferizar "para garantir" |
| Receptor | `RTCRtpReceiver.jitterBufferTarget` baixo (Chrome) — deixa o jitter buffer adaptativo no mínimo; decode por hardware |
| Congestionamento | Sender reduz bitrate antes que filas cresçam (GCC/TWCC); SFU desce camada do receptor lento sem afetar os outros |
| Proibido | HLS/DASH/MSE, gravação, transcodificação, relay pelo backend |
| Geografia | SFU e TURN na região dos usuários. Cada 1.000 km ≈ +10 ms de RTT |

Meta: **< 150 ms** ponta a ponta na mesma região, **< 300 ms** aceitável. Medimos com o RTT das estatísticas WebRTC e, no teste E2E, com um relógio renderizado na tela compartilhada comparado ao relógio do espectador.

## 8. Estratégia de qualidade adaptativa

Três laços de controle, do mais rápido ao mais lento:

1. **Navegador de quem transmite (milissegundos)**: o controle de congestionamento do WebRTC ajusta o bitrate-alvo continuamente. `degradationPreference` decide o que sacrificar primeiro:
   - 15 FPS / 30 FPS (apresentação, texto) → `maintain-resolution` (texto legível, cai FPS)
   - 60 FPS (jogos, movimento) → `maintain-framerate` (fluidez, cai resolução)
   - Automático → `balanced`
2. **SFU por espectador (centenas de ms)**: cada espectador recebe a camada de simulcast que cabe na sua banda. Um espectador ruim não degrada os outros nem quem transmite. *Adaptive stream* do SDK pede camada menor quando o vídeo está pequeno na tela (ex.: miniatura).
3. **Controlador da aplicação (segundos)** — `QualityController`: a cada 2 s lê `outbound-rtp.qualityLimitationReason`, `availableOutgoingBitrate`, perda e RTT:
   - limitação por `bandwidth` ou `cpu` por ≥ 10 s → desce um degrau (60→30 FPS, depois resolução, depois bitrate)
   - condição boa por ≥ 30 s → sobe um degrau, **nunca acima do escolhido pelo usuário**
   - histerese para não oscilar; todo degrau é logado (`quality_changed`)
   - **não desconecta** por degradação: só a camada de transporte do SDK decide desconexão, e mesmo assim tenta resume/reconexão.

### Presets (teto de bitrate da camada alta)

| Resolução | 15 FPS | 30 FPS | 60 FPS |
|---|---|---|---|
| 360p (640×360) | 0,3 Mbps | 0,5 Mbps | 0,8 Mbps |
| 480p (854×480) | 0,5 Mbps | 0,8 Mbps | 1,2 Mbps |
| 720p | 1,0 Mbps | 1,8 Mbps | 3,0 Mbps |
| 1080p | 2,0 Mbps | 3,5 Mbps | 6,0 Mbps |
| 1440p* | 3,5 Mbps | 6,0 Mbps | 10 Mbps |
| 4K* | 6,0 Mbps | 10 Mbps | 16 Mbps |

\* Só aparecem se a fonte, o dispositivo e a política do servidor permitirem. Camada baixa do simulcast: 1/3 da resolução, 15 FPS, ~10–15% do bitrate.

**Automática** = menor entre (resolução da fonte, 1080p) a 30 FPS, rebaixado para 720p30 se o encoder não for `smooth` nessa resolução, com o laço 3 ativo.

### Detecção de capacidade (o que aparece no menu)

| Fonte de limite | Como detectar |
|---|---|
| Resolução da fonte | `track.getSettings()` / `getCapabilities()` depois da captura; antes, `screen.width × devicePixelRatio` como estimativa |
| Dispositivo (encoder) | `mediaCapabilities.encodingInfo({type:'webrtc', ...})` → `supported`, `smooth`, `powerEfficient`; fallback `hardwareConcurrency` |
| Navegador | presença de `getDisplayMedia`, `RTCRtpSender.getCapabilities('video').codecs`, suporte a `applyConstraints` em track de tela |
| Conexão | `availableOutgoingBitrate` do candidate-pair ativo; presets acima de ~80% dele ficam marcados "pode travar" |
| SFU | `policy` devolvida no join (max resolução/FPS/bitrate configurados no servidor) |

Opções impossíveis ficam **desabilitadas com o motivo** (ex.: "1440p — sua tela é 1920×1080"), não escondidas silenciosamente.

### Troca sem sair da sala e sem reabrir o seletor

- Resolução/FPS: `videoTrack.applyConstraints({ width:{max}, height:{max}, frameRate:{max} })` + `sender.setParameters()` (maxBitrate/maxFramerate por camada).
- Codec: exige republicar a **mesma** `MediaStreamTrack` (sem novo `getDisplayMedia`), ~1 s de transição.
- Firefox: `applyConstraints` em track de tela tem suporte parcial; fallback é limitar só via `setParameters` (`scaleResolutionDownBy`).

## 9. Áudio do compartilhamento (requisitos 36–41)

### Fato de plataforma que muda o desenho da UI

O navegador **não permite** que a página monte seu próprio seletor de "tela inteira / janela / aba": o seletor é nativo (segurança). Portanto:

1. Nosso diálogo "Compartilhar tela" mostra: **dica de tipo** (tela/janela/aba), **☑ Compartilhar áudio** (só se o navegador suportar) e **FPS/Qualidade** iniciais.
2. Chamamos `getDisplayMedia({ video: {...}, audio: querAudio ? {...} : false, systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' })` com `displaySurface` como **preferência** (Chrome/Edge a respeitam como item pré-selecionado; Firefox/Safari ignoram).
3. O seletor nativo abre. O usuário escolhe de fato ali (e o Chrome tem sua própria caixa "Compartilhar áudio").
4. Depois da captura, lemos a **verdade**: `videoTrack.getSettings().displaySurface` e `stream.getAudioTracks().length`. Se pediu áudio e não veio: "ⓘ O áudio não está disponível para este tipo de compartilhamento neste navegador." — e o vídeo segue normalmente.

### Matriz de suporte (verificada em tempo de execução, nunca assumida)

| Navegador / SO | Aba + áudio | Janela + áudio | Tela + áudio do sistema |
|---|---|---|---|
| Chrome / Edge — Windows | Sim | **Não** | Sim |
| Chrome / Edge — macOS | Sim | Não | Depende da versão do SO/navegador |
| Chrome / Edge — Linux | Sim | Não | Limitado |
| Firefox | — (sem áudio em getDisplayMedia) | Não | Não |
| Safari (macOS) | Sem opção de aba | Não | Não |
| Celular (iOS / Android) | Sem `getDisplayMedia` → **só assiste** | | |

### Tracks independentes

```text
getDisplayMedia ──► MediaStream
                     ├─ videoTrack ──► publish(source = screen_share)        ─┐
                     └─ audioTrack ──► publish(source = screen_share_audio)  ─┼─► SFU ─► assinantes
futuro: getUserMedia ─► micTrack   ──► publish(source = microphone)          ─┘
```

- Cada track é uma publicação separada no LiveKit, com `source` própria, podendo ser publicada, silenciada ou removida individualmente.
- "Desativar áudio" = `mute` da publicação de áudio (instantâneo, reversível). "Ativar áudio" depois de começar **sem** áudio exige nova captura (limitação do navegador); a UI explica.
- Espectador: volume e mudo **locais** por stream de áudio.
- Autoplay: vídeo toca mudo automaticamente; áudio pode exigir um clique ("Clique para ouvir") — política dos navegadores.
- Eco: `selfBrowserSurface: 'exclude'` impede compartilhar a própria aba da sala.

### Sincronização A/V

Vídeo e áudio publicados do mesmo `MediaStream` compartilham o grupo de sincronização (mesmo `msid`); o navegador do espectador sincroniza por RTCP Sender Reports, sem buffer extra. Monitoramos no diagnóstico: diferença entre `estimatedPlayoutTimestamp` das `inbound-rtp` de áudio e vídeo (Chrome) → "A/V Sync: OK" se |Δ| < 80 ms, "Atrasado" acima. Se o vídeo congela por perda, o áudio continua (prioriza continuidade) e ressincroniza ao próximo keyframe.

## 10. Preparação para voz (sem implementar)

- Tokens já usam `canPublishSources`: hoje `["screen_share","screen_share_audio"]`. Voz = adicionar `"microphone"` na política do backend.
- `RoomClient` modela `LocalMedia` como conjunto de tracks por `source`, não como "o stream".
- UI de participante já tem slot para indicador de fala/mudo.
- Nada de mixagem no servidor: voz será mais uma track Opus encaminhada pelo SFU.

## 11. Segurança (visão geral; detalhes nos Documentos 4 e 5)

- HTTPS/WSS obrigatório (e necessário: `getDisplayMedia` exige contexto seguro).
- Sessão de convidado: cookie `HttpOnly; Secure; SameSite=Strict`, JWT assinado pelo backend (12 h).
- Token do SFU: JWT curto (10 min para conectar; o LiveKit renova para quem já está conectado), preso a 1 sala, 1 identidade e às `sources` permitidas.
- `LIVEKIT_API_SECRET` e `TURN_SECRET` só existem em variáveis de ambiente do backend/LiveKit/coturn. Nunca no bundle JS.
- TURN com credenciais efêmeras (REST API do coturn, `use-auth-secret`), entregues pelo LiveKit na sinalização.
- Código de sala de 8 caracteres Crockford Base32 de CSPRNG (~10¹² combinações) — o link é a credencial de acesso no MVP, então precisa ser impossível de adivinhar.
- Limite de 20 em duas camadas: checagem no backend (com lock Redis por sala) + `max_participants` no LiveKit como limite rígido contra corrida.
- Rate limiting por IP e por sessão; webhooks do LiveKit validados por assinatura; validação de todo input; CSP, HSTS.

## 12. Compatibilidade de navegadores

| Recurso | Chrome/Edge | Firefox | Safari macOS | Celular |
|---|---|---|---|---|
| Assistir | Sim | Sim | Sim | Sim |
| Compartilhar tela | Sim | Sim | Sim (tela/janela) | **Não** (API ausente) |
| Aba do navegador | Sim | Não | Não | — |
| Áudio no share | Aba e tela (Windows) | Não | Não | — |
| `applyConstraints` em tela | Sim | Parcial | Parcial | — |
| `jitterBufferTarget` | Sim | Não (ignorado) | Não | — |

No celular o botão "Compartilhar tela" fica oculto com a explicação; a experiência de espectador é responsiva.
