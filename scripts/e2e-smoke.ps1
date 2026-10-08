# Smoke E2E isolado: banco preventbase_e2e + API temporária (imagem preventbase-api) na porta 127.0.0.1:3199.
# Redis db 5 e bucket preventbase-e2e para não tocar dados de produção. Tudo é removido ao final.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)

$envMap = @{}
Get-Content .env | Where-Object { $_ -match '^[A-Z0-9_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $envMap[$k] = $v }
$pgUser = if ($envMap.POSTGRES_USER) { $envMap.POSTGRES_USER } else { "preventbase" }
$pgPass = $envMap.POSTGRES_PASSWORD
$pgPort = if ($envMap.PREVENTBASE_PG_PORT) { $envMap.PREVENTBASE_PG_PORT } else { "3110" }
$adminPass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
$name = "preventbase-e2e-api"
$envFile = Join-Path $env:TEMP "preventbase-e2e.env"

function Cleanup {
  docker rm -f $name 2>$null | Out-Null
  docker exec preventbase-postgres psql -q -U $pgUser -d postgres -c "DROP DATABASE IF EXISTS preventbase_e2e WITH (FORCE)" 2>$null | Out-Null
  docker exec preventbase-redis redis-cli -n 5 FLUSHDB 2>$null | Out-Null
  docker exec preventbase-minio sh -c 'mc alias set l http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1 && mc rb --force l/preventbase-e2e >/dev/null 2>&1' 2>$null | Out-Null
  Remove-Item $envFile -ErrorAction SilentlyContinue
}

try {
  Cleanup
  docker exec preventbase-postgres psql -q -U $pgUser -d postgres -c "CREATE DATABASE preventbase_e2e" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "falha ao criar preventbase_e2e" }

  $keep = '^(NODE_ENV|DATABASE_URL|REDIS_URL|MINIO_[A-Z_]+|JWT_[A-Z_]+|REFRESH_TTL_DAYS|BIOMETRIC_SERVICE_[A-Z_]+|PUBLIC_BASE_URL|APP_HOST|APP_PORT|TZ)='
  $lines = docker exec preventbase-api env | Where-Object { $_ -match $keep } | ForEach-Object {
    if ($_ -like 'DATABASE_URL=*') { $_ -replace '/[^/?]+\?', '/preventbase_e2e?' }
    elseif ($_ -like 'REDIS_URL=*') { 'REDIS_URL=redis://redis:6379/5' }
    elseif ($_ -like 'MINIO_BUCKET=*') { 'MINIO_BUCKET=preventbase-e2e' }
    else { $_ }
  }
  $lines += "SEED_TENANT_NAME=E2E", "SEED_ADMIN_EMAIL=admin@preventbase.local", "SEED_ADMIN_PASSWORD=$adminPass"
  Set-Content -Path $envFile -Value $lines

  docker run -d --name $name --network preventbase_default -p 127.0.0.1:3199:3000 --env-file $envFile preventbase-api:latest | Out-Null
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep 3
    try { $ok = (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3199/api/v1/health -TimeoutSec 3).StatusCode -eq 200 } catch { $ok = $false }
  } until ($ok -or (Get-Date) -gt $deadline)
  if (-not $ok) { docker logs $name --tail 40; throw "API E2E não subiu" }

  $env:E2E_API = "http://127.0.0.1:3199/api/v1"
  $env:E2E_DATABASE_URL = "postgresql://${pgUser}:${pgPass}@127.0.0.1:${pgPort}/preventbase_e2e?schema=public"
  $env:E2E_PASSWORD = $adminPass
  node scripts/e2e-smoke.mjs
  $code = $LASTEXITCODE
  if ($code -ne 0) { docker logs $name --tail 30 }
} finally {
  Remove-Item Env:E2E_PASSWORD, Env:E2E_DATABASE_URL -ErrorAction SilentlyContinue
  Cleanup
}
exit $code
