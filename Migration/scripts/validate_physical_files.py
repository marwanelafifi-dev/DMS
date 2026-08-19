#!/usr/bin/env python3
"""Read-only physical-file validation for the KnowledgeTree -> new DMS migration.

Per migration/MIGRATION_SPEC.md, the new DMS will receive each legacy
document's LATEST file as its active record, with prior file versions
preserved separately as an archive. This script checks whether the actual
bytes needed for both of those are really present and intact under
migration/source/blobs/ — it does not migrate, write, or infer anything.

SAFETY
- Reads only from migration/source/ (never modified — every open() here uses
  a read-only mode, and nothing under migration/source/ is written to,
  renamed, or deleted).
- Writes only into migration/output/.
- Never connects to PostgreSQL, MinIO, or any live service.
- Does not touch the new DMS application in any way.
- Safe to re-run any number of times.

Authoritative source: the SQL dump (dms_full_2026-07-30.sql.gz) is parsed
directly for document/version records — 02_documents.tsv and
03_versions_filemap.tsv are deliberately NOT read for this, since the prior
preflight step (07_preflight_report.md, section 13) found real encoding
corruption in both. blobs/ is the authoritative byte source; reconstructed/
is used only as a secondary, non-authoritative consistency cross-check, per
instructions.
"""

import csv
import gzip
import hashlib
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MIGRATION_DIR = SCRIPT_DIR.parent
SOURCE_DIR = MIGRATION_DIR / "source"
OUTPUT_DIR = MIGRATION_DIR / "output"
SOURCE_DUMP = SOURCE_DIR / "dms_full_2026-07-30.sql.gz"
BLOBS_DIR = SOURCE_DIR / "blobs"
RECONSTRUCTED_DIR = SOURCE_DIR / "reconstructed"

REPORT_MD = OUTPUT_DIR / "09_physical_file_validation_report.md"
ISSUES_CSV = OUTPUT_DIR / "09_physical_file_issues.csv"

READ_CHUNK = 1024 * 1024  # 1 MiB, for streaming md5 without loading whole files into memory


# ---------------------------------------------------------------------------
# Same hand-written, quote/escape-aware mysqldump VALUES parser used by the
# earlier extraction/preflight scripts — duplicated here so this script stays
# independently runnable and auditable on its own.
# ---------------------------------------------------------------------------

def split_tuples(values_str):
    tuples, cur, in_str, esc, depth = [], [], False, False, 0
    for ch in values_str:
        if in_str:
            cur.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == "'":
                in_str = False
            continue
        if ch == "'":
            in_str = True
            cur.append(ch)
        elif ch == "(":
            depth += 1
            if depth == 1:
                cur = []
                continue
            cur.append(ch)
        elif ch == ")":
            depth -= 1
            if depth == 0:
                tuples.append("".join(cur))
                continue
            cur.append(ch)
        else:
            if depth >= 1:
                cur.append(ch)
    return tuples


def split_fields(tup):
    parts, cur, in_str, esc, depth = [], [], False, False, 0
    for ch in tup:
        if in_str:
            cur.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == "'":
                in_str = False
            continue
        if ch == "'":
            in_str = True
            cur.append(ch)
        elif ch == "(":
            depth += 1
            cur.append(ch)
        elif ch == ")":
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


_ESCAPE_MAP = {"n": "\n", "r": "\r", "t": "\t", "0": "\0", "Z": "\x1a",
               "\\": "\\", "'": "'", '"': '"'}


def unescape_value(raw):
    if raw == "NULL":
        return None
    if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
        inner = raw[1:-1]
        out, i = [], 0
        while i < len(inner):
            c = inner[i]
            if c == "\\" and i + 1 < len(inner):
                out.append(_ESCAPE_MAP.get(inner[i + 1], inner[i + 1]))
                i += 2
            else:
                out.append(c)
                i += 1
        return "".join(out)
    return raw


def load_dump_text(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return fh.read()


def extract_table_rows(dump_text, table_name):
    rows = []
    pattern = re.compile(r"INSERT INTO `" + re.escape(table_name) + r"` VALUES (.*?);\n", re.S)
    for match in pattern.finditer(dump_text):
        for tup in split_tuples(match.group(1)):
            rows.append([unescape_value(f) for f in split_fields(tup)])
    return rows


def rows_to_dicts(rows, columns):
    return [dict(zip(columns, row)) for row in rows]


DOCUMENTS_COLS = [
    "id", "creator_id", "modified", "folder_id", "is_checked_out",
    "parent_folder_ids", "full_path", "checked_out_user_id", "status_id",
    "created", "permission_object_id", "permission_lookup_id",
    "metadata_version", "modified_user_id", "metadata_version_id",
    "owner_id", "immutable", "restore_folder_id", "restore_folder_path",
    "checkedout", "oem_no", "linked_document_id",
]
DOCUMENT_CONTENT_VERSION_COLS = [
    "id", "document_id", "filename", "size", "mime_id", "major_version",
    "minor_version", "storage_path", "md5hash",
]
DOCUMENT_METADATA_VERSION_COLS = [
    "id", "document_id", "content_version_id", "document_type_id", "name",
    "description", "status_id", "metadata_version", "version_created",
    "version_creator_id", "workflow_id", "workflow_state_id",
]


def version_sort_key(v):
    return (int(v["major_version"] or 0), int(v["minor_version"] or 0), int(v["id"]))


def md5_of_file(path):
    h = hashlib.md5()
    with open(path, "rb") as fh:  # read-only open, never write
        while True:
            chunk = fh.read(READ_CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def main():
    if not SOURCE_DUMP.exists():
        print(f"FATAL: source dump not found at {SOURCE_DUMP}", file=sys.stderr)
        sys.exit(1)
    if not BLOBS_DIR.exists():
        print(f"FATAL: {BLOBS_DIR} not found", file=sys.stderr)
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Reading {SOURCE_DUMP.name} (read-only) ...")
    dump_text = load_dump_text(SOURCE_DUMP)

    documents = rows_to_dicts(extract_table_rows(dump_text, "documents"), DOCUMENTS_COLS)
    content_versions = rows_to_dicts(
        extract_table_rows(dump_text, "document_content_version"), DOCUMENT_CONTENT_VERSION_COLS
    )
    metadata_versions = rows_to_dicts(
        extract_table_rows(dump_text, "document_metadata_version"), DOCUMENT_METADATA_VERSION_COLS
    )
    print(f"Parsed: {len(documents)} documents, {len(content_versions)} content versions, "
          f"{len(metadata_versions)} metadata versions.")

    doc_by_id = {d["id"]: d for d in documents}
    mv_by_id = {m["id"]: m for m in metadata_versions}
    versions_by_doc = defaultdict(list)
    for v in content_versions:
        versions_by_doc[v["document_id"]].append(v)
    version_by_id = {v["id"]: v for v in content_versions}

    # ---- classify ACTIVE vs ARCHIVE per document ---------------------------
    # ACTIVE = highest (major, minor, id) — the same rule MIGRATION_RUNBOOK.md
    # §4.2 used to build 02_documents.tsv's "latest" column, applied fresh
    # against the SQL dump. Where this disagrees with the file the document's
    # current metadata snapshot points at (already flagged as an ambiguity in
    # 07_preflight_report.md), BOTH candidates are validated here and the
    # disagreement is reported again — not silently resolved.
    active_version_by_doc = {}
    for did, vlist in versions_by_doc.items():
        active_version_by_doc[did] = max(vlist, key=version_sort_key)

    ambiguous_docs = {}
    for d in documents:
        did = d["id"]
        mv = mv_by_id.get(d["metadata_version_id"])
        if mv is None:
            continue
        pointed = version_by_id.get(mv["content_version_id"])
        active = active_version_by_doc.get(did)
        if pointed is not None and active is not None and pointed["id"] != active["id"]:
            ambiguous_docs[did] = pointed

    active_version_ids = {v["id"] for v in active_version_by_doc.values()}
    # extra candidate versions for ambiguous docs, validated too, kept in a
    # separate bucket so they don't inflate/deflate the plain active/archive counts
    ambiguous_alt_ids = {v["id"] for v in ambiguous_docs.values()}

    # ---- scan blobs/ once for existence/size, then targeted md5 -----------
    print(f"Scanning {BLOBS_DIR} ...")
    blob_files_on_disk = {}
    for p in BLOBS_DIR.rglob("*"):
        if p.is_file():
            rel = p.relative_to(BLOBS_DIR).as_posix()
            blob_files_on_disk[rel] = p
    print(f"Found {len(blob_files_on_disk)} physical files under blobs/.")

    issues = []

    def add_issue(severity, category, doc_id, version_id, detail):
        issues.append({
            "severity": severity, "category": category, "doc_id": doc_id,
            "version_id": version_id, "detail": detail,
        })

    # duplicate blob references: multiple content_version rows sharing one storage_path
    storage_path_owners = defaultdict(list)
    for v in content_versions:
        if v["storage_path"]:
            storage_path_owners[v["storage_path"]].append(v["id"])
    duplicate_storage_paths = {k: v for k, v in storage_path_owners.items() if len(v) > 1}
    for sp, vids in duplicate_storage_paths.items():
        add_issue("INFO", "duplicate_blob_reference", "-", ",".join(vids),
                  f"storage_path '{sp}' is referenced by {len(vids)} content_version rows: {vids}")

    def validate_version(v, bucket):
        """bucket: 'active', 'archive', or 'ambiguous_alt'. Returns a result dict."""
        did = v["document_id"]
        vid = v["id"]
        sp = v["storage_path"]
        expected_md5 = v["md5hash"]
        result = {
            "doc_id": did, "version_id": vid, "bucket": bucket, "storage_path": sp or "",
            "expected_md5": expected_md5 or "", "found": False, "zero_byte": False,
            "actual_md5": "", "md5_match": "",
        }
        if not sp:
            add_issue("BLOCKING" if bucket == "active" else "WARNING", "no_storage_path_recorded",
                      did, vid, f"{bucket}: document_content_version.storage_path is NULL — "
                      "cannot even attempt to locate a physical blob (same class of loss as the "
                      "one pre-existing case MIGRATION_RUNBOOK.md already documented)")
            return result
        path = blob_files_on_disk.get(sp)
        if path is None:
            add_issue("BLOCKING" if bucket == "active" else "WARNING", "missing_blob",
                      did, vid, f"{bucket}: expected blob 'blobs/{sp}' not found on disk")
            return result
        result["found"] = True
        size = path.stat().st_size
        if size == 0:
            result["zero_byte"] = True
            add_issue("BLOCKING" if bucket == "active" else "WARNING", "zero_byte_file",
                      did, vid, f"{bucket}: blobs/{sp} exists but is 0 bytes")
        actual_md5 = md5_of_file(path)
        result["actual_md5"] = actual_md5
        if expected_md5:
            result["md5_match"] = "MATCH" if actual_md5 == expected_md5 else "MISMATCH"
            if result["md5_match"] == "MISMATCH":
                add_issue("BLOCKING" if bucket == "active" else "WARNING", "md5_mismatch",
                          did, vid, f"{bucket}: blobs/{sp} md5={actual_md5} but DB expects {expected_md5}")
        else:
            result["md5_match"] = "NO_EXPECTED_HASH"
            add_issue("INFO", "no_expected_md5_recorded", did, vid,
                      f"{bucket}: blobs/{sp} exists (md5={actual_md5}) but document_content_version.md5hash is NULL")
        return result

    print("Validating ACTIVE files ...")
    active_results = [validate_version(v, "active") for v in active_version_by_doc.values()]

    print("Validating ARCHIVE files ...")
    archive_results = []
    for did, vlist in versions_by_doc.items():
        active_id = active_version_by_doc[did]["id"]
        for v in vlist:
            if v["id"] != active_id:
                archive_results.append(validate_version(v, "archive"))

    print("Validating ambiguous-active alternate candidates ...")
    ambiguous_results = [validate_version(v, "ambiguous_alt") for v in ambiguous_docs.values()]

    # ---- secondary, non-authoritative reconstructed/ consistency check ----
    recon_summary = {"present": False, "file_count": 0, "note": ""}
    if RECONSTRUCTED_DIR.exists():
        recon_files = [p for p in RECONSTRUCTED_DIR.rglob("*") if p.is_file()]
        recon_summary["present"] = True
        recon_summary["file_count"] = len(recon_files)
        recon_summary["note"] = (
            f"{len(recon_files)} files present under reconstructed/ (vs. MIGRATION_RUNBOOK.md's own "
            "recorded copied=1801). This is presence-count only, deliberately not byte-for-byte "
            "re-hashed here — reconstructed/ is a human-readable secondary copy, not the byte source "
            "of truth (blobs/ is), per instructions. A count in the same ballpark as the runbook's own "
            "figure is a sanity signal, not a validation of individual files."
        )
    else:
        recon_summary["note"] = "reconstructed/ not found — secondary check skipped."

    # ------------------------------------------------------------------
    # Outputs
    # ------------------------------------------------------------------
    with open(ISSUES_CSV, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["severity", "category", "doc_id", "version_id", "detail"])
        writer.writeheader()
        for row in sorted(issues, key=lambda r: (r["severity"] != "BLOCKING", r["category"], str(r["doc_id"]))):
            writer.writerow(row)
    print(f"Wrote {ISSUES_CSV} ({len(issues)} issues)")

    def bucket_stats(results):
        expected = len(results)
        found = sum(1 for r in results if r["found"])
        missing = expected - found
        zero_byte = sum(1 for r in results if r["zero_byte"])
        matches = sum(1 for r in results if r["md5_match"] == "MATCH")
        mismatches = sum(1 for r in results if r["md5_match"] == "MISMATCH")
        no_hash = sum(1 for r in results if r["md5_match"] == "NO_EXPECTED_HASH")
        return {
            "expected": expected, "found": found, "missing": missing, "zero_byte": zero_byte,
            "matches": matches, "mismatches": mismatches, "no_hash": no_hash,
        }

    active_stats = bucket_stats(active_results)
    archive_stats = bucket_stats(archive_results)
    ambiguous_stats = bucket_stats(ambiguous_results)

    blocking = [i for i in issues if i["severity"] == "BLOCKING"]
    warnings = [i for i in issues if i["severity"] == "WARNING"]
    infos = [i for i in issues if i["severity"] == "INFO"]

    report = []
    report.append("# KnowledgeTree Physical File Validation Report\n")
    report.append(
        "Generated by `migration/scripts/validate_physical_files.py`. Read-only — inspects "
        f"`{SOURCE_DUMP.name}` and the physical files under `migration/source/blobs/` "
        "(and, secondarily, `migration/source/reconstructed/`) only. Nothing under "
        "`migration/source/` was modified; nothing was written to PostgreSQL, MinIO, or the new DMS.\n"
    )

    report.append("## Scope and definitions\n")
    report.append(
        f"- **ACTIVE** file per document = the content version with the highest "
        "`(major_version, minor_version, id)` — the same rule `MIGRATION_RUNBOOK.md` §4.2 used, "
        "applied fresh here directly against the SQL dump (not against `02_documents.tsv`, which has "
        "a known encoding problem per the prior preflight step).\n"
        "- **ARCHIVE** files per document = every other `document_content_version` row for that "
        "document (all non-active historical versions) — these are the files "
        "`MIGRATION_SPEC.md`'s \"Preserve legacy history separately\" / \"Previous file versions "
        "available in the export\" refers to.\n"
        f"- **{len(ambiguous_docs)} document(s)** have an ambiguous ACTIVE file (already flagged in "
        "`07_preflight_report.md` §4/§11): the highest-version-number file disagrees with the file "
        "the document's current metadata snapshot actually points at. **Both candidates were "
        "physically validated** for these documents — the numeric-highest one is counted in the "
        "ACTIVE bucket below; the metadata-pointed alternate is validated separately and reported "
        "under 'Ambiguous-active alternates' so this validation doesn't silently pick a side.\n"
        "- `blobs/<storage_path>` is treated as the authoritative byte source, per instructions. "
        "`reconstructed/` was checked only as a secondary, non-authoritative presence-count "
        "cross-reference (see below) — not re-hashed file by file.\n"
    )

    def stats_block(title, stats):
        report.append(f"### {title}\n")
        report.append(
            f"| Expected | Found on disk | Missing | Zero-byte | MD5 match | MD5 mismatch | No expected MD5 recorded |\n"
            f"|---|---|---|---|---|---|---|\n"
            f"| {stats['expected']} | {stats['found']} | {stats['missing']} | {stats['zero_byte']} | "
            f"{stats['matches']} | {stats['mismatches']} | {stats['no_hash']} |\n\n"
        )

    report.append("## 1 & 2. Active and archive file presence\n")
    stats_block("Active files (1 per document)", active_stats)
    stats_block("Archive files (all other historical versions)", archive_stats)
    stats_block("Ambiguous-active alternates (secondary candidate for the 14 flagged documents)", ambiguous_stats)

    report.append("## 3. MD5 verification\n")
    total_checked = active_stats["found"] + archive_stats["found"]
    total_matches = active_stats["matches"] + archive_stats["matches"]
    total_mismatches = active_stats["mismatches"] + archive_stats["mismatches"]
    total_no_hash = active_stats["no_hash"] + archive_stats["no_hash"]
    report.append(
        f"Across active + archive files actually found on disk (**{total_checked}** files), MD5 was "
        f"computed from the real bytes on disk and compared against `document_content_version.md5hash`: "
        f"**{total_matches} match**, **{total_mismatches} mismatch**, **{total_no_hash}** had no expected "
        "hash recorded in the database to compare against at all (not itself an error — just nothing "
        "to verify against).\n"
    )

    report.append("## 4. Detected problems\n")
    report.append(
        f"- **Missing blobs** (expected file not found on disk): **{active_stats['missing'] + archive_stats['missing']}** "
        f"({active_stats['missing']} active, {archive_stats['missing']} archive).\n"
        f"- **MD5 mismatches**: **{total_mismatches}**.\n"
        f"- **Zero-byte files**: **{active_stats['zero_byte'] + archive_stats['zero_byte']}**.\n"
        f"- **Duplicate blob references** (same `storage_path` used by more than one "
        f"`document_content_version` row): **{len(duplicate_storage_paths)}** distinct blob(s), "
        f"referenced by a total of {sum(len(v) for v in duplicate_storage_paths.values())} version rows. "
        "This is not necessarily an error — KnowledgeTree can legitimately point two version rows at "
        "the same stored bytes — but is reported for visibility.\n"
        f"- **Database records with no storage_path/md5hash at all** (can't even attempt to locate a "
        f"file): counted among the BLOCKING/WARNING `no_storage_path_recorded` issues in "
        f"`{ISSUES_CSV.name}`.\n"
    )

    report.append("## 5. Active vs. archive readiness\n")
    report.append(
        f"- **Active files ready for migration**: **{active_stats['found'] - active_stats['zero_byte'] - active_stats['mismatches']} "
        f"/ {active_stats['expected']}** (found on disk, non-zero-byte, and MD5-clean where a hash was recorded).\n"
        f"- **Archive files ready**: **{archive_stats['found'] - archive_stats['zero_byte'] - archive_stats['mismatches']} "
        f"/ {archive_stats['expected']}**.\n"
        f"- **Missing active files**: **{active_stats['missing']}**.\n"
        f"- **Missing archive files**: **{archive_stats['missing']}**.\n"
    )

    report.append("## 6. Secondary check: reconstructed/\n")
    report.append(f"{recon_summary['note']}\n")

    report.append("## Summary of blocking vs. non-blocking issues\n")
    if blocking:
        by_cat = Counter(i["category"] for i in blocking)
        report.append(f"**{len(blocking)} BLOCKING issue(s)**:\n\n| category | count |\n|---|---|\n")
        for cat, cnt in sorted(by_cat.items(), key=lambda kv: -kv[1]):
            report.append(f"| {cat} | {cnt} |\n")
    else:
        report.append("**No BLOCKING issues found among ACTIVE files.**\n")
    report.append(
        f"\n**{len(warnings)} WARNING(s)** (all in the ARCHIVE bucket — a missing/bad historical version "
        "does not block migrating the document's active state, but does mean that specific historical "
        "version cannot be archived) and **{0} INFO** note(s) recorded separately in "
        f"`{ISSUES_CSV.name}`.\n".replace("{0}", str(len(infos)))
    )

    with open(REPORT_MD, "w", encoding="utf-8") as fh:
        fh.write("".join(report))
    print(f"Wrote {REPORT_MD}")

    print("\nDone. Nothing outside migration/output/ was written; migration/source/ was not modified; "
          "no connection to PostgreSQL/MinIO/the new DMS was made.")

    return {
        "active_stats": active_stats, "archive_stats": archive_stats,
        "blocking": len(blocking), "warnings": warnings, "infos": len(infos),
    }


if __name__ == "__main__":
    main()
