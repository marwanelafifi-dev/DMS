using DMS.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuditTrailsController(DmsContext context) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetAuditTrails(
        [FromQuery] Guid? userId,
        [FromQuery] string? action,
        [FromQuery] DateTime? fromDate,
        [FromQuery] int limit = 100)
    {
        var query = context.AuditTrails.AsQueryable();

        if (userId.HasValue)
            query = query.Where(a => a.UserId == userId);

        if (!string.IsNullOrEmpty(action))
            query = query.Where(a => a.Action == action);

        if (fromDate.HasValue)
            query = query.Where(a => a.CreatedAt >= fromDate);

        var trails = await query
            .OrderByDescending(a => a.CreatedAt)
            .Take(limit)
            .Select(a => new
            {
                a.LogId,
                a.UserId,
                a.Action,
                a.Metadata,
                a.CreatedAt
            })
            .ToListAsync();

        return Ok(trails);
    }

    [HttpPost]
    public async Task<ActionResult<object>> LogAction(LogActionRequest req)
    {
        var trail = new DMS.Api.Models.DmsAuditTrail
        {
            LogId = Guid.NewGuid(),
            UserId = req.UserId,
            Action = req.Action,
            Metadata = req.Metadata,
            CreatedAt = DateTime.UtcNow
        };

        context.AuditTrails.Add(trail);
        await context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetAuditTrails), new { }, new
        {
            trail.LogId,
            trail.Action,
            trail.CreatedAt
        });
    }
}

public record LogActionRequest(Guid UserId, string Action, string? Metadata = null);
