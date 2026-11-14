using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/audits")]
public class AuditRecordsController(DmsContext context, AccessOverrideService accessOverrideService) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> List([FromQuery] string? standard = null, [FromQuery] Guid? auditCycleId = null)
    {
        var query = context.AuditRecords.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(standard)) query = query.Where(a => a.Standard == standard);
        if (auditCycleId.HasValue) query = query.Where(a => a.AuditCycleId == auditCycleId.Value);
        var records = await query.OrderByDescending(a => a.AuditDate).Select(a => new
        {
            a.AuditRecordId, a.AuditCycleId, a.Standard, a.Title, a.AuditType, a.Status, a.AuditDate, a.Scope, a.Departments, a.AuditTeam,
            a.AuditPlanReference, a.AuditReportReference, a.AuditPlanDocumentId, a.AuditReportDocumentId, a.Notes, a.AuditTeamUserIds, a.ParticipantUserIds, a.CreatedAt, a.UpdatedAt,
            OpenPcars = context.Tasks.Count(t => t.AuditRecordId == a.AuditRecordId && t.TaskType == "pcar" && t.Status != "completed" && t.Status != "done"),
        }).ToListAsync();
        return Ok(new { success = true, data = records });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] AuditRecordRequest request)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        var error = await Validate(request, userId); if (error != null) return BadRequest(new { success = false, error });
        var teamResult = await ResolveTeam(request.AuditTeamUserIds); var participantResult = await ResolveTeam(request.ParticipantUserIds); if (teamResult.Error != null || participantResult.Error != null) return BadRequest(new { success = false, error = teamResult.Error ?? participantResult.Error }); var team = teamResult.Team; var participants = participantResult.Team;
        var record = new DmsAuditRecord { AuditRecordId = Guid.NewGuid(), AuditCycleId = request.AuditCycleId, Standard = request.Standard, Title = request.Title.Trim(), AuditType = request.AuditType, Status = request.Status, AuditDate = request.AuditDate, Scope = request.Scope.Trim(), Departments = Clean(request.Departments), AuditTeam = team.Names, AuditTeamUserIds = team.Ids, ParticipantUserIds = participants.Ids, AuditPlanReference = CleanText(request.AuditPlanReference), AuditReportReference = CleanText(request.AuditReportReference), AuditPlanDocumentId = request.AuditPlanDocumentId, AuditReportDocumentId = request.AuditReportDocumentId, Notes = CleanText(request.Notes), CreatedBy = userId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        context.AuditRecords.Add(record);
        await SyncJourneyStageAsync(record, userId);
        await context.SaveChangesAsync();
        return Ok(new { success = true, data = record });
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<object>> Update(Guid id, [FromBody] AuditRecordRequest request)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        var record = await context.AuditRecords.FindAsync(id); if (record == null) return NotFound();
        var error = await Validate(request, userId); if (error != null) return BadRequest(new { success = false, error });
        var teamResult = await ResolveTeam(request.AuditTeamUserIds); var participantResult = await ResolveTeam(request.ParticipantUserIds); if (teamResult.Error != null || participantResult.Error != null) return BadRequest(new { success = false, error = teamResult.Error ?? participantResult.Error }); var team = teamResult.Team; var participants = participantResult.Team;
        record.AuditCycleId = request.AuditCycleId; record.Standard = request.Standard; record.Title = request.Title.Trim(); record.AuditType = request.AuditType; record.Status = request.Status; record.AuditDate = request.AuditDate; record.Scope = request.Scope.Trim(); record.Departments = Clean(request.Departments); record.AuditTeam = team.Names; record.AuditTeamUserIds = team.Ids; record.ParticipantUserIds = participants.Ids; record.AuditPlanReference = CleanText(request.AuditPlanReference); record.AuditReportReference = CleanText(request.AuditReportReference); record.AuditPlanDocumentId = request.AuditPlanDocumentId; record.AuditReportDocumentId = request.AuditReportDocumentId; record.Notes = CleanText(request.Notes); record.UpdatedAt = DateTime.UtcNow;
        await SyncJourneyStageAsync(record, userId);
        await context.SaveChangesAsync(); return Ok(new { success = true, data = record });
    }

    private async Task<string?> Validate(AuditRecordRequest request, Guid userId)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Scope)) return "Audit title and scope are required";
        if (request.Standard is not ("ISO 9001:2015" or "ISO 27001:2022")) return "Select a supported ISO standard";
        if (request.AuditType is not ("internal" or "external" or "supplier" or "follow_up")) return "Select a valid audit type";
        if (request.Status is not ("planned" or "in_progress" or "completed" or "cancelled")) return "Select a valid audit status";
        if (!await context.AuditCycles.AnyAsync(c => c.AuditCycleId == request.AuditCycleId && c.Standard == request.Standard)) return "The audit cycle does not match the selected standard";
        foreach (var documentId in new[] { request.AuditPlanDocumentId, request.AuditReportDocumentId }.Where(id => id.HasValue).Select(id => id!.Value).Distinct())
        {
            var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document == null || !await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId)) return "Select a controlled document you can access";
        }
        return null;
    }
    private static string[] Clean(string[]? values) => values?.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray() ?? [];
    private async Task<((Guid[] Ids, string[] Names) Team, string? Error)> ResolveTeam(Guid[]? userIds)
    {
        var ids = userIds?.Distinct().ToArray() ?? [];
        if (ids.Length == 0) return (([], []), null);
        var users = await context.Users.AsNoTracking().Where(user => ids.Contains(user.UserId) && user.IsActive).Select(user => new { user.UserId, user.FullName }).ToListAsync();
        if (users.Count != ids.Length) return (([], []), "One or more selected audit participants are inactive or unavailable");
        return ((users.Select(user => user.UserId).ToArray(), users.Select(user => user.FullName).ToArray()), null);
    }

    // The Audit Register is the operational source of truth for audit progress.
    // Synchronise its relevant stage so Quality does not maintain the same status
    // separately in the Admin programme plan.
    private async Task SyncJourneyStageAsync(DmsAuditRecord record, Guid actorUserId)
    {
        var stageKey = record.AuditType switch
        {
            "internal" => "internal_audit",
            "external" => "surveillance_audit",
            _ => null,
        };
        if (stageKey == null || record.Status == "cancelled") return;

        var stage = await context.AuditCalendarEvents.FirstOrDefaultAsync(e =>
            e.AuditCycleId == record.AuditCycleId && e.Standard == record.Standard && e.StageKey == stageKey);

        if (stage == null)
        {
            stage = new DmsAuditCalendarEvent
            {
                EventId = Guid.NewGuid(),
                AuditCycleId = record.AuditCycleId,
                StageKey = stageKey,
                Title = $"{record.Title} — {(stageKey == "internal_audit" ? "Internal Audit" : "Surveillance Audit")}",
                Phase = stageKey == "internal_audit" ? "Internal Audit" : "Surveillance Audit",
                Standard = record.Standard,
                EventDate = record.AuditDate,
                ProgrammeYear = record.AuditDate.Year,
                PostedBy = actorUserId,
                CreatedAt = DateTime.UtcNow,
            };
            context.AuditCalendarEvents.Add(stage);
        }

        // Moving forward through an audit confirms that the earlier major
        // journey milestones have been completed. This prevents the dashboard
        // from being stuck on Preparation after an Internal Audit has started.
        if (record.Status is "in_progress" or "completed")
        {
            var orderedStages = new[] { "preparation", "internal_audit", "management_review", "surveillance_audit" };
            var position = Array.IndexOf(orderedStages, stageKey);
            if (position > 0)
            {
                var earlierStages = await context.AuditCalendarEvents.Where(e =>
                    e.AuditCycleId == record.AuditCycleId && e.Standard == record.Standard &&
                    orderedStages.Take(position).Contains(e.StageKey!)).ToListAsync();
                foreach (var earlierStage in earlierStages) earlierStage.Status = "completed";
            }
        }

        // A planned audit remains planned. When it is being conducted or closed,
        // its record controls the matching journey stage.
        stage.Status = record.Status;
    }
    private static string? CleanText(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public record AuditRecordRequest(Guid AuditCycleId, string Standard, string Title, string AuditType, string Status, DateOnly AuditDate, string Scope, string[]? Departments = null, Guid[]? AuditTeamUserIds = null, Guid[]? ParticipantUserIds = null, string? AuditPlanReference = null, string? AuditReportReference = null, Guid? AuditPlanDocumentId = null, Guid? AuditReportDocumentId = null, string? Notes = null);
