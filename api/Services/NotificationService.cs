using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// Real per-user notifications — approval/reject/release on a document you
// own, someone editing your document's metadata, and your document being
// locked (download-for-editing) or unlocked. Never notifies the actor about
// their own action.
public class NotificationService(DmsContext context, ILogger<NotificationService> logger)
{
    public async Task NotifyAsync(Guid recipientUserId, Guid actorUserId, string title, string? body = null, Guid? documentId = null, Guid? taskId = null)
    {
        if (recipientUserId == actorUserId)
            return;

        try
        {
            context.Notifications.Add(new DmsNotification
            {
                NotificationId = Guid.NewGuid(),
                UserId = recipientUserId,
                Title = title,
                Body = body,
                DocumentId = documentId,
                TaskId = taskId,
                IsRead = false,
                CreatedAt = DateTime.UtcNow,
            });
            await context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating notification for user {UserId}", recipientUserId);
        }
    }

    // Looks up the document's owner and notifies them, skipping silently if
    // the document/owner can't be resolved — a notification failing to send
    // should never block the actual action that triggered it.
    public async Task NotifyDocumentOwnerAsync(Guid documentId, Guid actorUserId, string title, string? body = null)
    {
        try
        {
            var ownerId = await context.Documents
                .Where(d => d.DocumentId == documentId)
                .Select(d => (Guid?)d.OwnerId)
                .FirstOrDefaultAsync();

            if (ownerId.HasValue)
                await NotifyAsync(ownerId.Value, actorUserId, title, body, documentId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error notifying owner of document {DocumentId}", documentId);
        }
    }
}
