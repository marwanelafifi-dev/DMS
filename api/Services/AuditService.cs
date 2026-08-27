using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;
using System.Reflection;
using System.Text.Json;

namespace DMS.Api.Services;

public class AuditService(DmsContext context, ILogger<AuditService> logger)
{
    // Real gap found live: an audit entry for a folder edit or a File/Folder
    // Permission change never said WHICH folder/file it was about — just a
    // bare name (or nothing at all), useless once there's more than one
    // folder with that name anywhere in the tree. Walks the real parent
    // chain, same ancestry logic the frontend's own breadcrumb already uses.
    public async Task<string> ResolveFolderPathAsync(Guid? folderId)
    {
        if (!folderId.HasValue) return "(no folder)";
        var names = new List<string>();
        Guid? currentId = folderId;
        var guard = 0;
        while (currentId.HasValue && guard++ < 50)
        {
            var folder = await context.Folders.AsNoTracking()
                .Where(f => f.FolderId == currentId)
                .Select(f => new { f.Name, f.ParentFolderId })
                .FirstOrDefaultAsync();
            if (folder == null) break;
            names.Insert(0, folder.Name);
            currentId = folder.ParentFolderId;
        }
        return names.Count > 0 ? string.Join(" / ", names) : "(deleted folder)";
    }

    // Same idea for a document — its own folder's full path plus the file
    // name itself, so a permission/edit entry says exactly which file, not
    // just a bare title that could collide with another file elsewhere.
    public async Task<string> ResolveDocumentPathAsync(Guid? documentId)
    {
        if (!documentId.HasValue) return "(no document)";
        var doc = await context.Documents.AsNoTracking()
            .Where(d => d.DocumentId == documentId)
            .Select(d => new { d.Title, d.FolderId })
            .FirstOrDefaultAsync();
        if (doc == null) return "(deleted document)";
        var folderPath = await ResolveFolderPathAsync(doc.FolderId);
        return $"{folderPath} / {doc.Title}";
    }

    // A File/Folder Permission override row has ~25 tri-state action flags —
    // logging the whole entity dumped every one of them (mostly null/
    // Inherit) plus internal columns (OverrideId, CreatedBy, timestamps).
    // This picks out only the flags actually set to Allow/Deny, by name, via
    // reflection over the bool? properties so the list can never drift out
    // of sync with DmsAccessOverride as new actions are added.
    public static Dictionary<string, bool> SummarizeOverrideFlags(DmsAccessOverride entity)
    {
        var flags = new Dictionary<string, bool>();
        foreach (var property in typeof(DmsAccessOverride).GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (property.PropertyType != typeof(bool?)) continue;
            if (property.GetValue(entity) is bool value)
                flags[property.Name] = value;
        }
        return flags;
    }

    // Real gap found live: several "*_UPDATED" audit entries logged the raw
    // request object (ChangedFields = req) — every field the endpoint
    // *accepts*, not what actually changed, plus internal noise like
    // UpdatedAt that only restated the entry's own timestamp. The Audit
    // Trail page ended up unreadable ("Tags: ISO 9001, UpdatedAt: 2026-08-
    // 27T09:53:32.72Z, Department: Quality Management, Description: ...")
    // with no way to tell what was actually edited. This builds a clean
    // { field: { from, to } } payload containing only fields whose value
    // genuinely changed — array fields (e.g. Tags) compare by content, not
    // reference.
    public static Dictionary<string, object> BuildChanges(params (string Field, object? Before, object? After)[] fields)
    {
        var changes = new Dictionary<string, object>();
        foreach (var (field, before, after) in fields)
        {
            var unchanged = (before, after) switch
            {
                (string[] b, string[] a) => b.SequenceEqual(a),
                _ => Equals(before, after),
            };
            if (!unchanged)
                changes[field] = new { from = before, to = after };
        }
        return changes;
    }

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
    public const string FOLDER_RESTORED = "FOLDER_RESTORED";
    public const string FOLDER_MOVED = "FOLDER_MOVED";

    public const string DOCUMENT_CREATED = "DOCUMENT_CREATED";
    public const string DOCUMENT_UPDATED = "DOCUMENT_UPDATED";
    public const string DOCUMENT_DELETED = "DOCUMENT_DELETED";
    public const string DOCUMENT_RESTORED = "DOCUMENT_RESTORED";
    public const string RECYCLE_BIN_PURGED = "RECYCLE_BIN_PURGED";
    public const string DOCUMENT_MOVED = "DOCUMENT_MOVED";
    public const string DOCUMENT_UPLOADED = "DOCUMENT_UPLOADED";
    public const string DOCUMENT_VERSION_REVERTED = "DOCUMENT_VERSION_REVERTED";
    public const string DOCUMENT_DOWNLOADED = "DOCUMENT_DOWNLOADED";
    public const string DOCUMENT_CHECKOUT = "DOCUMENT_CHECKOUT";
    public const string DOCUMENT_CHECKIN = "DOCUMENT_CHECKIN";
    public const string DOCUMENT_CHECKOUT_EXPIRED = "DOCUMENT_CHECKOUT_EXPIRED";
    public const string DOCUMENT_CHECKOUT_FORCE_UNLOCKED = "DOCUMENT_CHECKOUT_FORCE_UNLOCKED";
    public const string DOCUMENT_SUBMITTED = "DOCUMENT_SUBMITTED";
    public const string DOCUMENT_APPROVED = "DOCUMENT_APPROVED";
    public const string DOCUMENT_REJECTED = "DOCUMENT_REJECTED";

    public const string TASK_COMPLETED = "TASK_COMPLETED";
    public const string TASK_DELETED = "TASK_DELETED";
    public const string TASK_REASSIGNED = "TASK_REASSIGNED";
    public const string CORRECTION_TASK_COMPLETED = "CORRECTION_TASK_COMPLETED";
    public const string PCAR_SUBMITTED = "PCAR_SUBMITTED";
    public const string PCAR_APPROVED = "PCAR_APPROVED";
    public const string PCAR_REJECTED = "PCAR_REJECTED";
    public const string TASK_ATTACHMENT_UPLOADED = "TASK_ATTACHMENT_UPLOADED";
    public const string TASK_ATTACHMENT_DELETED = "TASK_ATTACHMENT_DELETED";

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
    public const string USER_CONVERTED_TO_GOOGLE = "USER_CONVERTED_TO_GOOGLE";
    public const string USERS_IMPORTED = "USERS_IMPORTED";
    public const string USER_OWNERSHIP_TRANSFERRED = "USER_OWNERSHIP_TRANSFERRED";
    public const string USER_LOGIN = "USER_LOGIN";

    public const string GROUP_CREATED = "GROUP_CREATED";
    public const string GROUP_UPDATED = "GROUP_UPDATED";
    public const string GROUP_DELETED = "GROUP_DELETED";
    public const string GROUP_MEMBER_ADDED = "GROUP_MEMBER_ADDED";
    public const string GROUP_MEMBER_REMOVED = "GROUP_MEMBER_REMOVED";
    public const string GROUP_SUBGROUP_ADDED = "GROUP_SUBGROUP_ADDED";
    public const string GROUP_SUBGROUP_REMOVED = "GROUP_SUBGROUP_REMOVED";
    public const string GROUPS_IMPORTED = "GROUPS_IMPORTED";
    public const string NOTIFICATION_SENT = "NOTIFICATION_SENT";

    public const string ROLE_PERMISSIONS_UPDATED = "ROLE_PERMISSIONS_UPDATED";
    public const string ROLE_CREATED = "ROLE_CREATED";
    public const string ROLE_DELETED = "ROLE_DELETED";
    public const string ROLE_RENAMED = "ROLE_RENAMED";
    public const string USER_ROLE_UPDATED = "USER_ROLE_UPDATED";

    public const string ACCESS_OVERRIDE_CREATED = "ACCESS_OVERRIDE_CREATED";
    public const string ACCESS_OVERRIDE_UPDATED = "ACCESS_OVERRIDE_UPDATED";
    public const string ACCESS_OVERRIDE_DELETED = "ACCESS_OVERRIDE_DELETED";

    public const string DROPDOWN_ITEM_CREATED = "DROPDOWN_ITEM_CREATED";
    public const string DROPDOWN_ITEM_DELETED = "DROPDOWN_ITEM_DELETED";
    public const string DROPDOWN_ITEMS_IMPORTED = "DROPDOWN_ITEMS_IMPORTED";

    public const string APP_SETTING_UPDATED = "APP_SETTING_UPDATED";

    public const string ANNOUNCEMENT_CREATED = "ANNOUNCEMENT_CREATED";
    public const string ANNOUNCEMENT_DELETED = "ANNOUNCEMENT_DELETED";

    public const string EMAIL_NOTIFICATION_CONFIG_UPDATED = "EMAIL_NOTIFICATION_CONFIG_UPDATED";
    public const string EMAIL_NOTIFICATION_TEST_SENT = "EMAIL_NOTIFICATION_TEST_SENT";

    public const string DATABASE_BACKUP_EXPORTED = "DATABASE_BACKUP_EXPORTED";
    public const string DATABASE_BACKUP_RESTORED = "DATABASE_BACKUP_RESTORED";
    public const string DATABASE_DATA_CLEARED = "DATABASE_DATA_CLEARED";
}
