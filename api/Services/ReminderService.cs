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

    private static readonly string[] Recurrences = ["once", "weekly", "monthly", "quarterly", "semiannual", "yearly"];

    private static bool IsCompleted(DmsTask? task)
    {
        var status = task?.Status;
        return string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(status, "done", StringComparison.OrdinalIgnoreCase);
    }

    private static DateTime NextDueDate(DateTime dueDate, string recurrence)
    {
        var next = recurrence switch
        {
            "weekly" => dueDate.AddDays(7),
            "monthly" => dueDate.AddMonths(1),
            "quarterly" => dueDate.AddMonths(3),
            "semiannual" => dueDate.AddMonths(6),
            "yearly" => dueDate.AddYears(1),
            _ => dueDate,
        };
        while (next <= DateTime.UtcNow) next = recurrence switch
        {
            "weekly" => next.AddDays(7), "monthly" => next.AddMonths(1),
            "quarterly" => next.AddMonths(3), "semiannual" => next.AddMonths(6), "yearly" => next.AddYears(1), _ => next,
        };
        return next;
    }

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
    private async Task<(bool InAppSent, bool EmailSent)> SendReminderNotificationAsync(DmsReminder reminder, Guid actorUserId)
    {
        if (reminder.Task == null || reminder.Recipient == null)
        {
            logger.LogWarning("Reminder {ReminderId} is missing its Task/Recipient — skipping notification", reminder.ReminderId);
            return (false, false);
        }

        var taskTitle = reminder.Task.Title;
        var taskLink = BuildTaskLink(reminder.TaskId);
        var dueDateText = reminder.DueDate.ToString("dddd, MMMM d 'at' h:mm tt 'UTC'");
        var audit = new EmailDeliveryAudit(actorUserId, "task_reminder", reminder.RecipientId, reminder.ReminderId, reminder.DueDate.ToString("O"));
        var inAppSent = false;
        var emailSent = false;

        try
        {
            if (reminder.ReminderType is "APP" or "BOTH")
            {
                inAppSent = await notificationService.NotifyAsync(
                    reminder.RecipientId,
                    actorUserId,
                    $"Reminder: {taskTitle}",
                    $"Due {dueDateText}",
                    taskId: reminder.TaskId,
                    includeActor: true,
                    sendEmail: false,
                    deliveryAudit: audit);
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
                emailSent = await emailService.SendAsync(reminder.Recipient.Email, $"Reminder: {taskTitle}", html, audit);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to send reminder notification for {ReminderId}", reminder.ReminderId);
        }
        return (inAppSent, emailSent);
    }

    private async Task<bool> TrySendOccurrenceAsync(DmsReminder reminder, Guid actorUserId, string trigger)
    {
        var dueDate = reminder.DueDate;
        var sentAt = DateTime.UtcNow;
        var isSent = reminder.Recurrence == "once";
        var nextDueDate = isSent ? dueDate : NextDueDate(dueDate, reminder.Recurrence);

        // Claim this occurrence before dispatch. The sweep, immediate create,
        // and manual send all use the same update against the original date.
        var updated = await context.Reminders
            .Where(r => r.ReminderId == reminder.ReminderId && !r.IsSent && r.DueDate == dueDate &&
                context.Tasks.Any(t => t.TaskId == r.TaskId && t.Status.ToLower() != "completed" && t.Status.ToLower() != "done"))
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(r => r.IsSent, isSent)
                .SetProperty(r => r.SentAt, sentAt)
                .SetProperty(r => r.DueDate, nextDueDate));
        if (updated == 0) return false;

        var (inAppSent, emailSent) = await SendReminderNotificationAsync(reminder, actorUserId);
        var delivered = inAppSent || emailSent;
        await auditService.LogAsync(actorUserId, delivered ? AuditActions.REMINDER_SENT : AuditActions.REMINDER_NOT_DELIVERED, new
        {
            reminder.ReminderId,
            reminder.TaskId,
            reminder.ReminderType,
            reminder.RecipientId,
            DueDate = dueDate,
            AttemptedAt = sentAt,
            SentAt = delivered ? (DateTime?)sentAt : null,
            InAppSent = inAppSent,
            EmailSent = emailSent,
            RecipientEmail = reminder.Recipient?.Email,
            Trigger = trigger,
        });

        reminder.DueDate = nextDueDate;
        reminder.IsSent = isSent;
        reminder.SentAt = sentAt;
        return true;
    }

    public async Task<ReminderResult> CreateReminderAsync(Guid taskId, Guid recipientId, string reminderType, DateTime dueDate, string recurrence = "once", Guid? actorUserId = null)
    {
        try
        {
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == taskId);
            if (task == null)
                return ReminderResult.NotFound("Task not found");
            if (IsCompleted(task))
                return ReminderResult.Invalid("A completed task cannot receive a reminder");

            var recipient = await context.Users.FirstOrDefaultAsync(u => u.UserId == recipientId && u.IsActive);
            if (recipient == null)
                return ReminderResult.NotFound("Recipient not found or inactive");

            if (!new[] { "APP", "EMAIL", "BOTH" }.Contains(reminderType.ToUpper()))
                return ReminderResult.Invalid("Reminder type must be APP, EMAIL, or BOTH");
            recurrence = recurrence.Trim().ToLowerInvariant();
            if (!Recurrences.Contains(recurrence))
                return ReminderResult.Invalid("Recurrence must be once, weekly, monthly, quarterly, semiannual, or yearly");

            var reminder = new DmsReminder
            {
                ReminderId = Guid.NewGuid(),
                TaskId = taskId,
                RecipientId = recipientId,
                ReminderType = reminderType.ToUpper(),
                Recurrence = recurrence,
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

            // Real gap found live: a reminder whose due date/time is already now
            // or in the past (the common case when someone wants to be notified
            // right away rather than scheduling something for later) previously
            // just sat unsent until the next 5-minute automatic sweep — or
            // forever, if nobody happened to click the separate manual "Send"
            // button on it. Send it immediately in that case instead of leaving
            // "create a reminder" and "actually notify someone" as two separate
            // steps the caller has to know about.
            if (dueDate <= DateTime.UtcNow)
            {
                // Read the persisted date and any update from a concurrent sweep.
                reminder = await context.Reminders.AsNoTracking()
                    .Include(r => r.Task)
                    .Include(r => r.Recipient)
                    .FirstOrDefaultAsync(r => r.ReminderId == reminder.ReminderId) ?? reminder;
                if (!reminder.IsSent && reminder.DueDate <= DateTime.UtcNow &&
                    !await TrySendOccurrenceAsync(reminder, actorUserId ?? recipientId, "create"))
                {
                    // A sweep may have claimed it after the reload.
                    reminder = await context.Reminders.AsNoTracking()
                        .FirstOrDefaultAsync(r => r.ReminderId == reminder.ReminderId) ?? reminder;
                }
            }

            return ReminderResult.Ok(new
            {
                reminder.ReminderId,
                reminder.TaskId,
                reminder.RecipientId,
                reminder.ReminderType,
                reminder.DueDate,
                reminder.CreatedAt,
                reminder.IsSent,
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
                // Existing reminders are retained as history, but they are not
                // deliverable after the linked task has been completed.
                .Where(r => !r.IsSent && r.DueDate <= now && r.Task != null &&
                    r.Task.Status != "completed" && r.Task.Status != "done")
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
            var now = DateTime.UtcNow;
            var reminders = await context.Reminders.AsNoTracking()
                .Include(r => r.Recipient)
                .Include(r => r.Task)
                .Where(r => !r.IsSent && r.DueDate <= now && r.Task != null &&
                    r.Task.Status.ToLower() != "completed" && r.Task.Status.ToLower() != "done")
                .OrderBy(r => r.DueDate)
                .ToListAsync();

            var sent = 0;
            foreach (var reminder in reminders)
            {
                if (await TrySendOccurrenceAsync(reminder, SystemActorId, "scheduled"))
                    sent++;
            }

            logger.LogInformation("Processed {Count} pending reminders", sent);
            return sent;
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
                    Task = r.Task == null ? null : new { r.Task.TaskId, r.Task.Title, r.Task.Status, r.Task.Description },
                    r.RecipientId,
                    Recipient = r.Recipient == null ? null : new { r.Recipient.UserId, r.Recipient.FullName, r.Recipient.Email },
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
            var reminder = await context.Reminders.AsNoTracking()
                .Include(r => r.Recipient)
                .Include(r => r.Task)
                .FirstOrDefaultAsync(r => r.ReminderId == reminderId);

            if (reminder == null)
                return ReminderResult.NotFound("Reminder not found");

            if (reminder.IsSent)
                return ReminderResult.Invalid("Reminder has already been sent");
            if (IsCompleted(reminder.Task))
                return ReminderResult.Invalid("A completed task cannot receive a reminder");

            if (!await TrySendOccurrenceAsync(reminder, actorUserId, "manual"))
                return ReminderResult.Invalid("This reminder occurrence is no longer pending");

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
