"""Read-only contract tests for the legacy metadata history API.

These tests target the running local API and the five fixed KnowledgeTree
pilot mappings.  They mint short-lived development JWTs from the checked-in
local appsettings rather than logging in, so validation does not update login
timestamps or audit data.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import subprocess
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
APP_SETTINGS = REPO_ROOT / "api" / "appsettings.json"
LOCAL_ENV = REPO_ROOT / ".env"
API_BASE_URL = "http://127.0.0.1:8080/api"

ADMIN = {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "system@si-ware.com",
    "name": "System Admin",
}
RESTRICTED_USER = {
    "id": "cbbfbd87-989a-58d8-99f4-317c4c1d3a06",
    "email": "mina.gad@si-ware.com",
    "name": "Mina Gad",
}

PILOT_DOCUMENTS = {
    230: {
        "new_id": "4f4cdd06-0ce3-556a-8232-b199898d1941",
        "snapshots": 16,
        "current_metadata_id": 9316,
        "current_content_id": 3390,
    },
    177: {
        "new_id": "fde5493c-f00a-52e3-b752-9ac36afa42d6",
        "snapshots": 4,
        "current_metadata_id": 714,
        "current_content_id": 273,
    },
    238: {
        "new_id": "f88e136e-c9f8-52ab-a67c-4d795e850796",
        "snapshots": 15,
        "current_metadata_id": 9463,
        "current_content_id": 3445,
    },
    497: {
        "new_id": "d2d7f714-c34d-53ac-8a63-48dfdb9355a9",
        "snapshots": 5,
        "current_metadata_id": 2857,
        "current_content_id": 1088,
    },
    24: {
        "new_id": "e3155116-692d-519b-b1b2-57188de1e52b",
        "snapshots": 26,
        "current_metadata_id": 9223,
        "current_content_id": 3358,
    },
}


def _base64url(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def development_token(user: dict[str, str]) -> str:
    settings = json.loads(APP_SETTINGS.read_text(encoding="utf-8"))
    jwt = settings["Jwt"]
    secret = jwt["Secret"]
    if LOCAL_ENV.exists():
        for raw_line in LOCAL_ENV.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() == "JWT_SECRET" and value.strip():
                secret = value.strip().strip('"').strip("'")
                break
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "name": user["name"],
        "issued_at": str(now),
        "nbf": now - 1,
        "exp": now + 300,
        "iss": jwt["Issuer"],
        "aud": jwt["Audience"],
    }
    unsigned = ".".join(
        _base64url(json.dumps(part, separators=(",", ":")).encode("utf-8"))
        for part in (header, payload)
    )
    signature = hmac.new(
        secret.encode("utf-8"), unsigned.encode("ascii"), hashlib.sha256
    ).digest()
    return f"{unsigned}.{_base64url(signature)}"


def get_json(path: str, token: str | None = None) -> tuple[int, dict]:
    request = urllib.request.Request(f"{API_BASE_URL}{path}")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        payload = error.read()
        return error.code, json.loads(payload) if payload else {}


def _local_env_value(name: str, default: str) -> str:
    if not LOCAL_ENV.exists():
        return default

    for raw_line in LOCAL_ENV.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == name and value.strip():
            return value.strip().strip('"').strip("'")
    return default


def archived_snapshot_rows(legacy_document_id: int) -> list[dict]:
    """Read the immutable archive directly for an end-to-end fidelity check."""

    database_user = _local_env_value("POSTGRES_USER", "dms_app")
    database_name = _local_env_value("POSTGRES_DB", "dms")
    query = f"""
        SELECT json_build_object(
            'metadataVersionId', legacy_metadata_version_id,
            'metadataVersion', metadata_sequence,
            'legacyContentVersionId', legacy_content_version_id,
            'isCurrentAtMigration', is_current_snapshot,
            'sourceSystem', source_system,
            'rawMetadata', raw_metadata
        )::text
        FROM dms_legacy_metadata_snapshots
        WHERE source_system = 'KnowledgeTree'
          AND legacy_document_id = {int(legacy_document_id)}
        ORDER BY metadata_sequence DESC, legacy_metadata_version_id DESC;
    """
    result = subprocess.run(
        [
            "docker",
            "compose",
            "exec",
            "-T",
            "postgres",
            "psql",
            "--username",
            database_user,
            "--dbname",
            database_name,
            "--tuples-only",
            "--no-align",
            "--command",
            query,
        ],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]


def legacy_field_value(value: object) -> str | None:
    if value is None or isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class LegacyMetadataHistoryApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.admin_token = development_token(ADMIN)
        cls.restricted_token = development_token(RESTRICTED_USER)

    def test_all_pilot_documents_return_only_their_complete_archive(self) -> None:
        for legacy_document_id, expected in PILOT_DOCUMENTS.items():
            with self.subTest(legacy_document_id=legacy_document_id):
                status, body = get_json(
                    f"/documents/{expected['new_id']}/legacy-metadata-history",
                    self.admin_token,
                )

                self.assertEqual(status, 200, body)
                self.assertTrue(body["success"])
                data = body["data"]
                self.assertTrue(data["hasLegacyMetadataHistory"])
                self.assertEqual(data["legacyDocumentId"], legacy_document_id)
                self.assertEqual(data["sourceSystem"], "KnowledgeTree")

                snapshots = data["snapshots"]
                self.assertEqual(len(snapshots), expected["snapshots"])
                self.assertEqual(
                    [snapshot["metadataVersion"] for snapshot in snapshots],
                    sorted(
                        [snapshot["metadataVersion"] for snapshot in snapshots],
                        reverse=True,
                    ),
                )
                self.assertEqual(
                    len({snapshot["metadataVersionId"] for snapshot in snapshots}),
                    len(snapshots),
                )

                # Compare every returned snapshot and every dynamically stored
                # field with the immutable archive itself. This detects missing
                # snapshots, cross-document mixing, and filtering of old or
                # unsupported KnowledgeTree fields.
                archived_rows = archived_snapshot_rows(legacy_document_id)
                self.assertEqual(
                    [snapshot["metadataVersionId"] for snapshot in snapshots],
                    [row["metadataVersionId"] for row in archived_rows],
                )
                for snapshot, archived in zip(snapshots, archived_rows, strict=True):
                    self.assertEqual(
                        snapshot["metadataVersion"], archived["metadataVersion"]
                    )
                    self.assertEqual(
                        snapshot["legacyContentVersionId"],
                        archived["legacyContentVersionId"],
                    )
                    self.assertEqual(
                        snapshot["isCurrentAtMigration"],
                        archived["isCurrentAtMigration"],
                    )
                    self.assertEqual(snapshot["sourceSystem"], archived["sourceSystem"])

                    returned_fields = {
                        field["name"]: field["value"] for field in snapshot["fields"]
                    }
                    for name, value in archived["rawMetadata"].get("fields", {}).items():
                        self.assertIn(name, returned_fields)
                        self.assertEqual(returned_fields[name], legacy_field_value(value))

                current = [
                    snapshot
                    for snapshot in snapshots
                    if snapshot["isCurrentAtMigration"]
                ]
                self.assertEqual(len(current), 1)
                self.assertEqual(
                    current[0]["metadataVersionId"],
                    expected["current_metadata_id"],
                )
                self.assertEqual(
                    current[0]["legacyContentVersionId"],
                    expected["current_content_id"],
                )

                for snapshot in snapshots:
                    self.assertEqual(snapshot["sourceSystem"], "KnowledgeTree")
                    field_names = {field["name"] for field in snapshot["fields"]}
                    self.assertIn("Title", field_names)
                    self.assertIn("Authors", field_names)
                    self.assertIn("IP number", field_names)
                    self.assertIn("Document Type", field_names)

    def test_changed_historical_values_are_not_collapsed_or_filtered(self) -> None:
        document_id = PILOT_DOCUMENTS[230]["new_id"]
        status, body = get_json(
            f"/documents/{document_id}/legacy-metadata-history", self.admin_token
        )
        self.assertEqual(status, 200, body)

        by_version = {
            snapshot["metadataVersion"]: {
                field["name"]: field["value"] for field in snapshot["fields"]
            }
            for snapshot in body["data"]["snapshots"]
        }
        self.assertEqual(
            by_version[7]["Authors"], "Bassem Mortada, Mostafa Medhat"
        )
        self.assertEqual(by_version[7]["Description"], "System Requirements Document")
        self.assertEqual(by_version[7]["Tag"], "MEMS SRD")
        self.assertEqual(by_version[8]["Authors"], "Mostafa Medhat")
        self.assertEqual(
            by_version[8]["Description"], "Third MOEMS Design Review"
        )
        self.assertEqual(by_version[8]["Tag"], "MOEMS,3rd MDR")

    def test_endpoint_uses_the_same_document_view_permission_boundary(self) -> None:
        document_id = PILOT_DOCUMENTS[230]["new_id"]
        path = f"/documents/{document_id}/legacy-metadata-history"

        unauthenticated_status, _ = get_json(path)
        restricted_status, _ = get_json(path, self.restricted_token)

        self.assertEqual(unauthenticated_status, 401)
        self.assertEqual(restricted_status, 403)


if __name__ == "__main__":
    unittest.main()
