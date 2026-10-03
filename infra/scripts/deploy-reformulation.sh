#!/usr/bin/env bash
# Rollout de imagens já compiladas. Não altera .env, certificados ou configuração do proxy.
set -euo pipefail
umask 077
cd /opt/tela
stage=${1:?informe diretório absoluto do pacote de implantação}
case "$stage" in /mnt/c/Users/Administrator/*) ;; *) echo 'Diretório de pacote não permitido'; exit 1;; esac
test -f "$stage/screenshare-images.tar"
test -f "$stage/screenshare-source.tar.gz"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/opt/tela/backups/$stamp"
mkdir -p "$backup"
compose=(docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml)
cp infra/docker-compose.yml "$backup/docker-compose.yml"
cp infra/docker-compose.prod.yml "$backup/docker-compose.prod.yml"
tar --exclude=node_modules --exclude=bin --exclude=obj --exclude=dist --exclude=playwright-report --exclude=test-results -czf "$backup/source-before.tar.gz" backend frontend docs README.md
old_backend=$(docker inspect screenshare-backend-1 --format '{{.Image}}')
old_frontend=$(docker inspect screenshare-frontend-1 --format '{{.Image}}')
docker tag "$old_backend" "screenshare-backend:rollback-$stamp"
docker tag "$old_frontend" "screenshare-frontend:rollback-$stamp"
"${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup/postgres.dump"
test -s "$backup/postgres.dump"
docker load -i "$stage/screenshare-images.tar"
tar -xzf "$stage/screenshare-source.tar.gz" -C /opt/tela
"${compose[@]}" up -d --no-build --no-deps backend frontend
ready=false
for attempt in {1..45}; do
  code=$(curl -ks -o /dev/null -w '%{http_code}' https://127.0.0.1/api/v1/auth/me || true)
  if test "$code" = 401; then ready=true; break; fi
  sleep 2
done
if test "$ready" != true; then
  echo 'API nova não ficou pronta; restaurando imagens e Compose anteriores.'
  cp "$backup/docker-compose.yml" infra/docker-compose.yml
  docker tag "screenshare-backend:rollback-$stamp" screenshare-backend:latest
  docker tag "screenshare-frontend:rollback-$stamp" screenshare-frontend:latest
  "${compose[@]}" up -d --no-build --no-deps backend frontend
  exit 1
fi
echo "Backup: $backup"
"${compose[@]}" ps --format table
