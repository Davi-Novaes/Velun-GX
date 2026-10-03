# Documento 4 — APIs e contratos

Base: `https://{dominio}/api/v1`. JSON UTF-8, camelCase. Erros em **RFC 7807 ProblemDetails** com campo `code` estável:

```json
{ "type": "about:blank#room-full", "title": "Sala cheia", "status": 409,
  "code": "ROOM_FULL", "detail": "A sala atingiu o limite de 20 participantes." }
```

Códigos: `ROOM_NOT_FOUND` 404, `ROOM_EXPIRED` 410, `ROOM_FULL` 409, `ROOM_BUSY` 503 (lock da sala não obtido em 3 s), `VALIDATION_FAILED` 422, `FORBIDDEN` 403, `CROSS_ORIGIN_FORBIDDEN` 403, `UNAUTHENTICATED` 401, `RATE_LIMITED` 429 (com `Retry-After`), `SFU_UNAVAILABLE` 503.

Rate limits configuráveis em `RateLimits:{política}` (appsettings / variáveis de ambiente), contados no Redis (valem para todas as réplicas). Se o Redis cair, o limitador deixa passar e registra aviso.

## Autenticação

- **Sessão de convidado**: `POST /sessions` gera cookie `ss_session` (JWT HS256 assinado pelo backend, 12 h, deslizante), `HttpOnly; Secure; SameSite=Strict; Path=/api`. Sem nome — o apelido é informado por sala.
- **CSRF**: `SameSite=Strict` + verificação de `Origin` em toda requisição que altera estado (Origin diferente do host → 403 `CROSS_ORIGIN_FORBIDDEN`). O atributo `Secure` do cookie é configurável só para dev em HTTP (`Session:SecureCookie`).
- **Token do SFU**: devolvido no corpo do `join`, vive só em memória no FE (nunca em `localStorage`).

## Endpoints

### `POST /sessions`
Cria sessão de convidado (201) ou, se já houver uma válida, renova o cookie mantendo o mesmo convidado (200). Rate limit: 10/min por IP.
```json
201 { "guestId": "0192...", "expiresAt": "2026-09-30T02:00:00Z" }
```

### `GET /sessions/current`
Requer sessão. `200 { "guestId": "..." }`.

### `POST /rooms`
Requer sessão. Rate limit: 5/min por sessão, 30/h por IP.
```json
request  {}                      // futuro: { "name": "...", "password": "..." }
201      { "code": "K7F3QX9M", "url": "https://{dominio}/room/K7F3QX9M",
           "maxParticipants": 20, "createdAt": "...", "expiresAt": "..." }
```

### `GET /rooms/{code}`
Público, rate limit 60/min por IP. Usado na tela de pré-entrada.
```json
200 { "code": "K7F3QX9M", "status": "active", "participantCount": 8,
      "maxParticipants": 20, "isFull": false }
404 ROOM_NOT_FOUND   410 ROOM_EXPIRED
```

### `POST /rooms/{code}/join`
Requer sessão. Rate limit: 30/min por sessão.

**Ocupação** = participantes conectados segundo o SFU ∪ tokens emitidos há menos de 60 s que ainda não conectaram (reservas). Só o SFU não basta: quem acabou de receber o token ainda não aparece nele. A checagem roda sob lock Redis por sala; o `max_participants` do SFU segue como limite rígido. Reconexão com `participantId` (do mesmo convidado) reaproveita a própria vaga.
```json
request {
  "displayName": "Maria",                 // 1..32, trim, sem caracteres de controle, NFC
  "participantId": null                   // preenchido na reconexão (nível 3) para reusar a identidade
}
200 {
  "participant": { "id": "0192...", "identity": "p_0192...", "displayName": "Maria", "role": "member" },
  "sfu": { "url": "wss://{dominio}", "token": "eyJ...", "expiresAt": "..." },
  "policy": {
    "maxParticipants": 20,
    "allowedSources": ["screen_share", "screen_share_audio"],
    "maxConcurrentScreenShares": 3,
    "video": { "maxWidth": 3840, "maxHeight": 2160, "maxFps": 60, "maxBitrateKbps": 16000,
               "preferredCodec": "vp8", "allowHardwareH264": true },
    "audio": { "enabled": true, "maxBitrateKbps": 96 }
  }
}
409 ROOM_FULL   404 ROOM_NOT_FOUND   410 ROOM_EXPIRED   422 VALIDATION_FAILED   403 FORBIDDEN (participantId de outro convidado)
429 RATE_LIMITED   503 ROOM_BUSY | SFU_UNAVAILABLE
```

### `POST /rooms/{code}/leave`
Requer sessão. Melhor esforço (aceita `sendBeacon`). `{ "participantId": "..." }` → `204`. Libera na hora uma reserva que ainda não conectou; para quem já conectou, a fonte da verdade é o webhook `participant_left`.

### `POST /telemetry/webrtc`
Requer sessão. Lotes a cada 10 s, amostrados; alimenta métricas (Documento 5). Rate limit: 12/min por sessão.
```json
{
  "participantId": "...",
  "samples": [{
    "ts": 1790000000000, "direction": "outbound|inbound", "kind": "video|audio",
    "rttMs": 38, "jitterMs": 4.1, "packetLossPct": 0.2, "bitrateKbps": 4800,
    "fps": 30, "width": 1920, "height": 1080, "codec": "VP8",
    "qualityLimitation": "none|bandwidth|cpu", "candidateType": "host|srflx|relay",
    "avSyncMs": 12
  }],
  "events": [{ "ts": 1790000000000, "type": "quality_changed",
               "data": { "from": "1080p30", "to": "720p30", "reason": "bandwidth" } }]
}
→ 202
```

### `POST /webhooks/livekit`
Chamado só pelo LiveKit (rede interna). Validação: header `Authorization` é um JWT assinado com o `LIVEKIT_API_SECRET` cujo claim `sha256` bate com o hash do corpo; senão `401`. Eventos tratados: `room_started`, `room_finished`, `participant_joined`, `participant_left`, `track_published`, `track_unpublished`. Idempotente.

### Operacionais (não expostos pelo proxy público)
`GET /health/live`, `GET /health/ready` (Postgres, Redis, LiveKit), `GET /metrics` (Prometheus).

## Contrato Backend → SFU

Interface no backend (isola o LiveKit):

```csharp
public interface ISfuGateway
{
    Task EnsureRoomAsync(RoomId room, int maxParticipants, CancellationToken ct);
    Task<IReadOnlyList<SfuParticipant>> ListParticipantsAsync(RoomId room, CancellationToken ct);
    Task RemoveParticipantAsync(RoomId room, string identity, CancellationToken ct);   // futuro: expulsar
    SfuAccessToken CreateAccessToken(RoomId room, ParticipantIdentity who, string displayName, MediaPolicy policy);
}
```

Implementação `LiveKitGateway`: Twirp (`POST http://livekit:7880/twirp/livekit.RoomService/CreateRoom`, `ListParticipants`, `RemoveParticipant`) autenticado por JWT de serviço com grant `roomCreate`/`roomAdmin`.

### Claims do token do participante

```json
{
  "iss": "<LIVEKIT_API_KEY>",
  "sub": "p_0192...",                  // identity
  "name": "Maria",
  "nbf": 1790000000, "exp": 1790000600, // 10 min para conectar; o LiveKit renova enquanto conectado
  "metadata": "{\"role\":\"member\",\"participantId\":\"0192...\"}",
  "video": {
    "room": "<rooms.id>",
    "roomJoin": true,
    "canSubscribe": true,
    "canPublish": true,
    "canPublishSources": ["screen_share", "screen_share_audio"],   // + "microphone" quando houver voz
    "canPublishData": true,
    "canUpdateOwnMetadata": false
  }
}
```

## Contrato Frontend ↔ SFU

Protocolo do LiveKit (protobuf sobre WSS), encapsulado pelo `livekit-client`. Convenções da aplicação por cima dele:

| Item | Convenção |
|---|---|
| Nome da sala | `rooms.id` (UUID) — o código público nunca vai ao SFU |
| Identidade | `p_<participantId>` |
| Sources | `screen_share`, `screen_share_audio` (MVP); `microphone`, `camera` (futuro) |
| Track name | `screen:<shareId>` e `screen-audio:<shareId>` — agrupa áudio e vídeo do mesmo share, permitindo múltiplos shares |
| Data channel | tópico `app.v1`, JSON `{ "type": "...", ... }` — reservado; no MVP sem mensagens obrigatórias |

## Contrato interno do frontend (`RoomClient`)

A UI só depende disto (facilita teste e troca de SFU):

```ts
interface RoomClient {
  connect(join: JoinResponse): Promise<void>;
  disconnect(): Promise<void>;
  startScreenShare(opts: ShareOptions): Promise<ShareResult>;   // ShareResult diz se veio áudio, displaySurface, w×h, fps
  stopScreenShare(): Promise<void>;
  setShareAudioEnabled(enabled: boolean): Promise<void>;
  setQuality(preset: QualityPreset): Promise<AppliedQuality>;
  getCapabilities(): Promise<MediaCapabilitiesReport>;
  on<E extends keyof RoomEvents>(e: E, h: RoomEvents[E]): Unsubscribe;
}

type RoomEvents = {
  connectionStateChanged: (s: 'connecting'|'connected'|'reconnecting'|'retrying'|'failed', attempt?: number) => void;
  participantsChanged: (p: ParticipantView[]) => void;   // inclui status: watching|sharing|reconnecting|disconnected
  sharesChanged: (s: ShareView[]) => void;               // cada share tem videoTrack e audioTrack? separados
  statsUpdated: (s: StatsSnapshot) => void;              // RTT, jitter, perda, bitrate, fps, resolução, A/V sync, nível 🟢🟡🔴
  qualityChanged: (q: AppliedQuality, reason: 'user'|'bandwidth'|'cpu'|'recovered') => void;
  error: (e: AppError) => void;
};
```

## Indicador de conexão (regra)

| Nível | Condição (janela de 5 s; pior entre medida própria e `ConnectionQuality` do LiveKit) |
|---|---|
| 🟢 Excelente | RTT < 100 ms **e** perda < 1 % **e** jitter < 30 ms |
| 🟡 Instável | RTT 100–250 ms **ou** perda 1–5 % **ou** jitter 30–60 ms **ou** `qualityLimitation` ≠ none |
| 🔴 Ruim | RTT > 250 ms **ou** perda > 5 % **ou** congelamento > 1 s |
