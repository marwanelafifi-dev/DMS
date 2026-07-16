# RBAC Middleware Usage Guide

## المقدمة
الـ RBAC (Role-Based Access Control) middleware يتحكم في الوصول إلى المستندات والمجلدات بناءً على:
1. صلاحيات المستخدم على المجلد
2. نوع الـ HTTP method

---

## الأدوار والصلاحيات

| Role | GET | POST | PUT | DELETE |
|------|-----|------|-----|--------|
| **Reader** | ✅ | ❌ | ❌ | ❌ |
| **Writer** | ✅ | ✅ | ❌ | ❌ |
| **Manager** | ✅ | ✅ | ✅ | ✅ |
| **QA** | ✅ | ✅ | ✅ | ✅ |
| **Admin** | ✅ | ✅ | ✅ | ✅ |

---

## كيفية الاستخدام

### 1️⃣ إضافة Header في كل Request

```bash
# قراءة المستندات
curl -H "X-User-Id: {userId}" http://localhost:8080/api/documents

# تحميل ملف (يحتاج Writer role)
curl -X POST \
  -H "X-User-Id: {userId}" \
  -F "file=@document.pdf" \
  http://localhost:8080/api/documents/{documentId}/upload

# تعديل مستند (يحتاج Manager role)
curl -X PUT \
  -H "X-User-Id: {userId}" \
  -H "Content-Type: application/json" \
  -d '{"title": "New Title"}' \
  http://localhost:8080/api/documents/{documentId}

# حذف مستند (يحتاج Manager role)
curl -X DELETE \
  -H "X-User-Id: {userId}" \
  http://localhost:8080/api/documents/{documentId}
```

### 2️⃣ الحصول على صلاحيات المستخدم في Controller

```csharp
// في أي controller يرث من BaseController

public async Task<ActionResult> MyAction()
{
    var userId = GetCurrentUserId();           // الحصول على userId
    var user = GetCurrentUser();               // بيانات المستخدم الكاملة
    var role = GetUserRole();                  // دوره (Reader, Manager, إلخ)
    var folderId = GetFolderId();              // folder ID من context
    
    // استخدم هذه المتغيرات في logic
    return Ok(new { userId, role });
}
```

---

## Response الأمان

### ✅ عند النجاح (200 OK)
```json
{
  "success": true,
  "data": { ... }
}
```

### ❌ عند عدم وجود User (401 Unauthorized)
```json
{
  "success": false,
  "error": "Missing or invalid X-User-Id header"
}
```

### ❌ عند عدم وجود صلاحيات (403 Forbidden)
```json
{
  "success": false,
  "error": "No permission to access this document"
}
```

---

## أمثلة سيناريوهات

### السيناريو 1: Reader يحاول تحميل ملف
```
Method: POST /api/documents/upload
Header: X-User-Id: user-123
Role: Reader

النتيجة: ❌ 403 Forbidden
Reason: "Role 'Reader' cannot post documents"
```

### السيناريو 2: Manager يحذف مستند
```
Method: DELETE /api/documents/{docId}
Header: X-User-Id: user-456
Role: Manager

النتيجة: ✅ 200 OK
Message: "تم حذف المستند بنجاح"
```

### السيناريو 3: User بدون صلاحيات
```
Method: GET /api/documents/folder-123
Header: X-User-Id: user-789
Folder Permissions: (لا توجد)

النتيجة: ❌ 403 Forbidden
Reason: "No permission to access this folder"
```

---

## كيف يشتغل الـ Middleware

```
User Request
    ↓
Check X-User-Id Header
    ↓ (Valid)
Check if User exists in DB
    ↓ (Exists & Active)
Check HTTP Method (GET, POST, PUT, DELETE)
    ↓
If endpoint = documents/folders
    → Check Folder Permissions
    → Check Role vs Method
        ↓ (Permission OK)
        → Proceed to Controller
        ↓ (Permission Denied)
        → Return 403 Forbidden
    ↓ (Skip auth endpoints like /health)
    → Proceed to Controller
```

---

## Endpoints بدون Authentication Required

```
GET  /health               ← صحة النظام
GET  /api/test             ← اختبار الـ API
GET  /api/miniotest/*      ← اختبار MinIO
GET  /api/databasetest/*   ← اختبار Database
```

---

## ملاحظات أمنية

⚠️ **تذكر:**
- دائماً أرسل `X-User-Id` header في كل request
- المستخدم يجب أن يكون `IsActive = true`
- الصلاحيات على مستوى **المجلد** (Folder-level)
- المستندات ترث صلاحيات المجلد اللي فيها

---

## الخطوة التالية

بعد تجربة RBAC، المقبل هو **Audit Logging**:
- تسجيل كل عملية Create/Update/Delete
- WORM compliance
- تتبع من عمل إيش
