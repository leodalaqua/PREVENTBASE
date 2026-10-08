import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  tenant_ref TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  nonce BLOB NOT NULL,
  template BLOB NOT NULL,
  quality REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_profiles_subject ON profiles(tenant_ref, subject_ref, status);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  tenant_ref TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  purpose TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  tenant_ref TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  profile_id TEXT,
  verified INTEGER NOT NULL,
  score REAL NOT NULL,
  liveness INTEGER NOT NULL,
  action TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Store:
    """SQLite isolado do banco principal (§8). Sem imagens: só templates cifrados e resultados."""

    def __init__(self, data_dir: Path) -> None:
        data_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir = data_dir
        self.path = data_dir / "biometric.db"
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA foreign_keys=ON")
        self._db.executescript(SCHEMA)

    def ping(self) -> bool:
        with self._lock:
            return self._db.execute("SELECT 1").fetchone() is not None

    def create_challenge(self, tenant_ref: str, subject_ref: str, purpose: str, action: str, ttl: int) -> dict:
        cid = uuid.uuid4().hex
        created = datetime.now(timezone.utc)
        expires = created + timedelta(seconds=ttl)
        with self._lock:
            self._db.execute(
                "INSERT INTO challenges (id, tenant_ref, subject_ref, purpose, action, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
                (cid, tenant_ref, subject_ref, purpose, action, created.isoformat(), expires.isoformat()),
            )
            self._db.execute("DELETE FROM challenges WHERE expires_at < ?", ((created - timedelta(days=1)).isoformat(),))
        return {"id": cid, "action": action, "expires_at": expires.isoformat()}

    def consume_challenge(self, cid: str, tenant_ref: str, subject_ref: str, purpose: str) -> str:
        """Uso único: marca como usado na mesma operação (anti-replay). Retorna a ação esperada."""
        with self._lock:
            row = self._db.execute("SELECT * FROM challenges WHERE id = ?", (cid,)).fetchone()
            if row is None or row["tenant_ref"] != tenant_ref or row["subject_ref"] != subject_ref:
                raise ValueError("Desafio inválido")
            if row["purpose"] != purpose:
                raise ValueError("Desafio emitido para outra finalidade")
            if row["used_at"] is not None:
                raise ValueError("Desafio já utilizado")
            if datetime.fromisoformat(row["expires_at"]) < datetime.now(timezone.utc):
                raise ValueError("Desafio expirado")
            cur = self._db.execute("UPDATE challenges SET used_at = ? WHERE id = ? AND used_at IS NULL", (now_iso(), cid))
            if cur.rowcount != 1:
                raise ValueError("Desafio já utilizado")
            return str(row["action"])

    def save_profile(self, tenant_ref: str, subject_ref: str, nonce: bytes, blob: bytes, quality: float) -> str:
        pid = uuid.uuid4().hex
        ts = now_iso()
        with self._lock:
            self._db.execute("BEGIN")
            try:
                self._db.execute(
                    "UPDATE profiles SET status = 'REPLACED', revoked_at = ?, template = x'', nonce = x'' WHERE tenant_ref = ? AND subject_ref = ? AND status = 'ACTIVE'",
                    (ts, tenant_ref, subject_ref),
                )
                self._db.execute(
                    "INSERT INTO profiles (id, tenant_ref, subject_ref, nonce, template, quality, created_at) VALUES (?,?,?,?,?,?,?)",
                    (pid, tenant_ref, subject_ref, nonce, blob, quality, ts),
                )
                self._db.execute("COMMIT")
            except Exception:
                self._db.execute("ROLLBACK")
                raise
        return pid

    def active_profile(self, tenant_ref: str, subject_ref: str) -> sqlite3.Row | None:
        with self._lock:
            return self._db.execute(
                "SELECT * FROM profiles WHERE tenant_ref = ? AND subject_ref = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1",
                (tenant_ref, subject_ref),
            ).fetchone()

    def revoke(self, tenant_ref: str, subject_ref: str) -> int:
        """Revogação LGPD: apaga o template (dado biométrico) e mantém só o registro do fato."""
        with self._lock:
            cur = self._db.execute(
                "UPDATE profiles SET status = 'REVOKED', revoked_at = ?, template = x'', nonce = x'' WHERE tenant_ref = ? AND subject_ref = ? AND status = 'ACTIVE'",
                (now_iso(), tenant_ref, subject_ref),
            )
            return cur.rowcount

    def save_verification(self, tenant_ref: str, subject_ref: str, profile_id: str | None, verified: bool, score: float, liveness: bool, action: str | None, reason: str | None) -> str:
        vid = uuid.uuid4().hex
        with self._lock:
            self._db.execute(
                "INSERT INTO verifications (id, tenant_ref, subject_ref, profile_id, verified, score, liveness, action, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (vid, tenant_ref, subject_ref, profile_id, int(verified), score, int(liveness), action, reason, now_iso()),
            )
        return vid

    def backup(self, retention_days: int) -> Path:
        target_dir = self.data_dir / "backups"
        target_dir.mkdir(exist_ok=True)
        target = target_dir / f"biometric-{datetime.now(timezone.utc):%Y%m%d}.db"
        dest = sqlite3.connect(target)
        try:
            with self._lock:
                self._db.backup(dest)
        finally:
            dest.close()
        limit = time.time() - retention_days * 86400
        for f in target_dir.glob("biometric-*.db"):
            if f.stat().st_mtime < limit:
                f.unlink(missing_ok=True)
        return target
