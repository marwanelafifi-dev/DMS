using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/management-review")]
public class ManagementReviewController(DmsContext context, AccessOverrideService accessOverrideService) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> List([FromQuery] Guid? auditCycleId = null, [FromQuery] string? standard = null)
    {
        var query = context.ManagementReviewEntries.AsNoTracking().AsQueryable();
        if (auditCycleId.HasValue) query = query.Where(e => e.AuditCycleId == auditCycleId);
        if (!string.IsNullOrWhiteSpace(standard)) query = query.Where(e => e.Standard == standard);
        var entries = await query.OrderBy(e => e.Category).ThenBy(e => e.DueDate).Select(e => new { e.ManagementReviewEntryId, e.AuditCycleId, e.Standard, e.Category, e.Title, e.Detail, e.Status, e.OwnerId, OwnerName = e.OwnerId == null ? null : context.Users.Where(u => u.UserId == e.OwnerId).Select(u => u.FullName).FirstOrDefault(), e.DueDate, e.SourceDocumentId, e.CreatedAt, e.UpdatedAt }).ToListAsync();
        return Ok(new { success = true, data = entries });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] ManagementReviewRequest request)
    {
        var userId = GetCurrentUserId(); if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        var error = await Validate(request, userId); if (error != null) return BadRequest(new { success = false, error });
        var entry = new DmsManagementReviewEntry { ManagementReviewEntryId = Guid.NewGuid(), AuditCycleId = request.AuditCycleId, Standard = request.Standard, Category = request.Category, Title = request.Title.Trim(), Detail = Clean(request.Detail), Status = request.Status, OwnerId = request.OwnerId, DueDate = request.DueDate, SourceDocumentId = request.SourceDocumentId, CreatedBy = userId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        context.ManagementReviewEntries.Add(entry); await context.SaveChangesAsync(); return Ok(new { success = true, data = entry });
    }
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<object>> Update(Guid id, [FromBody] ManagementReviewRequest request)
    {
        var userId = GetCurrentUserId(); if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        var error = await Validate(request, userId); if (error != null) return BadRequest(new { success = false, error }); var entry = await context.ManagementReviewEntries.FindAsync(id); if (entry == null) return NotFound();
        entry.AuditCycleId = request.AuditCycleId; entry.Standard = request.Standard; entry.Category = request.Category; entry.Title = request.Title.Trim(); entry.Detail = Clean(request.Detail); entry.Status = request.Status; entry.OwnerId = request.OwnerId; entry.DueDate = request.DueDate; entry.SourceDocumentId = request.SourceDocumentId; entry.UpdatedAt = DateTime.UtcNow; await context.SaveChangesAsync(); return Ok(new { success = true, data = entry });
    }
    private async Task<string?> Validate(ManagementReviewRequest r, Guid userId) { if (string.IsNullOrWhiteSpace(r.Title) || r.Standard is not ("ISO 9001:2015" or "ISO 27001:2022") || r.Category is not ("kpi" or "risk" or "customer_feedback" or "supplier_performance" or "action") || r.Status is not ("open" or "in_progress" or "closed")) return "Enter a title and valid standard, category, and status"; if (!await context.AuditCycles.AnyAsync(c => c.AuditCycleId == r.AuditCycleId && c.Standard == r.Standard)) return "The selected cycle does not match the selected standard"; if (r.SourceDocumentId.HasValue) { var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == r.SourceDocumentId); if (document == null || !await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId)) return "Select a source document you can access"; } return null; }
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
public record ManagementReviewRequest(Guid AuditCycleId, string Standard, string Category, string Title, string Status = "open", string? Detail = null, Guid? OwnerId = null, DateOnly? DueDate = null, Guid? SourceDocumentId = null);
