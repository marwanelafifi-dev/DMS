using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Text;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TasksController(DmsContext context, TaskService taskService, MinioService minioService, AuditService auditService, NotificationService notificationService, AccessOverrideService accessOverrideService, TaskNotificationPolicyService taskNotificationPolicyService, ILogger<TasksController> logger) : BaseController
{
    private static bool CanViewAllTasks(DmsPageAccessRole? role) =>
        role?.CanViewAllTasks == true || role?.CanManageAllTasks == true;

    private async Task NotifyTaskAssignmentAsync(DmsTask task, Guid actorUserId, string userTitle, string groupTitle)
    {
        var policy = await taskNotificationPolicyService.LoadAsync();
        if (!policy.Enabled || !policy.Creation.Enabled) return;
        var recipientIds = await taskNotificationPolicyService.GetRecipientIdsAsync(task, policy.Creation);
        foreach (var recipientId in recipientIds)
            await notificationService.NotifyAsync(
                recipientId,
                actorUserId,
                task.AssignedToId.HasValue ? userTitle : groupTitle,
                task.Title,
                taskId: task.TaskId);
    }

    // GET /api/tasks — my tasks
    [HttpGet]
    public async Task<ActionResult<object>> GetMyTasks(
        [FromQuery] string? status,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 100,
        [FromQuery] int? limit = null)
    {
        try
        {
            var userId = GetCurrentUserId();
            page = Math.Max(1, page);
            pageSize = Math.Clamp(limit ?? pageSize, 1, 200);
            var role = await GetPageAccessRoleAsync(context, userId);
            var result = await taskService.GetMyTasksAsync(userId, CanViewAllTasks(role), role?.CanManageAllTasks == true, status, page, pageSize);

            logger.LogInformation("Retrieved {Count} tasks for user {UserId}", result.Items.Count, userId);

            return Ok(new
            {
                success = true,
                data = result.Items,
                count = result.TotalCount,
                totalCount = result.TotalCount,
                page,
                pageSize,
                totalPages = Math.Max(1, (int)Math.Ceiling(result.TotalCount / (double)pageSize))
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving tasks");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/{id} — task details
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetTask(Guid id)
    {
        try
        {
            var task = await context.Tasks
                .Include(t => t.AssignedTo)
                .Include(t => t.AssignedToGroup)
                .Include(t => t.Document)
                .FirstOrDefaultAsync(t => t.TaskId == id);

            if (task == null)
                return NotFound(new { success = false, error = "Task not found" });

            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            if (!await taskService.CanViewTaskAsync(task, userId, CanViewAllTasks(role)))
                return StatusCode(403, new { success = false, error = "You do not have permission to view this task" });
            var canManageTask = await taskService.CanManageTaskAsync(task, userId, role?.CanManageAllTasks == true);

            var linkedDocuments = await (
                from link in context.TaskDocumentLinks.AsNoTracking()
                join document in context.Documents.AsNoTracking() on link.DocumentId equals document.DocumentId
                where link.TaskId == id
                select new { document.DocumentId, document.Title, document.OriginalDocumentId, document.Status }
            ).ToListAsync();
            if (task.DocumentId.HasValue && linkedDocuments.All(document => document.DocumentId != task.DocumentId.Value))
            {
                var primaryDocument = await context.Documents.AsNoTracking()
                    .Where(document => document.DocumentId == task.DocumentId.Value)
                    .Select(document => new { document.DocumentId, document.Title, document.OriginalDocumentId, document.Status })
                    .FirstOrDefaultAsync();
                if (primaryDocument != null) linkedDocuments.Add(primaryDocument);
            }

            var linkedFolders = await (
                from link in context.TaskFolderLinks.AsNoTracking()
                join folder in context.Folders.AsNoTracking() on link.FolderId equals folder.FolderId
                where link.TaskId == id
                select new { folder.FolderId, folder.Name }
            ).ToListAsync();
            if (task.FolderId.HasValue && linkedFolders.All(folder => folder.FolderId != task.FolderId.Value))
            {
                var primaryFolder = await context.Folders.AsNoTracking()
                    .Where(folder => folder.FolderId == task.FolderId.Value)
                    .Select(folder => new { folder.FolderId, folder.Name })
                    .FirstOrDefaultAsync();
                if (primaryFolder != null) linkedFolders.Add(primaryFolder);
            }

            logger.LogInformation("Retrieved task {TaskId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    task.TaskId,
                    task.DocumentId,
                    task.FolderId,
                    LinkedDocuments = linkedDocuments,
                    LinkedFolders = linkedFolders,
                    task.ApprovalId,
                    Document = task.Document == null ? null : new { task.Document.DocumentId, task.Document.Title },
                    task.Title,
                    task.Description,
                    task.Tags,
                    task.TaskType,
                    task.AuditStage,
                    task.FindingNumber,
                    task.FindingSeverity,
                    task.StandardClause,
                    task.AuditorNotes,
                    task.RiskSeverity,
                    AssignedTo = task.AssignedTo == null ? null : new { task.AssignedTo.UserId, task.AssignedTo.FullName, task.AssignedTo.Email },
                    AssignedToGroup = task.AssignedToGroup == null ? null : new { task.AssignedToGroup.GroupId, task.AssignedToGroup.Name },
                    task.DueDate,
                    task.Status,
                    task.RcaText,
                    task.CorrectionText,
                    task.PreventiveActions,
                    task.QaReviewNotes,
                    task.EffectivenessResult,
                    task.QaReviewedAt,
                    CanManage = canManageTask,
                    task.CreatedAt,
                    task.CompletedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/{id}/document — the document linked to this task. Per
    // explicit request, the task-assignee bypass that used to grant Read here
    // regardless of any real folder access was removed entirely: a task
    // pointing at a document is no longer, on its own, a reason to be able to
    // view/download it — the caller still needs genuine folder access (a role
    // grant, a role-wide bypass flag, or an Allow override), the exact same
    // bar as browsing to it directly in the Document Library.
    [HttpGet("{id}/document")]
    public async Task<ActionResult<object>> GetLinkedDocument(Guid id)
    {
        try
        {
            var userId = GetCurrentUserId();
            var task = await context.Tasks.AsNoTracking().FirstOrDefaultAsync(t => t.TaskId == id);
            if (task == null)
                return NotFound(new { success = false, error = "Task not found" });
            if (task.DocumentId == null)
                return NotFound(new { success = false, error = "This task has no linked document" });

            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (!await taskService.CanViewTaskAsync(task, userId, CanViewAllTasks(pageAccessRole)))
                return StatusCode(403, new { success = false, error = "You do not have permission to view this task's document" });

            var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == task.DocumentId);
            if (document == null)
                return NotFound(new { success = false, error = "Linked document not found" });

            var allowed = await HasFolderReadAccessAsync(context, accessOverrideService, userId, document.FolderId);
            if (!allowed)
                return StatusCode(403, new { success = false, error = "You do not have access to this file — please contact your administrator." });

            var currentVersion = document.CurrentVersionId.HasValue
                ? await context.DocumentVersions.AsNoTracking().FirstOrDefaultAsync(v => v.VersionId == document.CurrentVersionId)
                : null;

            return Ok(new
            {
                success = true,
                data = new
                {
                    document.DocumentId,
                    document.FolderId,
                    document.CurrentVersionId,
                    FileName = currentVersion?.FileName ?? document.Title,
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving linked document for task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/{id}/assignees — the reassignment picker. A folder
    // owner/manager sees only people who already have read access to every
    // resource linked to this task; global task managers keep the full list.
    [HttpGet("{id}/assignees")]
    public async Task<ActionResult<object>> GetEligibleAssignees(Guid id)
    {
        var userId = GetCurrentUserId();
        var task = await context.Tasks.AsNoTracking().FirstOrDefaultAsync(item => item.TaskId == id);
        if (task == null) return NotFound(new { success = false, error = "Task not found" });

        var role = await GetPageAccessRoleAsync(context, userId);
        var canManageTask = await taskService.CanManageTaskAsync(task, userId, role?.CanManageAllTasks == true);
        var canReassignAny = role?.CanManageAllTasks == true || role?.CanReassignTasks == true;
        if (!canManageTask && !canReassignAny)
            return StatusCode(403, new { success = false, error = "You do not have permission to reassign this task" });

        var canUseFullDirectory = role?.CanManageAllTasks == true || role?.CanViewAllTasks == true;
        var users = canUseFullDirectory
            ? await context.Users.AsNoTracking().Where(user => user.IsActive).ToListAsync()
            : await taskService.GetEligibleAssigneesAsync(task, userId);
        var eligibleUserIds = users.Select(user => user.UserId).ToHashSet();
        var departmentGroupIds = await taskService.GetDepartmentGroupIdsAsync(userId);
        var groups = await context.Groups.AsNoTracking()
            .Where(group => !group.AutoAddNewUsers && !EF.Functions.ILike(group.Name, "all users"))
            .ToListAsync();
        var membersByGroup = (await context.GroupMembers.AsNoTracking()
            .Where(member => groups.Select(group => group.GroupId).Contains(member.GroupId))
            .Select(member => new { member.GroupId, member.UserId })
            .ToListAsync())
            .GroupBy(member => member.GroupId)
            .ToDictionary(group => group.Key, group => group.Select(member => member.UserId).ToList());
        var linkedResources = task.DocumentId.HasValue || task.FolderId.HasValue
            || await context.TaskDocumentLinks.AnyAsync(link => link.TaskId == task.TaskId)
            || await context.TaskFolderLinks.AnyAsync(link => link.TaskId == task.TaskId);
        var eligibleGroups = canUseFullDirectory
            ? groups
            : linkedResources
                ? groups.Where(group => membersByGroup.TryGetValue(group.GroupId, out var memberIds)
                    && memberIds.Count > 0 && memberIds.All(eligibleUserIds.Contains)).ToList()
                : groups.Where(group => departmentGroupIds.Contains(group.GroupId)).ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                users = users.Select(user => new { user.UserId, user.FullName, user.Email }),
                groups = eligibleGroups.Select(group => new { group.GroupId, group.Name }),
            },
        });
    }

    // POST /api/tasks/{id}/submit-pcar — the RCA/correction/preventive-action
    // form on the PCAR page. Moves the task into the real 'submitted' state
    // (see the QA review queue endpoints below) instead of the previous
    // UpdateTaskAsync-based flow, which had no real reviewer queue and no
    // guard against resubmission.
    [HttpPost("{id}/submit-pcar")]
    public async Task<ActionResult<object>> SubmitPcar(Guid id, [FromBody] SubmitPcarRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            var result = await taskService.SubmitPcarAsync(id, userId, req.Rca ?? "", req.Correction ?? "", req.PreventiveActions ?? "", req.TargetDate, req.Tags, role?.CanManageAllTasks == true);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Forbidden" => StatusCode(403, new { success = false, error = result.Message }),
                    _ => BadRequest(new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error submitting PCAR {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/tasks — create a new task
    [HttpPost]
    public async Task<ActionResult<object>> CreateTask([FromBody] CreateTaskRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Title))
                return BadRequest(new { success = false, error = "Title is required" });

            if (req.AssignedToId.HasValue == req.AssignedToGroupId.HasValue)
                return BadRequest(new { success = false, error = "Exactly one of assignedToId or assignedToGroupId is required" });

            var managerId = GetCurrentUserId();

            var pageAccessRole = await GetPageAccessRoleAsync(context, managerId);
            if (pageAccessRole?.CanCreateTasks != true && pageAccessRole?.CanManageAllTasks != true)
                return StatusCode(403, new { success = false, error = "You do not have permission to create and assign tasks" });

            if (string.Equals(req.TaskType, "pcar", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { success = false, error = "Create audit PCAR findings through the PCAR endpoint" });

            // Tasks aren't folder-scoped, so there's no per-folder grant to
            // check here — anyone who can see the PCAR page can self-file a
            // PCAR (assign it to themselves). Assigning it to someone ELSE, or
            // to a Group (the "New PCAR" form lets you pick either), needs
            // either the dedicated CanCreateTasks flag or the broader
            // CanManageAllTasks flag (which already implies it).
            var assigningToSelf = req.AssignedToId == managerId && req.AssignedToGroupId == null;
            if (!assigningToSelf)
            {
                // The task creation capability above already covers assignment
                // to a user or group. This is not an approval-workflow action.
            }

            var result = await taskService.CreateTaskAsync(
                managerId,
                req.DocumentId,
                req.FolderId,
                req.AssignedToId,
                req.AssignedToGroupId,
                req.Title,
                req.Description,
                req.TaskType,
                req.RiskSeverity,
                req.DueDate,
                req.Tags,
                req.AuditStage, req.DocumentIds, req.FolderIds, req.DirectManagerId);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    _ => BadRequest(new { success = false, error = result.Message })
                };
            }

            if (!result.ResourceId.HasValue)
            {
                logger.LogError("Task service returned success without a resource ID");
                return StatusCode(500, new { success = false, error = "Task was created but its ID was not returned" });
            }

            var createdTask = await context.Tasks.AsNoTracking().FirstAsync(t => t.TaskId == result.ResourceId.Value);
            await NotifyTaskAssignmentAsync(createdTask, managerId, "New task assigned to you", "New task assigned to your group");

            return CreatedAtAction(nameof(GetTask), new { id = result.ResourceId.Value }, new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating task");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/import-template — a deliberately small, documented CSV
    // template for normal internal tasks. PCARs are excluded because their
    // finding/closure requirements need their own controlled import flow.
    [HttpGet("import-template")]
    public async Task<IActionResult> DownloadTaskImportTemplate()
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        if (role?.CanCreateTasks != true && role?.CanManageAllTasks != true)
            return StatusCode(403, new { success = false, error = "You do not have permission to import tasks" });

        const string csv = """
Title,Description,Action,Priority,Due Date,Assignee Email,Assignee Group,Folder Path(s),Document ID(s),Audit Stage,Tags
Review QMS procedures,Review all applicable QMS procedures,Review,Medium,2026-12-31,user@si-ware.com,,Corporate / QMS / Procedures,SWS-25120007;SWS-25120008,internal_audit,QMS;quarterly review
""";
        return File(new UTF8Encoding(encoderShouldEmitUTF8Identifier: true).GetBytes(csv), "text/csv", "dms-task-import-template.csv");
    }

    // POST /api/tasks/import — creates normal Tasks (never PCAR findings)
    // from the template above. Rows are validated independently so one bad
    // record never prevents valid work from being imported.
    [HttpPost("import")]
    public async Task<ActionResult<object>> ImportTasks(IFormFile file)
    {
        try
        {
            var currentUserId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, currentUserId);
            if (role?.CanCreateTasks != true && role?.CanManageAllTasks != true)
                return StatusCode(403, new { success = false, error = "You do not have permission to import tasks" });
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "A CSV file is required" });

            string csv;
            using (var reader = new StreamReader(file.OpenReadStream()))
                csv = await reader.ReadToEndAsync();
            var rows = CsvParser.ParseWithHeader(csv);
            if (rows.Count == 0)
                return BadRequest(new { success = false, error = "The CSV file has no task rows" });

            var usersByEmail = await context.Users.AsNoTracking()
                .Where(user => user.IsActive)
                .ToDictionaryAsync(user => user.Email, user => user, StringComparer.OrdinalIgnoreCase);
            var groupsByName = await context.Groups.AsNoTracking()
                .ToDictionaryAsync(group => group.Name, group => group, StringComparer.OrdinalIgnoreCase);
            var folders = await context.Folders.AsNoTracking().ToListAsync();
            var foldersById = folders.ToDictionary(folder => folder.FolderId);
            var foldersByPath = folders
                .GroupBy(folder => BuildFolderPath(folder, foldersById), StringComparer.OrdinalIgnoreCase)
                .Where(group => group.Count() == 1)
                .ToDictionary(group => group.Key, group => group.Single(), StringComparer.OrdinalIgnoreCase);
            var documents = await context.Documents.AsNoTracking().ToListAsync();

            var created = new List<object>();
            var skipped = new List<object>();
            for (var index = 0; index < rows.Count; index++)
            {
                var row = rows[index];
                var title = row.GetValue("Title").Trim();
                if (string.IsNullOrWhiteSpace(title))
                {
                    skipped.Add(new { row = index + 2, reason = "Title is required" });
                    continue;
                }

                if (!TryParseImportedDate(row.GetValue("Due Date"), out var dueDate))
                {
                    skipped.Add(new { row = index + 2, title, reason = "Due Date must use YYYY-MM-DD" });
                    continue;
                }

                var action = NormalizeImportedAction(row.GetValue("Action"));
                if (action == null)
                {
                    skipped.Add(new { row = index + 2, title, reason = "Action must be General task, Review, Correction, RCA, Audit Action, or Other" });
                    continue;
                }

                var priority = row.GetValue("Priority").Trim().ToLowerInvariant();
                if (string.IsNullOrWhiteSpace(priority)) priority = "medium";
                if (priority is not ("low" or "medium" or "high" or "critical"))
                {
                    skipped.Add(new { row = index + 2, title, reason = "Priority must be Low, Medium, High, or Critical" });
                    continue;
                }

                var assigneeEmail = row.GetValue("Assignee Email").Trim();
                var assigneeGroup = row.GetValue("Assignee Group").Trim();
                if (string.IsNullOrWhiteSpace(assigneeEmail) == string.IsNullOrWhiteSpace(assigneeGroup))
                {
                    skipped.Add(new { row = index + 2, title, reason = "Provide exactly one of Assignee Email or Assignee Group" });
                    continue;
                }
                Guid? assigneeId = null;
                Guid? groupId = null;
                if (!string.IsNullOrWhiteSpace(assigneeEmail))
                {
                    if (!usersByEmail.TryGetValue(assigneeEmail, out var assignee))
                    {
                        skipped.Add(new { row = index + 2, title, reason = $"No active user found for '{assigneeEmail}'" });
                        continue;
                    }
                    assigneeId = assignee.UserId;
                }
                else if (!groupsByName.TryGetValue(assigneeGroup, out var assigneeGroupEntity))
                {
                    skipped.Add(new { row = index + 2, title, reason = $"No group found named '{assigneeGroup}'" });
                    continue;
                }
                else groupId = assigneeGroupEntity.GroupId;

                var folderIds = new List<Guid>();
                var folderError = false;
                foreach (var path in SplitImportedList(row.GetValue("Folder Path(s)")))
                {
                    if (!foldersByPath.TryGetValue(path, out var folder))
                    {
                        skipped.Add(new { row = index + 2, title, reason = $"No folder found for path '{path}'" });
                        folderError = true;
                        break;
                    }
                    folderIds.Add(folder.FolderId);
                }
                if (folderError) continue;

                var documentIds = new List<Guid>();
                var documentError = false;
                foreach (var documentKey in SplitImportedList(row.GetValue("Document ID(s)")))
                {
                    var document = documents.FirstOrDefault(item =>
                        item.DocumentId.ToString().Equals(documentKey, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(item.OriginalDocumentId, documentKey, StringComparison.OrdinalIgnoreCase));
                    if (document == null)
                    {
                        skipped.Add(new { row = index + 2, title, reason = $"No file found for Document ID '{documentKey}'" });
                        documentError = true;
                        break;
                    }
                    documentIds.Add(document.DocumentId);
                }
                if (documentError) continue;

                var auditStage = NormalizeImportedAuditStage(row.GetValue("Audit Stage"));
                if (auditStage == "invalid")
                {
                    skipped.Add(new { row = index + 2, title, reason = "Audit Stage must be Preparation, Internal Audit, External Audit, or blank" });
                    continue;
                }

                var result = await taskService.CreateTaskAsync(
                    currentUserId,
                    documentIds.Count > 0 ? documentIds[0] : null,
                    folderIds.Count > 0 ? folderIds[0] : null,
                    assigneeId,
                    groupId,
                    title,
                    row.GetValue("Description"),
                    action,
                    priority,
                    dueDate,
                    SplitImportedList(row.GetValue("Tags")).ToArray(),
                    auditStage,
                    documentIds.Distinct().ToArray(),
                    folderIds.Distinct().ToArray());
                if (!result.Success || !result.ResourceId.HasValue)
                {
                    skipped.Add(new { row = index + 2, title, reason = result.Message ?? "Unable to create task" });
                    continue;
                }

                var createdTask = await context.Tasks.AsNoTracking().FirstAsync(task => task.TaskId == result.ResourceId.Value);
                await NotifyTaskAssignmentAsync(createdTask, currentUserId, "New task assigned to you", "New task assigned to your group");
                created.Add(new { row = index + 2, title, taskId = result.ResourceId.Value });
            }

            await auditService.LogAsync(currentUserId, "TASKS_IMPORTED", new { CreatedCount = created.Count, SkippedCount = skipped.Count });
            return Ok(new { success = true, data = new { created, skipped } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error importing tasks from CSV");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    private static IEnumerable<string> SplitImportedList(string value) =>
        value.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private static string BuildFolderPath(DmsFolder folder, IReadOnlyDictionary<Guid, DmsFolder> foldersById)
    {
        var parts = new List<string>();
        var current = folder;
        var guard = 0;
        while (guard++ < 50)
        {
            parts.Insert(0, current.Name);
            if (!current.ParentFolderId.HasValue || !foldersById.TryGetValue(current.ParentFolderId.Value, out var parent)) break;
            current = parent;
        }
        return string.Join(" / ", parts);
    }

    private static bool TryParseImportedDate(string value, out DateTime dueDate) =>
        DateTime.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out dueDate);

    private static string? NormalizeImportedAction(string value) => value.Trim().ToLowerInvariant() switch
    {
        "" or "task" or "general task" => "task",
        "review" => "review",
        "correction" => "correction",
        "rca" or "root cause analysis" => "rca",
        "audit action" or "audit_action" => "audit_action",
        "other" => "other",
        _ => null,
    };

    private static string? NormalizeImportedAuditStage(string value) => value.Trim().ToLowerInvariant() switch
    {
        "" => null,
        "preparation" => "preparation",
        "internal audit" or "internal_audit" => "internal_audit",
        "external audit" or "external_audit" => "external_audit",
        _ => "invalid",
    };

    // POST /api/tasks/pcar — an audit finding, never an approval correction.
    // Only Quality and Full Access may raise one, and only after Final Release.
    [HttpPost("pcar")]
    public async Task<ActionResult<object>> CreatePcar([FromBody] CreateTaskRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Title))
                return BadRequest(new { success = false, error = "PCAR title is required" });
            if (req.AssignedToId.HasValue == req.AssignedToGroupId.HasValue)
                return BadRequest(new { success = false, error = "Assign the PCAR to exactly one user or group" });

            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            if (role?.CanCreatePcars != true)
                return StatusCode(403, new { success = false, error = "Your role does not have permission to raise audit PCAR findings" });

            // A finding may now link to several files. Validate the complete
            // link set, rather than only the legacy primary DocumentId, so a
            // draft/pending file cannot be slipped into a PCAR as a secondary
            // link.
            var documentIds = (req.DocumentIds ?? []).ToList();
            if (req.DocumentId.HasValue)
                documentIds.Add(req.DocumentId.Value);
            documentIds = documentIds.Distinct().ToList();

            var folderIds = (req.FolderIds ?? []).ToList();
            if (req.FolderId.HasValue)
                folderIds.Add(req.FolderId.Value);
            folderIds = folderIds.Distinct().ToList();
            if (!PcarComplianceRules.HasRequiredScope(documentIds, folderIds))
                return BadRequest(new { success = false, error = "A PCAR must be linked to at least one released file or folder" });

            var releasedDocumentIds = await context.Documents
                .Where(document => documentIds.Contains(document.DocumentId) && document.Status == "released")
                .Select(document => document.DocumentId)
                .ToListAsync();
            if (documentIds.Count > 0 && !PcarComplianceRules.EveryLinkedFileIsReleased(documentIds, releasedDocumentIds))
                return BadRequest(new { success = false, error = "Every file linked to a PCAR must be in Released status" });

            var existingFolderCount = folderIds.Count == 0 ? 0 : await context.Folders.CountAsync(folder => folderIds.Contains(folder.FolderId));
            if (existingFolderCount != folderIds.Count)
                return BadRequest(new { success = false, error = "One or more linked folders could not be found" });

            Guid? primaryDocumentId = req.DocumentId ?? documentIds.Select(id => (Guid?)id).FirstOrDefault();
            Guid? primaryFolderId = req.FolderId ?? folderIds.Select(id => (Guid?)id).FirstOrDefault();

            var result = await taskService.CreateTaskAsync(userId, primaryDocumentId, primaryFolderId, req.AssignedToId, req.AssignedToGroupId,
                req.Title, req.Description, "pcar", req.RiskSeverity, req.DueDate, req.Tags, null, documentIds.ToArray(), folderIds.ToArray());
            if (!result.Success)
                return result.Error == "NotFound"
                    ? NotFound(new { success = false, error = result.Message })
                    : BadRequest(new { success = false, error = result.Message });

            var task = await context.Tasks.AsNoTracking().FirstAsync(t => t.TaskId == result.ResourceId!.Value);
            var finding = await context.Tasks.FirstAsync(t => t.TaskId == result.ResourceId!.Value);
            finding.FindingNumber = $"PCAR-{DateTime.UtcNow:yyyy}-{await context.Tasks.CountAsync(t => t.TaskType == "pcar"):D4}";
            finding.FindingSeverity = req.FindingSeverity?.Trim().ToLowerInvariant();
            finding.StandardClause = req.StandardClause?.Trim();
            finding.AuditorNotes = req.AuditorNotes?.Trim();
            await context.SaveChangesAsync();
            await NotifyTaskAssignmentAsync(task, userId, "New audit PCAR assigned to you", "New audit PCAR assigned to your group");
            await auditService.LogAsync(userId, "PCAR_RAISED", new { task.TaskId, task.DocumentId, task.Title });
            return CreatedAtAction(nameof(GetTask), new { id = task.TaskId }, new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating audit PCAR");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/tasks/{id}/complete — close the task
    [HttpPost("{id}/verify-pcar")]
    public async Task<ActionResult<object>> VerifyPcar(Guid id, [FromBody] VerifyPcarRequest req)
    {
        var userId = GetCurrentUserId(); var role = await GetPageAccessRoleAsync(context, userId);
        if (!PcarComplianceRules.CanVerify(role?.CanVerifyPcars == true)) return StatusCode(403, new { success = false, error = "Your role cannot verify PCAR findings" });
        var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == id && t.TaskType == "pcar");
        if (task == null) return NotFound(new { success = false, error = "PCAR not found" });
        if (task.Status != "submitted") return BadRequest(new { success = false, error = "This PCAR is not awaiting verification" });
        if (!PcarComplianceRules.HasRequiredReturnNotes(req.Approve, req.Notes)) return BadRequest(new { success = false, error = "Return notes are required so the assignee knows what to revise" });
        var effectiveness = req.Effectiveness?.Trim().ToLowerInvariant();
        if (effectiveness is not ("effective" or "ineffective")) return BadRequest(new { success = false, error = "Select whether the corrective action is effective or ineffective" });
        if (!PcarComplianceRules.IsEffectivenessDecisionConsistent(req.Approve, effectiveness))
            return BadRequest(new { success = false, error = req.Approve ? "Only an effective corrective action can be approved and closed" : "A returned PCAR must be marked ineffective" });
        task.QaReviewNotes = req.Notes?.Trim(); task.EffectivenessResult = effectiveness; task.QaReviewedById = userId; task.QaReviewedAt = DateTime.UtcNow; task.UpdatedAt = DateTime.UtcNow;
        if (req.Approve) { task.Status = "completed"; task.CompletedById = userId; task.CompletedAt = DateTime.UtcNow; } else task.Status = "open";
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, req.Approve ? PCAR_APPROVED : PCAR_REJECTED, new
        {
            task.TaskId, task.FindingNumber, task.Title, Decision = req.Approve ? "approved" : "returned",
            task.EffectivenessResult, task.QaReviewNotes, VerifiedAt = task.QaReviewedAt,
        });
        await notificationService.NotifyTaskAssigneesAsync(userId, task.TaskId,
            req.Approve ? "PCAR approved and closed" : "PCAR returned for revision",
            req.Approve ? $"Effectiveness: {effectiveness}" : task.QaReviewNotes);
        return Ok(new { success = true, data = new { task.TaskId, task.Status, task.EffectivenessResult } });
    }

    [HttpPost("{id}/complete")]
    public async Task<ActionResult<object>> CompleteTask(Guid id, [FromBody] CompleteTaskRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            var result = await taskService.CompleteTaskAsync(id, userId, req.Comment, pageAccessRole?.CanManageAllTasks == true);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Forbidden" => StatusCode(403, new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error completing task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/tasks/{id} — update the task
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateTask(Guid id, [FromBody] UpdateTaskRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var task = await context.Tasks.AsNoTracking().FirstOrDefaultAsync(t => t.TaskId == id);
            if (task == null)
                return NotFound(new { success = false, error = "Task not found" });

            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            var canManageTask = await taskService.CanManageTaskAsync(task, userId, pageAccessRole?.CanManageAllTasks == true);
            var isReassigning = req.AssignedToId.HasValue || req.AssignedToGroupId.HasValue;
            // CanReassignTasks: any task, own or not. CanReassignMyTasks: only
            // a task this caller is already the assignee/manager of — two
            // independent, separately-grantable flags per explicit request.
            var canReassignAny = pageAccessRole?.CanManageAllTasks == true || pageAccessRole?.CanReassignTasks == true;
            var canReassignMyTasksOnly = pageAccessRole?.CanReassignMyTasks == true;

            if (!canManageTask)
            {
                if (!isReassigning || !canReassignAny)
                    return StatusCode(403, new { success = false, error = "You do not have permission to manage this task" });

                var touchesOtherFields = req.Title != null || req.Description != null || req.DueDate.HasValue
                    || req.RiskSeverity != null || req.Status != null || req.RcaText != null
                    || req.CorrectionText != null || req.PreventiveActions != null || req.TaskType != null
                    || req.Tags != null;
                if (touchesOtherFields)
                    return StatusCode(403, new { success = false, error = "Your reassign-only permission only allows changing who this task is assigned to" });
            }

            // Reassigning to a different user/group is gated on its own,
            // independent flag(s) — separate from the base "can edit this task
            // at all" check above, since a task's own assignee/manager
            // shouldn't automatically be able to hand it off to someone else
            // without CanReassignMyTasks (or the broader CanReassignTasks/
            // CanManageAllTasks, which both already imply it).
            if (isReassigning)
            {
                if (req.AssignedToId.HasValue == req.AssignedToGroupId.HasValue)
                    return BadRequest(new { success = false, error = "Exactly one of assignedToId or assignedToGroupId is required to reassign" });
                var allowedToReassign = canManageTask || canReassignAny || (await taskService.IsAssigneeAsync(task, userId) && canReassignMyTasksOnly);
                if (!allowedToReassign)
                    return StatusCode(403, new { success = false, error = "You do not have permission to reassign tasks" });
                var canUseFullDirectory = pageAccessRole?.CanManageAllTasks == true || pageAccessRole?.CanViewAllTasks == true;
                if (canManageTask && !canUseFullDirectory
                    && !await taskService.CanAssignToTaskScopeAsync(task, userId, req.AssignedToId, req.AssignedToGroupId))
                    return BadRequest(new { success = false, error = "The new assignee must already have access to every file and folder linked to this task" });
            }

            var result = await taskService.UpdateTaskAsync(
                id,
                req.Title,
                req.Description,
                req.DueDate,
                req.RiskSeverity,
                req.Status,
                req.RcaText,
                req.CorrectionText,
                req.PreventiveActions,
                req.AssignedToId,
                req.AssignedToGroupId,
                req.TaskType,
                req.Tags,
                req.AuditStage);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    _ => BadRequest(new { success = false, error = result.Message })
                };
            }

            if (isReassigning)
            {
                var title = req.Title ?? task.Title;
                await auditService.LogAsync(userId, TASK_REASSIGNED, new { TaskId = id, req.AssignedToId, req.AssignedToGroupId });
                var reassignedTask = await context.Tasks.AsNoTracking().FirstAsync(t => t.TaskId == id);
                reassignedTask.Title = title;
                await NotifyTaskAssignmentAsync(reassignedTask, userId, "A task was reassigned to you", "A task was reassigned to your group");
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/tasks/{id} — permanently delete a task. Gated on
    // CanManageAllTasks (same permission that shows the Edit/Delete/Complete
    // action set at all) and, per explicit request, restricted to tasks that
    // are still 'open' — once a task has been submitted, is in progress, or
    // completed, it's already real corrective-action/audit history and
    // should never just disappear; reassign or let it run its course instead.
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteTask(Guid id)
    {
        try
        {
            var userId = GetCurrentUserId();
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (pageAccessRole?.CanDeleteTasks != true)
                return StatusCode(403, new { success = false, error = "You do not have permission to delete tasks" });

            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == id);
            if (task == null)
                return NotFound(new { success = false, error = "Task not found" });

            if (task.Status != "open")
                return BadRequest(new { success = false, error = "Only open tasks can be deleted — this one has already been submitted, is in progress, or is completed" });

            var attachments = await context.TaskAttachments.Where(a => a.TaskId == id).ToListAsync();
            foreach (var attachment in attachments)
            {
                try
                {
                    await minioService.DeleteAsync(attachment.S3ObjectKey);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to delete {ObjectKey} from MinIO while deleting task {TaskId}", attachment.S3ObjectKey, id);
                }
            }

            context.Tasks.Remove(task);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, TASK_DELETED, new { TaskId = id, task.Title });

            logger.LogInformation("Deleted task {TaskId}", id);

            return Ok(new { success = true, message = "Task deleted" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/overdue — overdue tasks
    [HttpGet("overdue/list")]
    public async Task<ActionResult<object>> GetOverdueTasks([FromQuery] int limit = 100)
    {
        try
        {
            var overdue = await taskService.GetOverdueTasksAsync(limit);

            logger.LogInformation("Retrieved {Count} overdue tasks", overdue.Count);

            return Ok(new { success = true, data = overdue, count = overdue.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving overdue tasks");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/document/{documentId} — document's tasks
    [HttpGet("document/{documentId}")]
    public async Task<ActionResult<object>> GetDocumentTasks(Guid documentId)
    {
        try
        {
            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            var tasks = await taskService.GetTasksByDocumentAsync(documentId, userId, CanViewAllTasks(role));

            logger.LogInformation("Retrieved {Count} tasks for document {DocumentId}", tasks.Count, documentId);

            return Ok(new { success = true, data = tasks, count = tasks.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving tasks for document {DocumentId}", documentId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/tasks/{id}/resubmit-for-review — the assignee re-uploaded the
    // corrected file; send the approval batch that spawned this task back to
    // whichever stage (QA or Manager) requested the correction, so it
    // reappears in that reviewer's queue instead of staying stuck.
    // GET /api/tasks/document/{documentId}/pcars — audit findings only.
    [HttpGet("document/{documentId}/pcars")]
    public async Task<ActionResult<object>> GetDocumentPcars(Guid documentId)
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        var pcars = await taskService.GetPcarsByDocumentAsync(documentId, userId, CanViewAllTasks(role));
        return Ok(new { success = true, data = pcars, count = pcars.Count });
    }

    // Folder links are first-class links too: these endpoints let a folder's
    // Related Tasks/PCARs view show the same item for every linked folder.
    [HttpGet("folder/{folderId}")]
    public async Task<ActionResult<object>> GetFolderTasks(Guid folderId)
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        var tasks = await taskService.GetTasksByFolderAsync(folderId, userId, CanViewAllTasks(role));
        return Ok(new { success = true, data = tasks, count = tasks.Count });
    }

    [HttpGet("folder/{folderId}/pcars")]
    public async Task<ActionResult<object>> GetFolderPcars(Guid folderId)
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        var pcars = await taskService.GetTasksByFolderAsync(folderId, userId, CanViewAllTasks(role), pcarsOnly: true);
        return Ok(new { success = true, data = pcars, count = pcars.Count });
    }

    [HttpPost("{id}/resubmit-for-review")]
    public async Task<ActionResult<object>> ResubmitForReview(Guid id)
    {
        try
        {
            var userId = GetCurrentUserId();
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == id);
            if (task == null)
                return NotFound(new { success = false, error = "Task not found" });

            var role = await GetPageAccessRoleAsync(context, userId);
            if (!await taskService.CanManageTaskAsync(task, userId, role?.CanManageAllTasks == true))
                return StatusCode(403, new { success = false, error = "Only the assignee, linked-folder owner, or linked-folder manager can resubmit this task" });

            if (task.ApprovalId == null || task.DocumentId == null)
                return BadRequest(new { success = false, error = "This task is not linked to an approval workflow" });

            // Per-document stage tracking (see 058_approval_document_stage_tracking.sql) —
            // resubmitting only reopens review for the specific document this task was
            // raised against, not every other document that happened to share the batch.
            var approvalDocument = await context.ApprovalDocuments
                .FirstOrDefaultAsync(ad => ad.ApprovalId == task.ApprovalId.Value && ad.DocumentId == task.DocumentId.Value);
            if (approvalDocument == null)
                return NotFound(new { success = false, error = "Linked approval document not found" });

            if (approvalDocument.Status != "correction_requested")
                return BadRequest(new { success = false, error = "This correction has already been resubmitted" });

            if (string.IsNullOrWhiteSpace(task.RcaText) || task.RcaText.Trim().Length < 20)
                return BadRequest(new { success = false, error = "Root cause analysis must contain at least 20 characters before resubmitting" });
            if (string.IsNullOrWhiteSpace(task.CorrectionText) || string.IsNullOrWhiteSpace(task.PreventiveActions) || task.DueDate == null)
                return BadRequest(new { success = false, error = "Complete the immediate correction, preventive action, and target date before resubmitting" });

            // The corrected file was uploaded as a new document version before this
            // call (bumping dms_documents.current_version_id) — but nothing had ever
            // pointed the approval-document row at it, so the reviewer's queue kept
            // showing the stale pre-correction version forever. Re-link it here.
            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == task.DocumentId.Value);
            if (document?.CurrentVersionId != null)
                approvalDocument.VersionId = document.CurrentVersionId.Value;

            approvalDocument.Status = "pending";
            approvalDocument.UpdatedAt = DateTime.UtcNow;
            // "completed" (not "done") is the canonical value TaskService.CompleteTaskAsync
            // and every overdue/status check elsewhere in the app actually compare against —
            // this line previously wrote "done" instead, which no other check recognized.
            task.Status = "completed";
            task.CompletedById = userId;
            task.CompletedAt = DateTime.UtcNow;
            task.UpdatedAt = DateTime.UtcNow;

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, "TASK_CORRECTION_RESUBMITTED", new
            {
                TaskId = id,
                approvalDocument.ApprovalId,
                approvalDocument.DocumentId,
                approvalDocument.CurrentStage,
            });

            var reviewerLabel = approvalDocument.CurrentStage == "manager_review" ? "Manager" : "QA";

            if (task.ManagerId.HasValue)
            {
                await notificationService.NotifyAsync(
                    task.ManagerId.Value,
                    userId,
                    $"Correction resubmitted — back in the {reviewerLabel} queue",
                    task.Title,
                    documentId: task.DocumentId,
                    taskId: task.TaskId);
            }

            // Everyone who can act on this document's current stage — not just
            // the manager who assigned the correction — so the reviewer who's
            // actually blocked on this document finds out it's ready again,
            // instead of only discovering it by happening to reopen the queue.
            var resubmittedDocTitle = document?.Title;
            Func<DmsPageAccessRole, bool> resubmitStageSelector = approvalDocument.CurrentStage == "manager_review"
                ? r => r.CanViewManagerStage
                : r => r.CanViewQaStage;
            await notificationService.NotifyStageReviewersAsync(
                userId,
                task.DocumentId!.Value,
                $"A corrected document is back in the {reviewerLabel} queue",
                resubmittedDocTitle,
                resubmitStageSelector,
                folderManagersOnly: approvalDocument.CurrentStage == "manager_review");

            return Ok(new
            {
                success = true,
                data = new { approvalDocument.ApprovalId, approvalDocument.CurrentStage, ApprovalStatus = approvalDocument.Status, task.TaskId, TaskStatus = task.Status },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error resubmitting task {TaskId} for review", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/tasks/{id}/attachments — attach a file to a task
    [HttpPost("{id}/attachments")]
    public async Task<ActionResult<object>> UploadAttachment(Guid id, IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "File is required" });

            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == id);
            if (task == null)
                return NotFound(new { success = false, error = "Task not found" });

            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            if (!await taskService.CanManageTaskAsync(task, userId, role?.CanManageAllTasks == true))
                return StatusCode(403, new { success = false, error = "You do not have permission to add evidence to this task" });
            var attachment = new DmsTaskAttachment
            {
                AttachmentId = Guid.NewGuid(),
                TaskId = id,
                FileName = file.FileName,
                FileSizeBytes = file.Length,
                MimeType = file.ContentType,
                UploadedBy = userId,
                CreatedAt = DateTime.UtcNow,
            };

            var objectKey = $"tasks/{id}/{attachment.AttachmentId}/{file.FileName}";
            await minioService.UploadAsync(objectKey, file.OpenReadStream(), file.ContentType ?? "application/octet-stream");
            attachment.S3ObjectKey = objectKey;

            context.TaskAttachments.Add(attachment);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, TASK_ATTACHMENT_UPLOADED, new { TaskId = id, attachment.AttachmentId, attachment.FileName });

            return Ok(new
            {
                success = true,
                data = new { attachment.AttachmentId, attachment.FileName, attachment.FileSizeBytes, attachment.MimeType, attachment.CreatedAt },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error uploading attachment to task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/{id}/attachments — list attachments on a task
    [HttpGet("{id}/attachments")]
    public async Task<ActionResult<object>> GetAttachments(Guid id)
    {
        try
        {
            var task = await context.Tasks.AsNoTracking().FirstOrDefaultAsync(item => item.TaskId == id);
            if (task == null) return NotFound(new { success = false, error = "Task not found" });
            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            if (!await taskService.CanViewTaskAsync(task, userId, CanViewAllTasks(role)))
                return StatusCode(403, new { success = false, error = "You do not have permission to view this task" });
            var attachments = await context.TaskAttachments
                .Where(a => a.TaskId == id)
                .Include(a => a.UploadedByUser)
                .OrderByDescending(a => a.CreatedAt)
                .Select(a => new
                {
                    a.AttachmentId,
                    a.FileName,
                    a.FileSizeBytes,
                    a.MimeType,
                    a.CreatedAt,
                    UploadedByName = a.UploadedByUser!.FullName,
                })
                .ToListAsync();

            return Ok(new { success = true, data = attachments, count = attachments.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving attachments for task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/{id}/attachments/{attachmentId}/download
    [HttpGet("{id}/attachments/{attachmentId}/download")]
    public async Task<ActionResult> DownloadAttachment(Guid id, Guid attachmentId)
    {
        try
        {
            var attachment = await context.TaskAttachments.FirstOrDefaultAsync(a => a.AttachmentId == attachmentId && a.TaskId == id);
            if (attachment == null)
                return NotFound(new { success = false, error = "Attachment not found" });
            var task = await context.Tasks.AsNoTracking().FirstOrDefaultAsync(item => item.TaskId == id);
            if (task == null) return NotFound(new { success = false, error = "Task not found" });
            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            if (!await taskService.CanViewTaskAsync(task, userId, CanViewAllTasks(role)))
                return StatusCode(403, new { success = false, error = "You do not have permission to view this task" });

            var stream = await minioService.DownloadAsync(attachment.S3ObjectKey);
            return File(stream, attachment.MimeType ?? "application/octet-stream", attachment.FileName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error downloading attachment {AttachmentId}", attachmentId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/tasks/{id}/attachments/{attachmentId}
    [HttpDelete("{id}/attachments/{attachmentId}")]
    public async Task<ActionResult<object>> DeleteAttachment(Guid id, Guid attachmentId)
    {
        try
        {
            var attachment = await context.TaskAttachments.FirstOrDefaultAsync(a => a.AttachmentId == attachmentId && a.TaskId == id);
            if (attachment == null)
                return NotFound(new { success = false, error = "Attachment not found" });
            var task = await context.Tasks.AsNoTracking().FirstOrDefaultAsync(item => item.TaskId == id);
            if (task == null) return NotFound(new { success = false, error = "Task not found" });
            var userId = GetCurrentUserId();
            var role = await GetPageAccessRoleAsync(context, userId);
            if (!await taskService.CanManageTaskAsync(task, userId, role?.CanManageAllTasks == true))
                return StatusCode(403, new { success = false, error = "You do not have permission to remove evidence from this task" });

            try
            {
                await minioService.DeleteAsync(attachment.S3ObjectKey);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to delete {ObjectKey} from MinIO", attachment.S3ObjectKey);
            }

            context.TaskAttachments.Remove(attachment);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, TASK_ATTACHMENT_DELETED, new { TaskId = id, AttachmentId = attachmentId, attachment.FileName });

            return Ok(new { success = true, message = "Attachment deleted" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting attachment {AttachmentId}", attachmentId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateTaskRequest(
    Guid? DocumentId,
    string Title,
    Guid? AssignedToId = null,
    Guid? AssignedToGroupId = null,
    string? Description = null,
    string? TaskType = null,
    string? RiskSeverity = null,
    DateTime? DueDate = null,
    string[]? Tags = null,
    Guid? FolderId = null,
    string? AuditStage = null,
    string? FindingSeverity = null,
    string? StandardClause = null,
    string? AuditorNotes = null
    , Guid[]? DocumentIds = null, Guid[]? FolderIds = null, Guid? DirectManagerId = null
);

public record SubmitPcarRequest(string? Rca, string? Correction, string? PreventiveActions, DateTime TargetDate, string[]? Tags = null);
public record VerifyPcarRequest(bool Approve, string? Notes = null, string? Effectiveness = null);

public record UpdateTaskRequest(
    string? Title = null,
    string? Description = null,
    DateTime? DueDate = null,
    string? RiskSeverity = null,
    string? Status = null,
    string? RcaText = null,
    string? CorrectionText = null,
    string? PreventiveActions = null,
    Guid? AssignedToId = null,
    Guid? AssignedToGroupId = null,
    string? TaskType = null,
    string[]? Tags = null,
    string? AuditStage = null
);

public record CompleteTaskRequest(
    string? Comment = null
);
