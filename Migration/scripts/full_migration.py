#!/usr/bin/env python3
"""Resumable full KnowledgeTree -> local New-DMS migration.

The five proven pilot mappings are validated and skipped.  Every other source
document is committed in its own PostgreSQL transaction with deterministic
UUIDs and MinIO keys.  Source-file and owner/business exceptions retain their
Legacy Archive evidence without creating a fake active New-DMS document.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from actual_pilot_migration import (
    CATEGORIES,
    DEPARTMENTS,
    OUTPUT_DIR,
    REPO_DIR,
    SOURCE_SYSTEM,
    USERS_COLS,
    OwnerIdentity,
    api_get,
    canonical_person,
    create_validation_token,
    ensure_folders,
    folder_chain,
    full_folder_paths,
    load_legacy_folders,
    mime_type_for,
    prepare_master_data_and_users,
    psql_execute,
    runtime_settings,
    safe_object_filename,
    sha256_file,
    sql_json,
    sql_literal,
    sql_text_array,
    stable_uuid,
    verify_backup,
)
from pilot_migration import (
    BLOBS_DIR,
    METADATA_TSV,
    SOURCE_DUMP,
    load_current_metadata,
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


PILOT_IDS = {"230", "177", "238", "497", "24"}
KNOWN_SOURCE_EXCEPTION_IDS = {"164", "507", "928"}
RUN_KEY = "knowledge-tree-full-migration-v1"
RUN_ID = stable_uuid("run", RUN_KEY)
ARCHIVE_SCHEMA_SQL = REPO_DIR / "infra" / "db" / "init" / "075_legacy_migration_archive.sql"
FULL_SCHEMA_SQL = REPO_DIR / "infra" / "db" / "init" / "080_full_legacy_migration.sql"

REPORT_MD = OUTPUT_DIR / "16_full_migration_report.md"
VALIDATION_CSV = OUTPUT_DIR / "16_full_migration_validation.csv"
EXCEPTIONS_CSV = OUTPUT_DIR / "16_full_migration_exceptions.csv"
ID_MAPPING_CSV = OUTPUT_DIR / "16_legacy_new_id_mapping.csv"
ROLLBACK_MD = OUTPUT_DIR / "16_full_migration_rollback.md"


@dataclass(frozen=True)
class StoredObject:
    key: str
    sha256: str
    size: int


def active_source_status(
    version: dict[str, str], *, verify_md5: bool = False
) -> tuple[str, Path | None]:
    storage_path = (version.get("storage_path") or "").strip()
    source = BLOBS_DIR / Path(storage_path) if storage_path else None
    if source is None or not source.is_file():
        return "source_file_missing", source
    if source.stat().st_size == 0:
        return "source_file_zero_byte", source
    if verify_md5:
        expected_md5 = (version.get("md5hash") or "").strip().casefold()
        if not expected_md5 or md5_file(source).casefold() != expected_md5:
            return "source_md5_mismatch", source
    return "ready", source


def build_full_plan() -> tuple[list[dict[str, object]], dict[str, object], dict[tuple[str, str], dict[str, str]]]:
    legacy = load_legacy_data()
    current_fields = load_current_metadata()
    _, owner_by_original = resolve_owners()
    all_ids = {row["id"] for row in legacy["documents"]}

    metadata_fields: dict[tuple[str, str], dict[str, str]] = defaultdict(dict)
    with METADATA_TSV.open(encoding="utf-8", newline="") as handle:
        for field in csv.DictReader(handle, delimiter="\t"):
            if field["doc_id"] in all_ids:
                metadata_fields[(field["doc_id"], field["metadata_version_id"])][field["field_name"]] = field["field_value"]

    plan: list[dict[str, object]] = []
    for document in sorted(legacy["documents"], key=lambda row: int(row["id"])):
        doc_id = document["id"]
        fields = current_fields.get(doc_id, {})
        author = fields.get("Authors", "")
        resolution = owner_by_original.get(author)
        if resolution is None:
            raise RuntimeError(f"Document {doc_id} Author is absent from the original 238-value workbook: {author!r}")

        current_metadata = legacy["metadata_by_id"].get(document["metadata_version_id"])
        if current_metadata is None:
            raise RuntimeError(f"Document {doc_id} current metadata pointer is missing")
        active = legacy["version_by_id"].get(current_metadata["content_version_id"])
        if active is None or active["document_id"] != doc_id:
            raise RuntimeError(f"Document {doc_id} current metadata content pointer is invalid")
        source_status, source = active_source_status(active)
        category = legacy["document_type_by_id"].get(current_metadata["document_type_id"], "")
        department = fields.get("Group", "")
        if department not in DEPARTMENTS:
            raise RuntimeError(f"Document {doc_id} has unsupported Department {department!r}")
        if category not in CATEGORIES:
            raise RuntimeError(f"Document {doc_id} has unsupported Category {category!r}")

        if doc_id in PILOT_IDS:
            migration_status = "pilot_already_migrated"
            exception_reason = ""
        elif source_status != "ready":
            migration_status = "source_exception"
            exception_reason = source_status
        elif resolution.status != "UNAMBIGUOUS":
            migration_status = "owner_business_input"
            exception_reason = (
                "Approved owner is split at normalized legacy-Author level; "
                f"document-level choice required from: {' | '.join(resolution.owners)}"
            )
        else:
            migration_status = "ready"
            exception_reason = ""

        if doc_id in KNOWN_SOURCE_EXCEPTION_IDS and migration_status != "source_exception":
            raise RuntimeError(f"Known source exception {doc_id} no longer matches physical validation")
        original_number = fields.get("Document #", "")
        plan.append({
            "legacy_document_id": doc_id,
            "title": current_metadata["name"] or "",
            "legacy_author_original": author,
            "legacy_author_corrected": " | ".join(resolution.corrected_values),
            "owner_resolution_status": resolution.status,
            "owner_candidates": " | ".join(resolution.owners),
            "new_owner_name": resolution.owner if resolution.status == "UNAMBIGUOUS" else "",
            "owner_email": "",
            "new_department": department,
            "new_category": category,
            # Active Description is the KnowledgeTree "Description" metadata
            # field. The separate metadata-version description column remains
            # in raw_metadata but is not an active-field substitute.
            "description": fields.get("Description", ""),
            "tags": tags_from_legacy(fields.get("Tag", "")),
            "document_number": original_number,
            "original_document_id": transformed_original_document_id(original_number),
            "active_content_version_id": active["id"],
            "active_filename": active["filename"],
            "active_storage_path": active["storage_path"],
            "active_md5": active["md5hash"],
            "active_source_path": str(source) if source else "",
            "active_source_status": source_status,
            "metadata_snapshot_count": len(legacy["metadata_by_doc"][doc_id]),
            "content_version_count": len(legacy["versions_by_doc"][doc_id]),
            "legacy_folder_id": document["folder_id"],
            "migration_status": migration_status,
            "exception_reason": exception_reason,
        })

    if len(plan) != 1008:
        raise RuntimeError(f"Expected 1008 source documents, found {len(plan)}")
    return plan, legacy, dict(metadata_fields)


def resolve_available_owner_identities(
    plan: list[dict[str, object]],
) -> tuple[dict[str, OwnerIdentity], dict[str, str]]:
    dump_text = load_dump_text(SOURCE_DUMP)
    legacy_users = rows_to_dicts(extract_table_rows(dump_text, "users"), USERS_COLS)
    existing_new_users = psql_rows(
        "SELECT full_name,email,is_active::text FROM dms_users WHERE email IS NOT NULL AND btrim(email)<>'';"
    )
    identities: dict[str, OwnerIdentity] = {}
    unresolved: dict[str, str] = {}
    approved_names = sorted({str(row["new_owner_name"]) for row in plan if row["new_owner_name"]})

    for approved_name in approved_names:
        key = canonical_person(approved_name)
        candidates = [
            row for row in legacy_users
            if canonical_person(row.get("name") or "") == key and (row.get("email") or "").strip()
        ]
        emails = sorted({(row["email"] or "").strip().casefold() for row in candidates})
        enabled = any((row.get("disabled") or "0") == "0" for row in candidates)
        if len(emails) == 1 and enabled:
            identities[approved_name] = OwnerIdentity(
                approved_name=approved_name,
                email=emails[0],
                legacy_user_ids=tuple(sorted({row["id"] for row in candidates}, key=int)),
                legacy_usernames=tuple(sorted({row["username"] for row in candidates}, key=str.casefold)),
            )
            continue

        # An already-existing active New-DMS user is also authoritative local
        # identity data.  Exact canonical full-name match only; no fuzzy choice.
        new_matches = [row for row in existing_new_users if canonical_person(row[0]) == key and row[2] == "true"]
        new_emails = sorted({row[1].strip().casefold() for row in new_matches if row[1].strip()})
        if len(new_emails) == 1:
            identities[approved_name] = OwnerIdentity(approved_name, new_emails[0], tuple(), tuple())
            continue

        name_only = [
            row for row in legacy_users
            if canonical_person(row.get("name") or "") == key
        ]
        if name_only and not emails:
            unresolved[approved_name] = "Exact legacy account exists but has no authoritative email"
        elif len(emails) > 1:
            unresolved[approved_name] = f"Exact legacy account name has multiple emails: {' | '.join(emails)}"
        elif candidates and not enabled:
            unresolved[approved_name] = "All exact legacy accounts are disabled"
        else:
            unresolved[approved_name] = "No exact authoritative legacy/New-DMS account with email"
    return identities, unresolved


def apply_owner_identity_classification(
    plan: list[dict[str, object]],
    identities: dict[str, OwnerIdentity],
    unresolved: dict[str, str],
) -> None:
    for row in plan:
        owner = str(row.get("new_owner_name") or "")
        if owner in identities:
            row["owner_email"] = identities[owner].email
        elif row["migration_status"] == "ready":
            row["migration_status"] = "owner_business_input"
            row["exception_reason"] = f"Approved owner {owner!r}: {unresolved.get(owner, 'identity unresolved')}"


class DirectMinio:
    """MinIO SDK wrapper with byte-for-byte SHA-256 verification."""

    def __init__(self) -> None:
        try:
            from minio import Minio
            from minio.error import S3Error
        except ImportError as exc:
            raise RuntimeError(
                "Python MinIO client is required; run: python -m pip install -r "
                "Migration/scripts/requirements.txt"
            ) from exc
        env = parse_env_file()
        settings = runtime_settings()
        endpoint = settings.minio_endpoint.removeprefix("http://").removeprefix("https://")
        self.client = Minio(
            endpoint,
            access_key=env["MINIO_ROOT_USER"],
            secret_key=env["MINIO_ROOT_PASSWORD"],
            secure=settings.minio_endpoint.startswith("https://"),
        )
        self.bucket = settings.minio_bucket
        self._s3_error = S3Error
        if not self.client.bucket_exists(self.bucket):
            raise RuntimeError(f"MinIO bucket does not exist: {self.bucket}")

    def object_sha256(self, key: str) -> str | None:
        try:
            response = self.client.get_object(self.bucket, key)
            digest = hashlib.sha256()
            try:
                for chunk in response.stream(1024 * 1024):
                    digest.update(chunk)
            finally:
                response.close()
                response.release_conn()
            return digest.hexdigest()
        except self._s3_error as exc:
            if exc.code in {"NoSuchKey", "NoSuchObject", "NotFound"}:
                return None
            raise

    def put_verified(self, source: Path, key: str, expected_sha256: str) -> StoredObject:
        existing = self.object_sha256(key)
        if existing is not None:
            if existing != expected_sha256:
                raise RuntimeError(f"Existing MinIO object has wrong SHA-256: {key}")
            return StoredObject(key, existing, source.stat().st_size)

        with source.open("rb") as handle:
            self.client.put_object(
                self.bucket,
                key,
                handle,
                source.stat().st_size,
                content_type=mime_type_for(source.name),
                part_size=64 * 1024 * 1024,
            )
        actual = self.object_sha256(key)
        if actual != expected_sha256:
            raise RuntimeError(f"Post-upload SHA-256 mismatch for {key}")
        return StoredObject(key, actual, source.stat().st_size)

    def list_keys(self, prefix: str = "") -> list[str]:
        return sorted(item.object_name for item in self.client.list_objects(self.bucket, prefix=prefix, recursive=True))

    def remove_prefix(self, prefix: str) -> None:
        for key in self.list_keys(prefix):
            self.client.remove_object(self.bucket, key)


def migration_manifest_hash() -> str:
    digest = hashlib.sha256()
    files = [
        REPO_DIR / "Migration" / "MIGRATION_SPEC.md",
        OUTPUT_DIR / "11_owner_author_classification.xlsx",
        OUTPUT_DIR / "Final DMS Mapping.xlsx",
        OUTPUT_DIR / "12_owner_mapping_resolution.csv",
        SOURCE_DUMP,
        METADATA_TSV,
        ARCHIVE_SCHEMA_SQL,
        FULL_SCHEMA_SQL,
    ]
    for path in files:
        digest.update(path.relative_to(REPO_DIR).as_posix().encode("utf-8"))
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def ensure_full_schema() -> None:
    archive_exists = psql_rows(
        "SELECT to_regclass('public.dms_legacy_migration_runs') IS NOT NULL;"
    )
    if not archive_exists or archive_exists[0][0] != "t":
        psql_execute(ARCHIVE_SCHEMA_SQL.read_text(encoding="utf-8"))
    psql_execute(FULL_SCHEMA_SQL.read_text(encoding="utf-8"))


def start_full_run(manifest_sha: str, backup: dict[str, str]) -> tuple[str, bool]:
    existing = psql_rows(
        "SELECT run_id::text,status FROM dms_legacy_migration_runs "
        f"WHERE source_system={sql_literal(SOURCE_SYSTEM)} AND run_key={sql_literal(RUN_KEY)};"
    )
    if existing and existing[0][0] != RUN_ID:
        raise RuntimeError("Full migration run key exists with a non-deterministic run UUID")
    may_reconcile_active_metadata = not existing or existing[0][1] != "completed"
    if not existing:
        psql_execute(
            "INSERT INTO dms_legacy_migration_runs(run_id,source_system,run_key,status,source_manifest_sha256,details) VALUES "
            f"({sql_literal(RUN_ID)}::uuid,{sql_literal(SOURCE_SYSTEM)},{sql_literal(RUN_KEY)},'started',"
            f"{sql_literal(manifest_sha)},{sql_json({'backup': backup, 'mode': 'actual_full_migration'})});"
        )
    elif existing[0][1] != "completed":
        psql_execute(
            "UPDATE dms_legacy_migration_runs SET status='started',completed_at=NULL,"
            f"source_manifest_sha256={sql_literal(manifest_sha)},"
            f"details=details || {sql_json({'backup': backup, 'resumed': True})} "
            f"WHERE run_id={sql_literal(RUN_ID)}::uuid;"
        )
    return RUN_ID, may_reconcile_active_metadata


def existing_mappings() -> dict[str, tuple[str, str, str, str]]:
    return {
        row[0]: (row[1], row[2], row[3], row[4])
        for row in psql_rows(
            "SELECT legacy_document_id::text,new_document_id::text,"
            "active_legacy_content_version_id::text,active_new_version_id::text,"
            "migration_run_id::text "
            "FROM dms_legacy_document_mappings WHERE source_system='KnowledgeTree';"
        )
    }


def validate_existing_mapping(row: dict[str, object], mapping: tuple[str, str, str, str]) -> None:
    expected_document_id = stable_uuid("document", str(row["legacy_document_id"]))
    expected_version_id = stable_uuid("active-version", str(row["active_content_version_id"]))
    if mapping[:3] != (expected_document_id, str(row["active_content_version_id"]), expected_version_id):
        raise RuntimeError(
            f"Existing mapping for legacy document {row['legacy_document_id']} does not match deterministic source IDs"
        )


def full_run_active_metadata_sync_statement(
    row: dict[str, object],
    mapping: tuple[str, str, str, str],
    owner_ids: dict[str, str],
    folder_ids: dict[str, str],
    legacy: dict[str, object],
) -> str | None:
    """Reconcile only active metadata created by this full migration run.

    Pilot mappings have a different run ID and remain validation-only. Files,
    versions, archive evidence, workflows, and permissions are untouched.
    """
    if mapping[3] != RUN_ID:
        return None
    doc_id = str(row["legacy_document_id"])
    expected_document_id = stable_uuid("document", doc_id)
    source_document = legacy["document_by_id"][doc_id]
    folder_id = folder_ids[source_document["folder_id"]]
    owner_id = owner_ids[str(row["new_owner_name"])]
    return (
        "UPDATE dms_documents SET "
        f"folder_id={sql_literal(folder_id)}::uuid,title={sql_literal(row['title'])},"
        f"owner_id={sql_literal(owner_id)}::uuid,description={sql_literal(row['description'])},"
        f"category={sql_literal(row['new_category'])},department={sql_literal(row['new_department'])},"
        f"tags={sql_text_array(row['tags'])},"
        f"original_document_id={sql_literal(row['original_document_id'] or None)} "
        f"WHERE document_id={sql_literal(expected_document_id)}::uuid AND ("
        f"folder_id IS DISTINCT FROM {sql_literal(folder_id)}::uuid OR "
        f"title IS DISTINCT FROM {sql_literal(row['title'])} OR "
        f"owner_id IS DISTINCT FROM {sql_literal(owner_id)}::uuid OR "
        f"description IS DISTINCT FROM {sql_literal(row['description'])} OR "
        f"category IS DISTINCT FROM {sql_literal(row['new_category'])} OR "
        f"department IS DISTINCT FROM {sql_literal(row['new_department'])} OR "
        f"tags IS DISTINCT FROM {sql_text_array(row['tags'])} OR "
        f"original_document_id IS DISTINCT FROM {sql_literal(row['original_document_id'] or None)});"
    )


def prepare_document_objects(
    row: dict[str, object],
    legacy: dict[str, object],
    minio: DirectMinio,
    *,
    create_active_document: bool,
) -> tuple[StoredObject | None, dict[str, dict[str, object]]]:
    doc_id = str(row["legacy_document_id"])
    active_id = str(row["active_content_version_id"])
    active_object: StoredObject | None = None
    states: dict[str, dict[str, object]] = {}

    for version in legacy["versions_by_doc"][doc_id]:
        storage_path = (version.get("storage_path") or "").strip()
        source = BLOBS_DIR / Path(storage_path) if storage_path else None
        is_active = version["id"] == active_id
        archive_key: str | None = None
        archive_sha: str | None = None
        file_date: str | None = None
        if source is None or not source.is_file():
            status = "source_file_missing"
        elif source.stat().st_size == 0:
            status = "source_file_zero_byte"
            file_date = datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat()
        else:
            file_date = datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat()
            expected_md5 = (version.get("md5hash") or "").strip().casefold()
            actual_md5 = md5_file(source).casefold()
            if not expected_md5 or actual_md5 != expected_md5:
                status = "source_md5_mismatch"
            else:
                sha = sha256_file(source)
                if is_active and create_active_document:
                    key = (
                        f"documents/{stable_uuid('document', doc_id)}/"
                        f"{stable_uuid('active-version', active_id)}/"
                        f"{safe_object_filename(version['filename'])}"
                    )
                    active_object = minio.put_verified(source, key, sha)
                    status = "active_in_new_dms"
                else:
                    archive_key = (
                        f"legacy/archive/{SOURCE_SYSTEM}/documents/{doc_id}/content/"
                        f"{version['id']}/{safe_object_filename(version['filename'])}"
                    )
                    stored = minio.put_verified(source, archive_key, sha)
                    archive_sha = stored.sha256
                    status = "archived"
        states[version["id"]] = {
            "status": status,
            "archive_object_key": archive_key,
            "archive_sha256": archive_sha,
            "source_file_modified_at": file_date,
        }

    if create_active_document:
        active_state = states[active_id]["status"]
        if active_state != "active_in_new_dms" or active_object is None:
            raise RuntimeError(f"Active source failed MD5/physical validation: {active_state}")
    return active_object, states


def source_and_snapshot_statements(
    row: dict[str, object],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
    run_id: str,
) -> list[str]:
    doc_id = str(row["legacy_document_id"])
    document = legacy["document_by_id"][doc_id]
    statements = [
        "INSERT INTO dms_legacy_source_documents(source_system,legacy_document_id,first_migration_run_id) VALUES "
        f"({sql_literal(SOURCE_SYSTEM)},{int(doc_id)},{sql_literal(run_id)}::uuid) "
        "ON CONFLICT (source_system,legacy_document_id) DO NOTHING;"
    ]
    for metadata in legacy["metadata_by_doc"][doc_id]:
        fields = metadata_fields.get((doc_id, metadata["id"]), {})
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
    return statements


def content_statements(
    row: dict[str, object],
    legacy: dict[str, object],
    states: dict[str, dict[str, object]],
) -> list[str]:
    doc_id = str(row["legacy_document_id"])
    active_id = str(row["active_content_version_id"])
    statements: list[str] = []
    for version in legacy["versions_by_doc"][doc_id]:
        state = states[version["id"]]
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
        modified_at = state["source_file_modified_at"]
        statements.append(
            "INSERT INTO dms_legacy_content_file_details(source_system,legacy_content_version_id,source_file_modified_at) VALUES "
            f"({sql_literal(SOURCE_SYSTEM)},{int(version['id'])},"
            f"{sql_literal(modified_at)}::timestamptz) " if modified_at else
            "INSERT INTO dms_legacy_content_file_details(source_system,legacy_content_version_id,source_file_modified_at) VALUES "
            f"({sql_literal(SOURCE_SYSTEM)},{int(version['id'])},NULL) "
        )
        statements[-1] += "ON CONFLICT (source_system,legacy_content_version_id) DO NOTHING;"
    return statements


def exception_statement(
    row: dict[str, object], run_id: str, exception_type: str, reason_code: str, reason: str
) -> str:
    details = {
        "legacyAuthor": row["legacy_author_original"],
        "approvedOwner": row.get("new_owner_name") or None,
        "ownerCandidates": row.get("owner_candidates") or None,
        "activeContentVersionId": int(str(row["active_content_version_id"])),
        "activeFilename": row["active_filename"],
    }
    return (
        "INSERT INTO dms_legacy_migration_exceptions(source_system,legacy_document_id,exception_type,reason_code,reason,details,migration_run_id) VALUES "
        f"({sql_literal(SOURCE_SYSTEM)},{int(str(row['legacy_document_id']))},{sql_literal(exception_type)},"
        f"{sql_literal(reason_code)},{sql_literal(reason)},{sql_json(details)},{sql_literal(run_id)}::uuid) "
        "ON CONFLICT (source_system,legacy_document_id,exception_type) DO UPDATE SET "
        "reason_code=EXCLUDED.reason_code,reason=EXCLUDED.reason,details=EXCLUDED.details,"
        "migration_run_id=EXCLUDED.migration_run_id,recorded_at=now(),resolved_at=NULL;"
    )


def active_document_statements(
    row: dict[str, object],
    legacy: dict[str, object],
    owner_ids: dict[str, str],
    folder_ids: dict[str, str],
    active_object: StoredObject,
    run_id: str,
) -> list[str]:
    doc_id = str(row["legacy_document_id"])
    document = legacy["document_by_id"][doc_id]
    active_id = str(row["active_content_version_id"])
    active = legacy["version_by_id"][active_id]
    current_metadata = legacy["metadata_by_id"][document["metadata_version_id"]]
    new_doc_id = stable_uuid("document", doc_id)
    new_version_id = stable_uuid("active-version", active_id)
    new_metadata_id = stable_uuid("active-metadata", current_metadata["id"])
    owner_id = owner_ids[str(row["new_owner_name"])]
    created_at = document["created"] or current_metadata["version_created"]
    updated_at = document["modified"] or current_metadata["version_created"]
    original_document_id = row["original_document_id"] or None
    return [
        "INSERT INTO dms_documents(document_id,folder_id,title,current_version_id,tracking_code,status,owner_id,created_at,updated_at,description,category,department,tags,original_document_id) VALUES "
        f"({sql_literal(new_doc_id)}::uuid,{sql_literal(folder_ids[document['folder_id']])}::uuid,"
        f"{sql_literal(row['title'])},NULL,NULL,'draft',{sql_literal(owner_id)}::uuid,"
        f"{sql_literal(created_at)}::timestamptz,{sql_literal(updated_at)}::timestamptz,"
        f"{sql_literal(row['description'])},{sql_literal(row['new_category'])},"
        f"{sql_literal(row['new_department'])},{sql_text_array(row['tags'])},{sql_literal(original_document_id)}) "
        "ON CONFLICT (document_id) DO UPDATE SET folder_id=EXCLUDED.folder_id,title=EXCLUDED.title,"
        "owner_id=EXCLUDED.owner_id,description=EXCLUDED.description,category=EXCLUDED.category,"
        "department=EXCLUDED.department,tags=EXCLUDED.tags,original_document_id=EXCLUDED.original_document_id;",
        "INSERT INTO dms_document_versions(version_id,document_id,version_number,version_label,file_name,file_size_bytes,mime_type,s3_object_key,sha256_hash,status,is_checked_out,major_version,minor_version,created_at,updated_at) VALUES "
        f"({sql_literal(new_version_id)}::uuid,{sql_literal(new_doc_id)}::uuid,'1.0',NULL,"
        f"{sql_literal(active['filename'])},{int(active['size'])},{sql_literal(mime_type_for(active['filename']))},"
        f"{sql_literal(active_object.key)},{sql_literal(active_object.sha256)},'draft',FALSE,1,0,"
        f"{sql_literal(current_metadata['version_created'])}::timestamptz,now()) "
        "ON CONFLICT (version_id) DO UPDATE SET file_name=EXCLUDED.file_name,file_size_bytes=EXCLUDED.file_size_bytes,"
        "mime_type=EXCLUDED.mime_type,s3_object_key=EXCLUDED.s3_object_key,sha256_hash=EXCLUDED.sha256_hash;",
        "INSERT INTO dms_document_metadata(metadata_id,version_id,custom_data,created_at) VALUES "
        f"({sql_literal(new_metadata_id)}::uuid,{sql_literal(new_version_id)}::uuid,"
        f"{sql_json({'sourceSystem': SOURCE_SYSTEM, 'legacyDocumentId': int(doc_id), 'legacyContentVersionId': int(active_id)})},"
        f"{sql_literal(current_metadata['version_created'])}::timestamptz) "
        "ON CONFLICT (metadata_id) DO UPDATE SET custom_data=EXCLUDED.custom_data;",
        f"UPDATE dms_documents SET current_version_id={sql_literal(new_version_id)}::uuid "
        f"WHERE document_id={sql_literal(new_doc_id)}::uuid;",
        "INSERT INTO dms_legacy_document_mappings(source_system,legacy_document_id,new_document_id,active_legacy_content_version_id,active_new_version_id,migration_run_id) VALUES "
        f"({sql_literal(SOURCE_SYSTEM)},{int(doc_id)},{sql_literal(new_doc_id)}::uuid,{int(active_id)},"
        f"{sql_literal(new_version_id)}::uuid,{sql_literal(run_id)}::uuid) "
        "ON CONFLICT (source_system,legacy_document_id) DO NOTHING;",
        "UPDATE dms_legacy_migration_exceptions SET resolved_at=now() "
        f"WHERE source_system={sql_literal(SOURCE_SYSTEM)} AND legacy_document_id={int(doc_id)} "
        "AND exception_type='technical' AND resolved_at IS NULL;",
    ]


def persist_document(
    row: dict[str, object],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
    states: dict[str, dict[str, object]],
    run_id: str,
    *,
    active_object: StoredObject | None = None,
    owner_ids: dict[str, str] | None = None,
    folder_ids: dict[str, str] | None = None,
) -> None:
    statements = ["BEGIN;"]
    statements += source_and_snapshot_statements(row, legacy, metadata_fields, run_id)
    if active_object is not None:
        assert owner_ids is not None and folder_ids is not None
        statements += active_document_statements(row, legacy, owner_ids, folder_ids, active_object, run_id)
    statements += content_statements(row, legacy, states)
    if row["migration_status"] == "source_exception":
        statements.append(exception_statement(
            row, run_id, "source_file", str(row["active_source_status"]), str(row["exception_reason"])
        ))
    elif row["migration_status"] == "owner_business_input":
        code = "document_level_owner_split" if row["owner_resolution_status"] == "DOCUMENT_LEVEL_REVIEW_REQUIRED" else "owner_identity_missing_email"
        statements.append(exception_statement(
            row, run_id, "owner_business_input", code, str(row["exception_reason"])
        ))
    statements.append("COMMIT;")
    psql_execute("\n".join(statements))


def persist_technical_exception(
    row: dict[str, object],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
    run_id: str,
    reason: str,
) -> None:
    statements = ["BEGIN;"] + source_and_snapshot_statements(row, legacy, metadata_fields, run_id)
    statements.append(exception_statement(row, run_id, "technical", "migration_execution_failed", reason))
    statements.append("COMMIT;")
    psql_execute("\n".join(statements))


def decode_b64(value: str) -> str:
    return base64.b64decode(value).decode("utf-8") if value else ""


def load_active_target_rows() -> dict[str, dict[str, object]]:
    query = """
        SELECT m.legacy_document_id::text,
               m.new_document_id::text,
               m.active_legacy_content_version_id::text,
               m.active_new_version_id::text,
               d.current_version_id::text,
               replace(encode(convert_to(v.file_name,'UTF8'),'base64'), E'\\n',''),
               COALESCE(v.file_size_bytes::text,''),
               replace(encode(convert_to(v.s3_object_key,'UTF8'),'base64'), E'\\n',''),
               v.sha256_hash,
               replace(encode(convert_to(u.full_name,'UTF8'),'base64'), E'\\n',''),
               replace(encode(convert_to(u.email,'UTF8'),'base64'), E'\\n',''),
               replace(encode(convert_to(COALESCE(d.department,''),'UTF8'),'base64'), E'\\n',''),
               replace(encode(convert_to(COALESCE(d.category,''),'UTF8'),'base64'), E'\\n',''),
               replace(encode(convert_to(COALESCE(d.description,''),'UTF8'),'base64'), E'\\n',''),
               replace(encode(convert_to(array_to_json(COALESCE(d.tags,ARRAY[]::text[]))::text,'UTF8'),'base64'), E'\\n',''),
               replace(encode(convert_to(COALESCE(d.original_document_id,''),'UTF8'),'base64'), E'\\n',''),
               d.folder_id::text,d.status,v.status,v.version_number,v.is_checked_out::text,
               (SELECT count(*) FROM dms_document_versions vv WHERE vv.document_id=d.document_id)::text,
               (SELECT count(*) FROM dms_document_metadata md WHERE md.version_id=v.version_id)::text
        FROM dms_legacy_document_mappings m
        JOIN dms_documents d ON d.document_id=m.new_document_id
        JOIN dms_document_versions v ON v.version_id=m.active_new_version_id
        JOIN dms_users u ON u.user_id=d.owner_id
        WHERE m.source_system='KnowledgeTree'
        ORDER BY m.legacy_document_id;
    """
    result: dict[str, dict[str, object]] = {}
    for values in psql_rows(query):
        result[values[0]] = {
            "new_document_id": values[1],
            "active_legacy_content_version_id": values[2],
            "new_version_id": values[3],
            "current_version_id": values[4],
            "file_name": decode_b64(values[5]),
            "file_size": values[6],
            "object_key": decode_b64(values[7]),
            "sha256": values[8],
            "owner_name": decode_b64(values[9]),
            "owner_email": decode_b64(values[10]),
            "department": decode_b64(values[11]),
            "category": decode_b64(values[12]),
            "description": decode_b64(values[13]),
            "tags": json.loads(decode_b64(values[14]) or "[]"),
            "original_document_id": decode_b64(values[15]),
            "folder_id": values[16],
            "document_status": values[17],
            "version_status": values[18],
            "version_number": values[19],
            "is_checked_out": values[20],
            "version_count": int(values[21]),
            "metadata_count": int(values[22]),
        }
    return result


def load_archive_counts() -> tuple[dict[str, tuple[int, int]], dict[str, int]]:
    metadata = {
        row[0]: (int(row[1]), int(row[2]))
        for row in psql_rows(
            "SELECT legacy_document_id::text,count(*)::text,"
            "count(*) FILTER (WHERE is_current_snapshot)::text "
            "FROM dms_legacy_metadata_snapshots WHERE source_system='KnowledgeTree' "
            "GROUP BY legacy_document_id;"
        )
    }
    content = {
        row[0]: int(row[1])
        for row in psql_rows(
            "SELECT legacy_document_id::text,count(*)::text FROM dms_legacy_content_versions "
            "WHERE source_system='KnowledgeTree' GROUP BY legacy_document_id;"
        )
    }
    return metadata, content


def load_content_archive_rows() -> dict[tuple[str, str], dict[str, object]]:
    query = """
        SELECT cv.legacy_document_id::text,cv.legacy_content_version_id::text,
               cv.major_version::text,cv.minor_version::text,
               replace(encode(convert_to(cv.original_filename,'UTF8'),'base64'), E'\\n',''),
               replace(encode(convert_to(COALESCE(cv.source_storage_path,''),'UTF8'),'base64'), E'\\n',''),
               COALESCE(cv.source_size_bytes::text,''),COALESCE(cv.source_md5,''),
               cv.is_active_source::text,cv.physical_file_status,
               replace(encode(convert_to(COALESCE(cv.archive_object_key,''),'UTF8'),'base64'), E'\\n',''),
               COALESCE(cv.archive_sha256,''),
               COALESCE(fd.source_file_modified_at::text,'')
        FROM dms_legacy_content_versions cv
        LEFT JOIN dms_legacy_content_file_details fd
          ON fd.source_system=cv.source_system
         AND fd.legacy_content_version_id=cv.legacy_content_version_id
        WHERE cv.source_system='KnowledgeTree'
        ORDER BY cv.legacy_document_id,cv.legacy_content_version_id;
    """
    return {
        (row[0], row[1]): {
            "major": row[2], "minor": row[3], "filename": decode_b64(row[4]),
            "storage_path": decode_b64(row[5]), "size": row[6], "md5": row[7],
            "is_active": row[8], "status": row[9], "archive_key": decode_b64(row[10]),
            "archive_sha": row[11], "file_date": row[12],
        }
        for row in psql_rows(query)
    }


def select_api_samples(plan: list[dict[str, object]]) -> set[str]:
    samples = set(PILOT_IDS)
    seen: set[tuple[str, str]] = set()
    for row in plan:
        if row["migration_status"] not in {"ready", "pilot_already_migrated"}:
            continue
        key = (str(row["new_department"]), str(row["new_category"]))
        if key not in seen:
            seen.add(key)
            samples.add(str(row["legacy_document_id"]))
    return samples


def reconcile_full_migration(
    plan: list[dict[str, object]],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
    minio: DirectMinio,
    execution_status: dict[str, str],
) -> tuple[list[dict[str, object]], dict[str, object]]:
    targets = load_active_target_rows()
    metadata_counts, content_counts = load_archive_counts()
    content_rows = load_content_archive_rows()
    folder_paths = full_folder_paths()
    folders_by_id, _ = load_legacy_folders()
    samples = select_api_samples(plan)
    token = create_validation_token()
    expected_success_ids = {
        str(row["legacy_document_id"])
        for row in plan
        if execution_status.get(str(row["legacy_document_id"])) in {
            "pilot_already_migrated", "newly_migrated", "previously_migrated"
        }
    }

    active_object_hashes: dict[str, str | None] = {}
    validation: list[dict[str, object]] = []
    expected_archive_keys: set[str] = set()
    expected_active_keys: set[str] = set()

    for index, row in enumerate(plan, 1):
        doc_id = str(row["legacy_document_id"])
        target = targets.get(doc_id)
        success_expected = doc_id in expected_success_ids
        checks: dict[str, bool] = {}
        reason = str(row.get("exception_reason") or "")

        if success_expected and target:
            expected_doc_id = stable_uuid("document", doc_id)
            expected_version_id = stable_uuid("active-version", str(row["active_content_version_id"]))
            checks["postgresql"] = (
                target["new_document_id"] == expected_doc_id
                and target["active_legacy_content_version_id"] == str(row["active_content_version_id"])
                and target["new_version_id"] == expected_version_id
                and target["current_version_id"] == expected_version_id
                and target["file_name"] == row["active_filename"]
                and target["owner_name"] == row["new_owner_name"]
                and target["owner_email"].casefold() == str(row["owner_email"]).casefold()
                and target["department"] == row["new_department"]
                and target["category"] == row["new_category"]
                and target["description"] == row["description"]
                and target["tags"] == row["tags"]
                and target["original_document_id"] == row["original_document_id"]
                and folder_paths.get(str(target["folder_id"])) == folder_chain(
                    str(row["legacy_folder_id"]), folders_by_id
                )[-1]["full_path"]
                and target["document_status"] == "draft"
                and target["version_status"] == "draft"
                and target["version_number"] == "1.0"
                and target["is_checked_out"] == "false"
                and target["version_count"] == 1
                and target["metadata_count"] == 1
            )
            expected_sha = sha256_file(BLOBS_DIR / Path(str(row["active_storage_path"])))
            expected_active_keys.add(str(target["object_key"]))
            if str(target["object_key"]) not in active_object_hashes:
                active_object_hashes[str(target["object_key"])] = minio.object_sha256(str(target["object_key"]))
            checks["minio"] = (
                target["sha256"] == expected_sha
                and active_object_hashes[str(target["object_key"])] == expected_sha
            )
        else:
            checks["postgresql"] = target is None
            checks["minio"] = True

        checks["metadata_archive"] = (
            metadata_counts.get(doc_id) == (int(row["metadata_snapshot_count"]), 1)
        )
        checks["content_archive"] = content_counts.get(doc_id) == int(row["content_version_count"])

        content_matches = True
        for version in legacy["versions_by_doc"][doc_id]:
            actual = content_rows.get((doc_id, version["id"]))
            if actual is None:
                content_matches = False
                continue
            source = BLOBS_DIR / Path(version["storage_path"]) if version["storage_path"] else None
            physical_ready = False
            if source and source.is_file() and source.stat().st_size > 0:
                physical_ready = md5_file(source).casefold() == (version["md5hash"] or "").casefold()
            if not source or not source.is_file():
                expected_status = "source_file_missing"
            elif source.stat().st_size == 0:
                expected_status = "source_file_zero_byte"
            elif not physical_ready:
                expected_status = "source_md5_mismatch"
            elif success_expected and version["id"] == str(row["active_content_version_id"]):
                expected_status = "active_in_new_dms"
            else:
                expected_status = "archived"
            if expected_status == "archived":
                expected_archive_keys.add(str(actual["archive_key"]))
            content_matches = content_matches and (
                actual["major"] == version["major_version"]
                and actual["minor"] == version["minor_version"]
                and actual["filename"] == version["filename"]
                and actual["storage_path"] == (version["storage_path"] or "")
                and actual["size"] == (version["size"] or "")
                and actual["md5"].casefold() == (version["md5hash"] or "").casefold()
                and actual["is_active"] == str(version["id"] == str(row["active_content_version_id"])).lower()
                and actual["status"] == expected_status
                and bool(actual["file_date"]) == bool(source and source.is_file())
            )
        checks["content_archive"] = checks["content_archive"] and content_matches

        api_result = "NOT_SAMPLED"
        if success_expected and doc_id in samples and target:
            status, body, _ = api_get(f"/api/documents/{target['new_document_id']}", token)
            history_status, history_body, _ = api_get(
                f"/api/documents/{target['new_document_id']}/legacy-metadata-history", token
            )
            try:
                api_json = json.loads(body.decode("utf-8"))
                history_json = json.loads(history_body.decode("utf-8"))
            except Exception:
                api_json = history_json = {}
            api_ok = (
                status == 200
                and api_json.get("data", {}).get("category") == row["new_category"]
                and api_json.get("data", {}).get("department") == row["new_department"]
                and api_json.get("data", {}).get("fileName") == row["active_filename"]
                and history_status == 200
                and history_json.get("data", {}).get("legacyDocumentId") == int(doc_id)
                and len(history_json.get("data", {}).get("snapshots", [])) == int(row["metadata_snapshot_count"])
                and all("associatedFile" in snapshot for snapshot in history_json.get("data", {}).get("snapshots", []))
            )
            api_result = "PASS" if api_ok else "FAIL"
            checks["application_api"] = api_ok
        else:
            checks["application_api"] = True

        overall = all(checks.values())
        if not overall and not reason:
            reason = "; ".join(name for name, passed in checks.items() if not passed)
        validation.append({
            "legacy_document_id": doc_id,
            "migration_result": execution_status.get(doc_id, "not_processed"),
            "new_document_id": target["new_document_id"] if target else "",
            "new_version_id": target["new_version_id"] if target else "",
            "owner": row.get("new_owner_name") or "",
            "department": row["new_department"],
            "category": row["new_category"],
            "active_filename": row["active_filename"],
            "postgresql_validation": "PASS" if checks["postgresql"] else "FAIL",
            "minio_validation": "PASS" if checks["minio"] else "FAIL",
            "metadata_archive_validation": "PASS" if checks["metadata_archive"] else "FAIL",
            "content_archive_validation": "PASS" if checks["content_archive"] else "FAIL",
            "application_api_validation": api_result,
            "overall": "PASS" if overall else "FAIL",
            "reason": reason,
        })
        if index % 100 == 0:
            print(f"Validated {index}/1008 source documents", flush=True)

    archive_actual = set(minio.list_keys(f"legacy/archive/{SOURCE_SYSTEM}/"))
    active_actual_all = set(minio.list_keys("documents/"))
    mapped_new_ids = {str(target["new_document_id"]) for target in targets.values()}
    migration_active_actual = {
        key for key in active_actual_all
        if len(key.split("/")) > 1 and key.split("/")[1] in mapped_new_ids
    }
    orphan_archive = sorted(archive_actual.symmetric_difference(expected_archive_keys))
    orphan_active = sorted(migration_active_actual.symmetric_difference(expected_active_keys))
    orphan_free = not orphan_archive and not orphan_active

    if not orphan_free:
        for item in validation:
            if item["migration_result"] in {"newly_migrated", "previously_migrated", "pilot_already_migrated"}:
                item["overall"] = "FAIL"
                item["reason"] = (str(item["reason"]) + "; " if item["reason"] else "") + "migration MinIO orphan/object-set mismatch"

    summary = {
        "total_source": len(plan),
        "pilot": sum(status == "pilot_already_migrated" for status in execution_status.values()),
        "newly_migrated": sum(status == "newly_migrated" for status in execution_status.values()),
        "previously_migrated": sum(status == "previously_migrated" for status in execution_status.values()),
        "source_exceptions": sum(status == "source_exception" for status in execution_status.values()),
        "owner_exceptions": sum(status == "owner_business_input" for status in execution_status.values()),
        "technical_failures": sum(status == "technical_failure" for status in execution_status.values()),
        "active_success": len(expected_success_ids),
        "metadata_snapshots": sum(count[0] for count in metadata_counts.values()),
        "content_versions": sum(content_counts.values()),
        "archive_objects": len(archive_actual),
        "active_objects": len(migration_active_actual),
        "orphan_free": orphan_free,
        "orphan_archive": orphan_archive,
        "orphan_active": orphan_active,
        "api_samples": len(samples & expected_success_ids),
        "api_pass": all(
            item["application_api_validation"] != "FAIL" for item in validation
        ),
        "validation_pass": all(
            item["overall"] == "PASS"
            for item in validation
            if item["migration_result"] in {"newly_migrated", "previously_migrated", "pilot_already_migrated"}
        ),
    }
    return validation, summary


def write_csv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_full_outputs(
    plan: list[dict[str, object]],
    validation: list[dict[str, object]],
    summary: dict[str, object],
    execution_status: dict[str, str],
    backup: dict[str, str],
    unresolved_identities: dict[str, str],
) -> None:
    validation_fields = [
        "legacy_document_id", "migration_result", "new_document_id", "new_version_id",
        "owner", "department", "category", "active_filename", "postgresql_validation",
        "minio_validation", "metadata_archive_validation", "content_archive_validation",
        "application_api_validation", "overall", "reason",
    ]
    write_csv(VALIDATION_CSV, validation, validation_fields)

    validation_by_id = {str(row["legacy_document_id"]): row for row in validation}
    exceptions: list[dict[str, object]] = []
    mappings: list[dict[str, object]] = []
    for row in plan:
        doc_id = str(row["legacy_document_id"])
        status = execution_status[doc_id]
        result = validation_by_id[doc_id]
        if status in {"source_exception", "owner_business_input", "technical_failure"}:
            exception_type = {
                "source_exception": "SOURCE_FILE",
                "owner_business_input": "OWNER_BUSINESS_INPUT",
                "technical_failure": "TECHNICAL",
            }[status]
            exceptions.append({
                "legacy_document_id": doc_id,
                "exception_type": exception_type,
                "active_content_version_id": row["active_content_version_id"],
                "active_filename": row["active_filename"],
                "legacy_author_original": row["legacy_author_original"],
                "approved_owner": row.get("new_owner_name") or "",
                "owner_candidates": row.get("owner_candidates") or "",
                "exact_reason": result["reason"] or row["exception_reason"],
                "metadata_archived": result["metadata_archive_validation"],
                "content_archive_status": result["content_archive_validation"],
            })
        elif result["new_document_id"]:
            mappings.append({
                "legacy_document_id": doc_id,
                "new_document_id": result["new_document_id"],
                "active_legacy_content_version_id": row["active_content_version_id"],
                "new_active_version_id": result["new_version_id"],
                "migration_result": status,
                "owner": row["new_owner_name"],
                "active_filename": row["active_filename"],
            })
    write_csv(EXCEPTIONS_CSV, exceptions, [
        "legacy_document_id", "exception_type", "active_content_version_id", "active_filename",
        "legacy_author_original", "approved_owner", "owner_candidates", "exact_reason",
        "metadata_archived", "content_archive_status",
    ])
    write_csv(ID_MAPPING_CSV, mappings, [
        "legacy_document_id", "new_document_id", "active_legacy_content_version_id",
        "new_active_version_id", "migration_result", "owner", "active_filename",
    ])

    report_status = "SUCCESS" if not exceptions and summary["validation_pass"] else (
        "PARTIAL SUCCESS" if summary["active_success"] else "FAILED"
    )
    REPORT_MD.write_text(
        "# Full KnowledgeTree Migration Report\n\n"
        f"**Result:** {report_status}\n\n"
        "This is the actual execution result, not a plan or dry run. The current KnowledgeTree "
        "metadata pointer selected every active file; no numerically-highest substitute was used.\n\n"
        "## Reconciliation\n\n"
        f"- Legacy documents: {summary['total_source']}\n"
        f"- Pilot documents validated/skipped: {summary['pilot']}\n"
        f"- Newly migrated: {summary['newly_migrated']}\n"
        f"- Previously migrated full-run rows: {summary['previously_migrated']}\n"
        f"- Total active New-DMS documents: {summary['active_success']}\n"
        f"- Source-file exceptions: {summary['source_exceptions']}\n"
        f"- Owner/business-input exceptions: {summary['owner_exceptions']}\n"
        f"- Technical failures: {summary['technical_failures']}\n"
        f"- Legacy metadata snapshots archived: {summary['metadata_snapshots']}\n"
        f"- Legacy content-version rows archived: {summary['content_versions']}\n"
        f"- Migration active MinIO objects: {summary['active_objects']}\n"
        f"- Legacy Archive MinIO objects: {summary['archive_objects']}\n"
        f"- API sample documents: {summary['api_samples']}\n"
        f"- PostgreSQL relationship/metadata reconciliation: {'PASS' if summary['validation_pass'] else 'FAIL'}\n"
        f"- MinIO hash/object-set reconciliation: {'PASS' if summary['orphan_free'] and summary['validation_pass'] else 'FAIL'}\n"
        f"- Application/API samples: {'PASS' if summary['api_pass'] else 'FAIL'}\n"
        f"- Orphan/object-set reconciliation: {'PASS' if summary['orphan_free'] else 'FAIL'}\n\n"
        "## Owner identity boundary\n\n"
        + ("\n".join(f"- {name}: {reason}" for name, reason in sorted(unresolved_identities.items())) or "- None")
        + "\n\nEvery exception is enumerated with its exact legacy document ID in "
        "`16_full_migration_exceptions.csv`.\n",
        encoding="utf-8",
    )

    backup_dir = Path(backup["directory"])
    ROLLBACK_MD.write_text(
        "# Full Migration Rollback\n\n"
        f"Backup directory: `{backup_dir}`\n\n"
        f"- PostgreSQL SHA-256: `{backup['postgres_sha256']}`\n"
        f"- MinIO SHA-256: `{backup['minio_sha256']}`\n\n"
        "Rollback is destructive to all local changes made after the snapshot. Verify both hashes, "
        "stop `api`, `web`, and `minio`, and copy `postgres_pre_migration.dump` into the PostgreSQL "
        "container. Terminate connections to the configured local `dms` database, recreate it, then "
        "restore with `pg_restore --exit-on-error --no-owner --no-privileges -U dms_app -d dms`. "
        "Resolve the exact MinIO `/data` volume with `docker inspect`; mount only that volume and the "
        "backup directory in a temporary container, clear `/data`, and extract "
        "`minio_pre_migration.tar.gz`. Restart the services, wait for health checks, and rerun the "
        "five-pilot API/hash validation. Both backup artifacts were read completely and accepted by "
        "`verify_backup` before execution. Rollback has not been run.\n",
        encoding="utf-8",
    )


def execute_full_migration(
    plan: list[dict[str, object]],
    legacy: dict[str, object],
    metadata_fields: dict[tuple[str, str], dict[str, str]],
    identities: dict[str, OwnerIdentity],
    unresolved_identities: dict[str, str],
    backup: dict[str, str],
) -> tuple[list[dict[str, object]], dict[str, object], dict[str, str]]:
    ensure_full_schema()
    run_id, may_reconcile_active_metadata = start_full_run(
        migration_manifest_hash(), backup
    )
    owner_ids = prepare_master_data_and_users(identities)
    folders_by_id, _ = load_legacy_folders()
    folder_plan = [{"legacy_document_id": str(row["legacy_document_id"])} for row in plan]
    folder_ids, _ = ensure_folders(folder_plan, legacy, folders_by_id, run_id)
    minio = DirectMinio()
    mappings = existing_mappings()
    execution_status: dict[str, str] = {}

    sync_statements = [
        statement
        for row in plan
        if (mapping := mappings.get(str(row["legacy_document_id"]))) is not None
        if (statement := full_run_active_metadata_sync_statement(
            row, mapping, owner_ids, folder_ids, legacy
        )) is not None
    ] if may_reconcile_active_metadata else []
    if sync_statements:
        psql_execute("BEGIN;\n" + "\n".join(sync_statements) + "\nCOMMIT;")

    for index, row in enumerate(plan, 1):
        doc_id = str(row["legacy_document_id"])
        try:
            if doc_id in mappings:
                validate_existing_mapping(row, mappings[doc_id])
                execution_status[doc_id] = (
                    "pilot_already_migrated" if doc_id in PILOT_IDS else (
                        "newly_migrated" if mappings[doc_id][3] == RUN_ID else "previously_migrated"
                    )
                )
                continue

            create_active = row["migration_status"] == "ready"
            active_object, states = prepare_document_objects(
                row, legacy, minio, create_active_document=create_active
            )
            persist_document(
                row, legacy, metadata_fields, states, run_id,
                active_object=active_object,
                owner_ids=owner_ids,
                folder_ids=folder_ids,
            )
            execution_status[doc_id] = (
                "newly_migrated" if create_active else str(row["migration_status"])
            )
        except Exception as exc:
            # Remove only deterministic objects for this unmapped document. The
            # source export remains untouched; metadata evidence and the exact
            # technical reason are then committed independently.
            minio.remove_prefix(f"documents/{stable_uuid('document', doc_id)}/")
            minio.remove_prefix(f"legacy/archive/{SOURCE_SYSTEM}/documents/{doc_id}/")
            row["exception_reason"] = str(exc)
            persist_technical_exception(row, legacy, metadata_fields, run_id, str(exc))
            execution_status[doc_id] = "technical_failure"
        if index % 25 == 0 or index == len(plan):
            counts = Counter(execution_status.values())
            print(
                f"Processed {index}/1008 | new={counts['newly_migrated']} "
                f"source={counts['source_exception']} owner={counts['owner_business_input']} "
                f"technical={counts['technical_failure']}",
                flush=True,
            )

    validation, summary = reconcile_full_migration(
        plan, legacy, metadata_fields, minio, execution_status
    )
    write_full_outputs(
        plan, validation, summary, execution_status, backup, unresolved_identities
    )
    psql_execute(
        "UPDATE dms_legacy_migration_runs SET status='completed',completed_at=now(),"
        f"details=details || {sql_json({'reconciliation': summary})} "
        f"WHERE run_id={sql_literal(run_id)}::uuid;"
    )
    return validation, summary, execution_status


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Perform the actual full migration")
    parser.add_argument("--backup-dir", type=Path, help="Verified pre-full-migration backup directory")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.execute:
        raise SystemExit("This runner is execution-only. Use --execute --backup-dir <verified backup>.")
    if args.backup_dir is None:
        raise SystemExit("--backup-dir is required")
    backup = verify_backup(args.backup_dir)
    plan, legacy, metadata_fields = build_full_plan()
    identities, unresolved_identities = resolve_available_owner_identities(plan)
    apply_owner_identity_classification(plan, identities, unresolved_identities)
    validation, summary, _ = execute_full_migration(
        plan,
        legacy,
        metadata_fields,
        identities,
        unresolved_identities,
        backup,
    )
    print(
        "Full migration execution complete: "
        f"active={summary['active_success']}/1008, "
        f"source_exceptions={summary['source_exceptions']}, "
        f"owner_exceptions={summary['owner_exceptions']}, "
        f"technical_failures={summary['technical_failures']}",
        flush=True,
    )
    return 0 if (
        bool(summary["validation_pass"])
        and bool(summary["orphan_free"])
        and bool(summary["api_pass"])
        and int(summary["technical_failures"]) == 0
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
