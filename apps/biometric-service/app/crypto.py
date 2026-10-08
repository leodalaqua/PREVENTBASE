import hashlib
import os

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class TemplateCipher:
    """AES-256-GCM para templates faciais. AAD amarra o template ao tenant/colaborador."""

    def __init__(self, secret: str) -> None:
        self._aes = AESGCM(hashlib.sha256(secret.encode("utf-8")).digest())

    @staticmethod
    def _aad(tenant_ref: str, subject_ref: str) -> bytes:
        return f"preventbase:{tenant_ref}:{subject_ref}".encode("utf-8")

    def encrypt(self, template: np.ndarray, tenant_ref: str, subject_ref: str) -> tuple[bytes, bytes]:
        nonce = os.urandom(12)
        data = template.astype(np.float32).tobytes()
        return nonce, self._aes.encrypt(nonce, data, self._aad(tenant_ref, subject_ref))

    def decrypt(self, nonce: bytes, blob: bytes, tenant_ref: str, subject_ref: str) -> np.ndarray:
        data = self._aes.decrypt(nonce, blob, self._aad(tenant_ref, subject_ref))
        return np.frombuffer(data, dtype=np.float32).copy()
