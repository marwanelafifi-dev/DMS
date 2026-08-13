# DMS Migration Technical Profile

**Purpose:** Read-only technical discovery to support migrating data from a legacy KnowledgeTree CE 3.7.0.2 DMS into this new Enterprise DMS (.NET 8 / React / PostgreSQL / MinIO). No code, configuration, database, or container was modified to produce this document.

**Generated from:** direct inspection of `infra/db/init/*.sql` (all migration files), `api/Models/*.cs`, `api/Data/DmsContext.cs`, `api/Controllers/*.cs`, `api/Services/*.cs`, `docker-compose.yml`, Dockerfiles, `web/nginx.conf`, `api/appsettings.json`, `.env.example`, `CLAUDE.md` session history.

---

## 1. System Architecture

### Components

- **Frontend:** React 18 + TypeScript, built with Vite, served as static files by nginx (`web/Dockerfile`, `web/nginx.conf`). Container `web`, host port `${WEB_PORT:-5173}` → container port 80.
- **Backend/API:** .NET 8 ASP.NET Core Web API (`api/`). Container `api`, host port `${API_PORT:-8080}` → container port 8080. Uses EF Core (Npgsql provider) against PostgreSQL.
- **PostgreSQL:** `postgres:16-alpine`, container `postgres`, host port `${POSTGRES_PORT:-5432}`. Schema/seed data applied from `infra/db/init/*.sql` — **these scripts only auto-run when the Postgres data volume is first created** (documented repeatedly in `CLAUDE.md` as a recurring source of "missing column/table" bugs across sessions). Data volume: named volume `pgdata`.
- **MinIO (S3-compatible object storage):** `minio/minio:latest`, container `minio`, API port `${MINIO_API_PORT:-9000}`, console port `${MINIO_CONSOLE_PORT:-9001}`. Single bucket, name from config `Minio:BucketName` (default `dms-documents`). Data volume: named volume `miniodata`.
- **Redis:** `redis:7-alpine`, container `redis`, host port `${REDIS_PORT:-6379}`. **Provisioned in the stack and wired via a connection-string env var, but no `StackExchange.Redis` (or any Redis client) usage was found anywhere in the C# source.** Hangfire (see below) uses PostgreSQL for its storage, not Redis. Not determined that any live feature actually depends on Redis today.
- **Hangfire (background jobs):** runs inside the `api` container, storage = PostgreSQL (`UsePostgreSqlStorage`). Dashboard mounted at `/hangfire` with a no-op authorization filter (no real auth on the dashboard — dev-only posture).
- **OCR/document-processing service:** Python FastAPI sidecar (`ocr-rag/`), container `ocr-rag`, host port `${OCR_PORT:-8000}`. Uses Docling (`docling` Python package) + LibreOffice (headless, installed in the Dockerfile) for Office→PDF/Markdown conversion, and a local SQLite database (`dms.db`, volume `ocrdata`) for its own parsed-text search index — **architecturally separate from PostgreSQL's `dms_ocr_indexes` table**, which per project history appears to be largely vestigial/unused by the real OCR pipeline in later development sessions.
- **Authentication/identity:** JWT bearer-token sessions issued by the API itself (`JwtTokenService`, HS256), fed by three login paths: local email+password (PBKDF2), Google Identity Services popup flow, and Google Identity Services redirect flow — both Google paths domain-restricted to `@si-ware.com` server-side. See §21 for full detail.
- **Reverse proxy:** nginx inside the `web` container proxies browser-origin `/api/` traffic to the internal `api:8080` service (`location /api/ { proxy_pass http://api:8080; ... client_max_body_size 100M; }`). This is the only reverse-proxy layer in front of the API in normal operation.
- **Cloudflare Tunnel:** an optional `cloudflared` service (`profiles: ["tunnel"]`, inert by default) dials outbound to Cloudflare's edge for the production ("Stage 2 — Ubuntu") deployment path; no inbound ports are published for it. Same `docker-compose.yml` is used unchanged between the Windows-dev and Ubuntu-production paths per `CLAUDE.md`.

### Architecture Diagram

```text
Browser
   |
   v
[nginx : web container, port 5173->80]
   |  proxies /api/* --------------------------+
   |  serves static SPA                         |
   v                                            v
React/TS SPA (client-side)          [.NET 8 API : api container, port 8080]
                                              |
                     +------------------------+------------------------+
                     |                        |                        |
                     v                        v                        v
             [PostgreSQL 16]           [MinIO (S3)]              [Hangfire jobs]
             dms_* tables              dms-documents bucket      (stored in Postgres)
             (schema of record)        (document/attachment/     recurring: auto-unlock
                                         backup/logo bytes)        checkouts, send reminders,
                     ^                                             google calendar sync,
                     |                                             ISO meeting reminders,
                     +----- also queried by ------+                scheduled backup check
                                                   |
                                          [Python FastAPI OCR sidecar]
                                          (ocr-rag container, port 8000)
                                          Docling + LibreOffice + local SQLite (dms.db)
                                          — text extraction / preview conversion,
                                          largely independent of Postgres

[Redis container] — provisioned, connection string wired into API config,
                     but no confirmed code path consumes it.

[cloudflared] — optional, outbound-only tunnel to Cloudflare edge
                (production/"Stage 2" only, profile-gated, not active by default)
```

---

## 2. Database Schema Relevant to Migration

All tables below reflect the **current, final state** after tracing every `CREATE TABLE` and subsequent `ALTER TABLE` across `infra/db/init/001` through `074`. Every table in this schema uses a UUID primary key (via `gen_random_uuid()`) **except** three string-keyed lookup tables (`dms_page_access_roles.role`, `dms_role_permissions.role`, `dms_app_settings.key`). No table uses `SERIAL`/integer identity PKs.

### dms_folders

| Item | Details |
|---|---|
| Table name | `dms_folders` |
| Purpose | Folder hierarchy (the Document Library's directory tree) |
| Primary key | `folder_id` (UUID, default `gen_random_uuid()`) |
| Important columns | `parent_folder_id`, `name`, `description`, `classification` (default `'standard'`), `owner_id`, `metadata_schema` (JSONB), `retention_policy`, `retention_years`, `created_at`, `updated_at` |
| Required columns | `name`, `classification`, `owner_id` (all NOT NULL) |
| Nullable columns | `parent_folder_id` (NULL = root folder), `description`, `metadata_schema`, `retention_policy`, `retention_years` |
| Foreign keys | `parent_folder_id` → `dms_folders(folder_id)` ON DELETE CASCADE (self-referential); `owner_id` → `dms_users(user_id)` (no ON DELETE → RESTRICT) |
| Unique constraints | `(parent_folder_id, name)` — sibling folders can't share a name |
| Important indexes | `idx_dms_folders_parent(parent_folder_id)`, `idx_dms_folders_owner(owner_id)` |
| Default values | `folder_id` = `gen_random_uuid()`; `classification` = `'standard'`; `created_at`/`updated_at` = `now()` |

### dms_documents

| Item | Details |
|---|---|
| Table name | `dms_documents` |
| Purpose | One row per logical document (title/metadata; actual file bytes are on `dms_document_versions`) |
| Primary key | `document_id` (UUID) |
| Important columns | `folder_id`, `title`, `current_version_id`, `tracking_code`, `status` (default `'draft'`), `owner_id`, `category`, `department`, `description`, `tags` (TEXT[], default `'{}'`), `original_document_id` (legacy/external Doc ID field), `created_at`, `updated_at` |
| Required columns | `folder_id`, `title`, `status`, `owner_id` |
| Nullable columns | `current_version_id`, `tracking_code`, `category`, `department`, `description`, `original_document_id` |
| Foreign keys | `folder_id` → `dms_folders(folder_id)`; `owner_id` → `dms_users(user_id)`; `current_version_id` → `dms_document_versions(version_id)` |
| Unique constraints | `tracking_code` (column-level, nullable so multiple NULLs allowed — now effectively dead, see below); `ux_dms_documents_original_document_id` — case-insensitive (`LOWER(...)`), **partial** unique index on `original_document_id` (only enforced when non-null) |
| Important indexes | `idx_dms_documents_folder`, `idx_dms_documents_owner`, `idx_dms_documents_status`, `idx_dms_documents_tracking_code`, `idx_documents_department`, `idx_documents_category` |
| Default values | `status` = `'draft'`; `tags` = `'{}'` |

**Note:** `tracking_code` is a legacy field from an earlier design (per-document release code) that was explicitly removed from the application feature set (Session 26 in `CLAUDE.md`) but the column/unique constraint remain in the schema, always null going forward. `original_document_id` is the field most relevant to preserving a legacy KnowledgeTree document identifier — see §17.

### dms_document_versions

| Item | Details |
|---|---|
| Table name | `dms_document_versions` |
| Purpose | Every uploaded version of a document; the file's actual MinIO location and integrity hash live here |
| Primary key | `version_id` (UUID) |
| Important columns | `document_id`, `version_number`, `version_label`, `file_name`, `file_size_bytes`, `mime_type`, `s3_object_key`, `sha256_hash`, `status` (default `'draft'`), `is_checked_out`, `checked_out_by`, `checked_out_at`, `checkout_reason`, `submitted_by_id`, `submitted_at`, `approved_by_id`, `approved_at`, `approval_comment`, `major_version` (default 1), `minor_version` (default 0), `created_at`, `updated_at` |
| Required columns | `document_id`, `version_number`, `file_name`, `s3_object_key`, `sha256_hash`, `status` |
| Nullable columns | `version_label`, `file_size_bytes`, `mime_type`, checkout/submission/approval fields |
| Foreign keys | `document_id` → `dms_documents(document_id)` ON DELETE CASCADE; `checked_out_by` → `dms_users(user_id)`; `submitted_by_id` → `dms_users(user_id)`; `approved_by_id` → `dms_users(user_id)` |
| Unique constraints | `(document_id, version_number)`. `s3_object_key` was originally UNIQUE but **that constraint was dropped** in a later migration (`049_drop_s3_object_key_unique.sql`) specifically to allow version-revert to legitimately reuse an existing object key across multiple version rows. **Conflict flag:** the C# `DmsContext.cs` model configuration still declares `.HasIndex(dv => dv.S3ObjectKey).IsUnique()` — the EF model metadata was never updated after the SQL constraint was dropped. This is a real, currently-live discrepancy between the C# model and the actual database (harmless at runtime since EF doesn't re-validate constraints against a live DB outside of `dotnet ef migrations`, but would surface if EF Core Migrations were ever adopted against this schema). |
| Important indexes | `idx_dms_document_versions_document`, `idx_dms_document_versions_status`, `idx_dms_document_versions_checkout(is_checked_out, checked_out_by)`, `idx_dms_document_versions_s3_key` |
| Default values | `status` = `'draft'`; `is_checked_out` = `false`; `major_version` = `1`; `minor_version` = `0` |

### dms_users

| Item | Details |
|---|---|
| Table name | `dms_users` |
| Purpose | User accounts (local password and/or Google SSO) |
| Primary key | `user_id` (UUID) |
| Important columns | `email`, `full_name`, `sso_subject`, `password_hash`, `avatar_url`, `role`, `is_active` (default true), `last_login_at`, `last_heartbeat_at` (TIMESTAMPTZ), `mfa_secret` (BYTEA, unused in practice), `created_at`, `updated_at` |
| Required columns | `email`, `full_name` |
| Nullable columns | `sso_subject`, `password_hash` (NULL = SSO-only account), `avatar_url`, `role`, `last_login_at`, `last_heartbeat_at`, `mfa_secret` |
| Foreign keys | `role` → `dms_page_access_roles(role)` ON DELETE SET NULL |
| Unique constraints | `email` |
| Important indexes | `idx_dms_users_email`, `idx_dms_users_sso_subject` |
| Default values | `is_active` = `true` |

### dms_folder_permissions

| Item | Details |
|---|---|
| Table name | `dms_folder_permissions` |
| Purpose | Direct per-user, per-folder role grants (the primary folder-content authorization mechanism) |
| Primary key | `permission_id` (UUID) |
| Important columns | `folder_id`, `user_id`, `role`, `granted_at`, `granted_by_id` |
| Required columns | `folder_id`, `user_id`, `role` |
| Nullable columns | `granted_by_id` |
| Foreign keys | `folder_id` → `dms_folders(folder_id)` ON DELETE CASCADE; `user_id` → `dms_users(user_id)` ON DELETE CASCADE; `granted_by_id` → `dms_users(user_id)` |
| Unique constraints | `(folder_id, user_id)` — one role grant per user per folder |
| Important indexes | `idx_dms_folder_permissions_folder`, `idx_dms_folder_permissions_user` |
| Default values | `granted_at` = `now()` |
| Notes | `role` is CHECK-constrained to exactly `Reader`, `Writer`, `Manager`, `QA`, `Admin` (mirrored in `api/Models/FolderRoles.cs`) |

### dms_access_overrides

| Item | Details |
|---|---|
| Table name | `dms_access_overrides` |
| Purpose | Fine-grained tri-state (Allow/Deny/Inherit) per-user-or-group exceptions layered on top of folder-role grants, scoped to a folder (cascading) or a single document |
| Primary key | `override_id` (UUID, no default — application must supply) |
| Important columns | `folder_id`, `document_id`, `target_type` (`User`/`Group`), `target_id`, plus **25 tri-state boolean action columns**: `read`, `write`, `rename`, `copy`, `cut`, `download_zip`, `create_subfolder`, `"delete"` (folder scope, 8 total); `file_read`, `file_rename`, `file_copy`, `file_cut`, `unlock`, `submit_for_approval`, `download`, `download_for_editing`, `upload_updated_file`, `file_delete`, `file_edit` (file scope, 11 total); `manage_permissions`, `file_manage_permissions`, `view_history`, `view_related_tasks` (shared/cross-scope, 4 total); plus `created_by`, `created_at`, `updated_at` |
| Required columns | `target_type`, `target_id`, `created_by`; exactly one of `folder_id`/`document_id` |
| Nullable columns | `folder_id`, `document_id` (exactly one is null per CHECK), all 25 action booleans (NULL = Inherit) |
| Foreign keys | `folder_id` → `dms_folders(folder_id)` ON DELETE CASCADE; `document_id` → `dms_documents(document_id)` ON DELETE CASCADE; `created_by` → `dms_users(user_id)` |
| Unique constraints | `(folder_id, document_id, target_type, target_id)` |
| CHECK constraints | `target_type IN ('User','Group')`; `chk_access_override_scope`: `(folder_id IS NOT NULL AND document_id IS NULL) OR (folder_id IS NULL AND document_id IS NOT NULL)` |
| Important indexes | `idx_access_overrides_folder`, `idx_access_overrides_document`, `idx_access_overrides_target(target_type, target_id)` |
| Notes | **No FK relationships or unique index are configured on the EF/C# side at all** for this entity — only table/key mapping. All referential integrity for this table is enforced purely at the SQL level. |

### dms_page_access_roles

| Item | Details |
|---|---|
| Table name | `dms_page_access_roles` |
| Purpose | Page/feature-visibility roles (Dashboard/Document Library/Approvals/PCAR/Admin Panel visibility) plus several blanket folder-bypass and capability flags — **decoupled from per-folder content access** except for three explicit bypass-tier flags |
| Primary key | `role` (VARCHAR(50) — string PK, not UUID) |
| Important columns | 26 boolean flags total, including `can_view_dashboard`, `can_view_document_library`, `can_view_reminders`, `can_view_approvals`, `can_view_pcar`, `can_view_admin_panel`, `bypass_folder_permissions` (= full Admin-everywhere bypass), `can_read_all_folders`, `can_read_write_all_folders` (tiered folder-bypass), `can_edit_files`, `can_manage_folder_permissions`, `can_manage_file_permissions`, `can_manage_all_tasks`, `can_create_tasks`, `can_reassign_tasks`, `can_reassign_my_tasks`, `can_view_qa_stage`/`can_view_manager_stage`/`can_view_final_release_stage`, `can_approve`, `can_reject`, `can_resolve_document_id`, `can_send_announcements`, `can_delete_reminders`, `is_built_in`, `updated_at` |
| Required columns | `role` (PK); every boolean flag is NOT NULL with a per-flag default |
| Nullable columns | none |
| Foreign keys | none outward (this table is the FK *target* of `dms_users.role`) |
| Unique constraints | implicit via PK |
| Important indexes | none beyond PK |
| Default values | Most flags default `false`; `can_view_dashboard`/`can_view_document_library`/`can_view_reminders`/`can_view_qa_stage`/`can_view_manager_stage`/`can_view_final_release_stage` default `true` |
| Notes | Seeded with 5 built-in roles: `User`, `Manager`, `Quality`, `Auditor`, `Full Access` (`Full Access` = `bypass_folder_permissions = true`, i.e. true global Admin). |

### dms_role_permissions (legacy/orphaned table)

| Item | Details |
|---|---|
| Table name | `dms_role_permissions` |
| Purpose | An earlier, folder-action-oriented per-role permission model (view/download/upload/update/delete/approve/reject flags), superseded in practice by `dms_page_access_roles` + `dms_access_overrides`, but **not dropped** — still a live `DbSet`/mapped table |
| Primary key | `role` (VARCHAR(50) — string PK) |
| Important columns | `view_only`, `download_read_only`, `admin_force_unlock`, `download_for_editing`, `upload`, `approve`, `reject`, `create_subfolder`, `create_parent_folder`, `add_task`, `delete_parent_folder`, `delete_subfolder`, `delete_file`, `update_file`, `update_folder`, `submit_for_approval`, `updated_at` |
| Notes | `dms_users.role` originally FK'd here, then was explicitly **repointed** to `dms_page_access_roles` in a later migration. This table's own code comment describes it as "a completely orphaned permission table with no editor UI left anywhere in the app." **Treat `dms_page_access_roles` as authoritative for role/permission migration; this table is legacy.** |

### dms_groups / dms_group_members / dms_group_subgroups

| Item | Details |
|---|---|
| Table names | `dms_groups`, `dms_group_members`, `dms_group_subgroups` |
| Purpose | Named user groups (distinct from folder-permission roles), flat membership, and real nested-subgroup support |
| Primary keys | `group_id`, `group_member_id`, `group_subgroup_id` (all UUID) |
| Important columns (`dms_groups`) | `name`, `description`, `created_at`, `updated_at` — uses plain `TIMESTAMP` (no timezone), an inconsistency versus the rest of the schema's `TIMESTAMPTZ` convention, never corrected |
| Important columns (`dms_group_members`) | `group_id`, `user_id`, `added_at` |
| Important columns (`dms_group_subgroups`) | `parent_group_id`, `child_group_id`, `added_at` |
| Foreign keys | member/subgroup tables both CASCADE on `group_id`/`user_id`/`parent_group_id`; `child_group_id` on `dms_group_subgroups` is **RESTRICT** (asymmetric — you can delete a parent and its nesting link cascades away, but you can't delete a group that's nested as someone's child) |
| Unique constraints | `dms_group_members`: `(group_id, user_id)`; `dms_group_subgroups`: `(parent_group_id, child_group_id)` |
| CHECK constraints | `dms_group_subgroups`: `parent_group_id != child_group_id` (no self-nesting; deeper cycle prevention is application-level BFS logic in `GroupsController`, not a DB constraint) |
| Notes | Groups are the migration target for KnowledgeTree's group concept; `dms_group_members` and `dms_group_subgroups` together model both flat and nested legacy group structures. |

### dms_dropdown_items (metadata / tags / categories / departments)

| Item | Details |
|---|---|
| Table name | `dms_dropdown_items` |
| Purpose | Admin-managed lookup lists backing the Category/Department/Tag dropdowns shown at document upload/edit time |
| Primary key | `item_id` (UUID) |
| Important columns | `list_key` (free text — convention values `department`/`category`/`tag`, not DB-enforced), `label`, `sort_order` (default 0), `created_at` |
| Required columns | `list_key`, `label` |
| Foreign keys | none |
| Unique constraints | `(list_key, label)` |
| CHECK constraints | none — `list_key` values are an application convention only, not enforced by the DB |
| Important indexes | `idx_dropdown_items_list_key` |
| Notes | This is **not** a generic custom-metadata/custom-fields system — see §11. It is only a flat picklist backing three fixed fields already hardcoded on `DmsDocument` (`Category`, `Department`, `Tags`). |

### dms_audit_trails

| Item | Details |
|---|---|
| Table name | `dms_audit_trails` |
| Purpose | Immutable (WORM) audit ledger for every logged application action |
| Primary key | `log_id` (UUID) |
| Important columns | `user_id`, `action` (free text, ~70 known constants, see §12), `metadata` (JSONB, structured per-action payload), `created_at` |
| Required columns | `user_id`, `action` |
| Nullable columns | `metadata` |
| Foreign keys | **None declared at the DB level** — `user_id` is a plain UUID column with no `REFERENCES` clause, despite being conceptually a user reference |
| Important indexes | `idx_dms_audit_trails_user`, `idx_dms_audit_trails_action`, `idx_dms_audit_trails_created_at` |
| WORM protection | Yes — a `BEFORE UPDATE OR DELETE` trigger (`trg_worm_audit_trails` / `dms_reject_mutation()`) raises an exception on any attempt to mutate an existing row. **Never reversed** across the entire migration history. |
| Notes | `CreatedAt` is always `DateTime.UtcNow`, set by `AuditService.LogAsync` at insert time — **there is no code path to supply a historical/backdated timestamp**. See §12/§26 for what this means for migrating KnowledgeTree's transaction history. |

### dms_approvals

| Item | Details |
|---|---|
| Table name | `dms_approvals` |
| Purpose | The "batch" a set of documents was originally submitted together as (submitter/creation-time context only — see `dms_approval_documents` for the real, current per-document workflow state) |
| Primary key | `approval_id` (UUID) |
| Important columns | `created_by`, `created_at`, `current_stage` (default `'qa_review'`), `status` (default `'pending'`), `qa_notes`, `manager_notes`, `tracking_code`, `release_notes` |
| Foreign keys | `created_by` → `dms_users(user_id)` ON DELETE RESTRICT |
| Important indexes | `idx_dms_approvals_queue(current_stage, status, created_at DESC)`, `idx_dms_approvals_created_by` |
| Notes | This table's own `current_stage`/`status` columns are now stale/unused in practice — real per-document stage tracking moved to `dms_approval_documents` in a later migration, but the columns here were never dropped. |

### dms_approval_documents

| Item | Details |
|---|---|
| Table name | `dms_approval_documents` |
| Purpose | The real, current per-document C-Doc Workflow state (QA Review → Manager Review → Final Release), one row per document per approval batch |
| Primary key | `approval_document_id` (UUID) |
| Important columns | `approval_id`, `document_id`, `version_id`, `current_stage` (default `'qa_review'`), `status` (default `'pending'`), `qa_notes`, `manager_notes`, `release_notes`, `submission_note`, `created_at`, `updated_at` |
| Required columns | `approval_id`, `document_id`, `version_id` |
| Foreign keys | `approval_id` → `dms_approvals(approval_id)` ON DELETE CASCADE; `document_id` → `dms_documents(document_id)` ON DELETE CASCADE; `version_id` → `dms_document_versions(version_id)` ON DELETE CASCADE |
| Unique constraints | `(approval_id, document_id, version_id)` |
| Important indexes | `idx_dms_approval_documents_approval`, `_document`, `_version` |

### dms_tasks (also serves PCAR / Corrective Action)

| Item | Details |
|---|---|
| Table name | `dms_tasks` |
| Purpose | Generic task/reminder-linked-work-item table, also the backing store for the "PCAR / Corrective Action" feature and correction tasks spawned by C-Doc Workflow rejections |
| Primary key | `task_id` (UUID) |
| Important columns | `workflow_step_id`, `document_id`, `approval_id`, `title`, `description`, `task_type`, `assigned_to_id`, `assigned_to_group_id`, `manager_id`, `risk_severity`, `due_date` (DATE), `status` (default `'open'`, no DB CHECK — values enforced only in app code: `open`/`in_progress`/`submitted`/`completed`/etc.), `rca_text`, `correction_text`, `preventive_actions`, `evidence_url`, `completed_by_id`, `completed_at`, `qa_review_notes`, `qa_reviewed_by_id`, `qa_reviewed_at` |
| Required columns | `title`, `task_type`; exactly one of `assigned_to_id`/`assigned_to_group_id` |
| Foreign keys | `workflow_step_id` → `dms_workflow_steps` ON DELETE SET NULL; `document_id` → `dms_documents` ON DELETE SET NULL; `assigned_to_id`/`manager_id`/`completed_by_id`/`qa_reviewed_by_id` → `dms_users`; `approval_id` → `dms_approvals` ON DELETE SET NULL; `assigned_to_group_id` → `dms_groups` ON DELETE SET NULL |
| CHECK constraints | `dms_tasks_assignee_check`: exactly one of `assigned_to_id`/`assigned_to_group_id` is set |
| Important indexes | `idx_dms_tasks_assigned_to`, `_status`, `_due_date`, `_document` |

### dms_task_attachments

| Item | Details |
|---|---|
| Table name | `dms_task_attachments` |
| Purpose | File attachments on a task/PCAR, stored in MinIO |
| Primary key | `attachment_id` (UUID) |
| Important columns | `task_id`, `file_name`, `file_size_bytes`, `mime_type`, `s3_object_key`, `uploaded_by`, `created_at` |
| Foreign keys | `task_id` → `dms_tasks` ON DELETE CASCADE; `uploaded_by` → `dms_users` |
| Important indexes | `idx_task_attachments_task_id` |

### dms_reminders

| Item | Details |
|---|---|
| Table name | `dms_reminders` |
| Purpose | Scheduled/manual task reminders (in-app and/or email) |
| Primary key | `reminder_id` (UUID) |
| Important columns | `task_id`, `recipient_id`, `reminder_type`, `due_date` (TIMESTAMPTZ), `is_sent` (default false), `sent_at`, `created_at` |
| Foreign keys | `task_id` → `dms_tasks` ON DELETE CASCADE; `recipient_id` → `dms_users` |
| CHECK constraints | `reminder_type IN ('APP','EMAIL','BOTH')` |
| Important indexes | `idx_dms_reminders_recipient`, `_due_date`, `_is_sent` |
| WORM protection | **Added at table creation, then explicitly removed** by a later migration once it was discovered that WORM made reminders permanently un-sendable/un-deletable (this table's `is_sent`/`sent_at`/`due_date` genuinely need to mutate — it is an operational table, not a compliance ledger). The original `due_date DATE` column was also widened to `TIMESTAMPTZ` in the same fix, since `DATE` was silently truncating time-of-day. |
| Notes | `recipient_id` is WORM-relevant in a different sense: per `UsersController`, a user who has ever been a reminder recipient can never be permanently deleted (only deactivated), because `dms_esignatures`/`dms_reminders` are excluded from the "Transfer Ownership" bulk-reassignment mechanism as protected historical records. |

### dms_notifications

| Item | Details |
|---|---|
| Table name | `dms_notifications` |
| Purpose | In-app notification inbox |
| Primary key | `notification_id` (UUID) |
| Important columns | `user_id`, `title`, `body`, `document_id`, `task_id`, `announcement_id`, `is_read` (default false), `created_at` |
| Foreign keys | `user_id` → `dms_users` ON DELETE CASCADE; `document_id` → `dms_documents` ON DELETE SET NULL; `task_id` → `dms_tasks` ON DELETE SET NULL; `announcement_id` → `dms_announcements` ON DELETE CASCADE |
| Important indexes | `idx_notifications_user_id(user_id, created_at DESC)`; partial index `idx_notifications_user_unread(user_id) WHERE is_read = false` |
| Notes | **No FK relationships are configured on the EF/C# side at all** for this entity beyond table/key mapping — same pattern as `dms_access_overrides`. |

### dms_announcements

| Item | Details |
|---|---|
| Table name | `dms_announcements` |
| Purpose | Free-text broadcast announcements with per-message email/in-app delivery flags |
| Primary key | `announcement_id` (UUID) |
| Important columns | `title`, `message`, `posted_by_id`, `notified_email`, `notified_app`, `recipient_count` (default 0), `created_at` |
| Foreign keys | `posted_by_id` → `dms_users(user_id)` **ON DELETE CASCADE** (an outlier — most "posted by"/"created by" FKs elsewhere in this schema use RESTRICT or SET NULL) |
| Important indexes | `idx_announcements_created_at(created_at DESC)` |

### dms_app_settings

| Item | Details |
|---|---|
| Table name | `dms_app_settings` |
| Purpose | Generic key/value application settings store (currently only one seeded key: `sync_calendar_on_login`) |
| Primary key | `key` (VARCHAR(100) — string PK) |
| Important columns | `value` (TEXT), `updated_at`, `updated_by_id` |
| Foreign keys | `updated_by_id` → `dms_users(user_id)` ON DELETE SET NULL |

### dms_esignatures

| Item | Details |
|---|---|
| Table name | `dms_esignatures` |
| Purpose | Digital signature ledger for document versions |
| Primary key | `signature_id` (UUID) |
| Important columns | `version_id`, `user_id`, `signature_hash`, `signature_meta` (JSONB), `created_at` |
| Foreign keys | `version_id` → `dms_document_versions` ON DELETE CASCADE; `user_id` → `dms_users` |
| WORM protection | Yes, never reversed |
| Notes | Per `CLAUDE.md`, the frontend component that would consume this table (`ESignaturePanel.tsx`) was deleted as dead code — **no backend controller/service exists that writes to this table**. The table and its WORM trigger remain in the schema, unused in practice. Not a realistic migration target for KnowledgeTree signature data unless a consuming feature is built first. |

### dms_ocr_indexes

| Item | Details |
|---|---|
| Table name | `dms_ocr_indexes` |
| Purpose | Intended full-text OCR index (Postgres `tsvector` GIN index over extracted text) |
| Primary key | `ocr_id` (UUID) |
| Important columns | `version_id`, `extracted_text`, `page_count`, `created_at` |
| Foreign keys | `version_id` → `dms_document_versions` ON DELETE CASCADE |
| Important indexes | GIN full-text index on `to_tsvector('english', extracted_text)` |
| WORM protection | Yes, never reversed |
| Notes | Per project history, real OCR/Docling text search in later sessions runs through a **separate SQLite store inside the `ocr-rag` Python sidecar**, not through this Postgres table. Not confirmed to be actively written to by current application code — verify before treating as an OCR migration target. |

### Not found / not applicable

- **Comments** on documents/folders: `Not determined from current codebase` — no comments table or comment field was found on `DmsDocument`/`DmsFolder`.
- **Workflows** (`dms_workflow_templates`, `dms_workflows`, `dms_workflow_steps`): exist in the schema (created in `002_core_schema.sql`, FK-configured in EF) but per project history the real C-Doc Workflow and PCAR features are driven directly through `dms_approvals`/`dms_approval_documents`/`dms_tasks`, not through this generic workflow-engine scaffolding. **Not determined from current codebase whether `DmsWorkflow*` is still live or vestigial** — flagged for verification before relying on it for migration.
- **Deleted/archive/recycle-bin state:** no soft-delete/`is_deleted`/`deleted_at` column exists on `dms_documents` or `dms_folders`. Delete is a real, permanent DB delete (or blocked outright for a non-empty folder). Document *status* (`draft`/`pending_approval`/etc.) is a workflow state, not a trash/archive state. There is no recycle bin.
- **Document metadata (generic custom fields):** `dms_document_metadata` exists (`metadata_id`, `version_id`, `custom_data` as a plain string column, `created_at`) but is a single freeform text blob per version, not a structured field-definition/field-value system — see §11 for why this does not meet a "custom metadata" bar.

---

## 3. Entity Relationships

```text
dms_users
  ├── owns ──────────────► dms_folders (owner_id)
  ├── owns ──────────────► dms_documents (owner_id)
  ├── granted-role-on ───► dms_folder_permissions ──► dms_folders  (many-to-many via join table)
  ├── target-of ─────────► dms_access_overrides (target_id, when target_type='User')
  ├── member-of ─────────► dms_group_members ──► dms_groups        (many-to-many via join table)
  ├── has-role ──────────► dms_page_access_roles (dms_users.role, many-to-one)
  ├── actor-in ──────────► dms_audit_trails (user_id, one-to-many, immutable)
  ├── assigned/manages ──► dms_tasks (assigned_to_id / manager_id / completed_by_id, one-to-many)
  └── signs ─────────────► dms_esignatures (user_id, one-to-many; feature currently unused)

dms_folders
  ├── parent_folder_id ──► dms_folders (self-referential, one-to-many, CASCADE)
  ├── contains ──────────► dms_documents (folder_id, one-to-many)
  ├── scoped-by ─────────► dms_folder_permissions (folder_id, one-to-many)
  └── scoped-by ─────────► dms_access_overrides (folder_id, one-to-many, cascades to descendant
                            folders/documents via app-level ancestor-chain walk, not a DB FK)

dms_documents
  ├── belongs-to ────────► dms_folders (folder_id, many-to-one)
  ├── has ───────────────► dms_document_versions (document_id, one-to-many, CASCADE)
  ├── points-at-current ─► dms_document_versions (current_version_id, one-to-one "pointer", SET NULL)
  ├── scoped-by ─────────► dms_access_overrides (document_id, one-to-many)
  ├── referenced-by ─────► dms_approval_documents (document_id, one-to-many across approval cycles)
  ├── referenced-by ─────► dms_tasks (document_id, one-to-many, SET NULL on delete)
  └── referenced-by ─────► dms_notifications (document_id, one-to-many, SET NULL on delete)

dms_document_versions
  ├── belongs-to ────────► dms_documents (document_id, many-to-one, CASCADE)
  ├── stored-as ─────────► MinIO object (s3_object_key — NOT an FK, a plain string pointer into
  │                         the "dms-documents" bucket; no DB-level referential integrity to MinIO)
  ├── has ───────────────► dms_document_metadata (version_id, one-to-many; freeform text blob)
  ├── signed-by ─────────► dms_esignatures (version_id, one-to-many; feature unused)
  ├── extracted-into ────► dms_ocr_indexes (version_id, one-to-many; likely vestigial)
  └── referenced-by ─────► dms_approval_documents (version_id, snapshot of "which version was
                            under review", one-to-many)

dms_approvals  (the submission "batch")
  └── has ───────────────► dms_approval_documents (approval_id, one-to-many, CASCADE)
                              — each row = one document's real current workflow stage/status

dms_tasks (PCAR / correction tasks)
  ├── assigned-to-one-of ► dms_users (assigned_to_id)  XOR  dms_groups (assigned_to_group_id)
  ├── linked-to ─────────► dms_documents (document_id, optional)
  ├── linked-to ─────────► dms_approvals (approval_id, optional — real Document Workflow rejection)
  └── has ───────────────► dms_task_attachments (task_id, one-to-many, CASCADE)

dms_groups
  ├── has-members ───────► dms_group_members ──► dms_users (many-to-many via join table)
  └── nests ─────────────► dms_group_subgroups (parent_group_id / child_group_id,
                            self-referential many-to-many, app-level cycle guard beyond
                            direct self-nesting)
```

**Cardinality summary:**
- Folder → Documents: one-to-many.
- Document → Versions: one-to-many.
- Version → MinIO object: one-to-one in practice (each version row points at exactly one object key), but **not enforced by any FK** — it is a plain string, and after the `049` migration, two version rows *can* legitimately point at the same object key (revert scenario).
- User ↔ Folder (permission grant): many-to-many via `dms_folder_permissions`, with a `role` attribute on the join row (so effectively a many-to-many-with-attributes, not a pure junction table).
- User ↔ Group: many-to-many via `dms_group_members`.
- Group ↔ Group (nesting): many-to-many via `dms_group_subgroups` (self-referential).
- User/Group → Access Override: one-to-many (a single override row targets exactly one user or one group, scoped to exactly one folder or one document).
- Approval (batch) → Approval Documents: one-to-many.

---

## 4. Folder Model

- **Table/entity:** `dms_folders` / `DmsFolder` (`api/Models/DmsFolder.cs`).
- **Parent-child relationship:** `parent_folder_id` self-referencing FK, ON DELETE CASCADE (deleting a folder deletes its entire subtree). No `path`/materialized-path column — the tree is reconstructed at read time by walking `parent_folder_id` (`AccessOverrideService`'s ancestor-chain walker is the clearest example, cycle-guarded at 50 hops).
- **Root folders:** any folder with `parent_folder_id IS NULL`.
- **Full path handling:** `Not determined from current codebase` — no stored/denormalized path field exists; the frontend/backend reconstruct hierarchy by ID relationships, not by string path.
- **Duplicate folder-name handling:** DB-enforced — `UNIQUE(parent_folder_id, name)`. Two sibling folders (same parent, or both at root with `parent_folder_id IS NULL` — note Postgres treats multiple NULLs as distinct for a plain unique constraint, so *multiple root folders with the same name are NOT blocked by this constraint*, only same-name siblings under the *same* non-null parent are).
- **Folder ownership:** `owner_id`, required, FK to `dms_users`. `POST /api/folders` requires `OwnerId` to equal the calling user (you cannot create a folder and assign someone else as owner via the API) and automatically grants the creator an `Admin` `dms_folder_permissions` row in the same transaction.
- **Folder permissions:** via `dms_folder_permissions` (direct role grants: Reader/Writer/Manager/QA/Admin) plus `dms_access_overrides` (tri-state Allow/Deny exceptions, cascading to descendants) plus three role-wide bypass flags on `dms_page_access_roles` (`bypass_folder_permissions` = full Admin everywhere; `can_read_all_folders`/`can_read_write_all_folders` = automatic Reader/Writer-tier visibility on every folder with no per-folder grant needed).
- **Soft delete:** none — `DELETE /api/folders/{id}` is a real delete, and it is **rejected outright if the folder still contains any documents** (no cascading document-delete-then-folder-delete convenience path found in the controller).
- **Creation/modified dates:** `created_at`/`updated_at`, both `TIMESTAMPTZ NOT NULL DEFAULT now()`. Not confirmed whether the API accepts an explicit override of either at creation time — the `CreateFolderRequest` DTO does not expose `CreatedAt` as a settable field, so a migration script using the REST API cannot set a historical creation date this way (see §18/§21 for the direct-DB alternative).
- **Explicit folder IDs during migration:** `folder_id` has a DB default (`gen_random_uuid()`) but is a plain `UUID` column with no other constraint forcing server-generation — a direct SQL `INSERT` can supply any UUID (including one derived deterministically from a legacy KnowledgeTree folder ID, if desired). The REST API's `CreateFolderRequest` DTO does **not** expose `FolderId` as a settable field, so folder IDs cannot be explicitly chosen through the API — only via direct DB insert or a new service-layer method.
- **Must folders be created through API/services?** Not strictly — there is no application-level invariant enforced exclusively in C# that a raw SQL insert would violate for `dms_folders` itself (unlike, say, `dms_tasks`' assignee CHECK constraint, which SQL would also enforce). The one meaningful side effect the API performs beyond the raw insert is auto-granting the creator an Admin `dms_folder_permissions` row — a direct-SQL approach would need to replicate that grant manually if the imported folder owner should have working access to it.

**Recreating a legacy folder tree programmatically:** insert root folders first (`parent_folder_id = NULL`), then children level-by-level (or in dependency order via a topological sort of the legacy tree), preserving a `legacy_folder_id → new_folder_id` mapping (see §17) since the new DMS's `folder_id` is a fresh UUID with no field reserved for the legacy ID. Grant the intended owner an `Admin` `dms_folder_permissions` row per folder as a separate step if not going through the API.

---

## 5. Document Model

- **Table/entity:** `dms_documents` / `DmsDocument` (`api/Models/DmsDocument.cs`).
- **Document ID:** `document_id`, UUID, server/DB-generated by default; not exposed as settable in `CreateDocumentRequest`.
- **Document number/reference number:** `original_document_id` (string, nullable, case-insensitive-unique when set) — this is the field intended for an external/legacy document identifier (e.g., a KnowledgeTree doc number). Also `tracking_code` exists as a column but the feature that populated it was removed; treat as dead.
- **Filename:** lives on `dms_document_versions.file_name`, not on `dms_documents` itself (a document has no filename of its own — only its versions do).
- **Display name/title:** `title`, required.
- **Description:** `description`, **required at creation** (server-side enforced, see quoted validation in §13).
- **Folder ID:** `folder_id`, required.
- **Owner:** `owner_id`, required; must be an active user.
- **Created/modified date:** `created_at`/`updated_at`, `TIMESTAMPTZ`, not exposed as settable via `CreateDocumentRequest`.
- **Document status:** `status`, string, default `'draft'`; no DB CHECK constraint — application-defined values include `draft`, `pending_approval`, `qa_review`, `manager_review`, `correction_in_progress`, `qa_final_review`, `released`. No DB enum enforcing this list.
- **MIME type:** lives on `dms_document_versions.mime_type`, not on `dms_documents`.
- **Size:** lives on `dms_document_versions.file_size_bytes`, not on `dms_documents`.
- **Document type/category:** `category` (nullable, sourced from `dms_dropdown_items` list `category`).
- **Tags:** `tags`, `TEXT[]`, default `'{}'` (a real Postgres array column, not a join table).
- **Metadata:** no generic structured metadata on `dms_documents` itself — see §11.
- **Soft-delete/archive state:** none — no `is_deleted`/`archived_at` column; delete is permanent.
- **Department:** `department` (nullable, sourced from `dms_dropdown_items` list `department`).

**Mandatory fields when creating a document (server-enforced, quoted from `DocumentsController.CreateDocument`):**
```csharp
if (string.IsNullOrWhiteSpace(req.Title))
    return BadRequest(new { success = false, error = "Document title is required" });
if (string.IsNullOrWhiteSpace(req.Description))
    return BadRequest(new { success = false, error = "Description is required" });
if (string.IsNullOrWhiteSpace(req.Category))
    return BadRequest(new { success = false, error = "Category is required" });
if (string.IsNullOrWhiteSpace(req.Department))
    return BadRequest(new { success = false, error = "Department is required" });
```
**Title, Description, Category, and Department are all mandatory.** `FolderId` and `OwnerId` must reference existing rows (folder must exist; owner must be an existing, active user). `Tags` and `OriginalDocumentId` are optional (`OriginalDocumentId` can only be set at creation time by a true folder-Admin caller). This means a migration script using this endpoint must supply (or synthesize) a Category and Department value for every legacy document, even if KnowledgeTree had no equivalent concept for a given document — likely via a fallback "Uncategorized"/"Unassigned" dropdown item created ahead of the import (see §11/§26).

---

## 6. Document Versioning

- **Table/entity:** `dms_document_versions` / `DmsDocumentVersion`.
- **Relation to document:** many-to-one, `document_id` FK, ON DELETE CASCADE.
- **Major/minor version representation:** `major_version` (int, default 1) and `minor_version` (int, default 0) are tracked as separate integer columns; `version_number` (string, e.g. `"1.0"`) is the human-readable combined label actually used for uniqueness (`UNIQUE(document_id, version_number)`). A free-text `version_label` (e.g. `"Rev A"`, `"V2 (Restored from v1.0)"`) is a *separate*, purely descriptive field with no uniqueness constraint — this is the field a user types at upload time, distinct from the auto-incremented `version_number`.
- **Current/latest version logic:** `dms_documents.current_version_id` is an explicit pointer column — "latest" is not inferred from `MAX(version_number)` or `MAX(created_at)`, it is whatever this pointer currently references. A version upload bumps `major_version` and repoints this pointer; a version revert creates a **new** version row (reusing the old object key) and repoints the pointer at that new row, rather than "rewinding" the pointer to the old row directly.
- **Version numbering rules:** major version increments on new-file uploads (each `UploadVersion` call bumps `major_version`); minor version defaults to 0 and its precise increment rule is `Not determined from current codebase` beyond the default.
- **Version filename:** `file_name`, independent per version (a version's filename can differ from other versions of the same document, and can be renamed later via `PUT /api/documents/{id}` with a `FileName` field, validated against a forbidden-character set `/ \ : * ? " < > |`).
- **MIME type / file size:** `mime_type` (browser-supplied `Content-Type`, no server-side validation/allowlist), `file_size_bytes` (from the uploaded stream's length, no server-enforced maximum found anywhere in the codebase).
- **Checksum/hash:** `sha256_hash`, computed server-side via `SHA256.Create()` over the uploaded stream at upload time — always present for every version, this is a real, populated field.
- **Created date/created by:** `created_at` (TIMESTAMPTZ). "Created by" is represented indirectly via `submitted_by_id` (who submitted it for approval) rather than a dedicated "uploaded by"/"author" column on the version itself — `Not determined from current codebase` that there is a direct "uploaded_by" field distinct from the submission workflow fields; this is a real gap to flag for preserving legacy version authorship (see §26).
- **Comments:** `checkout_reason` and `approval_comment` exist as narrow, purpose-specific text fields, not a general "version comment" field.
- **Version status:** `status`, default `'draft'`, no DB CHECK, application-defined (`draft`/`pending_approval`/etc., mirroring document status).
- **Importing historical versions / preserving historical timestamps / preserving historical authors:**
  - Via the **REST API** (`POST /api/documents/{id}/upload`): `created_at`/`updated_at` are always `DateTime.UtcNow` at insert time in the controller — **not settable by the caller**. `submitted_by_id` is derived from the authenticated caller's own user ID (`GetCurrentUserId()`), not an arbitrary "author" parameter — so uploading "as" a different historical author through this endpoint is not directly supported without impersonation (logging in as that user, or a new service-layer parameter).
  - Via **direct SQL insert**: every timestamp and every FK (including `submitted_by_id`) is a plain column with no trigger blocking an arbitrary value — a migration script inserting directly into `dms_document_versions` **can** set `created_at`/`updated_at`/`submitted_at`/`approved_at` to real historical KnowledgeTree dates, and `submitted_by_id`/`approved_by_id` to the correct legacy-mapped user IDs, as long as those users already exist in `dms_users`. This is the only way to faithfully preserve historical version authorship and timestamps.

**Importing a document with v1.0 → v1.1 → v2.0 → v2.1 without losing history:** insert one `dms_documents` row, then four `dms_document_versions` rows (one per historical version) each with its own `version_number`/`version_label`/`file_name`/`s3_object_key`/`sha256_hash`/`created_at` (set to the real historical date if inserting directly into SQL) and its own uploaded object in MinIO under a chosen key scheme (see §7), finally setting `dms_documents.current_version_id` to point at the v2.1 row. Going through the REST API's version-upload endpoint sequentially would instead stamp every version with "now" and the *migration script's own* authenticated identity as `submitted_by_id` — acceptable if historical fidelity isn't required, but a real loss of information if it is.

---

## 7. MinIO / Object Storage

- **Bucket name:** single bucket, name from config key `Minio:BucketName`, default `"dms-documents"` (confirmed in both `appsettings.json` and `MinioService.cs`'s fallback). Auto-created on API startup if missing (idempotent check-then-create).
- **Object naming convention (found in `DocumentsController.cs`, not in `MinioService` itself — `MinioService` is a dumb key→bytes store with no naming logic of its own):**
  - New document version: `documents/{documentId}/{versionId}/{originalFileName}` — both `documentId` and `versionId` are UUIDs; the **original filename is preserved verbatim** as the final path segment (not hashed/renamed).
  - Task attachments: `tasks/{taskId}/{attachmentId}/{fileName}`.
  - Scheduled/manual DB backups: `backups/scheduled/{fileName}`.
  - Branding logos: an application-chosen key stored on a settings row, not a fixed pattern.
  - There is **no folder-path-based prefix** — object keys are keyed by document/task GUID, not by the folder tree location, so moving a document between folders never requires renaming/moving its MinIO object.
- **Whether object names use GUIDs, IDs, hashes, or filenames:** GUID-prefixed path with the literal original filename as the last segment (a hybrid — collision-proof directory structure via GUIDs, human-readable filename at the leaf).
- **How PostgreSQL references MinIO objects:** `dms_document_versions.s3_object_key` (plain string column, **no FK/referential integrity to MinIO** — Postgres has no way to know if the object actually exists) and `dms_task_attachments.s3_object_key` similarly.
- **Upload process (`MinioService.UploadAsync`):** the incoming stream is first written to a local temp file (`Path.GetTempPath()`), then uploaded from disk via MinIO's `PutObjectArgs.WithFileName(tempPath)` (not a direct streamed PUT), with the temp file deleted in a `finally` block regardless of outcome.
- **Download process (`MinioService.DownloadAsync`):** the entire object is buffered into an in-memory `MemoryStream` before being returned — not a true streaming pass-through. This has memory implications for very large files during a bulk migration/export.
- **Delete process:** simple `RemoveObjectArgs` call, no versioning/soft-delete at the MinIO layer.
- **Version storage:** each `dms_document_versions` row has its own independent object key (except after a revert, where two rows can share one key — see §6). MinIO itself is not configured with object versioning; the "versions" concept is entirely modeled in Postgres, with MinIO just holding flat, independently-keyed blobs.
- **MIME handling:** `file.ContentType` (whatever the browser/HTTP client sent) is stored as-is and passed through to MinIO's `PutObjectArgs.WithContentType`, with `"application/octet-stream"` as the fallback if nothing was supplied. No server-side validation, sniffing, or allowlist.
- **Hash/checksum handling:** SHA-256 is computed by the *caller* (`DocumentsController`), not by `MinioService` — the stream is hashed first, reset to position 0, then handed to `MinioService.UploadAsync`.
- **Maximum file-size restrictions:** `Not determined from current codebase` — no `[RequestFormLimits]`, `FormOptions.MultipartBodyLengthLimit`, or `MaxRequestBodySize` attribute exists anywhere in `api/`. The only size ceiling found anywhere in the stack is nginx's `client_max_body_size 100M` on the `/api/` proxy location — meaning any upload over 100 MB going through the normal browser/nginx path would be rejected by nginx before it ever reaches the API, but a migration script talking to the API container directly (bypassing nginx, e.g. hitting `api:8080` inside the Docker network) would not hit that particular 100 MB ceiling.
- **Is uploading directly to MinIO (bypassing the API) safe?** Not recommended as the primary strategy, but technically possible with care: MinIO itself has no knowledge of Postgres, so nothing would stop writing an object directly — the risk is entirely on the Postgres side: if a `dms_document_versions` row referencing that object key isn't created (with a matching `sha256_hash`, `file_size_bytes`, etc.), the object is orphaned and invisible to the application. Direct-to-MinIO upload is safe *only* if immediately paired with a correct, matching direct-SQL insert into `dms_document_versions` (and `dms_documents.current_version_id` update) in the same logical transaction/script step.
- **Does the application require DB records to be created before/after MinIO upload?** The real controller flow is: **DB document row created first** (or already exists) → **file uploaded to MinIO** → **DB version row created, pointing at the just-uploaded object key** → **`dms_documents.current_version_id` updated to point at the new version**. There is no compensating/rollback logic found if the MinIO upload succeeds but the subsequent DB insert fails (or vice versa) — no distributed-transaction/saga pattern, no idempotency key. See §20 for failure-handling implications.

**Recommended sequence for importing a file (based on real application logic):**
```text
1. Ensure the target dms_documents row exists (create it if this is the first version).
2. Generate/decide the object key: documents/{documentId}/{versionId}/{fileName}
   (documentId and versionId can be pre-generated GUIDs if importing directly into SQL).
3. Compute SHA-256 of the file content.
4. Upload the file bytes to MinIO under that object key (bucket "dms-documents" / configured name).
5. Insert the dms_document_versions row (version_number, version_label, file_name,
   file_size_bytes, mime_type, s3_object_key, sha256_hash, status, created_at, ...).
6. Update dms_documents.current_version_id to point at the new version (if it should become
   the current/latest version).
```

---

## 8. User Model

- **Table/entity:** `dms_users` / `DmsUser`.
- **Username:** there is no separate "username" field — **email doubles as the login identifier** for local accounts.
- **Email:** `email`, required, globally unique (case-normalized to lowercase in application code, e.g. `req.Email.ToLower()` in the uniqueness check).
- **Display name:** `full_name`, required.
- **External/AD identity:** `sso_subject` (nullable string) — populated for Google SSO accounts (the Google `sub` claim), not an AD/LDAP identity; there is no LDAP/AD integration anywhere in this codebase.
- **Local user vs external user:** determined by whether `password_hash` is set (local, or local+SSO hybrid) vs. `password_hash IS NULL` (SSO-only). The frontend's `authType` field surfaces this distinction (`"Local"` vs `"Google"`), computed at query time, not stored as its own column.
- **Active/disabled state:** `is_active`, boolean, default `true`. Deactivation ("soft delete") sets this to `false`; a truly permanent delete is a separate hard-delete endpoint, blocked by FK constraints (`409`) if the user still owns live documents/tasks/etc. (with a "Transfer Ownership" bulk-reassignment endpoint offered as a remedy — see §17/§26 for its exclusions).
- **User ID type:** `Guid`/`UUID`, server-generated (`gen_random_uuid()` default), not exposed as settable via `CreateUserRequest`.
- **Creation rules (server-enforced, quoted):**
```csharp
if (string.IsNullOrWhiteSpace(req.Email)) return BadRequest(... "Email is required");
if (string.IsNullOrWhiteSpace(req.FullName)) return BadRequest(... "Full name is required");
if (await context.Users.AnyAsync(u => u.Email == req.Email.ToLower())) return BadRequest(... "already exists");
```
  `Email` and `FullName` are mandatory; `Password` and `SsoSubject` are optional (`Password` omitted or empty → SSO-only account, `PasswordHash = null`). **If a password is supplied at creation, a welcome email containing the plaintext password is sent** (best-effort, non-blocking) — a migration script creating many users with generated passwords should be aware this will fire an email per user if SMTP is configured, unless bypassed via a different code path (e.g. direct SQL insert).

**Can legacy KnowledgeTree users be created/imported programmatically?** Yes, via `POST /api/users` for each user (Email + FullName required, optional Password), or via direct SQL insert (preserving `created_at` and, if desired, a deterministic `user_id`). Neither path has a dedicated field for a legacy user ID — see §17 for the mapping-table recommendation. No global "role" is required at creation (`role` defaults NULL = no page-access role assigned, meaning **zero folder access anywhere** until a role and/or folder grants are assigned afterward — this is an explicit two-step process, not automatic).

---

## 9. Groups, Roles and Membership

The actual model in this codebase does **not** match a classic `User → Group → Role → Permission` chain. Instead there are **three independent systems**:

1. **`dms_page_access_roles`** — a single, mutually-exclusive **global role** per user (`dms_users.role`), controlling which *pages/features* are visible (Dashboard, Document Library, Approvals, PCAR, Admin Panel) plus several blanket capability/bypass flags (see §2). This is **not** folder-content access except for three specific bypass flags.
2. **`dms_folder_permissions`** — direct, per-user, per-folder role grants (Reader/Writer/Manager/QA/Admin), the primary mechanism for *content* access. **Not** tied to `dms_page_access_roles` at all — a user's global role and their folder-level role are two completely separate values that can disagree (e.g. global role `"User"` with page-visibility-only rights, but a direct `Admin` grant on one specific folder).
3. **`dms_groups`/`dms_group_members`/`dms_group_subgroups`** — named groups (with real nested-subgroup support and app-level cycle prevention), used as: (a) an alternate task-assignee type (`dms_tasks.assigned_to_group_id`, letting any group member act on a shared task), and (b) an alternate `target_type` for `dms_access_overrides` (an override can target a whole group instead of one user). **Groups do not themselves carry folder permissions directly** — there is no `dms_group_folder_permissions` table; `dms_folder_permissions.user_id` is always an individual user, not a group. Group-based folder access is achieved only indirectly through group-scoped `dms_access_overrides` rows layered on top of whatever individual grants exist.

**How it actually works, restated:**
```text
User -> (global) Page Access Role  -----> controls which pages/nav items are visible,
                                           plus a few "bypass everything" / "read-only
                                           everywhere" / "read-write everywhere" flags

User -> (per-folder) Folder Permission role (Reader/Writer/Manager/QA/Admin)
                                        -----> controls actual folder/document actions
                                               for that specific folder

User/Group -> Access Override (tri-state Allow/Deny/Inherit, 25 distinct actions,
              scoped to one folder [cascading] or one document)
                                        -----> fine-grained exceptions layered on top of
                                               whichever of the above two baselines applies;
                                               explicit Deny always wins, direct-user
                                               overrides always beat group overrides

User -> Group (flat membership) -> (optionally) Group -> Group (nesting)
                                        -----> used for: shared task assignment,
                                               group-targeted access overrides
```

No "Department" table/relation was found linking users to organizational units — `department` exists only as a free-text field on `dms_documents` (sourced from the `dms_dropdown_items` picklist), not as a user attribute or a real organizational entity.

---

## 10. Permission Model

### Permission types (action names) found in the codebase

**Folder-scope override actions (8):** `Read`, `Write`, `Rename`, `Copy`, `Cut`, `DownloadZip`, `CreateSubfolder`, `Delete`.

**File-scope override actions (11):** `FileRead`, `FileRename`, `FileCopy`, `FileCut`, `Unlock`, `SubmitForApproval`, `Download`, `DownloadForEditing`, `UploadUpdatedFile`, `FileDelete`, `FileEdit`.

**Shared/cross-scope override actions (4):** `ManagePermissions` (folder), `FileManagePermissions` (file), `ViewHistory`, `ViewRelatedTasks`.

**Folder-role grant values (5, mutually exclusive per folder per user):** `Reader`, `Writer`, `Manager`, `QA`, `Admin`.

**Role-wide blanket capability flags (on `dms_page_access_roles`, 20+):** page-visibility flags, `bypass_folder_permissions` (full admin everywhere), `can_read_all_folders`/`can_read_write_all_folders` (tiered blanket bypass), `can_edit_files`, `can_manage_folder_permissions`/`can_manage_file_permissions`, `can_manage_all_tasks`/`can_create_tasks`/`can_reassign_tasks`/`can_reassign_my_tasks`, `can_view_qa_stage`/`can_view_manager_stage`/`can_view_final_release_stage`, `can_approve`/`can_reject`, `can_resolve_document_id`, `can_send_announcements`, `can_delete_reminders`.

There is **no single unified enum** covering "Read/Write/Upload/Download/Delete/Rename/Create folder/Manage security/Approve/Admin" as one list — those concepts are split across the three systems above (folder-role grant, tri-state override, and role-wide blanket flag), each with a different, overlapping-but-not-identical vocabulary.

### Can permissions be assigned to users, groups, roles, folders, documents?

| Assignable to | Folder-role grant (`dms_folder_permissions`) | Access override (`dms_access_overrides`) | Role-wide flag (`dms_page_access_roles`) |
|---|---|---|---|
| Individual user | Yes (`user_id`) | Yes (`target_type='User'`) | Indirect — via `dms_users.role` |
| Group | No — this table has no group column | Yes (`target_type='Group'`) | No — roles are per-user, not per-group |
| Role | No | No | N/A (this *is* the role table) |
| Folder | Yes (`folder_id`) | Yes (`folder_id`, cascades to descendants) | N/A (applies everywhere via bypass flags) |
| Document | No (no document-level grant table exists) | Yes (`document_id`, single document only) | N/A |

### Inheritance model

- **Folder-role grants:** a grant on folder X does **not** automatically apply to X's subfolders as a separate grant row — but subfolder *visibility/access* computation (`GetAccessibleFolderIdsAsync`) additively unions everything reachable, and per-folder checks (`HasFolderReadAccessAsync`) are evaluated per exact folder, not by walking up looking for an ancestor's grant. **Not determined from current codebase** that a folder-role grant literally cascades to children the way an override does — treat folder-role grants as effectively per-folder, not inherited, unless later verified otherwise.
- **Access overrides:** explicitly cascade — a folder-scoped override applies to that folder and every descendant folder/document beneath it (via an ancestor-chain walk at read time, not a materialized/denormalized cascade). A document-scoped override applies to exactly that one document, no cascade.
- **Parent-folder inheritance for newly-created subfolders:** `Not determined from current codebase` — no code was found that automatically copies a parent folder's `dms_folder_permissions` rows onto a newly created child folder; the only automatic grant on folder creation is the creator's own `Admin` row on the *new* folder itself.

### Deny vs Allow precedence (exact rule, quoted from `AccessOverrideService` logic)

1. If the caller has any **direct** (user-targeted) override with an explicit Allow or Deny decision for the action in question: a Deny among those direct decisions wins outright over any Allow; if there's no direct Deny but at least one direct Allow, Allow wins. **Group input is never even consulted once any direct decision exists.**
2. Otherwise, if the caller (via any group they belong to) has a **group**-targeted override with an explicit decision: same "deny beats allow" rule applied across all applicable group overrides.
3. If neither direct nor group has any explicit decision at all (everything is Inherit/`null`): fall back to the baseline role/grant-derived permission (`roleAllows`).
4. Certain specific actions fall back to a more general sibling action when the specific one is itself on Inherit (not when explicitly set): `FileRead` falls back to folder-level `Read` (only if the override row is folder-scoped); `Download` falls back through `FileRead`, then folder-level `Read`.

### Default permissions on newly created folders/documents

- **Folder:** the creator receives an automatic `Admin` `dms_folder_permissions` row on the new folder. No other user/group gets any default access.
- **Document:** no default `dms_folder_permissions`-equivalent row exists for individual documents at all (there is no document-level grant table) — a document's effective access is entirely derived from its *containing folder's* permissions plus any document-scoped override. Creating a document does not itself create any new permission row.

---

## 11. Custom Metadata

**There is no generic custom-metadata/custom-fields system in this codebase.** This is one of the most important gaps to flag for migration planning.

What exists instead:
- **`dms_documents`** has a small, fixed set of hardcoded metadata-like columns: `category`, `department`, `tags` (array), `description`, `original_document_id`. These are baked into the `DmsDocument` C# model and the `dms_documents` table schema — they are **not** user-definable fields; adding a new one requires a code change and a migration.
- **`dms_dropdown_items`** is a flat picklist table (`list_key`, `label`, `sort_order`) that only backs the *values* for exactly three of those fixed fields (`category`, `department`, `tag`) — it does not define new fields, field types, or apply to any entity other than documents' Category/Department/Tags dropdowns.
- **`dms_document_metadata`** exists (`metadata_id`, `version_id`, `custom_data` as a single freeform string column, `created_at`) but is a single opaque text blob per version with no field-name/field-type/field-value structure, and there is no evidence in the controllers researched that any current feature actively reads/writes this table in a structured way — `Not determined from current codebase` whether this table is populated by any live code path today.

**Consequence for migrating arbitrary legacy metadata** (KnowledgeTree custom fields like "Document Number," "Project," "Revision," "Author," "Effective Date," "Review Date," "Document Type," etc.):
- Fields that map directly to an existing column (`Document Number` → `original_document_id`; `Document Type`/similar → `category`; an organizational field → `department`; free-form labels → `tags[]`) can be imported cleanly into those columns.
- Any KnowledgeTree custom field with **no equivalent column** (Project, Revision-as-a-labeled-field distinct from version numbering, Author-as-a-field distinct from the uploader identity, Effective Date, Review Date, and any customer-specific metadata field) has **no structured home** in the current schema. Realistic options, in order of least-invasive to most-invasive:
  1. Fold into `description` as freeform appended text (lossy, unqueryable, not recommended for anything meant to be searched/filtered later).
  2. Store as a JSON blob in the currently-unused/underused `dms_document_metadata.custom_data` column, keyed by field name (requires confirming this table isn't relied upon elsewhere, and building read-side UI/API support that doesn't currently exist).
  3. Add new dedicated columns to `dms_documents` via a new migration (the same pattern used repeatedly throughout this project's own history — `category`/`department`/`description`/`tags`/`original_document_id` were all added this way, incrementally, after the base schema shipped). This is the most consistent-with-existing-practice option but requires an actual schema change, which is out of scope for a read-only migration script and would need to be planned as prerequisite development work, not purely a migration-script concern.
- **Whether new metadata definitions can be created automatically during migration:** only in the limited sense of adding new *dropdown option values* to `dms_dropdown_items` for `category`/`department`/`tag` (via the existing Company Data import/export feature, §15) — there is no mechanism to define an entirely new *field* (e.g. "Effective Date") without a code/schema change.

---

## 12. Audit / Transaction History

- **Table/entity:** `dms_audit_trails` / `DmsAuditTrail`.
- **Event type/action:** `action`, free-text string matched against ~70 known constants in `AuditService.AuditActions` (folder/document/task/permission/reminder/user/group/role/override/dropdown/setting/announcement/email/database actions — e.g. `DOCUMENT_CREATED`, `DOCUMENT_UPLOADED`, `DOCUMENT_APPROVED`, `USER_CREATED`, `PERMISSION_GRANTED`, `DATABASE_BACKUP_RESTORED`).
- **User:** `user_id` — plain UUID column, **no DB-level FK constraint to `dms_users`** despite being conceptually a user reference.
- **Timestamp:** `created_at`, always `DateTime.UtcNow`, **hardcoded at insert time inside `AuditService.LogAsync`** — there is no parameter or overload allowing a caller to supply a different/historical timestamp through the application's own audit-writing code path.
- **Document/folder/version:** not first-class columns — these references live inside the `metadata` JSONB blob on a per-action basis (whatever fields the calling code chose to serialize into it), not as dedicated foreign-key columns on `dms_audit_trails` itself.
- **IP address:** `Not determined from current codebase` — no IP-address field exists on `dms_audit_trails`, and no controller/middleware code was found capturing `HttpContext.Connection.RemoteIpAddress` into an audit entry.
- **Comments/details:** carried inside the free-form `metadata` JSONB column, structure varies per action type (not a fixed schema).

**Can historical dates/users be inserted, or does the audit system only record live events?**
- Through the **application's own `AuditService.LogAsync` method**: no — `CreatedAt` is always "now," non-overridable.
- Through a **direct SQL insert**: yes, technically — `dms_audit_trails` has no trigger preventing INSERT (only UPDATE/DELETE are blocked by the WORM trigger), so a migration script inserting rows directly, with `created_at` set to the real historical KnowledgeTree transaction date and `user_id` set to the correctly-mapped new user ID, would succeed and would be permanently un-editable/un-deletable afterward (matching the "write-once" intent of an audit ledger). This is the only realistic path to migrating KnowledgeTree's transaction history with faithful original dates.

**Can KnowledgeTree audit history realistically be migrated?** Yes, but **only via direct SQL insert**, not via any application API/service — there is no `POST /api/audittrails` write endpoint at all (the `AuditTrailsController` researched is read-only: `GET` list/detail/by-user/by-action). A migration script would need to: (1) fully complete the user-ID mapping first (§17), (2) translate each legacy transaction/event type to one of the existing `AuditActions` string constants where a reasonable match exists (or accept that some KnowledgeTree event types have no matching constant and would need a new one added, or be logged under a generic fallback action), and (3) insert directly into `dms_audit_trails` with historical `user_id`/`action`/`metadata`/`created_at` values, understanding that once inserted these rows are permanently immutable by design.

---

## 13. API Endpoints Relevant to Migration

Full endpoint inventory (method, route, purpose, auth, required fields, response) is provided per-controller below. All routes are prefixed as shown; the frontend reaches them through nginx's `/api/` same-origin proxy.

### Authentication — `api/auth`
```text
POST /api/auth/login
  Purpose: local email+password login
  Auth: none (public)
  Request: LoginRequest(Email, Password) — both required
  Response: { token, user }

POST /api/auth/set-initial-password
  Purpose: bootstrap a password for an account with no password_hash yet (self-closing, one-time)
  Auth: none (public), but rejects (400) if the account already has a password
  Request: LoginRequest reused

POST /api/auth/google
  Purpose: Google Identity Services popup sign-in (verifies ID token server-side, @si-ware.com only)
  Auth: none (public at middleware layer; verified internally)
  Request: GoogleLoginRequest(IdToken)

POST /api/auth/google/callback
  Purpose: Google Identity Services redirect sign-in (form POST, CSRF double-submit check)
  Auth: none (public)
  Request: [FromForm] credential, g_csrf_token

GET /api/auth/me
  Purpose: resolve current session on app load
  Auth: valid JWT required

POST /api/auth/heartbeat
  Purpose: online-presence ping
  Auth: valid JWT required
```

### Users — `api/users`
```text
GET  /api/users[?activeOnly=&page=&pageSize=]      — list users; no permission check beyond valid session
GET  /api/users/{id}                                 — user detail + resolved permissions + pending task count
POST /api/users                                      — create user
     Request: CreateUserRequest(Email*, FullName*, SsoSubject?, Password?)
     Required: Email, FullName. Password optional (null => SSO-only account).
PUT  /api/users/{id}                                 — update FullName/Email/IsActive
     Self-deactivate guard only.
PUT  /api/users/{id}/role                             — assign/clear global page-access role
DELETE /api/users/{id}                                — soft-delete (deactivate); self-deactivate blocked
PUT  /api/users/{id}/reset-password                   — admin-set new password; no ownership check found
POST /api/users/{id}/transfer-ownership                — bulk-reassign live-work FK references to another user
     Excludes dms_esignatures/dms_reminders (WORM/protected historical records) — never reassigned.
DELETE /api/users/{id}/permanent                       — hard delete; 409 if FK-blocked by owned live rows
```

### Groups — `api/groups`
```text
GET/POST/PUT/DELETE for dms_groups, dms_group_members, dms_group_subgroups.
No permission checks in any method body beyond "valid active user."
Nested-subgroup cycle prevention via BFS descendant walk (rejects both direct self-nest and
adding a group as its own descendant's descendant).
```

### Page Access Roles — `api/page-access-roles`
```text
GET  /                       — list all roles + all 26 flags
POST /                        — create a custom role
PUT  /{role}                  — update flags
PUT  /{role}/rename            — rename a role (including built-in roles), rewrites dms_users.role
                                  FK references in one transaction
DELETE /{role}                 — delete a custom role (blocked if is_built_in = true)
No permission checks in any method body.
```

### Folder Permissions — `api/folderpermissions`
```text
GET  /folder/{folderId}       — grants on a folder
GET  /user/{userId}           — grants held by a user
POST /                        — grant (validates Role against Reader/Writer/Manager/QA/Admin)
DELETE /{id}                  — revoke
No permission checks in any method body.
```

### Access Overrides — `api/access-overrides`
```text
GET  /?folderId=|documentId=   — list overrides (includes folder-inherited row when queried by documentId)
POST /                          — upsert, keyed on (FolderId, DocumentId, TargetType, TargetId)
DELETE /{id}
Gated on ManagePermissions/FileManagePermissions (resolved via AccessOverrideService against
CanManageFolderPermissions/CanManageFilePermissions role flags, or true folder-Admin).
```

### Folders — `api/folders`
```text
GET  /my-permissions[?folderId=]     — caller's resolved effective permission flags
GET  /                                — list folders visible to caller
GET  /{id}                            — folder detail + permissions + document count
POST /                                 — create folder
     Request: CreateFolderRequest(Name*, OwnerId*, ParentFolderId?, Description?, Classification?, ReuseExisting?)
     Required: Name (non-blank), OwnerId (must equal caller). Grants creator Admin automatically.
PUT  /{id}                             — update name/description/classification
POST /{id}/move                        — move folder + descendants (cycle-checked)
DELETE /{id}                           — delete (rejected if folder contains documents)
```

### Documents — `api/documents`
```text
GET  /[?folderId=&search=]                        — list, folder-scoped
GET  /{id}                                         — detail incl. resolved approval stage
POST /                                             — create document row (no file yet)
     Request: CreateDocumentRequest(Title*, FolderId*, OwnerId*, Description*, Category*, Department*,
               Tags?, OriginalDocumentId?)
     Required (server-enforced): Title, Description, Category, Department.
     OriginalDocumentId settable only by a true folder-Admin caller.
POST /{id}/upload                                  — attach file / new version (multipart)
     Request: file (IFormFile, required), versionLabel (form field, required)
     Rejects (423) if current version is checked out by a different user.
GET  /{id}/versions/{versionId}/download            — download a specific version
POST /{id}/versions/{versionId}/revert              — revert to an old version (reuses its S3ObjectKey)
PUT  /{id}                                          — update metadata (gated on FileEdit override action)
     Request: UpdateDocumentRequest(Title?, Status?, Description?, Tags?, Department?, Category?,
               OwnerId?, VersionLabel?, FileName?) — FileName validated against / \ : * ? " < > |
POST /{id}/move                                     — move document to another folder
DELETE /{id}                                        — delete document (+ all its versions, MinIO objects)
POST /{id}/versions/{versionId}/checkout            — checkout (lock)
POST /{id}/versions/{versionId}/force-unlock        — admin force-unlock
DELETE /{id}/versions/{versionId}/checkout          — checkin (unlock)
GET  /{id}/versions/{versionId}/checkout            — checkout status
POST /{id}/submit                                   — submit for approval (legacy single-doc path)
POST /{id}/approve, POST /{id}/reject               — legacy approval actions
GET  /{id}/approval-status                          — legacy approval status
GET  /pending-approvals/list                        — legacy queue, disconnected from real C-Doc tables
POST /{id}/extract-doc-id                            — auto-detect Doc ID from OCR text (any Writer+)
POST /{id}/set-doc-id                                — manual Doc ID entry (gated on CanResolveDocumentId)
POST /{id}/generate-doc-id                           — system-generate SWS-{n+1} (gated on CanResolveDocumentId)
POST /bulk-approve   Request: BulkApproveRequest(DocumentIds*, Comments?)
POST /bulk-reject    Request: BulkRejectRequest(DocumentIds*, Reason*)
POST /bulk-delete    Request: BulkDeleteRequest(DocumentIds*)   — explicit FileDelete permission re-check per item
POST /bulk-download  Request: BulkDownloadRequest(DocumentIds*) — streams ZIP; NO explicit permission check found
```

### Approvals (C-Doc Workflow, per-document stage-tracked) — `api/approvals`
```text
POST /submit-batch                                                     — create approval batch + per-doc rows
GET  /{approvalId}/documents/{documentId}                              — single-document detail (Review modal)
GET  /qa-review-queue | /manager-review-queue | /final-release-queue   — paginated per-stage queues
POST /{approvalId}/documents/{documentId}/qa-accept                    — Stage1 -> Stage2 (blocks if open linked task)
POST /{approvalId}/documents/{documentId}/qa-request-correction        — stays Stage1, spawns correction task
POST /{approvalId}/documents/{documentId}/manager-approve               — Stage2 -> Stage3 (blocks if open linked task)
POST /{approvalId}/documents/{documentId}/manager-reject                — stays Stage2, spawns correction task
POST /{approvalId}/documents/{documentId}/manager-self-correct (multipart) — direct fix, Stage2 -> Stage3
POST /{approvalId}/documents/{documentId}/qa-final-release               — Stage3 -> released (blocks if open task)
POST /{approvalId}/documents/{documentId}/qa-final-reject                — stays Stage3, spawns correction task
Auth: CanApprove/CanReject + CanView{Stage} role flags, plus real folder-Deny-override enforcement
(decoupled from per-folder role grants).
```

### Tasks / PCAR — `api/tasks`
```text
GET  /                          — "my tasks", paginated
GET  /{id}                      — task detail
GET  /{id}/document              — linked document lookup (real folder access required, no bypass)
POST /{id}/submit-pcar            — submit RCA/Correction/Preventive/Target-Date form
POST /                             — create task
     Request: CreateTaskRequest(DocumentId?, Title*, AssignedToId? XOR AssignedToGroupId?, Description?,
               TaskType?, RiskSeverity?, DueDate?)
     Non-self-assignment requires CanCreateTasks or CanManageAllTasks.
POST /{id}/complete                — complete task
PUT  /{id}                         — update/reassign (own task, CanManageAllTasks, or reassign-only path)
DELETE /{id}                       — permanent delete (CanManageAllTasks AND Status=="open" only)
GET  /overdue/list, GET /document/{documentId}
POST /{id}/resubmit-for-review     — assignee resubmits corrected file, reopens blocked stage
POST/GET/DELETE /{id}/attachments[...]  — attachment CRUD, MinIO-backed
```

### Reminders — `api/reminders`
```text
GET /               — own reminders
GET /pending/list
POST /{id}/send      — manual send-one
POST /send-due       — Hangfire-enqueued sweep trigger
DELETE /{id}          — gated on CanDeleteReminders
POST /               — create
     Request: CreateReminderRequest(TaskId*, RecipientId*, ReminderType*, DueDate*) — all 4 required
     ReminderType validated to APP/EMAIL/BOTH. Immediate-send if DueDate <= now.
```

### Notifications — `api/notifications`
```text
GET /, GET /unread-count, PUT /{id}/read, PUT /read-all
Authorization = query scoping (n.UserId == callerId) — no separate role check.
```

### Announcements — `api/announcements`
```text
GET /                 — any authenticated user
POST /                 — gated on CanSendAnnouncements
     Request: CreateAnnouncementRequest(Title*, Message*, RecipientUserIds?, NotifyEmail*, NotifyApp*)
DELETE /{id}            — poster or BypassFolderPermissions role
```

### Company Data / Dropdown Lists — `api/dropdown-lists` (relevant for bulk metadata-value import)
```text
GET  /                          — any authenticated user
GET  /{key}                     — any authenticated user
POST /{key}/items                — gated on CanViewAdminPanel
DELETE /{key}/items/{itemId}     — gated on CanViewAdminPanel
POST /{key}/import                — gated on CanViewAdminPanel; accepts .csv/.xlsx/.xls, first column
                                     as item label, skips a literal "Name" header row, case-insensitive
                                     dedup against existing rows (never updates, only inserts new + skips
                                     duplicates); response { added, skipped }
GET  /{key}/export                — NO permission gate found (discrepancy vs. Add/Delete/Import on the
                                     same controller, which are all Admin-only)
```

### Audit Trails — `api/audittrails`
```text
GET /[?userId=&action=&page=&pageSize=]   — no permission gating found; any authenticated user can read
                                             all audit trails for any user/action
GET /{logId}
GET /user/{userId}
GET /action/{action}
Read-only — no write/import endpoint exists on this controller.
```

### Database Backup / Restore — `api/database-backup` (whole-database bulk mechanism, migration-relevant)
```text
GET  /status                              — no auth check found; last backup timestamp
GET  /export                               — Admin only (BypassFolderPermissions)
     Shells out to real pg_dump: --data-only --inserts --no-owner --no-privileges --schema=public
     Returns plain-text SQL INSERT statements for the whole public schema, as an .sql file.
POST /restore                               — Admin only
     Accepts an uploaded .sql file; strips pg_dump-16-only \restrict/\unrestrict meta-command lines;
     inside ONE transaction: SET session_replication_role = replica; TRUNCATE every public-schema
     table (RESTART IDENTITY CASCADE, no exclusions — including dms_users/dms_page_access_roles);
     executes the file's INSERT statements; resets session_replication_role; commits.
     All-or-nothing full-database replace — NOT an incremental/additive import.
GET  /clear-options                          — no auth check found; live row counts per clearable group
POST /clear/{key}, POST /clear-all           — Admin only; truncates named ClearDataGroups tables,
                                                EXCLUDING dms_users/dms_page_access_roles/dms_role_permissions
GET/PUT /schedule, POST /schedule/run-now, GET /schedule/files/{fileName}/download — scheduled backup config
```
**Scope note:** export/restore is **Postgres-only** — MinIO-stored document/attachment/logo bytes are never included. A restore repopulates every document's metadata row but not its underlying file content.

---

## 14. Internal Services Useful for Migration

| Class name | File path | Main methods | Purpose |
|---|---|---|---|
| `MinioService` | `api/Services/MinioService.cs` | `EnsureBucketExistsAsync`, `UploadAsync`, `DownloadAsync`, `StatAsync`, `ListAsync`, `DeleteAsync` | Object storage abstraction; no key-naming logic of its own (callers decide the key) |
| `AuditService` | `api/Services/AuditService.cs` | `LogAsync(userId, action, metadata?)`, `GetAuditTrailAsync`, `GetAuditTrailPageAsync` | Write/read audit ledger; `LogAsync` always stamps `CreatedAt = UtcNow`, not overridable |
| `AccessOverrideService` | `api/Services/AccessOverrideService.cs` | `ResolveAsync`, `GetApplicableOverridesAsync`, `GetOverrideVisibleFolderIdsAsync` | Tri-state override resolution and cascade logic |
| `PasswordHasher` | `api/Services/PasswordHasher.cs` | `Hash(password)`, `Verify(password, hash)` | PBKDF2-SHA256 (100k iterations), versioned format `V1.{iter}.{salt}.{hash}` |
| `DocIdExtractor` | `api/Services/DocIdExtractor.cs` | `Extract(text)` (static) | Regex heuristic to pull a legacy/external Doc ID out of OCR'd text — directly relevant to reconciling KnowledgeTree doc numbers against extracted content, but does not itself write to the DB |
| `BaseController` (shared helpers, not a service but used by every controller) | `api/Controllers/BaseController.cs` | `GetCurrentUserId`, `GetEffectiveRoleAsync`, `HasFolderReadAccessAsync`, `GetAccessibleFolderIdsAsync` | Central permission-resolution helpers |
| `DatabaseExportService` | `api/Services/DatabaseExportService.cs` | `ExportSqlDumpAsync()` | Shells out to real `pg_dump --data-only --inserts` for the whole `public` schema |
| `TaskService`, `ReminderService`, `ApprovalService`(referenced), `NotificationService`, `AnnouncementService` | `api/Services/*.cs` | domain-specific CRUD/business logic | Not individually detailed in this pass beyond what's covered in the controller inventory above; consult these directly if building a service-layer-based importer (Option B in §16) rather than going through HTTP |

**Recommendation:** for a migration script, calling internal services directly (in-process, e.g. via a small ASP.NET Core minimal-API "migration mode" host, or a console app referencing the same `DmsContext`) would let you reuse `MinioService`/`AccessOverrideService`/`PasswordHasher` logic without re-implementing it, while still bypassing the REST layer's per-request HTTP/JWT overhead — see §16.

---

## 15. Bulk Import / Existing Migration Features

A repo-wide search for `import`, `migration`, `bulk`, `legacy`, `seed`, `restore`, `batch` found:

- **`bulk` (real feature):** `POST /api/documents/bulk-approve`, `bulk-reject`, `bulk-delete`, `bulk-download` — all operate on an existing list of already-created `DocumentIds`; none of them *create* new documents. Not usable as an import mechanism, only as a bulk-*action* mechanism on already-migrated data.
- **`import` (real feature):** `POST /api/dropdown-lists/{key}/import` — the **only** true bulk-*import* endpoint in the entire API. Accepts `.csv`/`.xlsx`/`.xls`, reads the first column as a plain label, skips a literal `"Name"` header row, case-insensitively deduplicates against existing rows (insert-new-only, never updates), and is scoped **only** to the three Company Data dropdown lists (`department`/`category`/`tag`) — not documents, users, folders, or any other entity.
- **`restore` (real feature):** `POST /api/database-backup/restore` — a whole-database, Postgres-only, all-or-nothing replace (full `TRUNCATE` of every table, then replay of a `pg_dump --inserts` file). This **can** double as a bulk-import route in the narrow sense that any correctly-formatted `INSERT`-statement SQL file will be executed — but it is explicitly not additive/incremental (it wipes everything first) and does not touch MinIO at all.
- **`seed`:** no seeding *service* exists in `api/Services/*.cs` — seed data lives purely in `infra/db/init/*.sql` migration files (e.g. a dev-seed-admin script, and historical seed-data scripts from early development), applied only on a brand-new empty Postgres volume, not something callable at runtime.
- **`migration`** (as an application feature, not EF Core Migrations): **Not determined from current codebase** — no in-app data-migration runner/CLI/service exists. The word only appears in comments referencing the numbered `infra/db/init/*.sql` schema-migration files, which are plain SQL scripts applied by Docker's Postgres entrypoint convention, not EF Core Migrations and not a generic import tool.
- **`legacy`:** only one unrelated hit (an EmailService SMTP-config fallback comment) — no code uses this word to refer to a prior DMS or migration concept.

**Conclusion: no existing import utility, bulk-upload feature, migration service, data-seeding tool, CLI importer, or admin import API is capable of importing arbitrary KnowledgeTree folders/documents/versions/users/permissions/metadata as-is.** The two existing mechanisms that come closest — Company Data dropdown import (too narrow in scope) and Database Backup restore (too broad/destructive, Postgres-only) — are not directly reusable for a general KnowledgeTree migration without significant new script/tooling work built specifically for this migration.

---

## 16. Recommended Migration Interface

### Option A — REST API

**Benefits:** exercises the exact same validation, permission checks, and side effects (audit logging, notifications, MinIO key generation) that the real application relies on — lowest risk of producing data the application can't correctly interpret later. Works from any environment with network access to the API, no need to run inside the Docker network.

**Risks:** every timestamp (`created_at`, `updated_at`, audit `created_at`) is forced to "now" by the controllers/services — **historical fidelity (original KnowledgeTree dates, original authors) is lost** unless a new code path is added. Slower (one HTTP round-trip + full permission resolution per record). Some required fields (Category/Department on documents) have no KnowledgeTree equivalent and must be synthesized. Bulk-download's missing auth check and a few controllers' complete absence of in-body permission checks (Users, Groups, PageAccessRoles, FolderPermissions, AuditTrails) are not migration blockers, but mean the API's authorization posture generally trusts "any authenticated session," not a hardened multi-tenant boundary — acceptable for a controlled one-time migration run under an admin account.

### Option B — Internal backend services (in-process, bypassing HTTP)

**Benefits:** avoids HTTP/JWT overhead, can call `MinioService`/`AccessOverrideService`/`PasswordHasher` directly, and — critically — a purpose-built importer written this way *could* set historical timestamps and specific IDs directly on the EF entities before calling `SaveChangesAsync()`, since EF itself has no built-in protection against an explicit `CreatedAt`/`Guid` assignment (only the *controllers* currently hardcode `DateTime.UtcNow`, not the underlying model/DbContext). This is the best path for preserving historical fidelity while still reusing real application logic (hashing, MinIO key upload, override resolution) instead of hand-rolling it.

**Risks:** requires writing and building new C# code inside (or referencing) the `api` project — this is real development work, not a pure external migration script, and must be planned/reviewed like any other code change (out of scope for a read-only discovery pass, but the most technically sound option for the actual implementation phase).

### Option C — Direct PostgreSQL insert + direct MinIO upload

**Benefits:** full control over every column including historical timestamps, specific UUIDs (enabling clean legacy-ID mapping — see §17), and can be scripted in any language with a Postgres driver and an S3-compatible client (no dependency on the .NET codebase at all). Fastest for large bulk loads (no per-record HTTP/permission overhead). The database backup/restore mechanism itself (`pg_dump --inserts` / raw `INSERT` execution) proves the application is fully compatible with direct-SQL data population — it doesn't rely on any trigger-based business logic to keep data consistent (only the audit tables' WORM triggers exist, and those don't block INSERT).

**Risks:** **entirely bypasses every application-level validation, permission check, and derived side effect** described throughout this document (required-field checks, uniqueness checks beyond DB constraints, automatic `dms_folder_permissions` grant on folder creation, notification/audit side effects the controllers normally trigger, etc.) — the migration script itself becomes fully responsible for replicating every invariant the application would otherwise enforce (e.g., must manually insert the creator's `Admin` folder-permission row; must manually validate Category/Department dropdown values exist; must manually compute SHA-256 and upload to MinIO in the correct key format **before** inserting the version row, or the application will show a document with no retrievable file). The two documented, currently-live C#/SQL model discrepancies (`S3ObjectKey` unique-index mismatch, missing explicit EF FK config on several tables) are just proof this system's schema and application code have already drifted slightly from each other under normal development — direct SQL manipulation adds a new avenue for this drift to widen further if not done carefully.

### Recommendation

**Given this application's architecture — no existing generic import tool, heavy business logic split across controllers rather than centralized, and this system's own proven pattern of doing direct Postgres population (via `pg_dump`/restore) — the safest and most practical approach is a hybrid of Option C and Option A:**

1. Use **direct PostgreSQL insert + direct MinIO upload (Option C)** for the bulk of the data load — folders, documents, versions, users, groups, folder-permission grants, and (critically) historical audit-trail rows — specifically *because* this is the only path that preserves original KnowledgeTree timestamps, authors, and IDs, none of which the REST API allows to be set. Follow the exact object-key convention and DB-write ordering documented in §7, and replicate the specific side effects the API would otherwise perform automatically (creator's Admin folder-permission grant, SHA-256 computation before/at upload time, `current_version_id` pointer updates).
2. Use the **REST API (Option A)** only for anything that must go through real business logic with no direct-SQL equivalent and where historical fidelity doesn't matter — e.g., populating Company Data dropdown values via the existing CSV/Excel import endpoint (§15), or as a final verification pass (e.g., confirming a migrated document is actually retrievable/downloadable through the normal application flow).
3. **Do not use Option B** (writing new internal-service migration code) unless the team is prepared to treat the migration tool itself as a reviewed, tested feature addition to the codebase — reserve it only if Option C proves insufficient for some specific invariant that's too risky to hand-replicate in a script (e.g., something in `AccessOverrideService`'s cascade logic that's easy to get subtly wrong by hand).

Do not implement any of this yet — this section is a comparison and recommendation only, per the task instructions.

---

## 17. IDs and Legacy-ID Preservation

| Entity | ID type |
|---|---|
| Users | UUID (`Guid`) |
| Groups | UUID |
| Folders | UUID |
| Documents | UUID |
| Document versions | UUID |
| Folder permissions (grants) | UUID |
| Access overrides | UUID |
| Page access roles | **string** (the role name itself is the PK, e.g. `"Full Access"`) |
| Dropdown items (metadata picklist entries) | UUID |
| Tasks | UUID |
| Audit trail entries | UUID |

**Every UUID primary key in this schema is generated via Postgres's `gen_random_uuid()` default — but this is only a column *default*, not an enforced/immutable generation rule.** A direct SQL `INSERT` (or an EF entity constructed with an explicit `Guid` already set before `SaveChangesAsync()`) can supply any UUID value it wants, including one deterministically derived from a legacy KnowledgeTree integer ID (e.g. via a fixed-namespace UUID v5 scheme, or simply a lookup-table-assigned fresh UUID). The REST API's DTOs (`CreateFolderRequest`, `CreateDocumentRequest`, `CreateUserRequest`, etc.) **do not expose the primary-key field as settable** — going through the REST API, IDs are always server-generated and cannot be chosen.

**Can KnowledgeTree's `doc_id`/`folder_id` be preserved directly as the new DMS's primary key?** Not cleanly — KnowledgeTree's legacy IDs are (per the described export files, `01_folders.tsv`/`02_documents.tsv`) presumably integer/sequential IDs, while every relevant table here uses UUID. There is **one column explicitly reserved for an external/legacy identifier**: `dms_documents.original_document_id` (string, nullable, case-insensitive-unique when set) — this is the natural home for a legacy KnowledgeTree document ID/number, and is exactly the field the application's own `DocIdExtractor` and Doc-ID-resolution endpoints (`extract-doc-id`/`set-doc-id`/`generate-doc-id`) already work with. **No equivalent field exists for a legacy folder ID, user ID, group ID, or permission ID.**

**Recommendation: build a mapping table** (external to the application schema — e.g. a separate migration-tooling database, a CSV, or a temporary Postgres schema/table created specifically for the migration run, not `dms_*`), such as:
```text
legacy_folder_id      -> new_folder_id (UUID)
legacy_doc_id         -> new_document_id (UUID)   [also store the legacy doc number
                                                     in dms_documents.original_document_id
                                                     for in-app visibility/search, in
                                                     addition to the mapping table]
legacy_user_id        -> new_user_id (UUID)
legacy_group_id        -> new_group_id (UUID)
legacy_version_id       -> new_version_id (UUID)
```
This mapping table is required regardless of which migration approach (§16) is chosen, since none of the four ID-bearing entity types (folders, users, groups, versions) has a reserved legacy-ID field of its own — only documents do, via `original_document_id`.

---

## 18. Date / Time Handling

- **Timezone handling:** the schema is inconsistent but mostly `TIMESTAMPTZ` (timestamp with time zone). Exceptions found: `dms_groups.created_at`/`updated_at` and `dms_group_members.added_at`/`dms_group_subgroups.added_at` use plain `TIMESTAMP` (no timezone) — never corrected by a later migration, unlike `dms_users.last_heartbeat_at`, which *was* retyped from `TIMESTAMP` to `TIMESTAMPTZ` in a later migration. `dms_tasks.due_date` and `dms_audit_calendar_events.event_date` are plain `DATE` (no time component at all, by design). `dms_reminders.due_date` was originally `DATE` and was explicitly widened to `TIMESTAMPTZ` after a real bug was found (see §2).
- **UTC vs local time:** the application consistently writes UTC (`DateTime.UtcNow` throughout the C# services/controllers) into `TIMESTAMPTZ` columns; Postgres's `TIMESTAMPTZ` type itself stores instants normalized to UTC internally regardless of session timezone, so this is consistent. The plain `TIMESTAMP` columns on the Groups tables have no timezone awareness at all — values there are whatever the inserting session's local clock/timezone assumption was (in practice, still UTC, since the app never sets a different session timezone, but this is not enforced by the column type itself).
- **Timestamp column types:** see above — a mix of `TIMESTAMPTZ` (majority), plain `TIMESTAMP` (a few tables), and plain `DATE` (task due-dates, calendar event dates).
- **Created/modified date defaults:** every `created_at`/`updated_at` column has a `DEFAULT now()` at the DB level; the application layer also explicitly sets `DateTime.UtcNow` in most create/update code paths (belt-and-suspenders — either the DB default or the explicit C# assignment would produce the same "now" value in practice).
- **Can historical timestamps be explicitly supplied?**
  - **Via the REST API:** no — none of the researched `Create*Request`/`Update*Request` DTOs expose `CreatedAt`/`UpdatedAt` as settable fields; every controller path stamps "now."
  - **Via direct SQL insert or a custom in-process EF-based script:** yes — every timestamp column is a plain, unconstrained column (no trigger prevents an arbitrary historical value on INSERT; only `dms_audit_trails`/`dms_esignatures`/`dms_ocr_indexes` have a WORM trigger, and that trigger only blocks UPDATE/DELETE, not INSERT). This is consistent with §6/§12's conclusions: **preserving original KnowledgeTree dates requires bypassing the REST API and either inserting directly into Postgres or writing new service-layer code that doesn't hardcode `UtcNow`.**

---

## 19. Filename and Path Restrictions

- **Filename characters:** the only explicit server-side character restriction found is on the **rename** path (`PUT /api/documents/{id}` with a `FileName` field), which rejects any of `/ \ : * ? " < > |` with `"File name contains invalid characters"`. This same restriction is **not** applied at initial upload time (`POST /{id}/upload`) — the uploaded file's own `file.FileName` (as sent by the HTTP client) is stored as-is on `dms_document_versions.file_name` with only a `Trim()`/null-check, no character sanitization, when it's first attached to a document.
- **Maximum filename length:** `dms_document_versions.file_name` is `VARCHAR(255)` — anything longer would need to be truncated by the application or fail at the DB level; `Not determined from current codebase` whether the API pre-validates length before hitting that DB constraint (no explicit `MaxLength`/length check was found in the controller code reviewed).
- **Maximum folder-name length:** `dms_folders.name` is `VARCHAR(255)`, same caveat as above.
- **Duplicate filenames:** allowed across different documents/folders — there is no DB-level uniqueness constraint on `file_name` (only `s3_object_key`, and even that constraint was later dropped — see §2/§6). Within one document, multiple versions can legitimately have different filenames (a version can be renamed independently of its siblings) or even the same filename repeated across versions — no constraint prevents it.
- **Duplicate documents:** no document-level duplicate-detection (by filename, hash, or title) was found — `Title` has no uniqueness constraint, and `sha256_hash` has no uniqueness constraint either (two different `dms_document_versions` rows, even across unrelated documents, could carry an identical hash with nothing blocking it).
- **Path length:** not directly applicable — there is no stored full-path column (§4); the only "path" that materializes is the MinIO object key (`documents/{documentId}/{versionId}/{fileName}`), whose total length is a function of the (verbatim, unsanitized) original filename plus two fixed-format GUIDs — `Not determined from current codebase` that MinIO/S3 key-length limits (typically 1024 bytes for S3) are explicitly validated anywhere in this codebase; an extremely long legacy filename could theoretically produce an over-length key with no application-level guard against it.
- **Unicode filenames (including Arabic):** no restriction found — `file_name`/`title`/`name` are plain `VARCHAR`/`TEXT` columns with Postgres's default UTF-8 encoding assumption for the database; no `ToASCII`/transliteration/encoding-normalization logic was found anywhere in the reviewed controllers. Arabic (and any other Unicode) filenames should pass through unchanged, subject only to the length limits above.
- **Spaces and special characters (upload time, not rename time):** no sanitization found — spaces, punctuation, and most special characters are stored verbatim in `file_name` (rename-time validation, quoted above, is the *only* character restriction found, and even that is a small explicit blacklist rather than a broader sanitization pass).

---

## 20. Transaction / Failure Handling

- **PostgreSQL transaction usage:** most multi-step controller actions researched use EF Core's implicit per-`SaveChangesAsync()` transaction (each individual `SaveChangesAsync()` call is atomic on its own), and a few explicitly wrap multiple statements in one transaction where genuine multi-row atomicity matters — confirmed explicit-transaction usage: folder creation (create folder + grant creator's Admin permission row, one transaction), user-role rename (insert-new-role-row + repoint-every-affected-user + delete-old-role-row, one transaction), `POST /api/users/{id}/transfer-ownership` (reassign every live-work FK reference across many tables, one transaction), and `POST /api/database-backup/restore` (the full `TRUNCATE`-everything-then-replay-INSERTs sequence, one transaction, full rollback on any failure).
- **Document upload flow specifically (the most migration-relevant multi-step action) is NOT wrapped in one explicit cross-system transaction:** the real controller sequence is (1) compute SHA-256, (2) upload to MinIO, (3) insert the `dms_document_versions` row, (4) update `dms_documents.current_version_id`. Steps 3–4 are ordinary EF `SaveChangesAsync()` calls (Postgres-atomic on their own), but **step 2 (the MinIO upload) is a separate system with no compensating rollback if a later step fails** — e.g., if the MinIO upload succeeds but the subsequent DB insert throws, the uploaded object becomes orphaned (present in MinIO, referenced by no `s3_object_key` row) with nothing to clean it up automatically.
- **MinIO rollback behavior:** none found — there is no "delete the just-uploaded object if the following DB write fails" compensating logic in the reviewed code. A migration script performing the same sequence should implement its own compensating cleanup (or accept/tolerate orphaned objects and reconcile them in a later pass) if the DB write can plausibly fail after the object upload succeeds.
- **Orphaned object handling:** no automated orphan-detection/cleanup job was found anywhere in the codebase (no Hangfire job scans for MinIO objects with no matching DB row, or vice versa).
- **Duplicate detection:** at the DB level, the only relevant unique constraints are `(document_id, version_number)` and the (now-removed) former `s3_object_key` uniqueness, plus `dms_documents.original_document_id`'s case-insensitive partial unique index. There is **no** general "have I already imported this legacy record" mechanism built into the application (no idempotency-key column on any table researched).
- **Retries:** `Not determined from current codebase` — no retry/backoff logic was found in the upload/document-creation code paths; Hangfire's own background jobs have standard Hangfire retry semantics for their own scheduled work, but that's unrelated to a one-time migration script's own retry needs.
- **Idempotency support:** none built-in for document/folder/version creation. The closest thing to idempotent behavior found anywhere is `POST /api/folders` accepting a `ReuseExisting` flag (reuse an existing folder with the same name/parent instead of erroring) and the Company Data import's dedup-and-skip behavior (§15) — neither generalizes to documents/versions/users.

**Recommendation for safe, resumable migration:**
1. **Maintain the legacy-ID mapping table (§17) as the source of truth for "has this record already been migrated."** Before creating any folder/document/user/version, check the mapping table first; skip (don't re-create) if a mapping already exists for that legacy ID.
2. **Sequence writes so that the MinIO upload happens, and is verified (e.g. a `StatAsync` check confirming the object exists with the expected size), *before* the corresponding DB row is committed** — this way, a script crash before the DB commit just leaves an as-yet-unreferenced object that can be safely re-uploaded (overwritten) or ignored on retry, rather than a DB row pointing at a file that was never actually written.
3. **Wrap each logical unit of work (one document + all its versions, or one folder + its permission grants) in its own script-level transaction against Postgres** where the underlying entities allow it, committing the mapping-table row only after the corresponding `dms_*` rows are successfully committed — so a mid-batch failure can be detected and that one unit retried without re-processing everything already committed.
4. **Do not rely on the application's own upload/document-creation endpoints for a resumable bulk migration** — build the resumability logic into the migration script itself, since the application provides none.

---

## 21. Authentication Needed for Migration Script

The application supports three login mechanisms (see §1): local email+password, Google OAuth (popup), Google OAuth (redirect) — all converge on the same **JWT bearer-token** session model, validated by `JwtAuthMiddleware` before `RBACMiddleware` even runs.

**Options for a migration script, safest first:**
1. **Direct database/MinIO access (Option C from §16), no API authentication needed at all** — the migration script connects to Postgres/MinIO directly (using the same non-secret connection parameters the API itself uses, sourced from environment variables per `.env.example`/`docker-compose.yml` — e.g. `POSTGRES_USER`/`POSTGRES_DB`, `MINIO_ROOT_USER`), bypassing the API/JWT layer entirely. This is the natural fit if Option C is chosen for the bulk of the migration.
2. **A dedicated local admin service account, authenticated via `POST /api/auth/login`** — create one throwaway local user (via direct SQL insert, or via the one-time `POST /api/auth/set-initial-password` bootstrap endpoint) with a role that has `bypass_folder_permissions = true` ("Full Access"), then have the migration script log in once via `/api/auth/login` and reuse the returned JWT (`Jwt:ExpiryMinutes` default 480 minutes = 8 hours, configurable) for every subsequent API call in that run. This is the right choice **only** for the parts of the migration that go through the REST API (Option A workflows in §16 — e.g. Company Data dropdown import, or a final verification pass).
3. **Do not use Google OAuth for a migration script** — both Google login paths require a real, domain-restricted (`@si-ware.com`) interactive Google sign-in flow (ID-token verification, and the redirect path additionally requires a live CSRF double-submit cookie exchange) with no service-account/offline-token variant found in this codebase; this mechanism is not designed for or usable by a non-interactive script.
4. **There is no separate "API key" or dedicated service-account/machine-to-machine credential type** anywhere in this codebase — the only two credential types are a human local-password account and a human Google-SSO account. If sustained API-based automation is needed beyond a one-time migration, consider requesting (as a small, separate development task, not a migration-script concern) a dedicated non-interactive service-account mechanism before relying on a human admin's JWT for repeated automated runs.

**Recommendation:** for the hybrid approach recommended in §16, use direct DB/MinIO access (no API auth) for the bulk of the migration, and a throwaway "Full Access" local admin account's JWT only for the specific narrow REST-API-based steps (dropdown import, post-migration verification calls). Deactivate or permanently delete that throwaway admin account after the migration completes, and do not reuse its password elsewhere.

---

## 22. Data Validation Available

Validation the application performs, gathered from controllers researched — a migration script populating data directly (bypassing the API) should still satisfy these where the *database* itself enforces them (marked **DB-enforced**), since those cannot be bypassed even by direct SQL; the ones marked **app-layer only** are not DB constraints and would only matter if going through the REST API.

**Folders:**
- `Name`, `OwnerId` non-blank/non-empty (**app-layer only**).
- `OwnerId` must equal the calling user (**app-layer only** — a direct-SQL import is free to set any owner).
- Sibling folders under the same non-null parent can't share a name — `UNIQUE(parent_folder_id, name)` (**DB-enforced**).
- A folder can't be deleted while it still contains documents (**app-layer only**, checked before the delete call — not a DB trigger).

**Documents:**
- `Title`, `Description`, `Category`, `Department` all required/non-blank (**app-layer only** — `description`/`category`/`department` are nullable at the DB level).
- `FolderId` must reference an existing folder; `OwnerId` must reference an existing, active user (**app-layer only** for "active" — the FK itself is **DB-enforced** for "existing").
- `OriginalDocumentId`, when set, must be case-insensitively unique — enforced by a **DB-enforced** partial unique index (`ux_dms_documents_original_document_id`), plus an **app-layer** pre-check that returns a friendly error before hitting the DB constraint.
- `FileName` on rename must not contain `/ \ : * ? " < > |` (**app-layer only**).

**Versions:**
- `file` (the upload itself) and `versionLabel` are required on upload (**app-layer only**).
- `(document_id, version_number)` must be unique (**DB-enforced**).
- Upload/revert is blocked (`423`) if the current version is checked out by a different user (**app-layer only**).

**Users:**
- `Email`, `FullName` required; `Email` uniqueness checked case-insensitively (**app-layer** pre-check, backed by a **DB-enforced** unique constraint on `email` as a final backstop — though the DB constraint's case-sensitivity was not independently re-verified against the app's `.ToLower()` normalization convention in this pass; assume the app-layer lowercase-comparison is the operative check).
- Password, if supplied, validated against a configurable password policy (`PasswordPolicy.Validate`, tied to Platform Settings — e.g. "Require Strong Passwords") (**app-layer only**).
- Self-deactivation/self-delete/self-role-change all explicitly blocked (**app-layer only**).

**Groups:**
- Nested-subgroup cycle prevention: no direct self-nesting (**DB-enforced CHECK**: `parent_group_id != child_group_id`), and no deeper cycle via BFS descendant check (**app-layer only** — not a DB constraint, so a direct-SQL insert *could* create a genuine cycle that the application UI would then mishandle).
- `(group_id, user_id)` membership uniqueness — **DB-enforced**.

**Permissions / Access Overrides:**
- Folder-role grant `role` value restricted to `Reader/Writer/Manager/QA/Admin` — **DB-enforced CHECK constraint** (`chk_folder_permissions_role`), plus an **app-layer** pre-check (`FolderRoles.IsValid`) for a friendlier error message.
- Access override `target_type` restricted to `User`/`Group` — **DB-enforced CHECK**.
- Access override scope: exactly one of `folder_id`/`document_id` — **DB-enforced CHECK** (`chk_access_override_scope`).
- `(folder_id, document_id, target_type, target_id)` uniqueness on overrides — **DB-enforced**.

**Tasks:**
- Exactly one of `assigned_to_id`/`assigned_to_group_id` — **DB-enforced CHECK** (`dms_tasks_assignee_check`).
- `Title` required (**app-layer only**).
- Non-self task assignment requires `CanCreateTasks`/`CanManageAllTasks` (**app-layer only**).

**File uploads generally:**
- No file-size ceiling enforced at the API layer (only nginx's `client_max_body_size 100M` for browser-proxied traffic — not applicable to a script talking to the API container directly, and not applicable at all to direct-to-MinIO writes).
- No MIME-type allowlist/validation anywhere.

---

## 23. Useful Source Code Locations

| Area | File / Directory |
|---|---|
| Document entity | `api/Models/DmsDocument.cs` |
| Document version entity | `api/Models/DmsDocumentVersion.cs` |
| Folder entity | `api/Models/DmsFolder.cs` |
| User entity | `api/Models/DmsUser.cs` |
| Folder permission (grant) entity | `api/Models/DmsFolderPermission.cs` |
| Access override entity | `api/Models/DmsAccessOverride.cs` |
| Page access role entity | `api/Models/DmsPageAccessRole.cs` |
| Group / membership / nesting entities | `api/Models/DmsGroup.cs`, `DmsGroupMember.cs`, `DmsGroupSubgroup.cs` |
| Dropdown/metadata-picklist entity | `api/Models/DmsDropdownItem.cs` |
| Document metadata (freeform blob, apparently unused) | `api/Models/DmsDocumentMetadata.cs` |
| Task / PCAR entity | `api/Models/DmsTask.cs` |
| Audit trail entity | `api/Models/DmsAuditTrail.cs` |
| EF Core DbContext / all mappings, FKs, indexes | `api/Data/DmsContext.cs` |
| MinIO service | `api/Services/MinioService.cs` |
| Upload/document controller (creation, versioning, bulk ops) | `api/Controllers/DocumentsController.cs` |
| Folder controller | `api/Controllers/FoldersController.cs` |
| Users controller | `api/Controllers/UsersController.cs` |
| Groups controller | `api/Controllers/GroupsController.cs` |
| Permissions controllers | `api/Controllers/FolderPermissionsController.cs`, `AccessOverridesController.cs`, `PageAccessRolesController.cs` |
| Approvals / C-Doc Workflow controller | `api/Controllers/ApprovalsController.cs` |
| Tasks / PCAR controller | `api/Controllers/TasksController.cs` |
| Company Data (dropdown) import/export controller | `api/Controllers/DropdownListsController.cs` |
| Database backup/restore controller + service | `api/Controllers/DatabaseBackupController.cs`, `api/Services/DatabaseExportService.cs` |
| Access-override resolution logic | `api/Services/AccessOverrideService.cs` |
| Audit logging service | `api/Services/AuditService.cs` |
| Password hashing | `api/Services/PasswordHasher.cs` |
| Legacy Doc-ID text extraction | `api/Services/DocIdExtractor.cs` |
| Shared permission-check helpers (used by every controller) | `api/Controllers/BaseController.cs` |
| DB schema migrations (chronological, numbered 001–074+) | `infra/db/init/*.sql` |
| Docker compose topology | `docker-compose.yml` |
| API Dockerfile | `api/Dockerfile` |
| Web Dockerfile / nginx config | `web/Dockerfile`, `web/nginx.conf` |
| Authentication (login, JWT issuance, Google OAuth) | `api/Controllers/AuthController.cs`, `api/Services/JwtTokenService.cs`, `api/Middleware/JwtAuthMiddleware.cs` |
| RBAC enforcement middleware | `api/Middleware/RBACMiddleware.cs` |
| Audit trail read controller | `api/Controllers/AuditTrailsController.cs` |
| App configuration | `api/appsettings.json`, `.env.example` |

---

## 24. Current New-DMS Database Counts

`Not collected — requires live database access.` This task was scoped as static source-code/schema discovery only; no live query against the running database was performed, and no credentials were exposed or used to do so. `CLAUDE.md`'s own session history references specific dev/test row counts from past sessions (e.g. "19 documents, 6+ users" at one point in Session 11), but those are historical development-environment snapshots, not current authoritative counts, and should not be relied upon for migration capacity planning.

---

## 25. KnowledgeTree Migration Mapping Proposal

Based on the KnowledgeTree CE 3.7.0.2 export file list provided (`01_folders.tsv`, `02_documents.tsv`, `03_versions_filemap.tsv`, `04_transactions.tsv`, `06_corp_folder_permissions.tsv`, `07_corp_permission_matrix.tsv`, `09_corp_role_allocations.tsv`, `blobs/`, `reconstructed/`, `dms_full_2026-07-30.sql.gz`) mapped against the **actual, current** new-DMS schema documented above:

| KnowledgeTree source | New DMS destination |
|---|---|
| `01_folders.tsv` (folder) | `dms_folders` — one row per legacy folder; `parent_folder_id` rebuilt from the legacy parent-child relationship via the folder legacy-ID mapping table (§17); `owner_id` resolved via the user mapping table; no column exists for the legacy folder ID itself — record it only in the external mapping table, not in `dms_folders` |
| `02_documents.tsv` (document) | `dms_documents` — `title`, and mandatory `description`/`category`/`department` synthesized/defaulted where KnowledgeTree has no direct equivalent (see §11); legacy document number/ID → `dms_documents.original_document_id` (the one column reserved for this purpose, case-insensitive-unique); `folder_id` resolved via the folder mapping table; `owner_id` via the user mapping table |
| `03_versions_filemap.tsv` (content version + blob/file) | `dms_document_versions` (one row per legacy content version) + a corresponding object uploaded into the `dms-documents` MinIO bucket under key `documents/{new_document_id}/{new_version_id}/{original_file_name}`; `sha256_hash` recomputed from the actual blob content at migration time (KnowledgeTree's own checksum, if present in `blobs/`/`reconstructed/`, is not directly reusable since the column expects SHA-256 specifically); `version_number`/`version_label` derived from KnowledgeTree's version sequence; `created_at` set directly from the legacy version's real timestamp (only possible via direct SQL/service-layer insert, not the REST API — §6/§18); `submitted_by_id`/uploader mapped via the user mapping table if KnowledgeTree records a per-version author (verify against the actual `03_versions_filemap.tsv` column set — this document does not have access to that file's real column names, only the general "content version" concept named in the task) |
| `blobs/` / `reconstructed/` (raw file content) | Uploaded as MinIO objects, one per migrated version, per the key scheme above; `file_size_bytes`/`mime_type` derived from the actual file at upload time (MIME can be guessed from the file extension/content, since the new DMS does no server-side MIME validation to satisfy — see §7/§19) |
| `04_transactions.tsv` (audit/transaction log) | `dms_audit_trails`, inserted **directly via SQL only** (no REST API write path exists for this table — §12/§20) with historical `created_at`/`user_id` preserved and `action` mapped to the closest matching `AuditActions` constant (§12) where a reasonable match exists; any legacy event/action type with no matching constant should either be logged under a clearly-labeled generic fallback action (e.g. a new constant added specifically for migrated legacy events) or recorded with the original KnowledgeTree action name as a free-text `action` value (the column has no CHECK constraint restricting it to the known constant list, so this is technically permitted, though it means the new DMS's own UI/filters — which are built around the known constants — won't specially recognize it) |
| `06_corp_folder_permissions.tsv` (folder permission) | `dms_folder_permissions` — legacy per-folder-per-user permission rows mapped to the closest of the five new-DMS role values (`Reader`/`Writer`/`Manager`/`QA`/`Admin`); the mapping from KnowledgeTree's own permission vocabulary to these five values is **not determinable from this codebase alone** — it depends entirely on what roles/permission levels KnowledgeTree CE 3.7.0.2 actually exposes, which is outside this repository; flag as a required input from the KnowledgeTree side before this mapping can be finalized |
| `07_corp_permission_matrix.tsv` (permission — finer-grained, if this represents action-level rather than role-level grants) | Likely best mapped to `dms_access_overrides` (the new DMS's own finer-grained, action-level tri-state permission layer) rather than `dms_folder_permissions`, **if** KnowledgeTree's "permission matrix" represents individual action grants (read/write/delete/etc.) rather than a single named role per user/folder — this determination requires inspecting the actual KnowledgeTree file, which is outside this repository's scope; if it does represent action-level grants, each legacy permission-matrix row would become one `dms_access_overrides` row scoped to the corresponding folder, targeting the corresponding user (`target_type='User'`) or role/group, with the relevant one of the 25 tri-state action columns (§10) set to Allow (`true`) |
| `09_corp_role_allocations.tsv` (role) | Depends on what KnowledgeTree "roles" represent: if they are folder-scoped access levels, map into `dms_folder_permissions.role`; if they are a global, app-wide role concept (e.g. "Administrator," "Author," "Reader" at the *system* level, not per-folder), map into a corresponding `dms_page_access_roles` row (possibly requiring new custom roles to be created via `POST /api/page-access-roles`, beyond the 5 pre-seeded built-in roles) and assign via `dms_users.role`. **This determination also requires inspecting the actual KnowledgeTree export**, which is outside this repository. |
| Custom metadata fields (mentioned generally in the task, not tied to a specific listed export file — likely embedded within `02_documents.tsv` or a separate metadata export not listed) | No structured destination exists (§11) — best-effort mapping onto `dms_documents.category`/`department`/`tags`/`description` for fields with a clear semantic match; anything else requires either a lossy freeform-text fallback or new schema/columns as a prerequisite development task |
| `dms_full_2026-07-30.sql.gz` | A full KnowledgeTree database dump — useful as the authoritative source for resolving every ambiguity flagged above (exact column names/types in `03_versions_filemap.tsv`, the real semantics of `06_corp_folder_permissions.tsv` vs `07_corp_permission_matrix.tsv` vs `09_corp_role_allocations.tsv`, and any comments/custom-metadata table structure KnowledgeTree itself uses) — inspecting this dump is a **necessary next step** before the mapping table above can be finalized with confidence, since this document only has access to the new DMS's side of the mapping. |

---

## 26. Information Still Missing for Migration

### Critical blockers

1. **KnowledgeTree's own schema/export column structure has not been inspected in this pass** (no access to the actual `.tsv` files or the `dms_full_2026-07-30.sql.gz` dump was part of this task's scope — this document only covers the *new* DMS's side). Every row in the §25 mapping table that says "requires inspecting the actual KnowledgeTree file" is a hard blocker until that inspection happens.
2. **No structured custom-metadata destination exists in the new DMS** (§11) — if KnowledgeTree carries a meaningful volume of custom fields beyond Category/Department/Tags/Description/a single Doc-ID field, a decision is needed (accept lossy folding into `description`, use the underused `dms_document_metadata.custom_data` JSON-blob column with new supporting code, or commission new dedicated columns) **before** the document-import step of the migration can be finalized.
3. **No legacy-ID field exists for folders, users, groups, or versions** (only documents have `original_document_id`) — the external mapping table (§17) must be built and populated as a first step; every subsequent migration step (folders before documents before versions before permissions) depends on it being correct and complete.
4. **The mapping from KnowledgeTree's permission/role vocabulary to the new DMS's three permission systems (folder-role grant / access override / page-access role) cannot be determined from this codebase alone** (§10, §25) — needs the actual KnowledgeTree permission model documented/inspected before `06_corp_folder_permissions.tsv`/`07_corp_permission_matrix.tsv`/`09_corp_role_allocations.tsv` can be correctly translated.
5. **No REST API path preserves historical timestamps/authors** (§6, §12, §18) — a decision is needed on whether historical fidelity (original creation dates, original uploader/author identity, original audit-trail dates) is a hard requirement. If yes, the migration **must** use direct database insertion (Option C, §16) for documents/versions/audit-trail history, not the REST API.
6. **File-size limits for the bulk MinIO upload are not established** (§7, §22) — before migrating potentially very large legacy files, confirm what (if any) practical ceiling exists given `MinioService.DownloadAsync`'s fully-in-memory buffering behavior and the complete absence of a server-configured upload-size limit at the API layer.

### Non-critical items

1. `dms_document_metadata`'s actual current usage (§2, §11) is unconfirmed — worth a quick runtime check (not done in this read-only pass) before assuming it's safe to repurpose for legacy custom-field data.
2. `DmsWorkflow`/`DmsWorkflowStep`/`DmsWorkflowTemplate`'s liveness is unconfirmed (§2) — irrelevant to migration unless KnowledgeTree's own workflow/approval-routing concept needs a destination, in which case this should be re-investigated first.
3. The exact migration number that added `dms_document_versions.version_label` was not pinned down in this pass (a minor traceability gap, not a functional blocker).
4. `dms_esignatures` appears to be a dead/unused feature end-to-end (no writing code path found) — if KnowledgeTree has legacy e-signature data, there is currently nowhere in the new application for it to surface even if inserted directly into the table.
5. Whether `dms_groups`' plain-`TIMESTAMP` (no timezone) columns matter for migration fidelity is a minor edge case, only relevant if precise group-creation timestamps must be preserved down to timezone-correct precision.
6. Current live row counts (§24) were not collected — useful context for capacity/performance planning of the actual migration run, but not a blocker to designing the migration itself.

---

## 27. Migration Readiness Summary

```text
Folder migration:      PARTIAL — schema and object model are straightforward (self-referencing tree,
                        UNIQUE(parent,name)), but no legacy-folder-ID field exists anywhere in the
                        schema; requires an external mapping table before any folder can be created
                        with correct parent-child relationships preserved. No blocker beyond that.

Document migration:    PARTIAL — original_document_id gives a clean home for a legacy document
                        number, but Title/Description/Category/Department are all mandatory
                        (server-enforced) with no KnowledgeTree equivalent guaranteed for the
                        latter three; requires synthesized defaults or a pre-migration Company
                        Data dropdown-value setup pass.

File migration:        PARTIAL — MinIO upload + SHA-256 hashing is a clear, well-understood
                        mechanism (documented in full in §7), but no file-size ceiling is
                        established/tested, MinioService buffers whole files in memory on
                        download (a migration-tooling-side concern, not a blocker to writing),
                        and there is no automatic orphan-cleanup if a script crashes between
                        the MinIO upload and the corresponding DB insert (script must handle
                        this itself, per §20).

Version history:       PARTIAL — the version model itself (major/minor + free-text label +
                        SHA-256 + status) can represent an arbitrary version chain faithfully,
                        but only if migrated via direct DB insert; the REST API forces every
                        version's created_at to "now" and its submitted_by_id to the calling
                        script's own identity, losing historical authorship/dates if that path
                        is used instead.

Users:                  READY — Email + FullName are the only hard requirements; password is
                        optional (SSO-only accounts supported); no legacy-user-ID field exists
                        (requires the external mapping table, same as folders) but this is a
                        process requirement, not a schema blocker.

Groups:                 READY — flat membership and real nested-subgroup support both exist and
                        map cleanly onto typical legacy group structures; only the DB-level
                        self-nesting CHECK exists (deeper-cycle prevention is app-layer only, so
                        a direct-SQL import must independently guard against importing a genuine
                        legacy cycle, if KnowledgeTree's group model could ever produce one).

Permissions:            BLOCKED — pending inspection of KnowledgeTree's actual permission/role
                        model (07_corp_permission_matrix.tsv / 06_corp_folder_permissions.tsv /
                        09_corp_role_allocations.tsv). The new DMS's three-layer permission system
                        (folder-role grant / tri-state access override / page-access role) is
                        fully documented here (§9, §10), but the mapping FROM KnowledgeTree's side
                        cannot be determined from this codebase alone.

Metadata:               BLOCKED — no generic custom-metadata/custom-fields system exists in the
                        new DMS (§11). Any KnowledgeTree custom field beyond Category/Department/
                        Tags/Description/a single Doc-ID equivalent has no structured destination
                        without either a lossy fallback or new schema/development work, which is a
                        decision that must be made (and possibly implemented) before this can move
                        to READY/PARTIAL.

Audit history:          PARTIAL — dms_audit_trails can technically receive historical rows with
                        original timestamps and mapped user IDs via direct SQL insert (no trigger
                        blocks INSERT, only UPDATE/DELETE), and the ~70 existing AuditActions
                        constants cover most application-native event types — but there is no
                        REST API write path at all for this table, the action-type vocabulary
                        would need explicit mapping from KnowledgeTree's own event/transaction
                        types (04_transactions.tsv, not inspected in this pass), and once inserted
                        these rows become permanently immutable (WORM), so the mapping must be
                        correct before that insert happens — there is no fix-it-later path.
```

**Overall assessment:** the new DMS's core document/folder/version/user/group model is solid and well-understood from this codebase alone, and direct-database population (Option C, §16) is both technically supported and — per §18/§20 — actually *necessary* if historical fidelity (dates, authors, audit history) matters. The two genuine blockers are **not** schema/code gaps that need fixing in the new DMS, but rather **missing information about KnowledgeTree's own export format and permission/role model**, which this document could not resolve since it was scoped to read-only discovery of the new DMS's codebase only. The custom-metadata gap (§11) is the one place where the new DMS's *own* schema is genuinely under-built relative to what a mature legacy DMS migration typically needs, and is worth flagging to the team as a possible small scope-of-work item (new columns, or wiring up the existing but unused `dms_document_metadata` table) rather than something a migration script alone can work around cleanly.
