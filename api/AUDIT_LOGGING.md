# Audit Logging Implementation — Phase 1 Completion

## نظرة عامة
نظام تسجيل شامل لجميع عمليات الإنشاء والتعديل والحذف (**CRUD Mutations**) مع ضمان **WORM (Write-Once-Read-Many)** على مستوى قاعدة البيانات.

---

## الهندسة المعمارية

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

## الأفعال المسجلة (Actions)

### مجلدات (Folders)
```
FOLDER_CREATED       → تم إنشاء مجلد جديد
FOLDER_UPDATED       → تم تعديل بيانات المجلد
FOLDER_DELETED       → تم حذف مجلد
```

### مستندات (Documents)
```
DOCUMENT_CREATED     → تم إنشاء مستند جديد (بدون ملف)
DOCUMENT_UPLOADED    → تم تحميل/رفع نسخة جديدة من الملف
DOCUMENT_DOWNLOADED  → تم تحميل (download) نسخة من الملف
DOCUMENT_UPDATED     → تم تعديل بيانات المستند (العنوان، الحالة)
DOCUMENT_DELETED     → تم حذف مستند (وجميع النسخ)
```

### مستخدمين (Users)
```
USER_CREATED         → تم إنشاء مستخدم جديد
USER_UPDATED         → تم تعديل بيانات المستخدم
USER_DEACTIVATED     → تم تعطيل مستخدم (soft delete)
```

---

## بنية البيانات (Metadata)

كل سجل يحتوي على معلومات مفصّلة عن العملية:

### مثال: FOLDER_CREATED
```json
{
  "FolderId": "uuid-here",
  "Name": "اسم المجلد",
  "Classification": "standard",
  "OwnerId": "uuid-owner",
  "CreatedAt": "2026-07-16T10:30:00Z"
}
```

### مثال: DOCUMENT_UPLOADED
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

### مثال: DOCUMENT_DOWNLOADED
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

### 1️⃣ GET /api/audittrails — قائمة السجلات
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails?limit=50"
```

**المعاملات:**
- `userId` (optional): تصفية حسب المستخدم
- `action` (optional): تصفية حسب نوع الفعل (FOLDER_CREATED, إلخ)
- `limit` (default: 100): عدد السجلات المرجعة

**الرد:**
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

### 2️⃣ GET /api/audittrails/{logId} — سجل واحد
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails/{logId}"
```

**الرد:**
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

### 3️⃣ GET /api/audittrails/user/{userId} — سجلات مستخدم
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails/user/{userId}?limit=50"
```

**الرد:**
```json
{
  "success": true,
  "data": [ ... ],
  "count": 5,
  "userId": "uuid-user"
}
```

---

### 4️⃣ GET /api/audittrails/action/{action} — سجلات فعل معين
```bash
curl -H "X-User-Id: {userId}" \
  "http://localhost:8080/api/audittrails/action/DOCUMENT_UPLOADED?limit=50"
```

**الأفعال الممكنة:**
- FOLDER_CREATED, FOLDER_UPDATED, FOLDER_DELETED
- DOCUMENT_CREATED, DOCUMENT_UPLOADED, DOCUMENT_DOWNLOADED, DOCUMENT_UPDATED, DOCUMENT_DELETED
- USER_CREATED, USER_UPDATED, USER_DEACTIVATED

**الرد:**
```json
{
  "success": true,
  "data": [ ... ],
  "count": 3,
  "action": "DOCUMENT_UPLOADED"
}
```

---

## التطبيق في Controllers

### في FoldersController
```csharp
// عند إنشاء مجلد
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

### في DocumentsController
```csharp
// عند تحميل ملف
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

### في UsersController
```csharp
// عند إنشاء مستخدم
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

### على مستوى Database
```sql
-- الـ trigger يرفع exception إذا حد حاول UPDATE أو DELETE
CREATE TRIGGER trg_worm_audit_trails
    BEFORE UPDATE OR DELETE ON dms_audit_trails
    FOR EACH ROW EXECUTE FUNCTION dms_reject_mutation();

-- محاولة الحذف = Error
DELETE FROM dms_audit_trails WHERE log_id = '...';
-- WORM violation: DELETE on dms_audit_trails is not permitted
```

### على مستوى Application
- الـ app لا تملك صلاحيات DELETE على جدول audit_trails
- فقط INSERT و SELECT مسموحة
- أي محاولة للتعديل ترفع exception

### على مستوى MinIO (Future)
- Object-lock enabled على bucket
- Retention days محددة (COMPLIANCE mode)
- لا يمكن حذف أو تعديل الملفات المرفوعة

---

## أمثلة سيناريوهات

### السيناريو 1: تتبع من قام بحذف المستند
```bash
# البحث عن جميع عمليات DOCUMENT_DELETED
curl -H "X-User-Id: admin-user" \
  "http://localhost:8080/api/audittrails/action/DOCUMENT_DELETED"

# النتيجة تعطي:
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

### السيناريو 2: تاريخ جميع تحميلات ملف معينة
```bash
# الحصول على جميع سجلات DOCUMENT_UPLOADED للمستخدم
curl -H "X-User-Id: admin-user" \
  "http://localhost:8080/api/audittrails/user/user-123?limit=100"

# تصفية على metadata للبحث عن DocumentId معين
# (يدويّاً في التطبيق أو عبر DB query)
```

### السيناريو 3: التدقيق (Audit)
```bash
# صادر قانوني: "من قام بتعديل هذا المستند في يوم X؟"
curl -H "X-User-Id: legal-officer" \
  "http://localhost:8080/api/audittrails/action/DOCUMENT_UPDATED"

# كل سجل يحتوي على:
# - من (userId)
# - ماذا (action)
# - متى (createdAt)
# - التفاصيل (metadata: قيم قديمة/جديدة)
# ✅ WORM-protected = لا يمكن حذف/تعديل السجل
```

---

## الملفات المتأثرة

### New Files
- `/api/Services/AuditService.cs` — abstraction layer للـ logging
- `/api/AUDIT_LOGGING.md` — هذه الوثيقة

### Updated Files
- `/api/Controllers/FoldersController.cs` — added audit logging
- `/api/Controllers/DocumentsController.cs` — added audit logging
- `/api/Controllers/UsersController.cs` — added audit logging
- `/api/Controllers/AuditTrailsController.cs` — endpoints للـ viewing logs
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
# من الـ Postgres console:
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

