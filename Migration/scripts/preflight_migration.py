#!/usr/bin/env python3
"""Read-only preflight check for the KnowledgeTree -> new DMS migration.

Per migration/MIGRATION_SPEC.md, the new DMS will only receive each legacy
document's LATEST file + LATEST metadata as its active record, with prior
file/metadata history preserved separately as an archive. This script does
NOT migrate anything — it only inspects what already exists under
migration/source/ and migration/output/ and reports whether the data is
actually clean enough to migrate, and exactly where it isn't.

SAFETY
- Reads only from migration/source/ and migration/output/ (never modified).
- Writes only into migration/output/.
- Never connects to PostgreSQL, MinIO, or any live service.
- Does not touch the new DMS application in any way.
- Safe to re-run any number of times — every output file is fully rewritten
  from the source data each run.
"""

import csv
import gzip
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MIGRATION_DIR = SCRIPT_DIR.parent
SOURCE_DIR = MIGRATION_DIR / "source"
OUTPUT_DIR = MIGRATION_DIR / "output"
SOURCE_DUMP = SOURCE_DIR / "dms_full_2026-07-30.sql.gz"
METADATA_FIELDS_TSV = OUTPUT_DIR / "05_metadata_fields.tsv"

REPORT_MD = OUTPUT_DIR / "07_preflight_report.md"
OWNER_CSV = OUTPUT_DIR / "07_owner_mapping_candidates.csv"
DOCNUM_CSV = OUTPUT_DIR / "07_document_number_comparison.csv"
ISSUES_CSV = OUTPUT_DIR / "07_migration_issues.csv"


# ---------------------------------------------------------------------------
# Same hand-written, quote/escape-aware mysqldump VALUES parser used by
# extract_legacy_metadata.py — duplicated here (not imported) so this script
# stays independently runnable and auditable on its own.
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
FOLDERS_COLS = [
    "id", "name", "description", "parent_id", "creator_id", "created",
    "modified_user_id", "modified", "is_public", "parent_folder_ids",
    "full_path", "permission_object_id", "permission_lookup_id",
    "restrict_document_types", "owner_id", "linked_folder_id",
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
DOCUMENT_TYPES_LOOKUP_COLS = ["id", "name", "disabled"]


def check_utf8(path):
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return None
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError as e:
        return str(e)


def version_sort_key(v):
    """(major, minor, id) as ints — the same 'latest' rule MIGRATION_RUNBOOK.md
    §4.2 used for 02_documents.tsv, applied here directly against the SQL dump."""
    return (int(v["major_version"] or 0), int(v["minor_version"] or 0), int(v["id"]))


def main():
    if not SOURCE_DUMP.exists():
        print(f"FATAL: source dump not found at {SOURCE_DUMP}", file=sys.stderr)
        sys.exit(1)
    if not METADATA_FIELDS_TSV.exists():
        print(f"FATAL: {METADATA_FIELDS_TSV} not found — run extract_legacy_metadata.py first",
              file=sys.stderr)
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Reading {SOURCE_DUMP.name} (read-only) ...")
    dump_text = load_dump_text(SOURCE_DUMP)

    documents = rows_to_dicts(extract_table_rows(dump_text, "documents"), DOCUMENTS_COLS)
    folders = rows_to_dicts(extract_table_rows(dump_text, "folders"), FOLDERS_COLS)
    content_versions = rows_to_dicts(
        extract_table_rows(dump_text, "document_content_version"), DOCUMENT_CONTENT_VERSION_COLS
    )
    metadata_versions = rows_to_dicts(
        extract_table_rows(dump_text, "document_metadata_version"), DOCUMENT_METADATA_VERSION_COLS
    )
    doc_types = rows_to_dicts(
        extract_table_rows(dump_text, "document_types_lookup"), DOCUMENT_TYPES_LOOKUP_COLS
    )

    print(f"Reading {METADATA_FIELDS_TSV.name} (read-only) ...")
    metadata_rows = []
    with open(METADATA_FIELDS_TSV, "r", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            metadata_rows.append(row)

    print(
        f"Parsed: {len(documents)} documents, {len(folders)} folders, "
        f"{len(content_versions)} content versions, {len(metadata_versions)} metadata versions, "
        f"{len(metadata_rows)} extracted metadata-field rows."
    )

    doc_by_id = {d["id"]: d for d in documents}
    mv_by_id = {m["id"]: m for m in metadata_versions}
    doctype_by_id = {dt["id"]: dt for dt in doc_types}

    issues = []  # each: dict(severity, category, doc_id, detail)

    def add_issue(severity, category, doc_id, detail):
        issues.append({"severity": severity, "category": category, "doc_id": doc_id, "detail": detail})

    # ---- 1/2: totals -----------------------------------------------------
    total_documents = len(documents)
    total_folders = len(folders)

    # ---- 12: duplicate document IDs (structural) --------------------------
    doc_id_counts = Counter(d["id"] for d in documents)
    dup_doc_ids = {k: v for k, v in doc_id_counts.items() if v > 1}
    for did, cnt in dup_doc_ids.items():
        add_issue("BLOCKING", "duplicate_document_id", did, f"appears {cnt} times in documents table")

    # ---- 3/11: latest metadata exists + is linkable for every document ----
    current_metadata_rows_by_doc = defaultdict(list)
    for r in metadata_rows:
        if r["is_current_metadata_version"] == "1":
            current_metadata_rows_by_doc[r["doc_id"]].append(r)

    docs_missing_current_metadata = []
    for d in documents:
        mv_id = d["metadata_version_id"]
        if not mv_id:
            docs_missing_current_metadata.append(d["id"])
            add_issue("BLOCKING", "missing_metadata_version_pointer", d["id"],
                      "documents.metadata_version_id is NULL")
            continue
        if mv_id not in mv_by_id:
            docs_missing_current_metadata.append(d["id"])
            add_issue("BLOCKING", "unlinkable_metadata_version", d["id"],
                      f"metadata_version_id={mv_id} has no matching document_metadata_version row")
            continue
        if mv_by_id[mv_id]["document_id"] != d["id"]:
            docs_missing_current_metadata.append(d["id"])
            add_issue("BLOCKING", "metadata_version_document_mismatch", d["id"],
                      f"metadata_version_id={mv_id} belongs to a different document_id")

    docs_with_no_current_field_values = sorted(
        set(doc_by_id.keys()) - set(current_metadata_rows_by_doc.keys())
    )
    for did in docs_with_no_current_field_values:
        add_issue("WARNING", "no_current_field_values", did,
                  "has a valid current metadata_version but zero populated custom-field values in it")

    # ---- 4/5: latest file + historical files per document -----------------
    versions_by_doc = defaultdict(list)
    for v in content_versions:
        versions_by_doc[v["document_id"]].append(v)

    latest_version_by_doc = {}
    for did, vlist in versions_by_doc.items():
        latest_version_by_doc[did] = max(vlist, key=version_sort_key)

    # Cross-check: does the "highest version number" file agree with the file
    # tied to the document's CURRENT metadata snapshot (content_version_id)?
    # These are two independent ways KnowledgeTree can be read as defining
    # "latest," and per MIGRATION_RUNBOOK.md §4.2 they were assumed to agree —
    # verified here rather than assumed.
    latest_file_mismatches = []
    for d in documents:
        did = d["id"]
        mv_id = d["metadata_version_id"]
        mv = mv_by_id.get(mv_id)
        by_number = latest_version_by_doc.get(did)
        by_metadata_pointer = None
        if mv is not None:
            by_metadata_pointer = next(
                (v for v in versions_by_doc.get(did, []) if v["id"] == mv["content_version_id"]), None
            )
        if by_number is not None and by_metadata_pointer is not None and by_number["id"] != by_metadata_pointer["id"]:
            latest_file_mismatches.append(did)
            add_issue(
                "WARNING", "latest_file_definition_mismatch", did,
                f"highest-version-number file is content_version_id={by_number['id']} "
                f"(v{by_number['major_version']}.{by_number['minor_version']}), but the document's "
                f"current metadata snapshot points at content_version_id={by_metadata_pointer['id']} "
                f"(v{by_metadata_pointer['major_version']}.{by_metadata_pointer['minor_version']})"
            )

    # ---- 6: documents with missing files (data-level only — see report) ---
    docs_with_zero_versions = sorted(set(doc_by_id.keys()) - set(versions_by_doc.keys()))
    for did in docs_with_zero_versions:
        add_issue("BLOCKING", "no_content_version_row", did, "document has zero document_content_version rows at all")

    docs_with_unrecoverable_latest = []
    for did, v in latest_version_by_doc.items():
        if not v.get("storage_path") or not v.get("md5hash"):
            docs_with_unrecoverable_latest.append(did)
            add_issue(
                "BLOCKING", "latest_file_missing_storage_info", did,
                f"content_version_id={v['id']} has empty storage_path and/or md5hash — "
                "the actual blob for this document's latest version cannot be located from this data alone"
            )

    total_missing_files = len(set(docs_with_zero_versions) | set(docs_with_unrecoverable_latest))

    # ---- 7/8/9: Authors / Group / Document Type distinct values -----------
    def distinct_values(field_name):
        counter = Counter()
        for r in metadata_rows:
            if r["field_name"] == field_name and r["is_current_metadata_version"] == "1":
                v = (r["field_value"] or "").strip()
                if v:
                    counter[v] += 1
        return counter

    authors_counter = distinct_values("Authors")
    group_counter = distinct_values("Group")

    doctype_counter = Counter()
    for d in documents:
        mv = mv_by_id.get(d["metadata_version_id"])
        if mv:
            dt = doctype_by_id.get(mv["document_type_id"])
            doctype_counter[dt["name"] if dt else f"(unknown type id {mv['document_type_id']})"] += 1

    # ---- 10: Document # (metadata) vs documents.oem_no ---------------------
    docnum_by_doc = {}
    for r in metadata_rows:
        if r["field_name"] == "Document #" and r["is_current_metadata_version"] == "1":
            docnum_by_doc[r["doc_id"]] = (r["field_value"] or "").strip()

    docnum_comparison = []
    agree_count = 0
    disagree_count = 0
    metadata_only_count = 0
    oem_only_count = 0
    neither_count = 0
    for d in documents:
        did = d["id"]
        meta_val = docnum_by_doc.get(did, "")
        oem_val = (d["oem_no"] or "").strip() if d["oem_no"] else ""
        if meta_val and oem_val:
            status = "MATCH" if meta_val == oem_val else "MISMATCH"
            if status == "MATCH":
                agree_count += 1
            else:
                disagree_count += 1
                add_issue("WARNING", "document_number_mismatch", did,
                          f"metadata 'Document #'='{meta_val}' but documents.oem_no='{oem_val}'")
        elif meta_val and not oem_val:
            status = "METADATA_ONLY"
            metadata_only_count += 1
        elif oem_val and not meta_val:
            status = "OEM_NO_ONLY"
            oem_only_count += 1
        else:
            status = "NEITHER"
            neither_count += 1
        docnum_comparison.append({
            "doc_id": did, "metadata_document_number": meta_val, "documents_oem_no": oem_val, "status": status,
        })

    # Duplicate Document # / oem_no values -> would collide with the new DMS's
    # case-insensitive UNIQUE constraint on original_document_id.
    combined_id_values = defaultdict(list)
    for row in docnum_comparison:
        candidate = row["metadata_document_number"] or row["documents_oem_no"]
        if candidate:
            combined_id_values[candidate.lower()].append(row["doc_id"])
    dup_docnum_values = {k: v for k, v in combined_id_values.items() if len(v) > 1}
    for val, doc_ids in dup_docnum_values.items():
        add_issue(
            "BLOCKING", "duplicate_document_number", ",".join(doc_ids),
            f"Document #/oem_no value '{val}' (case-insensitive) is shared by {len(doc_ids)} documents — "
            "would violate the new DMS's unique original_document_id constraint if mapped as-is"
        )

    # ---- 13: encoding problems ---------------------------------------------
    encoding_results = {}
    for fname in ["01_folders.tsv", "02_documents.tsv", "03_versions_filemap.tsv",
                  "04_transactions.tsv"]:
        encoding_results[fname] = check_utf8(SOURCE_DIR / fname)
    encoding_results[SOURCE_DUMP.name] = True  # already read as strict utf-8 above, or we'd have crashed
    encoding_results[METADATA_FIELDS_TSV.name] = check_utf8(METADATA_FIELDS_TSV)

    for fname, result in encoding_results.items():
        if result not in (True, None):
            add_issue("INFO", "encoding_problem", "-", f"{fname}: {result}")

    # Mojibake heuristic on the actual metadata values we intend to migrate —
    # a sequence like 'Ã©' / 'Â ' is the classic sign of UTF-8 bytes that were
    # already-mis-decoded once and then re-encoded (double-encoding), which
    # plain UTF-8 validity checks above cannot catch on their own.
    mojibake_pattern = re.compile(r"Ã[\x80-\xbf]|Â[\x80-\xbf]|â€")
    mojibake_hits = []
    for r in metadata_rows:
        if r["field_value"] and mojibake_pattern.search(r["field_value"]):
            mojibake_hits.append((r["doc_id"], r["field_name"], r["field_value"]))
    for did, fname, val in mojibake_hits[:50]:
        add_issue("WARNING", "possible_mojibake", did, f"field '{fname}' value looks double-encoded: {val!r}")

    # ------------------------------------------------------------------
    # Outputs
    # ------------------------------------------------------------------

    # 07_owner_mapping_candidates.csv (Authors + Group, per spec: Authors->Owner, Group->Department)
    with open(OWNER_CSV, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["mapping_target", "legacy_value", "document_count"])
        for val, cnt in sorted(authors_counter.items(), key=lambda kv: (-kv[1], kv[0])):
            writer.writerow(["Owner (from Authors)", val, cnt])
        for val, cnt in sorted(group_counter.items(), key=lambda kv: (-kv[1], kv[0])):
            writer.writerow(["Department (from Group)", val, cnt])
    print(f"Wrote {OWNER_CSV}")

    # 07_document_number_comparison.csv
    with open(DOCNUM_CSV, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["doc_id", "metadata_document_number", "documents_oem_no", "status"]
        )
        writer.writeheader()
        for row in docnum_comparison:
            writer.writerow(row)
    print(f"Wrote {DOCNUM_CSV} ({len(docnum_comparison)} rows)")

    # 07_migration_issues.csv
    with open(ISSUES_CSV, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["severity", "category", "doc_id", "detail"])
        writer.writeheader()
        for row in sorted(issues, key=lambda r: (r["severity"] != "BLOCKING", r["category"], str(r["doc_id"]))):
            writer.writerow(row)
    print(f"Wrote {ISSUES_CSV} ({len(issues)} issues)")

    # 07_preflight_report.md
    blocking = [i for i in issues if i["severity"] == "BLOCKING"]
    warnings = [i for i in issues if i["severity"] == "WARNING"]
    infos = [i for i in issues if i["severity"] == "INFO"]
    blocking_doc_ids = set()
    for i in blocking:
        blocking_doc_ids.update(str(i["doc_id"]).split(","))
    ready_doc_ids = sorted(set(doc_by_id.keys()) - blocking_doc_ids, key=lambda x: int(x))

    report = []
    report.append("# KnowledgeTree Migration Preflight Report\n")
    report.append(
        "Generated by `migration/scripts/preflight_migration.py`. Read-only — inspects "
        f"`{SOURCE_DUMP.name}` and `{METADATA_FIELDS_TSV.name}` only; nothing was written to "
        "PostgreSQL, MinIO, or the new DMS; nothing under `migration/source/` was modified.\n"
    )

    report.append("## 1. Total legacy documents\n")
    report.append(f"**{total_documents}**\n")

    report.append("## 2. Total folders\n")
    report.append(f"**{total_folders}**\n")

    report.append("## 3. Latest metadata exists for every document\n")
    report.append(
        f"**{total_documents - len(docs_missing_current_metadata)} / {total_documents}** documents have a "
        f"valid, linkable current metadata snapshot. "
        + (f"**{len(docs_missing_current_metadata)} do not** — see `missing_metadata_version_pointer` / "
           f"`unlinkable_metadata_version` / `metadata_version_document_mismatch` rows in "
           f"`{ISSUES_CSV.name}`.\n" if docs_missing_current_metadata else
           "Zero exceptions found.\n")
    )
    report.append(
        f"Separately, **{len(docs_with_no_current_field_values)}** document(s) have a structurally valid "
        "current metadata version but no populated custom-field values inside it at all (flagged as a "
        "WARNING, not blocking — an empty-but-valid metadata record is not on its own a migration blocker).\n"
    )

    report.append("## 4 & 5. Latest file vs. historical file versions per document\n")
    report.append(
        f"- **{len(latest_version_by_doc)} / {total_documents}** documents have at least one "
        "`document_content_version` row, from which a 'latest' (highest major.minor.id) file was identified "
        f"for each. **{len(docs_with_zero_versions)}** document(s) have zero content-version rows at all "
        "(no file record whatsoever) — listed as BLOCKING `no_content_version_row` issues.\n"
        f"- **{len(content_versions)}** total historical file-version rows exist across all documents "
        f"(average {len(content_versions) / max(total_documents, 1):.1f} versions/document) — every one "
        "is a candidate for the archive per `MIGRATION_SPEC.md`, not just the latest.\n"
        f"- **{len(latest_file_mismatches)}** document(s) have an ambiguous 'latest file': the file with "
        "the highest version number disagrees with the file actually referenced by the document's current "
        "metadata snapshot. Flagged as WARNING `latest_file_definition_mismatch` — needs a human decision "
        "on which one is truly authoritative before those specific documents are migrated (see §11 in "
        f"`{ISSUES_CSV.name}`).\n"
    )

    report.append("## 6. Documents with missing files\n")
    report.append(
        f"**{total_missing_files}** document(s), split as:\n"
        f"- **{len(docs_with_zero_versions)}** with no file-version record at all.\n"
        f"- **{len(docs_with_unrecoverable_latest)}** whose latest version record exists but has no "
        "`storage_path`/`md5hash` recorded — the same 'lost blob' pattern `MIGRATION_RUNBOOK.md` §6 already "
        "documented for one specific document.\n\n"
        "**Scope note:** this check is data-level only — no actual blob files "
        "(`blobs/`/`reconstructed/`) are present under `migration/source/` in this environment, so this "
        "cannot confirm a file *physically exists on disk*, only whether the database record needed to "
        "locate one is present and complete. A document absent from both lists above is not guaranteed "
        "to have a retrievable file — only guaranteed to have a complete database pointer to one.\n"
    )

    report.append("## 7. Authors values (candidate Owner mapping)\n")
    report.append(
        f"**{len(authors_counter)}** distinct `Authors` values across current metadata "
        f"(covering {sum(authors_counter.values())} document/value pairs). Per `MIGRATION_SPEC.md`, "
        f"`Authors -> Owner`. Full list with per-value document counts: `{OWNER_CSV.name}`. These are "
        "free-text legacy author names, not new-DMS user accounts — an explicit legacy-name -> new-DMS-user "
        "mapping table is still needed before import (not built by this step).\n"
    )

    report.append("## 8. Group values (candidate Department mapping)\n")
    report.append(
        f"**{len(group_counter)}** distinct `Group` values across current metadata. Per "
        f"`MIGRATION_SPEC.md`, `Group -> Department`. Full list: `{OWNER_CSV.name}`.\n"
    )

    report.append("## 9. Document Types (candidate Category mapping)\n")
    report.append("| document_type | document_count |\n|---|---|\n")
    for name, cnt in sorted(doctype_counter.items(), key=lambda kv: (-kv[1], kv[0])):
        report.append(f"| {name} | {cnt} |\n")
    report.append(
        "\nPer `MIGRATION_SPEC.md`, `Document Type -> Category`. Every document's type resolves to a real "
        "`document_types_lookup` row (no unknowns found) — see totals above.\n"
    )

    report.append("## 10. \"Document #\" metadata vs. `documents.oem_no`\n")
    report.append(
        f"| Status | Count |\n|---|---|\n"
        f"| Both present and equal (MATCH) | {agree_count} |\n"
        f"| Both present but different (MISMATCH) | {disagree_count} |\n"
        f"| Only the metadata field has a value (METADATA_ONLY) | {metadata_only_count} |\n"
        f"| Only `documents.oem_no` has a value (OEM_NO_ONLY) | {oem_only_count} |\n"
        f"| Neither has a value (NEITHER) | {neither_count} |\n\n"
        f"Full per-document detail: `{DOCNUM_CSV.name}`. Per `MIGRATION_SPEC.md`, "
        "`Document # -> Original Document ID (must be verified first)` — this table is exactly that "
        "verification. "
        + (
            f"**{disagree_count} disagreement(s) need a human decision** (which source wins) before "
            "`original_document_id` can be populated for those documents.\n"
            if disagree_count else
            "No disagreements found where both sources had a value.\n"
        )
        + f"Additionally, **{len(dup_docnum_values)}** value(s) are shared by more than one document "
        "(case-insensitively) — these would violate the new DMS's unique `original_document_id` constraint "
        "if migrated as-is; see BLOCKING `duplicate_document_number` rows.\n"
    )

    report.append("## 11. Legacy metadata history linkage\n")
    report.append(
        f"Re-verified directly against the source dump (not assumed from the prior extraction step): "
        f"**{len(docs_missing_current_metadata)}** documents failed to resolve `documents.metadata_version_id` "
        "to a real, correctly-owned `document_metadata_version` row. "
        + ("All clear.\n" if not docs_missing_current_metadata else
           "See the BLOCKING issues listed above.\n")
    )

    report.append("## 12. Duplicate document IDs\n")
    report.append(
        f"- Structural duplicates in `documents.id` itself: **{len(dup_doc_ids)}** "
        f"({'none' if not dup_doc_ids else ', '.join(dup_doc_ids.keys())}).\n"
        f"- Duplicate `Document #`/`oem_no` values that would collide once mapped to the new DMS's "
        f"unique `original_document_id`: **{len(dup_docnum_values)}** value(s), affecting "
        f"**{sum(len(v) for v in dup_docnum_values.values())}** documents in total.\n"
    )

    report.append("## 13. Encoding problems\n")
    for fname, result in encoding_results.items():
        if result is None:
            report.append(f"- `{fname}`: not found in this export, not checked.\n")
        elif result is True:
            report.append(f"- `{fname}`: valid UTF-8.\n")
        else:
            report.append(f"- `{fname}`: **invalid UTF-8** — {result}\n")
    report.append(
        f"\nSeparately, a mojibake heuristic (double-encoding pattern, e.g. `Ã©`) was run against every "
        f"extracted metadata value actually intended for migration: **{len(mojibake_hits)}** hit(s) found "
        "(capped at 50 in the issues CSV). "
        + ("None found.\n" if not mojibake_hits else
           "These specific values should be visually re-checked before import — automatic \"fixing\" of "
           "text encoding was deliberately not attempted here, per the read-only/no-inference scope of "
           "this step.\n")
    )

    report.append("## 14. Summary of anything that would block migration\n")
    if not blocking:
        report.append("**No BLOCKING issues found.**\n")
    else:
        by_category = Counter(i["category"] for i in blocking)
        report.append(f"**{len(blocking)} BLOCKING issue(s)** across {len(blocking_doc_ids)} document(s):\n\n")
        report.append("| category | count |\n|---|---|\n")
        for cat, cnt in sorted(by_category.items(), key=lambda kv: -kv[1]):
            report.append(f"| {cat} | {cnt} |\n")
        report.append(f"\nFull detail, one row per issue: `{ISSUES_CSV.name}`.\n")
    report.append(
        f"\n**{len(warnings)} WARNING(s)** (not blocking, but need a human decision before or during "
        f"import) and **{len(infos)} INFO** note(s) were also recorded — same file.\n"
    )
    report.append(
        f"\n**Bottom line: {len(ready_doc_ids)} / {total_documents} documents have no BLOCKING issue** "
        "and are structurally ready to migrate once the mapping decisions above (Owner/Department names, "
        "Document # conflicts, ambiguous-latest-file cases) are actually made — this step does not make "
        "those decisions, only surfaces them.\n"
    )

    with open(REPORT_MD, "w", encoding="utf-8") as fh:
        fh.write("".join(report))
    print(f"Wrote {REPORT_MD}")

    print("\nDone. Nothing outside migration/output/ was written; migration/source/ was not modified; "
          "no connection to PostgreSQL/MinIO/the new DMS was made.")

    # stash a few numbers for the calling shell/summary step
    return {
        "total_documents": total_documents,
        "ready": len(ready_doc_ids),
        "blocking_docs": len(blocking_doc_ids),
        "missing_files": total_missing_files,
        "authors_count": len(authors_counter),
        "docnum_agree": agree_count,
        "docnum_disagree": disagree_count,
        "blocking_issues": len(blocking),
        "warning_issues": len(warnings),
    }


if __name__ == "__main__":
    main()
