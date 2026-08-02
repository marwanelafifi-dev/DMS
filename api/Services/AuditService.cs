using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace DMS.Api.Services;

public class AuditService(DmsContext context, ILogger<AuditService> logger)
{
    public async Task LogAsync(Guid userId, string action, object? metadata = null)
    {
        try
        {
            var auditTrail = new DmsAuditTrail
            {
                LogId = Guid.NewGuid(),
                UserId = userId,
                Action = action,
                Metadata = metadata != null ? JsonDocument.Parse(JsonSerializer.Serialize(metadata)) : null,
                CreatedAt = DateTime.UtcNow
            };

            context.AuditTrails.Add(auditTrail);
            await context.SaveChangesAsync();

            logger.LogInformation("Audit logged: {Action} by user {UserId}", action, userId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error logging audit trail for action {Action}", action);
            throw;
        }
    }

    public async Task<List<object>> GetAuditTrailAsync(Guid? userId = null, string? action = null, int limit = 100)
    {
        var (items, _) = await GetAuditTrailPageAsync(userId, action, page: 1, pageSize: limit);
        return items;
    }

    public async Task<(List<object> Items, int TotalCount)> GetAuditTrailPageAsync(
        Guid? userId = null, string? action = null, int page = 1, int pageSize = 100)
    {
        try
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 500);

            var query = context.AuditTrails.AsQueryable();

            if (userId.HasValue)
                query = query.Where(a => a.UserId == userId);

            if (!string.IsNullOrEmpty(action))
                query = query.Where(a => a.Action == action);

            var totalCount = await query.CountAsync();

            var trails = await query
                .OrderByDescending(a => a.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(a => new
                {
                    a.LogId,
                    a.UserId,
                    a.Action,
                    a.Metadata,
                    a.CreatedAt
                })
                .ToListAsync();

            logger.LogInformation("Retrieved {Count}/{Total} audit trails (page {Page})", trails.Count, totalCount, page);

            return (trails.Cast<object>().ToList(), totalCount);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving audit trails");
            throw;
        }
    }
}

public static class AuditActions
{
    public const string FOLDER_CREATED = "FOLDER_CREATED";
    public const string FOLDER_UPDATED = "FOLDER_UPDATED";
    public const string FOLDER_DELETED = "FOLDER_DELETED";

    public const string DOCUMENT_CREATED = "DOCUMENT_CREATED";
    public const string DOCUMENT_UPDATED = "DOCUMENT_UPDATED";
    public const string DOCUMENT_DELETED = "DOCUMENT_DELETED";
    public const string DOCUMENT_UPLOADED = "DOCUMENT_UPLOADED";
    public const string DOCUMENT_DOWNLOADED = "DOCUMENT_DOWNLOADED";
    public const string DOCUMENT_CHECKOUT = "DOCUMENT_CHECKOUT";
    public const string DOCUMENT_CHECKIN = "DOCUMENT_CHECKIN";
    public const string DOCUMENT_CHECKOUT_EXPIRED = "DOCUMENT_CHECKOUT_EXPIRED";
    public const string DOCUMENT_CHECKOUT_FORCE_UNLOCKED = "DOCUMENT_CHECKOUT_FORCE_UNLOCKED";
    public const string DOCUMENT_SUBMITTED = "DOCUMENT_SUBMITTED";
    public const string DOCUMENT_APPROVED = "DOCUMENT_APPROVED";
    public const string DOCUMENT_REJECTED = "DOCUMENT_REJECTED";

    public const string TASK_COMPLETED = "TASK_COMPLETED";
    public const string CORRECTION_TASK_COMPLETED = "CORRECTION_TASK_COMPLETED";

    public const string PERMISSION_GRANTED = "PERMISSION_GRANTED";
    public const string PERMISSION_REVOKED = "PERMISSION_REVOKED";

    public const string REMINDER_SENT = "REMINDER_SENT";
    public const string REMINDER_CREATED = "REMINDER_CREATED";
    public const string REMINDER_DELETED = "REMINDER_DELETED";
    public const string AUDIT_EVENT_CREATED = "AUDIT_EVENT_CREATED";
    public const string AUDIT_EVENT_DELETED = "AUDIT_EVENT_DELETED";
    public const string GOOGLE_CALENDAR_CONNECTED = "GOOGLE_CALENDAR_CONNECTED";
    public const string GOOGLE_CALENDAR_DISCONNECTED = "GOOGLE_CALENDAR_DISCONNECTED";
    public const string GOOGLE_CALENDAR_SYNCED = "GOOGLE_CALENDAR_SYNCED";

    public const string USER_CREATED = "USER_CREATED";
    public const string USER_UPDATED = "USER_UPDATED";
    public const string USER_DEACTIVATED = "USER_DEACTIVATED";
    public const string USER_DELETED = "USER_DELETED";
    public const string USER_PASSWORD_RESET = "USER_PASSWORD_RESET";
    public const string USER_LOGIN = "USER_LOGIN";

    public const string GROUP_CREATED = "GROUP_CREATED";
    public const string GROUP_UPDATED = "GROUP_UPDATED";
    public const string GROUP_DELETED = "GROUP_DELETED";
    public const string GROUP_MEMBER_ADDED = "GROUP_MEMBER_ADDED";
    public const string GROUP_MEMBER_REMOVED = "GROUP_MEMBER_REMOVED";
    public const string GROUP_SUBGROUP_ADDED = "GROUP_SUBGROUP_ADDED";
    public const string GROUP_SUBGROUP_REMOVED = "GROUP_SUBGROUP_REMOVED";

    public const string ROLE_PERMISSIONS_UPDATED = "ROLE_PERMISSIONS_UPDATED";
    public const string ROLE_CREATED = "ROLE_CREATED";
    public const string ROLE_DELETED = "ROLE_DELETED";
    public const string USER_ROLE_UPDATED = "USER_ROLE_UPDATED";

    public const string ACCESS_OVERRIDE_CREATED = "ACCESS_OVERRIDE_CREATED";
    public const string ACCESS_OVERRIDE_UPDATED = "ACCESS_OVERRIDE_UPDATED";
    public const string ACCESS_OVERRIDE_DELETED = "ACCESS_OVERRIDE_DELETED";

    public const string DROPDOWN_ITEM_CREATED = "DROPDOWN_ITEM_CREATED";
    public const string DROPDOWN_ITEM_DELETED = "DROPDOWN_ITEM_DELETED";
    public const string DROPDOWN_ITEMS_IMPORTED = "DROPDOWN_ITEMS_IMPORTED";
}
