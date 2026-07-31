# Document Checkout System — Phase 2

## Overview
A document locking system to prevent concurrent edits. When a user wants to edit a document, they lock it (checkout) for 60 minutes, and no other user can edit it during that time.

---

## Mechanism

### States

```
┌─────────────────┐
│  Draft          │
│  (not locked)   │
└────────┬────────┘
         │ checkout
         ▼
┌─────────────────────────────────────┐
│  Checked Out                        │
│  ├─ IsCheckedOut = true             │
│  ├─ CheckedOutById = user-id        │
│  ├─ CheckedOutAt = timestamp        │
│  └─ Auto-unlock after 60 min        │
└────────┬────────────────────────────┘
         │ checkin OR timeout
         ▼
┌─────────────────┐
│  Draft Again    │
│  (unlocked)     │
└─────────────────┘
```

### Editing Steps

```
1. The user views the document: GET /api/documents/{id}
2. Clicks the "Edit" button
3. The system performs checkout: POST /api/documents/{id}/versions/{versionId}/checkout
   → Document locked (60 min timeout)
   → Receives a lock token in the response
4. Edits the content (in the Frontend)
5. Saves: PUT /api/documents/{id} + upload new version
6. Ends the edit: DELETE /api/documents/{id}/versions/{versionId}/checkout
   → Document unlocked
```

---

## API Endpoints

### 1️⃣ POST /api/documents/{id}/versions/{versionId}/checkout
**Lock document for editing**

```bash
curl -X POST \
  -H "X-User-Id: user-123" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Editing content"}' \
  http://localhost:8080/api/documents/{docId}/versions/{verId}/checkout
```

**Request:**
```json
{
  "reason": "Editing content"  // optional
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "versionId": "uuid-version",
    "documentId": "uuid-doc",
    "versionNumber": "1.0",
    "fileName": "document.pdf",
    "status": "draft",
    "checkedOutAt": "2026-07-16T14:00:00Z",
    "checkoutTimeoutMinutes": 60,
    "unlockAt": "2026-07-16T15:00:00Z"
  }
}
```

**Error Cases:**

```json
// Already checked out by another user
{
  "success": false,
  "error": "Checked out by another user at 7/16/2026 2:00:00 PM"
}

// Cannot checkout released documents
{
  "success": false,
  "error": "Cannot checkout released documents"
}

// Document not found
{
  "success": false,
  "error": "Version not found"
}
```

---

### 2️⃣ DELETE /api/documents/{id}/versions/{versionId}/checkout
**Unlock document after editing**

```bash
curl -X DELETE \
  -H "X-User-Id: user-123" \
  http://localhost:8080/api/documents/{docId}/versions/{verId}/checkout
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "versionId": "uuid-version",
    "documentId": "uuid-doc",
    "versionNumber": "1.0",
    "status": "draft",
    "message": "Document checked in successfully"
  }
}
```

**Error Cases:**

```json
// Not checked out
{
  "success": false,
  "error": "Document is not checked out"
}

// User is not the one who locked it
{
  "success": false,
  "error": "Only the user who checked out can check in"
}
```

---

### 3️⃣ GET /api/documents/{id}/versions/{versionId}/checkout
**Check current lock status**

```bash
curl -H "X-User-Id: user-123" \
  http://localhost:8080/api/documents/{docId}/versions/{verId}/checkout
```

**Response (Not Locked):**
```json
{
  "success": true,
  "data": {
    "isCheckedOut": false,
    "message": "Document is not checked out"
  }
}
```

**Response (Locked):**
```json
{
  "success": true,
  "data": {
    "isCheckedOut": true,
    "checkedOutBy": "Mohamed Ahmed",
    "checkedOutByEmail": "m.ahmed@example.com",
    "checkedOutAt": "2026-07-16T14:00:00Z",
    "checkoutReason": "Editing content",
    "unlockAt": "2026-07-16T15:00:00Z",
    "isExpired": false,
    "timeRemaining": "00:45:00"
  }
}
```

---

## Features

### ✅ Auto-Unlock (Timeout)
- Default: 60 minutes
- After the timeout, it is automatically unlocked
- A background job runs periodically to release old locks
- Audit log: `DOCUMENT_CHECKOUT_EXPIRED`

### ✅ Same User Can Checkout Twice
- If the same user who locked the document tries to check it out again, it is allowed
- Refreshes the timeout (resets to 60 min)

### ✅ Prevents Concurrent Edits
- Another user tries to checkout? → Error
- Information about who locked it and when

### ✅ Audit Logging
```
DOCUMENT_CHECKOUT           → lock succeeded
DOCUMENT_CHECKIN            → unlock succeeded
DOCUMENT_CHECKOUT_EXPIRED   → lock timeout expired
```

Metadata example:
```json
{
  "versionId": "uuid-version",
  "documentId": "uuid-doc",
  "versionNumber": "1.0",
  "reason": "Editing content",
  "checkedOutAt": "2026-07-16T14:00:00Z"
}
```

---

## Frontend Integration

### The Document Viewer Component

```javascript
// Show the "Edit" button
<button 
  onClick={handleCheckout}
  disabled={isCheckedOutByOther}
>
  Edit Document
</button>

// On click
const handleCheckout = async () => {
  const response = await fetch(
    `/api/documents/${docId}/versions/${verId}/checkout`,
    { method: 'POST', body: JSON.stringify({ reason: 'Editing' }) }
  );
  
  if (response.ok) {
    setIsCheckedOut(true);
    setCheckoutTimer(60); // Start countdown
    enableEditMode();
  } else {
    showError("Cannot checkout: " + error.message);
  }
};

// When finishing the edit
const handleSave = async () => {
  // 1. Upload new version
  await uploadNewVersion();
  
  // 2. Release lock
  await fetch(
    `/api/documents/${docId}/versions/${verId}/checkout`,
    { method: 'DELETE' }
  );
  
  setIsCheckedOut(false);
  disableEditMode();
};

// Timer countdown (every 30 sec)
useEffect(() => {
  const interval = setInterval(async () => {
    const status = await fetch(
      `/api/documents/${docId}/versions/${verId}/checkout`
    ).then(r => r.json());
    
    if (status.data.isExpired) {
      showWarning("Your lock has expired");
      disableEditMode();
    } else {
      setTimeRemaining(status.data.timeRemaining);
    }
  }, 30000);
  
  return () => clearInterval(interval);
}, []);
```

---

## Use Cases

### ✅ User A edits document
```
14:00 → User A: POST .../checkout → IsCheckedOut = true
14:05 → User A: PUT .../upload new version
14:10 → User A: DELETE .../checkout → IsCheckedOut = false
```

### ❌ User B tries to edit (locked)
```
14:05 → User B: POST .../checkout
        → Error: "Checked out by User A at 14:00"
```

### ⏱️ Timeout scenario
```
14:00 → User A: POST .../checkout
...
15:00 → Timeout expires
        → Auto-unlock (DOCUMENT_CHECKOUT_EXPIRED audit)
15:01 → User B: POST .../checkout → Success (lock expired)
```

---

## Database Schema

All fields already exist in `dms_document_versions`:

```sql
is_checked_out      BOOLEAN NOT NULL DEFAULT FALSE
checked_out_by      UUID REFERENCES dms_users(user_id) ON DELETE SET NULL
checked_out_at      TIMESTAMPTZ
checkout_reason     TEXT
```

---

## Next Steps

1. ✅ Checkout endpoints (done)
2. ⏳ Approval workflow (DOCUMENT_SUBMITTED, APPROVED, REJECTED)
3. ⏳ Background job for auto-unlock (Hangfire)
4. ⏳ Frontend integration (React component)

