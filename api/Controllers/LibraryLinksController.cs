using System.Net;
using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/library-links")]
public class LibraryLinksController(
    DmsContext context,
    AccessOverrideService accessOverrideService,
    EmailService emailService,
    AuditService auditService,
    IConfiguration configuration,
    ILogger<LibraryLinksController> logger) : BaseController
{
    [HttpPost]
    public async Task<ActionResult<object>> CreateLink([FromBody] LibraryLinkRequest request)
    {
        var result = await ResolveLinkAsync(new LibraryLinkRequest(request.FolderId, request.DocumentId));
        if (result.Error != null) return StatusCode(result.StatusCode, new { success = false, error = result.Error });

        await auditService.LogAsync(GetCurrentUserId(), AuditActions.LIBRARY_LINK_COPIED, new { result.TargetType, result.TargetId });
        return Ok(new { success = true, data = new { result.Link, result.TargetType, result.TargetId, result.TargetName } });
    }

    [HttpPost("share")]
    public async Task<ActionResult<object>> ShareLink([FromBody] ShareLibraryLinkRequest request)
    {
        var result = await ResolveLinkAsync(new LibraryLinkRequest(request.FolderId, request.DocumentId));
        if (result.Error != null) return StatusCode(result.StatusCode, new { success = false, error = result.Error });

        var recipients = (request.Recipients ?? Array.Empty<string>())
            .Select(email => email.Trim().ToLowerInvariant())
            .Where(email => !string.IsNullOrWhiteSpace(email))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (recipients.Count is < 1 or > 20 || recipients.Any(email => !IsValidEmail(email)))
            return BadRequest(new { success = false, error = "Enter between 1 and 20 valid email addresses" });

        // A shared link is only a signpost, never a permission grant. Requiring
        // active DMS accounts avoids emailing an internal resource to unknown
        // addresses; the normal target permission is still checked on opening.
        var knownRecipients = await context.Users.AsNoTracking()
            .Where(user => user.IsActive && recipients.Contains(user.Email.ToLower()))
            .Select(user => new { user.UserId, Email = user.Email.ToLower() })
            .ToListAsync();
        var unknownRecipients = recipients.Except(knownRecipients.Select(user => user.Email), StringComparer.OrdinalIgnoreCase).ToList();
        if (unknownRecipients.Count > 0)
            return BadRequest(new { success = false, error = "Every recipient must be an active DMS user: " + string.Join(", ", unknownRecipients) });

        // Do this before composing any email so the item name itself is never
        // disclosed to someone who cannot already open the original. The link
        // remains permission-checked on every later open as well.
        Guid? documentFolderId = null;
        if (result.TargetType == "file")
            documentFolderId = await context.Documents.AsNoTracking()
                .Where(document => document.DocumentId == result.TargetId)
                .Select(document => (Guid?)document.FolderId)
                .FirstOrDefaultAsync();
        var inaccessibleRecipients = new List<string>();
        foreach (var recipient in knownRecipients)
        {
            var canOpen = result.TargetType == "folder"
                ? await accessOverrideService.HasFolderReadAccessAsync(recipient.UserId, result.TargetId)
                : documentFolderId.HasValue && await accessOverrideService.HasDocumentReadAccessAsync(recipient.UserId, result.TargetId, documentFolderId.Value);
            if (!canOpen) inaccessibleRecipients.Add(recipient.Email);
        }
        if (inaccessibleRecipients.Count > 0)
            return BadRequest(new { success = false, error = "Every recipient must already have access to this item: " + string.Join(", ", inaccessibleRecipients) });

        if (!await emailService.IsConfiguredAsync())
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, error = "Email notifications are not configured. Copy the protected link instead or ask an administrator to configure email." });

        var sender = GetCurrentUser();
        var subject = $"DMS: {result.TargetName}";
        var safeName = WebUtility.HtmlEncode(result.TargetName);
        var safeSender = WebUtility.HtmlEncode(sender.FullName);
        var safeLink = WebUtility.HtmlEncode(result.Link);
        var body = EmailService.BuildBrandedHtml("A DMS item was shared with you", "#2f6f9f", $$"""
            <p style="margin:0 0 14px;color:#34425b;font-size:14px;"><strong>{{safeSender}}</strong> shared <strong>{{safeName}}</strong> with you.</p>
            <p style="margin:0 0 18px;"><a href="{{safeLink}}" style="display:inline-block;background:#2f6f9f;color:#ffffff;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600;">Open in DMS</a></p>
            <p style="margin:0;color:#52627a;font-size:12px;line-height:18px;">Sign in with your DMS account. This link does not grant access; your existing file and folder permissions still apply.</p>
            """);

        var failedRecipients = new List<string>();
        foreach (var recipient in recipients)
            if (!await emailService.SendAsync(recipient, subject, body)) failedRecipients.Add(recipient);

        await auditService.LogAsync(sender.UserId, AuditActions.LIBRARY_LINK_SHARED, new
        {
            result.TargetType,
            result.TargetId,
            result.TargetName,
            Recipients = recipients,
            FailedRecipients = failedRecipients,
        });
        logger.LogInformation("DMS link to {TargetType} {TargetId} shared by {UserId} with {RecipientCount} recipient(s)", result.TargetType, result.TargetId, sender.UserId, recipients.Count);

        return Ok(new
        {
            success = failedRecipients.Count == 0,
            data = new { result.Link, sent = recipients.Count - failedRecipients.Count, failedRecipients },
            error = failedRecipients.Count == 0 ? null : "Some emails could not be sent. Check the notification configuration and try again.",
        });
    }

    private async Task<ResolvedLibraryLink> ResolveLinkAsync(LibraryLinkRequest request)
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        if (role?.CanShareDocumentLinks != true)
            return ResolvedLibraryLink.ForError(StatusCodes.Status403Forbidden, "Your role does not have permission to share protected DMS links");
        if (request.FolderId.HasValue == request.DocumentId.HasValue)
            return ResolvedLibraryLink.ForError(StatusCodes.Status400BadRequest, "Choose one file or folder to share");

        string targetType;
        Guid targetId;
        string targetName;
        string query;
        if (request.FolderId.HasValue)
        {
            var folder = await context.Folders.AsNoTracking().FirstOrDefaultAsync(item => item.FolderId == request.FolderId.Value);
            if (folder == null) return ResolvedLibraryLink.ForError(StatusCodes.Status404NotFound, "Folder not found");
            if (!await accessOverrideService.HasFolderReadAccessAsync(userId, folder.FolderId))
                return ResolvedLibraryLink.ForError(StatusCodes.Status403Forbidden, "You do not have access to this folder");
            targetType = "folder";
            targetId = folder.FolderId;
            targetName = folder.Name;
            query = "folder=" + folder.FolderId;
        }
        else
        {
            var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(item => item.DocumentId == request.DocumentId!.Value);
            if (document == null) return ResolvedLibraryLink.ForError(StatusCodes.Status404NotFound, "File not found");
            if (!await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId))
                return ResolvedLibraryLink.ForError(StatusCodes.Status403Forbidden, "You do not have access to this file");
            targetType = "file";
            targetId = document.DocumentId;
            targetName = document.Title;
            query = "preview=" + document.DocumentId;
        }

        var baseUrl = configuration["Google:FrontendRedirectUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl))
            return ResolvedLibraryLink.ForError(StatusCodes.Status503ServiceUnavailable, "The DMS public URL is not configured");
        return new ResolvedLibraryLink(StatusCodes.Status200OK, null, $"{baseUrl}/documents?{query}", targetType, targetId, targetName);
    }

    private static bool IsValidEmail(string email)
    {
        try
        {
            return new System.Net.Mail.MailAddress(email).Address.Equals(email, StringComparison.OrdinalIgnoreCase);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

public record LibraryLinkRequest(Guid? FolderId = null, Guid? DocumentId = null);
public record ShareLibraryLinkRequest(Guid? FolderId = null, Guid? DocumentId = null, string[]? Recipients = null);
public record ResolvedLibraryLink(int StatusCode, string? Error, string? Link, string? TargetType, Guid TargetId, string? TargetName)
{
    public static ResolvedLibraryLink ForError(int statusCode, string error) => new(statusCode, error, null, null, Guid.Empty, null);
}
