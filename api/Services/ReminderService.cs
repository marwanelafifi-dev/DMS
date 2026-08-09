using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace DMS.Api.Services;

public class ReminderService(DmsContext context, AuditService auditService, NotificationService notificationService, EmailService emailService, IConfiguration configuration, ILogger<ReminderService> logger)
{
    // "Send" previously only flipped is_sent/sent_at and wrote an audit entry —
    // it never actually notified anyone, in-app or by email, despite the
    // REMINDER_SENT audit action implying it had. Guid.Empty is the same
    // "system actor" sentinel GoogleMeetingReminderService already uses for
    // background-job-triggered notifications (NotifyAsync only skips sending
    // when recipient == actor, so a real user ID never collides with this).
    private static readonly Guid SystemActorId = Guid.Empty;

    private string BuildTaskLink(Guid taskId)
    {
        var frontendBaseUrl = (configuration["Google:FrontendRedirectUrl"] ?? "http://localhost:5174/").TrimEnd('/');
        return $"{frontendBaseUrl}/tasks?highlight={taskId}";
    }

    // Actually notifies the recipient — in-app (with TaskId set, so
    // NotificationsBell's existing click-to-navigate takes them straight to
    // the task, same as any other task-linked notification) and/or email per
    // reminder.ReminderType, instead of the previous no-op that only flipped
    // IsSent. Never throws — a missing task/recipient or an unconfigured
    // mailer degrades to a skipped send, not a failed one, since the
    // is_sent/audit bookkeeping around this call must still happen either way.
    private async Task SendReminderNotificationAsync(DmsReminder reminder)
    {
        if (reminder.Task == null || reminder.Recipient == null)
        {
            logger.LogWarning("Reminder {ReminderId} is missing its Task/Recipient — skipping notification", reminder.ReminderId);
            return;
        }

        var taskTitle = reminder.Task.Title;
        var taskLink = BuildTaskLink(reminder.TaskId);
        var dueDateText = reminder.DueDate.ToString("dddd, MMMM d 'at' h:mm tt 'UTC'");

        try
        {
            if (reminder.ReminderType is "APP" or "BOTH")
            {
                await notificationService.NotifyAsync(
                    reminder.RecipientId,
                    SystemActorId,
                    $"Reminder: {taskTitle}",
                    $"Due {dueDateText}",
                    taskId: reminder.TaskId);
            }

            if (reminder.ReminderType is "EMAIL" or "BOTH")
            {
                var bodyHtml = $"""
                    <p style="margin:0 0 16px;font-size:14px;color:#26334d;">This is a reminder for the following task, due <strong>{dueDateText}</strong>:</p>
                    <p style="margin:0 0 24px;font-size:16px;color:#122344;font-weight:600;">{System.Net.WebUtility.HtmlEncode(taskTitle)}</p>
                    <a href="{taskLink}" style="display:inline-block;background:#002E5C;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;">
                      View Task
                    </a>
                    """;
                var html = EmailService.BuildBrandedHtml("Task Reminder", "#002E5C", bodyHtml);
                await emailService.SendAsync(reminder.Recipient.Email, $"Reminder: {taskTitle}", html);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to send reminder notification for {ReminderId}", reminder.ReminderId);
        }
    }

    public async Task<ReminderResult> CreateReminderAsync(Guid taskId, Guid recipientId, string reminderType, DateTime dueDate, Guid? actorUserId = null)
    {
        try
        {
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == taskId);
            if (task == null)
                return ReminderResult.NotFound("Task not found");

            var recipient = await context.Users.FirstOrDefaultAsync(u => u.UserId == recipientId && u.IsActive);
            if (recipient == null)
                return ReminderResult.NotFound("Recipient not found or inactive");

            if (!new[] { "APP", "EMAIL", "BOTH" }.Contains(reminderType.ToUpper()))
                return ReminderResult.Invalid("Reminder type must be APP, EMAIL, or BOTH");

            var reminder = new DmsReminder
            {
                ReminderId = Guid.NewGuid(),
                TaskId = taskId,
                RecipientId = recipientId,
                ReminderType = reminderType.ToUpper(),
                DueDate = dueDate,
                IsSent = false,
                CreatedAt = DateTime.UtcNow
            };

            context.Reminders.Add(reminder);
            await context.SaveChangesAsync();

            await auditService.LogAsync(actorUserId ?? recipientId, AuditActions.REMINDER_CREATED, new
            {
                reminder.ReminderId,
                reminder.TaskId,
                TaskTitle = task.Title,
                reminder.RecipientId,
                RecipientEmail = recipient.Email,
                reminder.ReminderType,
                reminder.DueDate
            });

            logger.LogInformation("Created reminder {ReminderId} for task {TaskId}", reminder.ReminderId, taskId);

            return ReminderResult.Ok(new
            {
                reminder.ReminderId,
                reminder.TaskId,
                reminder.RecipientId,
                reminder.ReminderType,
                reminder.DueDate,
                reminder.CreatedAt
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating reminder");
            return ReminderResult.Fail(ex.Message);
        }
    }

    public async Task<List<object>> GetPendingRemindersAsync(int limit = 100)
    {
        try
        {
            // DueDate now carries a real time-of-day (see migration 011); comparing
            // against the start of today would delay same-day reminders by ~24h.
            var now = DateTime.UtcNow;

            var pending = await context.Reminders
                .Where(r => !r.IsSent && r.DueDate <= now)
                .OrderBy(r => r.DueDate)
                .Take(limit)
                .Select(r => new
                {
                    r.ReminderId,
                    r.TaskId,
                    Task = r.Task == null ? null : new { r.Task.TaskId, r.Task.Title, r.Task.Status },
                    r.RecipientId,
                    Recipient = r.Recipient == null ? null : new { r.Recipient.UserId, r.Recipient.FullName, r.Recipient.Email },
                    r.ReminderType,
                    r.DueDate,
                    r.IsSent,
                    r.SentAt,
                    r.CreatedAt
                })
                .ToListAsync();

            return pending.Cast<object>().ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting pending reminders");
            return new List<object>();
        }
    }

    public async Task<int> SendPendingRemindersAsync()
    {
        try
        {
            var pending = await GetPendingRemindersAsync(int.MaxValue);
            if (pending.Count == 0)
                return 0;

            var reminderIds = pending
                .Select(r => ((dynamic)r).ReminderId)
                .Cast<Guid>()
                .ToList();

            // Recipient/Task must be eagerly loaded — without them the navigations are
            // always null here, so neither a real notification/email nor the
            // REMINDER_SENT audit entry's detail could ever be built.
            var reminders = await context.Reminders
                .Include(r => r.Recipient)
                .Include(r => r.Task)
                .Where(r => reminderIds.Contains(r.ReminderId))
                .ToListAsync();

            foreach (var reminder in reminders)
            {
                reminder.IsSent = true;
                reminder.SentAt = DateTime.UtcNow;
                context.Reminders.Update(reminder);

                await SendReminderNotificationAsync(reminder);

                await auditService.LogAsync(reminder.RecipientId, AuditActions.REMINDER_SENT, new
                {
                    reminder.ReminderId,
                    reminder.TaskId,
                    reminder.ReminderType,
                    reminder.DueDate,
                    reminder.SentAt,
                    RecipientEmail = reminder.Recipient?.Email
                });
            }

            await context.SaveChangesAsync();

            logger.LogInformation("Sent {Count} pending reminders", reminders.Count);
            return reminders.Count;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error sending pending reminders");
            return 0;
        }
    }

    public async Task<List<object>> GetUserRemindersAsync(Guid userId)
    {
        try
        {
            var reminders = await context.Reminders
                .Where(r => r.RecipientId == userId)
                .OrderBy(r => r.DueDate)
                .Select(r => new
                {
                    r.ReminderId,
                    r.TaskId,
                    Task = r.Task == null ? null : new { r.Task.TaskId, r.Task.Title, r.Task.Status },
                    r.ReminderType,
                    r.DueDate,
                    r.IsSent,
                    r.SentAt,
                    r.CreatedAt
                })
                .ToListAsync();

            return reminders.Cast<object>().ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting reminders for user {UserId}", userId);
            return new List<object>();
        }
    }

    // Marks a single reminder as sent. Distinct from SendPendingRemindersAsync, which is the
    // Hangfire sweep over every due reminder — this backs the per-row "send now" action.
    public async Task<ReminderResult> MarkReminderSentAsync(Guid reminderId, Guid actorUserId)
    {
        try
        {
            var reminder = await context.Reminders
                .Include(r => r.Recipient)
                .Include(r => r.Task)
                .FirstOrDefaultAsync(r => r.ReminderId == reminderId);

            if (reminder == null)
                return ReminderResult.NotFound("Reminder not found");

            if (reminder.IsSent)
                return ReminderResult.Invalid("Reminder has already been sent");

            reminder.IsSent = true;
            reminder.SentAt = DateTime.UtcNow;

            await SendReminderNotificationAsync(reminder);

            await context.SaveChangesAsync();

            await auditService.LogAsync(actorUserId, AuditActions.REMINDER_SENT, new
            {
                reminder.ReminderId,
                reminder.TaskId,
                reminder.ReminderType,
                reminder.DueDate,
                reminder.SentAt,
                RecipientId = reminder.RecipientId,
                RecipientEmail = reminder.Recipient?.Email,
                Trigger = "manual"
            });

            logger.LogInformation("Marked reminder {ReminderId} as sent", reminderId);

            return ReminderResult.Ok(new
            {
                reminder.ReminderId,
                reminder.TaskId,
                reminder.ReminderType,
                reminder.DueDate,
                reminder.IsSent,
                reminder.SentAt
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error marking reminder {ReminderId} as sent", reminderId);
            return ReminderResult.Fail(ex.Message);
        }
    }

    public async Task<ReminderResult> DeleteReminderAsync(Guid reminderId, Guid actorUserId)
    {
        try
        {
            var reminder = await context.Reminders.FirstOrDefaultAsync(r => r.ReminderId == reminderId);
            if (reminder == null)
                return ReminderResult.NotFound("Reminder not found");

            // Captured before removal so the audit entry survives the delete.
            var snapshot = new
            {
                reminder.ReminderId,
                reminder.TaskId,
                reminder.RecipientId,
                reminder.ReminderType,
                reminder.DueDate,
                reminder.IsSent,
                reminder.SentAt
            };

            context.Reminders.Remove(reminder);
            await context.SaveChangesAsync();

            await auditService.LogAsync(actorUserId, AuditActions.REMINDER_DELETED, snapshot);

            logger.LogInformation("Deleted reminder {ReminderId}", reminderId);

            return ReminderResult.Ok(snapshot);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting reminder {ReminderId}", reminderId);
            return ReminderResult.Fail(ex.Message);
        }
    }
}

public class ReminderResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static ReminderResult Ok(object data) => new() { Success = true, Data = data };
    public static ReminderResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static ReminderResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static ReminderResult Fail(string message) => new() { Success = false, Message = message, Error = "InternalError" };
}
