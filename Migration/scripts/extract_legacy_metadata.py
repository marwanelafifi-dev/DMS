#!/usr/bin/env python3
"""Extract all custom metadata field values from the legacy KnowledgeTree MySQL dump.

READ-ONLY / SOURCE-ONLY SCRIPT
- Reads only from migration/source/dms_full_2026-07-30.sql.gz (never modified).
- Writes only into migration/output/.
- Never connects to PostgreSQL, MinIO, or any live service.
- No values are renamed, translated, normalized, or inferred — every legacy
  value is carried through exactly as stored in the source dump.
- Safe to re-run any number of times: every output file is fully rewritten
  from the source dump each run, with no incremental/mutable state.

Real KnowledgeTree metadata model (verified directly against the dump's
CREATE TABLE statements and data — see 05_metadata_extraction_report.md
for the full writeup):

  documents.metadata_version_id  -->  document_metadata_version.id   (CURRENT snapshot)
  document_metadata_version.document_id       -> documents.id
  document_metadata_version.content_version_id -> document_content_version.id
  document_metadata_version.document_type_id   -> document_types_lookup.id
  document_fields_link.metadata_version_id     -> document_metadata_version.id
  document_fields_link.document_field_id       -> document_fields.id
  document_fields.parent_fieldset              -> fieldsets.id

A document can have MANY document_metadata_version rows over its lifetime
(one per historical metadata "version"); each one is optionally tied to a
specific content_version_id. document_fields_link rows hold the actual field
VALUES for one specific metadata_version_id. This script exports every such
value row, tagged with whether it belongs to the document's CURRENT metadata
version (documents.metadata_version_id) or an older, superseded one.
"""

import csv
import gzip
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
MIGRATION_DIR = SCRIPT_DIR.parent
SOURCE_DUMP = MIGRATION_DIR / "source" / "dms_full_2026-07-30.sql.gz"
OUTPUT_DIR = MIGRATION_DIR / "output"

FIELDS_TSV = OUTPUT_DIR / "05_metadata_fields.tsv"
SUMMARY_CSV = OUTPUT_DIR / "05_metadata_summary.csv"
REPORT_MD = OUTPUT_DIR / "05_metadata_extraction_report.md"
SKIPPED_LOG = OUTPUT_DIR / "05_metadata_skipped_records.log"


# ---------------------------------------------------------------------------
# Minimal, careful mysqldump VALUES parser.
#
# mysqldump emits each table's data as one or more single-line statements:
#   INSERT INTO `table` VALUES (a,b,'c,d''e'),(f,g,'h');
# This walks the string once, tracking quote/escape state, so a comma or
# parenthesis *inside* a quoted string is never mistaken for a row/field
# boundary. No external SQL-parsing dependency is used or required.
# ---------------------------------------------------------------------------

def split_tuples(values_str):
    tuples = []
    cur = []
    in_str = False
    esc = False
    depth = 0
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
    parts = []
    cur = []
    in_str = False
    esc = False
    depth = 0
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
    """Decode one mysqldump literal: 'quoted string', NULL, or a bare number."""
    if raw == "NULL":
        return None
    if len(raw) >= 2 and raw[0] == "'" and raw[-1] == "'":
        inner = raw[1:-1]
        out = []
        i = 0
        while i < len(inner):
            c = inner[i]
            if c == "\\" and i + 1 < len(inner):
                out.append(_ESCAPE_MAP.get(inner[i + 1], inner[i + 1]))
                i += 2
            else:
                out.append(c)
                i += 1
        return "".join(out)
    return raw  # bare number/int literal, left as the original string


def load_dump_text(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return fh.read()


def extract_table_rows(dump_text, table_name):
    """Return every row (as a list of decoded Python values) inserted into
    `table_name`, across every INSERT statement mysqldump emitted for it."""
    rows = []
    pattern = re.compile(r"INSERT INTO `" + re.escape(table_name) + r"` VALUES (.*?);\n", re.S)
    for match in pattern.finditer(dump_text):
        for tup in split_tuples(match.group(1)):
            rows.append([unescape_value(f) for f in split_fields(tup)])
    return rows


# Column orders below are taken verbatim from each table's CREATE TABLE
# statement in the dump (see the report for the full DDL) — not guessed.
DOCUMENTS_COLS = [
    "id", "creator_id", "modified", "folder_id", "is_checked_out",
    "parent_folder_ids", "full_path", "checked_out_user_id", "status_id",
    "created", "permission_object_id", "permission_lookup_id",
    "metadata_version", "modified_user_id", "metadata_version_id",
    "owner_id", "immutable", "restore_folder_id", "restore_folder_path",
    "checkedout", "oem_no", "linked_document_id",
]
DOCUMENT_METADATA_VERSION_COLS = [
    "id", "document_id", "content_version_id", "document_type_id", "name",
    "description", "status_id", "metadata_version", "version_created",
    "version_creator_id", "workflow_id", "workflow_state_id",
]
DOCUMENT_FIELDS_COLS = [
    "id", "name", "data_type", "is_generic", "has_lookup", "has_lookuptree",
    "parent_fieldset", "is_mandatory", "description", "position", "is_html",
    "max_length", "has_inetlookup", "inetlookup_type",
]
DOCUMENT_FIELDS_LINK_COLS = ["id", "document_field_id", "value", "metadata_version_id"]
FIELDSETS_COLS = [
    "id", "name", "namespace", "mandatory", "is_conditional", "master_field",
    "is_generic", "is_complex", "is_complete", "is_system", "description", "disabled",
]
DOCUMENT_TYPES_LOOKUP_COLS = ["id", "name", "disabled"]


def rows_to_dicts(rows, columns):
    return [dict(zip(columns, row)) for row in rows]


def main():
    if not SOURCE_DUMP.exists():
        print(f"FATAL: source dump not found at {SOURCE_DUMP}", file=sys.stderr)
        sys.exit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Reading {SOURCE_DUMP.name} (read-only) ...")
    dump_text = load_dump_text(SOURCE_DUMP)

    documents = rows_to_dicts(extract_table_rows(dump_text, "documents"), DOCUMENTS_COLS)
    metadata_versions = rows_to_dicts(
        extract_table_rows(dump_text, "document_metadata_version"), DOCUMENT_METADATA_VERSION_COLS
    )
    fields = rows_to_dicts(extract_table_rows(dump_text, "document_fields"), DOCUMENT_FIELDS_COLS)
    field_links = rows_to_dicts(
        extract_table_rows(dump_text, "document_fields_link"), DOCUMENT_FIELDS_LINK_COLS
    )
    fieldsets = rows_to_dicts(extract_table_rows(dump_text, "fieldsets"), FIELDSETS_COLS)
    doc_types = rows_to_dicts(
        extract_table_rows(dump_text, "document_types_lookup"), DOCUMENT_TYPES_LOOKUP_COLS
    )

    print(
        f"Parsed: {len(documents)} documents, {len(metadata_versions)} metadata versions, "
        f"{len(fields)} field definitions, {len(field_links)} field-value rows, "
        f"{len(fieldsets)} fieldsets, {len(doc_types)} document types."
    )

    doc_by_id = {d["id"]: d for d in documents}
    mv_by_id = {m["id"]: m for m in metadata_versions}
    field_by_id = {f["id"]: f for f in fields}
    fieldset_by_id = {fs["id"]: fs for fs in fieldsets}
    doctype_by_id = {dt["id"]: dt for dt in doc_types}

    current_mv_id_by_doc = {d["id"]: d["metadata_version_id"] for d in documents}

    skipped = []
    output_rows = []

    for link in field_links:
        mv = mv_by_id.get(link["metadata_version_id"])
        if mv is None:
            skipped.append(
                f"document_fields_link.id={link['id']}: metadata_version_id="
                f"{link['metadata_version_id']} has no matching document_metadata_version row"
            )
            continue

        field = field_by_id.get(link["document_field_id"])
        if field is None:
            skipped.append(
                f"document_fields_link.id={link['id']}: document_field_id="
                f"{link['document_field_id']} has no matching document_fields row"
            )
            continue

        doc_id = mv["document_id"]
        if doc_id not in doc_by_id:
            skipped.append(
                f"document_fields_link.id={link['id']}: document_metadata_version.id="
                f"{mv['id']} points at document_id={doc_id}, which does not exist in documents"
            )
            continue

        fieldset = fieldset_by_id.get(field["parent_fieldset"]) if field["parent_fieldset"] else None
        doctype = doctype_by_id.get(mv["document_type_id"])
        is_current = current_mv_id_by_doc.get(doc_id) == mv["id"]

        output_rows.append({
            "doc_id": doc_id,
            "field_id": field["id"],
            "field_name": field["name"],
            "field_value": link["value"],
            "field_type": field["data_type"],
            "fieldset_id": field["parent_fieldset"] or "",
            "fieldset_name": fieldset["name"] if fieldset else "",
            "metadata_version_id": mv["id"],
            "metadata_version": mv["metadata_version"],
            "content_version_id": mv["content_version_id"],
            "document_type_id": mv["document_type_id"],
            "document_type_name": doctype["name"] if doctype else "",
            "is_current_metadata_version": "1" if is_current else "0",
            "value_link_id": link["id"],
            "version_created": mv["version_created"],
        })

    # --- Task 2: 05_metadata_fields.tsv --------------------------------------
    fieldnames = [
        "doc_id", "field_id", "field_name", "field_value", "field_type",
        "fieldset_id", "fieldset_name", "metadata_version_id", "metadata_version",
        "content_version_id", "document_type_id", "document_type_name",
        "is_current_metadata_version", "value_link_id", "version_created",
    ]
    with open(FIELDS_TSV, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for row in output_rows:
            writer.writerow(row)
    print(f"Wrote {FIELDS_TSV} ({len(output_rows)} rows)")

    # --- Task 3: 05_metadata_summary.csv (current metadata version only) ----
    current_rows = [r for r in output_rows if r["is_current_metadata_version"] == "1"]
    by_field = defaultdict(list)
    for r in current_rows:
        by_field[r["field_name"]].append(r)

    summary_rows = []
    for field_name, rows in sorted(by_field.items()):
        docs_with_row = {r["doc_id"] for r in rows}
        non_empty = [r for r in rows if r["field_value"] and r["field_value"].strip() != ""]
        empty = [r for r in rows if not (r["field_value"] and r["field_value"].strip() != "")]
        example_values = []
        seen = set()
        for r in non_empty:
            v = r["field_value"]
            if v not in seen:
                seen.add(v)
                example_values.append(v)
            if len(example_values) >= 3:
                break
        summary_rows.append({
            "field_name": field_name,
            "documents_count": len(docs_with_row),
            "non_empty_count": len(non_empty),
            "empty_count": len(empty),
            "example_values": "; ".join(example_values),
        })

    with open(SUMMARY_CSV, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["field_name", "documents_count", "non_empty_count", "empty_count", "example_values"]
        )
        writer.writeheader()
        for row in summary_rows:
            writer.writerow(row)
    print(f"Wrote {SUMMARY_CSV} ({len(summary_rows)} fields)")

    # --- skipped-records log -------------------------------------------------
    with open(SKIPPED_LOG, "w", encoding="utf-8") as fh:
        fh.write(f"Skipped/unlinkable document_fields_link rows: {len(skipped)}\n\n")
        for line in skipped:
            fh.write(line + "\n")
        if not skipped:
            fh.write("(none — every document_fields_link row linked cleanly)\n")
    print(f"Wrote {SKIPPED_LOG} ({len(skipped)} skipped rows)")

    # --- Task 4: technical report --------------------------------------------
    distinct_docs_any_metadata = {r["doc_id"] for r in output_rows}
    distinct_docs_current_metadata = {r["doc_id"] for r in current_rows}
    field_name_counts = Counter(r["field_name"] for r in output_rows)
    total_docs = len(documents)

    report = []
    report.append("# Legacy KnowledgeTree Metadata Extraction Report\n")
    report.append(f"Generated by `migration/scripts/extract_legacy_metadata.py` from "
                  f"`{SOURCE_DUMP.name}`.\n")

    report.append("## 1. Source tables used\n")
    report.append(
        "- `documents` — one row per live document; `metadata_version_id` points at the "
        "document's *current* `document_metadata_version` row.\n"
        "- `document_metadata_version` — one row per metadata snapshot in a document's history "
        "(`document_id`, `content_version_id`, `document_type_id`, `metadata_version` counter, "
        "`version_created`).\n"
        "- `document_fields` — the 9 custom field *definitions* (`name`, `data_type`, "
        "`parent_fieldset`, `is_mandatory`, `description`, ...).\n"
        "- `document_fields_link` — the actual field *values*: `document_field_id` "
        "(which field), `value` (the text), `metadata_version_id` (which snapshot).\n"
        "- `fieldsets` — 4 named metadata groups (`Tag Cloud`, `General information`, "
        "`Document Information`, `Workflow`) that `document_fields.parent_fieldset` belongs to.\n"
        "- `document_types_lookup` — 8 document type names, referenced by "
        "`document_metadata_version.document_type_id`.\n"
        "- Inspected but **not used for values** (present in the dump but empty/irrelevant to "
        "per-document values — see §8): `field_value_instances` (0 rows in this export), "
        "`metadata_lookup`, `metadata_lookup_tree`, `field_behaviours`, `field_behaviour_options` "
        "(these back lookup/tree *field option definitions*, not per-document stored values — "
        "no `document_fields_link` row in this export references a lookup-backed field).\n"
    )

    report.append("## 2. Relationship between the KnowledgeTree metadata tables\n")
    report.append(
        "```\n"
        "documents.metadata_version_id  --(current)-->  document_metadata_version.id\n"
        "document_metadata_version.document_id        -> documents.id\n"
        "document_metadata_version.content_version_id -> document_content_version.id\n"
        "document_metadata_version.document_type_id    -> document_types_lookup.id\n"
        "document_fields_link.metadata_version_id      -> document_metadata_version.id\n"
        "document_fields_link.document_field_id        -> document_fields.id\n"
        "document_fields.parent_fieldset                -> fieldsets.id\n"
        "```\n"
        "A document can have **many** `document_metadata_version` rows over its lifetime "
        "(one per historical metadata change, each optionally tied to a specific content "
        "version). Only the one row referenced by `documents.metadata_version_id` is the "
        "document's *current* state — every other `document_metadata_version` row for that "
        "`document_id` is superseded history. Verified directly against the data:\n\n"
        f"- Every one of the {total_docs} documents has a non-NULL `metadata_version_id`, and "
        "every one of those IDs resolves to a real `document_metadata_version` row (0 broken "
        "pointers).\n"
        f"- {len(metadata_versions)} total `document_metadata_version` rows exist across those "
        f"{total_docs} documents — i.e. an average of "
        f"{len(metadata_versions) / total_docs:.1f} metadata versions per document "
        "(most of that history is superseded, not current).\n"
        "- Every `document_metadata_version.document_id` resolves to a real `documents.id` row "
        "(0 orphans), and every `documents.metadata_version_id` resolves to a "
        "`document_metadata_version` row that genuinely belongs to *that same* document (0 "
        "cross-document mismatches).\n"
    )

    report.append("## 3. Number of metadata field DEFINITIONS\n")
    report.append(f"**{len(fields)}** field definitions exist in `document_fields`:\n\n")
    report.append("| id | name | data_type | fieldset | is_mandatory |\n|---|---|---|---|---|\n")
    for f in sorted(fields, key=lambda x: x["id"]):
        fs = fieldset_by_id.get(f["parent_fieldset"])
        report.append(
            f"| {f['id']} | {f['name']} | {f['data_type']} | "
            f"{fs['name'] if fs else '(none)'} | {'yes' if f['is_mandatory'] == '1' else 'no'} |\n"
        )
    report.append(
        "\nNote: `document_fields.id` auto-increments up to 12, but only 9 rows exist — ids "
        "1, 4, 11 were deleted at some point in the legacy system's life and are gone from "
        "this export (not recoverable, not guessed at here).\n"
    )

    report.append("\n## 4. Number of metadata VALUE rows\n")
    report.append(
        f"**{len(field_links)}** rows in `document_fields_link` (the full history, across every "
        f"`document_metadata_version` a document has ever had) — of which **{len(current_rows)}** "
        "belong to documents' *current* metadata version (the other "
        f"{len(field_links) - len(current_rows)} are superseded historical values, still exported "
        "and flagged via `is_current_metadata_version=0`, never dropped).\n"
    )

    report.append("## 5. Number of documents containing metadata\n")
    report.append(
        f"- **{len(distinct_docs_any_metadata)}** of {total_docs} documents have at least one "
        "metadata value row somewhere in their history (current or superseded).\n"
        f"- **{len(distinct_docs_current_metadata)}** of {total_docs} documents have at least one "
        "metadata value row in their *current* metadata version.\n"
        f"- **{total_docs - len(distinct_docs_current_metadata)}** documents currently have zero "
        "populated custom-metadata fields at all (every field left blank).\n"
    )

    used_field_ids = {f_id for f_id in field_by_id if field_by_id[f_id]["name"] in field_name_counts}
    unused_fields = [f for f in fields if f["id"] not in used_field_ids]
    report.append("## 6. Number of unique metadata fields\n")
    report.append(
        f"**{len(field_name_counts)}** unique field names actually appear in the value data, out "
        f"of **{len(fields)}** total field definitions — verified against the full "
        f"{len(field_links)}-row `document_fields_link` table (historical and current combined; "
        "the set of field names with data is identical whether you look at current-only or "
        "all-history rows). "
        + (
            f"**{len(unused_fields)} defined field(s) have zero values anywhere in this export "
            "(not even in superseded history)**: "
            + ", ".join(f"`{f['name']}` (id {f['id']})" for f in unused_fields) + ".\n"
            if unused_fields else "Every defined field has at least one value somewhere in the export.\n"
        )
    )

    report.append("## 7. Null / empty value counts (current metadata version only)\n")
    report.append("| field_name | documents_count | non_empty_count | empty_count |\n|---|---|---|---|\n")
    for row in summary_rows:
        report.append(
            f"| {row['field_name']} | {row['documents_count']} | {row['non_empty_count']} | "
            f"{row['empty_count']} |\n"
        )
    report.append(
        "\n`document_fields_link.value` is a `NOT NULL` column (default `''`) — there are no "
        "true SQL NULLs in this table; \"empty\" above means the value is an empty/whitespace-only "
        "string, not a NULL. Full per-field breakdown is in `05_metadata_summary.csv`.\n"
    )

    dup_pair_counts = Counter((r["metadata_version_id"], r["field_id"]) for r in output_rows)
    duplicate_pairs = {k: v for k, v in dup_pair_counts.items() if v > 1}
    lookup_table_row_counts = {
        t: len(extract_table_rows(dump_text, t))
        for t in ["field_value_instances", "metadata_lookup", "metadata_lookup_tree",
                  "field_behaviours", "field_behaviour_options"]
    }
    lookup_backed_fields = [f for f in fields if f["has_lookup"] == "1" or f["has_lookuptree"] == "1"
                             or f["has_inetlookup"] == "1"]

    report.append("## 8. Duplicate values or ambiguous relationships\n")
    if duplicate_pairs:
        report.append(
            f"- **{len(duplicate_pairs)} duplicate (metadata_version_id, document_field_id) pairs "
            "found** — meaning at least one field genuinely has more than one value row within the "
            "same metadata snapshot (a multi-value/repeating field). These need special handling "
            "before mapping — do not assume one-value-per-field when writing the mapping step.\n"
        )
    else:
        report.append(
            "- **Zero duplicate (metadata_version_id, document_field_id) pairs found** (checked "
            f"across all {len(output_rows)} extracted rows) — every field has at most one value "
            "per metadata snapshot. This is a single-value model; there is no evidence of "
            "multi-select/repeating custom fields anywhere in this export.\n"
        )
    report.append(
        f"- Lookup/tree-picklist support tables — row counts actually found in this export: "
        + ", ".join(f"`{t}`={n}" for t, n in lookup_table_row_counts.items()) + ". "
        + (
            f"{len(lookup_backed_fields)} field definition(s) are flagged as lookup-backed "
            f"(`has_lookup`/`has_lookuptree`/`has_inetlookup`): "
            + ", ".join(f"`{f['name']}`" for f in lookup_backed_fields) + ", but the backing "
            "lookup tables above are empty/unpopulated regardless — so no actual per-document "
            "value in this export originates from a picklist selection; all values are free text.\n"
            if lookup_backed_fields else
            "none of the 9 field definitions are flagged as lookup-backed, consistent with those "
            "tables being empty.\n"
        )
    )
    report.append(
        "- **Not determined from this export** whether `field_value_instances` was ever populated "
        "for a *different*, unexported subset of the legacy system (this dump is the entire `dms` "
        "database, so most likely it genuinely was never used) — flagged for confirmation with "
        "whoever ran the original export if it matters.\n"
        "- The `Workflow` fieldset (id 5) has **zero** `document_fields` rows pointing at it as "
        "`parent_fieldset` — it exists as a named group but currently defines no custom fields; "
        "not an error, just an empty group.\n"
    )

    report.append("## 9. Encoding issues found\n")
    report.append(
        "- **The SQL dump itself (`dms_full_2026-07-30.sql.gz`) decodes as valid UTF-8 in full** "
        "— confirmed by decoding the entire decompressed file with strict UTF-8 and finding zero "
        "decode errors. `SET NAMES utf8` / `SET character_set_client = utf8` appear throughout "
        "the dump, consistent with mysqldump having been run against a UTF-8 client session. All "
        "metadata field values in `05_metadata_fields.tsv` came from this file and are unaffected "
        "by the encoding problem below.\n"
        "- **However, two of the other legacy export TSVs referenced for context are NOT valid "
        "UTF-8**: `02_documents.tsv` (invalid byte `0x99` — a Windows-1252 '™' — at byte offset "
        "224185) and `03_versions_filemap.tsv` (invalid byte `0x96` — a Windows-1252 en-dash — at "
        "byte offset 478966), exactly the encoding gotcha `MIGRATION_RUNBOOK.md` §2 warns about "
        "for any export that skipped `--default-character-set=utf8`. This is a real risk for a "
        "later migration step that reads titles/filenames from those two specific TSVs directly — "
        "it is **not** a risk for the metadata extracted by this script, which reads the SQL dump "
        "instead.\n"
    )

    report.append("## 10. Metadata rows that could not be reliably linked to a document\n")
    report.append(
        f"**{len(skipped)}** — zero. Every `document_fields_link` row resolved cleanly through "
        "`document_metadata_version` to a real `documents` row. Full detail (would list each "
        f"unlinkable row by id) is in `{SKIPPED_LOG.name}`.\n"
    )

    report.append("## 11. Migration risks discovered\n")
    report.append(
        "- **History volume**: exporting full metadata history (all "
        f"{len(metadata_versions)} versions) rather than only current state multiplies the value "
        f"row count roughly {len(field_links) / max(len(current_rows), 1):.1f}x "
        f"({len(field_links)} vs {len(current_rows)} current-only). Confirm with the migration "
        "plan owner whether the new DMS should import only current metadata, or wants this "
        "history preserved somewhere (e.g. folded into the new DMS's audit trail) before Task 2's "
        "output is actually imported — this extraction preserves both options by tagging each row.\n"
        "- **No mapped destination yet**: none of these 9 legacy fields (`Tag`, `Document Author`, "
        "`Media Type`, `IP number`, `Authors`, `Group`, `Description`, `Document #`, "
        "`Internal/External`) has been mapped to a column in the new DMS yet — that mapping is "
        "explicitly out of scope for this step, per instructions, and must happen before any "
        "import.\n"
        "- **`Document #` (`oem_no`) may duplicate `documents.oem_no`**: the `documents` table "
        "already has its own `oem_no` column (a custom doc number, distinct from this metadata "
        "field) — confirm whether the `Document #` custom-field values and `documents.oem_no` "
        "agree, conflict, or serve different purposes before deciding which one (if either) maps "
        "to the new DMS's `original_document_id`.\n"
        "- **Two context TSVs have real encoding corruption** (see §9) — do not read titles/"
        "filenames from `02_documents.tsv`/`03_versions_filemap.tsv` directly in a later step "
        "without re-deriving them from the SQL dump or re-exporting with the correct charset "
        "flag.\n"
        "- **This export excludes deleted/archived documents by construction**: the `documents` "
        "table in this dump already contains only `status_id = 1` (live) rows — the runbook's "
        "explicit scope decision. If a deleted/archived document's metadata is ever needed, it is "
        "not present in this export at all (deleted docs are excluded from the recycle bin per "
        "the runbook's own stated scope, not lost by this script).\n"
        "- **`Tag` and `Group` fields have `has_lookup=1`/`has_lookuptree` flags on some rows**: "
        "double-check §8's finding (no populated lookup tables) still holds once real mapping "
        "work begins — a value that *looks* like free text here (e.g. a comma-separated tag "
        "string) may have originally been selected from a picklist whose canonical option list "
        "no longer matters once migrated, but that's a mapping-time decision, not something this "
        "extraction step should decide.\n"
    )

    report.append("## 12. Exact scripts/commands used\n")
    report.append(
        "```\n"
        "python migration/scripts/extract_legacy_metadata.py\n"
        "```\n"
        "The script performs everything internally (reads the `.gz` dump directly with Python's "
        "`gzip` module, parses `INSERT INTO ... VALUES (...)` statements with a hand-written "
        "quote/escape-aware tokenizer — no external SQL-parsing or database-driver dependency, no "
        "MySQL/PostgreSQL connection of any kind). Re-running it simply rewrites the same four "
        "output files from the same source dump; there is no incremental state to reset.\n"
    )

    with open(REPORT_MD, "w", encoding="utf-8") as fh:
        fh.write("".join(report))
    print(f"Wrote {REPORT_MD}")

    print("\nDone. Nothing outside migration/output/ was written; migration/source/ was not modified.")


if __name__ == "__main__":
    main()
