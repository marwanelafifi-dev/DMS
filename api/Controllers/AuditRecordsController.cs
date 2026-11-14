using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/audits")]
public class AuditRecordsController(DmsContext context, AccessOverrideService accessOverrideService, AuditService auditService, NotificationService notificationService) : BaseController
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
        var sequenceError = await ValidateJourneySequenceAsync(request); if (sequenceError != null) return BadRequest(new { success = false, error = sequenceError });
        if (await context.AuditRecords.AnyAsync(a => a.AuditCycleId == request.AuditCycleId && a.AuditType == request.AuditType))
            return BadRequest(new { success = false, error = "This cycle already has a record for this journey stage. Open that record to edit it." });
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
        var previousStatus = record.Status;
        var error = await Validate(request, userId); if (error != null) return BadRequest(new { success = false, error });
        var sequenceError = await ValidateJourneySequenceAsync(request, id, previousStatus); if (sequenceError != null) return BadRequest(new { success = false, error = sequenceError });
        if (await context.AuditRecords.AnyAsync(a => a.AuditRecordId != id && a.AuditCycleId == request.AuditCycleId && a.AuditType == request.AuditType))
            return BadRequest(new { success = false, error = "This cycle already has a record for this journey stage. Open that record to edit it." });
        var teamResult = await ResolveTeam(request.AuditTeamUserIds); var participantResult = await ResolveTeam(request.ParticipantUserIds); if (teamResult.Error != null || participantResult.Error != null) return BadRequest(new { success = false, error = teamResult.Error ?? participantResult.Error }); var team = teamResult.Team; var participants = participantResult.Team;
        record.AuditCycleId = request.AuditCycleId; record.Standard = request.Standard; record.Title = request.Title.Trim(); record.AuditType = request.AuditType; record.Status = request.Status; record.AuditDate = request.AuditDate; record.Scope = request.Scope.Trim(); record.Departments = Clean(request.Departments); record.AuditTeam = team.Names; record.AuditTeamUserIds = team.Ids; record.ParticipantUserIds = participants.Ids; record.AuditPlanReference = CleanText(request.AuditPlanReference); record.AuditReportReference = CleanText(request.AuditReportReference); record.AuditPlanDocumentId = request.AuditPlanDocumentId; record.AuditReportDocumentId = request.AuditReportDocumentId; record.Notes = CleanText(request.Notes); record.UpdatedAt = DateTime.UtcNow;
        await SyncJourneyStageAsync(record, userId);
        await context.SaveChangesAsync();
        if (!string.Equals(previousStatus, record.Status, StringComparison.OrdinalIgnoreCase))
            await NotifyStatusChangeAsync(record, userId);
        return Ok(new { success = true, data = record });
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult<object>> Delete(Guid id)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanDeleteTasks != true) return Forbid();

        var record = await context.AuditRecords.FindAsync(id);
        if (record == null) return NotFound();

        var cycle = await context.AuditCycles.AsNoTracking().FirstOrDefaultAsync(c => c.AuditCycleId == record.AuditCycleId);
        if (cycle == null) return BadRequest(new { success = false, error = "The audit cycle for this record is unavailable." });
        if (cycle.Status is "completed" or "historical" or "closed")
            return BadRequest(new { success = false, error = "Records cannot be deleted after the audit cycle is completed or archived." });
        if (await context.Tasks.AnyAsync(task => task.AuditRecordId == id && task.TaskType == "pcar") ||
            await context.AuditChecklistItems.AnyAsync(item => item.AuditRecordId == id))
            return BadRequest(new { success = false, error = "This record has checklist findings or linked PCARs and must be retained for audit traceability." });

        var stageKey = StageKeyFor(record.AuditType);
        if (stageKey != null)
        {
            var stage = await context.AuditCalendarEvents.FirstOrDefaultAsync(e =>
                e.AuditCycleId == record.AuditCycleId && e.Standard == record.Standard && e.StageKey == stageKey);
            if (stage != null) stage.Status = "planned";
        }

        var snapshot = new { record.AuditRecordId, record.AuditCycleId, record.Standard, record.Title, record.AuditType, record.Status, record.AuditDate };
        context.AuditRecords.Remove(record);
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, AuditActions.AUDIT_RECORD_DELETED, snapshot);
        return Ok(new { success = true });
    }

    private async Task<string?> Validate(AuditRecordRequest request, Guid userId)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Scope)) return "Audit title and scope are required";
        if (request.Standard is not ("ISO 9001:2015" or "ISO 27001:2022")) return "Select a supported ISO standard";
        if (request.AuditType is not ("preparation" or "internal" or "management_review" or "external")) return "Select Preparation, Internal audit, Management Review, or External audit";
        if (request.Status is not ("planned" or "in_progress" or "completed" or "cancelled")) return "Select a valid audit status";
        if (!await context.AuditCycles.AnyAsync(c => c.AuditCycleId == request.AuditCycleId && c.Standard == request.Standard)) return "The audit cycle does not match the selected standard";
        foreach (var documentId in new[] { request.AuditPlanDocumentId, request.AuditReportDocumentId }.Where(id => id.HasValue).Select(id => id!.Value).Distinct())
        {
            var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == documentId);
            if (document == null || !await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId)) return "Select a controlled document you can access";
        }
        return null;
    }

    private static readonly string[] JourneyAuditTypes = ["preparation", "internal", "management_review", "external"];

    private async Task<string?> ValidateJourneySequenceAsync(AuditRecordRequest request, Guid? recordId = null, string? previousStatus = null)
    {
        var position = Array.IndexOf(JourneyAuditTypes, request.AuditType);
        if (position < 0) return null;

        var activatesStage = IsJourneyActive(request.Status) && (previousStatus == null || !IsJourneyActive(previousStatus));
        if (activatesStage && position > 0)
        {
            var requiredTypes = JourneyAuditTypes.Take(position).ToArray();
            var completedTypes = await context.AuditRecords.AsNoTracking()
                .Where(record => record.AuditCycleId == request.AuditCycleId && record.Standard == request.Standard && requiredTypes.Contains(record.AuditType) && record.Status == "completed")
                .Select(record => record.AuditType)
                .ToListAsync();
            var missingTypes = requiredTypes.Except(completedTypes, StringComparer.OrdinalIgnoreCase).Select(JourneyStageName).ToArray();
            if (missingTypes.Length > 0)
                return $"Complete {string.Join(" and ", missingTypes)} before starting or completing {JourneyStageName(request.AuditType)}.";
        }

        var removesCompletion = previousStatus == "completed" && request.Status != "completed";
        if (removesCompletion && position < JourneyAuditTypes.Length - 1)
        {
            var laterTypes = JourneyAuditTypes.Skip(position + 1).ToArray();
            var laterStageIsActive = await context.AuditRecords.AsNoTracking().AnyAsync(record =>
                record.AuditRecordId != recordId && record.AuditCycleId == request.AuditCycleId && record.Standard == request.Standard &&
                laterTypes.Contains(record.AuditType) && (record.Status == "in_progress" || record.Status == "completed"));
            if (laterStageIsActive)
                return $"You cannot reopen {JourneyStageName(request.AuditType)} while a later journey stage is in progress or completed.";
        }

        return null;
    }

    private static bool IsJourneyActive(string status) => status is "in_progress" or "completed";
    private static string JourneyStageName(string auditType) => auditType switch
    {
        "preparation" => "Preparation",
        "internal" => "Internal Audit",
        "management_review" => "Management Review",
        "external" => "Surveillance Audit",
        _ => "this stage",
    };

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
        var stageKey = StageKeyFor(record.AuditType);
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
                Title = $"{record.Title} — {stageKey switch { "preparation" => "Preparation", "internal_audit" => "Internal Audit", "management_review" => "Management Review", _ => "Surveillance Audit" }}",
                Phase = stageKey switch { "preparation" => "Preparation", "internal_audit" => "Internal Audit", "management_review" => "Management Review", _ => "Surveillance Audit" },
                Standard = record.Standard,
                EventDate = record.AuditDate,
                ProgrammeYear = record.AuditDate.Year,
                PostedBy = actorUserId,
                CreatedAt = DateTime.UtcNow,
            };
            context.AuditCalendarEvents.Add(stage);
        }

        // The managed record controls only its own stage. Completion is never
        // inferred for another stage: every ISO milestone must be completed explicitly.
        stage.Status = record.Status;
    }

    private static string? StageKeyFor(string auditType) => auditType switch
    {
        "preparation" => "preparation",
        "internal" => "internal_audit",
        "management_review" => "management_review",
        "external" => "surveillance_audit",
        _ => null,
    };

    private async Task NotifyStatusChangeAsync(DmsAuditRecord record, Guid actorUserId)
    {
        var recipientIds = record.AuditTeamUserIds
            .Concat(record.ParticipantUserIds)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (recipientIds.Length == 0) return;

        var cycleName = await context.AuditCycles.AsNoTracking()
            .Where(cycle => cycle.AuditCycleId == record.AuditCycleId)
            .Select(cycle => cycle.Name)
            .FirstOrDefaultAsync() ?? "the audit cycle";
        var stageName = record.AuditType switch
        {
            "preparation" => "Preparation",
            "internal" => "Internal Audit",
            "management_review" => "Management Review",
            "external" => "Surveillance Audit",
            _ => "Audit stage",
        };
        var status = record.Status switch
        {
            "in_progress" => "In Progress",
            "completed" => "Completed",
            "planned" => "Planned",
            "cancelled" => "Cancelled",
            _ => record.Status,
        };
        var title = $"{stageName} status changed to {status}";
        var body = $"{cycleName}: please open DMS and review your assigned tasks, PCAR findings, and actions. Update anything still outstanding.";
        foreach (var recipientId in recipientIds)
            await notificationService.NotifyInAppAsync(recipientId, actorUserId, title, body);
    }
    private static string? CleanText(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public record AuditRecordRequest(Guid AuditCycleId, string Standard, string Title, string AuditType, string Status, DateOnly AuditDate, string Scope, string[]? Departments = null, Guid[]? AuditTeamUserIds = null, Guid[]? ParticipantUserIds = null, string? AuditPlanReference = null, string? AuditReportReference = null, Guid? AuditPlanDocumentId = null, Guid? AuditReportDocumentId = null, string? Notes = null);
