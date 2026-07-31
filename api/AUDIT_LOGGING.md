# Audit Logging Implementation — Phase 1 Completion

## Overview
A comprehensive logging system for all create, update, and delete operations (**CRUD Mutations**), guaranteeing **WORM (Write-Once-Read-Many)** at the database level.

---

## Architecture

```
┌─────────────────┐
│   Controller    │  (FoldersController, DocumentsController, UsersController)
│  (any action)   │
└────────┬────────┘
         │ calls
         ▼
┌─────────────────────────────────────┐
│     AuditService                    │
│  (LogAsync, GetAuditTrailAsync)     │
└────────┬────────────────────────────┘
         │ writes/reads
         ▼
┌─────────────────────────────────────┐
│   DMS_AUDIT_TRAILS Table (WORM)     │
│  ├─ log_id (UUID PK)                │
│  ├─ user_id (UUID FK)               │
│  ├─ action (VARCHAR 255)            │
│  ├─ metadata (JSONB)                │
│  └─ created_at (TIMESTAMPTZ)        │
└─────────────────────────────────────┘
         │ protected by
         ▼
   WORM Trigger (dms_reject_mutation)
   ❌ UPDATE/DELETE rejected
```

---

## Logged Actions

### Folders
```
FOLDER_CREATED       → a new folder was created
FOLDER_UPDATED       → folder data was updated
FOLDER_DELETED       → a folder was deleted
```

### Documents
```
DOCUMENT_CREATED     → a new document was created (without a file)
DOCUMENT_UPLOADED    → a new file version was uploaded
DOCUMENT_DOWNLOADED  → a file version was downloaded
DOCUMENT_UPDATED     → document data was updated (title, status)
DOCUMENT_DELETED     → a document (and all its versions) was deleted
```

### Users
```
USER_CREATED         → a new user was created
USER_UPDATED         → user data was updated
USER_DEACTIVATED     → a user was deactivated (soft delete)
```

---

## Data Structure (Metadata)

Each record contains detailed information about the operation:

### Example: FOLDER_CREATED
```json
{
  "FolderId": "uuid-here",
  "Name": "Folder Name",
  "Classification": "standard",
  "OwnerId": "uuid-owner",
  "CreatedAt": "2026-07-16T10:30:00Z"
}
```

### Example: DOCUMENT_UPLOADED
```json
{
  "VersionId": "uuid-version",
  "DocumentId": "uuid-doc",
  "FileName": "document.pdf",
  "FileSizeBytes": 2048576,
  "Sha256Hash": "abc123def...",
  "MimeType": "application/pdf",
  "CreatedAt": "2026-07-16T10:30:00Z"
}
```

### Example: DOCUMENT_DOWNLOADED
```json
{
  "VersionId": "uuid-version",
  "DocumentId": "uuid-doc",
  "FileName": "document.pdf",
  "FileSizeBytes": 2048576,
  "DownloadedAt": "2026-07-16T10:31:00Z"
}
```

---

## API Endpoints

### 1️⃣ GET /api/audittrails — list of records
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails?limit=50"
```

**Parameters:**
- `userId` (optional): filter by user
- `action` (optional): filter by action type (FOLDER_CREATED, etc.)
- `limit` (default: 100): number of records returned

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "logId": "uuid-log",
      "userId": "uuid-user",
      "action": "DOCUMENT_UPLOADED",
      "metadata": { ... },
      "createdAt": "2026-07-16T10:30:00Z"
    }
  ],
  "count": 1
}
```

---

### 2️⃣ GET /api/audittrails/{logId} — a single record
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails/{logId}"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "logId": "uuid-log",
    "userId": "uuid-user",
    "action": "FOLDER_CREATED",
    "metadata": { ... },
    "createdAt": "2026-07-16T10:30:00Z"
  }
}
```

---

### 3️⃣ GET /api/audittrails/user/{userId} — a user's records
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails/user/{userId}?limit=50"
```

**Response:**
```json
{
  "success": true,
  "data": [ ... ],
  "count": 5,
  "userId": "uuid-user"
}
```

---

### 4️⃣ GET /api/audittrails/action/{action} — records for a specific action
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails/action/DOCUMENT_UPLOADED?limit=50"
```

**Possible actions:**
- FOLDER_CREATED, FOLDER_UPDATED, FOLDER_DELETED
- DOCUMENT_CREATED, DOCUMENT_UPLOADED, DOCUMENT_DOWNLOADED, DOCUMENT_UPDATED, DOCUMENT_DELETED
- USER_CREATED, USER_UPDATED, USER_DEACTIVATED

**Response:**
```json
{
  "success": true,
  "data": [ ... ],
  "count": 3,
  "action": "DOCUMENT_UPLOADED"
}
```

---

## Usage in Controllers

### In FoldersController
```csharp
// When creating a folder
context.Folders.Add(folder);
await context.SaveChangesAsync();

var currentUserId = GetCurrentUserId();
await auditService.LogAsync(currentUserId, AuditActions.FOLDER_CREATED, new
{
    folder.FolderId,
    folder.Name,
    folder.Classification,
    folder.OwnerId,
    folder.CreatedAt
});
```

### In DocumentsController
```csharp
// When uploading a file
await minioService.UploadAsync(objectKey, file.OpenReadStream(), file.ContentType);

var currentUserId = GetCurrentUserId();
await auditService.LogAsync(currentUserId, DOCUMENT_UPLOADED, new
{
    version.VersionId,
    document.DocumentId,
    version.FileName,
    version.FileSizeBytes,
    version.Sha256Hash,
    version.MimeType,
    version.CreatedAt
});
```

### In UsersController
```csharp
// When creating a user
context.Users.Add(user);
await context.SaveChangesAsync();

var currentUserId = GetCurrentUserId();
await auditService.LogAsync(currentUserId, USER_CREATED, new
{
    user.UserId,
    user.Email,
    user.FullName,
    user.CreatedAt
});
```

---

## WORM Protection (Write-Once-Read-Many)

### At the Database Level
```sql
-- The trigger raises an exception if anyone attempts UPDATE or DELETE
CREATE TRIGGER trg_worm_audit_trails
    BEFORE UPDATE OR DELETE ON dms_audit_trails
    FOR EACH ROW EXECUTE FUNCTION dms_reject_mutation();

-- Attempting to delete = Error
DELETE FROM dms_audit_trails WHERE log_id = '...';
-- WORM violation: DELETE on dms_audit_trails is not permitted
```

### At the Application Level
- The app does not have DELETE permissions on the audit_trails table
- Only INSERT and SELECT are allowed
- Any attempt to modify raises an exception

### At the MinIO Level (Future)
- Object-lock enabled on the bucket
- Defined retention days (COMPLIANCE mode)
- Uploaded files cannot be deleted or modified

---

## Example Scenarios

### Scenario 1: Track who deleted a document
```bash
# Search for all DOCUMENT_DELETED operations
curl -H "X-User-Id: admin-user" \
  "http://localhost:8080/api/audittrails/action/DOCUMENT_DELETED"

# The result returns:
# {
#   "logId": "xyz123",
#   "userId": "manager-1",
#   "action": "DOCUMENT_DELETED",
#   "metadata": {
#     "documentId": "doc-456",
#     "title": "Important Document",
#     "versionsDeleted": 3,
#     "deletedAt": "2026-07-16T11:00:00Z"
#   }
# }
```

### Scenario 2: History of all uploads for a specific file
```bash
# Get all DOCUMENT_UPLOADED records for the user
curl -H "X-User-Id: admin-user" \
  "http://localhost:8080/api/audittrails/user/user-123?limit=100"

# Filter on metadata to search for a specific DocumentId
# (manually in the application or via a DB query)
```

### Scenario 3: Audit
```bash
# Legal request: "Who modified this document on day X?"
curl -H "X-User-Id: legal-officer" \
  "http://localhost:8080/api/audittrails/action/DOCUMENT_UPDATED"

# Every record contains:
# - Who (userId)
# - What (action)
# - When (createdAt)
# - Details (metadata: old/new values)
# ✅ WORM-protected = the record cannot be deleted/modified
```

---

## Affected Files

### New Files
- `/api/Services/AuditService.cs` — abstraction layer for logging
- `/api/AUDIT_LOGGING.md` — this document

### Updated Files
- `/api/Controllers/FoldersController.cs` — added audit logging
- `/api/Controllers/DocumentsController.cs` — added audit logging
- `/api/Controllers/UsersController.cs` — added audit logging
- `/api/Controllers/AuditTrailsController.cs` — endpoints for viewing logs
- `/api/Models/DmsAuditTrail.cs` — JsonDocument for structured metadata
- `/api/Program.cs` — registered AuditService in DI

---

## Testing

### 1️⃣ Create Folder (with audit)
```bash
curl -X POST -H "X-User-Id: user-1" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Folder", "ownerId": "user-1"}' \
  http://localhost:8080/api/folders

# ✅ Audit log created: FOLDER_CREATED
```

### 2️⃣ View Audit Logs
```bash
curl -H "X-User-Id: user-1" \
  "http://localhost:8080/api/audittrails?limit=10"

# Returns list of all actions
```

### 3️⃣ Verify WORM
```bash
# From the Postgres console:
DELETE FROM dms_audit_trails WHERE log_id = '...';

-- WORM violation: DELETE on dms_audit_trails is not permitted
-- (raises exception — delete rejected)
```

---

## Integration Points

| Component | Integration | Status |
| :-- | :-- | :-- |
| Folders CRUD | LogAsync(FOLDER_CREATED/UPDATED/DELETED) | ✅ Done |
| Documents CRUD | LogAsync(DOCUMENT_CREATED/UPDATED/DELETED) | ✅ Done |
| Documents Upload | LogAsync(DOCUMENT_UPLOADED) | ✅ Done |
| Documents Download | LogAsync(DOCUMENT_DOWNLOADED) | ✅ Done |
| Users CRUD | LogAsync(USER_CREATED/UPDATED/DEACTIVATED) | ✅ Done |
| Permissions | LogAsync(PERMISSION_GRANTED/REVOKED) | ⏳ Next (Phase 2) |
| FolderPermissions Controller | LogAsync(PERMISSION_*) | ⏳ Next (Phase 2) |
| Workflows | LogAsync(WORKFLOW_*) | ⏳ Phase 3 |

---

## Next Steps (Phase 2)

1. **Permissions Controller** — add FolderPermissionsController with audit logging
2. **Workflow Audit** — log workflow state changes (submitted, approved, rejected)
3. **Retention Policies** — auto-archive/delete based on policy + log the action
4. **Dashboard** — show audit trail in vault UI (Admin view)

---

## Performance Considerations

- **Index on user_id**: ✅ Fast user audit history lookup
- **Index on action**: ✅ Fast action-based filtering
- **Index on created_at**: ✅ Fast date-range queries
- **WORM trigger**: Minimal overhead (only on INSERT-time)
- **Async logging**: LogAsync completes quickly, doesn't block request

---

## Compliance Notes

✅ **ISO 27001:2022 (ISMS)**
- A.12.4.1: Event logging for accountability
- A.12.4.2: Protection of log information
- WORM ensures audit logs cannot be tampered with

✅ **ISO 9001:2015 (QMS)**
- 4.4.1: Documented information on procedures
- 8.5.2: Control of externally provided processes
- Audit trail proves compliance with document version control

---

## Troubleshooting

### Issue: Audit logs not appearing
**Solution:** Verify AuditService is registered in Program.cs with `builder.Services.AddScoped<AuditService>();`

### Issue: JsonDocument not serializing
**Solution:** Ensure DmsAuditTrail model uses `JsonDocument? Metadata` (not string)

### Issue: WORM trigger raising error on normal operation
**Solution:** Confirm the trigger only blocks UPDATE/DELETE (INSERT is allowed)

