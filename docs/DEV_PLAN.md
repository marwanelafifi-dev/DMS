# Enterprise DMS v7.4 — Development Plan & Architecture

> Companion to [PRD.md](PRD.md). This document captures the technical strategy, stack decision, deployment path, database design, and phased delivery roadmap for building the DMS in-house.

---

## 1. Guiding Principles

- **Sovereignty first.** 100% on-premises. No service depends on external SaaS at runtime. Air-gappable.
- **Compliance is the backbone, not a feature.** ISO 27001:2022 (ISMS) + ISO 9001:2015 (QMS). RBAC, WORM audit trails, and PKI are built in Phase 1, not bolted on later.
- **Portability by construction.** The same Docker Compose stack runs on local Windows and on Ubuntu — Linux containers, named volumes, env-driven config, no hardcoded hosts or drive paths.
- **Right tool per job.** Enterprise/RBAC/PKI logic in .NET; OCR + local LLM/RAG in Python. Each language where it is strong.

---

## 2. Technology Stack

| Layer | Choice | Rationale |
| :-- | :-- | :-- |
| **Frontend** | React + TypeScript (Vite) + Tailwind | Canvas viewer, RBAC-aware UI, watermarking, dashboards |
| **Core API** | **.NET 8 Web API (C#)** | First-class PKI/X.509, crypto, fine-grained authz; strong on-prem story; long-term maintainability for an audited system |
| **Background jobs** | Hangfire (in .NET) | Reminder scheduler, email dispatch, OCR queue, with a persistent dashboard |
| **OCR + RAG sidecar** | **Python FastAPI** | Tesseract/PaddleOCR + local LLM weights are Python-native; called internally by the .NET API |
| **Database** | PostgreSQL 16 | Native JSONB, full-text search (OCR index), row-level security; PRD schema is already Postgres |
| **Object storage** | MinIO (S3-compatible, self-hosted) | Immutable binary payloads + WORM object-lock buckets |
| **Cache / job state** | Redis | Session/cache + Hangfire/queue backing |
| **Auth** | Google Workspace OAuth SSO + local MFA (TOTP) | Requirement #1; 15-min idle timeout |
| **Preview / canvas** | LibreOffice headless → rasterize; PDF.js | Server-side "no-download" streamed frames + dynamic watermark |
| **Edge exposure** | Cloudflare Tunnel (`cloudflared`) | Outbound-only, no inbound ports/public IP; optional Cloudflare Access as outer auth layer |
| **Packaging** | Docker Compose (single-node) → K8s optional later | On-prem, portable Windows → Ubuntu |

> **Stack fallback:** if the maintaining team is strongly JavaScript-first with no C# experience, substitute **NestJS (Node/TS)** for the core API to get one language across the stack — at the cost of some PKI/enterprise-library polish. The stack should match the long-term maintainers.

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────┐
│  React + TS (Vite)  — canvas viewer, RBAC UI      │
└───────────────┬─────────────────────────────────┘
                │ HTTPS (internal)
┌───────────────▼─────────────────────────────────┐
│  .NET 8 Web API  — auth, RBAC, workflows,         │
│  versioning, checkout locks, audit ledger         │
│  + Hangfire (reminders, email, job queue)         │
└───┬───────────┬───────────────┬─────────────────┘
    │           │               │ (internal call)
┌───▼──┐   ┌────▼────┐   ┌───────▼──────────┐
│ Post │   │  MinIO  │   │ Python FastAPI   │
│ gres │   │ (WORM   │   │ OCR + local RAG  │
│ +FTS │   │ object  │   │ (Tesseract/LLM)  │
│      │   │ lock)   │   │                  │
└──────┘   └─────────┘   └──────────────────┘
    ▲
 Redis (cache + job state)

  [ cloudflared ]  ← Stage 2 only; outbound tunnel to Cloudflare edge
```

**WORM enforced at two levels** (app-level immutability alone will not pass an ISO audit):
1. **Database:** a dedicated Postgres role whose grants exclude `UPDATE`/`DELETE` on `dms_audit_trails` (and other log tables); connection privileges dropped for such statements.
2. **Object storage:** MinIO object-lock (compliance mode) on stored binaries and released document versions.

---

## 4. Deployment Path

### Stage 1 — Local Docker on Windows (dev / evaluation)
- Full stack via `docker compose up`, served at `localhost`.
- **All Linux containers** (`.NET` on the Linux runtime — no Windows containers).
- **Named Docker volumes** for Postgres/MinIO data — never `C:\` bind mounts.
- All config via `.env` (hostnames, ports, secrets, storage keys).

### Stage 2 — Ubuntu + Cloudflare Tunnel (exposure)
- Same compose file moves to Ubuntu unchanged; enable a `cloudflared` service via a compose profile / override.
- Tunnel dials **out** to Cloudflare — no inbound ports, no public IP, no firewall changes.
- TLS terminates at Cloudflare's edge; internal services stay plain HTTP on the Docker network.
- Add **Cloudflare Access** (integrates with Google Workspace SSO) as an outer auth layer — defense in depth.

> **Compliance note to record:** a public tunnel means in-transit traffic transits Cloudflare's edge (data *at rest* stays fully on-prem). For ISO 27001 this is normally an acceptable, documented, encrypted control. If strict data-plane isolation is mandated, replace the public tunnel with a WireGuard/VPN into the host. Decide before Phase 6.

---

## 5. Database Schema — Full Table Inventory

The PRD (§7) only specifies the *add-on* tables. The complete schema must also include the core tables below. Detailed DDL to be written in the "Full DB Schema" step of Phase 0/1.

**Core (to design):**
- `dms_users` — identity, role, SSO subject, MFA secret, status
- `dms_folders` — folder tree (parent_id, path), classification defaults
- `dms_folder_permissions` — folder-scoped RBAC (user/role → Reader/Writer/Manager/QA/Admin)
- `dms_documents` — logical document (folder_id, current_version_id, tracking_code, status)
- `dms_document_versions` — per-version binary ref, major/minor, SHA-256 hash, checkout flags
- `dms_metadata` / `dms_metadata_schemas` — extensible key-value metadata per folder tree
- `dms_tasks` — native tasks module (workflow tasks, PCAR actions, RCA fields)
- `dms_workflows` / `dms_workflow_steps` — C-Doc & PCAR state machines, in-flight modifiability
- `dms_retention_policies` — classification → Archive / Soft Delete / WORM Lock

**Add-on (from PRD §7):** `dms_audit_trails`, `dms_ocr_indexes`, `dms_esignatures`, `dms_reminders`, plus the `dms_document_versions` checkout columns.

---

## 6. Phased Roadmap

Each phase lists deliverables and acceptance criteria. Build compliance primitives (RBAC + WORM) first.

### Phase 0 — Foundations
- Monorepo: `/api` (.NET), `/web` (React), `/ocr-rag` (Python), `/infra` (compose, env, migrations).
- Portable Docker Compose stack (Postgres, MinIO, Redis, API, web, OCR sidecar); `cloudflared` stubbed behind a profile.
- CI (build/test/lint), migration tooling, `.env.example`.
- **Acceptance:** `docker compose up` on Windows brings the full stack healthy at `localhost`; identical file runs on Ubuntu.

### Phase 1 — Core Vault + RBAC + WORM
- Folder tree, multi-select upload to MinIO, core schema, folder-scoped permission matrix (PRD §6).
- Audit-log ledger with DB-level WORM constraints + MinIO object-lock.
- **Acceptance:** permission matrix enforced per role; any `UPDATE`/`DELETE` on audit tables is rejected at the DB; uploads land in object storage with correct scoping.

### Phase 2 — Three Access Channels (PRD §3)
- View-only canvas with dynamic watermark (username + IP + timestamp); downloads/copy/right-click/print blocked.
- Download-Without-Edit (no locks).
- Download-For-Editing exclusive checkout (single-user lock) + check-in with change description; admin force-unlock with mandatory justification → audit snapshot + user alert.
- **Acceptance:** only one active lock per version; force-unlock writes to WORM ledger and notifies the original holder.

### Phase 3 — Version Engine + Numbering
- Minor/major versioning, rollback with justification, SHA-256 hashing.
- Atomic tracking code `[DEPT]-[YEAR]-[CATEGORY]-[SEQ]` generated on final QA release.
- **Acceptance:** minor increments on check-in/self-correction; major on release; hash recorded in ledger; codes unique and sequential.

### Phase 4 — Workflow Engines
- **C-Doc:** upload → QA pre-manager task injection → manager approve/reject (revert-to-member or self-correct) → final QA release gate.
- **PCAR:** QA triage + severity → enforced RCA (empty rejected) → Track B manager review → QA close.
- In-flight modifiability (insert/skip steps) gated by text justification (Req #8).
- **Acceptance:** each gate enforces its lock/unlock rules exactly as specified; RCA field mandatory; all transitions logged.

### Phase 5 — Subsystems
- Local OCR pipeline → Postgres full-text index; in-app content search.
- Reminders: real-time app notifications + scheduled SMTP email.
- PKI e-signing with permanent stamp overlay (name, verification hash, email, timestamp).
- Extensible metadata schemas per folder tree.
- **Acceptance:** OCR text searchable post-upload; reminders fire on due dates; signatures verify against stored hash.

### Phase 6 — Intelligence, Retention & Hardening
- CAP reporting/dashboards (approval-cycle + PCAR analytics).
- Permission-aware local RAG assistant — DB pre-filter against access tables **before** vector search (Req #12).
- Automated retention policies (Archive / Soft Delete / WORM Lock).
- Security hardening, pen-test, Cloudflare Access, ISO evidence pack; finalize the tunnel-vs-VPN data-plane decision.
- **Acceptance:** RAG never returns content outside the user's access scope; retention runs automatically per classification; audit evidence exportable.

---

## 7. Immediate Next Steps

1. Scaffold the monorepo + portable Docker Compose stack (Phase 0).
2. Write the complete PostgreSQL DDL (§5) including WORM roles/constraints.
3. Implement Phase 1 (RBAC + audit ledger) as the compliance foundation.
