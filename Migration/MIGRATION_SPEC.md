# KnowledgeTree Migration Specification

## Active New DMS
Only the latest state of each legacy document will become active.

- Latest file only
- Latest metadata only

## Metadata Mapping
- Authors -> Owner
- Group -> Department
- Document Type -> Category
- Description -> Description
- Tag -> Tags
- Document # -> Original Document ID (must be verified first)

## Archive
Preserve legacy history separately.

Archive:
- Previous metadata versions
- Previous file versions available in the export
- IP number
- Internal/External

## Do Not Migrate
- Old KnowledgeTree permissions
- Old KnowledgeTree workflow

The New DMS will use its own:
- Workflow
- Versioning
- Permissions

## Storage
- PostgreSQL: document records, metadata, mappings, legacy metadata archive
- MinIO: actual files and archived historical files

## Migration Method
Dedicated migration scripts.
Do not migrate through the application UI.