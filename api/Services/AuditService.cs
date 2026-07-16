using DMS.Api.Data;
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
        try
        {
            var query = context.AuditTrails.AsQueryable();

            if (userId.HasValue)
                query = query.Where(a => a.UserId == userId);

            if (!string.IsNullOrEmpty(action))
                query = query.Where(a => a.Action == action);

            var trails = await query
                .OrderByDescending(a => a.CreatedAt)
                .Take(limit)
                .Select(a => new
                {
                    a.LogId,
                    a.UserId,
                    a.Action,
                    a.Metadata,
                    a.CreatedAt
                })
                .ToListAsync();

            logger.LogInformation("Retrieved {Count} audit trails", trails.Count);

            return trails.Cast<object>().ToList();
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

    public const string USER_CREATED = "USER_CREATED";
    public const string USER_UPDATED = "USER_UPDATED";
    public const string USER_DEACTIVATED = "USER_DEACTIVATED";

    public const string PERMISSION_GRANTED = "PERMISSION_GRANTED";
    public const string PERMISSION_REVOKED = "PERMISSION_REVOKED";
}
