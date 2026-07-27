using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuditCalendarController(AuditCalendarService auditCalendarService, ILogger<AuditCalendarController> logger) : BaseController
{
    // GET /api/auditcalendar — كل أحداث تقويم التدقيق، مرئية لجميع المستخدمين
    [HttpGet]
    public async Task<ActionResult<object>> GetEvents()
    {
        try
        {
            var events = await auditCalendarService.GetAllAsync();
            return Ok(new { success = true, data = events, count = events.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving audit calendar events");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/auditcalendar — نشر حدث جديد
    //
    // NOTE: DmsUser has no global role column (see Session 5 in CLAUDE.md — role
    // only exists per-folder via dms_folder_permissions). This endpoint currently
    // only requires an authenticated, active user (enforced by RBACMiddleware),
    // same as other non-folder-scoped writes in this API. The frontend's
    // Admin/QA-only "New Audit Event" button is a UI convenience, not a security
    // boundary — tighten this once a real global-role model exists.
    [HttpPost]
    public async Task<ActionResult<object>> CreateEvent([FromBody] CreateAuditCalendarEventRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var result = await auditCalendarService.CreateAsync(req.Title, req.Phase, req.Standard, req.EventDate, req.Notes, userId);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message }),
                };
            }

            return CreatedAtAction(nameof(GetEvents), new { }, new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating audit calendar event");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/auditcalendar/{id} — إزالة حدث
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteEvent(Guid id)
    {
        try
        {
            var result = await auditCalendarService.DeleteAsync(id, GetCurrentUserId());

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message }),
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting audit calendar event {EventId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateAuditCalendarEventRequest(string Title, string Phase, string Standard, DateOnly EventDate, string? Notes = null);
