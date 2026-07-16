using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class ReminderService(DmsContext context, AuditService auditService, ILogger<ReminderService> logger)
{
    public async Task<ReminderResult> CreateReminderAsync(Guid taskId, Guid recipientId, string reminderType, DateTime dueDate)
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

            logger.LogInformation("Created reminder {ReminderId} for task {TaskId}", reminder.ReminderId, taskId);

            return ReminderResult.Success(new
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
            return ReminderResult.Error(ex.Message);
        }
    }

    public async Task<List<object>> GetPendingRemindersAsync(int limit = 100)
    {
        try
        {
            var today = DateTime.Now.Date;

            var pending = await context.Reminders
                .Where(r => !r.IsSent && r.DueDate <= today)
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

            var reminders = await context.Reminders
                .Where(r => reminderIds.Contains(r.ReminderId))
                .ToListAsync();

            foreach (var reminder in reminders)
            {
                reminder.IsSent = true;
                reminder.SentAt = DateTime.UtcNow;
                context.Reminders.Update(reminder);

                // Log that reminder was sent
                if (reminder.Recipient != null)
                {
                    await auditService.LogAsync(reminder.RecipientId, AuditActions.REMINDER_SENT, new
                    {
                        reminder.ReminderId,
                        reminder.TaskId,
                        reminder.ReminderType,
                        reminder.DueDate,
                        reminder.SentAt,
                        RecipientEmail = reminder.Recipient.Email
                    });
                }
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
}

public class ReminderResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static ReminderResult Success(object data) => new() { Success = true, Data = data };
    public static ReminderResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static ReminderResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static ReminderResult Error(string message) => new() { Success = false, Message = message, Error = "InternalError" };
}
