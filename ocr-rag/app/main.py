"""DMS OCR + local RAG sidecar (Phase 0 scaffold).

Owns nothing security-related: the .NET API handles all auth/RBAC and calls this
service internally. Phase 5 adds Tesseract/PaddleOCR extraction; Phase 6 adds the
permission-aware local RAG (DB pre-filter BEFORE vector search).
"""

from fastapi import FastAPI

app = FastAPI(title="DMS OCR/RAG Service", version="0.0.0")


@app.get("/health")
def health():
    return {"status": "healthy", "service": "dms-ocr-rag", "phase": 0}


@app.get("/")
def root():
    return {"message": "Enterprise DMS v7.4 — OCR/RAG sidecar (Phase 0 scaffold)"}
