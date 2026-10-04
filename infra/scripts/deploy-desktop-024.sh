#!/usr/bin/env bash
# Publica o instalador testado sem invalidar o certificado fixado ou o feed antigo.
set -euo pipefail
umask 077
stage=${1:?informe diretório absoluto do pacote}
case "$stage" in /mnt/c/Users/Administrator/*) ;; *) echo 'Pacote não permitido'; exit 1;; esac
cd /opt/tela
test -d infra/downloads
test -s "$stage/VelunGx-Setup.exe"
test -s "$stage/VelunGx-Setup.exe.blockmap"
grep -q '^version: 0.2.4' "$stage/latest.yml"
expected=$(sed -n 's/^sha512: //p' "$stage/latest.yml" | tr -d '\r')
actual=$(openssl dgst -sha512 -binary "$stage/VelunGx-Setup.exe" | openssl base64 -A)
test "$expected" = "$actual"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/opt/tela/backups/desktop-$stamp"
mkdir -p "$backup"
cp -a infra/downloads "$backup/downloads"
cp "$stage/VelunGx-Setup.exe" infra/downloads/VelunGx-Setup-0.2.4.exe
cp "$stage/VelunGx-Setup.exe.blockmap" infra/downloads/VelunGx-Setup-0.2.4.exe.blockmap
chmod 644 infra/downloads/VelunGx-Setup-0.2.4.exe infra/downloads/VelunGx-Setup-0.2.4.exe.blockmap
# Alias para quem usa o botão Baixar app; renomear só após concluir a cópia.
cp "$stage/VelunGx-Setup.exe" infra/downloads/VelunGx-Setup.exe.new
chmod 644 infra/downloads/VelunGx-Setup.exe.new
mv infra/downloads/VelunGx-Setup.exe.new infra/downloads/VelunGx-Setup.exe
cp "$stage/VelunGx-Setup.exe.blockmap" infra/downloads/VelunGx-Setup.exe.blockmap.new
chmod 644 infra/downloads/VelunGx-Setup.exe.blockmap.new
mv infra/downloads/VelunGx-Setup.exe.blockmap.new infra/downloads/VelunGx-Setup.exe.blockmap
cp "$stage/latest.yml" infra/downloads/latest.yml.new
chmod 644 infra/downloads/latest.yml.new
mv infra/downloads/latest.yml.new infra/downloads/latest.yml
echo "Desktop 0.2.4 publicado. Backup: $backup"
