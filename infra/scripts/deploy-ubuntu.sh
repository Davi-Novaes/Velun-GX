#!/usr/bin/env bash
# Publica o código atual (backend, frontend, infra, docs) no servidor Ubuntu e reconstrói backend e frontend.
# Rodar no Git Bash, na raiz do projeto: bash infra/scripts/deploy-ubuntu.sh
# Não mexe em .env, certificados nem dados: as migrações do banco rodam sozinhas ao subir o backend.
set -euo pipefail
cd "$(dirname "$0")/../.."
key=~/.ssh/id_ed25519_tela
host=discord@discordmeet.ddns.net
list=$(mktemp); pkg=$(mktemp --suffix=.tgz)
trap 'rm -f "$list" "$pkg"' EXIT

# arquivos versionados e novos (ainda não commitados), sem o que o .gitignore exclui
git ls-files --cached --others --exclude-standard backend frontend infra docs | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done > "$list"
tar -czf "$pkg" -T "$list"
echo "Pacote: $(wc -l < "$list") arquivos"

scp -q -i "$key" -P 2222 "$pkg" "$host:/tmp/velun-deploy.tgz"
ssh -i "$key" -p 2222 "$host" 'set -e
cd /opt/tela
tar -xzf /tmp/velun-deploy.tgz && rm /tmp/velun-deploy.tgz
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml -f infra/docker-compose.letsencrypt.yml up -d --build backend frontend
for i in $(seq 1 45); do
  code=$(curl -ks -o /dev/null -w "%{http_code}" https://127.0.0.1:8443/api/v1/auth/me || true)
  [ "$code" = 401 ] && { echo "Site no ar (API respondeu)."; exit 0; }
  sleep 2
done
echo "A API não respondeu em 90 s. Veja: docker logs screenshare-backend-1 --tail 50"; exit 1'
