#!/bin/bash
# Certificado HTTPS provisório (autoassinado) para o servidor, enquanto não há domínio com Let's Encrypt.
# O navegador mostra um aviso na primeira visita; basta aceitar.
# Uso: infra/scripts/server-cert.sh <ip-ou-nome> [mais nomes/IPs...]
set -euo pipefail
cd "$(dirname "$0")/../certs"
[ $# -ge 1 ] || { echo "uso: $0 <ip-ou-nome> [...]" >&2; exit 2; }
san=""
for name in "$@"; do
  if [[ "$name" =~ ^[0-9.]+$ ]]; then san+="IP:$name,"; else san+="DNS:$name,"; fi
done
san="${san%,}"
openssl req -x509 -newkey rsa:2048 -nodes -days 397 -sha256 -subj "/CN=$1" \
  -keyout dev-key.pem -out dev-cert.pem -addext "subjectAltName=$san" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null
chmod 600 dev-key.pem
echo "certificado para: $san"
