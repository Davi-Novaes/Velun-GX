# Documento 5 — Infraestrutura

## 1. Serviços (Docker Compose)

| Serviço | Imagem | Portas públicas | Observações |
|---|---|---|---|
| `traefik` | `traefik:v3.7.13` | dev: 80 e 443 (certificado local) · prod: 80 → redireciona, **443** | TLS Let's Encrypt (prod); roteia `/`, `/api`, `/rtc` (WSS do SFU) |
| `frontend` | build próprio → `nginx:alpine` | — | Só arquivos estáticos do Vite, cache agressivo para assets com hash (Fase 2) |
| `backend` | build próprio → `mcr.microsoft.com/dotnet/aspnet:10.0` | — | Stateless, pode escalar horizontalmente |
| `postgres` | `postgres:18.6-alpine` | — | Volume persistente; migrations EF aplicadas no startup (dev) / job separado (prod) |
| `redis` | `redis:8.10.2-alpine` | — | Com senha, sem persistência. LiveKit (roteamento/estado), rate limit, locks de entrada |
| `livekit` | `livekit/livekit-server:v1.13.7` | **UDP 7882** (mux), TCP 7881 | Sinalização 7880 via Traefik (`/rtc`); mídia direta. IP interno fixo `172.30.0.10`. `network_mode: host` em produção Linux |
| `coturn` | `coturn/coturn:4.18.0-alpine` | 3478 UDP/TCP, 5349 TCP (TLS, prod), relay UDP 49160–49359 (dev) / 49152–65535 (prod) | `use-auth-secret`; relay só alcança o IP interno do SFU; `network_mode: host` em produção |
| `prometheus` | `prom/prometheus:v3.15.0` | só `127.0.0.1:9090` | Coleta backend, LiveKit, coturn (node-exporter e cAdvisor na Fase 8) |
| `grafana` | `grafana/grafana` | via Traefik com auth | Dashboards provisionados (Fase 8) |
| `node-exporter`, `cadvisor` | — | — | CPU/RAM/rede do host e por contêiner (Fase 8) |

Arquivos: `infra/docker-compose.yml` (dev local) e, na preparação para produção, `infra/docker-compose.prod.yml` (TLS, ACME, `network_mode: host`). Segredos em `infra/.env` (fora do git; `infra/.env.example` versionado; `infra/scripts/init-env.ps1` gera valores aleatórios). O LiveKit não interpola variáveis no YAML, então a config dele é gerada pelo próprio Compose (`configs.content`), e os segredos existem só no `.env`.

## 2. Roteamento

| Host / caminho | Destino | Protocolo |
|---|---|---|
| `https://{dominio}/` | frontend | HTTPS |
| `https://{dominio}/api/*` (exceto `/api/v1/webhooks`) | backend | HTTPS |
| `wss://{dominio}/rtc` | livekit:7880 | WSS (sinalização) |
| `{dominio}` UDP 7882, TCP 7881 | livekit (direto, sem proxy) | SRTP |
| `{dominio}` 3478 / 5349 | coturn (direto) | STUN/TURN |

Não expostos no proxy: `/health/*`, `/metrics`, `/api/v1/webhooks/*` (coberto por teste automatizado).

**Sinalização na mesma origem** (`/rtc`) em vez de um subdomínio `sfu.*`: um certificado, um host, CSP `connect-src 'self'`, sem CORS. Como o `join` devolve `sfu.url`, basta configurar `LIVEKIT_PUBLIC_URL` para apontar para outro host/região quando houver vários SFUs — o contrato não muda.

Mídia **nunca** passa pelo Traefik: proxy HTTP em cima de RTP só adicionaria latência.

## 3. SFU — configuração LiveKit

Fonte da verdade: bloco `configs.livekit_config` em `infra/docker-compose.yml`. Pontos principais:

| Chave | Valor | Por quê |
|---|---|---|
| `rtc.udp_port` | `7882` | **UDP mux**: toda a mídia numa porta só. Firewall simples, Docker Desktop leve. Em produção, uma faixa pequena (ex.: `7882-7889`, ≥ nº de vCPUs) |
| `rtc.tcp_port` | `7881` | ICE/TCP antes de recorrer ao TURN |
| `rtc.node_ip` / `use_external_ip` | IP da LAN (dev) / descoberta via STUN (prod) | IP que o navegador usa para chegar ao SFU |
| `rtc.advertise_internal_ip` | `true` | Também anuncia o IP interno, por onde o relay do coturn chega ao SFU (ver §4) |
| `rtc.stun_servers` / `turn_servers` | coturn próprio, credenciais efêmeras (`secret`, TTL 1 h) | Nenhuma dependência de STUN público; credenciais nunca no frontend |
| `rtc.congestion_control.allow_pause` | `true` | Pausa o vídeo de um assinante sem banda em vez de degradar todo mundo |
| `room.auto_create` | `false` | **Só o backend cria salas**: token para sala inexistente é recusado pelo SFU |
| `room.max_participants` | `20` | Limite rígido (o backend também checa) |
| `room.empty_timeout` / `departure_timeout` | 300 s / 20 s | Sala some 5 min após esvaziar; quem cai tem 20 s para voltar |
| `room.enabled_codecs` | VP8, H.264, VP9, AV1, Opus, RED | O codec em uso é escolhido pelo cliente (Documento 1, §6) |
| `webhook` | `http://backend:8080/api/v1/webhooks/livekit` | Assinado com a chave da API; validado pelo backend |
| `prometheus.port` | `6789` | Métricas do SFU |

## 4. TURN / NAT traversal

Observação importante: como toda mídia vai **cliente → SFU** (e não cliente → cliente), o SFU com IP público já resolve NAT doméstico, CGNAT e a maioria das redes móveis — o cliente inicia a conexão de dentro do NAT. TURN só é necessário quando **UDP de saída está bloqueado** ou só a porta 443 é liberada (redes corporativas, alguns hotéis/escolas).

Ordem de tentativa (automática pelo ICE, `iceTransportPolicy: 'all'`):

1. UDP direto ao SFU → caso normal, menor latência.
2. TCP 7881 direto ao SFU → UDP bloqueado.
3. TURN/UDP 3478 → TURN/TCP 3478 → **TURN/TLS 5349 (ou 443 num IP dedicado)** → passa por quase qualquer firewall/proxy.

Como mantemos o custo baixo:
- TURN só é usado quando os caminhos 1 e 2 falham (o ICE prefere candidatos diretos).
- Credenciais efêmeras (HMAC de `TURN_SECRET`, TTL 1 h) — ninguém pode reutilizar o TURN como relay público.
- coturn: `no-multicast-peers`, `denied-peer-ip` para faixas privadas, `allowed-peer-ip` **só para o IP interno do SFU** (impede usar o TURN para atacar a rede interna), `user-quota`, `total-quota`, `max-bps`.
- Métrica `candidateType=relay` na telemetria mostra a % de sessões que precisou de TURN.

**Relay → SFU pelo endereço interno.** Quando coturn e SFU estão no mesmo servidor, eles anunciam o mesmo IP externo. O coturn trata "destino = meu próprio IP externo" como ele mesmo, e o relay falha. Por isso o LiveKit também anuncia o IP interno (`advertise_internal_ip`), e o coturn só pode encaminhar para esse IP. Em dev ele é `172.30.0.10`, fixo na rede Docker. Em produção é o IP privado do servidor.

Validação da Fase 1 com `turnutils_uclient`:

| Caso | Resultado |
|---|---|
| Credencial efêmera válida, relay até o SFU | alocação ok, 0% de perda |
| Segredo errado | alocação recusada |
| Relay para outro IP privado | 403 |

Validação da Fase 3 com navegador real (E2E): com `iceTransportPolicy: relay` a mídia chega e o par ICE escolhido termina no IP interno do SFU (172.30.0.10:7882). Sem forçar, o navegador vai direto ao SFU (192.168.1.7:7882) e o TURN não é usado — "TURN só quando necessário" funciona. O candidato local aparece como `prflx` e não `relay` porque o coturn anuncia o IP externo mas fala com o SFU pelo interno; continua sendo tráfego pelo TURN.

**Dimensionamento de portas de relay.** Com a política normal (`all`) o navegador reserva alocações TURN mesmo quando usa o caminho direto: até 4 por participante (conexão de publicação + de assinatura × UDP e TCP), mantidas enquanto ele está na sala. Alocações de navegadores fechados sem encerrar só voltam quando expiram (`max-allocate-lifetime=300`). Regra prática: portas de relay ≥ 4 × participantes simultâneos + folga. 10 salas × 20 = 800 portas; produção usa 49152–65535. Em dev, 200 portas (faixas grandes deixam o Docker Desktop lento). Esgotamento aparece no log do coturn como `no available ports`.

**Diagnóstico "forçar TURN".** `localStorage["ss:forceRelay"] = "1"` no navegador faz a mídia passar só pelo TURN — útil para reproduzir problemas de redes corporativas.

## 5. Redis — uso

| Chave | Uso | TTL |
|---|---|---|
| (interno do LiveKit) | Roteamento de salas entre nós, estado | — |
| `rl:{política}:{chave}` | Rate limiting distribuído (janela deslizante) | janela |
| `lock:room:{id}:join` | Serializa entradas para o limite de 20 | 5 s |

## 6. PostgreSQL

Um banco `screenshare`; usuário da aplicação sem privilégio de DDL em produção (migrations por job próprio). Backup diário via `pg_dump` (prod). Carga esperada é pequena (escritas por entrada/saída/track, não por pacote).

## 7. Desenvolvimento local no Windows (Docker Desktop)

- `network_mode: host` não funciona igual no Docker Desktop. Em dev: UDP mux numa porta só (`7882/udp`) e `rtc.node_ip` = IP da máquina na LAN (detectado pelo `init-env.ps1`), para que outros dispositivos da rede consigam conectar.
- Dev atende em HTTP (80) e HTTPS (443). `http://localhost` já é contexto seguro; para outros dispositivos da rede é obrigatório HTTPS (`getDisplayMedia` exige contexto seguro). `infra/scripts/dev-cert.ps1` gera uma CA local e um certificado para `localhost`, o IP da LAN e `screenshare.test` (openssl dentro de um container). O script não instala a CA em nenhum repositório de confiança: o navegador avisa na primeira visita, ou importe `infra/certs/dev-ca.crt` manualmente nos seus dispositivos de teste.
- Firewall do Windows: para outros dispositivos alcançarem a máquina de dev, as portas 443/tcp, 7881/tcp, 7882/udp, 3478 e a faixa de relay precisam estar liberadas para a rede privada.
- Rate limit por IP: testes E2E e de carga saem todos do mesmo IP. `RATE_LIMIT_*` no `.env` sobrescreve os limites de produção em dev.
- `getDisplayMedia` exige contexto seguro: `http://localhost` funciona na própria máquina; para testar de outro PC/celular na LAN, usar HTTPS com certificado local (**mkcert**) e um host tipo `screenshare.test` apontando para o IP da máquina.
- LiveKit em modo `--dev` só para testes rápidos; o compose usa a config real com chaves do `.env`.

## 8. Observabilidade

### Logs estruturados (Serilog JSON → stdout; LiveKit e coturn também em JSON)

Todo evento com `roomId`, `participantId`, `identity`, `traceId`:

| Evento | Origem |
|---|---|
| `room.created` | BE |
| `participant.join_requested` / `participant.join_rejected{reason}` | BE |
| `participant.joined` / `participant.left{reason}` | BE (webhook) |
| `sfu.connected` / `sfu.disconnected` / `sfu.reconnecting{level,attempt}` / `sfu.reconnected` | FE → telemetria |
| `webrtc.error{stage,name,message}` | FE → telemetria |
| `share.started{codec,w,h,fps,audio}` / `share.stopped` | FE + BE (webhook) |
| `quality.changed{from,to,reason}` | FE → telemetria |

Sem dados sensíveis nos logs (sem tokens, sem cookies; apelido só no evento de entrada).

### Métricas (Prometheus)

| Métrica | Fonte |
|---|---|
| `screenshare_rooms_active` | BE (webhooks) + `livekit_room_total` |
| `screenshare_participants_connected` | BE + `livekit_participant_total` |
| `screenshare_streams_active{source}` | BE (webhooks) + `livekit_track_published_total` |
| `screenshare_client_rtt_ms`, `_jitter_ms`, `_packet_loss_pct`, `_bitrate_kbps`, `_fps` (histogramas) | Telemetria do FE |
| `screenshare_client_candidate_type_total{type}` | Telemetria (uso de TURN) |
| Pacotes/bytes/NACK/PLI do SFU | LiveKit `/metrics` |
| CPU, memória, rede | node-exporter + cAdvisor |
| Alocações/sessões TURN | coturn prometheus |

Dashboard Grafana "Sala ao vivo" + "SFU" provisionado por arquivo.

## 9. Escalabilidade

| Etapa | O que muda | Já preparado por |
|---|---|---|
| 50–100 usuários por sala | Só configuração (`max_participants`, `rooms.max_participants`). Gargalo é **egress** do nó: 99 × 3,5 Mbps ≈ 350 Mbps | Simulcast + adaptive stream reduzem o egress real |
| Múltiplas salas | Nada: salas são independentes | — |
| Múltiplos nós do SFU | Subir mais instâncias LiveKit apontando para o mesmo Redis; LiveKit distribui salas entre nós | Redis desde o MVP; backend fala com LiveKit por URL/API, não por IP de nó |
| Backend replicado | Mais réplicas atrás do Traefik | Stateless; sessão em cookie JWT; rate limit/lock no Redis |
| Regiões | Um cluster LiveKit + TURN por região; backend escolhe a URL do SFU no `join` | `sfu.url` já vem no contrato do `join` |
| TURN | Vários coturn com o mesmo `TURN_SECRET` atrás de DNS | Credenciais efêmeras stateless |
| Limite prático | Uma sala vive num único nó no LiveKit OSS. Para milhares de espectadores de uma mesma sala: relay entre nós (não OSS) ou saída HLS (latência alta) — fora do escopo | — |

Estimativa de dimensionamento (1 transmissão 1080p30 por sala, espectadores recebendo a camada alta):

| Cenário | Egress do SFU | CPU esperada do SFU* |
|---|---|---|
| 1 sala × 20 | ~70 Mbps | < 1 vCPU |
| 5 salas × 20 | ~350 Mbps | ~1–2 vCPU |
| 10 salas × 20 | ~700 Mbps | ~2–4 vCPU |

\* A validar na Fase 8. Rede tende a ser o limite antes de CPU: um servidor com 1 Gbps comporta ~10 salas nesse perfil.

## 10. Segurança operacional

- Traefik: HSTS, redirect 80→443, TLS 1.2+, headers de segurança; CSP `default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:`.
- Apenas 443, faixa UDP do SFU, 7881, portas do TURN e 80 (ACME) expostas no firewall do host.
- Postgres, Redis, APIs do LiveKit, `/metrics`, Prometheus: **só rede interna** do Docker.
- Segredos via `.env`/secrets do Docker; nunca no bundle nem no git.
