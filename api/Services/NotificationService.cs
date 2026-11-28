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
    private async Task<bool> TryCreateInAppAsync(DmsNotification notification, EmailDeliveryAudit audit)
    {
        DmsAuditTrail? entry = null;
        try
        {
            var recipientName = await context.Users.AsNoTracking()
                .Where(user => user.UserId == notification.UserId)
                .Select(user => user.FullName)
                .FirstOrDefaultAsync();
            context.Notifications.Add(notification);
            entry = auditService.StageEntry(audit.ActorUserId, NOTIFICATION_SENT, new
            {
                RecipientId = notification.UserId,
                RecipientName = recipientName,
                notification.Title,
                notification.NotificationId,
                notification.DocumentId,
                notification.TaskId,
                notification.AnnouncementId,
                Channel = "in_app",
                Outcome = "persisted",
                audit.Source,
                audit.RelatedId,
                audit.Stage,
            });
            // Commit the bell notification and its success audit as one unit.
            await context.SaveChangesAsync();
            return true;
        }
        catch (Exception ex)
        {
            context.Entry(notification).State = EntityState.Detached;
            if (entry != null) context.Entry(entry).State = EntityState.Detached;
            logger.LogError(ex, "Error creating in-app notification for user {UserId}", notification.UserId);
            return false;
        }
    }

    // Audit-stage updates are deliberately a single controlled event: one
    // in-app notice plus one email (when the global email service is enabled
    // and configured). Ordinary edits never call this method.
    public async Task NotifyAuditStageAsync(Guid recipientUserId, Guid actorUserId, Guid auditRecordId, string title, string body, string cycleName, string stageName, string status)
    {
        // A person deliberately selected for an audit stage needs a durable
        // confirmation of that status even when they are also the person who
        // saved it. This exception applies only to audit-stage notices; normal
        // document/task notifications still suppress self-notification.
        var audit = new EmailDeliveryAudit(actorUserId, "audit_stage", recipientUserId, auditRecordId, status);
        await TryCreateInAppAsync(new DmsNotification
        {
            NotificationId = Guid.NewGuid(),
            UserId = recipientUserId,
            Title = title,
            Body = body,
            CreatedAt = DateTime.UtcNow,
        }, audit);

        try
        {
            var recipient = await context.Users.AsNoTracking()
                .Where(user => user.UserId == recipientUserId && user.IsActive)
                .Select(user => new { user.FullName, user.Email })
                .FirstOrDefaultAsync();
            if (recipient == null || string.IsNullOrWhiteSpace(recipient.Email)) return;

            var workspaceUrl = (configuration["Google:FrontendRedirectUrl"] ?? "http://localhost:5174/").TrimEnd('/') + "/iso-workspace";
            var bodyHtml = $"""
                <p style="margin:0 0 16px;font-size:14px;color:#26334d;">Hello <strong>{System.Net.WebUtility.HtmlEncode(recipient.FullName)}</strong>,</p>
                <p style="margin:0 0 12px;font-size:14px;color:#26334d;">{System.Net.WebUtility.HtmlEncode(title)}</p>
                <p style="margin:0 0 8px;font-size:13px;color:#52627a;">Cycle: <strong>{System.Net.WebUtility.HtmlEncode(cycleName)}</strong></p>
                <p style="margin:0 0 8px;font-size:13px;color:#52627a;">Stage: <strong>{System.Net.WebUtility.HtmlEncode(stageName)}</strong> · Status: <strong>{System.Net.WebUtility.HtmlEncode(status)}</strong></p>
                <p style="margin:0 0 20px;font-size:14px;color:#52627a;">{System.Net.WebUtility.HtmlEncode(body)}</p>
                <a href="{System.Net.WebUtility.HtmlEncode(workspaceUrl)}" style="display:inline-block;background:#002E5C;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;">Open ISO workspace</a>
                """;
            await emailService.SendAsync(recipient.Email, $"DMS - Si-Ware Systems - {title}", EmailService.BuildBrandedHtml(title, "#1763a5", bodyHtml), audit);
        }
        catch (Exception ex)
        {
            // Email delivery is supplementary. The in-app notice above is
            // already persisted and a mail problem must not block the stage.
            logger.LogError(ex, "Error sending audit stage email to user {UserId}", recipientUserId);
        }
    }

    public async Task<bool> NotifyAsync(
        Guid recipientUserId,
        Guid actorUserId,
        string title,
        string? body = null,
        Guid? documentId = null,
        Guid? taskId = null,
        Guid? announcementId = null,
        bool includeActor = false,
        bool sendEmail = true,
        EmailDeliveryAudit? deliveryAudit = null)
    {
        if (!await emailService.AreNotificationsEnabledAsync())
            return false;

        // Most activity should remain quiet for the person who performed it.
        // Task assignment is an exception: a self-assigned task is a useful
        // durable confirmation, and its email provides the direct task link.
        if (!includeActor && recipientUserId == actorUserId)
            return false;

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
                return false; // the document no longer exists
            if (!await accessOverrideService.HasDocumentReadAccessAsync(recipientUserId, documentId.Value, folderId.Value))
                return false;
        }

        var source = documentId.HasValue ? "document" : taskId.HasValue ? "task" : announcementId.HasValue ? "announcement" : "notification";
        var audit = deliveryAudit ?? new EmailDeliveryAudit(actorUserId, source, recipientUserId, documentId ?? taskId ?? announcementId);
        var inAppSent = await TryCreateInAppAsync(new DmsNotification
        {
            NotificationId = Guid.NewGuid(),
            UserId = recipientUserId,
            Title = title,
            Body = body,
            DocumentId = documentId,
            TaskId = taskId,
            AnnouncementId = announcementId,
            CreatedAt = DateTime.UtcNow,
        }, audit);

        // Per explicit request: every document-related in-app notification
        // (QA/Manager/Final Release stage transitions, correction requests,
        // rejections, releases — anything that reaches here with a
        // documentId) also goes out as a real email with a direct link back
        // to the document, the same way announcements/reminders already do.
        // Best-effort and never allowed to affect the caller — a missing/
        // unconfigured mailer just means this specific email is skipped
        // (EmailService.SendAsync's own no-op-on-unconfigured behavior),
        // exactly like every other outbound email in this app.
        if (!sendEmail)
            return inAppSent;

        if (documentId.HasValue)
            await SendDocumentEmailAsync(recipientUserId, documentId.Value, title, body, audit);
        else if (taskId.HasValue)
            await SendTaskEmailAsync(recipientUserId, taskId.Value, title, body, audit);
        return inAppSent;
    }

    private async Task SendTaskEmailAsync(Guid recipientUserId, Guid taskId, string title, string? body, EmailDeliveryAudit audit)
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
                .Select(t => new { t.Title, t.Description, t.DueDate, t.TaskType })
                .FirstOrDefaultAsync();
            if (task == null) return;

            var portalUrl = (configuration["Google:FrontendRedirectUrl"] ?? "http://localhost:5174/").TrimEnd('/');
            var taskUrl = $"{portalUrl}/{(task.TaskType == "pcar" ? "pcars" : "tasks")}?highlight={taskId}";
            var descriptionHtml = string.IsNullOrWhiteSpace(task.Description) ? "" : System.Net.WebUtility.HtmlEncode(task.Description)
                .Replace("\r\n", "<br />").Replace("\n", "<br />");
            // Older assignment events used the task title as their notification
            // body. Do not repeat it below the labelled Task field.
            var detailHtml = string.IsNullOrWhiteSpace(body)
                || string.Equals(body, task.Title, StringComparison.Ordinal)
                || string.Equals(body, task.Description, StringComparison.Ordinal)
                ? ""
                : $"""<p style=\"margin:0 0 20px;font-size:14px;color:#52627a;\">{System.Net.WebUtility.HtmlEncode(body)}</p>""";
            var bodyHtml = $"""
                <p style="margin:0 0 16px;font-size:14px;color:#26334d;">Hello <strong>{System.Net.WebUtility.HtmlEncode(recipient.FullName)}</strong>,</p>
                <p style="margin:0 0 8px;font-size:14px;color:#26334d;">{System.Net.WebUtility.HtmlEncode(title)}</p>
                <p style="margin:0 0 8px;font-size:13px;color:#718198;">Task: <strong>{System.Net.WebUtility.HtmlEncode(task.Title)}</strong></p>
                {(task.DueDate.HasValue ? $"""<p style="margin:0 0 8px;font-size:13px;color:#718198;">Due: <strong>{task.DueDate.Value:yyyy-MM-dd}</strong></p>""" : "")}
                {(string.IsNullOrWhiteSpace(descriptionHtml) ? "" : $"""<p style="margin:12px 0 20px;font-size:14px;line-height:1.5;color:#52627a;"><strong style="color:#26334d;">Description</strong><br />{descriptionHtml}</p>""")}
                {detailHtml}
                <a href="{taskUrl}" style="display:inline-block;background:#002E5C;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;">
                  View Task
                </a>
                """;
            var html = EmailService.BuildBrandedHtml(title, "#002E5C", bodyHtml);
            await emailService.SendAsync(recipient.Email, $"DMS - Si-Ware Systems - {title}", html, audit);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error sending task notification email for task {TaskId} to user {UserId}", taskId, recipientUserId);
        }
    }

    // PCAR verification is a distinct review queue. Every active user holding
    // the dedicated verification flag receives both the in-app notification
    // and the normal task email (when email is configured).
    public async Task NotifyPcarVerifiersAsync(Guid actorUserId, Guid taskId, string title, string? body = null)
    {
        var verifierRoles = await context.PageAccessRoles.AsNoTracking()
            .Where(role => role.CanVerifyPcars)
            .Select(role => role.Role)
            .ToListAsync();
        if (verifierRoles.Count == 0) return;

        var verifierIds = await context.Users.AsNoTracking()
            .Where(user => user.IsActive && user.Role != null && verifierRoles.Contains(user.Role))
            .Select(user => user.UserId)
            .ToListAsync();
        foreach (var verifierId in verifierIds)
            await NotifyAsync(verifierId, actorUserId, title, body, taskId: taskId);
    }

    public async Task NotifyTaskAssigneesAsync(Guid actorUserId, Guid taskId, string title, string? body = null)
    {
        var task = await context.Tasks.AsNoTracking().FirstOrDefaultAsync(item => item.TaskId == taskId);
        if (task == null) return;

        var recipients = new HashSet<Guid>();
        if (task.AssignedToId.HasValue)
            recipients.Add(task.AssignedToId.Value);
        else if (task.AssignedToGroupId.HasValue)
        {
            foreach (var memberId in await context.GroupMembers.AsNoTracking()
                .Where(member => member.GroupId == task.AssignedToGroupId.Value)
                .Select(member => member.UserId)
                .ToListAsync())
                recipients.Add(memberId);
        }

        foreach (var recipientId in recipients)
            await NotifyAsync(recipientId, actorUserId, title, body, taskId: taskId);
    }

    private async Task SendDocumentEmailAsync(Guid recipientUserId, Guid documentId, string title, string? body, EmailDeliveryAudit audit)
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
            await emailService.SendAsync(recipient.Email, $"DMS - Si-Ware Systems - {title}", html, audit);
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
