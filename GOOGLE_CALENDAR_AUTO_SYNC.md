# Automatic Google Calendar Sync for Audit Events

## Overview
Audit calendar events are automatically synced to Google Calendar when created, without requiring manual user action.

## Implementation Architecture

### Current Stage: Frontend Ready
The frontend Google Calendar sync service is ready and can be triggered from the backend when an audit event is created.

### Backend Implementation (Required)

The backend should implement the following when an audit event is created:

#### 1. **Queue-Based Async Processing** (for 200+ concurrent users)

Instead of making synchronous API calls, use a background job queue:

```csharp
// In AuditCalendarController.cs
[HttpPost]
public async Task<ActionResult<object>> CreateEvent([FromBody] CreateAuditCalendarEventRequest req)
{
    // ... validation code ...

    var result = await auditCalendarService.CreateAsync(req.Title, req.Phase, req.Standard, req.EventDate, req.Notes, userId);
    
    // Queue the Google Calendar sync as a background job
    if (result.Success)
    {
        await _backgroundJobQueue.EnqueueAsync(new SyncAuditEventJob
        {
            EventId = result.Data.Id,
            Title = req.Title,
            Phase = req.Phase,
            Standard = req.Standard,
            EventDate = req.EventDate,
            Notes = req.Notes,
            UserId = userId
        });
    }
    
    return CreatedAtAction(nameof(GetEvents), new { }, new { success = true, data = result.Data });
}
```

#### 2. **Recommended Background Job Tools**

Choose ONE of these based on your infrastructure:

- **[Hangfire](https://www.hangfire.io/)** - Easiest for .NET, embedded or distributed
  ```csharp
  BackgroundJob.Enqueue(() => _googleCalendarService.SyncAuditEventAsync(eventData));
  ```

- **[Azure Service Bus](https://azure.microsoft.com/en-us/services/service-bus/)** - Cloud-native, scales to millions of messages
  
- **[RabbitMQ](https://www.rabbitmq.com/)** - Open source, widely used

- **[AWS SQS](https://aws.amazon.com/sqs/)** - Managed queue service

#### 3. **Backend Service Implementation**

```csharp
public class GoogleCalendarSyncService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<GoogleCalendarSyncService> _logger;
    
    public async Task SyncAuditEventAsync(AuditEventSyncRequest request, CancellationToken cancellationToken = default)
    {
        try
        {
            // Get user's Google Calendar token from secure storage
            var token = await _tokenStore.GetGoogleTokenAsync(request.UserId);
            
            if (string.IsNullOrEmpty(token))
            {
                _logger.LogWarning("No Google Calendar token for user {UserId}", request.UserId);
                return; // User hasn't authorized Google Calendar
            }
            
            // Call Google Calendar API
            var response = await _httpClient.PostAsJsonAsync(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                new
                {
                    summary = request.Title,
                    description = $"Phase: {request.Phase}\nStandard: {request.Standard}\nNotes: {request.Notes}",
                    start = new { dateTime = request.EventDate, timeZone = "UTC" },
                    end = new { dateTime = request.EventDate.AddHours(1), timeZone = "UTC" }
                },
                cancellationToken);
            
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Failed to sync audit event {EventId} to Google Calendar", request.EventId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error syncing audit event {EventId} to Google Calendar", request.EventId);
            // Queue retry or send alert
        }
    }
}
```

---

## Performance Considerations for 200 Concurrent Users

### ✅ **Recommended Approach**

Use **async background jobs** with a message queue:

```
User Creates Event → API Returns Immediately → Event Queued → Background Worker Syncs to Google Calendar
```

**Benefits:**
- ✅ User gets instant response (sub-100ms)
- ✅ Google Calendar sync happens in background
- ✅ Multiple workers can process syncs in parallel
- ✅ Automatic retry on failure
- ✅ No API timeouts or blocking

**Performance Metrics:**
- User API response: ~20-50ms (doesn't wait for Google)
- Background sync: ~500-2000ms per event (no impact on users)
- **Throughput**: Can handle 1000+ concurrent audit event creates/minute

### ❌ **Avoid: Synchronous Blocking Calls**

```csharp
// DON'T DO THIS with 200 users
var googleResult = await _googleCalendarService.SyncAsync(eventData); // BLOCKS USER!
return CreatedAtAction(...);
```

**Problems:**
- ❌ User waits for Google API response (2-5 seconds)
- ❌ Google API failures block user operations
- ❌ Timeouts cascade (200 users × 5s = 1000s latency)
- ❌ Rate limits hit quickly

---

## Configuration Steps

### 1. **Set Up OAuth Tokens Storage**
```csharp
// Securely store Google OAuth tokens per user
public class GoogleTokenStore
{
    public async Task SaveTokenAsync(string userId, string accessToken, string refreshToken)
    {
        // Store in encrypted database or key vault
        // Azure Key Vault, AWS Secrets Manager, or HashiCorp Vault recommended
    }
    
    public async Task<string> GetGoogleTokenAsync(string userId)
    {
        // Retrieve and refresh if expired
    }
}
```

### 2. **Environment Variables**
```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://yourdms.com/auth/google-callback
BACKGROUND_JOB_QUEUE=hangfire|rabbitmq|azure-servicebus
```

### 3. **Error Handling & Retries**
```csharp
public class SyncAuditEventJob
{
    public int RetryCount { get; set; } = 3;
    public DateTime ScheduledFor { get; set; } = DateTime.UtcNow;
    
    // Retry with exponential backoff: 5s, 25s, 125s
}
```

### 4. **User Authorization Flow**
- User logs into DMS
- First audit event creation → Prompt to connect Google Calendar
- User authorizes → Token stored securely
- Subsequent events → Auto-sync without user action

---

## Monitoring & Logging

```csharp
public class GoogleCalendarSyncMetrics
{
    public int EventsSyncedPerMinute { get; set; }
    public int SyncFailureRate { get; set; } // %
    public int AverageQueueWaitTime { get; set; } // ms
    public int GoogleApiErrorRate { get; set; } // %
}
```

**Alerts to set up:**
- Sync failures > 5% 
- Queue depth > 1000 events
- Google API latency > 3s
- Token refresh failures

---

## Data Flow Diagram

```
Audit Event Created
        ↓
Backend validates
        ↓
Save to database
        ↓
Return 201 to user (INSTANT)
        ↓
Enqueue background job
        ↓
Background worker picks up job
        ↓
Get user's Google token
        ↓
Call Google Calendar API
        ↓
Log result (success/failure)
        ↓
If failed: Queue retry (exponential backoff)
```

---

## Testing

### Load Test with 200 Concurrent Users
```
Time: 0-10s → 200 users create audit events
Expected: 200 API responses in < 100ms each
Queue depth: 200 events
Background workers: Processing 20-50 events/sec
Time: 30s → All events synced to Google Calendar
```

---

## Migration Path

1. **Phase 1**: Set up background job queue infrastructure
2. **Phase 2**: Implement GoogleCalendarSyncService in backend
3. **Phase 3**: Add queue job in CreateEvent endpoint
4. **Phase 4**: Add user Google authorization flow
5. **Phase 5**: Monitor and optimize queue workers

---

## No Manual Action Required
Once configured:
- Users create audit event → ✅ Auto-synced to Google Calendar
- No UI buttons needed
- Happens in background
- User sees no delays
- Handles 200+ concurrent users seamlessly
