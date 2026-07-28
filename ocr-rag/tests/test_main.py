import importlib
import os
import sys
import tempfile
import unittest
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


class DocumentParsingApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_directory = tempfile.TemporaryDirectory()
        cls.database_path = Path(cls.temp_directory.name) / "test-dms.db"
        os.environ["DMS_DB_PATH"] = str(cls.database_path)

        service_root = str(Path(__file__).resolve().parents[1])
        if service_root not in sys.path:
            sys.path.insert(0, service_root)

        cls.main = importlib.import_module("main")
        cls.client = TestClient(cls.main.app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp_directory.cleanup()
        os.environ.pop("DMS_DB_PATH", None)

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
                    "filename": "calibration-record.docx",
                    "content": "# Calibration record\n\nUnique local torque verification phrase.",
                    "created_at": ANY,
                }
            ],
        )

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
