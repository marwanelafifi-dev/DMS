using DMS.Api.Services;
using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuditCalendarController(AuditCalendarService auditCalendarService, DMS.Api.Data.DmsContext context, ILogger<AuditCalendarController> logger) : BaseController
{
    private static readonly string[] OptionalStageKeys = ["evidence_deadline", "pcar_closure", "external_response", "cycle_closure"];
    // GET /api/auditcalendar — all audit calendar events, visible to all users
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

    [HttpGet("cycles/{cycleId:guid}/removed-stages")]
    public async Task<ActionResult<object>> GetRemovedStages(Guid cycleId)
    {
        if ((await GetPageAccessRoleAsync(context, GetCurrentUserId()))?.CanViewAdminPanel != true) return Forbid();
        var stages = await context.AuditCycleStageExclusions.AsNoTracking()
            .Where(exclusion => exclusion.AuditCycleId == cycleId)
            .OrderBy(exclusion => exclusion.StageKey)
            .Select(exclusion => new { exclusion.StageKey, exclusion.RemovedAt, exclusion.RemovedBy })
            .ToListAsync();
        return Ok(new { success = true, data = stages });
    }

    [HttpPost("cycles/{cycleId:guid}/stages/{stageKey}/remove")]
    public async Task<ActionResult<object>> RemoveOptionalStage(Guid cycleId, string stageKey)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanViewAdminPanel != true) return Forbid();
        if (!OptionalStageKeys.Contains(stageKey)) return BadRequest(new { success = false, error = "This is a required stage and cannot be removed" });
        if (!await context.AuditCycles.AnyAsync(cycle => cycle.AuditCycleId == cycleId)) return NotFound();

        var exclusion = await context.AuditCycleStageExclusions.FindAsync(cycleId, stageKey);
        if (exclusion == null)
        {
            context.AuditCycleStageExclusions.Add(new DmsAuditCycleStageExclusion { AuditCycleId = cycleId, StageKey = stageKey, RemovedBy = userId, RemovedAt = DateTime.UtcNow });
            await context.SaveChangesAsync();
        }
        return Ok(new { success = true, data = new { stageKey } });
    }

    [HttpPost("cycles/{cycleId:guid}/stages/{stageKey}/restore")]
    public async Task<ActionResult<object>> RestoreOptionalStage(Guid cycleId, string stageKey)
    {
        if ((await GetPageAccessRoleAsync(context, GetCurrentUserId()))?.CanViewAdminPanel != true) return Forbid();
        if (!OptionalStageKeys.Contains(stageKey)) return BadRequest(new { success = false, error = "This is a required stage and cannot be restored" });
        var exclusion = await context.AuditCycleStageExclusions.FindAsync(cycleId, stageKey);
        if (exclusion != null) { context.AuditCycleStageExclusions.Remove(exclusion); await context.SaveChangesAsync(); }
        return Ok(new { success = true, data = new { stageKey } });
    }

    // POST /api/auditcalendar — publish a new event
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
            if ((await GetPageAccessRoleAsync(context, userId))?.CanViewAdminPanel != true) return Forbid();
            var result = await auditCalendarService.CreateAsync(req.Title, req.Phase, req.Standard, req.EventDate, req.Notes, userId, req.ProgrammeYear, req.StageKey, req.Status, req.OwnerId, req.DueDate, req.AuditCycleId);

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

    // DELETE /api/auditcalendar/{id} — remove event
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteEvent(Guid id)
    {
        try
        {
            if ((await GetPageAccessRoleAsync(context, GetCurrentUserId()))?.CanViewAdminPanel != true) return Forbid();
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

public record CreateAuditCalendarEventRequest(string Title, string Phase, string Standard, DateOnly EventDate, string? Notes = null, int? ProgrammeYear = null, string? StageKey = null, string? Status = null, Guid? OwnerId = null, DateOnly? DueDate = null, Guid? AuditCycleId = null);
