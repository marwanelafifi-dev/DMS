# 🌱 Database Seed Data Summary

**Status:** ✅ COMPLETE  
**Date:** 2026-07-19  
**Environment:** Development / Testing

---

## 📊 Data Seeded

| Entity | Count | Notes |
|--------|-------|-------|
| **Users** | 6 | 1 System Admin + 5 regular users with various roles |
| **Documents** | 6 | Existing documents from earlier creation |
| **Folders** | 2 | Parent folders created from earlier |
| **Tasks** | 5 | Mix of open, in_progress, and done statuses |
| **Reminders** | 4 | Linked to tasks, mix of sent and pending |
| **Folder Permissions** | 4 | Reader/Writer roles on folders |
| **Audit Trail Entries** | 12 | Document and task operations |

---

## 👥 User Accounts

| User ID | Name | Email | Status |
|---------|------|-------|--------|
| `00000000-0000-0000-0000-000000000001` | System Admin | admin@si-ware.com | ✅ Active |
| `10000000-0000-0000-0000-000000000002` | Fatima Mohammed | fatima.mohammed@si-ware.com | ✅ Active |
| `10000000-0000-0000-0000-000000000003` | Mohammed Hassan | mohammed.hassan@si-ware.com | ✅ Active |
| `10000000-0000-0000-0000-000000000004` | Layla Khaled | layla.khaled@si-ware.com | ✅ Active |
| `10000000-0000-0000-0000-000000000005` | Sara Ibrahim | sara.ibrahim@si-ware.com | ✅ Active |
| `10000000-0000-0000-0000-000000000006` | Omar Sultan | omar.sultan@si-ware.com | ✅ Active |

---

## 📋 Task Examples

### Open Tasks (2)
| Task | Assigned To | Due Date | Priority |
|------|-------------|----------|----------|
| Review Quality Documentation | Fatima Mohammed | +7 days | HIGH |
| Complete RCA Analysis | Mohammed Hassan | +3 days | CRITICAL |

### In Progress (2)
| Task | Assigned To | Due Date | Priority |
|------|-------------|----------|----------|
| Update Access Procedures | Layla Khaled | +5 days | HIGH |
| Conduct Audit | Sara Ibrahim | +14 days | MEDIUM |

### Completed (1)
| Task | Assigned To | Due Date | Priority |
|------|-------------|----------|----------|
| Training Completion | Omar Sultan | -5 days | LOW |

---

## 🔔 Reminders

- **4 reminders** created and linked to tasks
- **2 pending** (not yet sent)
- **2 sent** (with send timestamps)
- All reminders have realistic due dates

---

## 🔐 Folder Permissions

**Folder 1 - Main QMS Folder:**
- Fatima Mohammed: Reader (since -180 days)
- Mohammed Hassan: Writer (since -150 days)

**Folder 2 - Vault Folder:**
- Layla Khaled: Reader (since -120 days)
- Sara Ibrahim: Writer (since -100 days)

---

## 📝 Audit Trail

Sample events logged:
- Document downloaded by Fatima Mohammed
- Document checked out by Mohammed Hassan
- Task created by Layla Khaled
- Permission granted to Sara Ibrahim

---

## 🧪 Testing the Seed Data

### 1. **View Tasks**
Navigate to `/tasks` to see the 5 seeded tasks:
- Filter by status (open, in_progress, done)
- Filter by priority (critical, high, medium, low)
- Try completing a task or editing one

### 2. **View Reminders**
Navigate to `/reminders` to see the 4 seeded reminders:
- Check pending reminders that need to be sent
- Mark some reminders as read/sent
- Create new reminders

### 3. **View Documents**
Navigate to `/documents` to see the 6 seeded documents:
- View documents in folders
- Download documents (audit logged)
- Checkout/lock documents (audit logged)

### 4. **Check Audit Trail**
Navigate to `/admin/audit` to see all audit entries:
- Filter by user (Fatima, Mohammed, Layla, Sara, Omar)
- Filter by action type (document, task, permission)
- View metadata for each action

### 5. **Test Folder Permissions**
Navigate to `/admin/roles` to see:
- Which users have access to which folders
- What role each user has (Reader/Writer)
- Grant new permissions to users

---

## 🔄 Data Relations

```
Users (6)
  ├─ Tasks (5)
  │  ├─ Reminders (4)
  │  └─ Assigned To User
  │
  └─ Folder Permissions (4)
     └─ Granted on Folders (2)

Documents (6)
  ├─ Exist in Folders (2)
  └─ Referenced in Tasks

Audit Trail (12 entries)
  └─ Actions by Users
```

---

## 🛠️ How Data Was Seeded

Seed scripts were applied in order:
1. `003_dev_seed_admin.sql` - Initial system admin
2. `004_add_password_hash.sql` - Password support
3. `005_folder_permission_role_check.sql` - FK constraints
4. Manual API calls - Created documents and folders
5. Final seed script - Added tasks, reminders, permissions, audit entries

---

## 📱 Using Seed Data in Frontend

### For Testing Task Management:
1. Go to `/tasks`
2. See 5 tasks with different statuses
3. Try:
   - Filtering by status or priority
   - Marking tasks as complete
   - Editing task details
   - Creating new tasks

### For Testing Approvals:
1. Go to `/approvals`
2. Some seeded documents have pending approval status
3. Try approving/rejecting with comments

### For Testing Search:
1. Go to `/search`
2. Search for document titles from the 6 seeded documents
3. Try filtering by date range

### For Testing Admin Panel:
1. Go to `/admin/users` - See all 6 users
2. Go to `/admin/roles` - See folder permissions
3. Go to `/admin/audit` - See all audit trail entries with filters

---

## 🗑️ Resetting Data

To clear all seed data and start fresh:

```sql
-- Delete in reverse order of dependencies
DELETE FROM dms_reminders;
DELETE FROM dms_tasks;
DELETE FROM dms_folder_permissions;
DELETE FROM dms_audit_trails;

-- Then re-apply seed scripts
```

Or restart the Docker containers to get a fresh database:
```bash
docker compose down -v  # Remove volumes
docker compose up -d    # Recreate and re-seed
```

---

## ✅ What You Can Now Test

- ✅ Task creation, assignment, and completion
- ✅ Reminder scheduling and delivery
- ✅ Document approval workflows
- ✅ Folder-level permission management
- ✅ Audit trail logging and filtering
- ✅ Multi-user collaboration scenarios
- ✅ Document download and checkout operations
- ✅ Task filtering and searching
- ✅ Reminder notifications
- ✅ Permission inheritance

---

## 📚 Next Steps

1. Start the application: `npm run dev` in `/web`
2. Log in with the System Admin account
3. Navigate through `/tasks`, `/reminders`, `/documents`, `/admin/*` routes
4. Test the full workflow with real data
5. Create additional test scenarios as needed

---

## 📞 Support

If you need to:
- **Add more test data:** Run additional SQL inserts in the same format
- **Modify existing data:** Use direct DB updates or app UI
- **Delete specific data:** Run DELETE statements by ID
- **Reset everything:** Drop and recreate containers

All seed data is designed to be easily modified or deleted without affecting the application logic.
