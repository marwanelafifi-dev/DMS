using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class TaskService(DmsContext context, AuditService auditService, ILogger<TaskService> logger)
{
    public async Task<TaskResult> CreateTaskAsync(Guid managerId, Guid documentId, Guid assignedToId, string title, string? description = null, string? taskType = null, string? riskSeverity = null, DateTime? dueDate = null)
    {
        try
        {
            var document = await context.Documents.FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document == null)
                return TaskResult.NotFound("Document not found");

            var assignee = await context.Users.FirstOrDefaultAsync(u => u.UserId == assignedToId && u.IsActive);
            if (assignee == null)
                return TaskResult.NotFound("Assignee not found or inactive");

            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                DocumentId = documentId,
                Title = title.Trim(),
                Description = description?.Trim(),
                TaskType = taskType ?? "correction",
                RiskSeverity = riskSeverity ?? "medium",
                AssignedToId = assignedToId,
                ManagerId = managerId,
                DueDate = dueDate,
                Status = "open",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.Tasks.Add(task);
            await context.SaveChangesAsync();

            logger.LogInformation("Created task {TaskId} for document {DocumentId}", task.TaskId, documentId);

            return TaskResult.Ok(new
            {
                task.TaskId,
                task.DocumentId,
                task.Title,
                task.AssignedToId,
                task.ManagerId,
                AssignedToName = assignee.FullName,
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

    public async Task<(List<object> Items, int TotalCount)> GetMyTasksAsync(Guid userId, string? status = null, int page = 1, int pageSize = 100)
    {
        try
        {
            // A manager must be able to track work they delegated, while the
            // assignee still sees the same task in their personal queue.
            var query = context.Tasks.Where(t => t.AssignedToId == userId || t.ManagerId == userId);

            if (!string.IsNullOrEmpty(status))
                query = query.Where(t => t.Status == status);

            var today = DateTime.UtcNow.Date;
            var totalCount = await query.CountAsync();

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
                    Document = t.Document == null ? null : new { t.Document.DocumentId, t.Document.Title },
                    t.Title,
                    t.Description,
                    t.TaskType,
                    t.RiskSeverity,
                    Priority = t.RiskSeverity ?? "medium",
                    t.AssignedToId,
                    t.ManagerId,
                    t.DueDate,
                    t.Status,
                    IsOverdue = t.DueDate.HasValue && t.DueDate < today && t.Status != "completed",
                    t.CreatedAt
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

    public async Task<TaskResult> CompleteTaskAsync(Guid taskId, Guid userId, string? comment = null)
    {
        try
        {
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == taskId);

            if (task == null)
                return TaskResult.NotFound("Task not found");

            if (task.AssignedToId != userId)
                return TaskResult.Forbidden("Only assigned user can complete this task");

            if (task.Status == "completed")
                return TaskResult.Invalid("Task is already completed");

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

    public async Task<TaskResult> UpdateTaskAsync(Guid taskId, string? title = null, string? description = null, DateTime? dueDate = null, string? riskSeverity = null, string? status = null, string? rca = null, string? preventiveActions = null)
    {
        try
        {
            var task = await context.Tasks.FirstOrDefaultAsync(t => t.TaskId == taskId);

            if (task == null)
                return TaskResult.NotFound("Task not found");

            if (!string.IsNullOrWhiteSpace(title))
                task.Title = title.Trim();

            if (description != null)
                task.Description = description.Trim();

            if (dueDate.HasValue)
                task.DueDate = dueDate;

            if (!string.IsNullOrWhiteSpace(riskSeverity))
                task.RiskSeverity = riskSeverity.Trim().ToLowerInvariant();

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
                task.DueDate,
                task.Status,
                task.UpdatedAt
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating task {TaskId}", taskId);
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
                    t.Title,
                    AssignedTo = t.AssignedTo == null ? null : new { t.AssignedTo.UserId, t.AssignedTo.FullName, t.AssignedTo.Email },
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

    public async Task<List<object>> GetTasksByDocumentAsync(Guid documentId)
    {
        try
        {
            var tasks = await context.Tasks
                .Where(t => t.DocumentId == documentId)
                .OrderByDescending(t => t.CreatedAt)
                .Select(t => new
                {
                    t.TaskId,
                    t.Title,
                    t.Description,
                    t.TaskType,
                    AssignedTo = t.AssignedTo == null ? null : new { t.AssignedTo.UserId, t.AssignedTo.FullName },
                    t.DueDate,
                    t.Status,
                    t.CreatedAt,
                    CompletedAt = t.CompletedAt
                })
                .ToListAsync();

            return tasks.Cast<object>().ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting tasks for document {DocumentId}", documentId);
            return new List<object>();
        }
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
