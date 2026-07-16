using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TasksController(DmsContext context, TaskService taskService, ILogger<TasksController> logger) : BaseController
{
    // GET /api/tasks — مهامي
    [HttpGet]
    public async Task<ActionResult<object>> GetMyTasks([FromQuery] string? status, [FromQuery] int limit = 100)
    {
        try
        {
            var userId = GetCurrentUserId();
            var tasks = await taskService.GetMyTasksAsync(userId, status, limit);

            logger.LogInformation("Retrieved {Count} tasks for user {UserId}", tasks.Count, userId);

            return Ok(new { success = true, data = tasks, count = tasks.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving tasks");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/{id} — تفاصيل مهمة
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetTask(Guid id)
    {
        try
        {
            var task = await context.Tasks
                .Include(t => t.AssignedTo)
                .Include(t => t.Document)
                .FirstOrDefaultAsync(t => t.TaskId == id);

            if (task == null)
                return NotFound(new { success = false, error = "المهمة غير موجودة" });

            logger.LogInformation("Retrieved task {TaskId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    task.TaskId,
                    task.DocumentId,
                    Document = task.Document == null ? null : new { task.Document.DocumentId, task.Document.Title },
                    task.Title,
                    task.Description,
                    task.TaskType,
                    task.RiskSeverity,
                    AssignedTo = task.AssignedTo == null ? null : new { task.AssignedTo.UserId, task.AssignedTo.FullName, task.AssignedTo.Email },
                    task.DueDate,
                    task.Status,
                    task.RcaText,
                    task.PreventiveActions,
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

    // POST /api/tasks — إنشاء مهمة جديدة
    [HttpPost]
    public async Task<ActionResult<object>> CreateTask([FromBody] CreateTaskRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Title))
                return BadRequest(new { success = false, error = "العنوان مطلوب" });

            var result = await taskService.CreateTaskAsync(
                req.DocumentId,
                req.AssignedToId,
                req.Title,
                req.Description,
                req.TaskType,
                req.DueDate);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    _ => BadRequest(new { success = false, error = result.Message })
                };
            }

            return CreatedAtAction(nameof(GetTask), new { id = ((dynamic)result.Data!).taskId }, new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating task");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/tasks/{id}/complete — إغلاق المهمة
    [HttpPost("{id}/complete")]
    public async Task<ActionResult<object>> CompleteTask(Guid id, [FromBody] CompleteTaskRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var result = await taskService.CompleteTaskAsync(id, userId, req.Comment);

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

    // PUT /api/tasks/{id} — تحديث المهمة
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateTask(Guid id, [FromBody] UpdateTaskRequest req)
    {
        try
        {
            var result = await taskService.UpdateTaskAsync(
                id,
                req.Title,
                req.Description,
                req.DueDate,
                req.RcaText,
                req.PreventiveActions);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    _ => BadRequest(new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating task {TaskId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/tasks/overdue — المهام المتأخرة
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

    // GET /api/tasks/document/{documentId} — مهام المستند
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
}

public record CreateTaskRequest(
    Guid DocumentId,
    Guid AssignedToId,
    string Title,
    string? Description = null,
    string? TaskType = null,
    DateTime? DueDate = null
);

public record UpdateTaskRequest(
    string? Title = null,
    string? Description = null,
    DateTime? DueDate = null,
    string? RcaText = null,
    string? PreventiveActions = null
);

public record CompleteTaskRequest(
    string? Comment = null
);
