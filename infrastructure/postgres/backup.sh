#!/bin/sh
# Backup diário (MASTER-PLAN §70): pg_dump + teste de restauração + cópia MinIO/biometria.
# Roda em loop no container preventbase-backup; horário em BACKUP_HOUR (padrão 03).
set -eu

RETENTION="${BACKUP_RETENTION_DAYS:-14}"
HOUR="${BACKUP_HOUR:-03}"
ROOT=/backups

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

run_backup() {
  stamp=$(date '+%Y-%m-%d_%H%M')
  dir="$ROOT/$stamp"
  mkdir -p "$dir"

  log "pg_dump -> $dir/preventbase.dump"
  pg_dump -Fc -f "$dir/preventbase.dump.part" && mv "$dir/preventbase.dump.part" "$dir/preventbase.dump"

  log "teste de restauração"
  check_db="preventbase_restore_check"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $check_db" >/dev/null
  psql -q -d postgres -c "CREATE DATABASE $check_db" >/dev/null
  if pg_restore -d "$check_db" --no-owner --exit-on-error "$dir/preventbase.dump" >/dev/null 2>&1 \
    && psql -tA -d "$check_db" -c 'SELECT count(*) FROM tenants' >/dev/null; then
    echo "ok" > "$dir/RESTORE_OK"
    log "restauração ok"
  else
    echo "falhou" > "$dir/RESTORE_FAILED"
    log "ERRO: restauração falhou"
  fi
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $check_db" >/dev/null

  log "arquivos MinIO e biometria"
  tar -czf "$dir/minio.tar.gz" -C /sources minio
  tar -czf "$dir/biometric.tar.gz" -C /sources biometric

  (cd "$dir" && sha256sum ./* > SHA256SUMS)
  find "$ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RETENTION" -exec rm -rf {} +
  log "concluído ($dir)"
}

mkdir -p "$ROOT"
[ -n "$(ls -A "$ROOT" 2>/dev/null)" ] || run_backup || log "ERRO no backup inicial"

while true; do
  now=$(date '+%H%M')
  target="${HOUR}00"
  if [ "$now" = "$target" ]; then
    run_backup || log "ERRO no backup"
    sleep 70
  fi
  sleep 30
done
