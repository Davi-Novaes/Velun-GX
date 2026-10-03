#!/usr/bin/env bash
# Domínio de teste com certificado autoassinado; não altera firewall ou DNS.
set -euo pipefail
umask 077
cd /opt/tela
backup="/opt/tela/backups/domain-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
cp infra/certs/dev-cert.pem infra/certs/dev-key.pem "$backup/"
bash infra/scripts/server-cert.sh discordmeet.ddns.net 186.236.226.179 10.50.0.1 localhost
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml restart traefik
echo "Certificado de teste atualizado. Backup: $backup"
