using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class TaskService(DmsContext context, AuditService auditService, NotificationService notificationService, AccessOverrideService accessOverrideService, ILogger<TaskService> logger)
{
    // A task assigned to a Group is one shared item visible to every member —
    // whoever gets to it first can act on it, not a fan-out of per-member
    // duplicates. This is the single place that answers "can this user act on
    // this task", used by both completion and resubmission.
    public async Task<bool> IsAssigneeAsync(DmsTask task, Guid userId)
    {
        if (task.AssignedToId == userId)
            return true;

        if (task.AssignedToGroupId.HasValue)
            return await context.GroupMembers.AnyAsync(gm => gm.GroupId == task.AssignedToGroupId.Value && gm.UserId == userId);

        return false;
    }

    public async Task<TaskResult> CreateTaskAsync(Guid managerId, Guid? documentId, Guid? folderId, Guid? assignedToId, Guid? assignedToGroupId, string title, string? description = null, string? taskType = null, string? riskSeverity = null, DateTime? dueDate = null, string[]? tags = null, string? auditStage = null, Guid[]? documentIds = null, Guid[]? folderIds = null, Guid? directManagerId = null)
    {
        try
        {
            if (assignedToId.HasValue == assignedToGroupId.HasValue)
                return TaskResult.Invalid("Exactly one of assignedToId or assignedToGroupId is required");

            if (documentId.HasValue && !await context.Documents.AnyAsync(d => d.DocumentId == documentId.Value))
                return TaskResult.NotFound("Document not found");
            if (folderId.HasValue && !await context.Folders.AnyAsync(f => f.FolderId == folderId.Value))
                return TaskResult.NotFound("Folder not found");

            var hasLinkedResources = documentId.HasValue || folderId.HasValue || (documentIds?.Length > 0) || (folderIds?.Length > 0);
            var normalizedTaskType = taskType?.Trim().ToLowerInvariant() ?? "task";
            if (directManagerId.HasValue)
            {
                if (hasLinkedResources)
                    return TaskResult.Invalid("A direct manager is available only for a task without linked files or folders");
                var directManagerExists = await context.Users.AnyAsync(user => user.UserId == directManagerId.Value && user.IsActive && user.Role == "Manager");
                if (!directManagerExists)
                    return TaskResult.Invalid("Direct manager must be an active Manager user");
            }

            string assigneeName;
            if (assignedToId.HasValue)
            {
                var assignee = await context.Users.FirstOrDefaultAsync(u => u.UserId == assignedToId.Value && u.IsActive);
                if (assignee == null)
                    return TaskResult.NotFound("Assignee not found or inactive");
                assigneeName = assignee.FullName;
            }
            else
            {
                var group = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == assignedToGroupId!.Value);
                if (group == null)
                    return TaskResult.NotFound("Group not found");
                assigneeName = group.Name;
            }

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                FolderId = folderId,
                Title = title.Trim(),
                Description = description?.Trim(),
                Tags = NormalizeTags(tags),
                // Normal work is independent from document approval. "pcar"
                // is reserved for the released-document audit finding endpoint.
                TaskType = normalizedTaskType,
                AuditStage = NormalizeAuditStage(auditStage),
                RiskSeverity = riskSeverity ?? "medium",
                AssignedToId = assignedToId,
                AssignedToGroupId = assignedToGroupId,
                DirectManagerId = directManagerId,
                ManagerId = managerId,
                DueDate = dueDate,
                Status = "open",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.Tasks.Add(task);
            foreach (var id in (documentIds ?? (documentId.HasValue ? [documentId.Value] : [])).Distinct()) context.TaskDocumentLinks.Add(new DmsTaskDocumentLink { TaskId = task.TaskId, DocumentId = id, LinkedAt = DateTime.UtcNow });
            foreach (var id in (folderIds ?? (folderId.HasValue ? [folderId.Value] : [])).Distinct()) context.TaskFolderLinks.Add(new DmsTaskFolderLink { TaskId = task.TaskId, FolderId = id, LinkedAt = DateTime.UtcNow });
            await context.SaveChangesAsync();
            // Migration 116 assigns the internal Task No. through a database
            // trigger so every creation path (including workflow corrections)
            // shares one atomic sequence. Reload it for the creation response.
            await context.Entry(task).ReloadAsync();

            logger.LogInformation("Created task {TaskId} for document {DocumentId}", task.TaskId, documentId);

            return TaskResult.Ok(new
            {
                task.TaskId,
                task.DocumentId,
                task.FolderId,
                task.Title,
                task.Tags,
                task.TaskNumber,
                task.AssignedToId,
                task.AssignedToGroupId,
                task.DirectManagerId,
                task.ManagerId,
                AssignedToName = assigneeName,
                task.DueDate,
                task.Status,
                task.CreatedAt
            }, task.TaskId);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating task");
            return TaskResult.Fail(ex.Message);
        }
    }

    // Every group-assignee notified individually — there's no single "group inbox".
    public async Task<List<Guid>> GetGroupMemberIdsAsync(Guid groupId) =>
        await context.GroupMembers.Where(gm => gm.GroupId == groupId).Select(gm => gm.UserId).ToListAsync();

    // Resource-scoped authority: a task's direct/group assignee or the owner
    // / designated manager of a folder directly linked to it, including the
    // folder of each linked document. It deliberately never uses ManagerId:
    // creating a task cannot expose unrelated work to its creator.
    private IQueryable<DmsTask> GetScopedTaskAuthorityQuery(Guid userId)
    {
        var myGroupIds = context.GroupMembers
            .Where(member => member.UserId == userId)
            .Select(member => member.GroupId);
        var managedFolderIds = context.Folders
            .Where(folder => folder.OwnerId == userId || context.FolderManagers
                .Any(manager => manager.FolderId == folder.FolderId && manager.UserId == userId))
            .Select(folder => folder.FolderId);

        return context.Tasks.Where(task =>
            task.AssignedToId == userId
            || (task.AssignedToGroupId.HasValue && myGroupIds.Contains(task.AssignedToGroupId.Value))
            || (task.FolderId.HasValue && managedFolderIds.Contains(task.FolderId.Value))
            || context.TaskFolderLinks.Any(link => link.TaskId == task.TaskId && managedFolderIds.Contains(link.FolderId))
            || (task.DocumentId.HasValue && context.Documents.Any(document =>
                document.DocumentId == task.DocumentId.Value && managedFolderIds.Contains(document.FolderId)))
            || context.TaskDocumentLinks.Any(link => link.TaskId == task.TaskId && context.Documents.Any(document =>
                document.DocumentId == link.DocumentId && managedFolderIds.Contains(document.FolderId))));
    }

    // Quality, Auditor, and Full Access can receive view-all separately. That
    // permission never turns into edit/reassign/complete authority by itself.
    private IQueryable<DmsTask> GetVisibleTasksQuery(Guid userId, bool canViewAllTasks) =>
        canViewAllTasks ? context.Tasks : GetScopedTaskAuthorityQuery(userId);

    public Task<bool> CanViewTaskAsync(DmsTask task, Guid userId, bool canViewAllTasks) =>
        GetVisibleTasksQuery(userId, canViewAllTasks).AnyAsync(candidate => candidate.TaskId == task.TaskId);

    public Task<bool> CanManageTaskAsync(DmsTask task, Guid userId, bool canManageAllTasks) =>
        (canManageAllTasks ? context.Tasks : GetScopedTaskAuthorityQuery(userId))
            .AnyAsync(candidate => candidate.TaskId == task.TaskId);

    // Reassignment from a folder-scoped task must not expose the complete
    // DMS directory. An eligible person can read every file/folder linked to
    // the task, using the same final access-override rules as the Library.
    public async Task<List<Guid>> GetDepartmentGroupIdsAsync(Guid userId) =>
        await context.GroupMembers.AsNoTracking()
            .Where(member => member.UserId == userId)
            .Join(context.Groups.AsNoTracking().Where(group => !group.AutoAddNewUsers
                    && !EF.Functions.ILike(group.Name, "all users")),
                member => member.GroupId,
                group => group.GroupId,
                (member, _) => member.GroupId)
            .Distinct()
            .ToListAsync();

    public async Task<List<DmsUser>> GetEligibleAssigneesAsync(DmsTask task, Guid scopeUserId)
    {
        var folderIds = await context.TaskFolderLinks.AsNoTracking()
            .Where(link => link.TaskId == task.TaskId)
            .Select(link => link.FolderId)
            .ToListAsync();
        if (task.FolderId.HasValue) folderIds.Add(task.FolderId.Value);

        var documentIds = await context.TaskDocumentLinks.AsNoTracking()
            .Where(link => link.TaskId == task.TaskId)
            .Select(link => link.DocumentId)
            .ToListAsync();
        if (task.DocumentId.HasValue) documentIds.Add(task.DocumentId.Value);

        folderIds = folderIds.Distinct().ToList();
        var documents = await context.Documents.AsNoTracking()
            .Where(document => documentIds.Contains(document.DocumentId))
            .Select(document => new { document.DocumentId, document.FolderId })
            .ToListAsync();

        var activeUsers = await context.Users.AsNoTracking().Where(user => user.IsActive).ToListAsync();
        // A general task has no document/folder scope. Its owner/manager is
        // limited to members of their own non-global department groups.
        if (folderIds.Count == 0 && documents.Count == 0)
        {
            var departmentGroupIds = await GetDepartmentGroupIdsAsync(scopeUserId);
            var departmentMemberIds = await context.GroupMembers.AsNoTracking()
                .Where(member => departmentGroupIds.Contains(member.GroupId))
                .Select(member => member.UserId)
                .Distinct()
                .ToListAsync();
            return activeUsers.Where(user => departmentMemberIds.Contains(user.UserId)).ToList();
        }

        var eligible = new List<DmsUser>();
        foreach (var user in activeUsers)
        {
            var allowed = true;
            foreach (var folderId in folderIds)
            {
                if (await accessOverrideService.HasFolderReadAccessAsync(user.UserId, folderId)) continue;
                allowed = false;
                break;
            }
            if (!allowed) continue;
            foreach (var document in documents)
            {
                if (await accessOverrideService.HasDocumentReadAccessAsync(user.UserId, document.DocumentId, document.FolderId)) continue;
                allowed = false;
                break;
            }
            if (allowed) eligible.Add(user);
        }
        return eligible;
    }

    public async Task<bool> CanAssignToTaskScopeAsync(DmsTask task, Guid scopeUserId, Guid? assignedToId, Guid? assignedToGroupId)
    {
        var eligibleUserIds = (await GetEligibleAssigneesAsync(task, scopeUserId)).Select(user => user.UserId).ToHashSet();
        if (assignedToId.HasValue) return eligibleUserIds.Contains(assignedToId.Value);
        if (!assignedToGroupId.HasValue) return false;

        var memberIds = await context.GroupMembers.AsNoTracking()
            .Where(member => member.GroupId == assignedToGroupId.Value)
            .Select(member => member.UserId)
            .ToListAsync();
        return memberIds.Count > 0 && memberIds.All(eligibleUserIds.Contains);
    }

    public async Task<(List<object> Items, int TotalCount)> GetMyTasksAsync(Guid userId, bool canViewAllTasks, bool canManageAllTasks, string? status = null, int page = 1, int pageSize = 100)
    {
        try
        {
            var query = GetVisibleTasksQuery(userId, canViewAllTasks);

            if (!string.IsNullOrEmpty(status))
                query = query.Where(t => t.Status == status);

            var today = DateTime.UtcNow.Date;
            var totalCount = await query.CountAsync();
            var manageableTaskIds = (canManageAllTasks ? context.Tasks : GetScopedTaskAuthorityQuery(userId))
                .Select(task => task.TaskId);

            var tasks = await query
                .OrderBy(t => !t.DueDate.HasValue)
                .ThenBy(t => t.DueDate)
                .ThenByDescending(t => t.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(t => new
                {
                    t.TaskId,
                    t.DocumentId,
                    t.FolderId,
                    t.ApprovalId,
                    WorkflowStage = t.ApprovalId.HasValue && t.DocumentId.HasValue
                        ? context.ApprovalDocuments.Where(ad => ad.ApprovalId == t.ApprovalId.Value && ad.DocumentId == t.DocumentId.Value).Select(ad => ad.CurrentStage).FirstOrDefault()
                        : null,
                    Document = t.Document == null ? null : new { t.Document.DocumentId, t.Document.Title },
                    t.Title,
                    t.Description,
                    t.Tags,
                    t.TaskType,
                    t.AuditStage,
                    t.TaskNumber,
                    t.FindingNumber,
                    t.FindingSeverity,
                    t.StandardClause,
                    t.AuditorNotes,
                    t.AuditReference,
                    t.AuditDate,
                    t.AuditStandard,
                    t.AuditCycleId,
                    t.AuditRecordId,
                    t.RiskSeverity,
                    Priority = t.RiskSeverity ?? "medium",
                    t.AssignedToId,
                    t.AssignedToGroupId,
                    AssignedToGroupName = t.AssignedToGroup == null ? null : t.AssignedToGroup.Name,
                    t.ManagerId,
                    t.DueDate,
                    t.Status,
                    t.RcaText,
                    t.CorrectionText,
                    t.PreventiveActions,
                    t.QaReviewNotes,
                    t.EffectivenessResult,
                    t.QaReviewedAt,
                    CanManage = manageableTaskIds.Contains(t.TaskId),
                    IsOverdue = t.DueDate.HasValue && t.DueDate < today && t.Status != "completed",
                    t.CreatedAt,
                    t.UpdatedAt
                })
                .ToListAsync();

            return (tasks.Cast<object>().ToList(), totalCount);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting tasks for user {UserId}", userId);
            throw;
        }
    }

    public async Task<TaskResult> CompleteTaskAsync(Guid taskId, Guid userId, string? comment = null, bool canManageAllTasks = false)
    {
        try
        {
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == taskId);

            if (task == null)
                return TaskResult.NotFound("Task not found");

            if (!await CanManageTaskAsync(task, userId, canManageAllTasks))
                return TaskResult.Forbidden("Only the assignee, linked-folder owner, or linked-folder manager can complete this task");

            if (task.Status == "completed")
                return TaskResult.Invalid("Task is already completed");

            if (task.TaskType == "pcar")
                return TaskResult.Invalid("Submit PCAR evidence for Quality/Auditor verification instead of completing the finding directly");

            var requiresEvidence = task.TaskType is "correction" or "rca" or "audit_action";
            if (requiresEvidence && !await context.TaskAttachments.AnyAsync(attachment => attachment.TaskId == taskId))
                return TaskResult.Invalid("Attach at least one evidence item before completing a Correction, Root Cause Analysis, or Audit Action task");

            task.Status = "completed";
            task.CompletedById = userId;
            task.CompletedAt = DateTime.UtcNow;
            task.UpdatedAt = DateTime.UtcNow;

            context.Tasks.Update(task);

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.TASK_COMPLETED, new
            {
                task.TaskId,
                task.DocumentId,
                task.Title,
                task.TaskType,
                task.CompletedAt,
                Comment = comment
            });

            logger.LogInformation("Task {TaskId} completed by user {UserId}", taskId, userId);

            return TaskResult.Ok(new
            {
                task.TaskId,
                task.Status,
                task.CompletedAt,
                Message = "Task completed successfully"
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error completing task {TaskId}", taskId);
            return TaskResult.Fail(ex.Message);
        }
    }

    public async Task<TaskResult> UpdateTaskAsync(Guid taskId, string? title = null, string? description = null, DateTime? dueDate = null, string? riskSeverity = null, string? status = null, string? rca = null, string? correction = null, string? preventiveActions = null, Guid? assignedToId = null, Guid? assignedToGroupId = null, string? taskType = null, string[]? tags = null, string? auditStage = null)
    {
        try
        {
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == taskId);

            if (task == null)
                return TaskResult.NotFound("Task not found");

            // Both null means "no reassignment requested", not "unassign" — a
            // task always has exactly one of the two set (DB CHECK constraint).
            if (assignedToId.HasValue || assignedToGroupId.HasValue)
            {
                if (assignedToId.HasValue == assignedToGroupId.HasValue)
                    return TaskResult.Invalid("Exactly one of assignedToId or assignedToGroupId is required to reassign");

                if (assignedToId.HasValue)
                {
                    var assignee = await context.Users.FirstOrDefaultAsync(u => u.UserId == assignedToId.Value && u.IsActive);
                    if (assignee == null)
                        return TaskResult.NotFound("Assignee not found or inactive");
                    task.AssignedToId = assignedToId.Value;
                    task.AssignedToGroupId = null;
                }
                else
                {
                    var group = await context.Groups.FirstOrDefaultAsync(g => g.GroupId == assignedToGroupId!.Value);
                    if (group == null)
                        return TaskResult.NotFound("Group not found");
                    task.AssignedToGroupId = assignedToGroupId;
                    task.AssignedToId = null;
                }
            }

            if (!string.IsNullOrWhiteSpace(title))
                task.Title = title.Trim();

            if (description != null)
                task.Description = description.Trim();

            if (tags != null)
                task.Tags = NormalizeTags(tags);

            if (dueDate.HasValue)
                task.DueDate = dueDate;

            if (!string.IsNullOrWhiteSpace(riskSeverity))
                task.RiskSeverity = riskSeverity.Trim().ToLowerInvariant();

            if (!string.IsNullOrWhiteSpace(taskType))
            {
                var normalizedType = taskType.Trim().ToLowerInvariant();
                if (normalizedType is not ("task" or "review" or "correction" or "rca" or "audit_action" or "other" or "pcar"))
                    return TaskResult.Invalid("Action must be task, review, correction, rca, audit_action, other, or pcar");
                task.TaskType = normalizedType;
            }

            if (auditStage != null)
                task.AuditStage = NormalizeAuditStage(auditStage);

            if (!string.IsNullOrWhiteSpace(status))
            {
                var normalizedStatus = status == "done" ? "completed" : status.Trim().ToLowerInvariant();
                if (normalizedStatus == "completed")
                    return TaskResult.Invalid("Use the task completion endpoint to complete a task");

                if (normalizedStatus is not ("open" or "in_progress"))
                    return TaskResult.Invalid("Status must be open or in_progress");

                task.Status = normalizedStatus;
            }

            if (!string.IsNullOrWhiteSpace(rca))
                task.RcaText = rca.Trim();

            if (!string.IsNullOrWhiteSpace(correction))
                task.CorrectionText = correction.Trim();

            if (!string.IsNullOrWhiteSpace(preventiveActions))
                task.PreventiveActions = preventiveActions.Trim();

            task.UpdatedAt = DateTime.UtcNow;

            context.Tasks.Update(task);
            await context.SaveChangesAsync();

            logger.LogInformation("Updated task {TaskId}", taskId);

            return TaskResult.Ok(new
            {
                task.TaskId,
                task.Title,
                task.Tags,
                task.DueDate,
                task.Status,
                task.AssignedToId,
                task.AssignedToGroupId,
                task.UpdatedAt
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating task {TaskId}", taskId);
            return TaskResult.Fail(ex.Message);
        }
    }

    private static string[] NormalizeTags(string[]? tags) => tags?
        .Where(tag => !string.IsNullOrWhiteSpace(tag))
        .Select(tag => tag.Trim())
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray() ?? Array.Empty<string>();

    private static string? NormalizeAuditStage(string? auditStage)
    {
        if (string.IsNullOrWhiteSpace(auditStage)) return null;
        var normalized = auditStage.Trim().ToLowerInvariant();
        if (normalized is not ("preparation" or "internal_audit" or "external_audit"))
            throw new ArgumentException("Audit stage must be preparation, internal_audit, or external_audit");
        return normalized;
    }

    // The Root Cause Analysis / Immediate Correction / Preventive Action form
    // on the PCAR page. A self-filed PCAR has no separate reviewer on the
    // other end — Document Workflow already governs the real document
    // approval, and per explicit design decision this filing step is purely
    // documentation, so submitting completes the task immediately instead of
    // waiting on a manual QA Approve/Reject step (the previous QA Review
    // Queue). Replaces the older UpdateTaskAsync misuse, which concatenated
    // all three fields into Description as plain text — harmless on a first
    // submit, but re-running it on every click (nothing stopped resubmission)
    // kept prepending onto the same string forever.
    public async Task<TaskResult> SubmitPcarAsync(Guid taskId, Guid userId, string rca, string correction, string preventiveActions, DateTime targetDate, string[]? tags = null, bool canManageAllTasks = false)
    {
        try
        {
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == taskId);
            if (task == null)
                return TaskResult.NotFound("Task not found");

            if (task.TaskType != "pcar")
                return TaskResult.Invalid("Only audit PCAR findings use this endpoint; complete normal tasks directly");

            if (!await CanManageTaskAsync(task, userId, canManageAllTasks))
                return TaskResult.Forbidden("Only the assignee, linked-folder owner, or linked-folder manager can submit this PCAR");

            if (task.Status != "open")
                return TaskResult.Invalid("This PCAR has already been submitted for approval");

            if (rca.Trim().Length < 20)
                return TaskResult.Invalid("Root cause analysis must contain at least 20 characters");
            if (string.IsNullOrWhiteSpace(correction) || string.IsNullOrWhiteSpace(preventiveActions))
                return TaskResult.Invalid("Complete the corrective action and preventive action");

            // Evidence is a compliance record, not merely a client-side UI
            // hint. Checking it here makes the rule apply to direct API calls
            // as well as the PCAR page.
            if (!PcarComplianceRules.HasRequiredEvidence(await context.TaskAttachments.CountAsync(attachment => attachment.TaskId == taskId)))
                return TaskResult.Invalid("Attach at least one evidence item before submitting this PCAR for verification");

            // PCAR findings are raised after final release and are not part of
            // the document approval workflow. They never require a new file
            // version before closure.
            /* // Real gap found live: the frontend's "upload the corrected file
            // first" gate is pure local UI state, easily bypassed (a direct
            // API call, or just reloading the page, which resets it) — this
            // endpoint itself never checked anything. Per explicit request,
            // any self-filed PCAR that references a document at all now must
            // have a real newer version uploaded onto it since the task was
            // created before it can be submitted; a version's own CreatedAt is
            // a real, persistent signal (unlike the frontend's local state)
            // that survives a reload and can't be spoofed by skipping the
            // upload step.
            if (false && task.DocumentId.HasValue)
            {
                var currentVersionId = await context.Documents
                    .Where(d => d.DocumentId == task.DocumentId)
                    .Select(d => d.CurrentVersionId)
                    .FirstOrDefaultAsync();

                var currentVersionUploadedAt = currentVersionId.HasValue
                    ? await context.DocumentVersions
                        .Where(v => v.VersionId == currentVersionId)
                        .Select(v => (DateTime?)v.CreatedAt)
                        .FirstOrDefaultAsync()
                    : null;

                if (currentVersionUploadedAt == null || currentVersionUploadedAt <= task.CreatedAt)
                    return TaskResult.Invalid("Upload the corrected file for the linked document before submitting this PCAR");
            } */

            task.RcaText = rca.Trim();
            task.CorrectionText = correction.Trim();
            task.PreventiveActions = preventiveActions.Trim();
            if (tags != null)
                task.Tags = NormalizeTags(tags);
            task.DueDate = targetDate;
            task.Status = "submitted";
            task.CompletedById = null;
            task.CompletedAt = null;
            task.UpdatedAt = DateTime.UtcNow;

            context.Tasks.Update(task);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.PCAR_SUBMITTED, new
            {
                task.TaskId, task.Title, task.DocumentId, task.FindingNumber,
                EvidenceCount = await context.TaskAttachments.CountAsync(attachment => attachment.TaskId == taskId),
                SubmittedAt = task.UpdatedAt,
            });
            await notificationService.NotifyPcarVerifiersAsync(userId, task.TaskId,
                "PCAR evidence submitted for verification", task.Title);

            logger.LogInformation("PCAR {TaskId} submitted for verification by {UserId}", taskId, userId);

            return TaskResult.Ok(new { task.TaskId, task.Status, task.UpdatedAt });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error submitting PCAR {TaskId}", taskId);
            return TaskResult.Fail(ex.Message);
        }
    }

    public async Task<List<object>> GetOverdueTasksAsync(int limit = 100)
    {
        try
        {
            var today = DateTime.Now.Date;

            var overdue = await context.Tasks
                .Where(t => t.DueDate.HasValue && t.DueDate < today && t.Status != "completed")
                .OrderBy(t => t.DueDate)
                .Take(limit)
                .Select(t => new
                {
                    t.TaskId,
                    t.DocumentId,
                    t.FolderId,
                    t.Title,
                    AssignedTo = t.AssignedTo == null ? null : new { t.AssignedTo.UserId, t.AssignedTo.FullName, t.AssignedTo.Email },
                    AssignedToGroupName = t.AssignedToGroup == null ? null : t.AssignedToGroup.Name,
                    t.DueDate,
                    t.Status,
                    DaysOverdue = (today - t.DueDate.Value).Days,
                    t.CreatedAt
                })
                .ToListAsync();

            return overdue.Cast<object>().ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting overdue tasks");
            return new List<object>();
        }
    }

    public async Task<List<object>> GetTasksByDocumentAsync(Guid documentId, Guid userId, bool canViewAllTasks)
    {
        try
        {
            // Full task history for this document — every correction task raised
            // against it across every approval cycle, not just the currently open
            // one. Used by the Document Preview's "View Related Tasks" button so a
            // reviewer can see every edit/correction round from creation onward.
            var tasks = await GetVisibleTasksQuery(userId, canViewAllTasks)
                // Keep the legacy primary-document column in the predicate so
                // existing installations work before the link-table backfill
                // has run. New tasks can be linked to several documents.
                // A PCAR is an audit finding, not an internal task. It has a
                // separate Related PCARs endpoint and must never leak into the
                // document's Related Tasks history.
                .Where(t => t.TaskType != "pcar" && (t.DocumentId == documentId || context.TaskDocumentLinks
                    .Any(link => link.TaskId == t.TaskId && link.DocumentId == documentId)))
                .OrderByDescending(t => t.CreatedAt)
                .Select(t => new
                {
                    t.TaskId,
                    t.Title,
                    t.Description,
                    t.TaskType,
                    t.TaskNumber,
                    t.RiskSeverity,
                    AssignedTo = t.AssignedTo == null ? null : new { t.AssignedTo.UserId, t.AssignedTo.FullName },
                    AssignedToGroupName = t.AssignedToGroup == null ? null : t.AssignedToGroup.Name,
                    t.ManagerId,
                    t.DueDate,
                    t.Status,
                    t.CreatedAt,
                    CompletedAt = t.CompletedAt,
                    t.CompletedById,
                })
                .ToListAsync();

            var userIds = tasks
                .SelectMany(t => new[] { t.ManagerId, t.CompletedById })
                .Where(id => id.HasValue)
                .Select(id => id!.Value)
                .Distinct()
                .ToList();
            var userNamesById = await context.Users
                .Where(u => userIds.Contains(u.UserId))
                .ToDictionaryAsync(u => u.UserId, u => u.FullName);

            var tasksWithNames = tasks.Select(t => new
            {
                t.TaskId,
                t.Title,
                t.Description,
                t.TaskType,
                t.TaskNumber,
                t.RiskSeverity,
                t.AssignedTo,
                t.AssignedToGroupName,
                t.ManagerId,
                SubmittedByName = t.ManagerId.HasValue && userNamesById.TryGetValue(t.ManagerId.Value, out var managerName) ? managerName : null,
                t.DueDate,
                t.Status,
                t.CreatedAt,
                t.CompletedAt,
                t.CompletedById,
                CompletedByName = t.CompletedById.HasValue && userNamesById.TryGetValue(t.CompletedById.Value, out var completedName) ? completedName : null,
            }).ToList();

            return tasksWithNames.Cast<object>().ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting tasks for document {DocumentId}", documentId);
            return new List<object>();
        }
    }

    public async Task<List<object>> GetPcarsByDocumentAsync(Guid documentId, Guid userId, bool canViewAllTasks)
    {
        var pcars = await GetVisibleTasksQuery(userId, canViewAllTasks)
            .Where(t => t.TaskType == "pcar" && (t.DocumentId == documentId || context.TaskDocumentLinks
                .Any(link => link.TaskId == t.TaskId && link.DocumentId == documentId)))
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new
            {
                t.TaskId, t.Title, t.Description, t.TaskType, t.TaskNumber, t.FindingNumber, t.RiskSeverity,
                AssignedToName = t.AssignedTo == null ? null : t.AssignedTo.FullName,
                AssignedToGroupName = t.AssignedToGroup == null ? null : t.AssignedToGroup.Name,
                t.DueDate, t.Status, t.CreatedAt, t.CompletedAt,
            })
            .ToListAsync();
        return pcars.Cast<object>().ToList();
    }

    public async Task<List<object>> GetTasksByFolderAsync(Guid folderId, Guid userId, bool canViewAllTasks, bool pcarsOnly = false)
    {
        var tasks = await GetVisibleTasksQuery(userId, canViewAllTasks)
            .Where(t => (t.FolderId == folderId || context.TaskFolderLinks
                    .Any(link => link.TaskId == t.TaskId && link.FolderId == folderId))
                && (pcarsOnly ? t.TaskType == "pcar" : t.TaskType != "pcar"))
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new
            {
                t.TaskId, t.Title, t.Description, t.TaskType, t.TaskNumber, t.FindingNumber, t.RiskSeverity,
                AssignedToName = t.AssignedTo == null ? null : t.AssignedTo.FullName,
                AssignedToGroupName = t.AssignedToGroup == null ? null : t.AssignedToGroup.Name,
                t.DueDate, t.Status, t.CreatedAt, t.CompletedAt,
            })
            .ToListAsync();
        return tasks.Cast<object>().ToList();
    }
}

public class TaskResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }
    public Guid? ResourceId { get; set; }

    public static TaskResult Ok(object data, Guid? resourceId = null) => new() { Success = true, Data = data, ResourceId = resourceId };
    public static TaskResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static TaskResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static TaskResult Forbidden(string message) => new() { Success = false, Message = message, Error = "Forbidden" };
    public static TaskResult Fail(string message) => new() { Success = false, Message = message, Error = "InternalError" };
}
