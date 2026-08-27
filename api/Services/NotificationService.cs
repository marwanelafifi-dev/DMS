using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Services;

// Real per-user notifications — approval/reject/release on a document you
// own, someone editing your document's metadata, and your document being
// locked (download-for-editing) or unlocked. Never notifies the actor about
// their own action.
public class NotificationService(DmsContext context, EmailService emailService, AccessOverrideService accessOverrideService, AuditService auditService, IConfiguration configuration, ILogger<NotificationService> logger)
{
    public async Task NotifyAsync(Guid recipientUserId, Guid actorUserId, string title, string? body = null, Guid? documentId = null, Guid? taskId = null, Guid? announcementId = null)
    {
        if (!await emailService.AreNotificationsEnabledAsync())
            return;

        if (recipientUserId == actorUserId)
            return;

        // Nobody — regardless of role, and regardless of whether they're the
        // document's own owner or the person who submitted it — should ever
        // be told about a document they don't actually have real access to
        // open. Checked here, in the one shared method every document
        // notification funnels through, so it applies uniformly to every
        // caller (owner, submitter, stage reviewers, and any future one)
        // instead of needing to be re-implemented per call site.
        if (documentId.HasValue)
        {
            var folderId = await context.Documents.AsNoTracking()
                .Where(d => d.DocumentId == documentId.Value)
                .Select(d => (Guid?)d.FolderId)
                .FirstOrDefaultAsync();
            if (!folderId.HasValue)
                return; // the document no longer exists
            if (!await accessOverrideService.HasDocumentReadAccessAsync(recipientUserId, documentId.Value, folderId.Value))
                return;
        }

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
                AnnouncementId = announcementId,
                IsRead = false,
                CreatedAt = DateTime.UtcNow,
            });
            await context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating notification for user {UserId}", recipientUserId);
        }

        // Real gap found live: there was no way to answer "who actually got
        // notified about this?" after the fact — dms_notifications only
        // shows up filtered to the *recipient's own* bell, so an admin (or
        // the actor themselves) had no way to see the full recipient list for
        // a given event. Every notification now leaves a real, searchable
        // record in the Audit Trail (actor = who triggered the event,
        // metadata = who received it) instead of only existing from the
        // recipient's own point of view.
        try
        {
            var recipientName = await context.Users.AsNoTracking()
                .Where(u => u.UserId == recipientUserId)
                .Select(u => u.FullName)
                .FirstOrDefaultAsync();
            await auditService.LogAsync(actorUserId, NOTIFICATION_SENT, new
            {
                RecipientId = recipientUserId,
                RecipientName = recipientName,
                Title = title,
                DocumentId = documentId,
                TaskId = taskId,
                AnnouncementId = announcementId,
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error logging notification audit entry for recipient {UserId}", recipientUserId);
        }

        // Per explicit request: every document-related in-app notification
        // (QA/Manager/Final Release stage transitions, correction requests,
        // rejections, releases — anything that reaches here with a
        // documentId) also goes out as a real email with a direct link back
        // to the document, the same way announcements/reminders already do.
        // Best-effort and never allowed to affect the caller — a missing/
        // unconfigured mailer just means this specific email is skipped
        // (EmailService.SendAsync's own no-op-on-unconfigured behavior),
        // exactly like every other outbound email in this app.
        if (documentId.HasValue)
            await SendDocumentEmailAsync(recipientUserId, documentId.Value, title, body);
        else if (taskId.HasValue)
            await SendTaskEmailAsync(recipientUserId, taskId.Value, title, body);
    }

    private async Task SendTaskEmailAsync(Guid recipientUserId, Guid taskId, string title, string? body)
    {
        try
        {
            var recipient = await context.Users.AsNoTracking()
                .Where(u => u.UserId == recipientUserId && u.IsActive)
                .Select(u => new { u.Email, u.FullName })
                .FirstOrDefaultAsync();
            if (recipient == null || string.IsNullOrWhiteSpace(recipient.Email)) return;

            var task = await context.Tasks.AsNoTracking()
                .Where(t => t.TaskId == taskId)
                .Select(t => new { t.Title, t.DueDate })
                .FirstOrDefaultAsync();
            if (task == null) return;

            var portalUrl = (configuration["Google:FrontendRedirectUrl"] ?? "http://localhost:5174/").TrimEnd('/');
            var taskUrl = $"{portalUrl}/tasks?highlight={taskId}";
            var bodyHtml = $"""
                <p style="margin:0 0 16px;font-size:14px;color:#26334d;">Hello <strong>{System.Net.WebUtility.HtmlEncode(recipient.FullName)}</strong>,</p>
                <p style="margin:0 0 8px;font-size:14px;color:#26334d;">{System.Net.WebUtility.HtmlEncode(title)}</p>
                <p style="margin:0 0 8px;font-size:13px;color:#718198;">Task: <strong>{System.Net.WebUtility.HtmlEncode(task.Title)}</strong></p>
                {(task.DueDate.HasValue ? $"""<p style="margin:0 0 8px;font-size:13px;color:#718198;">Due: <strong>{task.DueDate.Value:yyyy-MM-dd}</strong></p>""" : "")}
                {(string.IsNullOrWhiteSpace(body) ? "" : $"""<p style="margin:0 0 20px;font-size:14px;color:#52627a;">{System.Net.WebUtility.HtmlEncode(body)}</p>""")}
                <a href="{taskUrl}" style="display:inline-block;background:#002E5C;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;">
                  View Task
                </a>
                """;
            var html = EmailService.BuildBrandedHtml(title, "#002E5C", bodyHtml);
            await emailService.SendAsync(recipient.Email, $"DMS - Si-Ware Systems - {title}", html);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error sending task notification email for task {TaskId} to user {UserId}", taskId, recipientUserId);
        }
    }

    private async Task SendDocumentEmailAsync(Guid recipientUserId, Guid documentId, string title, string? body)
    {
        try
        {
            var recipient = await context.Users.AsNoTracking()
                .Where(u => u.UserId == recipientUserId)
                .Select(u => new { u.Email, u.FullName })
                .FirstOrDefaultAsync();
            if (recipient == null || string.IsNullOrWhiteSpace(recipient.Email))
                return;

            var documentTitle = await context.Documents.AsNoTracking()
                .Where(d => d.DocumentId == documentId)
                .Select(d => d.Title)
                .FirstOrDefaultAsync();

            var portalUrl = (configuration["Google:FrontendRedirectUrl"] ?? "http://localhost:5174/").TrimEnd('/');
            var documentUrl = $"{portalUrl}/documents?preview={documentId}";

            var bodyHtml = $"""
                <p style="margin:0 0 16px;font-size:14px;color:#26334d;">Hello <strong>{System.Net.WebUtility.HtmlEncode(recipient.FullName)}</strong>,</p>
                <p style="margin:0 0 8px;font-size:14px;color:#26334d;">{System.Net.WebUtility.HtmlEncode(title)}</p>
                {(string.IsNullOrWhiteSpace(body) ? "" : $"""<p style="margin:0 0 20px;font-size:14px;color:#52627a;">{System.Net.WebUtility.HtmlEncode(body)}</p>""")}
                {(string.IsNullOrWhiteSpace(documentTitle) ? "" : $"""<p style="margin:0 0 20px;font-size:13px;color:#718198;">Document: <strong>{System.Net.WebUtility.HtmlEncode(documentTitle)}</strong></p>""")}
                <a href="{documentUrl}" style="display:inline-block;background:#002E5C;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;">
                  View Document
                </a>
                """;
            var html = EmailService.BuildBrandedHtml(title, "#002E5C", bodyHtml);
            await emailService.SendAsync(recipient.Email, $"DMS - Si-Ware Systems - {title}", html);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error sending document notification email for document {DocumentId} to user {UserId}", documentId, recipientUserId);
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

    // Looks up whoever actually submitted the document's *current* version
    // and notifies them too — this can be a different person from the
    // document's owner (e.g. someone submitting on another owner's behalf),
    // so an owner-only notification wouldn't otherwise ever reach them.
    // Skipped if there's no recorded submitter, or they're the same person
    // as the owner (already notified via NotifyDocumentOwnerAsync — this
    // avoids sending that one person two identical notifications/emails for
    // the same event).
    public async Task NotifyDocumentSubmitterAsync(Guid documentId, Guid actorUserId, string title, string? body = null)
    {
        try
        {
            var document = await context.Documents.AsNoTracking()
                .Where(d => d.DocumentId == documentId)
                .Select(d => new { d.OwnerId, d.CurrentVersionId })
                .FirstOrDefaultAsync();
            if (document?.CurrentVersionId == null)
                return;

            var submitterId = await context.DocumentVersions.AsNoTracking()
                .Where(v => v.VersionId == document.CurrentVersionId)
                .Select(v => v.SubmittedById)
                .FirstOrDefaultAsync();

            if (submitterId.HasValue && submitterId.Value != document.OwnerId)
                await NotifyAsync(submitterId.Value, actorUserId, title, body, documentId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error notifying submitter of document {DocumentId}", documentId);
        }
    }

    // Every stage-advancing action (QA accept, Manager approve, Manager
    // self-correct) — and now a task submitted/resubmitted against a
    // document — notifies every active user whose page-access role can view
    // the target stage (same flag the queue endpoints themselves gate on),
    // not just the document's original submitter. Shared between
    // ApprovalsController (stage transitions) and TaskService/TasksController
    // (PCAR submit / correction resubmit), so both paths use one definition.
    // Real per-document access (folder- and file-level overrides included)
    // is enforced centrally inside NotifyAsync, so a role-qualifying reviewer
    // with no actual access to this specific document is still silently
    // skipped without this method needing to check it itself.
    public async Task NotifyStageReviewersAsync(Guid actorUserId, Guid documentId, string title, string? body, Func<DmsPageAccessRole, bool> stageFlagSelector, bool folderManagersOnly = false)
    {
        var roles = await context.PageAccessRoles.AsNoTracking().ToListAsync();
        var reviewerRoleNames = roles.Where(stageFlagSelector).Select(r => r.Role).ToList();
        if (reviewerRoleNames.Count == 0)
            return;

        var reviewerIds = await context.Users.AsNoTracking()
            .Where(u => u.IsActive && u.Role != null && reviewerRoleNames.Contains(u.Role!))
            .Select(u => u.UserId)
            .ToListAsync();

        if (folderManagersOnly)
        {
            var folder = await context.Documents.AsNoTracking()
                .Where(d => d.DocumentId == documentId)
                .Join(context.Folders.AsNoTracking(), d => d.FolderId, f => f.FolderId, (_, f) => new { f.FolderId, f.OwnerId })
                .FirstOrDefaultAsync();
            if (folder == null) return;
            var assignedIds = await context.FolderManagers.AsNoTracking()
                .Where(m => m.FolderId == folder.FolderId)
                .Select(m => m.UserId)
                .ToListAsync();
            assignedIds.Add(folder.OwnerId);
            reviewerIds = reviewerIds.Where(assignedIds.Contains).ToList();
        }

        foreach (var reviewerId in reviewerIds)
            await NotifyAsync(reviewerId, actorUserId, title, body, documentId: documentId);
    }
}
