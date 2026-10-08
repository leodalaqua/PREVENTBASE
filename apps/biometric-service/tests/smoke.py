"""Smoke test do motor facial dentro do container: python -m tests.smoke"""
import base64
import os
import urllib.request

import cv2
import numpy as np

from app.face import FaceEngine, decode_frame

IMAGES = {
    "lena": "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/lena.jpg",
    "messi": "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/messi5.jpg",
}


def fetch(url: str) -> str:
    return base64.b64encode(urllib.request.urlopen(url, timeout=30).read()).decode()


def main() -> None:
    engine = FaceEngine(__import__("pathlib").Path(os.environ.get("BIOMETRIC_MODELS_DIR", "/models")), 60, 10)
    frames = {k: fetch(v) for k, v in IMAGES.items()}
    feats = {}
    for name, b64 in frames.items():
        img = decode_frame(b64)
        try:
            f = engine._frame(img)  # noqa: SLF001
        except Exception as exc:  # noqa: BLE001
            print(name, "frame error:", exc)
            continue
        feats[name] = engine._embed(img, f.row)  # noqa: SLF001
        print(f"{name}: score={f.score:.2f} size={f.size:.0f} yaw={f.yaw:+.3f} sharp={f.sharpness:.0f}")
        flipped = cv2.flip(img, 1)
        ff = engine._frame(flipped)  # noqa: SLF001
        print(f"{name} (espelhada): yaw={ff.yaw:+.3f}")

    if "lena" in feats:
        print("self-sim lena:", round(float(np.dot(feats["lena"], feats["lena"])), 3))
    if len(feats) == 2:
        print("lena x messi:", round(float(np.dot(feats["lena"], feats["messi"])), 3))

    static = engine.analyze([frames["lena"]] * 6, "TURN_LEFT")
    print("estático (foto repetida):", static.liveness, static.reason)


if __name__ == "__main__":
    main()
