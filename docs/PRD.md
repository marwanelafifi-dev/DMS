# Enterprise Document Management System (DMS) v7.4
## Absolute Master Product Requirements Document (PRD)
### Vault Access Paradigm & Core Compliance Infrastructure Specification

---

## Document Control & Metadata

| Field | Value |
| :--- | :--- |
| **Document Version** | 7.4 (Golden Baseline Specification) |
| **Hosting Infrastructure** | 100% On-Premises Isolated Local Cloud Boundary |
| **Compliance Targets** | ISO 9001:2015 (QMS) & ISO 27001:2022 (ISMS) |
| **Access Paradigm** | Three Explicit Commands (View / Download Without Edit / Download For Editing with Lock) |
| **Internal Editing** | Completely Removed. Modifications occur offline via exclusive lock checkout. |
| **Core Services** | Local OCR, App/Email Reminders, PKI E-Signing, WORM Security Logs, Admin Permissions Console |
| **Date** | July 15, 2026 |

---

## 1. Executive Summary & Sovereignty Mandate

The **Enterprise Document Management System (DMS) v7.4** is the finalized corporate specification for a local-hosted quality (QMS) and information security (ISMS) platform. Designed for strict compliance with ISO 9001:2015 and ISO 27001:2022 standards, this local architecture guarantees 100% data isolation, safeguarding quality logs, metadata, and document lifecycles within private, on-premises corporate infrastructure.

To preserve file integrity and eliminate version collisions, the platform completely blocks all in-system or native web editing capabilities. Instead, it functions as a secure repository vault. User interactions are partitioned into three explicit commands: server-side canvas streaming, lockless document downloads for review, and single-user exclusive checkout locks for offline revisions.

---

## 2. Dual Core Compliance Workflows

All system files and corrective action loops are executed through two formal, database-driven workflows that provide managers with pipeline transparency and QA with final verification authority.

### 🔒 Workflow 1: C-Doc — Controlled Document Path (The Master Document Flow)

1. **First Upload & Auto-Prompt:** A folder member conducts a multi-select upload. The user interface instantly prompts a unified "Submit for Approval" workspace trigger.
2. **QA Pre-Manager Task Injection Option:** Uploaded drafts hit a staging gateway. The direct supervisor can immediately view the file via the read-only preview canvas, but their approval controls are disabled. QA can either accept the draft (unlocking the manager's approval button) or inject a correction task (locking manager approval with a tooltip warning until the assignee uploads the fix offline and marks the task as completed).
3. **Direct Manager Approval & Rejection Options:** Supervisors review the document. Rejections require a comment and a choice between two resolution tracks:
   * **Option 1 (Revert to Team Member):** Issues a correction task to an employee. Manager approval locks until the user resolves the task and re-uploads the fix.
   * **Option 2 (Direct Self-Correction):** The manager uploads the corrected version directly into the modal. Minor version row counters increment automatically, and the file passes straight to final QA (bypassing Stage 2).
4. **Final QA Approval & Release Gate:** The terminal compliance gate. QA runs a final validation check, generates a custom atomic tracking code (`[DEPT]-[YEAR]-[CATEGORY]-[SEQ]`), records a permanent SHA-256 binary file hash in the append-only ledger, and releases the document as `RELEASED`.

### 🔄 Workflow 2: PCAR — Post-Audit Corrective Action Loop

1. **QA First Gate Triage:** Auditor findings are logged. QA reviews the comment, sets risk severity (Minor, Major, Critical), and determines the owner: Track A goes straight to the manager for systemic fixes, while Track B targets a team member for simple adjustments (with the manager retaining full live dashboard tracking rights).
2. **Enforced Root Cause Analysis (RCA):** The database blocks task completion until the assignee populates a mandatory text-based Root Cause Analysis (RCA) field and defines preventive actions. Empty inputs are rejected.
3. **Manager Review Layer (For Track B):** If a team member executes the fix, it routes to their direct manager first for operational approval before reaching QA.
4. **QA Final Close Gate:** QA verifies the evidence, closes the action item, and permanently writes the history trace into the unalterable system log.

---

## 3. Document Access Control & Segmented Vault Architecture

To prevent data leakage while enabling business productivity, standard document interactions are split into three explicit channels governed by folder-scoped Role-Based Access Control (RBAC):

### Function 1: View Only (Universal Canvas View)
Standard file preview is open natively to all authenticated system users who possess baseline directory clearance. Payload binary data is processed entirely server-side and rendered as secure viewport canvas frames. File downloading, clipboard copying, context menus, right-clicks, and hardware printing commands are systematically blocked. A high-density, transparent background security watermark displaying the active session's username, IP address, and timestamp is dynamically stamped over the preview canvas workspace.

### Function 2: Download Without Edit (Read-Only Copy)
Grants privileged users (Managers, QA Specialists/Auditors, and System Administrators) immediate access to download a copy of the raw binary payload for reference, offline reading, printing, or attaching to emails. **The system applies zero repository locks;** the source document row remains open, available, and accessible to all other production streams.

### Function 3: Download For Editing (Lock-Controlled Checkout)
Restricted via folder-scoped permissions panels to roles with write permissions. Clicking this button writes an exclusive lock flag token to the database version row (`is_checked_out = TRUE`, `checked_out_by = USER_ID`). The system enforces a **strict single-user condition:** only one user can hold an active checkout lock at any given time. Alternative modification checkouts are blocked, and other users attempting an edit download are forced into a read-only state. Upon checking the corrected file back in, the user provides a change description, minor versions increment, and the checkout state releases.

**Administrative Force-Unlock Override:** If an editor goes on unexpected leave or leaves their workspace with an active lock, the System Administrator can trigger a master override from the admin dashboard to break the lock. Triggering an unlock blocks the workspace with a mandatory pop-up window requiring a clear text justification reason. Once saved, the database token clears, an alert notification is pushed to the original user, and an audit trail snapshot is permanently committed to the unalterable WORM ledger.

---

## 4. Advanced Subsystem Implementations & Controls

### A. Rigorous Version Control Engine
The platform enforces a multi-branch version tracking schema. Draft modifications automatically increment minor revisions (e.g., v1.1, v1.2). Formal deployment authorizations at the final QA Release Gate promote the file to major status baselines (e.g., v2.0). Authorized administrators can trigger historical rollbacks to restore previous version nodes, automatically writing a change justification block entry to the ledger.

### B. Local OCR Extraction Engine
An on-premises optical character recognition service scans incoming documents, image arrays, and scanned PDFs immediately following upload. Text extraction runs entirely within local corporate server boundaries. The parsed data is structured and written to full-text database search indexes, enabling instant in-app content queries.

### C. Sovereign Reminders & Notification System
The system runs a dual notification scheduling manager:
* **Local App Notifications:** Real-time push alerts arrive instantly on user viewports for active workflow task assignments, manager rejections, and triage updates.
* **Email Notifications:** Scheduled backend service checks evaluate approaching due dates and dispatch reminders (e.g., upcoming review cycles or pending PCAR actions) through the company's local corporate SMTP mail server.

### D. Extensible Metadata Structuring
Every document version carries an extensive metadata row. Beyond default properties (owner ID, timestamps, file size, classification levels), the central admin panel allows managers to define custom metadata key-value schemas based on the target folder tree.

### E. Local Cryptographic E-Signing Module
To meet signature regulations securely on-premises, the platform implements localized PKI signature bindings. When an approver signs off, the module maps the active session to a private cryptographic sign-off token. A visual signature stamp overlay—displaying the user's full name, verification hash, email address, and timestamp—is rendered permanently into the historical document view layer.

### F. Write-Once-Read-Many (WORM) Audit Logs & Trails
To preserve unalterable records for ISO surveillance compliance audits, a read-only system logging engine tracks all platform events. Database-level constraints drop connection privileges for any incoming `UPDATE` or `DELETE` statements targeting log tables. It captures all login attempts, checkout locks, download actions, approvals, and workflow template alterations.

---

## 5. Consolidated Functional Requirements Matrix

| # | Enterprise Feature | Priority Status | Scope & Functional Acceptance Criteria |
| :-: | :--- | :-: | :--- |
| **1** | **MFA & Directory Sync** | **MUST HAVE** | Google Workspace OAuth SSO + Secure Local MFA for local users. 15-minute idle session timeout. |
| **2** | **Multi-Select Upload** | **MUST HAVE** | Supports drag-and-drop and multi-select file uploads directly into directories, grouping them into a single batch approval prompt. |
| **3** | **Immediate Upload Prompt** | **MUST HAVE** | Fires a "Submit for Approval" prompt immediately upon upload completion to trigger the C-Doc workflow. |
| **4** | **Document Numbering** | **MUST HAVE** | Custom numbering schemes automatically generated and applied on final QA release approval. |
| **5** | **Universal Preview Viewer** | **MUST HAVE** | Universal high-fidelity, no-download canvas rendering enabling in-app document viewing for **all system users**. |
| **6** | **Dual Editor Integrations** | **MUST HAVE** | No native editing. Alternate extensions open in secure, sandboxed tabs. |
| **7** | **Post-Edit Approval Flow** | **MUST HAVE** | Closing an active edit session triggers a pop-up prompt to "Submit for Approval" to resume the routing process. |
| **8** | **In-Flight Modifiability** | **MUST HAVE** | Admins and QA can insert steps or skip reviewers mid-flight. Action is blocked until a text-based change justification is provided. |
| **9** | **Automated Retention** | **MUST HAVE** | Enforces automated retention policies based on document classification tags (Archive, Soft Delete, or WORM Lock). |
| **10**| **Reporting & Dashboards** | **MUST HAVE** | Local Collect-Analyze-Present (CAP) dashboard engine rendering approval cycle and PCAR performance analytics. |
| **11**| **Native Tasks Module** | **MUST HAVE** | Built-in, self-contained tasks module managing audit actions and PCAR RCA tracking. |
| **12**| **Permission-Aware AI** | **RAG-AI** | RAG query assistant running on private, local LLM weights. Enforces database pre-filtering against user access tables before vector search. |

---

## 6. Centralized Control Panel Permissions Matrix

Permissions are governed and distributed securely via folder-scoped matrices in the Admin Panel:

| Platform Folder Role | In-App Canvas View | Download Without Editing | Download For Editing (Locking) | Admin Force-Unlock Override |
| :--- | :---: | :---: | :---: | :---: |
| **Folder Member (Reader)** | ✅ Allowed Universally | ❌ Denied | ❌ Denied | ❌ Denied |
| **Folder Member (Writer)** | ✅ Allowed Universally | ✅ Allowed (Scoped) | ✅ Allowed (Exclusive Lock) | ❌ Denied |
| **Folder Manager** | ✅ Allowed Universally | ✅ Allowed (Assigned Scope) | ✅ Allowed (Exclusive Lock) | ❌ Denied |
| **QA Specialist / Auditor** | ✅ Allowed Universally | ✅ Allowed (Global Scope) | ✅ Allowed (Exclusive Lock) | ❌ Denied |
| **System Administrator** | ✅ Allowed Universally | ✅ Allowed (Global Scope) | ✅ Allowed (Exclusive Lock) | ✅ Allowed (Global Override) |

---

## 7. Comprehensive Database Schema Configuration

```sql
-- Immutable audit log ledger (WORM protection enforced)
CREATE TABLE dms_audit_trails (
    log_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    action      VARCHAR(255) NOT NULL, -- DOWNLOAD_VIEW, DOWNLOAD_EDIT, FORCE_UNLOCK
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Checkout locks tracks concurrency control
ALTER TABLE dms_document_versions
ADD COLUMN is_checked_out BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN checked_out_by UUID REFERENCES dms_users(user_id);

-- Stores searchable on-premises OCR text
CREATE TABLE dms_ocr_indexes (
    ocr_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE CASCADE,
    extracted_text  TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stores local cryptographic e-signatures
CREATE TABLE dms_esignatures (
    signature_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,
    signature_hash  TEXT NOT NULL,
    signature_meta  JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Local notifications queue
CREATE TABLE dms_reminders (
    reminder_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES dms_tasks(task_id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL,
    reminder_type   VARCHAR(20) NOT NULL CHECK (reminder_type IN ('APP', 'EMAIL', 'BOTH')),
    due_date        DATE NOT NULL,
    is_sent         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
