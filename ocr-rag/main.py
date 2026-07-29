import os
import shutil
import sqlite3
import subprocess
import tempfile
from contextlib import closing
from pathlib import Path

from docling.document_converter import DocumentConverter
from fastapi import FastAPI, File, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware


DATABASE_PATH = Path(
    os.environ.get("DMS_DB_PATH", Path(__file__).with_name("dms.db"))
).resolve()

converter = DocumentConverter()

app = FastAPI(title="DMS Local Document Parsing Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def initialize_database() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY,
                filename TEXT,
                content TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.commit()


initialize_database()


def convert_uploaded_file(file: UploadFile) -> tuple[str, str]:
    filename = Path(file.filename or "document").name
    suffix = Path(filename).suffix
    temporary_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary_file:
            temporary_path = Path(temporary_file.name)
            shutil.copyfileobj(file.file, temporary_file)

        result = converter.convert(temporary_path)
        markdown_content = result.document.export_to_markdown()
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Document conversion failed: {error}",
        ) from error
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    return filename, markdown_content


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "service": "dms-docling"}


@app.post("/api/documents/convert-to-pdf")
def convert_to_pdf(file: UploadFile = File(...)) -> Response:
    """
    Real Word/PowerPoint rendering in the browser: converts the uploaded file to
    PDF with headless LibreOffice, and the frontend renders that PDF with the
    same pdf.js viewer it already uses for real .pdf uploads — true layout,
    fonts, images, and tables instead of the old plain-text reconstruction.
    """
    filename = Path(file.filename or "document").name
    work_dir = Path(tempfile.mkdtemp(prefix="lo_convert_"))
    # Each conversion gets its own LibreOffice user profile — headless soffice
    # refuses to start a second instance against a profile that's already in use,
    # which would otherwise make concurrent preview requests fail intermittently.
    profile_dir = Path(tempfile.mkdtemp(prefix="lo_profile_"))

    try:
        input_path = work_dir / filename
        with open(input_path, "wb") as destination:
            shutil.copyfileobj(file.file, destination)

        result = subprocess.run(
            [
                "soffice",
                "--headless",
                "--norestore",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to", "pdf",
                "--outdir", str(work_dir),
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=90,
        )

        pdf_path = input_path.with_suffix(".pdf")
        if result.returncode != 0 or not pdf_path.exists():
            raise HTTPException(
                status_code=500,
                detail=f"PDF conversion failed: {result.stderr or result.stdout}",
            )

        pdf_bytes = pdf_path.read_bytes()
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        shutil.rmtree(profile_dir, ignore_errors=True)

    return Response(content=pdf_bytes, media_type="application/pdf")


@app.post("/api/documents/convert")
def convert_document(file: UploadFile = File(...)) -> dict[str, str]:
    filename, markdown_content = convert_uploaded_file(file)
    return {"filename": filename, "content": markdown_content}


@app.post("/api/documents/upload")
def upload_document(file: UploadFile = File(...)) -> dict[str, int | str]:
    filename, markdown_content = convert_uploaded_file(file)
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        cursor = connection.execute(
            "INSERT INTO documents (filename, content) VALUES (?, ?)",
            (filename, markdown_content),
        )
        doc_id = cursor.lastrowid
        connection.commit()

    return {
        "id": int(doc_id),
        "filename": filename,
        "content": markdown_content,
    }


@app.get("/api/documents/search")
def search_documents(q: str = Query(...)) -> list[dict[str, int | str]]:
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, filename, content, created_at
            FROM documents
            WHERE content LIKE ? COLLATE NOCASE
            ORDER BY created_at DESC, id DESC
            """,
            (f"%{q}%",),
        ).fetchall()

    return [dict(row) for row in rows]
