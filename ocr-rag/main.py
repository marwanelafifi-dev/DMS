import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path

from docling.document_converter import DocumentConverter
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "service": "dms-docling"}


@app.post("/api/documents/upload")
def upload_document(file: UploadFile = File(...)) -> dict[str, int | str]:
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
