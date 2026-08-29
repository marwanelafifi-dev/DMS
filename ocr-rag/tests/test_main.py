import importlib
import os
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import ANY, patch

from fastapi.testclient import TestClient


class _FakeDocument:
    def __init__(self, markdown: str) -> None:
        self._markdown = markdown

    def export_to_markdown(self) -> str:
        return self._markdown


class _FakeConversionResult:
    def __init__(self, markdown: str) -> None:
        self.document = _FakeDocument(markdown)


class _RecordingConverter:
    def __init__(self, markdown: str) -> None:
        self.markdown = markdown
        self.converted_path: Path | None = None
        self.file_existed_during_conversion = False

    def convert(self, source: str | Path) -> _FakeConversionResult:
        self.converted_path = Path(source)
        self.file_existed_during_conversion = self.converted_path.exists()
        return _FakeConversionResult(self.markdown)


class _FakeLibreOfficeProcess:
    def __init__(self, command, **_kwargs) -> None:
        output_directory = Path(command[command.index("--outdir") + 1])
        source_path = Path(command[-1])
        (output_directory / f"{source_path.stem}.pdf").write_bytes(
            b"%PDF-1.7\nknown cached preview\n%%EOF\n"
        )
        self.pid = 12345
        self.returncode = 0

    def communicate(self, timeout=None):
        return "converted", ""

    def wait(self) -> None:
        return None


class _SlowFakeLibreOfficeProcess(_FakeLibreOfficeProcess):
    def communicate(self, timeout=None):
        time.sleep(0.2)
        return super().communicate(timeout)


class DocumentParsingApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_directory = tempfile.TemporaryDirectory()
        cls.database_path = Path(cls.temp_directory.name) / "test-dms.db"
        cls.preview_cache_path = Path(cls.temp_directory.name) / "preview-cache"
        os.environ["DMS_DB_PATH"] = str(cls.database_path)
        os.environ["DMS_PREVIEW_CACHE_DIR"] = str(cls.preview_cache_path)

        service_root = str(Path(__file__).resolve().parents[1])
        if service_root not in sys.path:
            sys.path.insert(0, service_root)

        cls.main = importlib.import_module("main")
        cls.client = TestClient(cls.main.app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp_directory.cleanup()
        os.environ.pop("DMS_DB_PATH", None)
        os.environ.pop("DMS_PREVIEW_CACHE_DIR", None)

    def test_upload_converts_to_markdown_and_removes_the_temporary_file(self) -> None:
        converter = _RecordingConverter("# Parsed policy\n\nLocal document content.")
        self.main.converter = converter

        response = self.client.post(
            "/api/documents/upload",
            files={"file": ("quality-policy.pdf", b"%PDF-local-test", "application/pdf")},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIsInstance(payload["id"], int)
        self.assertEqual(payload["filename"], "quality-policy.pdf")
        self.assertEqual(payload["content"], "# Parsed policy\n\nLocal document content.")
        self.assertTrue(converter.file_existed_during_conversion)
        self.assertEqual(converter.converted_path.suffix, ".pdf")
        self.assertFalse(converter.converted_path.exists())

    def test_upload_removes_the_temporary_file_when_copying_fails(self) -> None:
        created_path: Path | None = None
        named_temporary_file = self.main.tempfile.NamedTemporaryFile

        def record_temporary_file(*args, **kwargs):
            nonlocal created_path
            temporary_file = named_temporary_file(*args, **kwargs)
            created_path = Path(temporary_file.name)
            return temporary_file

        with (
            patch.object(
                self.main.tempfile,
                "NamedTemporaryFile",
                side_effect=record_temporary_file,
            ),
            patch.object(
                self.main.shutil,
                "copyfileobj",
                side_effect=OSError("copy failed"),
            ),
        ):
            response = self.client.post(
                "/api/documents/upload",
                files={"file": ("broken.pdf", b"%PDF-broken", "application/pdf")},
            )

        self.assertEqual(response.status_code, 500)
        self.assertIsNotNone(created_path)
        self.assertFalse(created_path.exists())

    def test_search_returns_documents_matching_parsed_content(self) -> None:
        self.main.converter = _RecordingConverter(
            "# Calibration record\n\nUnique local torque verification phrase."
        )
        upload_response = self.client.post(
            "/api/documents/upload",
            files={"file": ("calibration-record.docx", b"local-docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
        uploaded = upload_response.json()

        response = self.client.get(
            "/api/documents/search",
            params={"q": "TORQUE verification"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {
                    "id": uploaded["id"],
                    "document_id": None,
                    "filename": "calibration-record.docx",
                    "content": "# Calibration record\n\nUnique local torque verification phrase.",
                    "created_at": ANY,
                }
            ],
        )

    def test_document_lookup_returns_only_the_newest_exact_document_index(self) -> None:
        self.main.converter = _RecordingConverter("# First indexed version")
        first = self.client.post(
            "/api/documents/upload",
            files={"file": ("incident-plan-v1.docx", b"first", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"document_id": "incident-response-plan"},
        )
        self.assertEqual(first.status_code, 200)

        self.main.converter = _RecordingConverter("# Current incident response plan")
        latest = self.client.post(
            "/api/documents/upload",
            files={"file": ("incident-plan-v2.docx", b"second", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"document_id": "incident-response-plan"},
        )
        self.assertEqual(latest.status_code, 200)

        response = self.client.get("/api/documents/by-document/incident-response-plan")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], latest.json()["id"])
        self.assertEqual(response.json()["content"], "# Current incident response plan")
        self.assertEqual(
            self.client.get("/api/documents/by-document/not-authorized-or-missing").status_code,
            404,
        )

    def test_index_inventory_tracks_the_newest_dms_version(self) -> None:
        self.main.converter = _RecordingConverter("# Version-aware OCR")
        response = self.client.post(
            "/api/documents/upload",
            files={"file": ("version-aware.docx", b"versioned", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"document_id": "version-aware-document", "version_id": "version-42"},
        )
        self.assertEqual(response.status_code, 200)
        inventory = self.client.get("/api/documents/index-inventory")
        self.assertEqual(inventory.status_code, 200)
        self.assertIn(
            {"document_id": "version-aware-document", "version_id": "version-42"},
            inventory.json(),
        )

    def test_delete_removes_only_the_requested_document_index(self) -> None:
        self.main.converter = _RecordingConverter("# Indexed content\n\nUnique purge phrase.")
        first = self.client.post(
            "/api/documents/upload",
            files={"file": ("first.docx", b"first", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"document_id": "document-to-purge"},
        )
        second = self.client.post(
            "/api/documents/upload",
            files={"file": ("second.docx", b"second", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"document_id": "document-to-keep"},
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)

        response = self.client.delete("/api/documents/document-to-purge")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True, "deleted": 1})
        remaining = self.client.get(
            "/api/documents/search",
            params={"q": "Unique purge phrase"},
        ).json()
        self.assertEqual([item["document_id"] for item in remaining], ["document-to-keep"])

    def test_convert_returns_markdown_without_adding_a_search_record(self) -> None:
        self.main.converter = _RecordingConverter(
            "# Preview only\n\nThis conversion must not be indexed."
        )

        response = self.client.post(
            "/api/documents/convert",
            files={
                "file": (
                    "preview-only.pptx",
                    b"local-pptx",
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                )
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "filename": "preview-only.pptx",
                "content": "# Preview only\n\nThis conversion must not be indexed.",
            },
        )
        search_response = self.client.get(
            "/api/documents/search",
            params={"q": "must not be indexed"},
        )
        self.assertEqual(search_response.status_code, 200)
        self.assertEqual(search_response.json(), [])

    def test_pdf_conversion_reuses_a_cached_preview_for_identical_content(self) -> None:
        files = {
            "file": (
                "macro-report.docm",
                b"same-macro-enabled-word-content",
                "application/vnd.ms-word.document.macroenabled.12",
            )
        }

        with patch.object(self.main.subprocess, "Popen", _FakeLibreOfficeProcess):
            first_response = self.client.post("/api/documents/convert-to-pdf", files=files)
            second_response = self.client.post("/api/documents/convert-to-pdf", files=files)

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(
            first_response.content,
            b"%PDF-1.7\nknown cached preview\n%%EOF\n",
        )
        self.assertEqual(second_response.content, first_response.content)
        self.assertEqual(first_response.headers["x-preview-cache"], "MISS")
        self.assertEqual(second_response.headers["x-preview-cache"], "HIT")

    def test_concurrent_pdf_requests_share_one_conversion(self) -> None:
        request_start = threading.Barrier(2)

        def request_preview():
            request_start.wait()
            with TestClient(self.main.app) as client:
                return client.post(
                    "/api/documents/convert-to-pdf",
                    files={
                        "file": (
                            "concurrent-macro-report.docm",
                            b"unique-concurrent-macro-enabled-word-content",
                            "application/vnd.ms-word.document.macroenabled.12",
                        )
                    },
                )

        with (
            patch.object(self.main.subprocess, "Popen", _SlowFakeLibreOfficeProcess),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            responses = list(executor.map(lambda _index: request_preview(), range(2)))

        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(responses[0].content, responses[1].content)
        self.assertEqual(
            sorted(response.headers["x-preview-cache"] for response in responses),
            ["HIT", "MISS"],
        )

    def test_cors_allows_the_local_frontend_to_upload(self) -> None:
        response = self.client.options(
            "/api/documents/upload",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "*")


if __name__ == "__main__":
    unittest.main()
