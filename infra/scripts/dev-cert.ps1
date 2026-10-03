# Gera um certificado HTTPS de desenvolvimento (CA local + certificado do servidor) em infra/certs/.
# Necessário para testar a partir de outros dispositivos da rede: getDisplayMedia só funciona em contexto seguro,
# e fora de "localhost" isso exige HTTPS.
#
# Uso: powershell -File infra/scripts/dev-cert.ps1 [-Force] [-ExtraHost screenshare.test]
#
# O openssl roda dentro de um container (Docker já é pré-requisito), então nada precisa ser instalado.
# Este script NÃO instala a CA em nenhum repositório de confiança. Sem isso, o navegador mostra um aviso na
# primeira visita, que pode ser aceito. Para não ver o aviso, importe infra/certs/dev-ca.crt como
# "Autoridade de Certificação Raiz Confiável" nos dispositivos de teste (manualmente, só em máquinas suas).
param(
    [switch]$Force,
    [string[]]$ExtraHost = @('screenshare.test')
)
$ErrorActionPreference = 'Stop'

$infra = Split-Path -Parent $PSScriptRoot
$certs = Join-Path $infra 'certs'
$envFile = Join-Path $infra '.env'

if ((Test-Path (Join-Path $certs 'dev-cert.pem')) -and -not $Force) {
    Write-Host 'infra/certs/dev-cert.pem já existe. Use -Force para gerar de novo.'
    exit 0
}

$nodeIp = $null
if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^LIVEKIT_NODE_IP=' } | Select-Object -First 1
    if ($line) { $nodeIp = ($line -split '=', 2)[1].Trim() }
}

$dns = @('localhost', '*.localhost') + $ExtraHost
$ips = @('127.0.0.1') + @($nodeIp | Where-Object { $_ })
$san = (($dns | ForEach-Object { "DNS:$_" }) + ($ips | ForEach-Object { "IP:$_" })) -join ','

$script = @"
set -e
apk add --no-cache openssl >/dev/null
cd /certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj '/CN=Tela Compartilhada Dev CA' \
  -keyout dev-ca.key -out dev-ca.crt \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj '/CN=localhost' -keyout dev-key.pem -out dev.csr 2>/dev/null
printf 'subjectAltName=$san\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > dev.ext
openssl x509 -req -in dev.csr -CA dev-ca.crt -CAkey dev-ca.key -CAcreateserial -days 825 -sha256 -extfile dev.ext -out dev-cert.pem 2>/dev/null
rm -f dev.csr dev.ext dev-ca.srl
chmod 644 dev-cert.pem dev-ca.crt
chmod 600 dev-key.pem dev-ca.key
"@ -replace "`r", ''

New-Item -ItemType Directory -Force $certs | Out-Null
docker run --rm -v "${certs}:/certs" alpine:3 sh -c $script
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o certificado.' }

Write-Host "Certificado gerado em infra/certs/ para: $($dns + $ips -join ', ')"
Write-Host 'Reinicie o Traefik: docker compose -f infra/docker-compose.yml restart traefik'
