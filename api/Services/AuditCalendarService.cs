using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class AuditCalendarService(DmsContext context, AuditService auditService, ILogger<AuditCalendarService> logger)
{
    public static readonly string[] ValidPhases =
    [
        "Internal Audit", "Stage 1 Audit", "Stage 2 Audit",
        "Surveillance Audit", "Recertification Audit", "Management Review",
    ];

    public static readonly string[] ValidStandards = ["ISO 9001:2015", "ISO 27001:2022", "Both"];

    public async Task<List<object>> GetAllAsync()
    {
        var events = await context.AuditCalendarEvents
            .OrderBy(e => e.EventDate)
            .Select(e => new
            {
                e.EventId,
                e.Title,
                e.Phase,
                e.Standard,
                e.EventDate,
                e.Notes,
                e.PostedBy,
                PostedByName = e.PostedByUser == null ? null : e.PostedByUser.FullName,
                e.CreatedAt,
            })
            .ToListAsync();

        return events.Cast<object>().ToList();
    }

    public async Task<AuditCalendarResult> CreateAsync(string title, string phase, string standard, DateOnly eventDate, string? notes, Guid postedBy)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(title))
                return AuditCalendarResult.Invalid("Title is required");
            if (!ValidPhases.Contains(phase))
                return AuditCalendarResult.Invalid($"Phase must be one of: {string.Join(", ", ValidPhases)}");
            if (!ValidStandards.Contains(standard))
                return AuditCalendarResult.Invalid($"Standard must be one of: {string.Join(", ", ValidStandards)}");

            var auditEvent = new DmsAuditCalendarEvent
            {
                EventId = Guid.NewGuid(),
                Title = title.Trim(),
                Phase = phase,
                Standard = standard,
                EventDate = eventDate,
                Notes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim(),
                PostedBy = postedBy,
                CreatedAt = DateTime.UtcNow,
            };

            context.AuditCalendarEvents.Add(auditEvent);
            await context.SaveChangesAsync();

            await auditService.LogAsync(postedBy, AuditActions.AUDIT_EVENT_CREATED, new
            {
                auditEvent.EventId,
                auditEvent.Title,
                auditEvent.Phase,
                auditEvent.Standard,
                auditEvent.EventDate,
            });

            logger.LogInformation("Created audit calendar event {EventId}", auditEvent.EventId);

            return AuditCalendarResult.Ok(new
            {
                auditEvent.EventId,
                auditEvent.Title,
                auditEvent.Phase,
                auditEvent.Standard,
                auditEvent.EventDate,
                auditEvent.Notes,
                auditEvent.PostedBy,
                auditEvent.CreatedAt,
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating audit calendar event");
            return AuditCalendarResult.Fail(ex.Message);
        }
    }

    public async Task<AuditCalendarResult> DeleteAsync(Guid eventId, Guid actorUserId)
    {
        try
        {
            var auditEvent = await context.AuditCalendarEvents.FirstOrDefaultAsync(e => e.EventId == eventId);
            if (auditEvent == null)
                return AuditCalendarResult.NotFound("Audit event not found");

            // Per-user Google Calendar copies (dms_user_calendar_event_syncs) are
            // cleaned up via ON DELETE CASCADE — no explicit Google API call here;
            // the next per-user sync pass simply won't re-create what's gone.
            context.AuditCalendarEvents.Remove(auditEvent);
            await context.SaveChangesAsync();

            await auditService.LogAsync(actorUserId, AuditActions.AUDIT_EVENT_DELETED, new
            {
                auditEvent.EventId,
                auditEvent.Title,
                auditEvent.EventDate,
            });

            logger.LogInformation("Deleted audit calendar event {EventId}", eventId);
            return AuditCalendarResult.Ok(new { auditEvent.EventId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting audit calendar event {EventId}", eventId);
            return AuditCalendarResult.Fail(ex.Message);
        }
    }
}

public class AuditCalendarResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static AuditCalendarResult Ok(object data) => new() { Success = true, Data = data };
    public static AuditCalendarResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static AuditCalendarResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static AuditCalendarResult Fail(string message) => new() { Success = false, Message = message, Error = "InternalError" };
}
