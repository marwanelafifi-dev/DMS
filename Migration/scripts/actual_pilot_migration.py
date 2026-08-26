#!/usr/bin/env python3
"""Execute and validate the five-document KnowledgeTree migration pilot.

The command defaults to a non-mutating input check.  Actual writes require
both ``--execute`` and a verified pre-migration backup directory.  IDs and
object keys are deterministic, and every insert is conflict-safe, so a rerun
cannot create duplicate pilot records.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import hmac
import json
import mimetypes
import os
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from pilot_migration import (
    BLOBS_DIR,
    METADATA_TSV,
    PILOT_PLAN_CSV,
    REPO_DIR,
    SOURCE_DUMP,
    load_dump_text,
    load_legacy_data,
    md5_file,
    parse_env_file,
    psql_rows,
    resolve_owners,
    tags_from_legacy,
    transformed_original_document_id,
)
from preflight_migration import extract_table_rows, rows_to_dicts


SCRIPT_DIR = Path(__file__).resolve().parent
MIGRATION_DIR = SCRIPT_DIR.parent
OUTPUT_DIR = MIGRATION_DIR / "output"
ARCHIVE_SCHEMA_SQL = REPO_DIR / "infra" / "db" / "init" / "075_legacy_migration_archive.sql"

REPORT_MD = OUTPUT_DIR / "14_actual_pilot_migration_report.md"
VALIDATION_CSV = OUTPUT_DIR / "14_pilot_validation.csv"
ID_MAPPING_CSV = OUTPUT_DIR / "14_legacy_new_id_mapping.csv"
ROLLBACK_MD = OUTPUT_DIR / "14_pilot_rollback.md"

SOURCE_SYSTEM = "KnowledgeTree"
RUN_KEY = "first-five-document-pilot-v1"
PILOT_IDS = ("230", "177", "238", "497", "24")
APP_ADMIN_ID = "00000000-0000-0000-0000-000000000001"

# These rows were inspected before execution and are unambiguously local
# development artifacts.  Cleanup is restricted to these IDs and is performed
# once, before migration objects are uploaded.
MOCK_DOCUMENT_IDS = {
    "713cc567-5613-4d54-8ab7-36d01b13d05f",
    "d243fcc9-0577-44c9-95cb-5cd9f75bfda9",
    "fb11c453-4bb5-4372-b4a4-d30dc1ad0595",
    "7db9a836-8a6a-436a-aa85-c23c4c154105",
    "be37e901-6e58-4e1d-a1b1-5c46f503eda1",
    "47be316e-a4cf-4491-9062-00f927f14b71",
    "675edde5-367b-4216-a5f2-eed97fa1e93c",
    "7436144c-8827-4866-a22b-91e925ded81b",
    "e9efd58b-7980-4c3a-90ac-c20cea312d2d",
}
MOCK_FOLDER_IDS = {
    "0a3ceac1-4c00-4eab-8d74-e0d471950990",  # IT
    "6eca078a-7da8-4fc7-8e0f-50a3fc2ab32a",  # HR
}
MOCK_USER_IDS = {
    "a0af051f-dc59-466e-9a11-1da30447c749",  # mocked frontend identity
    "a8b7f3e4-cbd7-49f9-ad0d-d85c38fce749",  # Quality test account
    "ed0f6292-7398-4ff4-8e1d-9eeac71ca769",  # generic user test account
    "648f8039-a083-4eca-850e-7d84f45fe5cc",  # Ali test account
}
MOCK_DROPDOWN_IDS = {
    "555f387a-6939-4038-910d-35ab6ac2e6b0",  # Category DOC
    "56436d77-f048-4eaf-afa5-177d62dd6af1",  # Department HR
    "410f8219-07e5-44fa-a804-8e7cb61a0b2c",  # Department IT
}

# Fingerprints of the complete, manually inspected mutable fixture tables in
# the pre-pilot snapshot.  Cleanup stops if even one row differs, so the broad
# FK-safe deletes below cannot consume data that appeared after inspection.
MOCK_TABLE_FINGERPRINTS = {
    "dms_notifications": ("notification_id", 78, "d242cefb3f1b5f97611f826de5fefca577b152d287ac154697d128e733b2b030"),
    "dms_access_overrides": ("override_id", 3, "7166560d36c35fa9202c5b8b2d9fcbff29fac8c324f5c9c465cb379ef5c2a8af"),
    "dms_approvals": ("approval_id", 9, "154705454296fb1717af9c177331da7b7f4d04b2e4d1f7d614c95e40dd326e85"),
    "dms_approval_documents": ("approval_document_id", 9, "9328cc70d73e8cd3a4bc48cc1b182607e6654e5413dc25d58ec91fecad0a7b9c"),
    "dms_task_attachments": ("attachment_id", 8, "0f1cd75f8565ac2e1b8ab10e4ef06cba9a1425fb02a38cfd538091fb952edab6"),
    "dms_announcements": ("announcement_id", 4, "9a87cc20af332b28d7d0e25da3692c8e40b46ef169b4d0d39a925f57112262fb"),
    "dms_groups": ("group_id", 1, "5f08ed1d0253031a0297763f9ef29d6a4f9c8687337e8188b033de13066167b2"),
    "dms_group_members": ("group_member_id", 1, "53f260d45f0f667a0a21a50e4bcfbed74cac8b328fa81746131d579ee3e2bed4"),
    "dms_tasks": ("task_id", 9, "c5c94613b03ac9ad2db2d1b11687484ffcd94678d56a9dfdd8f9948ec2e8d599"),
}
MOCK_OBJECT_FINGERPRINTS = {
    "documents": (78, 44, "763ea6cd860d396d7eb9a1212f0f072a5356391c693cd5efdbd98fff4b997a92"),
    "tasks": (12, 11, "66068b450c886839cb4c80c32d70edd324a7042dad8a24e46ee2fafbdc2960bd"),
}

DEPARTMENTS = ("Analog Design", "Corporate", "Digital Design", "MEMS")
CATEGORIES = (
    "Business",
    "Methodology",
    "Policy",
    "Process",
    "Review",
    "Standard",
    "Template",
    "Working Document",
)

USERS_COLS = [
    "id", "username", "name", "password", "quota_max", "quota_current",
    "email", "mobile", "email_notification", "sms_notification",
    "authentication_details_s1", "max_sessions", "language_id",
    "authentication_details_s2", "authentication_source_id",
    "authentication_details_b1", "authentication_details_i2",
    "authentication_details_d1", "authentication_details_i1",
    "authentication_details_d2", "authentication_details_b2", "last_login",
    "disabled",
]

UUID_NAMESPACE = uuid.UUID("8a507038-c2ef-4ec4-a348-2a4c8c4cc17a")


@dataclass(frozen=True)
class OwnerIdentity:
    approved_name: str
    email: str
    legacy_user_ids: tuple[str, ...]
    legacy_usernames: tuple[str, ...]


@dataclass(frozen=True)
class StoredObject:
    key: str
    sha256: str
    size: int


@dataclass(frozen=True)
class RuntimeSettings:
    minio_endpoint: str
    minio_bucket: str
    api_base_url: str


def stable_uuid(kind: str, source_id: str) -> str:
    return str(uuid.uuid5(UUID_NAMESPACE, f"{SOURCE_SYSTEM}:{kind}:{source_id}"))


def canonical_person(value: str) -> str:
    return "".join(ch for ch in value.casefold() if ch.isalnum())


def sql_literal(value: object | None) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def sql_json(value: object) -> str:
    return sql_literal(json.dumps(value, ensure_ascii=False, separators=(",", ":"))) + "::jsonb"


def sql_text_array(values: Iterable[str]) -> str:
    return "ARRAY[" + ",".join(sql_literal(item) for item in values) + "]::text[]"


def quoted_values(values: Iterable[str]) -> str:
    return ",".join(sql_literal(item) for item in values)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fingerprint_ids(values: Iterable[str]) -> str:
    payload = "\n".join(sorted(values)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def runtime_settings() -> RuntimeSettings:
    env = parse_env_file()
    appsettings = json.loads((REPO_DIR / "api" / "appsettings.json").read_text(encoding="utf-8"))
    return RuntimeSettings(
        # `mc` executes in the MinIO Compose service, so its configured
        # service-local API endpoint is independent of the published host port.
        minio_endpoint=env.get("MIGRATION_MINIO_ENDPOINT", "http://127.0.0.1:9000"),
        minio_bucket=env.get(
            "MINIO_BUCKET",
            appsettings.get("Minio", {}).get("BucketName", "dms-documents"),
        ),
        api_base_url=env.get(
            "MIGRATION_API_BASE_URL",
            f"http://127.0.0.1:{env.get('API_PORT', '8080')}",
        ).rstrip("/"),
    )


def normalized_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def source_manifest_hash() -> str:
    files = (
        SOURCE_DUMP,
        PILOT_PLAN_CSV,
        METADATA_TSV,
        OUTPUT_DIR / "Final DMS Mapping.xlsx",
        OUTPUT_DIR / "12_owner_mapping_resolution.csv",
    )
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.name.encode("utf-8"))
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def psql_execute(sql: str) -> None:
    env = parse_env_file()
    command = [
        "docker", "compose", "exec", "-T", "postgres", "psql",
        "-U", env["POSTGRES_USER"], "-d", env["POSTGRES_DB"],
        "-v", "ON_ERROR_STOP=1", "-X", "-q",
    ]
    completed = subprocess.run(
        command,
        cwd=REPO_DIR,
        # Pass bytes so Windows does not translate an existing CRLF in legacy
        # metadata to CRCRLF while feeding psql's stdin.
        input=sql.encode("utf-8"),
        capture_output=True,
    )
    if completed.returncode:
        raise RuntimeError(
            "PostgreSQL command failed: "
            + (
                completed.stderr.decode("utf-8", errors="replace").strip()
                or completed.stdout.decode("utf-8", errors="replace").strip()
            )
        )


def load_plan() -> list[dict[str, str]]:
    with PILOT_PLAN_CSV.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    ids = tuple(row["legacy_document_id"] for row in rows)
    if ids != PILOT_IDS:
        raise RuntimeError(f"Pilot plan IDs/order changed: expected {PILOT_IDS}, found {ids}")
    if len({row["legacy_document_id"] for row in rows}) != 5:
        raise RuntimeError("Pilot plan must contain exactly five distinct documents")
    if any(row["owner_mapping_status"] != "UNAMBIGUOUS" for row in rows):
        raise RuntimeError("Every actual-pilot owner mapping must be UNAMBIGUOUS")
    return rows


def validate_approved_owner_plan(plan: list[dict[str, str]]) -> None:
    """Recheck the plan against both senior-review owner workbooks."""
    _, by_original = resolve_owners()
    for row in plan:
        resolution = by_original.get(row["legacy_author_original"])
        if resolution is None:
            raise RuntimeError(
                f"Document {row['legacy_document_id']} legacy Author is absent from the original workbook"
            )
        if resolution.status != "UNAMBIGUOUS" or resolution.owner != row["new_owner_name"]:
            raise RuntimeError(
                f"Document {row['legacy_document_id']} owner no longer matches the senior-approved workbook mapping"
            )


def resolve_owner_identities(plan: list[dict[str, str]], dump_text: str) -> dict[str, OwnerIdentity]:
    legacy_users = rows_to_dicts(extract_table_rows(dump_text, "users"), USERS_COLS)
    result: dict[str, OwnerIdentity] = {}
    for approved_name in sorted({row["new_owner_name"] for row in plan}):
        key = canonical_person(approved_name)
        candidates = [
            row for row in legacy_users
            if canonical_person(row.get("name") or "") == key and (row.get("email") or "").strip()
        ]
        emails = sorted({(row["email"] or "").strip().casefold() for row in candidates})
        if len(emails) != 1:
            raise RuntimeError(
                f"Owner {approved_name!r} does not resolve to exactly one authoritative "
                f"legacy email; found {emails or 'none'}"
            )
        if not any((row.get("disabled") or "0") == "0" for row in candidates):
            raise RuntimeError(f"All authoritative legacy accounts for {approved_name!r} are disabled")
        result[approved_name] = OwnerIdentity(
            approved_name=approved_name,
            email=emails[0],
            legacy_user_ids=tuple(sorted({row["id"] for row in candidates}, key=int)),
            legacy_usernames=tuple(sorted({row["username"] for row in candidates}, key=str.casefold)),
        )
    return result


def load_legacy_folders() -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    by_id: dict[str, dict[str, str]] = {}
    by_path: dict[str, dict[str, str]] = {}
    with (MIGRATION_DIR / "source" / "01_folders.tsv").open(
        encoding="utf-8", newline=""
    ) as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            row["full_path"] = row["full_path"].strip("/")
            by_id[row["folder_id"]] = row
            by_path[row["full_path"].casefold()] = row
    return by_id, by_path


def folder_chain(folder_id: str, folders_by_id: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    chain = []
    seen = set()
    current = folder_id
    while current and current not in {"0", "1"}:
        if current in seen or current not in folders_by_id:
            raise RuntimeError(f"Broken/cyclic legacy folder ancestry at folder {current}")
        seen.add(current)
        row = folders_by_id[current]
        chain.append(row)
        current = row["parent_id"]
    chain.reverse()
    return chain


def load_metadata_fields(selected_ids: set[str]) -> dict[tuple[str, str], dict[str, str]]:
    grouped: dict[tuple[str, str], dict[str, str]] = defaultdict(dict)
    with METADATA_TSV.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row["doc_id"] in selected_ids:
                grouped[(row["doc_id"], row["metadata_version_id"])][row["field_name"]] = row["field_value"]
    return dict(grouped)


def validate_source(
    plan: list[dict[str, str]],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
) -> None:
    for row in plan:
        doc_id = row["legacy_document_id"]
        document = legacy["document_by_id"][doc_id]
        current_metadata = legacy["metadata_by_id"][document["metadata_version_id"]]
        active = legacy["version_by_id"][current_metadata["content_version_id"]]
        fields = metadata_fields[(doc_id, current_metadata["id"])]
        blob = BLOBS_DIR / Path(active["storage_path"])
        checks = {
            "active_pointer": active["id"] == row["active_content_version_id"],
            "filename": active["filename"] == row["active_filename"],
            "file_nonzero": blob.is_file() and blob.stat().st_size > 0,
            "md5": blob.is_file() and md5_file(blob).casefold() == row["active_md5"].casefold(),
            "authors": fields.get("Authors", "") == row["legacy_author_original"],
            "department": fields.get("Group", "") == row["new_department"],
            "category": legacy["document_type_by_id"].get(current_metadata["document_type_id"], "")
            == row["new_category"],
            "description": fields.get("Description", "") == row["description"],
            "document_number": transformed_original_document_id(fields.get("Document #", ""))
            == row["original_document_id"],
        }
        failed = [name for name, passed in checks.items() if not passed]
        if failed:
            raise RuntimeError(f"Document {doc_id} source validation failed: {', '.join(failed)}")
        metadata_versions = legacy["metadata_by_doc"][doc_id]
        if len(metadata_versions) != int(row["metadata_history_count"]) + 1:
            raise RuntimeError(f"Document {doc_id} metadata history count changed")
        if any((doc_id, item["id"]) not in metadata_fields for item in metadata_versions):
            raise RuntimeError(f"Document {doc_id} has a metadata snapshot without extracted fields")


class MinioClient:
    def __init__(self) -> None:
        env = parse_env_file()
        settings = runtime_settings()
        user = urllib.parse.quote(env["MINIO_ROOT_USER"], safe="")
        password = urllib.parse.quote(env["MINIO_ROOT_PASSWORD"], safe="")
        endpoint = settings.minio_endpoint.removeprefix("http://").removeprefix("https://")
        scheme = "https" if settings.minio_endpoint.startswith("https://") else "http"
        self.host_env = f"MC_HOST_migration={scheme}://{user}:{password}@{endpoint}"
        self.bucket = settings.minio_bucket

    def _command(self, *args: str, binary: bool = False) -> subprocess.CompletedProcess:
        command = [
            "docker", "compose", "exec", "-T", "-e", self.host_env,
            "minio", "mc", *args,
        ]
        completed = subprocess.run(
            command,
            cwd=REPO_DIR,
            capture_output=True,
            text=not binary,
            encoding=None if binary else "utf-8",
        )
        return completed

    def list_keys(self, prefix: str = "") -> list[str]:
        requested_prefix = prefix.strip("/")
        target = f"migration/{self.bucket}"
        if requested_prefix:
            target += "/" + requested_prefix
        completed = self._command("ls", "--recursive", "--json", target)
        if completed.returncode:
            stderr = completed.stderr.strip()
            if "does not exist" in stderr.casefold():
                return []
            raise RuntimeError(f"MinIO list failed: {stderr}")
        keys = []
        for line in completed.stdout.splitlines():
            if not line.strip():
                continue
            item = json.loads(line)
            key = item.get("key", "")
            prefix_with_bucket = self.bucket + "/"
            if key.startswith(prefix_with_bucket):
                key = key[len(prefix_with_bucket):]
            # `mc ls <bucket>/<prefix>` reports keys relative to that prefix,
            # while listing a whole bucket reports bucket-relative keys.  Make
            # the helper's contract consistently bucket-relative.
            if requested_prefix and not (
                key == requested_prefix or key.startswith(requested_prefix + "/")
            ):
                key = requested_prefix + "/" + key
            keys.append(key)
        return sorted(keys)

    def remove_prefix(self, prefix: str) -> None:
        completed = self._command(
            "rm", "--recursive", "--force",
            f"migration/{self.bucket}/{prefix.strip('/')}"
        )
        if completed.returncode:
            raise RuntimeError(f"MinIO cleanup failed for {prefix}: {completed.stderr.strip()}")

    def object_sha256(self, key: str) -> str | None:
        command = [
            "docker", "compose", "exec", "-T", "-e", self.host_env,
            "minio", "mc", "cat", f"migration/{self.bucket}/{key}",
        ]
        process = subprocess.Popen(command, cwd=REPO_DIR, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        digest = hashlib.sha256()
        assert process.stdout is not None
        for chunk in iter(lambda: process.stdout.read(1024 * 1024), b""):
            digest.update(chunk)
        stderr = process.stderr.read() if process.stderr else b""
        code = process.wait()
        if code:
            message = stderr.decode("utf-8", errors="replace")
            if "does not exist" in message.casefold() or "not found" in message.casefold():
                return None
            raise RuntimeError(f"MinIO read failed for {key}: {message.strip()}")
        return digest.hexdigest()

    def put_verified(self, source: Path, key: str, expected_sha256: str) -> StoredObject:
        existing = self.object_sha256(key)
        if existing is not None:
            if existing != expected_sha256:
                raise RuntimeError(f"Existing MinIO object has wrong SHA-256: {key}")
            return StoredObject(key, existing, source.stat().st_size)

        temp_name = f"/tmp/kt-migration-{expected_sha256[:24]}"
        copied = subprocess.run(
            ["docker", "compose", "cp", str(source), f"minio:{temp_name}"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if copied.returncode:
            raise RuntimeError(f"Could not stage {source.name} in MinIO container: {copied.stderr.strip()}")
        try:
            uploaded = self._command(
                "cp", "--quiet", temp_name, f"migration/{self.bucket}/{key}"
            )
            if uploaded.returncode:
                raise RuntimeError(f"MinIO upload failed for {key}: {uploaded.stderr.strip()}")
        finally:
            subprocess.run(
                ["docker", "compose", "exec", "-T", "minio", "rm", "-f", temp_name],
                cwd=REPO_DIR,
                capture_output=True,
            )
        actual = self.object_sha256(key)
        if actual != expected_sha256:
            raise RuntimeError(f"Post-upload SHA-256 mismatch for {key}")
        return StoredObject(key, actual, source.stat().st_size)


def verify_backup(backup_dir: Path) -> dict[str, str]:
    backup_dir = backup_dir.resolve()
    pg = backup_dir / "postgres_pre_migration.dump"
    minio = backup_dir / "minio_pre_migration.tar.gz"
    missing = [str(path) for path in (pg, minio) if not path.is_file() or path.stat().st_size == 0]
    if missing:
        raise RuntimeError("Required pre-migration backup file missing/empty: " + ", ".join(missing))

    # Validate the custom-format dump with the same PostgreSQL toolchain used
    # for restore, not merely by checking that the file is non-empty.
    staged_dump = "/tmp/kt-pilot-backup-verify.dump"
    copied = subprocess.run(
        ["docker", "compose", "cp", str(pg), f"postgres:{staged_dump}"],
        cwd=REPO_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if copied.returncode:
        raise RuntimeError("Could not stage PostgreSQL backup for verification: " + copied.stderr.strip())
    try:
        listed = subprocess.run(
            ["docker", "compose", "exec", "-T", "postgres", "pg_restore", "--list", staged_dump],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if listed.returncode or "TABLE DATA public dms_documents" not in listed.stdout:
            raise RuntimeError("PostgreSQL backup is not a readable DMS custom-format dump")
    finally:
        subprocess.run(
            ["docker", "compose", "exec", "-T", "postgres", "rm", "-f", staged_dump],
            cwd=REPO_DIR,
            capture_output=True,
        )

    # Reading every regular member verifies gzip/tar checksums and confirms the
    # snapshot contains the expected bucket root used by the rollback plan.
    bucket_marker = f"/{runtime_settings().minio_bucket}/"
    bucket_seen = False
    try:
        with tarfile.open(minio, mode="r:gz") as archive:
            for member in archive:
                bucket_seen = bucket_seen or bucket_marker in f"/{member.name.strip('/')}/"
                if member.isfile():
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise RuntimeError(f"Unreadable MinIO snapshot member: {member.name}")
                    for _ in iter(lambda: extracted.read(1024 * 1024), b""):
                        pass
    except (tarfile.TarError, OSError) as exc:
        raise RuntimeError(f"MinIO snapshot is unreadable: {exc}") from exc
    if not bucket_seen:
        raise RuntimeError("MinIO snapshot does not contain the configured DMS bucket")
    return {
        "directory": str(backup_dir),
        "postgres_sha256": sha256_file(pg),
        "minio_sha256": sha256_file(minio),
    }


def ensure_archive_schema() -> None:
    psql_execute(ARCHIVE_SCHEMA_SQL.read_text(encoding="utf-8"))


def start_run(manifest_sha: str, backup: dict[str, str]) -> str:
    run_id = stable_uuid("run", RUN_KEY)
    existing = psql_rows(
        "SELECT source_manifest_sha256,COALESCE(details->'backup','{}'::jsonb)::text "
        "FROM dms_legacy_migration_runs "
        f"WHERE source_system={sql_literal(SOURCE_SYSTEM)} AND run_key={sql_literal(RUN_KEY)};"
    )
    if existing and existing[0][0] != manifest_sha:
        raise RuntimeError(
            "Pilot source manifest changed after the migration run was created; "
            "use a new reviewed run key instead of mutating the existing run"
        )
    if existing:
        original_backup = json.loads(existing[0][1])
        same_backup = (
            original_backup.get("postgres_sha256") == backup["postgres_sha256"]
            and original_backup.get("minio_sha256") == backup["minio_sha256"]
            and Path(original_backup.get("directory", "")).resolve()
            == Path(backup["directory"]).resolve()
        )
        if not same_backup:
            raise RuntimeError(
                "Pilot rerun supplied a different backup; the immutable pre-pilot rollback snapshot must be reused"
            )
    details = {"backup": backup, "cleanup_completed": False}
    psql_execute(f"""
        INSERT INTO dms_legacy_migration_runs
            (run_id, source_system, run_key, status, source_manifest_sha256, details)
        VALUES ({sql_literal(run_id)}::uuid, {sql_literal(SOURCE_SYSTEM)}, {sql_literal(RUN_KEY)},
                'started', {sql_literal(manifest_sha)}, {sql_json(details)})
        ON CONFLICT (source_system, run_key) DO NOTHING;
    """)
    return run_id


def run_cleanup_once(run_id: str, minio: MinioClient) -> dict[str, object]:
    state = psql_rows(
        "SELECT status, COALESCE(details->>'cleanup_completed','false'), details::text "
        f"FROM dms_legacy_migration_runs WHERE run_id={sql_literal(run_id)}::uuid;"
    )[0]
    if state[1] == "true":
        previous = json.loads(state[2]).get("cleanup", {})
        return {
            **previous,
            "performed": False,
            "previously_performed": True,
            "reason": "already completed on this idempotent run",
        }

    current_doc_rows = psql_rows("SELECT document_id::text,title FROM dms_documents ORDER BY document_id;")
    unexpected = sorted({row[0] for row in current_doc_rows} - MOCK_DOCUMENT_IDS)
    if unexpected:
        raise RuntimeError(
            "Cleanup stopped because non-inspected New-DMS documents now exist: " + ", ".join(unexpected)
        )
    current_folder_ids = {row[0] for row in psql_rows("SELECT folder_id::text FROM dms_folders;")}
    deletable_folders = sorted(current_folder_ids & MOCK_FOLDER_IDS)
    current_user_ids = {row[0] for row in psql_rows("SELECT user_id::text FROM dms_users;")}
    deactivated_users = sorted(current_user_ids & MOCK_USER_IDS)
    current_dropdown_ids = {row[0] for row in psql_rows("SELECT item_id::text FROM dms_dropdown_items;")}
    deleted_dropdowns = sorted(current_dropdown_ids & MOCK_DROPDOWN_IDS)

    for table, (id_column, expected_count, expected_hash) in MOCK_TABLE_FINGERPRINTS.items():
        ids = [row[0] for row in psql_rows(f"SELECT {id_column}::text FROM {table} ORDER BY {id_column};")]
        if len(ids) != expected_count or fingerprint_ids(ids) != expected_hash:
            raise RuntimeError(
                f"Cleanup stopped: {table} no longer matches the manually inspected mock-data fingerprint"
            )

    task_rows = psql_rows(
        "SELECT t.task_id::text, count(r.reminder_id)::text "
        "FROM dms_tasks t LEFT JOIN dms_reminders r ON r.task_id=t.task_id "
        "GROUP BY t.task_id ORDER BY t.task_id;"
    )
    deletable_tasks = [row[0] for row in task_rows if int(row[1]) == 0]
    retained_tasks = [row[0] for row in task_rows if int(row[1]) > 0]

    counts_before = {
        key: int(psql_rows(f"SELECT count(*) FROM {table};")[0][0])
        for key, table in {
            "documents": "dms_documents",
            "versions": "dms_document_versions",
            "task_attachments": "dms_task_attachments",
            "notifications": "dms_notifications",
            "approvals": "dms_approvals",
            "announcements": "dms_announcements",
            "groups": "dms_groups",
            "audit_trails_preserved": "dms_audit_trails",
            "reminders_preserved": "dms_reminders",
        }.items()
    }
    document_objects = minio.list_keys("documents")
    task_objects = minio.list_keys("tasks")
    for prefix, keys in (("documents", document_objects), ("tasks", task_objects)):
        expected_count, expected_owner_count, expected_owner_hash = MOCK_OBJECT_FINGERPRINTS[prefix]
        owner_ids = {
            key.split("/", 2)[1]
            for key in keys
            if len(key.split("/", 2)) >= 2
        }
        if (
            len(keys) != expected_count
            or len(owner_ids) != expected_owner_count
            or fingerprint_ids(owner_ids) != expected_owner_hash
        ):
            raise RuntimeError(
                f"Cleanup stopped: MinIO {prefix}/ no longer matches the inspected mock-object fingerprint"
            )

    doc_ids_sql = quoted_values(row[0] for row in current_doc_rows) or "NULL"
    folder_ids_sql = quoted_values(deletable_folders) or "NULL"
    user_ids_sql = quoted_values(deactivated_users) or "NULL"
    dropdown_ids_sql = quoted_values(deleted_dropdowns) or "NULL"
    task_ids_sql = quoted_values(deletable_tasks) or "NULL"
    retained_task_ids_sql = quoted_values(retained_tasks) or "NULL"

    psql_execute(f"""
        BEGIN;
        DELETE FROM dms_task_attachments;
        DELETE FROM dms_notifications;
        DELETE FROM dms_access_overrides;
        DELETE FROM dms_approval_documents;
        DELETE FROM dms_approvals;
        UPDATE dms_documents SET current_version_id = NULL
          WHERE document_id::text IN ({doc_ids_sql});
        DELETE FROM dms_documents WHERE document_id::text IN ({doc_ids_sql});
        DELETE FROM dms_tasks WHERE task_id::text IN ({task_ids_sql});
        UPDATE dms_tasks SET status='completed', document_id=NULL, updated_at=now()
          WHERE task_id::text IN ({retained_task_ids_sql});
        DELETE FROM dms_announcements;
        DELETE FROM dms_group_members;
        DELETE FROM dms_groups;
        DELETE FROM dms_folders WHERE folder_id::text IN ({folder_ids_sql});
        DELETE FROM dms_dropdown_items WHERE item_id::text IN ({dropdown_ids_sql});
        UPDATE dms_users SET is_active=FALSE, updated_at=now()
          WHERE user_id::text IN ({user_ids_sql});
        COMMIT;
    """)

    # The exact key counts and top-level owner-ID fingerprints above match the
    # inspected development snapshot.  The scheduled DB backup namespace is
    # deliberately outside these prefixes and remains untouched.
    if document_objects:
        minio.remove_prefix("documents")
    if task_objects:
        minio.remove_prefix("tasks")

    cleanup = {
        "performed": True,
        "documents": [{"id": row[0], "title": row[1]} for row in current_doc_rows],
        "counts_before": counts_before,
        "deleted_document_object_count": len(document_objects),
        "deleted_task_object_count": len(task_objects),
        "deleted_folder_ids": deletable_folders,
        "deactivated_user_ids": deactivated_users,
        "deleted_dropdown_ids": deleted_dropdowns,
        "deleted_task_ids": deletable_tasks,
        "retained_worm_linked_task_ids": retained_tasks,
        "worm_note": "Audit trails and reminders were preserved; their database WORM guards were not bypassed.",
    }
    psql_execute(f"""
        UPDATE dms_legacy_migration_runs
        SET status='cleanup_complete',
            details = details || {sql_json({'cleanup_completed': True, 'cleanup': cleanup})}
        WHERE run_id={sql_literal(run_id)}::uuid;
    """)
    return cleanup


def prepare_master_data_and_users(
    identities: dict[str, OwnerIdentity]
) -> dict[str, str]:
    existing_dropdowns: dict[tuple[str, str], str] = {}
    for item_id, list_key, label in psql_rows(
        "SELECT item_id::text,list_key,label FROM dms_dropdown_items "
        "WHERE list_key IN ('department','category');"
    ):
        key = (list_key.casefold(), label.casefold())
        if key in existing_dropdowns:
            raise RuntimeError(f"Case-insensitive duplicate dropdown value: {list_key}/{label}")
        existing_dropdowns[key] = item_id

    statements = ["BEGIN;"]
    for list_key, labels in (("department", DEPARTMENTS), ("category", CATEGORIES)):
        for sort_order, label in enumerate(labels, 1):
            if (list_key, label.casefold()) not in existing_dropdowns:
                statements.append(
                    "INSERT INTO dms_dropdown_items(item_id,list_key,label,sort_order,created_at) VALUES "
                    f"({sql_literal(stable_uuid('dropdown', list_key + ':' + label))}::uuid,"
                    f"{sql_literal(list_key)},{sql_literal(label)},{sort_order},now()) "
                    "ON CONFLICT (list_key,label) DO NOTHING;"
                )

    owner_ids: dict[str, str] = {}
    current_users = psql_rows("SELECT user_id::text,email,full_name,is_active::text FROM dms_users;")
    users_by_email = {row[1].casefold(): row for row in current_users}
    for approved_name, identity in identities.items():
        existing = users_by_email.get(identity.email.casefold())
        if existing:
            if canonical_person(existing[2]) != canonical_person(approved_name):
                raise RuntimeError(
                    f"Existing New-DMS email {identity.email} belongs to {existing[2]!r}, "
                    f"not approved owner {approved_name!r}"
                )
            owner_id = existing[0]
            statements.append(
                "UPDATE dms_users SET full_name=" + sql_literal(approved_name)
                + ",is_active=TRUE,updated_at=now() WHERE user_id="
                + sql_literal(owner_id) + "::uuid;"
            )
        else:
            owner_id = stable_uuid("legacy-user", identity.email)
            statements.append(
                "INSERT INTO dms_users(user_id,email,full_name,is_active,created_at,updated_at) VALUES "
                f"({sql_literal(owner_id)}::uuid,{sql_literal(identity.email)},"
                f"{sql_literal(approved_name)},TRUE,now(),now()) ON CONFLICT (email) DO NOTHING;"
            )
        owner_ids[approved_name] = owner_id
    statements.append("COMMIT;")
    psql_execute("\n".join(statements))

    for name, identity in identities.items():
        matches = psql_rows(
            "SELECT user_id::text,full_name,is_active::text FROM dms_users "
            f"WHERE lower(email)=lower({sql_literal(identity.email)});"
        )
        if len(matches) != 1 or matches[0][1] != name or matches[0][2] != "true":
            raise RuntimeError(f"New-DMS owner account validation failed for {name}")
        owner_ids[name] = matches[0][0]
    return owner_ids


def ensure_folders(
    plan: list[dict[str, str]],
    legacy: dict[str, object],
    folders_by_id: dict[str, dict[str, str]],
    run_id: str,
) -> tuple[dict[str, str], dict[str, str]]:
    needed: dict[str, dict[str, str]] = {}
    document_target_path: dict[str, str] = {}
    for row in plan:
        doc_id = row["legacy_document_id"]
        source_folder_id = legacy["document_by_id"][doc_id]["folder_id"]
        chain = folder_chain(source_folder_id, folders_by_id)
        for item in chain:
            needed[item["folder_id"]] = item
        document_target_path[doc_id] = chain[-1]["full_path"]

    existing_by_path = {path.casefold(): folder_id for folder_id, path in full_folder_paths().items()}
    folder_uuid_by_legacy_id: dict[str, str] = {}
    statements = ["BEGIN;"]
    for item in sorted(needed.values(), key=lambda row: (row["full_path"].count("/"), row["full_path"].casefold())):
        new_id = existing_by_path.get(item["full_path"].casefold()) or stable_uuid("folder", item["folder_id"])
        parent_legacy_id = item["parent_id"]
        parent_new_id = folder_uuid_by_legacy_id.get(parent_legacy_id)
        if item["full_path"].casefold() not in existing_by_path:
            parent_sql = f"{sql_literal(parent_new_id)}::uuid" if parent_new_id else "NULL"
            statements.append(
                "INSERT INTO dms_folders(folder_id,parent_folder_id,name,description,classification,owner_id,created_at,updated_at) VALUES "
                f"({sql_literal(new_id)}::uuid,{parent_sql},{sql_literal(item['folder_name'])},"
                f"'KnowledgeTree migrated folder','standard',{sql_literal(APP_ADMIN_ID)}::uuid,now(),now()) "
                "ON CONFLICT (folder_id) DO NOTHING;"
            )
        statements.append(
            "INSERT INTO dms_legacy_folder_mappings(source_system,legacy_folder_id,legacy_full_path,new_folder_id,migration_run_id) VALUES "
            f"({sql_literal(SOURCE_SYSTEM)},{int(item['folder_id'])},{sql_literal(item['full_path'])},"
            f"{sql_literal(new_id)}::uuid,{sql_literal(run_id)}::uuid) "
            "ON CONFLICT (source_system,legacy_folder_id) DO NOTHING;"
        )
        folder_uuid_by_legacy_id[item["folder_id"]] = new_id
        existing_by_path[item["full_path"].casefold()] = new_id
    statements.append("COMMIT;")
    psql_execute("\n".join(statements))
    return folder_uuid_by_legacy_id, document_target_path


def safe_object_filename(value: str) -> str:
    return value.replace("/", "_").replace("\\", "_").replace("\x00", "_")


def mime_type_for(filename: str) -> str:
    overrides = {
        ".docm": "application/vnd.ms-word.document.macroenabled.12",
        ".xlsm": "application/vnd.ms-excel.sheet.macroenabled.12",
        ".pptm": "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    }
    suffix = Path(filename).suffix.casefold()
    return overrides.get(suffix) or mimetypes.guess_type(filename)[0] or "application/octet-stream"


def upload_source_objects(
    plan: list[dict[str, str]], legacy: dict[str, object], minio: MinioClient
) -> tuple[dict[str, StoredObject], dict[tuple[str, str], dict[str, object]]]:
    active_objects: dict[str, StoredObject] = {}
    content_state: dict[tuple[str, str], dict[str, object]] = {}
    for row in plan:
        doc_id = row["legacy_document_id"]
        active_id = row["active_content_version_id"]
        new_doc_id = stable_uuid("document", doc_id)
        new_version_id = stable_uuid("active-version", active_id)
        for version in legacy["versions_by_doc"][doc_id]:
            source = BLOBS_DIR / Path(version["storage_path"]) if version["storage_path"] else None
            is_active = version["id"] == active_id
            status = ""
            object_key = None
            archive_sha = None
            if not source or not source.is_file():
                status = "source_file_missing"
            elif source.stat().st_size == 0:
                status = "source_file_zero_byte"
            elif md5_file(source).casefold() != (version["md5hash"] or "").casefold():
                status = "source_md5_mismatch"
            else:
                sha = sha256_file(source)
                if is_active:
                    status = "active_in_new_dms"
                    object_key = (
                        f"documents/{new_doc_id}/{new_version_id}/"
                        f"{safe_object_filename(version['filename'])}"
                    )
                    active_objects[doc_id] = minio.put_verified(source, object_key, sha)
                    object_key = None  # active key lives on dms_document_versions, not archive
                else:
                    status = "archived"
                    object_key = (
                        f"legacy/archive/{SOURCE_SYSTEM}/documents/{doc_id}/content/"
                        f"{version['id']}/{safe_object_filename(version['filename'])}"
                    )
                    stored = minio.put_verified(source, object_key, sha)
                    archive_sha = stored.sha256
            if is_active and status != "active_in_new_dms":
                raise RuntimeError(f"Document {doc_id} active source file is not migration-ready: {status}")
            content_state[(doc_id, version["id"])] = {
                "status": status,
                "archive_object_key": object_key,
                "archive_sha256": archive_sha,
            }
    return active_objects, content_state


def migrate_database(
    plan: list[dict[str, str]],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
    owner_ids: dict[str, str],
    folder_ids: dict[str, str],
    active_objects: dict[str, StoredObject],
    content_state: dict[tuple[str, str], dict[str, object]],
    run_id: str,
) -> None:
    # Original Document ID is case-insensitively unique in New DMS.
    for row in plan:
        original_id = row["original_document_id"]
        if not original_id:
            continue
        conflicts = psql_rows(
            "SELECT document_id::text FROM dms_documents WHERE lower(original_document_id)=lower("
            f"{sql_literal(original_id)}) AND document_id<>"
            f"{sql_literal(stable_uuid('document', row['legacy_document_id']))}::uuid;"
        )
        if conflicts:
            raise RuntimeError(
                f"Document {row['legacy_document_id']} original_document_id conflicts with {conflicts[0][0]}"
            )

    statements = ["BEGIN;"]
    for row in plan:
        doc_id = row["legacy_document_id"]
        document = legacy["document_by_id"][doc_id]
        active_id = row["active_content_version_id"]
        active = legacy["version_by_id"][active_id]
        current_metadata = legacy["metadata_by_id"][document["metadata_version_id"]]
        new_doc_id = stable_uuid("document", doc_id)
        new_version_id = stable_uuid("active-version", active_id)
        new_metadata_id = stable_uuid("active-metadata", current_metadata["id"])
        target_folder_id = folder_ids[document["folder_id"]]
        owner_id = owner_ids[row["new_owner_name"]]
        tags = tags_from_legacy(metadata_fields[(doc_id, current_metadata["id"])].get("Tag", ""))
        active_object = active_objects[doc_id]
        original_document_id = row["original_document_id"] or None
        created_at = document["created"] or current_metadata["version_created"]
        updated_at = document["modified"] or current_metadata["version_created"]

        statements.append(
            "INSERT INTO dms_documents(document_id,folder_id,title,current_version_id,tracking_code,status,owner_id,created_at,updated_at,description,category,department,tags,original_document_id) VALUES "
            f"({sql_literal(new_doc_id)}::uuid,{sql_literal(target_folder_id)}::uuid,"
            f"{sql_literal(row['title'])},NULL,NULL,'draft',{sql_literal(owner_id)}::uuid,"
            f"{sql_literal(created_at)}::timestamptz,{sql_literal(updated_at)}::timestamptz,"
            f"{sql_literal(row['description'])},{sql_literal(row['new_category'])},"
            f"{sql_literal(row['new_department'])},{sql_text_array(tags)},{sql_literal(original_document_id)}) "
            "ON CONFLICT (document_id) DO UPDATE SET "
            "folder_id=EXCLUDED.folder_id,title=EXCLUDED.title,owner_id=EXCLUDED.owner_id,"
            "description=EXCLUDED.description,category=EXCLUDED.category,department=EXCLUDED.department,"
            "tags=EXCLUDED.tags,original_document_id=EXCLUDED.original_document_id;"
        )
        statements.append(
            "INSERT INTO dms_document_versions(version_id,document_id,version_number,version_label,file_name,file_size_bytes,mime_type,s3_object_key,sha256_hash,status,is_checked_out,major_version,minor_version,created_at,updated_at) VALUES "
            f"({sql_literal(new_version_id)}::uuid,{sql_literal(new_doc_id)}::uuid,'1.0',NULL,"
            f"{sql_literal(active['filename'])},{int(active['size'])},{sql_literal(mime_type_for(active['filename']))},"
            f"{sql_literal(active_object.key)},{sql_literal(active_object.sha256)},'draft',FALSE,1,0,"
            f"{sql_literal(current_metadata['version_created'])}::timestamptz,now()) "
            "ON CONFLICT (version_id) DO UPDATE SET "
            "file_name=EXCLUDED.file_name,file_size_bytes=EXCLUDED.file_size_bytes,mime_type=EXCLUDED.mime_type,"
            "s3_object_key=EXCLUDED.s3_object_key,sha256_hash=EXCLUDED.sha256_hash;"
        )
        statements.append(
            "INSERT INTO dms_document_metadata(metadata_id,version_id,custom_data,created_at) VALUES "
            f"({sql_literal(new_metadata_id)}::uuid,{sql_literal(new_version_id)}::uuid,"
            f"{sql_json({'sourceSystem': SOURCE_SYSTEM, 'legacyDocumentId': int(doc_id), 'legacyContentVersionId': int(active_id)})},"
            f"{sql_literal(current_metadata['version_created'])}::timestamptz) "
            "ON CONFLICT (metadata_id) DO UPDATE SET custom_data=EXCLUDED.custom_data;"
        )
        statements.append(
            f"UPDATE dms_documents SET current_version_id={sql_literal(new_version_id)}::uuid "
            f"WHERE document_id={sql_literal(new_doc_id)}::uuid;"
        )
        statements.append(
            "INSERT INTO dms_legacy_document_mappings(source_system,legacy_document_id,new_document_id,active_legacy_content_version_id,active_new_version_id,migration_run_id) VALUES "
            f"({sql_literal(SOURCE_SYSTEM)},{int(doc_id)},{sql_literal(new_doc_id)}::uuid,{int(active_id)},"
            f"{sql_literal(new_version_id)}::uuid,{sql_literal(run_id)}::uuid) "
            "ON CONFLICT (source_system,legacy_document_id) DO NOTHING;"
        )

        for metadata in legacy["metadata_by_doc"][doc_id]:
            fields = metadata_fields[(doc_id, metadata["id"])]
            raw = {
                "sourceSystem": SOURCE_SYSTEM,
                "legacyDocumentId": int(doc_id),
                "legacyMetadataVersionId": int(metadata["id"]),
                "legacyContentVersionId": int(metadata["content_version_id"]) if metadata["content_version_id"] else None,
                "metadataSequence": int(metadata["metadata_version"]),
                "title": metadata["name"],
                "descriptionColumn": metadata["description"],
                "fields": fields,
            }
            doc_type = legacy["document_type_by_id"].get(metadata["document_type_id"], "")
            statements.append(
                "INSERT INTO dms_legacy_metadata_snapshots(source_system,legacy_metadata_version_id,legacy_document_id,legacy_content_version_id,metadata_sequence,title,description,original_authors,ip_number,internal_external,original_document_number,legacy_group,legacy_document_type,legacy_tags,is_current_snapshot,snapshot_created_at,raw_metadata) VALUES "
                f"({sql_literal(SOURCE_SYSTEM)},{int(metadata['id'])},{int(doc_id)},"
                f"{int(metadata['content_version_id']) if metadata['content_version_id'] else 'NULL'},"
                f"{int(metadata['metadata_version'])},{sql_literal(metadata['name'])},"
                f"{sql_literal(fields.get('Description') or metadata['description'])},"
                f"{sql_literal(fields.get('Authors'))},{sql_literal(fields.get('IP number'))},"
                f"{sql_literal(fields.get('Internal/External'))},{sql_literal(fields.get('Document #'))},"
                f"{sql_literal(fields.get('Group'))},{sql_literal(doc_type)},{sql_literal(fields.get('Tag'))},"
                f"{sql_literal(metadata['id'] == document['metadata_version_id'])},"
                f"{sql_literal(metadata['version_created'])}::timestamptz,{sql_json(raw)}) "
                "ON CONFLICT (source_system,legacy_metadata_version_id) DO NOTHING;"
            )

        for version in legacy["versions_by_doc"][doc_id]:
            state = content_state[(doc_id, version["id"])]
            statements.append(
                "INSERT INTO dms_legacy_content_versions(source_system,legacy_content_version_id,legacy_document_id,major_version,minor_version,original_filename,source_storage_path,source_size_bytes,source_md5,is_active_source,physical_file_status,archive_object_key,archive_sha256) VALUES "
                f"({sql_literal(SOURCE_SYSTEM)},{int(version['id'])},{int(doc_id)},"
                f"{int(version['major_version'])},{int(version['minor_version'])},"
                f"{sql_literal(version['filename'])},{sql_literal(version['storage_path'])},"
                f"{int(version['size']) if version['size'] else 'NULL'},{sql_literal(version['md5hash'])},"
                f"{sql_literal(version['id'] == active_id)},{sql_literal(state['status'])},"
                f"{sql_literal(state['archive_object_key'])},{sql_literal(state['archive_sha256'])}) "
                "ON CONFLICT (source_system,legacy_content_version_id) DO NOTHING;"
            )
    statements.append("COMMIT;")
    psql_execute("\n".join(statements))


def complete_run(run_id: str) -> None:
    psql_execute(
        "UPDATE dms_legacy_migration_runs SET status='completed',completed_at=now(),"
        "details=details || '{\"database_migration_completed\":true,\"validation_completed\":true}'::jsonb "
        f"WHERE run_id={sql_literal(run_id)}::uuid;"
    )


def mark_run_failed(run_id: str, message: str) -> None:
    psql_execute(
        "UPDATE dms_legacy_migration_runs SET status='failed',completed_at=NULL,"
        f"details=details || {sql_json({'failure': message})} "
        f"WHERE run_id={sql_literal(run_id)}::uuid AND status<>'completed';"
    )


def create_validation_token() -> str:
    env = parse_env_file()
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": APP_ADMIN_ID,
        "email": "system@si-ware.com",
        "name": "System Admin",
        "issued_at": str(now),
        "nbf": now,
        "exp": now + 900,
        "iss": "dms-api",
        "aud": "dms-web",
    }

    def encode(value: object) -> bytes:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=")

    unsigned = encode(header) + b"." + encode(payload)
    signature = hmac.new(env["JWT_SECRET"].encode("utf-8"), unsigned, hashlib.sha256).digest()
    return (unsigned + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")).decode("ascii")


def api_get(path: str, token: str) -> tuple[int, bytes, dict[str, str]]:
    request = urllib.request.Request(
        runtime_settings().api_base_url + path,
        headers={"Authorization": "Bearer " + token},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read(), dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers.items())


def full_folder_paths() -> dict[str, str]:
    rows = psql_rows(
        "WITH RECURSIVE tree AS ("
        "SELECT folder_id,parent_folder_id,name,name::text path FROM dms_folders WHERE parent_folder_id IS NULL "
        "UNION ALL SELECT f.folder_id,f.parent_folder_id,f.name,(t.path||'/'||f.name)::text "
        "FROM dms_folders f JOIN tree t ON t.folder_id=f.parent_folder_id) "
        "SELECT folder_id::text,path FROM tree;"
    )
    return {row[0]: row[1] for row in rows}


def validate_pilot(
    plan: list[dict[str, str]],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
    identities: dict[str, OwnerIdentity],
    document_target_paths: dict[str, str],
    minio: MinioClient,
) -> list[dict[str, object]]:
    token = create_validation_token()
    folder_paths = full_folder_paths()
    expected_objects = set()
    results = []
    for row in plan:
        doc_id = row["legacy_document_id"]
        new_doc_id = stable_uuid("document", doc_id)
        active_id = row["active_content_version_id"]
        new_version_id = stable_uuid("active-version", active_id)
        data_rows = psql_rows(
            "SELECT row_to_json(x)::text FROM (SELECT d.title,d.description,d.tags,"
            "d.department,d.category,COALESCE(d.original_document_id,'') original_document_id,"
            "d.current_version_id::text current_version_id,d.status document_status,u.full_name,u.email,"
            "d.folder_id::text folder_id,v.version_id::text version_id,v.file_name,"
            "v.s3_object_key,v.sha256_hash,v.version_number,v.status version_status,v.is_checked_out,"
            "md.metadata_id::text metadata_id,md.custom_data "
            "FROM dms_documents d JOIN dms_users u ON u.user_id=d.owner_id "
            "JOIN dms_document_versions v ON v.version_id=d.current_version_id "
            "LEFT JOIN dms_document_metadata md ON md.version_id=v.version_id "
            f"WHERE d.document_id={sql_literal(new_doc_id)}::uuid) x;"
        )
        checks: dict[str, bool] = {}
        reasons = []
        if len(data_rows) != 1:
            data = {}
            reasons.append("document/current-version join missing")
        else:
            data = json.loads(data_rows[0][0])
        current_metadata = legacy["metadata_by_id"][legacy["document_by_id"][doc_id]["metadata_version_id"]]
        expected_tags = tags_from_legacy(metadata_fields[(doc_id, current_metadata["id"])].get("Tag", ""))
        expected_sha = sha256_file(BLOBS_DIR / Path(legacy["version_by_id"][active_id]["storage_path"]))
        checks.update({
            "document_exists": len(data_rows) == 1,
            "active_filename_correct": data.get("file_name") == row["active_filename"],
            "owner_correct": data.get("full_name") == row["new_owner_name"] and data.get("email", "").casefold() == identities[row["new_owner_name"]].email,
            "department_correct": data.get("department") == row["new_department"],
            "category_correct": data.get("category") == row["new_category"],
            "description_correct": data.get("description") == row["description"],
            "tags_correct": (data.get("tags") or []) == expected_tags,
            "original_document_id_correct": data.get("original_document_id") == row["original_document_id"],
            "folder_hierarchy_correct": folder_paths.get(data.get("folder_id", ""), "") == document_target_paths[doc_id],
            "sha256_stored": data.get("sha256_hash") == expected_sha,
            "version_row_valid": data.get("version_id") == new_version_id and data.get("version_number") == "1.0",
            "current_version_valid": data.get("current_version_id") == new_version_id,
            "fresh_new_dms_state": (
                data.get("document_status") == "draft"
                and data.get("version_status") == "draft"
                and data.get("is_checked_out") is False
            ),
            "metadata_record_valid": (
                data.get("metadata_id") == stable_uuid("active-metadata", current_metadata["id"])
                and data.get("custom_data") == {
                    "sourceSystem": SOURCE_SYSTEM,
                    "legacyDocumentId": int(doc_id),
                    "legacyContentVersionId": int(active_id),
                }
            ),
        })
        active_key = data.get("s3_object_key", "")
        if active_key:
            expected_objects.add(active_key)
        actual_active_sha = minio.object_sha256(active_key) if active_key else None
        checks["active_file_in_minio"] = actual_active_sha == expected_sha

        archive_counts = psql_rows(
            "SELECT "
            "(SELECT count(*) FROM dms_legacy_metadata_snapshots WHERE source_system='KnowledgeTree' AND legacy_document_id=" + doc_id + "),"
            "(SELECT count(*) FROM dms_legacy_content_versions WHERE source_system='KnowledgeTree' AND legacy_document_id=" + doc_id + "),"
            "(SELECT count(*) FROM dms_legacy_content_versions WHERE source_system='KnowledgeTree' AND legacy_document_id=" + doc_id + " AND physical_file_status='archived'),"
            "(SELECT count(*) FROM dms_legacy_content_versions WHERE source_system='KnowledgeTree' AND legacy_document_id=" + doc_id + " AND physical_file_status='source_file_missing');"
        )[0]
        expected_metadata = len(legacy["metadata_by_doc"][doc_id])
        expected_content = len(legacy["versions_by_doc"][doc_id])
        expected_archived = 0
        expected_missing = 0
        archive_hashes_valid = True
        expected_content_rows: dict[str, dict[str, object]] = {}
        for version in legacy["versions_by_doc"][doc_id]:
            path = BLOBS_DIR / Path(version["storage_path"]) if version["storage_path"] else None
            is_active = version["id"] == active_id
            archive_key = ""
            archive_sha = ""
            if not path or not path.is_file():
                physical_status = "source_file_missing"
                if not is_active:
                    expected_missing += 1
            elif path.stat().st_size == 0:
                physical_status = "source_file_zero_byte"
            elif md5_file(path).casefold() != (version["md5hash"] or "").casefold():
                physical_status = "source_md5_mismatch"
            elif is_active:
                physical_status = "active_in_new_dms"
            else:
                physical_status = "archived"
                expected_archived += 1
                archive_key = (
                    f"legacy/archive/{SOURCE_SYSTEM}/documents/{doc_id}/content/"
                    f"{version['id']}/{safe_object_filename(version['filename'])}"
                )
                archive_sha = sha256_file(path)
                expected_objects.add(archive_key)
                archive_hashes_valid = (
                    archive_hashes_valid and minio.object_sha256(archive_key) == archive_sha
                )
            expected_content_rows[version["id"]] = {
                "legacy_document_id": doc_id,
                "major_version": int(version["major_version"]),
                "minor_version": int(version["minor_version"]),
                "original_filename": version["filename"],
                "source_storage_path": version["storage_path"] or "",
                "source_size_bytes": str(version["size"] or ""),
                "source_md5": version["md5hash"] or "",
                "is_active_source": is_active,
                "physical_file_status": physical_status,
                "archive_object_key": archive_key,
                "archive_sha256": archive_sha,
            }

        metadata_rows = psql_rows(
            "SELECT row_to_json(x)::text FROM (SELECT legacy_metadata_version_id::text,"
            "legacy_content_version_id::text,metadata_sequence,title,description,original_authors,"
            "ip_number,internal_external,original_document_number,legacy_group,legacy_document_type,"
            "legacy_tags,is_current_snapshot,snapshot_created_at::text,raw_metadata "
            "FROM dms_legacy_metadata_snapshots WHERE source_system='KnowledgeTree' "
            f"AND legacy_document_id={doc_id} ORDER BY metadata_sequence,legacy_metadata_version_id) x;"
        )
        actual_metadata_rows = {
            item["legacy_metadata_version_id"]: item
            for item in (json.loads(value[0]) for value in metadata_rows)
        }
        metadata_matches = len(actual_metadata_rows) == expected_metadata
        for metadata in legacy["metadata_by_doc"][doc_id]:
            fields = metadata_fields[(doc_id, metadata["id"])]
            actual = actual_metadata_rows.get(metadata["id"], {})
            expected_raw = {
                "sourceSystem": SOURCE_SYSTEM,
                "legacyDocumentId": int(doc_id),
                "legacyMetadataVersionId": int(metadata["id"]),
                "legacyContentVersionId": int(metadata["content_version_id"]) if metadata["content_version_id"] else None,
                "metadataSequence": int(metadata["metadata_version"]),
                "title": metadata["name"],
                "descriptionColumn": metadata["description"],
                "fields": fields,
            }
            expected_fields = {
                "legacy_content_version_id": metadata["content_version_id"] or None,
                "metadata_sequence": int(metadata["metadata_version"]),
                "title": metadata["name"],
                "description": fields.get("Description") or metadata["description"],
                "original_authors": fields.get("Authors"),
                "ip_number": fields.get("IP number"),
                "internal_external": fields.get("Internal/External"),
                "original_document_number": fields.get("Document #"),
                "legacy_group": fields.get("Group"),
                "legacy_document_type": legacy["document_type_by_id"].get(metadata["document_type_id"], ""),
                "legacy_tags": fields.get("Tag"),
                "is_current_snapshot": metadata["id"] == legacy["document_by_id"][doc_id]["metadata_version_id"],
                "raw_metadata": expected_raw,
            }
            metadata_matches = metadata_matches and all(
                actual.get(key) == value for key, value in expected_fields.items()
            )
            metadata_matches = metadata_matches and normalized_timestamp(
                actual.get("snapshot_created_at")
            ) == normalized_timestamp(metadata["version_created"])

        content_rows = psql_rows(
            "SELECT row_to_json(x)::text FROM (SELECT legacy_content_version_id::text,"
            "legacy_document_id::text,major_version,minor_version,original_filename,"
            "COALESCE(source_storage_path,'') source_storage_path,"
            "COALESCE(source_size_bytes::text,'') source_size_bytes,COALESCE(source_md5,'') source_md5,"
            "is_active_source,physical_file_status,COALESCE(archive_object_key,'') archive_object_key,"
            "COALESCE(archive_sha256,'') archive_sha256 FROM dms_legacy_content_versions "
            f"WHERE source_system='KnowledgeTree' AND legacy_document_id={doc_id} "
            "ORDER BY legacy_content_version_id) x;"
        )
        actual_content_rows = {
            item["legacy_content_version_id"]: item
            for item in (json.loads(value[0]) for value in content_rows)
        }
        content_matches = len(actual_content_rows) == expected_content
        for version_id, expected in expected_content_rows.items():
            actual = actual_content_rows.get(version_id, {})
            content_matches = content_matches and all(
                actual.get(key) == value for key, value in expected.items()
            )

        checks["legacy_metadata_archive"] = (
            int(archive_counts[0]) == expected_metadata and metadata_matches
        )
        checks["legacy_content_archive"] = (
            int(archive_counts[1]) == expected_content
            and int(archive_counts[2]) == expected_archived
            and int(archive_counts[3]) == expected_missing
            and content_matches
            and archive_hashes_valid
        )

        duplicate_count = int(psql_rows(
            "SELECT count(*) FROM dms_legacy_document_mappings WHERE source_system='KnowledgeTree' "
            f"AND legacy_document_id={doc_id} AND new_document_id={sql_literal(new_doc_id)}::uuid;"
        )[0][0])
        version_count = int(psql_rows(
            f"SELECT count(*) FROM dms_document_versions WHERE document_id={sql_literal(new_doc_id)}::uuid;"
        )[0][0])
        metadata_count = int(psql_rows(
            "SELECT count(*) FROM dms_document_metadata "
            f"WHERE version_id={sql_literal(new_version_id)}::uuid;"
        )[0][0])
        checks["no_duplicate_records"] = (
            duplicate_count == 1 and version_count == 1 and metadata_count == 1
        )

        api_status, api_body, _ = api_get(f"/api/documents/{new_doc_id}", token)
        try:
            api_json = json.loads(api_body.decode("utf-8"))
        except Exception:
            api_json = {}
        checks["api_read"] = (
            api_status == 200
            and api_json.get("success") is True
            and api_json.get("data", {}).get("fileName") == row["active_filename"]
            and api_json.get("data", {}).get("currentVersionId", "").casefold() == new_version_id
        )
        download_status, download_body, _ = api_get(
            f"/api/documents/{new_doc_id}/versions/{new_version_id}/download", token
        )
        checks["api_download"] = download_status == 200 and hashlib.sha256(download_body).hexdigest() == expected_sha
        for name, passed in checks.items():
            if not passed:
                reasons.append(name)
        results.append({
            "legacy_document_id": doc_id,
            "new_document_id": new_doc_id,
            "new_version_id": new_version_id,
            "owner": row["new_owner_name"],
            "active_filename": row["active_filename"],
            "active_object_key": active_key,
            "checks": checks,
            "expected_objects": expected_objects,
            "reason": "; ".join(reasons),
            "overall": all(checks.values()),
        })

    relevant_actual = set()
    for doc_id in PILOT_IDS:
        relevant_actual.update(minio.list_keys(f"legacy/archive/{SOURCE_SYSTEM}/documents/{doc_id}"))
    for result in results:
        relevant_actual.update(minio.list_keys(f"documents/{result['new_document_id']}"))
    orphan_free = relevant_actual == expected_objects
    orphan_detail = sorted(relevant_actual.symmetric_difference(expected_objects))
    for result in results:
        result["checks"]["no_orphan_minio_objects"] = orphan_free
        if not orphan_free:
            result["reason"] = (result["reason"] + "; " if result["reason"] else "") + "orphan/object mismatch: " + ", ".join(orphan_detail)
        result["overall"] = all(result["checks"].values())
    return results


def write_outputs(
    plan: list[dict[str, str]],
    legacy: dict[str, object],
    identities: dict[str, OwnerIdentity],
    document_target_paths: dict[str, str],
    cleanup: dict[str, object],
    backup: dict[str, str],
    results: list[dict[str, object]],
) -> None:
    validation_fields = [
        "legacy_document_id", "new_document_id", "new_version_id", "owner", "active_filename",
        "document_exists", "active_file_in_minio", "active_filename_correct", "owner_correct",
        "department_correct", "category_correct", "description_correct", "tags_correct",
        "original_document_id_correct", "folder_hierarchy_correct", "sha256_stored",
        "version_row_valid", "current_version_valid", "fresh_new_dms_state",
        "metadata_record_valid", "legacy_metadata_archive",
        "legacy_content_archive", "no_duplicate_records", "api_read", "api_download",
        "no_orphan_minio_objects", "overall", "reason",
    ]
    with VALIDATION_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=validation_fields, lineterminator="\n")
        writer.writeheader()
        for result in results:
            writer.writerow({
                **{key: result.get(key, "") for key in validation_fields},
                **{key: "PASS" if value else "FAIL" for key, value in result["checks"].items()},
                "overall": "PASS" if result["overall"] else "FAIL",
                "reason": result["reason"],
            })

    mapping_fields = [
        "source_system", "legacy_document_id", "new_document_id", "legacy_folder_id",
        "new_folder_id", "target_folder_path", "active_legacy_content_version_id",
        "active_new_version_id", "approved_owner_name", "approved_owner_email",
    ]
    folder_paths = full_folder_paths()
    with ID_MAPPING_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=mapping_fields, lineterminator="\n")
        writer.writeheader()
        for row in plan:
            doc_id = row["legacy_document_id"]
            mapping = psql_rows(
                "SELECT m.new_document_id::text,d.folder_id::text,m.active_new_version_id::text "
                "FROM dms_legacy_document_mappings m JOIN dms_documents d ON d.document_id=m.new_document_id "
                f"WHERE m.source_system='KnowledgeTree' AND m.legacy_document_id={doc_id};"
            )[0]
            legacy_folder_id = legacy["document_by_id"][doc_id]["folder_id"]
            writer.writerow({
                "source_system": SOURCE_SYSTEM,
                "legacy_document_id": doc_id,
                "new_document_id": mapping[0],
                "legacy_folder_id": legacy_folder_id,
                "new_folder_id": mapping[1],
                "target_folder_path": folder_paths[mapping[1]],
                "active_legacy_content_version_id": row["active_content_version_id"],
                "active_new_version_id": mapping[2],
                "approved_owner_name": row["new_owner_name"],
                "approved_owner_email": identities[row["new_owner_name"]].email,
            })

    success_count = sum(bool(result["overall"]) for result in results)
    lines = [
        "# Actual five-document KnowledgeTree migration pilot\n\n",
        f"Status: **{'SUCCESS' if success_count == 5 else 'FAILED'}** ({success_count}/5 documents validated).\n\n",
        "## Backup\n\n",
        f"- Directory: `{backup['directory']}`\n",
        f"- PostgreSQL SHA-256: `{backup['postgres_sha256']}`\n",
        f"- MinIO SHA-256: `{backup['minio_sha256']}`\n\n",
        "## Owner identities\n\n",
    ]
    for identity in identities.values():
        lines.append(
            f"- {identity.approved_name}: `{identity.email}` from KnowledgeTree user ID(s) "
            f"{', '.join(identity.legacy_user_ids)} / username(s) {', '.join(identity.legacy_usernames)}.\n"
        )
    lines.extend(["\n## Scoped mock/test cleanup\n\n"])
    if cleanup.get("performed") or cleanup.get("previously_performed"):
        counts = cleanup["counts_before"]
        if cleanup.get("previously_performed"):
            lines.append("- Cleanup was completed on the first execution and was not repeated on the idempotent validation rerun.\n")
        lines.extend([
            f"- Removed {counts['documents']} inspected mock documents and {counts['versions']} database version rows.\n",
            f"- Removed {cleanup['deleted_document_object_count']} development document objects and {cleanup['deleted_task_object_count']} development task-attachment objects from MinIO.\n",
            f"- Removed mutable test notifications ({counts['notifications']}), approvals ({counts['approvals']}), announcements ({counts['announcements']}), groups ({counts['groups']}), and unprotected task attachments ({counts['task_attachments']}).\n",
            f"- Soft-deactivated {len(cleanup['deactivated_user_ids'])} mock users using the supported user lifecycle; no account with immutable history was physically deleted.\n",
            f"- Preserved {counts['audit_trails_preserved']} WORM audit rows and {counts['reminders_preserved']} WORM reminders. Three reminder-linked test task anchors remain completed; WORM triggers were not disabled.\n",
            "- Preserved the built-in System Admin, page-access roles, role permissions, app settings, schema/migrations, ISO tag values, scheduled DB backup object, and the System Admin calendar connection.\n",
        ])
    else:
        lines.append(f"- Cleanup not repeated: {cleanup.get('reason', 'already complete')}.\n")
    lines.extend([
        "\n## Master data\n\n",
        "- Departments: " + ", ".join(DEPARTMENTS) + ".\n",
        "- Categories: " + ", ".join(CATEGORIES) + ".\n",
        "- Values are created idempotently with case-insensitive duplicate checks.\n\n",
        "## Document validation\n\n",
        "| Legacy ID | Owner | Active filename | Target folder | Result |\n",
        "|---:|---|---|---|---|\n",
    ])
    by_id = {result["legacy_document_id"]: result for result in results}
    for row in plan:
        result = by_id[row["legacy_document_id"]]
        lines.append(
            f"| {row['legacy_document_id']} | {row['new_owner_name']} | {row['active_filename']} | "
            f"{document_target_paths[row['legacy_document_id']]} | {'PASS' if result['overall'] else 'FAIL'} |\n"
        )
    lines.extend([
        "\nThe active object for each document is the content version referenced by the current KnowledgeTree metadata snapshot. Historical metadata snapshots are stored in `dms_legacy_metadata_snapshots`; historical content records are stored in `dms_legacy_content_versions`; available historical files use the `legacy/archive/KnowledgeTree/` MinIO namespace. No KnowledgeTree permission or workflow row was migrated. New-DMS status/versioning starts at draft version `1.0`.\n\n",
        "Two known previous blobs are absent from the supplied export and are represented explicitly as `source_file_missing`: document 177/content 245 and document 497/content 1087. This does not hide or fabricate the unavailable bytes.\n\n",
        "Four document 177 archive-description rows affected by the first Windows stdin CRCRLF artifact were repaired to the exact source CRLF value before append-only protection was enabled. The final validator compares every archived metadata field/raw snapshot/date and SHA-256-checks every available historical object.\n\n",
        "## Failures\n\n",
    ])
    failures = [result for result in results if not result["overall"]]
    if failures:
        for result in failures:
            lines.append(f"- Document {result['legacy_document_id']}: {result['reason']}\n")
    else:
        lines.append("- None.\n")
    REPORT_MD.write_text("".join(lines), encoding="utf-8")

    backup_dir = Path(backup["directory"])
    env = parse_env_file()
    postgres_user = env["POSTGRES_USER"]
    postgres_db = env["POSTGRES_DB"]
    rollback = f"""# Five-document pilot rollback

The snapshot below predates every pilot write and was verified readable before execution.

- PostgreSQL dump: `{backup_dir / 'postgres_pre_migration.dump'}`
- PostgreSQL SHA-256: `{backup['postgres_sha256']}`
- MinIO volume snapshot: `{backup_dir / 'minio_pre_migration.tar.gz'}`
- MinIO SHA-256: `{backup['minio_sha256']}`

## Full restore procedure

Run from `{REPO_DIR}`. This intentionally restores the whole local PostgreSQL database configured as `{postgres_db}` and the MinIO service's `/data` volume to the pre-pilot state.

1. Recompute SHA-256 for both files and compare with the values above.
2. Stop writers: `docker compose stop api minio`.
3. Use `docker compose cp` to copy the dump to `postgres:/tmp/postgres_pre_migration.dump`. Through `docker compose exec postgres`, terminate sessions to `{postgres_db}`, drop/recreate that configured database, and run `pg_restore --exit-on-error --no-owner --no-privileges -U {postgres_user} -d {postgres_db} /tmp/postgres_pre_migration.dump`.
4. With MinIO still stopped, resolve its exact volume name from the Compose service instead of assuming a project prefix: `$minioContainer = docker compose ps -q minio`; then `$minioVolume = docker inspect $minioContainer --format '{{{{range .Mounts}}}}{{{{if eq .Destination \"/data\"}}}}{{{{.Name}}}}{{{{end}}}}{{{{end}}}}'`. Abort if either value is empty. Mount only that resolved volume and the exact backup directory in a temporary container, remove the contents of `/data`, then extract `minio_pre_migration.tar.gz` into `/data`.
5. Start services: `docker compose start minio api` and wait for both health checks.
6. Verify that the five rows are absent, the prior 9 mock documents/29 versions are restored, and the MinIO object listing matches the pre-pilot snapshot.

The backup files are retained under `Migration/backups/`; rollback has not been executed.
"""
    ROLLBACK_MD.write_text(rollback, encoding="utf-8")


def write_failure_report(message: str, backup: dict[str, str] | None = None) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Actual five-document KnowledgeTree migration pilot\n\n",
        "Status: **FAILED**.\n\n",
        "## Blocking failure\n\n",
        f"- {message}\n",
    ]
    if backup:
        lines.extend([
            "\n## Backup\n\n",
            f"- Directory: `{backup['directory']}`\n",
            f"- PostgreSQL SHA-256: `{backup['postgres_sha256']}`\n",
            f"- MinIO SHA-256: `{backup['minio_sha256']}`\n",
        ])
    REPORT_MD.write_text("".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="perform the actual local pilot")
    parser.add_argument("--backup-dir", type=Path, help="verified pre-migration snapshot directory")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    backup = None
    run_id = None
    try:
        required = [SOURCE_DUMP, BLOBS_DIR, PILOT_PLAN_CSV, METADATA_TSV, ARCHIVE_SCHEMA_SQL, REPO_DIR / ".env"]
        missing = [str(path) for path in required if not path.exists()]
        if missing:
            raise RuntimeError("Missing required input(s): " + ", ".join(missing))
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        plan = load_plan()
        validate_approved_owner_plan(plan)
        dump_text = load_dump_text(SOURCE_DUMP)
        identities = resolve_owner_identities(plan, dump_text)
        legacy = load_legacy_data()
        metadata_fields = load_metadata_fields(set(PILOT_IDS))
        validate_source(plan, legacy, metadata_fields)
        folders_by_id, _ = load_legacy_folders()

        if not args.execute:
            print("INPUT VALIDATION PASS - actual migration requires --execute --backup-dir <path>")
            return 0
        if args.backup_dir is None:
            raise RuntimeError("--backup-dir is required with --execute")
        backup = verify_backup(args.backup_dir)

        ensure_archive_schema()
        run_id = start_run(source_manifest_hash(), backup)
        minio = MinioClient()
        cleanup = run_cleanup_once(run_id, minio)
        owner_ids = prepare_master_data_and_users(identities)
        folder_ids, document_target_paths = ensure_folders(
            plan, legacy, folders_by_id, run_id
        )
        active_objects, content_state = upload_source_objects(plan, legacy, minio)
        migrate_database(
            plan, legacy, metadata_fields, owner_ids, folder_ids,
            active_objects, content_state, run_id,
        )
        results = validate_pilot(
            plan, legacy, metadata_fields, identities, document_target_paths, minio
        )
        write_outputs(
            plan, legacy, identities, document_target_paths, cleanup, backup, results
        )
        migrated = sum(bool(result["overall"]) for result in results)
        if migrated == 5:
            complete_run(run_id)
        else:
            mark_run_failed(run_id, f"post-migration validation passed for only {migrated}/5 documents")
        print(f"ACTUAL PILOT: {'SUCCESS' if migrated == 5 else 'FAILED'}")
        print(f"Documents migrated: {migrated} / 5")
        return 0 if migrated == 5 else 1
    except Exception as exc:
        if run_id is not None:
            try:
                mark_run_failed(run_id, str(exc))
            except Exception as status_exc:
                print(f"Could not mark migration run failed: {status_exc}", file=sys.stderr)
        write_failure_report(str(exc), backup)
        print(f"ACTUAL PILOT: FAILED\n{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
