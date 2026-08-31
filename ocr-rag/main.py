import hashlib
import logging
import os
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import threading
from contextlib import closing
from pathlib import Path

from docling.document_converter import DocumentConverter
from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware


logger = logging.getLogger("dms.preview")
DATABASE_PATH = Path(
    os.environ.get("DMS_DB_PATH", Path(__file__).with_name("dms.db"))
).resolve()
PREVIEW_CACHE_DIR = Path(
    os.environ.get("DMS_PREVIEW_CACHE_DIR", DATABASE_PATH.parent / "preview-cache")
).resolve()
PREVIEW_CACHE_FORMAT_VERSION = os.environ.get(
    "DMS_PREVIEW_CACHE_FORMAT_VERSION", "libreoffice-pdf-v1"
)
PREVIEW_CACHE_MAX_BYTES = int(
    os.environ.get("DMS_PREVIEW_CACHE_MAX_BYTES", str(5 * 1024 * 1024 * 1024))
)

converter = DocumentConverter()

# Headless LibreOffice conversions don't scale by just launching more of them at
# once — under real concurrent load, enough simultaneous `soffice` instances make
# every single one of them slower than the fixed subprocess timeout below, so
# they all fail together instead of queueing gracefully. This bounds how many
# run at once; requests beyond that wait briefly for a free slot instead of
# piling on more processes.
LIBREOFFICE_MAX_CONCURRENT = int(os.environ.get("LIBREOFFICE_MAX_CONCURRENT", "3"))
LIBREOFFICE_QUEUE_WAIT_SECONDS = int(os.environ.get("LIBREOFFICE_QUEUE_WAIT_SECONDS", "60"))
LIBREOFFICE_CONVERSION_TIMEOUT_SECONDS = int(
    os.environ.get("LIBREOFFICE_CONVERSION_TIMEOUT_SECONDS", "90")
)
PREVIEW_CACHE_WAIT_SECONDS = (
    LIBREOFFICE_QUEUE_WAIT_SECONDS + LIBREOFFICE_CONVERSION_TIMEOUT_SECONDS + 5
)
_libreoffice_semaphore = threading.BoundedSemaphore(LIBREOFFICE_MAX_CONCURRENT)
_preview_cache_locks_guard = threading.Lock()
_preview_cache_storage_guard = threading.Lock()

# Set by initialize_database() once at startup based on whether this SQLite
# build actually has FTS5 compiled in. When False, search falls back to the
# original substring LIKE scan instead of failing outright.
FTS5_AVAILABLE = False


class PreviewCacheLockEntry:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.users = 0


_preview_cache_locks: dict[str, PreviewCacheLockEntry] = {}

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
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(documents)").fetchall()
        }
        if "document_id" not in columns:
            connection.execute("ALTER TABLE documents ADD COLUMN document_id TEXT")
        if "version_id" not in columns:
            connection.execute("ALTER TABLE documents ADD COLUMN version_id TEXT")
        connection.commit()

        global FTS5_AVAILABLE
        fts_table_existed = (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents_fts'"
            ).fetchone()
            is not None
        )
        try:
            connection.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
                    filename, content, content='documents', content_rowid='id'
                )
                """
            )
            # Rows are append-only elsewhere in this file (INSERT on upload,
            # DELETE on document purge) — no UPDATE ever touches `documents`,
            # so only these two triggers are needed to keep the index in sync.
            connection.execute(
                """
                CREATE TRIGGER IF NOT EXISTS documents_fts_ai AFTER INSERT ON documents BEGIN
                    INSERT INTO documents_fts(rowid, filename, content)
                    VALUES (new.id, new.filename, new.content);
                END
                """
            )
            connection.execute(
                """
                CREATE TRIGGER IF NOT EXISTS documents_fts_ad AFTER DELETE ON documents BEGIN
                    INSERT INTO documents_fts(documents_fts, rowid, filename, content)
                    VALUES ('delete', old.id, old.filename, old.content);
                END
                """
            )
            if not fts_table_existed:
                connection.execute(
                    "INSERT INTO documents_fts(rowid, filename, content) "
                    "SELECT id, filename, content FROM documents"
                )
            connection.commit()
            FTS5_AVAILABLE = True
        except sqlite3.OperationalError as error:
            logger.warning(
                "FTS5 is not available in this SQLite build; search will fall back "
                "to substring matching: %s",
                error,
            )
            FTS5_AVAILABLE = False


initialize_database()
PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def read_cached_pdf(cache_path: Path) -> bytes | None:
    with _preview_cache_storage_guard:
        try:
            cached_pdf = cache_path.read_bytes()
        except OSError:
            return None

        if not (
            cached_pdf.startswith(b"%PDF-")
            and cached_pdf.rstrip().endswith(b"%%EOF")
        ):
            cache_path.unlink(missing_ok=True)
            return None

        try:
            os.utime(cache_path, None)
        except OSError:
            pass
        return cached_pdf


def write_cached_pdf(cache_path: Path, pdf_bytes: bytes) -> bool:
    if len(pdf_bytes) > PREVIEW_CACHE_MAX_BYTES:
        return False

    temporary_cache_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=PREVIEW_CACHE_DIR,
            prefix=f"{cache_path.stem}_",
            suffix=".tmp",
            delete=False,
        ) as temporary_cache_file:
            temporary_cache_path = Path(temporary_cache_file.name)
            temporary_cache_file.write(pdf_bytes)

        with _preview_cache_storage_guard:
            cached_files = sorted(
                PREVIEW_CACHE_DIR.glob("*.pdf"),
                key=lambda path: path.stat().st_mtime,
            )
            cached_bytes = sum(path.stat().st_size for path in cached_files)
            for oldest_cache_path in cached_files:
                if cached_bytes + len(pdf_bytes) <= PREVIEW_CACHE_MAX_BYTES:
                    break
                oldest_size = oldest_cache_path.stat().st_size
                oldest_cache_path.unlink(missing_ok=True)
                cached_bytes -= oldest_size

            os.replace(temporary_cache_path, cache_path)
        return True
    except OSError as error:
        logger.warning("Preview PDF could not be cached at %s: %s", cache_path, error)
        return False
    finally:
        if temporary_cache_path is not None:
            temporary_cache_path.unlink(missing_ok=True)


def acquire_preview_cache_lock(cache_key: str) -> PreviewCacheLockEntry | None:
    with _preview_cache_locks_guard:
        entry = _preview_cache_locks.setdefault(cache_key, PreviewCacheLockEntry())
        entry.users += 1

    if entry.lock.acquire(timeout=PREVIEW_CACHE_WAIT_SECONDS):
        return entry

    with _preview_cache_locks_guard:
        entry.users -= 1
        if entry.users == 0 and _preview_cache_locks.get(cache_key) is entry:
            _preview_cache_locks.pop(cache_key, None)
    return None


def release_preview_cache_lock(cache_key: str, entry: PreviewCacheLockEntry) -> None:
    entry.lock.release()
    with _preview_cache_locks_guard:
        entry.users -= 1
        if entry.users == 0 and _preview_cache_locks.get(cache_key) is entry:
            _preview_cache_locks.pop(cache_key, None)


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
    profile_dir: Path | None = None
    acquired_conversion_slot = False
    cache_key: str | None = None
    cache_lock_entry: PreviewCacheLockEntry | None = None

    try:
        input_path = work_dir / filename
        source_hash = hashlib.sha256()
        with open(input_path, "wb") as destination:
            while chunk := file.file.read(1024 * 1024):
                destination.write(chunk)
                source_hash.update(chunk)

        source_digest = source_hash.hexdigest()
        cache_identity = (
            f"{PREVIEW_CACHE_FORMAT_VERSION}\0{input_path.suffix.lower()}\0{source_digest}"
        )
        cache_key = hashlib.sha256(cache_identity.encode("utf-8")).hexdigest()
        cache_path = PREVIEW_CACHE_DIR / f"{cache_key}.pdf"
        cache_lock_entry = acquire_preview_cache_lock(cache_key)
        if cache_lock_entry is None:
            raise HTTPException(
                status_code=503,
                detail="This document preview is already being prepared. Please try again shortly.",
            )

        # The lock serializes duplicate requests for the same source. Re-check
        # after acquiring it because another request may just have populated the
        # cache while this one was waiting.
        cached_pdf = read_cached_pdf(cache_path)
        if cached_pdf is not None:
            return Response(
                content=cached_pdf,
                media_type="application/pdf",
                headers={"X-Preview-Cache": "HIT"},
            )

        # Each conversion gets its own LibreOffice user profile — headless soffice
        # refuses to start a second instance against a profile that's already in use.
        profile_dir = Path(tempfile.mkdtemp(prefix="lo_profile_"))

        # Cache hits bypass this limited resource entirely. A genuine cache miss
        # still waits for a bounded conversion slot instead of overloading soffice.
        acquired_conversion_slot = _libreoffice_semaphore.acquire(
            timeout=LIBREOFFICE_QUEUE_WAIT_SECONDS
        )
        if not acquired_conversion_slot:
            raise HTTPException(
                status_code=503,
                detail="The document preview service is busy converting other files. Please try again shortly.",
            )

        # Run in its own process group (start_new_session) so a timeout can kill
        # soffice's actual worker process, not just the launcher script — killing
        # only the launcher left the real conversion running forever as an
        # unreachable defunct/zombie process under concurrent load.
        process = subprocess.Popen(
            [
                "soffice",
                "--headless",
                "--norestore",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to", "pdf",
                "--outdir", str(work_dir),
                str(input_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(
                timeout=LIBREOFFICE_CONVERSION_TIMEOUT_SECONDS
            )
            returncode = process.returncode
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise HTTPException(
                status_code=500,
                detail="PDF conversion timed out.",
            )

        pdf_path = input_path.with_suffix(".pdf")
        if returncode != 0 or not pdf_path.exists():
            raise HTTPException(
                status_code=500,
                detail=f"PDF conversion failed: {stderr or stdout}",
            )

        pdf_bytes = pdf_path.read_bytes()
        write_cached_pdf(cache_path, pdf_bytes)
    finally:
        if acquired_conversion_slot:
            _libreoffice_semaphore.release()
        if cache_key is not None and cache_lock_entry is not None:
            release_preview_cache_lock(cache_key, cache_lock_entry)
        shutil.rmtree(work_dir, ignore_errors=True)
        if profile_dir is not None:
            shutil.rmtree(profile_dir, ignore_errors=True)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"X-Preview-Cache": "MISS"},
    )


@app.post("/api/documents/convert")
def convert_document(file: UploadFile = File(...)) -> dict[str, str]:
    filename, markdown_content = convert_uploaded_file(file)
    return {"filename": filename, "content": markdown_content}


@app.post("/api/documents/upload")
def upload_document(
    file: UploadFile = File(...),
    document_id: str | None = Form(default=None),
    version_id: str | None = Form(default=None),
) -> dict[str, int | str | None]:
    filename, markdown_content = convert_uploaded_file(file)
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        cursor = connection.execute(
            "INSERT INTO documents (document_id, version_id, filename, content) VALUES (?, ?, ?, ?)",
            (document_id, version_id, filename, markdown_content),
        )
        doc_id = cursor.lastrowid
        connection.commit()

    return {
        "id": int(doc_id),
        "document_id": document_id,
        "version_id": version_id,
        "filename": filename,
        "content": markdown_content,
    }


@app.delete("/api/documents/{document_id}")
def delete_document_index(document_id: str) -> dict[str, int | bool]:
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        cursor = connection.execute(
            "DELETE FROM documents WHERE document_id = ?",
            (document_id,),
        )
        connection.commit()
    return {"success": True, "deleted": cursor.rowcount}


def build_fts5_match_query(term: str) -> str | None:
    """Wrap the caller's single keyword as a quoted FTS5 phrase-prefix query.

    Always quoting the term prevents it from being interpreted as FTS5 boolean/
    column-filter syntax (AND/OR/NOT/column:), and the trailing `*` keeps the
    same "partial word" recall the old substring LIKE search had (e.g. "polic"
    still matches "policy"/"policies").
    """
    cleaned = term.replace('"', '""').strip()
    if not cleaned:
        return None
    return f'"{cleaned}"*'


@app.get("/api/documents/search")
def search_documents(q: str = Query(...)) -> list[dict[str, int | str | float | None]]:
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        connection.row_factory = sqlite3.Row

        if FTS5_AVAILABLE:
            match_query = build_fts5_match_query(q)
            if match_query is None:
                return []
            try:
                # bm25() and a window function (ROW_NUMBER) cannot be evaluated in
                # the same SELECT — SQLite's FTS5 auxiliary functions only work in a
                # plain, unwindowed query with a direct MATCH constraint. Compute the
                # rank in its own inner query first, then apply ROW_NUMBER() in a
                # second layer over the already-materialized `rank` column.
                rows = connection.execute(
                    """
                    SELECT id, document_id, filename, content, created_at, rank
                    FROM (
                        SELECT
                            id, document_id, filename, content, created_at, rank,
                            ROW_NUMBER() OVER (
                                PARTITION BY document_id
                                ORDER BY id DESC
                            ) AS newest_match_for_document
                        FROM (
                            SELECT
                                d.id AS id,
                                d.document_id AS document_id,
                                d.filename AS filename,
                                d.content AS content,
                                d.created_at AS created_at,
                                -bm25(documents_fts, 10.0, 1.0) AS rank
                            FROM documents_fts
                            JOIN documents d ON d.id = documents_fts.rowid
                            WHERE documents_fts MATCH ?
                        )
                    )
                    WHERE newest_match_for_document = 1
                    ORDER BY rank DESC
                    LIMIT 25
                    """,
                    (match_query,),
                ).fetchall()
                return [dict(row) for row in rows]
            except sqlite3.OperationalError as error:
                logger.warning(
                    "FTS5 search query failed, falling back to substring matching: %s",
                    error,
                )

        rows = connection.execute(
            """
            SELECT id, document_id, filename, content, created_at, NULL AS rank
            FROM documents
            WHERE content LIKE ? COLLATE NOCASE
            ORDER BY created_at DESC, id DESC
            LIMIT 25
            """,
            (f"%{q}%",),
        ).fetchall()

    return [dict(row) for row in rows]


@app.get("/api/documents/by-document/{document_id}")
def get_document_index(document_id: str) -> dict[str, int | str | None]:
    """Return only the newest OCR row for one already-authorized DMS document."""
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT id, document_id, version_id, filename, content, created_at
            FROM documents
            WHERE document_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (document_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document OCR index not found")
    return dict(row)


@app.get("/api/documents/indexed-ids")
def get_indexed_document_ids() -> list[str]:
    """Return stable DMS IDs that currently have at least one OCR row."""
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        rows = connection.execute(
            "SELECT DISTINCT document_id FROM documents WHERE document_id IS NOT NULL AND document_id <> ''"
        ).fetchall()
    return [str(row[0]) for row in rows]


@app.get("/api/documents/index-inventory")
def get_index_inventory() -> list[dict[str, str | None]]:
    """Return the newest indexed DMS version for each stable document ID."""
    with closing(sqlite3.connect(DATABASE_PATH)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT document_id, version_id
            FROM documents newest
            WHERE document_id IS NOT NULL AND document_id <> ''
              AND id = (SELECT MAX(id) FROM documents candidate WHERE candidate.document_id = newest.document_id)
            """
        ).fetchall()
    return [dict(row) for row in rows]
