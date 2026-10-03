#!/bin/bash
# Gera infra/.env para um servidor Linux, com segredos novos.
# Uso: infra/scripts/init-env.sh --public-ip 203.0.113.10 [--host tela.exemplo.com] [--force]
#   --public-ip  IP público que os navegadores usam para chegar à mídia (SFU) e ao TURN
#   --host       nome (DNS) do servidor, se houver; senão o próprio IP é usado
set -euo pipefail
cd "$(dirname "$0")/.."

PUBLIC_IP="" HOST="" FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --public-ip) PUBLIC_IP="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "opção desconhecida: $1" >&2; exit 2 ;;
  esac
done
[ -n "$PUBLIC_IP" ] || { echo "informe --public-ip" >&2; exit 2; }
[ "$FORCE" = 1 ] || [ ! -f .env ] || { echo ".env já existe (use --force para gerar de novo; os segredos mudam)"; exit 0; }
HOST="${HOST:-$PUBLIC_IP}"

secret() { openssl rand -hex "$1"; }

cat > .env <<ENV
# Gerado por init-env.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). Não versionar.
ASPNETCORE_ENVIRONMENT=Production

POSTGRES_DB=screenshare
POSTGRES_USER=screenshare
POSTGRES_PASSWORD=$(secret 24)

SESSION_SIGNING_KEY=$(secret 32)
SESSION_SECURE_COOKIE=true

REDIS_PASSWORD=$(secret 24)

LIVEKIT_API_KEY=API$(secret 6)
LIVEKIT_API_SECRET=$(secret 32)
LIVEKIT_NODE_IP=$PUBLIC_IP
LIVEKIT_USE_EXTERNAL_IP=false
LIVEKIT_UDP_PORT=7882
LIVEKIT_PUBLIC_URL=

TURN_SECRET=$(secret 32)
TURN_HOST=$HOST
TURN_EXTERNAL_IP=$PUBLIC_IP
TURN_RELAY_PORT_START=49160
TURN_RELAY_PORT_END=49359

# vazios = limites de produção
RATE_LIMIT_SESSIONS_PER_MIN=
RATE_LIMIT_ROOMS_PER_HOUR_PER_IP=
RATE_LIMIT_ROOM_LOOKUPS_PER_MIN=
ENV
chmod 600 .env
echo "infra/.env gerado (IP público $PUBLIC_IP, host $HOST)"
