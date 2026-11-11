using DMS.Api.Data;
using DMS.Api.Models;
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
        var tasks = await context.Tasks.Where(t => t.Status != "completed" && t.DueDate != null).ToListAsync();
        foreach (var task in tasks)
        {
            var due = task.DueDate!.Value;
            var (stage, stagePolicy, label) = ResolveStage(now, due, policy);
            if (stage == null || stagePolicy == null || await context.Set<DmsTaskEscalation>().AnyAsync(e => e.TaskId == task.TaskId && e.Stage == stage)) continue;

            var recipients = await policyService.GetRecipientIdsAsync(task, stagePolicy);
            foreach (var recipient in recipients)
                await notifications.NotifyAsync(recipient, Guid.Empty, $"{label}: {task.Title}", $"Task due {due:dd MMM yyyy}", taskId: task.TaskId);

            context.Set<DmsTaskEscalation>().Add(new DmsTaskEscalation { TaskId = task.TaskId, Stage = stage, SentAt = now });
            await context.SaveChangesAsync();
        }
        logger.LogInformation("Task escalation scan completed");
    }

    private static (string? Stage, TaskReminderStage? Policy, string? Label) ResolveStage(DateTime now, DateTime due, TaskNotificationPolicy policy)
    {
        if (now.Date > due.Date && policy.Overdue.Enabled) return ("overdue", policy.Overdue, "Overdue");
        if (now.Date == due.Date && policy.DueDate.Enabled) return ("due", policy.DueDate, "Due today");
        var beforeDue = new[] { policy.FirstBeforeDue, policy.SecondBeforeDue }
            .Where(stage => stage.Enabled && due.Date > now.Date && due <= now.AddDays(stage.DaysBeforeDue))
            .OrderBy(stage => stage.DaysBeforeDue)
            .FirstOrDefault();
        return beforeDue == null
            ? (null, null, null)
            : ($"before_due_{beforeDue.DaysBeforeDue}", beforeDue, $"Due in {beforeDue.DaysBeforeDue} day{(beforeDue.DaysBeforeDue == 1 ? string.Empty : "s")}");
    }
}
