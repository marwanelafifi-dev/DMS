using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TasksController(DmsContext context, TaskService taskService, MinioService minioService, AuditService auditService, NotificationService notificationService, AccessOverrideService accessOverrideService, ILogger<TasksController> logger) : BaseController
{
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
            var result = await taskService.GetMyTasksAsync(userId, status, page, pageSize);

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

            logger.LogInformation("Retrieved task {TaskId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    task.TaskId,
                    task.DocumentId,
                    task.ApprovalId,
                    Document = task.Document == null ? null : new { task.Document.DocumentId, task.Document.Title },
                    task.Title,
                    task.Description,
                    task.Tags,
                    task.TaskType,
                    task.RiskSeverity,
                    AssignedTo = task.AssignedTo == null ? null : new { task.AssignedTo.UserId, task.AssignedTo.FullName, task.AssignedTo.Email },
                    AssignedToGroup = task.AssignedToGroup == null ? null : new { task.AssignedToGroup.GroupId, task.AssignedToGroup.Name },
                    task.DueDate,
                    task.Status,
                    task.RcaText,
                    task.CorrectionText,
                    task.PreventiveActions,
                    task.QaReviewNotes,
                    task.QaReviewedAt,
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

            var isOwnTask = await taskService.IsAssigneeAsync(task, userId) || task.ManagerId == userId;
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (!isOwnTask && pageAccessRole?.CanManageAllTasks != true)
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
            var result = await taskService.SubmitPcarAsync(id, userId, req.Rca ?? "", req.Correction ?? "", req.PreventiveActions ?? "", req.TargetDate, req.Tags);

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

            // Tasks aren't folder-scoped, so there's no per-folder grant to
            // check here — anyone who can see the PCAR page can self-file a
            // PCAR (assign it to themselves). Assigning it to someone ELSE, or
            // to a Group (the "New PCAR" form lets you pick either), needs
            // either the dedicated CanCreateTasks flag or the broader
            // CanManageAllTasks flag (which already implies it).
            var assigningToSelf = req.AssignedToId == managerId && req.AssignedToGroupId == null;
            if (!assigningToSelf)
            {
                var pageAccessRole = await GetPageAccessRoleAsync(context, managerId);
                if (pageAccessRole?.CanCreateTasks != true && pageAccessRole?.CanManageAllTasks != true)
                    return StatusCode(403, new { success = false, error = "You can only create a PCAR assigned to yourself" });
            }

            var result = await taskService.CreateTaskAsync(
                managerId,
                req.DocumentId,
                req.AssignedToId,
                req.AssignedToGroupId,
                req.Title,
                req.Description,
                req.TaskType,
                req.RiskSeverity,
                req.DueDate,
                req.Tags);

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

            if (req.AssignedToId.HasValue)
            {
                await notificationService.NotifyAsync(req.AssignedToId.Value, managerId, "New task assigned to you", req.Title, taskId: result.ResourceId.Value);
            }
            else if (req.AssignedToGroupId.HasValue)
            {
                foreach (var memberId in await taskService.GetGroupMemberIdsAsync(req.AssignedToGroupId.Value))
                    await notificationService.NotifyAsync(memberId, managerId, "New task assigned to your group", req.Title, taskId: result.ResourceId.Value);
            }

            return CreatedAtAction(nameof(GetTask), new { id = result.ResourceId.Value }, new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating task");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/tasks/{id}/complete — close the task
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

            // The assignee can work their own PCAR (fill in RCA, submit for
            // approval) and the manager/QA who created it can track/adjust it,
            // same as GetMyTasksAsync's visibility rule — anyone else needs
            // the blanket CanManageAllTasks flag (Admin-equivalent), OR
            // CanReassignTasks on its own, but only to touch the assignment
            // fields on someone else's task, nothing more.
            var isOwnTask = await taskService.IsAssigneeAsync(task, userId) || task.ManagerId == userId;
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            var isReassigning = req.AssignedToId.HasValue || req.AssignedToGroupId.HasValue;
            // CanReassignTasks: any task, own or not. CanReassignMyTasks: only
            // a task this caller is already the assignee/manager of — two
            // independent, separately-grantable flags per explicit request.
            var canReassignAny = pageAccessRole?.CanManageAllTasks == true || pageAccessRole?.CanReassignTasks == true;
            var canReassignMyTasksOnly = pageAccessRole?.CanReassignMyTasks == true;

            if (!isOwnTask && pageAccessRole?.CanManageAllTasks != true)
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
                var allowedToReassign = canReassignAny || (isOwnTask && canReassignMyTasksOnly);
                if (!allowedToReassign)
                    return StatusCode(403, new { success = false, error = "You do not have permission to reassign tasks" });
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
                req.Tags);

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
                if (req.AssignedToId.HasValue)
                    await notificationService.NotifyAsync(req.AssignedToId.Value, userId, "A task was reassigned to you", title, taskId: id);
                else if (req.AssignedToGroupId.HasValue)
                    foreach (var memberId in await taskService.GetGroupMemberIdsAsync(req.AssignedToGroupId.Value))
                        await notificationService.NotifyAsync(memberId, userId, "A task was reassigned to your group", title, taskId: id);
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
            if (pageAccessRole?.CanManageAllTasks != true)
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
            var tasks = await taskService.GetTasksByDocumentAsync(documentId);

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
    [HttpPost("{id}/resubmit-for-review")]
    public async Task<ActionResult<object>> ResubmitForReview(Guid id)
    {
        try
        {
            var userId = GetCurrentUserId();
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == id);
            if (task == null)
                return NotFound(new { success = false, error = "Task not found" });

            if (!await taskService.IsAssigneeAsync(task, userId))
                return StatusCode(403, new { success = false, error = "Only the assignee can resubmit this task" });

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
                resubmitStageSelector);

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

            await auditService.LogAsync(GetCurrentUserId(), TASK_ATTACHMENT_DELETED, new { TaskId = id, AttachmentId = attachmentId, attachment.FileName });

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
    Guid DocumentId,
    string Title,
    Guid? AssignedToId = null,
    Guid? AssignedToGroupId = null,
    string? Description = null,
    string? TaskType = null,
    string? RiskSeverity = null,
    DateTime? DueDate = null,
    string[]? Tags = null
);

public record SubmitPcarRequest(string? Rca, string? Correction, string? PreventiveActions, DateTime TargetDate, string[]? Tags = null);

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
    string[]? Tags = null
);

public record CompleteTaskRequest(
    string? Comment = null
);
