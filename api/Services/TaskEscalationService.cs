using DMS.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class TaskEscalationService(DmsContext context, NotificationService notifications, TaskNotificationPolicyService policyService, ILogger<TaskEscalationService> logger)
{
    public async Task ScanAndSendAsync()
    {
        var policy = await policyService.LoadAsync();
        if (!policy.Enabled)
        {
            logger.LogInformation("Task escalation scan skipped because the policy is disabled");
            return;
        }
        var now = DateTime.UtcNow;
        var general = await PlatformSettingsService.LoadGeneralAsync(context);
        var today = now.Date;
        if (!string.IsNullOrWhiteSpace(general.Timezone) &&
            TimeZoneInfo.TryFindSystemTimeZoneById(general.Timezone, out var timeZone))
            today = TimeZoneInfo.ConvertTimeFromUtc(now, timeZone).Date;
        else
            logger.LogWarning("Task reminder timezone {TimeZone} was not found. Using UTC", general.Timezone);

        // A released document and its action task are separate records, but a
        // completed task must never enter this scan.  "done" is retained here
        // for older/imported task rows that predate the canonical
        // "completed" value.
        var tasks = await context.Tasks.AsNoTracking()
            .Where(t => t.Status.ToLower() != "completed" && t.Status.ToLower() != "done" && t.DueDate != null)
            .ToListAsync();
        foreach (var task in tasks)
        {
            var due = task.DueDate!.Value;
            var (stage, stagePolicy, label) = ResolveStage(today, due, policy);
            if (stage == null || stagePolicy == null) continue;

            if (await context.TaskEscalations.AnyAsync(e => e.TaskId == task.TaskId && e.Stage == stage)) continue;
            var recipients = await policyService.GetRecipientIdsAsync(task, stagePolicy);

            // Claim the stage *before* sending.  The prior check-then-send
            // sequence sent the email first and only then inserted the
            // (task, stage) record.  When that insert failed (or two workers
            // overlapped), the next run considered the same event unsent and
            // mailed it again.  PostgreSQL's primary key makes this insert an
            // atomic, cross-process once-only claim.
            var claimed = await context.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO dms_task_escalations (task_id, stage, sent_at)
                SELECT task_id, {stage}, {now}
                FROM dms_tasks
                WHERE task_id = {task.TaskId} AND due_date = {DateOnly.FromDateTime(due)}
                    AND lower(status) NOT IN ('completed', 'done')
                ON CONFLICT (task_id, stage) DO NOTHING
                """);
            if (claimed == 0) continue;

            foreach (var recipient in recipients)
                await notifications.NotifyAsync(recipient, Guid.Empty, $"{label}: {task.Title}", $"Task due {due:dd MMM yyyy}", taskId: task.TaskId,
                    deliveryAudit: new EmailDeliveryAudit(Guid.Empty, "task_due_reminder", recipient, task.TaskId, stage));
        }
        logger.LogInformation("Task escalation scan completed");
    }

    internal static (string? Stage, TaskReminderStage? Policy, string? Label) ResolveStage(DateTime today, DateTime due, TaskNotificationPolicy policy)
    {
        var daysUntilDue = (due.Date - today.Date).Days;
        if (daysUntilDue < 0 && policy.Overdue.Enabled) return ("overdue", policy.Overdue, "Overdue");
        if (daysUntilDue == 0 && policy.DueDate.Enabled) return ("due", policy.DueDate, "Due today");
        var beforeDue = new[] { policy.FirstBeforeDue, policy.SecondBeforeDue }
            .FirstOrDefault(stage => stage.Enabled && daysUntilDue > 0 && stage.DaysBeforeDue == daysUntilDue);
        return beforeDue == null
            ? (null, null, null)
            : ($"before_due_{beforeDue.DaysBeforeDue}", beforeDue, $"Due in {beforeDue.DaysBeforeDue} day{(beforeDue.DaysBeforeDue == 1 ? string.Empty : "s")}");
    }
}
