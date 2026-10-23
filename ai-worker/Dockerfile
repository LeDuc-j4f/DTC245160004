FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 \
        libgl1 \
        libgomp1 \
        ca-certificates \
        build-essential \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 app && useradd -u 1000 -g 1000 -m app

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download buffalo_l model (skipped on offline builds)
RUN python -c "from insightface.app import FaceAnalysis; \
    fa = FaceAnalysis(name='buffalo_l', root='/app/models', providers=['CPUExecutionProvider']); \
    fa.prepare(ctx_id=0, det_size=(640,640))" || echo "WARN: buffalo_l pre-download skipped"

COPY --chown=app:app . .

RUN mkdir -p /app/uploads /app/models && chown -R app:app /app /home/app

USER app
WORKDIR /app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

