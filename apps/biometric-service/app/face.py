import base64
import binascii
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"

MAX_FRAME_BYTES = 2_500_000
MAX_SIDE = 960
FRONTAL_YAW = 0.18
TURN_YAW = 0.28
SAME_PERSON_MIN = 0.25
MIN_MOTION = 1.5

ACTIONS = {
    # Imagem NÃO espelhada (câmera olhando para o colaborador): virar para a esquerda
    # do colaborador desloca o nariz para a direita da imagem → yaw positivo.
    "TURN_LEFT": ("Olhe para a câmera e, após o sinal, vire o rosto devagar para a SUA esquerda.", 1),
    "TURN_RIGHT": ("Olhe para a câmera e, após o sinal, vire o rosto devagar para a SUA direita.", -1),
}
FRAME_COUNT = 6


class FaceError(ValueError):
    pass


@dataclass
class FrameFace:
    image: np.ndarray
    row: np.ndarray
    score: float
    size: float
    yaw: float
    sharpness: float
    gray_small: np.ndarray


@dataclass
class Analysis:
    liveness: bool
    reason: str | None
    template: np.ndarray | None
    quality: float


def decode_frame(data: str) -> np.ndarray:
    if "," in data[:80] and data.startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise FaceError("Imagem inválida") from exc
    if len(raw) > MAX_FRAME_BYTES:
        raise FaceError("Imagem muito grande")
    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise FaceError("Imagem inválida")
    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


class FaceEngine:
    """YuNet (detecção + 5 landmarks) e SFace (embedding 128-d). Modelos OpenCV Zoo, execução local."""

    def __init__(self, models_dir: Path, min_face_px: int, min_sharpness: float) -> None:
        self._detector = cv2.FaceDetectorYN.create(str(models_dir / DETECTOR_FILE), "", (320, 320), 0.8, 0.3, 50)
        self._recognizer = cv2.FaceRecognizerSF.create(str(models_dir / RECOGNIZER_FILE), "")
        self._lock = threading.Lock()
        self.min_face_px = min_face_px
        self.min_sharpness = min_sharpness

    def _detect(self, img: np.ndarray) -> np.ndarray:
        h, w = img.shape[:2]
        with self._lock:
            self._detector.setInputSize((w, h))
            _, faces = self._detector.detect(img)
        return faces if faces is not None else np.empty((0, 15), dtype=np.float32)

    def _embed(self, img: np.ndarray, row: np.ndarray) -> np.ndarray:
        with self._lock:
            aligned = self._recognizer.alignCrop(img, row)
            feat = self._recognizer.feature(aligned)
        v = feat.flatten().astype(np.float32)
        return v / (np.linalg.norm(v) + 1e-9)

    def _frame(self, img: np.ndarray) -> FrameFace:
        faces = self._detect(img)
        if len(faces) == 0:
            raise FaceError("Rosto não encontrado em um dos quadros")
        if len(faces) > 1:
            areas = faces[:, 2] * faces[:, 3]
            order = np.argsort(areas)[::-1]
            if areas[order[1]] > 0.35 * areas[order[0]]:
                raise FaceError("Mais de um rosto na imagem")
            faces = faces[order[:1]]
        row = faces[0]
        x, y, w, h = row[:4]
        re_x, le_x, nose_x = row[4], row[6], row[8]
        eye_dist = abs(le_x - re_x)
        if eye_dist < 4:
            raise FaceError("Rosto muito pequeno ou de perfil")
        yaw = float((nose_x - (re_x + le_x) / 2) / eye_dist)
        x0, y0 = max(int(x), 0), max(int(y), 0)
        crop = img[y0 : int(y + h), x0 : int(x + w)]
        gray = cv2.cvtColor(crop if crop.size else img, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        small = cv2.resize(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
        return FrameFace(img, row, float(row[14]), float(min(w, h)), yaw, sharpness, small)

    def analyze(self, frames: list[str], action: str) -> Analysis:
        """Prova de vida por desafio: quadro frontal + giro na direção pedida, mesma pessoa, com movimento real.
        Foto plana girada não altera a razão nariz/olhos (yaw), por isso não passa no desafio."""
        if action not in ACTIONS:
            raise FaceError("Desafio desconhecido")
        try:
            items = [self._frame(decode_frame(f)) for f in frames]
        except FaceError as exc:
            return Analysis(False, str(exc), None, 0.0)

        if min(i.size for i in items) < self.min_face_px:
            return Analysis(False, "Rosto muito distante da câmera", None, 0.0)

        frontal = [i for i in items if abs(i.yaw) <= FRONTAL_YAW and i.sharpness >= self.min_sharpness]
        if not frontal:
            return Analysis(False, "Nenhum quadro frontal nítido — olhe para a câmera no início", None, 0.0)

        direction = ACTIONS[action][1]
        turned = [i for i in items if i.yaw * direction >= TURN_YAW]
        wrong = [i for i in items if i.yaw * -direction >= TURN_YAW]
        if not turned:
            return Analysis(False, "Movimento solicitado não detectado", None, 0.0)
        if wrong and len(wrong) >= len(turned):
            return Analysis(False, "Movimento na direção errada", None, 0.0)

        motion = max(float(np.mean(np.abs(a.gray_small - b.gray_small))) for a, b in zip(items, items[1:]))
        if motion < MIN_MOTION:
            return Analysis(False, "Quadros sem movimento real", None, 0.0)

        best = sorted(frontal, key=lambda i: i.score * i.size * min(i.sharpness, 300), reverse=True)[:3]
        frontal_embs = [self._embed(i.image, i.row) for i in best]
        template = np.mean(frontal_embs, axis=0)
        template = template / (np.linalg.norm(template) + 1e-9)
        for i in turned[:2]:
            if float(np.dot(self._embed(i.image, i.row), template)) < SAME_PERSON_MIN:
                return Analysis(False, "Pessoa diferente entre os quadros", None, 0.0)

        top = best[0]
        quality = round(min(1.0, top.score) * min(1.0, top.size / 160) * min(1.0, top.sharpness / 120), 3)
        return Analysis(True, None, template, quality)

    @staticmethod
    def similarity(a: np.ndarray, b: np.ndarray) -> float:
        return float(np.dot(a / (np.linalg.norm(a) + 1e-9), b / (np.linalg.norm(b) + 1e-9)))
