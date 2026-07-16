# Tasks & Reminders API — Phase 2

## نظرة عامة
نظام إدارة المهام والتذكيرات. المستخدمون يتلقون مهام مرتبطة بالمستندات (تصحيحات، توثيقات، إلخ)، ويمكنهم تتبع الحالة والمواعيد النهائية.

---

## الحالات

```
┌──────────┐
│ Open     │ (جديدة، لم تُنجز بعد)
└────┬─────┘
     │ (المستخدم ينهيها)
     ▼
┌──────────┐
│Completed │ (منجزة)
└──────────┘

Special: Overdue = Open + DueDate < today
```

---

## API Endpoints

### 1️⃣ GET /api/tasks
**Get my tasks (assigned to me)**

```bash
curl -H "X-User-Id: user-123" \
  "http://localhost:8080/api/tasks?status=open&limit=50"
```

**Query Parameters:**
- `status` (optional): "open", "completed"
- `limit` (default: 100): number of results

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "taskId": "uuid-task",
      "documentId": "uuid-doc",
      "document": {
        "documentId": "uuid-doc",
        "title": "SOP Document v1.0"
      },
      "title": "Add watermark to all pages",
      "description": "Add company watermark for confidentiality",
      "taskType": "correction",
      "dueDate": "2026-07-20",
      "status": "open",
      "isOverdue": false,
      "createdAt": "2026-07-16T15:00:00Z"
    }
  ],
  "count": 1
}
```

---

### 2️⃣ GET /api/tasks/{id}
**Get task details**

```bash
curl -H "X-User-Id: user-123" \
  http://localhost:8080/api/tasks/{taskId}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "taskId": "uuid-task",
    "documentId": "uuid-doc",
    "document": {
      "documentId": "uuid-doc",
      "title": "SOP Document v1.0"
    },
    "title": "Add watermark to all pages",
    "description": "Add company watermark for confidentiality",
    "taskType": "correction",
    "riskSeverity": null,
    "assignedTo": {
      "userId": "user-123",
      "fullName": "محمد أحمد",
      "email": "m.ahmed@example.com"
    },
    "dueDate": "2026-07-20",
    "status": "open",
    "rcaText": null,
    "preventiveActions": null,
    "createdAt": "2026-07-16T15:00:00Z",
    "completedAt": null
  }
}
```

---

### 3️⃣ POST /api/tasks
**Create a new task**

```bash
curl -X POST \
  -H "X-User-Id: manager-123" \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "uuid-doc",
    "assignedToId": "user-123",
    "title": "Add watermark to all pages",
    "description": "Add company watermark for confidentiality",
    "taskType": "correction",
    "dueDate": "2026-07-20"
  }' \
  http://localhost:8080/api/tasks
```

**Request:**
```json
{
  "documentId": "uuid-doc",      // required
  "assignedToId": "uuid-user",   // required
  "title": "Task title",         // required
  "description": "...",          // optional
  "taskType": "correction",      // optional (correction, rca, audit_action)
  "dueDate": "2026-07-20"        // optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "taskId": "uuid-task",
    "documentId": "uuid-doc",
    "title": "Add watermark to all pages",
    "assignedToId": "user-123",
    "assignedToName": "محمد أحمد",
    "dueDate": "2026-07-20",
    "status": "open",
    "createdAt": "2026-07-16T15:00:00Z"
  }
}
```

---

### 4️⃣ POST /api/tasks/{id}/complete
**Mark task as completed**

```bash
curl -X POST \
  -H "X-User-Id: user-123" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Done! Added watermark to all pages."}' \
  http://localhost:8080/api/tasks/{taskId}/complete
```

**Request:**
```json
{
  "comment": "Done! Added watermark..."  // optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "taskId": "uuid-task",
    "status": "completed",
    "completedAt": "2026-07-18T14:30:00Z",
    "message": "Task completed successfully"
  }
}
```

**Error Cases:**
```json
// Only assigned user can complete
{
  "success": false,
  "error": "Only assigned user can complete this task"
}

// Already completed
{
  "success": false,
  "error": "Task is already completed"
}
```

---

### 5️⃣ PUT /api/tasks/{id}
**Update task details**

```bash
curl -X PUT \
  -H "X-User-Id: user-123" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated title",
    "dueDate": "2026-07-25",
    "rcaText": "Root cause: unclear requirements"
  }' \
  http://localhost:8080/api/tasks/{taskId}
```

**Request:**
```json
{
  "title": "...",              // optional
  "description": "...",        // optional
  "dueDate": "2026-07-25",     // optional
  "rcaText": "Root cause...",  // optional (for PCAR tasks)
  "preventiveActions": "..."   // optional (for PCAR tasks)
}
```

---

### 6️⃣ GET /api/tasks/overdue/list
**Get all overdue tasks (for management)**

```bash
curl -H "X-User-Id: manager-123" \
  "http://localhost:8080/api/tasks/overdue/list?limit=50"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "taskId": "uuid-task1",
      "documentId": "uuid-doc1",
      "title": "Urgent: Add signatures",
      "assignedTo": {
        "userId": "user-456",
        "fullName": "علي محمود"
      },
      "dueDate": "2026-07-10",
      "status": "open",
      "daysOverdue": 6,
      "createdAt": "2026-07-05T10:00:00Z"
    }
  ],
  "count": 1
}
```

---

### 7️⃣ GET /api/tasks/document/{documentId}
**Get all tasks related to a document**

```bash
curl -H "X-User-Id: user-123" \
  http://localhost:8080/api/tasks/document/{docId}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "taskId": "uuid-task1",
      "title": "Add watermark",
      "taskType": "correction",
      "assignedTo": {
        "userId": "user-123",
        "fullName": "محمد أحمد"
      },
      "dueDate": "2026-07-20",
      "status": "open",
      "createdAt": "2026-07-16T15:00:00Z",
      "completedAt": null
    },
    {
      "taskId": "uuid-task2",
      "title": "Review by QA",
      "taskType": "audit_action",
      "assignedTo": {
        "userId": "qa-user",
        "fullName": "فاطمة علي"
      },
      "dueDate": "2026-07-25",
      "status": "open",
      "createdAt": "2026-07-16T15:05:00Z",
      "completedAt": null
    }
  ],
  "count": 2
}
```

---

## Task Types

| Type | Purpose | Example |
| :-- | :-- | :-- |
| `correction` | Document needs corrections | "Add watermark", "Fix typos" |
| `rca` | Root cause analysis (PCAR) | "Investigate why error occurred" |
| `audit_action` | Compliance audit action | "Review document for ISO compliance" |

---

## Workflow Example

```
1. Manager creates document & approves it (RELEASED)
   POST /documents/{id}/approve

2. Manager finds issue & creates task
   POST /tasks
   {
     "documentId": "uuid-doc",
     "assignedToId": "writer-user",
     "title": "Add watermark to all pages",
     "dueDate": "2026-07-20"
   }

3. Writer gets notification (future: email/app)
   Gets tasks: GET /tasks
   → Status: "open", DueDate: 2026-07-20

4. Writer completes task
   POST /tasks/{taskId}/complete
   → Status: "completed"

5. Manager checks progress
   GET /tasks/overdue/list
   OR
   GET /tasks/document/{docId}
   → Sees task completion status
```

---

## Audit Logging

| Action | Audit Log | Metadata |
| :-- | :-- | :-- |
| Task Completed | TASK_COMPLETED | taskId, documentId, title, completedAt |

Example:
```json
{
  "logId": "uuid-log",
  "userId": "user-123",
  "action": "TASK_COMPLETED",
  "metadata": {
    "taskId": "uuid-task",
    "documentId": "uuid-doc",
    "title": "Add watermark to all pages",
    "taskType": "correction",
    "completedAt": "2026-07-18T14:30:00Z",
    "comment": "Done! Added watermark to all pages."
  },
  "createdAt": "2026-07-18T14:30:00Z"
}
```

---

## Frontend Integration

### My Tasks Dashboard

```javascript
// Load my tasks on startup
const tasks = await fetch('/api/tasks?status=open')
  .then(r => r.json())

// Display in list/card format
{tasks.data.map(task => (
  <TaskCard
    key={task.taskId}
    task={task}
    isOverdue={task.isOverdue}
    onComplete={() => handleComplete(task.taskId)}
  />
))}

// Mark as complete
const handleComplete = async (taskId) => {
  await fetch(`/api/tasks/${taskId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ comment: 'Done!' })
  })
  refetch()
}
```

### Task Details

```javascript
<TaskDetails>
  <Title>{task.title}</Title>
  <AssignedTo>
    {task.assignedTo.fullName} ({task.assignedTo.email})
  </AssignedTo>
  <DueDate>
    Due: {formatDate(task.dueDate)}
    {isOverdue && <Badge color="danger">Overdue</Badge>}
  </DueDate>
  <Button onClick={complete}>Mark Complete</Button>
</TaskDetails>
```

---

## Next Steps

1. ✅ Checkout endpoints
2. ✅ Approval workflow
3. ✅ Background jobs (auto-unlock)
4. ✅ Tasks system
5. ⏳ Reminders system (email/app notifications)
6. ⏳ Frontend UI (React components)

