using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// The task/PCAR notification schedule is admin-managed rather than compiled
// into TaskEscalationService. The defaults exactly preserve the agreed policy:
// creation; 3 and 1 days before; due date; then overdue, all without repeats.
public sealed record TaskReminderRecipients(
    bool Assignee = true,
    bool FolderOwner = false,
    bool DirectManager = false,
    bool Quality = false,
    bool FullAccess = false);

public sealed record TaskReminderStage(
    bool Enabled = true,
    int DaysBeforeDue = 0,
    TaskReminderRecipients? Recipients = null)
{
    public TaskReminderRecipients EffectiveRecipients => Recipients ?? new TaskReminderRecipients();
}

public sealed record TaskNotificationPolicy(
    bool Enabled,
    TaskReminderStage Creation,
    TaskReminderStage FirstBeforeDue,
    TaskReminderStage SecondBeforeDue,
    TaskReminderStage DueDate,
    TaskReminderStage Overdue)
{
    public const string SettingKey = "task_notification_policy";

    public static TaskNotificationPolicy Default => new(
        true,
        new TaskReminderStage(true, 0, new TaskReminderRecipients(Assignee: true)),
        new TaskReminderStage(true, 3, new TaskReminderRecipients(Assignee: true)),
        new TaskReminderStage(true, 1, new TaskReminderRecipients(Assignee: true, FolderOwner: true, DirectManager: true)),
        new TaskReminderStage(true, 0, new TaskReminderRecipients(Assignee: true, FolderOwner: true, DirectManager: true, Quality: true, FullAccess: true)),
        new TaskReminderStage(true, 0, new TaskReminderRecipients(Assignee: true, FolderOwner: true, DirectManager: true, Quality: true, FullAccess: true)));
}

public class TaskNotificationPolicyService(DmsContext context)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public async Task<TaskNotificationPolicy> LoadAsync()
    {
        var raw = await context.AppSettings.AsNoTracking()
            .Where(setting => setting.Key == TaskNotificationPolicy.SettingKey)
            .Select(setting => setting.Value)
            .FirstOrDefaultAsync();
        if (string.IsNullOrWhiteSpace(raw)) return TaskNotificationPolicy.Default;
        try { return JsonSerializer.Deserialize<TaskNotificationPolicy>(raw, JsonOptions) ?? TaskNotificationPolicy.Default; }
        catch (JsonException) { return TaskNotificationPolicy.Default; }
    }

    public static string? Validate(TaskNotificationPolicy policy)
    {
        var leadStages = new[] { policy.FirstBeforeDue, policy.SecondBeforeDue };
        if (leadStages.Any(stage => stage.DaysBeforeDue is < 1 or > 365))
            return "Reminder lead days must be between 1 and 365";
        if (policy.FirstBeforeDue.Enabled && policy.SecondBeforeDue.Enabled
            && policy.FirstBeforeDue.DaysBeforeDue == policy.SecondBeforeDue.DaysBeforeDue)
            return "The two before-due reminders must use different lead days";
        var allStages = new[] { policy.Creation, policy.FirstBeforeDue, policy.SecondBeforeDue, policy.DueDate, policy.Overdue };
        if (allStages.Any(stage => stage.Enabled && !HasRecipient(stage.EffectiveRecipients)))
            return "Every enabled reminder stage needs at least one recipient";
        return null;
    }

    private static bool HasRecipient(TaskReminderRecipients recipients) =>
        recipients.Assignee || recipients.FolderOwner || recipients.DirectManager || recipients.Quality || recipients.FullAccess;

    public async Task<HashSet<Guid>> GetRecipientIdsAsync(DmsTask task, TaskReminderStage stage)
    {
        var recipients = stage.EffectiveRecipients;
        var recipientIds = new HashSet<Guid>();
        if (recipients.Assignee)
        {
            if (task.AssignedToId.HasValue) recipientIds.Add(task.AssignedToId.Value);
            if (task.AssignedToGroupId.HasValue)
                foreach (var userId in await context.GroupMembers.AsNoTracking()
                    .Where(member => member.GroupId == task.AssignedToGroupId.Value)
                    .Select(member => member.UserId).ToListAsync())
                    recipientIds.Add(userId);
        }

        if (recipients.FolderOwner)
        {
            var folderIds = await GetLinkedFolderIdsAsync(task);
            foreach (var ownerId in await context.Folders.AsNoTracking()
                .Where(folder => folderIds.Contains(folder.FolderId))
                .Select(folder => folder.OwnerId).ToListAsync())
                recipientIds.Add(ownerId);
        }

        // A direct manager is meaningful only when there is no document or
        // folder scope from which a folder owner can be resolved.
        if (recipients.DirectManager && task.DirectManagerId.HasValue
            && !(await GetLinkedFolderIdsAsync(task)).Any())
            recipientIds.Add(task.DirectManagerId.Value);

        if (recipients.Quality)
            foreach (var userId in await context.Users.AsNoTracking()
                .Where(user => user.IsActive && user.Role == "Quality")
                .Select(user => user.UserId).ToListAsync())
                recipientIds.Add(userId);
        if (recipients.FullAccess)
            foreach (var userId in await context.Users.AsNoTracking()
                .Where(user => user.IsActive && user.Role == "Full Access")
                .Select(user => user.UserId).ToListAsync())
                recipientIds.Add(userId);
        // A disabled account must neither receive a notification nor appear in
        // the creation preview as a recipient. This also handles inactive
        // members of a selected assignment group.
        return (await context.Users.AsNoTracking()
            .Where(user => user.IsActive && recipientIds.Contains(user.UserId))
            .Select(user => user.UserId)
            .ToListAsync()).ToHashSet();
    }

    private async Task<List<Guid>> GetLinkedFolderIdsAsync(DmsTask task)
    {
        var folderIds = await context.TaskFolderLinks.AsNoTracking().Where(link => link.TaskId == task.TaskId)
            .Select(link => link.FolderId).ToListAsync();
        if (task.FolderId.HasValue) folderIds.Add(task.FolderId.Value);
        var documentIds = await context.TaskDocumentLinks.AsNoTracking().Where(link => link.TaskId == task.TaskId)
            .Select(link => link.DocumentId).ToListAsync();
        if (task.DocumentId.HasValue) documentIds.Add(task.DocumentId.Value);
        if (documentIds.Count > 0)
            folderIds.AddRange(await context.Documents.AsNoTracking().Where(document => documentIds.Contains(document.DocumentId))
                .Select(document => document.FolderId).ToListAsync());
        return folderIds.Distinct().ToList();
    }
}
