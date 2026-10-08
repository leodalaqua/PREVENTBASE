import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    service_token: str
    template_key: str
    match_threshold: float
    data_dir: Path
    models_dir: Path
    challenge_ttl_seconds: int
    backup_retention_days: int
    min_face_px: int
    min_sharpness: float


def load() -> Settings:
    token = os.environ.get("BIOMETRIC_SERVICE_TOKEN", "")
    key = os.environ.get("BIOMETRIC_TEMPLATE_KEY", "")
    if len(token) < 24:
        raise RuntimeError("BIOMETRIC_SERVICE_TOKEN ausente ou curto")
    if len(key) < 32:
        raise RuntimeError("BIOMETRIC_TEMPLATE_KEY ausente ou curta")
    return Settings(
        service_token=token,
        template_key=key,
        match_threshold=float(os.environ.get("BIOMETRIC_MATCH_THRESHOLD", "0.363")),
        data_dir=Path(os.environ.get("BIOMETRIC_DATA_DIR", "/data")),
        models_dir=Path(os.environ.get("BIOMETRIC_MODELS_DIR", "/models")),
        challenge_ttl_seconds=int(os.environ.get("BIOMETRIC_CHALLENGE_TTL", "120")),
        backup_retention_days=int(os.environ.get("BACKUP_RETENTION_DAYS", "14")),
        min_face_px=int(os.environ.get("BIOMETRIC_MIN_FACE_PX", "80")),
        min_sharpness=float(os.environ.get("BIOMETRIC_MIN_SHARPNESS", "25")),
    )
