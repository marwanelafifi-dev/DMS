# RBAC Middleware Usage Guide

## Introduction
The RBAC (Role-Based Access Control) middleware controls access to documents and folders based on:
1. The user's permissions on the folder
2. The HTTP method type

---

## Roles and Permissions

| Role | GET | POST | PUT | DELETE |
|------|-----|------|-----|--------|
| **Reader** | ✅ | ❌ | ❌ | ❌ |
| **Writer** | ✅ | ✅ | ❌ | ❌ |
| **Manager** | ✅ | ✅ | ✅ | ✅ |
| **QA** | ✅ | ✅ | ✅ | ✅ |
| **Admin** | ✅ | ✅ | ✅ | ✅ |

---

## How to Use

### 1️⃣ Add a Header to Every Request

```bash
# Read documents
curl -H "X-User-Id: {userId}" http://localhost:8080/api/documents

# Upload a file (requires Writer role)
curl -X POST \
  -H "X-User-Id: {userId}" \
  -F "file=@document.pdf" \
  http://localhost:8080/api/documents/{documentId}/upload

# Update a document (requires Manager role)
curl -X PUT \
  -H "X-User-Id: {userId}" \
  -H "Content-Type: application/json" \
  -d '{"title": "New Title"}' \
  http://localhost:8080/api/documents/{documentId}

# Delete a document (requires Manager role)
curl -X DELETE \
  -H "X-User-Id: {userId}" \
  http://localhost:8080/api/documents/{documentId}
```

### 2️⃣ Getting the User's Permissions in a Controller

```csharp
// In any controller that inherits from BaseController

public async Task<ActionResult> MyAction()
{
    var userId = GetCurrentUserId();           // Get the userId
    var user = GetCurrentUser();               // Full user data
    var role = GetUserRole();                  // Their role (Reader, Manager, etc.)
    var folderId = GetFolderId();              // folder ID from context
    
    // Use these variables in the logic
    return Ok(new { userId, role });
}
```

---

## Security Response

### ✅ On Success (200 OK)
```json
{
  "success": true,
  "data": { ... }
}
```

### ❌ When No User Exists (401 Unauthorized)
```json
{
  "success": false,
  "error": "Missing or invalid X-User-Id header"
}
```

### ❌ When Permissions Are Missing (403 Forbidden)
```json
{
  "success": false,
  "error": "No permission to access this document"
}
```

---

## Example Scenarios

### Scenario 1: Reader tries to upload a file
```
Method: POST /api/documents/upload
Header: X-User-Id: user-123
Role: Reader

Result: ❌ 403 Forbidden
Reason: "Role 'Reader' cannot post documents"
```

### Scenario 2: Manager deletes a document
```
Method: DELETE /api/documents/{docId}
Header: X-User-Id: user-456
Role: Manager

Result: ✅ 200 OK
Message: "Document deleted successfully"
```

### Scenario 3: User without permissions
```
Method: GET /api/documents/folder-123
Header: X-User-Id: user-789
Folder Permissions: (none)

Result: ❌ 403 Forbidden
Reason: "No permission to access this folder"
```

---

## How the Middleware Works

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

## Endpoints Without Authentication Required

```
GET  /health               ← system health
GET  /api/test             ← API test
GET  /api/miniotest/*      ← MinIO test
GET  /api/databasetest/*   ← Database test
```

---

## Security Notes

⚠️ **Remember:**
- Always send the `X-User-Id` header on every request
- The user must have `IsActive = true`
- Permissions are at the **folder** level (Folder-level)
- Documents inherit the permissions of the folder they're in

---

## Next Step

After trying out RBAC, the next step is **Audit Logging**:
- Log every Create/Update/Delete operation
- WORM compliance
- Track who did what
