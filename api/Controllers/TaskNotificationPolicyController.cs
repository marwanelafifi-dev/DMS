using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/task-notification-policy")]
public class TaskNotificationPolicyController(DmsContext context, TaskNotificationPolicyService policyService, AuditService auditService) : BaseController
{
    // Every task/PCAR creator can read the effective schedule so the creation
    // popup can confirm that automatic reminders are already handled.
    [HttpGet("summary")]
    public async Task<ActionResult<object>> GetPolicySummary() =>
        Ok(new { success = true, data = await policyService.LoadAsync() });

    // Calculates actual recipients from the currently selected assignee and
    // linked documents/folders before the task exists, so the creation popup
    // can make the automatic notification plan transparent to its creator.
    [HttpPost("preview")]
    public async Task<ActionResult<object>> PreviewRecipients([FromBody] TaskNotificationPreviewRequest req)
    {
        if (req.AssignedToId.HasValue == req.AssignedToGroupId.HasValue)
            return BadRequest(new { success = false, error = "Choose one assignee or group to preview recipients" });

        var folderIds = (req.FolderIds ?? []).Distinct().ToList();
        var documentIds = (req.DocumentIds ?? []).Distinct().ToList();
        if (documentIds.Count > 0)
            folderIds.AddRange(await context.Documents.AsNoTracking().Where(document => documentIds.Contains(document.DocumentId))
                .Select(document => document.FolderId).ToListAsync());
        folderIds = folderIds.Distinct().ToList();

        var policy = await policyService.LoadAsync();
        var stageDefinitions = new[]
        {
            ("creation", "When created", policy.Creation),
            ("firstBeforeDue", $"{policy.FirstBeforeDue.DaysBeforeDue} day(s) before due", policy.FirstBeforeDue),
            ("secondBeforeDue", $"{policy.SecondBeforeDue.DaysBeforeDue} day(s) before due", policy.SecondBeforeDue),
            ("dueDate", "On due date", policy.DueDate),
            ("overdue", "When overdue", policy.Overdue),
        };

        var allRecipientIds = new HashSet<Guid>();
        var stageRecipientIds = new List<HashSet<Guid>>();
        foreach (var (_, _, stage) in stageDefinitions)
        {
            var recipients = new HashSet<Guid>();
            if (stage.Enabled)
            {
                var settings = stage.EffectiveRecipients;
                if (settings.Assignee)
                {
                    if (req.AssignedToId.HasValue) recipients.Add(req.AssignedToId.Value);
                    if (req.AssignedToGroupId.HasValue)
                        foreach (var userId in await context.GroupMembers.AsNoTracking().Where(member => member.GroupId == req.AssignedToGroupId.Value).Select(member => member.UserId).ToListAsync()) recipients.Add(userId);
                }
                if (settings.FolderOwner)
                    foreach (var userId in await context.Folders.AsNoTracking().Where(folder => folderIds.Contains(folder.FolderId)).Select(folder => folder.OwnerId).ToListAsync()) recipients.Add(userId);
                if (settings.Quality)
                    foreach (var userId in await context.Users.AsNoTracking().Where(user => user.IsActive && user.Role == "Quality").Select(user => user.UserId).ToListAsync()) recipients.Add(userId);
                if (settings.FullAccess)
                    foreach (var userId in await context.Users.AsNoTracking().Where(user => user.IsActive && user.Role == "Full Access").Select(user => user.UserId).ToListAsync()) recipients.Add(userId);
            }
            allRecipientIds.UnionWith(recipients);
            stageRecipientIds.Add(recipients);
        }
        var activeRecipientIds = (await context.Users.AsNoTracking()
            .Where(user => user.IsActive && allRecipientIds.Contains(user.UserId))
            .Select(user => user.UserId)
            .ToListAsync()).ToHashSet();
        var names = await context.Users.AsNoTracking().Where(user => activeRecipientIds.Contains(user.UserId))
            .ToDictionaryAsync(user => user.UserId, user => user.FullName);
        var stages = stageDefinitions.Select((definition, index) => new
        {
            Key = definition.Item1,
            Label = definition.Item2,
            Enabled = definition.Item3.Enabled && policy.Enabled,
            Recipients = stageRecipientIds[index].Where(id => activeRecipientIds.Contains(id))
                .Select(id => names.GetValueOrDefault(id, "Unknown user")).OrderBy(name => name).ToList(),
        }).ToList();
        return Ok(new { success = true, data = new { enabled = policy.Enabled, stages } });
    }

    [HttpGet]
    public async Task<ActionResult<object>> GetPolicy()
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        if (role?.CanManageTaskReminderPolicy != true)
            return StatusCode(403, new { success = false, error = "You do not have permission to manage the Task/PCAR reminder policy" });
        return Ok(new { success = true, data = await policyService.LoadAsync() });
    }

    [HttpPut]
    public async Task<ActionResult<object>> UpdatePolicy([FromBody] TaskNotificationPolicy policy)
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        if (role?.CanManageTaskReminderPolicy != true)
            return StatusCode(403, new { success = false, error = "You do not have permission to manage the Task/PCAR reminder policy" });
        var validationError = TaskNotificationPolicyService.Validate(policy);
        if (validationError != null) return BadRequest(new { success = false, error = validationError });

        var setting = await context.AppSettings.FirstOrDefaultAsync(item => item.Key == TaskNotificationPolicy.SettingKey);
        if (setting == null)
        {
            setting = new DmsAppSetting { Key = TaskNotificationPolicy.SettingKey };
            context.AppSettings.Add(setting);
        }
        setting.Value = JsonSerializer.Serialize(policy);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = userId;
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, "TASK_NOTIFICATION_POLICY_UPDATED", policy);
        return Ok(new { success = true, data = policy });
    }
}

public record TaskNotificationPreviewRequest(Guid? AssignedToId, Guid? AssignedToGroupId, Guid[]? DocumentIds, Guid[]? FolderIds);
