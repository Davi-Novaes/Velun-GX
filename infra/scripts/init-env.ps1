# Gera infra/.env a partir de infra/.env.example com segredos aleatórios e o IP desta máquina na rede local.
# Uso: powershell -File infra/scripts/init-env.ps1 [-Force] [-NodeIp 192.168.1.7]
param(
    [switch]$Force,
    [string]$NodeIp
)
$ErrorActionPreference = 'Stop'

$infra = Split-Path -Parent $PSScriptRoot
$example = Join-Path $infra '.env.example'
$target = Join-Path $infra '.env'

if ((Test-Path $target) -and -not $Force) {
    Write-Host "infra/.env já existe. Use -Force para regenerar (os segredos mudam)."
    exit 0
}

function New-Secret([int]$bytes = 32) {
    $buffer = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    # hexadecimal: sem caracteres que precisem de escape em YAML, URL ou linha de comando
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

if (-not $NodeIp) {
    # interface com gateway padrão = a que fala com a rede local
    $NodeIp = Get-NetIPConfiguration |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
        Select-Object -First 1 -ExpandProperty IPv4Address |
        Select-Object -First 1 -ExpandProperty IPAddress
    if (-not $NodeIp) { throw 'Não foi possível detectar o IP da rede local. Informe com -NodeIp.' }
}

$values = @{
    POSTGRES_PASSWORD  = New-Secret 24
    REDIS_PASSWORD     = New-Secret 24
    SESSION_SIGNING_KEY = New-Secret 32
    LIVEKIT_API_KEY    = 'API' + (New-Secret 6)
    LIVEKIT_API_SECRET = New-Secret 32
    TURN_SECRET        = New-Secret 32
    LIVEKIT_NODE_IP    = $NodeIp
    TURN_HOST          = $NodeIp
    TURN_EXTERNAL_IP   = $NodeIp
}

$lines = Get-Content $example | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=' -and $values.ContainsKey($Matches[1])) { "$($Matches[1])=$($values[$Matches[1]])" } else { $_ }
}
[System.IO.File]::WriteAllLines($target, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "infra/.env gerado. IP anunciado pelo SFU/TURN: $NodeIp"
