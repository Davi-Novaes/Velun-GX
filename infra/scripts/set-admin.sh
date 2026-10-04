#!/usr/bin/env bash
# Define (ou troca) o usuário e a senha do painel de administração (/admin) no servidor.
# Rodar no Git Bash, na raiz do projeto: bash infra/scripts/set-admin.sh
# A senha é digitada aqui sem aparecer na tela, vai pela conexão SSH e o servidor guarda só o hash
# (PBKDF2-SHA256) no infra/.env. Trocar a senha derruba os logins de painel abertos.
set -euo pipefail
key=~/.ssh/id_ed25519_tela
host=discord@discordmeet.ddns.net

read -r -p "Usuário do painel [Mopaz]: " username
username=${username:-Mopaz}
[[ "$username" =~ ^[A-Za-z0-9_.-]{3,32}$ ]] || { echo "Use de 3 a 32 letras, números, ponto, hífen ou sublinhado."; exit 1; }
read -r -s -p "Senha do painel: " password; echo
read -r -s -p "Confirme a senha: " confirm; echo
[ "$password" = "$confirm" ] || { echo "As senhas não coincidem."; exit 1; }
[ ${#password} -ge 8 ] || { echo "Use ao menos 8 caracteres."; exit 1; }

printf '%s\n%s\n' "$username" "$password" | ssh -i "$key" -p 2222 "$host" 'set -e
cd /opt/tela
python3 -c "
import sys, os, hashlib, base64, re
user = sys.stdin.readline().rstrip(\"\n\")
password = sys.stdin.readline().rstrip(\"\n\")
salt = os.urandom(16)
digest = hashlib.pbkdf2_hmac(\"sha256\", password.encode(), salt, 600000, 32)
value = \"pbkdf2-sha256:600000:%s:%s\" % (base64.b64encode(salt).decode(), base64.b64encode(digest).decode())
path = \"infra/.env\"
lines = [l for l in open(path).read().splitlines() if not re.match(r\"(ADMIN_USERNAME|ADMIN_PASSWORD_HASH)=\", l)]
lines += [\"ADMIN_USERNAME=\" + user, \"ADMIN_PASSWORD_HASH=\" + value]
open(path, \"w\").write(\"\n\".join(lines) + \"\n\")
"
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml -f infra/docker-compose.letsencrypt.yml up -d --no-build backend >/dev/null 2>&1
for i in $(seq 1 45); do
  [ "$(curl -ks -o /dev/null -w "%{http_code}" https://127.0.0.1:8443/api/v1/admin/me || true)" = 401 ] && { echo "Pronto: painel liberado em https://discordmeet.ddns.net:8443/admin"; exit 0; }
  sleep 2
done
echo "O backend não respondeu em 90 s. Veja: docker logs screenshare-backend-1 --tail 50"; exit 1'
