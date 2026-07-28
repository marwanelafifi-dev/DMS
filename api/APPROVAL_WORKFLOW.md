# Document Approval Workflow — Phase 2

## نظرة عامة
نظام الموافقة على المستندات. بعد إنهاء التعديلات، يرسل المستخدم المستند للموافقة. المدير يراجعه ويوافق أو يرفض.

---

## المراحل

```
┌──────────────┐
│   Draft      │
│ (not locked) │
└──────┬───────┘
       │ User edits + uploads new version
       │
┌──────▼──────────────┐
│   Draft (unlocked)  │
│ after checkin       │
└──────┬──────────────┘
       │ POST /submit
       │
┌──────▼──────────────────────┐
│ Pending Approval            │
│ (waiting for manager review)│
└──────┬───────────┬──────────┘
       │           │
  POST /approve  POST /reject
       │           │
┌──────▼──┐   ┌───▼──────┐
│Released │   │ Rejected  │
│(LIVE)   │   │(back to   │
│         │   │ draft)    │
└─────────┘   └───┬───────┘
              (can edit &
               resubmit)
```

---

## API Endpoints

### 1️⃣ POST /api/documents/{id}/submit
**Submit for approval**

```bash
curl -X POST \
  -H "X-User-Id: user-123" \
  -H "Content-Type: application/json" \
  -d '{"versionId": "uuid-version", "comment": "Ready for review"}' \
  http://localhost:8080/api/documents/{docId}/submit
```

**Request:**
```json
{
  "versionId": "uuid-version",  // required
  "comment": "Ready for review"  // optional
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "documentId": "uuid-doc",
    "versionId": "uuid-version",
    "status": "pending_approval",
    "submittedAt": "2026-07-16T14:30:00Z",
    "message": "Document submitted for approval"
  }
}
```

**Error Cases:**
```json
// Cannot submit checked out document
{
  "success": false,
  "error": "Cannot submit checked out document"
}

// Cannot submit released/archived documents
{
  "success": false,
  "error": "Cannot submit released document for approval"
}
```

---

### 2️⃣ POST /api/documents/{id}/approve
**Manager approves document**

```bash
curl -X POST \
  -H "X-User-Id: manager-123" \
  -H "Content-Type: application/json" \
  -d '{"versionId": "uuid-version", "comment": "Approved. Good to release."}' \
  http://localhost:8080/api/documents/{docId}/approve
```

**Request:**
```json
{
  "versionId": "uuid-version",  // required
  "comment": "Approved..."       // optional
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "documentId": "uuid-doc",
    "versionId": "uuid-version",
    "status": "released",
    "approvedAt": "2026-07-16T14:35:00Z",
    "message": "Document approved and released"
  }
}
```

**Error Cases:**
```json
// Only manager can approve
{
  "success": false,
  "error": "You don't have permission to approve"
}

// Wrong status
{
  "success": false,
  "error": "Cannot approve released document"
}
```

---

### 3️⃣ POST /api/documents/{id}/reject
**Manager rejects document**

```bash
curl -X POST \
  -H "X-User-Id: manager-123" \
  -H "Content-Type: application/json" \
  -d '{"versionId": "uuid-version", "reason": "Please add watermark to all pages"}' \
  http://localhost:8080/api/documents/{docId}/reject
```

**Request:**
```json
{
  "versionId": "uuid-version",  // required
  "reason": "Please add..."      // required
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "documentId": "uuid-doc",
    "versionId": "uuid-version",
    "status": "rejected",
    "rejectedAt": "2026-07-16T14:40:00Z",
    "rejectionReason": "Please add watermark to all pages",
    "message": "Document rejected"
  }
}
```

**After Rejection:** User can edit again and resubmit

---

### 4️⃣ GET /api/documents/{id}/approval-status
**Check approval status**

```bash
curl -H "X-User-Id: user-123" \
  "http://localhost:8080/api/documents/{docId}/approval-status?versionId=uuid-version"
```

**Response (Pending):**
```json
{
  "success": true,
  "data": {
    "versionId": "uuid-version",
    "documentId": "uuid-doc",
    "versionNumber": "1.0",
    "status": "pending_approval",
    "submittedBy": "محمد أحمد",
    "submittedAt": "2026-07-16T14:30:00Z",
    "approvedBy": null,
    "approvedAt": null,
    "approvalComment": null,
    "isPending": true,
    "isApproved": false,
    "isRejected": false
  }
}
```

**Response (Approved):**
```json
{
  "success": true,
  "data": {
    "status": "released",
    "submittedBy": "محمد أحمد",
    "submittedAt": "2026-07-16T14:30:00Z",
    "approvedBy": "علي محمود",
    "approvedAt": "2026-07-16T14:35:00Z",
    "approvalComment": "Approved. Good to release.",
    "isPending": false,
    "isApproved": true,
    "isRejected": false
  }
}
```

---

### 5️⃣ GET /api/documents/pending-approvals/list
**List all pending approvals (for manager dashboard)**

```bash
curl -H "X-User-Id: manager-123" \
  "http://localhost:8080/api/documents/pending-approvals/list?folderId=folder-uuid&limit=50"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "versionId": "uuid-v1",
      "documentId": "uuid-d1",
      "title": "SOP Document",
      "versionNumber": "1.0",
      "status": "pending_approval",
      "submittedBy": "محمد أحمد",
      "submittedAt": "2026-07-16T14:30:00Z",
      "folderId": "folder-uuid"
    },
    {
      "versionId": "uuid-v2",
      "documentId": "uuid-d2",
      "title": "Quality Manual",
      "versionNumber": "2.1",
      "status": "pending_approval",
      "submittedBy": "أحمد علي",
      "submittedAt": "2026-07-16T14:35:00Z",
      "folderId": "folder-uuid"
    }
  ],
  "count": 2
}
```

---

## Full Workflow Example

```
┌─ User (Writer)
│
├─ 14:00 → Checkout document
│  POST .../checkout → IsCheckedOut = true
│
├─ 14:05 → Edit content, save changes
│  PUT .../upload → upload new version
│
├─ 14:10 → Unlock document
│  DELETE .../checkout → IsCheckedOut = false
│
├─ 14:15 → Submit for approval ← YOU ARE HERE
│  POST .../submit → Status = pending_approval
│  └─ Audit: DOCUMENT_SUBMITTED
│
└─────────────────────────────────────────

┌─ Manager (Manager role)
│
├─ 14:20 → Check pending approvals
│  GET .../pending-approvals/list
│  → See "SOP Document 1.0" waiting
│
├─ 14:25 → Review in detail
│  GET .../approval-status
│  → See who submitted + when
│
├─ 14:30 → Approve or Reject
│  POST .../approve  (APPROVED)
│  OR
│  POST .../reject   (REJECTED)
│
└─ Audit: DOCUMENT_APPROVED or DOCUMENT_REJECTED
```

---

## Document Status Flow

```
draft
  ↓ (submit)
pending_approval
  ↓
  ├─→ released (approved) ← FINAL, users can download
  │
  └─→ rejected (rejected) → back to draft, can edit & resubmit
```

---

## Audit Logging

| Action | Audit Log | Metadata |
| :-- | :-- | :-- |
| Submit | DOCUMENT_SUBMITTED | versionId, submittedAt, comment |
| Approve | DOCUMENT_APPROVED | versionId, approvedAt, approvalComment |
| Reject | DOCUMENT_REJECTED | versionId, rejectedAt, rejectionReason |

Example audit entry:
```json
{
  "logId": "uuid-log",
  "userId": "manager-123",
  "action": "DOCUMENT_APPROVED",
  "metadata": {
    "documentId": "uuid-doc",
    "versionId": "uuid-version",
    "title": "SOP Document",
    "versionNumber": "1.0",
    "approvedAt": "2026-07-16T14:35:00Z",
    "approvalComment": "Approved. Good to release.",
    "approvedBy": "manager-123"
  },
  "createdAt": "2026-07-16T14:35:00Z"
}
```

---

## Business Rules

✅ **Only pending documents can be approved/rejected**
- Status must be `pending_approval`
- Released/archived documents cannot be re-approved

✅ **Cannot submit checked-out documents**
- User must checkin first
- Then submit

✅ **Rejection reason is mandatory**
- Manager must provide feedback
- Goes into `approval_comment` with "REJECTED: " prefix

✅ **After rejection, user can edit again**
- Document returns to `draft` status
- User can checkout, edit, and resubmit

✅ **Auto-tracking of who approved**
- `approved_by_id` stores manager ID
- `approved_at` stores timestamp

---

## Frontend Integration

### Approval Button Group (Manager view)

```javascript
{isPending && isManager && (
  <div>
    <Button onClick={handleApprove} variant="success">
      ✓ Approve
    </Button>
    <Button onClick={showRejectModal} variant="danger">
      ✗ Reject
    </Button>
  </div>
)}

// Reject modal
<Modal>
  <textarea 
    placeholder="Reason for rejection (required)"
    value={rejectReason}
  />
  <Button onClick={submitReject}>Reject</Button>
</Modal>
```

### Document Status Badge

```javascript
{status === "pending_approval" && (
  <Badge variant="warning">⏳ Pending Approval</Badge>
)}
{status === "released" && (
  <Badge variant="success">✓ Released</Badge>
)}
{status === "rejected" && (
  <Badge variant="danger">✗ Rejected</Badge>
)}
```

### Pending Approvals Dashboard

```javascript
// For Manager dashboard
<DataTable
  data={pendingApprovals}
  columns={[
    { header: "Document", field: "title" },
    { header: "Submitted By", field: "submittedBy" },
    { header: "Submitted At", field: "submittedAt", format: "date" },
    { header: "Actions", render: (row) => (
      <>
        <Button onClick={() => handleApprove(row)}>Approve</Button>
        <Button onClick={() => handleReject(row)}>Reject</Button>
      </>
    )}
  ]}
/>
```

---

## Next Steps

1. ✅ Checkout endpoints (done)
2. ✅ Approval workflow (done)
3. ⏳ Background job: Auto-unlock expired checkouts (Hangfire)
4. ⏳ Tasks & Reminders system
5. ⏳ Frontend integration (React UI)

