using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class AnnouncementService(
    DmsContext context,
    NotificationService notificationService,
    EmailService emailService,
    AuditService auditService,
    ILogger<AnnouncementService> logger)
{
    // Matches the navy used in GoogleMeetingReminderService — one consistent
    // accent across every DMS notification email.
    private const string AccentColor = "#002E5C";

    public async Task<List<object>> GetAllAsync()
    {
        var announcements = await context.Announcements
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new
            {
                a.AnnouncementId,
                a.Title,
                a.Message,
                a.PostedById,
                PostedByName = a.PostedByUser == null ? null : a.PostedByUser.FullName,
                a.NotifiedEmail,
                a.NotifiedApp,
                a.RecipientCount,
                a.CreatedAt,
            })
            .ToListAsync();

        return announcements.Cast<object>().ToList();
    }

    // recipientUserIds null/empty means "every active user"; notifyEmail/App
    // control which channels actually fire — the announcement itself is
    // always visible to everyone on the Dashboard regardless of who was
    // actively notified.
    public async Task<AnnouncementResult> CreateAsync(
        string title, string message, Guid postedById, List<Guid>? recipientUserIds, bool notifyEmail, bool notifyApp)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(title))
                return AnnouncementResult.Invalid("Title is required");
            if (string.IsNullOrWhiteSpace(message))
                return AnnouncementResult.Invalid("Message is required");

            var recipients = recipientUserIds is { Count: > 0 }
                ? await context.Users.Where(u => u.IsActive && recipientUserIds.Contains(u.UserId)).ToListAsync()
                : await context.Users.Where(u => u.IsActive).ToListAsync();

            var announcement = new DmsAnnouncement
            {
                AnnouncementId = Guid.NewGuid(),
                Title = title.Trim(),
                Message = message.Trim(),
                PostedById = postedById,
                NotifiedEmail = notifyEmail,
                NotifiedApp = notifyApp,
                RecipientCount = recipients.Count,
                CreatedAt = DateTime.UtcNow,
            };

            context.Announcements.Add(announcement);
            await context.SaveChangesAsync();

            if (notifyApp)
            {
                foreach (var user in recipients)
                    await notificationService.NotifyAsync(user.UserId, postedById, announcement.Title, announcement.Message);
            }

            if (notifyEmail && await emailService.IsConfiguredAsync())
            {
                var bodyHtml = $"""<p style="margin:0;font-size:14px;color:#3c4043;white-space:pre-wrap;">{System.Net.WebUtility.HtmlEncode(announcement.Message)}</p>""";
                var html = EmailService.BuildBrandedHtml(announcement.Title, AccentColor, bodyHtml);
                foreach (var user in recipients)
                {
                    if (user.UserId != postedById && !string.IsNullOrWhiteSpace(user.Email))
                        await emailService.SendAsync(user.Email, announcement.Title, html);
                }
            }

            await auditService.LogAsync(postedById, AuditActions.ANNOUNCEMENT_CREATED, new
            {
                announcement.AnnouncementId,
                announcement.Title,
                RecipientCount = recipients.Count,
                notifyEmail,
                notifyApp,
            });

            logger.LogInformation("Posted announcement {AnnouncementId} to {RecipientCount} recipient(s) by {PostedById}",
                announcement.AnnouncementId, recipients.Count, postedById);

            return AnnouncementResult.Ok(new
            {
                announcement.AnnouncementId,
                announcement.Title,
                announcement.Message,
                announcement.PostedById,
                announcement.NotifiedEmail,
                announcement.NotifiedApp,
                announcement.RecipientCount,
                announcement.CreatedAt,
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating announcement");
            return AnnouncementResult.Fail(ex.Message);
        }
    }

    public async Task<AnnouncementResult> DeleteAsync(Guid announcementId, Guid actorUserId)
    {
        try
        {
            var announcement = await context.Announcements.FirstOrDefaultAsync(a => a.AnnouncementId == announcementId);
            if (announcement == null)
                return AnnouncementResult.NotFound("Announcement not found");

            context.Announcements.Remove(announcement);
            await context.SaveChangesAsync();

            await auditService.LogAsync(actorUserId, AuditActions.ANNOUNCEMENT_DELETED, new { announcement.AnnouncementId, announcement.Title });

            logger.LogInformation("Deleted announcement {AnnouncementId}", announcementId);
            return AnnouncementResult.Ok(new { announcement.AnnouncementId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting announcement {AnnouncementId}", announcementId);
            return AnnouncementResult.Fail(ex.Message);
        }
    }
}

public class AnnouncementResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static AnnouncementResult Ok(object data) => new() { Success = true, Data = data };
    public static AnnouncementResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static AnnouncementResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static AnnouncementResult Fail(string message) => new() { Success = false, Message = message, Error = "InternalError" };
}
