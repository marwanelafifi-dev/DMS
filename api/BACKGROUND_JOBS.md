# Background Jobs — Hangfire Integration

## نظرة عامة
نظام معالجة الـ background jobs باستخدام Hangfire. يقوم بتنفيذ مهام دورية (recurring jobs) بدون تدخل يدوي.

---

## Jobs المُنفَّذة

### 1️⃣ Auto-Unlock Expired Checkouts
**Runs every 5 minutes**

```
Job Name:   auto-unlock-expired-checkouts
Schedule:   Every 5 minutes (Cron.MinuteInterval(5))
Function:   CheckoutService.AutoUnlockExpiredCheckoutsAsync()
Purpose:    Unlock documents with expired checkout locks (>60 min)
```

**What it does:**
1. Queries all checked-out versions
2. Checks if `CheckedOutAt + 60 min < DateTime.UtcNow`
3. If expired:
   - Sets `IsCheckedOut = false`
   - Clears `CheckedOutById`, `CheckedOutAt`, `CheckoutReason`
   - Logs audit event: `DOCUMENT_CHECKOUT_EXPIRED`
4. Returns count of unlocked documents

**Example log entry:**
```json
{
  "logId": "uuid-log",
  "userId": "system",
  "action": "DOCUMENT_CHECKOUT_EXPIRED",
  "metadata": {
    "versionId": "uuid-version",
    "documentId": "uuid-doc",
    "versionNumber": "1.0",
    "message": "Checkout expired (60 min timeout)"
  },
  "createdAt": "2026-07-16T15:05:00Z"
}
```

---

## API Endpoints

### 1️⃣ GET /api/backgroundjobs/status
**Check background job statistics**

```bash
curl -H "X-User-Id: user-123" \
  http://localhost:8080/api/backgroundjobs/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "enqueued": 0,
    "failed": 0,
    "processing": 0,
    "scheduled": 0,
    "succeeded": 145,
    "deleted": 0,
    "recurring": 1,
    "timestampUtc": "2026-07-16T15:00:00Z"
  }
}
```

| Field | Meaning |
| :-- | :-- |
| `enqueued` | Queued jobs waiting to run |
| `failed` | Failed jobs |
| `processing` | Currently processing |
| `scheduled` | Scheduled for future execution |
| `succeeded` | Successfully completed |
| `recurring` | Recurring jobs configured |

---

### 2️⃣ POST /api/backgroundjobs/run-auto-unlock
**Manually trigger auto-unlock job**

```bash
curl -X POST \
  -H "X-User-Id: admin-123" \
  http://localhost:8080/api/backgroundjobs/run-auto-unlock
```

**Response:**
```json
{
  "success": true,
  "message": "Auto-unlock job queued for immediate execution"
}
```

**Use case:** Testing or manual trigger if needed

---

### 3️⃣ GET /api/backgroundjobs/dashboard-url
**Get Hangfire dashboard URL**

```bash
curl -H "X-User-Id: user-123" \
  http://localhost:8080/api/backgroundjobs/dashboard-url
```

**Response:**
```json
{
  "success": true,
  "data": {
    "dashboardUrl": "/hangfire",
    "description": "Hangfire job dashboard (read-only for now)"
  }
}
```

---

## Hangfire Dashboard

### Access Point
```
http://localhost:8080/hangfire
```

### Features
- ✅ Monitor all background jobs
- ✅ View job history
- ✅ Check recurring job schedules
- ✅ See failed jobs (with error details)
- ✅ Real-time statistics

### Tabs
```
Jobs        → Active, scheduled, succeeded, failed
Recurring   → Recurring job configurations
Batches     → Job batches (if used)
Servers     → Hangfire server status
```

### Example Dashboard View
```
Recurring Jobs
├─ auto-unlock-expired-checkouts
│  ├─ Status: Active
│  ├─ Schedule: Every 5 minutes
│  ├─ Last Execution: 14:55 UTC
│  ├─ Next Execution: 15:00 UTC
│  └─ Status: Succeeded (0 unlocked)
│
└─ [More jobs here]
```

---

## Configuration

### Hangfire Setup (Program.cs)

```csharp
// Add Hangfire services
builder.Services.AddHangfire(config =>
    config.UsePostgreSqlStorage(connectionString));
builder.Services.AddHangfireServer();

// Enable dashboard
app.UseHangfireDashboard("/hangfire");

// Configure recurring jobs
using (var scope = app.Services.CreateScope())
{
    var recurringJobManager = scope.ServiceProvider.GetRequiredService<IRecurringJobManager>();
    app.ConfigureBackgroundJobs(recurringJobManager);
}
```

### Storage
- **Database:** PostgreSQL (same as main DB)
- **Table prefix:** `hangfire_`
- **Auto-cleanup:** Old job records cleaned up automatically

---

## Job Lifecycle

```
┌─────────────────────────────────────┐
│ Recurring Job Trigger (Every 5 min) │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Create Job Instance  │
    │ Enqueue to queue     │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Hangfire Server      │
    │ picks up job         │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Execute Job:         │
    │ - Query expired      │
    │ - Unlock if expired  │
    │ - Log to audit trail │
    └──────────┬───────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
   ✓ Succeeded   ✗ Failed
        │             │
        └──────┬──────┘
               ▼
    ┌──────────────────────┐
    │ Update Dashboard     │
    │ Store execution log  │
    └──────────────────────┘
```

---

## Monitoring & Debugging

### Check Job Status
```bash
# Via API
curl http://localhost:8080/api/backgroundjobs/status

# Via Dashboard
http://localhost:8080/hangfire
```

### Common Issues

**Job not running?**
- Check if Hangfire server is started
- Verify PostgreSQL connection
- Check `/hangfire` dashboard for errors
- Manually trigger: `POST /api/backgroundjobs/run-auto-unlock`

**Too many unlocks?**
- Timeout may be too short (currently 60 min)
- Adjust in `CheckoutService.CheckoutTimeoutMinutes`

**Database growing?**
- Hangfire automatically cleans old job records
- Retention: 360 days for succeeded jobs, 15 days for failed

---

## Adding More Jobs

To add new recurring jobs, update `BackgroundJobExtensions.ConfigureBackgroundJobs()`:

```csharp
public static void ConfigureBackgroundJobs(this IApplicationBuilder app, IRecurringJobManager recurringJobManager)
{
    // Auto-unlock checkouts every 5 minutes
    recurringJobManager.AddOrUpdate<BackgroundJobService>(
        "auto-unlock-expired-checkouts",
        service => service.RunAutoUnlockCheckoutsAsync(),
        Cron.MinuteInterval(5));

    // Example: Send pending reminders daily at 9 AM
    recurringJobManager.AddOrUpdate<ReminderService>(
        "send-pending-reminders",
        service => service.SendPendingRemindersAsync(),
        Cron.Daily(9));

    // Example: Archive old documents monthly
    recurringJobManager.AddOrUpdate<ArchiveService>(
        "archive-old-documents",
        service => service.ArchiveOldDocumentsAsync(),
        Cron.Monthly(15)); // 15th of each month
}
```

### Cron Expressions
```
Cron.Never()                           // Never run
Cron.Yearly()                          // Yearly (Jan 1st at midnight)
Cron.Monthly(15)                       // 15th of each month
Cron.Weekly(DayOfWeek.Monday)          // Every Monday
Cron.Daily(9, 30)                      // Every day at 9:30 AM
Cron.Hourly()                          // Every hour
Cron.MinuteInterval(5)                 // Every 5 minutes
Cron.Daily(0, 0)                       // Every day at midnight
```

---

## Production Considerations

✅ **PostgreSQL Storage** — Durable, survives restarts  
✅ **Auto-cleanup** — Old job records cleaned automatically  
✅ **Audit Logging** — All job executions logged  
✅ **Dashboard Monitoring** — Real-time visibility  
✅ **Error Handling** — Failures logged, retries possible  

⚠️ **Security Note:**
- Dashboard is currently open (no auth)
- In production, add authentication:
```csharp
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new AdminAuthorizationFilter() }
});
```

---

## Next Steps

1. ✅ Auto-unlock checkout job (done)
2. ⏳ Send pending reminders daily
3. ⏳ Archive old documents monthly
4. ⏳ Generate compliance reports
5. ⏳ Clean up old audit logs (keep for 7 years)

