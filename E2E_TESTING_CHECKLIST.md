# 🧪 END-TO-END TESTING CHECKLIST

**Status:** IN PROGRESS  
**Date:** 2026-07-26  
**Tester:** Ali  
**App URL:** http://localhost:5177  
**Branch:** ali-branch

---

## 📋 TEST SCENARIOS

### 1️⃣ **DASHBOARD TESTING** 
**Goal:** Verify dashboard loads with real data and displays correctly

- [ ] Dashboard loads without errors
- [ ] Stats cards show correct numbers (Open Tasks, In Progress, Pending Approvals)
- [ ] Recent Documents section displays documents
- [ ] Pending Approvals section shows items
- [ ] My Tasks preview shows tasks
- [ ] Dark mode toggle works
- [ ] All icons display correctly
- [ ] Responsive on mobile (use browser DevTools, 375px width)

**Test Data Expected:**
- Open Tasks: 2
- In Progress: 2
- Completed: 1
- Pending Approvals: 3+
- Documents: 6+

**Bugs Found:** (list any issues)
```
[ ] 
[ ] 
[ ] 
```

---

### 2️⃣ **DOCUMENT LIBRARY TESTING**
**Goal:** Test document management features (upload, download, preview, folder tree)

#### Folder Tree Navigation
- [ ] Folder tree loads with correct folders
- [ ] Can expand/collapse folders
- [ ] Clicking folder filters documents
- [ ] Folder context menu shows (right-click or three-dots)

#### Document Table
- [ ] All documents display with correct columns
- [ ] Sorting works (Name, Status, Date, Owner)
- [ ] Search by document name works
- [ ] Filter by status works
- [ ] View toggle (table/grid) switches views
- [ ] Grid view displays document cards
- [ ] Download icon works for a document
- [ ] Preview icon opens document viewer

#### Upload Document
- [ ] Upload button is visible
- [ ] Can select a file to upload
- [ ] Upload completes successfully
- [ ] New document appears in table
- [ ] File size shows correctly
- [ ] Status is "Draft" initially

#### Document Preview
- [ ] Preview opens for PDF
- [ ] PDF toolbar shows (page nav, zoom, rotate, etc.)
- [ ] Page navigation works
- [ ] Zoom in/out works
- [ ] Document metadata displays
- [ ] Download from preview works
- [ ] Close preview button works

**Test Data Expected:**
- Folders: 2
- Documents: 6+
- Mix of statuses: Draft, Pending Approval, Released

**Bugs Found:**
```
[ ] 
[ ] 
[ ] 
```

---

### 3️⃣ **APPROVAL WORKFLOW TESTING**
**Goal:** Test document approval workflow (submit → approve → reject)

#### Submit for Approval
- [ ] Can select a Draft document
- [ ] "Submit for Approval" button appears
- [ ] Can add approval comment
- [ ] Submission succeeds
- [ ] Document status changes to "Pending Approval"
- [ ] Audit log records the action

#### Approve Document
- [ ] Approval page shows pending documents
- [ ] Can view document details
- [ ] Can add approval comment
- [ ] Can click "Approve"
- [ ] Document status changes to "Released"
- [ ] Approval date is recorded

#### Reject Document
- [ ] Can click "Reject"
- [ ] Can add rejection reason
- [ ] Document status changes to "Rejected"
- [ ] Document can be resubmitted
- [ ] Rejection is logged in audit trail

**Test Data Expected:**
- At least 3 documents in Pending Approval state

**Bugs Found:**
```
[ ] 
[ ] 
[ ] 
```

---

### 4️⃣ **TASK MANAGEMENT TESTING**
**Goal:** Test task CRUD and workflow

#### View Tasks
- [ ] Tasks page loads
- [ ] All 5 seeded tasks display
- [ ] Can filter by status (Open, In Progress, Done)
- [ ] Can filter by priority (Critical, High, Medium, Low)
- [ ] Tasks show due dates
- [ ] Overdue tasks are highlighted
- [ ] Task count matches expectation

#### Create Task
- [ ] "Create Task" button exists
- [ ] Modal opens with form
- [ ] Can fill title
- [ ] Can fill description
- [ ] Can select priority
- [ ] Can set due date
- [ ] Can select assigned user
- [ ] Submission succeeds
- [ ] New task appears in list

#### Update Task
- [ ] Can edit task title
- [ ] Can change priority
- [ ] Can change assigned user
- [ ] Can change due date
- [ ] Changes save successfully

#### Complete Task
- [ ] Can mark task as Complete
- [ ] Status changes to "Done"
- [ ] Completed date is recorded
- [ ] Task moves to completed section

**Test Data Expected:**
- Open: 2
- In Progress: 2
- Completed: 1
- Total: 5

**Bugs Found:**
```
[ ] 
[ ] 
[ ] 
```

---

### 5️⃣ **ADMIN PANEL TESTING**
**Goal:** Test user management, audit logs, and permissions

#### Users Tab
- [ ] All 6 users display
- [ ] Can see user details (name, email, status)
- [ ] Can create new user
  - [ ] Fill form fields
  - [ ] Set password
  - [ ] Submit succeeds
  - [ ] New user appears in list
- [ ] Can deactivate user
  - [ ] Deactivate button appears
  - [ ] Confirmation dialog shown
  - [ ] User status changes to Inactive
- [ ] Can't deactivate own account (button disabled)
- [ ] Pagination works (if needed)
- [ ] Search by name/email works

#### Audit Trail Tab
- [ ] Audit logs display
- [ ] Filter by action works
- [ ] Filter by user works
- [ ] Filter by date range works
- [ ] Export CSV button works
- [ ] Logs show real operations
  - [ ] Document downloads
  - [ ] Approvals
  - [ ] Task creations
  - [ ] User creations

#### Folder Permissions Tab
- [ ] Lists all folders and their permissions
- [ ] Shows who has access to which folders
- [ ] Can grant new permission
  - [ ] Select folder
  - [ ] Select user
  - [ ] Select role (Reader/Writer/Manager)
  - [ ] Grant succeeds
- [ ] Can revoke permission
  - [ ] Revoke button appears
  - [ ] Permission is removed

**Test Data Expected:**
- Users: 6 (1 admin + 5 regular)
- Audit entries: 12+
- Folder permissions: 4

**Bugs Found:**
```
[ ] 
[ ] 
[ ] 
```

---

### 6️⃣ **DARK MODE TESTING**
**Goal:** Verify dark mode toggle and styling

#### Light Mode
- [ ] Background is white
- [ ] Text is dark (navy)
- [ ] Buttons are visible
- [ ] Links are readable
- [ ] All icons render correctly

#### Dark Mode Toggle
- [ ] Toggle button exists in navbar
- [ ] Can click to switch to dark mode
- [ ] Can click to switch back to light mode
- [ ] Theme persists on page reload

#### Dark Mode Styling
- [ ] Background is black/very dark
- [ ] Text is white
- [ ] All sections are readable
- [ ] Buttons have sufficient contrast
- [ ] Form inputs are visible
- [ ] Tables have proper contrast
- [ ] Modal backgrounds are dark
- [ ] All pages support dark mode:
  - [ ] Dashboard
  - [ ] Documents
  - [ ] Approvals
  - [ ] Tasks
  - [ ] Admin Panel
  - [ ] All modals

**Bugs Found:**
```
[ ] 
[ ] 
[ ] 
```

---

### 7️⃣ **RESPONSIVE DESIGN TESTING**
**Goal:** Verify mobile and tablet layouts

#### Desktop (1920px)
- [ ] All layouts work
- [ ] Sidebar visible
- [ ] Tables fully visible
- [ ] No horizontal scroll needed

#### Tablet (768px)
- [ ] Sidebar collapses to hamburger
- [ ] Can open sidebar menu
- [ ] Tables are scrollable
- [ ] All buttons accessible
- [ ] Form inputs readable

#### Mobile (375px)
- [ ] Hamburger menu visible
- [ ] Sidebar drawer opens/closes
- [ ] Tables scroll horizontally
- [ ] Buttons are touchable (min 44x44px)
- [ ] Forms are single-column
- [ ] No horizontal overflow
- [ ] All text readable without zoom

**Test Using Browser DevTools:**
```
F12 → Toggle device toolbar (Ctrl+Shift+M)
→ Select preset sizes: Desktop, Tablet, Mobile
```

**Bugs Found:**
```
[ ] 
[ ] 
[ ] 
```

---

### 8️⃣ **NAVIGATION TESTING**
**Goal:** Test all navigation routes and links

#### Sidebar Navigation
- [ ] Can click Dashboard → loads
- [ ] Can click Documents → loads
- [ ] Can click Tasks → loads
- [ ] Can click Approvals → loads
- [ ] Can click Search → loads
- [ ] Can click Reminders → loads
- [ ] Can click Admin Panel → loads
- [ ] All pages load without errors

#### Breadcrumbs
- [ ] Breadcrumbs display on pages
- [ ] Can click breadcrumb links
- [ ] Back navigation works

#### Modals
- [ ] Close button works
- [ ] Clicking outside modal closes it
- [ ] Form validation works

**Bugs Found:**
```
[ ] 
[ ] 
[ ] 
```

---

## 🐛 CRITICAL BUGS FOUND

### Severity: 🔴 CRITICAL
- [ ] App crashes
- [ ] Cannot login/access
- [ ] Data loss

### Severity: 🟠 HIGH
- [ ] Major feature broken
- [ ] Data incorrect
- [ ] Layout broken

### Severity: 🟡 MEDIUM
- [ ] Minor feature issue
- [ ] UI glitch
- [ ] Performance problem

### Severity: 🟢 LOW
- [ ] Typo
- [ ] Layout slightly off
- [ ] Enhancement

---

## 📊 TESTING SUMMARY

**Total Tests:** 8 categories × ~10-15 tests each = ~100 tests

| Category | Passed | Failed | Notes |
|----------|--------|--------|-------|
| Dashboard | ☐ | ☐ | |
| Documents | ☐ | ☐ | |
| Approvals | ☐ | ☐ | |
| Tasks | ☐ | ☐ | |
| Admin Panel | ☐ | ☐ | |
| Dark Mode | ☐ | ☐ | |
| Responsive | ☐ | ☐ | |
| Navigation | ☐ | ☐ | |

**Overall Status:** ☐ READY FOR PRODUCTION  ☐ NEEDS FIXES  ☐ BLOCKED

---

## 📝 TEST EXECUTION NOTES

**When:** 2026-07-26  
**Who:** Ali  
**Environment:** Local (Windows Docker)  
**Browser:** Chrome  
**Issues Found:** 0

### Observations:
```


```

---

## ✅ SIGN-OFF

- [ ] All tests passed
- [ ] Critical bugs fixed
- [ ] Ready for deployment
- [ ] Approved by: _____________

**Date:** _______________  
**Tester:** _______________
