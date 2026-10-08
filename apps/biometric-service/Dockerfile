FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    BIOMETRIC_MODELS_DIR=/models BIOMETRIC_DATA_DIR=/data

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

RUN mkdir -p /models /data \
    && curl -fsSL -o /models/face_detection_yunet_2023mar.onnx \
       https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
    && curl -fsSL -o /models/face_recognition_sface_2021dec.onnx \
       https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx \
    && test $(stat -c %s /models/face_detection_yunet_2023mar.onnx) -gt 100000 \
    && test $(stat -c %s /models/face_recognition_sface_2021dec.onnx) -gt 1000000

COPY app ./app
RUN useradd -r -u 10001 bio && chown -R bio /data
USER bio

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
