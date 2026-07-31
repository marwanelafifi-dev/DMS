FROM python:3.12-slim

WORKDIR /app

# curl for the compose healthcheck; shared libraries for RapidOCR/OpenCV;
# LibreOffice Writer/Impress (headless) for real Word/PowerPoint -> PDF preview
# rendering, reusing the app's existing pdf.js viewer instead of a plain-text
# reconstruction. fonts-liberation improves fidelity for Calibri/Arial-authored
# documents converted on a Linux host with no MS fonts installed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        libgl1 \
        libglib2.0-0 \
        libxcb1 \
        libreoffice-writer \
        libreoffice-impress \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# CPU-only torch (no NVIDIA/CUDA deps) — this stack runs on a GPU-less Ubuntu VM.
# Installed first so docling's own torch requirement is already satisfied.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt
RUN docling-tools models download

ENV DOCLING_ARTIFACTS_PATH=/root/.cache/docling/models

COPY main.py ./

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
