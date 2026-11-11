using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class TaskEscalationService(DmsContext context, NotificationService notifications, ILogger<TaskEscalationService> logger)
{
    public async Task ScanAndSendAsync()
    {
        var now = DateTime.UtcNow;
        var tasks = await context.Tasks.Where(t => t.Status != "completed" && t.DueDate != null).ToListAsync();
        foreach (var task in tasks)
        {
            var due = task.DueDate!.Value;
            var stage = now.Date > due.Date ? "overdue" : now.Date == due.Date ? "due" : due <= now.AddDays(1) ? "day_1" : due <= now.AddDays(3) ? "day_3" : null;
            if (stage == null || await context.Set<DmsTaskEscalation>().AnyAsync(e => e.TaskId == task.TaskId && e.Stage == stage)) continue;

            var recipients = new HashSet<Guid>();
            if (task.AssignedToId.HasValue) recipients.Add(task.AssignedToId.Value);
            if (task.AssignedToGroupId.HasValue)
                foreach (var id in await context.GroupMembers.Where(m => m.GroupId == task.AssignedToGroupId).Select(m => m.UserId).ToListAsync()) recipients.Add(id);
            // Escalate to the owner of the linked folder, not the person who
            // happened to assign the work. A file task inherits its folder;
            // a folder task uses its direct folder link. General tasks have no
            // folder owner to add.
            var folderId = task.FolderId ?? (task.DocumentId.HasValue
                ? await context.Documents.Where(d => d.DocumentId == task.DocumentId.Value).Select(d => (Guid?)d.FolderId).FirstOrDefaultAsync()
                : null);
            if ((stage is "day_1" or "due" or "overdue") && folderId.HasValue)
            {
                var folderOwnerId = await context.Folders.Where(f => f.FolderId == folderId.Value).Select(f => (Guid?)f.OwnerId).FirstOrDefaultAsync();
                if (folderOwnerId.HasValue) recipients.Add(folderOwnerId.Value);
            }
            if (stage is "due" or "overdue")
                foreach (var id in await context.Users.Where(u => u.IsActive && (u.Role == "Quality" || u.Role == "Full Access")).Select(u => u.UserId).ToListAsync()) recipients.Add(id);

            var label = stage switch { "day_3" => "Due in 3 days", "day_1" => "Due tomorrow", "due" => "Due today", _ => "Overdue" };
            foreach (var recipient in recipients)
                await notifications.NotifyAsync(recipient, Guid.Empty, $"{label}: {task.Title}", $"Task due {due:dd MMM yyyy}", taskId: task.TaskId);

            context.Set<DmsTaskEscalation>().Add(new DmsTaskEscalation { TaskId = task.TaskId, Stage = stage, SentAt = now });
            await context.SaveChangesAsync();
        }
        logger.LogInformation("Task escalation scan completed");
    }
}
