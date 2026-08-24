# Implemented Mapping Rules

## Active state

The active file is the content version referenced by the document's current KnowledgeTree metadata snapshot. Numeric version order is not used as a substitute.

| KnowledgeTree | New DMS |
|---|---|
| Authors | Senior-approved Owner |
| Group | Department |
| Document Type | Category |
| Description metadata field | Description |
| Tag | Tags |
| Document # | Original Document ID |

`external document` becomes a null active Original Document ID; the original value remains archived. `Type = FILE` remains the New-DMS entity type and is not replaced by Category.

Owner mapping is value-based across the approved workbooks. `Amr Mossallamy` is normalized to `Amr El Mosallamy`. A normalized author with multiple approved owners is quarantined at document level unless authoritative document-level approval exists. No email or owner was invented.

KnowledgeTree permissions and workflows were not migrated. Historical metadata and files were not inserted into native New-DMS workflow or version history.
