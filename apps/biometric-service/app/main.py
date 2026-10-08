import hmac
import json
import logging
import secrets
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from . import config
from .crypto import TemplateCipher
from .face import ACTIONS, FRAME_COUNT, FaceEngine, FaceError
from .store import Store

settings = config.load()
store = Store(settings.data_dir)
cipher = TemplateCipher(settings.template_key)
engine = FaceEngine(settings.models_dir, settings.min_face_px, settings.min_sharpness)
MIN_ENROLL_QUALITY = 0.35

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(message)s")
logger = logging.getLogger("biometric")


def log(level: str, msg: str, **extra: object) -> None:
    logger.info(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "level": level, "service": "preventbase-biometric", "msg": msg, **extra}))


def backup_loop() -> None:
    while True:
        try:
            path = store.backup(settings.backup_retention_days)
            log("info", "backup sqlite", file=path.name)
        except Exception as exc:  # noqa: BLE001
            log("error", "falha no backup", error=str(exc))
        time.sleep(24 * 3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=backup_loop, daemon=True).start()
    log("info", "biometric-service ativo", threshold=settings.match_threshold)
    yield


app = FastAPI(title="PreventBase Biometric Service", version="1.0", docs_url=None, redoc_url=None, lifespan=lifespan)


def require_token(x_service_token: str = Header(default="")) -> None:
    if not hmac.compare_digest(x_service_token.encode(), settings.service_token.encode()):
        raise HTTPException(status_code=401, detail="Não autorizado")


Ref = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9-]+$")


class ChallengeIn(BaseModel):
    subject_ref: str = Ref
    tenant_ref: str = Ref
    purpose: str = Field(pattern=r"^(ENROLL|DELIVERY)$")


class FramesIn(BaseModel):
    subject_ref: str = Ref
    tenant_ref: str = Ref
    challenge_id: str = Field(min_length=8, max_length=64)
    frames: list[str] = Field(min_length=3, max_length=8)


@app.get("/health")
def health() -> dict:
    return {"status": "ok" if store.ping() else "degraded"}


@app.post("/v1/challenges", dependencies=[Depends(require_token)])
def challenge(body: ChallengeIn) -> dict:
    action = secrets.choice(sorted(ACTIONS))
    c = store.create_challenge(body.tenant_ref, body.subject_ref, body.purpose, action, settings.challenge_ttl_seconds)
    return {"challenge_id": c["id"], "action": action, "instruction": ACTIONS[action][0], "frame_count": FRAME_COUNT, "expires_at": c["expires_at"]}


def _consume(body: FramesIn, purpose: str) -> str:
    try:
        return store.consume_challenge(body.challenge_id, body.tenant_ref, body.subject_ref, purpose)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/v1/enroll", dependencies=[Depends(require_token)])
def enroll(body: FramesIn) -> dict:
    action = _consume(body, "ENROLL")
    try:
        result = engine.analyze(body.frames, action)
    except FaceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not result.liveness or result.template is None:
        log("info", "cadastro rejeitado", reason=result.reason)
        raise HTTPException(status_code=422, detail=f"Cadastro não realizado: {result.reason}")
    if result.quality < MIN_ENROLL_QUALITY:
        raise HTTPException(status_code=422, detail="Qualidade insuficiente — melhore a iluminação e aproxime o rosto")
    nonce, blob = cipher.encrypt(result.template, body.tenant_ref, body.subject_ref)
    profile_id = store.save_profile(body.tenant_ref, body.subject_ref, nonce, blob, result.quality)
    log("info", "cadastro biométrico", profile=profile_id, quality=result.quality)
    return {"profile_id": profile_id, "quality": result.quality, "liveness": True, "reason": None}


@app.post("/v1/verify", dependencies=[Depends(require_token)])
def verify(body: FramesIn) -> dict:
    profile = store.active_profile(body.tenant_ref, body.subject_ref)
    if profile is None:
        raise HTTPException(status_code=422, detail="Colaborador sem biometria cadastrada")
    action = _consume(body, "DELIVERY")
    try:
        result = engine.analyze(body.frames, action)
    except FaceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    score = 0.0
    reason = result.reason
    if result.liveness and result.template is not None:
        stored = cipher.decrypt(profile["nonce"], profile["template"], body.tenant_ref, body.subject_ref)
        score = round(engine.similarity(result.template, stored), 4)
        if score < settings.match_threshold:
            reason = "Rosto não corresponde ao cadastro"
    verified = bool(result.liveness and score >= settings.match_threshold)
    vid = store.save_verification(body.tenant_ref, body.subject_ref, profile["id"], verified, score, result.liveness, action, reason)
    log("info", "verificação", verification=vid, verified=verified, liveness=result.liveness, score=score)
    return {"verification_id": vid, "verified": verified, "score": score, "liveness": result.liveness, "challenge_action": action, "reason": reason}


@app.delete("/v1/profiles/{subject_ref}", dependencies=[Depends(require_token)])
def revoke(subject_ref: str, tenant_ref: str = Query(min_length=8, max_length=64)) -> dict:
    count = store.revoke(tenant_ref, subject_ref)
    log("info", "biometria revogada", revoked=count)
    return {"revoked": count}
