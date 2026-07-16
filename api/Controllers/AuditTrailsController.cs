using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuditTrailsController(DmsContext context, AuditService auditService, ILogger<AuditTrailsController> logger) : BaseController
{
    // GET /api/audittrails — قائمة جميع السجلات
    [HttpGet]
    public async Task<ActionResult<object>> GetAuditTrails([FromQuery] Guid? userId, [FromQuery] string? action, [FromQuery] int limit = 100)
    {
        try
        {
            var trails = await auditService.GetAuditTrailAsync(userId, action, limit);

            logger.LogInformation("Retrieved {Count} audit trails", trails.Count);

            return Ok(new { success = true, data = trails, count = trails.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving audit trails");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/audittrails/{logId} — تفاصيل سجل واحد
    [HttpGet("{logId}")]
    public async Task<ActionResult<object>> GetAuditTrail(Guid logId)
    {
        try
        {
            var trail = await context.AuditTrails
                .FirstOrDefaultAsync(a => a.LogId == logId);

            if (trail == null)
                return NotFound(new { success = false, error = "السجل غير موجود" });

            logger.LogInformation("Retrieved audit trail {LogId}", logId);

            return Ok(new
            {
                success = true,
                data = new
                {
                    trail.LogId,
                    trail.UserId,
                    trail.Action,
                    trail.Metadata,
                    trail.CreatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving audit trail {LogId}", logId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/audittrails/user/{userId} — سجلات مستخدم معين
    [HttpGet("user/{userId}")]
    public async Task<ActionResult<object>> GetUserAuditTrails(Guid userId, [FromQuery] int limit = 100)
    {
        try
        {
            // التحقق من وجود المستخدم
            var userExists = await context.Users.AnyAsync(u => u.UserId == userId);
            if (!userExists)
                return NotFound(new { success = false, error = "المستخدم غير موجود" });

            var trails = await auditService.GetAuditTrailAsync(userId, null, limit);

            logger.LogInformation("Retrieved {Count} audit trails for user {UserId}", trails.Count, userId);

            return Ok(new { success = true, data = trails, count = trails.Count, userId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving audit trails for user {UserId}", userId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/audittrails/action/{action} — سجلات فعل معين
    [HttpGet("action/{action}")]
    public async Task<ActionResult<object>> GetActionAuditTrails(string action, [FromQuery] int limit = 100)
    {
        try
        {
            if (string.IsNullOrEmpty(action))
                return BadRequest(new { success = false, error = "اسم الفعل مطلوب" });

            var trails = await auditService.GetAuditTrailAsync(null, action, limit);

            logger.LogInformation("Retrieved {Count} audit trails for action {Action}", trails.Count, action);

            return Ok(new { success = true, data = trails, count = trails.Count, action });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving audit trails for action {Action}", action);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}
