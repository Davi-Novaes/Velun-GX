# Documento 3 — Banco de dados (PostgreSQL)

Princípio: o banco guarda **estado da aplicação e histórico**, não estado de tempo real. Quem está conectado *agora* é respondido pelo LiveKit; o banco é atualizado pelos webhooks.

## Diagrama

```mermaid
erDiagram
    GUESTS ||--o{ ROOMS : "cria (owner)"
    GUESTS ||--o{ PARTICIPANTS : "entra como"
    ROOMS  ||--o{ PARTICIPANTS : "tem"
    PARTICIPANTS ||--o{ STREAM_SESSIONS : "publica"
    ROOMS  ||--o{ STREAM_SESSIONS : "contém"

    GUESTS {
        uuid id PK
        timestamptz created_at
        timestamptz last_seen_at
        uuid account_id "NULL (futuro: contas)"
    }
    ROOMS {
        uuid id PK "também é o nome da sala no LiveKit"
        varchar code UK "8 chars Base32 Crockford, maiúsculo"
        varchar name "NULL"
        uuid owner_guest_id FK
        smallint max_participants "default 20, CHECK 1..100"
        varchar status "active | expired | closed"
        jsonb media_policy "teto de resolução/FPS/bitrate, sources permitidas, shares simultâneos"
        timestamptz created_at
        timestamptz last_activity_at
        timestamptz expires_at
    }
    PARTICIPANTS {
        uuid id PK
        uuid room_id FK
        uuid guest_id FK
        varchar identity UK "p_<uuid> — identidade no LiveKit"
        varchar display_name "1..32 chars, snapshot"
        varchar role "owner | member (futuro: moderator)"
        varchar status "joining | connected | disconnected"
        varchar sfu_sid "sessão atual no SFU; eventos de sessões antigas são ignorados"
        timestamptz joined_at
        timestamptz connected_at
        timestamptz left_at
        varchar leave_reason "client_leave | timeout | kicked | duplicate_identity | ..."
        smallint reconnect_count
    }
    STREAM_SESSIONS {
        uuid id PK
        uuid room_id FK
        uuid participant_id FK
        varchar track_sid "id da track no LiveKit"
        varchar source "screen_share | screen_share_audio | microphone | camera"
        varchar kind "video | audio"
        varchar codec
        int width
        int height
        timestamptz started_at
        timestamptz ended_at
    }
```

## Índices e restrições

| Tabela | Índice / restrição | Uso |
|---|---|---|
| rooms | `UNIQUE (code)` | Resolver `/room/{code}` |
| rooms | `(status, expires_at)` | Job de expiração |
| participants | `UNIQUE (identity)` | Correlacionar webhooks |
| participants | `(room_id) WHERE left_at IS NULL` (parcial) | Presentes na sala |
| stream_sessions | `(room_id, started_at DESC)` | Histórico |
| stream_sessions | `UNIQUE (track_sid)` | Idempotência de webhook |

## Decisões

- **`source` é campo próprio em `stream_sessions`** — áudio e vídeo nunca são a mesma linha. Voz (`microphone`) entra sem migração.
- **`media_policy` em JSONB**: evolui (codec permitido, áudio permitido, 4K permitido) sem migração a cada ajuste; validada por um tipo C# fortemente tipado.
- **`guests` separado de `participants`**: a mesma pessoa (cookie) pode entrar em várias salas e, no futuro, ser vinculada a uma conta (`account_id`).
- **Webhooks idempotentes**: LiveKit pode reenviar eventos; usamos `identity`/`track_sid` + `ON CONFLICT`.
- **Sem tabela de eventos/auditoria no MVP**: logs estruturados cobrem isso (Documento 5). Pode virar tabela quando "histórico" for requisito.
- **Chaves UUID v7** (ordenáveis por tempo) geradas na aplicação.

## Preparado para o futuro (não criar agora)

| Funcionalidade | Mudança prevista |
|---|---|
| Contas | tabela `accounts`; `guests.account_id` já existe |
| Senha / sala privada | `rooms.password_hash`, `rooms.visibility` |
| Moderador / expulsar / bloquear | `participants.role` já existe; tabela `room_bans (room_id, guest_id/account_id, reason, until)` |
| Chat | `chat_messages (room_id, participant_id, body, created_at)` — ou só via data channel sem persistir |
| Gravação | `recordings` + LiveKit Egress (fora do caminho de baixa latência) |
