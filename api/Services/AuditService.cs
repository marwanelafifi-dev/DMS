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
    public const string DOCUMENT_SUBMITTED = "DOCUMENT_SUBMITTED";
    public const string DOCUMENT_APPROVED = "DOCUMENT_APPROVED";
    public const string DOCUMENT_REJECTED = "DOCUMENT_REJECTED";

    public const string TASK_COMPLETED = "TASK_COMPLETED";

    public const string PERMISSION_GRANTED = "PERMISSION_GRANTED";
    public const string PERMISSION_REVOKED = "PERMISSION_REVOKED";

    public const string REMINDER_SENT = "REMINDER_SENT";

    public const string USER_CREATED = "USER_CREATED";
    public const string USER_UPDATED = "USER_UPDATED";
    public const string USER_DEACTIVATED = "USER_DEACTIVATED";
    public const string USER_DELETED = "USER_DELETED";
    public const string USER_PASSWORD_RESET = "USER_PASSWORD_RESET";
}
