using System.Globalization;
using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/historical-pcars")]
public class HistoricalPcarsController(DmsContext context, AuditService auditService, ILogger<HistoricalPcarsController> logger) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> Get([FromQuery] string? search, [FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var (access, forbidden) = await RequirePcarViewAccessAsync();
        if (forbidden != null) return forbidden;

        var query = context.HistoricalPcars.AsNoTracking().AsQueryable();
        if (!access!.CanViewAllHistoricalPcars)
            query = query.Where(p => p.LinkedUserId == GetCurrentUserId());
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(p => p.LegacyRequestId.Contains(term)
                || (p.Subject != null && p.Subject.Contains(term))
                || (p.HistoricalOwnerName != null && p.HistoricalOwnerName.Contains(term))
                || (p.RequesterName != null && p.RequesterName.Contains(term)));
        }
        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(p => p.SourceStatus == status);

        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 50);
        var totalCount = await query.CountAsync();
        var rows = await query.OrderByDescending(p => p.SourceCreatedAt).ThenBy(p => p.LegacyRequestId)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new
            {
                p.HistoricalPcarId, p.LegacyRequestId, p.GroupName, p.RequesterName, p.Department,
                p.Category, p.Subject, p.Description, p.HistoricalOwnerName,
                LinkedUserName = p.LinkedUser == null ? null : p.LinkedUser.FullName,
                p.Priority, p.Severity, p.SourceStatus, p.Resolution, p.ClosureCode, p.ClosureComments,
                p.SourceCreatedAt, p.SourceDueAt, p.SourceCompletedAt, p.SourceUpdatedAt, p.ImportedAt,
            })
            .ToListAsync();

        return Ok(new { success = true, data = rows, totalCount, page, pageSize, totalPages = Math.Max(1, (int)Math.Ceiling(totalCount / (double)pageSize)) });
    }

    [HttpPost("import")]
    public async Task<ActionResult<object>> Import([FromBody] HistoricalPcarImportRequest request)
    {
        var (access, forbidden) = await RequirePcarViewAccessAsync();
        if (forbidden != null) return forbidden;
        if (access!.CanImportHistoricalPcars != true)
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have permission to import historical PCAR records" });
        if (request.Records is null || request.Records.Count == 0)
            return BadRequest(new { success = false, error = "The import has no PCAR records" });
        if (request.Records.Count > 2_000)
            return BadRequest(new { success = false, error = "An import is limited to 2,000 records" });

        var actorId = GetCurrentUserId();
        var sourceSystem = "manageengine";
        var existing = (await context.HistoricalPcars.AsNoTracking()
                .Where(p => p.SourceSystem == sourceSystem)
                .Select(p => p.LegacyRequestId)
                .ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var users = await context.Users.AsNoTracking().Where(u => u.IsActive)
            .Select(u => new { u.UserId, u.FullName })
            .ToListAsync();
        var usersByNormalizedName = users
            .GroupBy(u => NormalizeName(u.FullName))
            .Where(g => !string.IsNullOrEmpty(g.Key) && g.Count() == 1)
            .ToDictionary(g => g.Key, g => g.Single().UserId);

        var now = DateTime.UtcNow;
        var seenInFile = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var imported = 0;
        var linkedOwners = 0;
        var skipped = new List<object>();

        foreach (var record in request.Records)
        {
            var legacyId = record.RequestId?.Trim();
            if (string.IsNullOrWhiteSpace(legacyId))
            {
                skipped.Add(new { record.Subject, Reason = "Missing Request ID" });
                continue;
            }
            if (!seenInFile.Add(legacyId))
            {
                skipped.Add(new { RequestId = legacyId, Reason = "Duplicate Request ID in this file" });
                continue;
            }
            if (existing.Contains(legacyId))
            {
                skipped.Add(new { RequestId = legacyId, Reason = "Already imported" });
                continue;
            }

            var historicalOwner = NullIfPlaceholder(record.Technician);
            var normalizedOwner = NormalizeName(historicalOwner);
            Guid? linkedUserId = !string.IsNullOrEmpty(normalizedOwner) && usersByNormalizedName.TryGetValue(normalizedOwner, out var matchedUserId)
                ? matchedUserId
                : null;
            if (linkedUserId.HasValue) linkedOwners++;

            context.HistoricalPcars.Add(new DmsHistoricalPcar
            {
                HistoricalPcarId = Guid.NewGuid(), SourceSystem = sourceSystem, LegacyRequestId = legacyId,
                GroupName = NullIfPlaceholder(record.Group), RequesterName = NullIfPlaceholder(record.Requester),
                Department = NullIfPlaceholder(record.Department), Category = NullIfPlaceholder(record.Category),
                Subject = NullIfPlaceholder(record.Subject), Description = NullIfPlaceholder(record.Description),
                HistoricalOwnerName = historicalOwner, LinkedUserId = linkedUserId,
                Priority = NullIfPlaceholder(record.Priority), Severity = NullIfPlaceholder(record.Severity),
                SourceStatus = NullIfPlaceholder(record.RequestStatus), Resolution = NullIfPlaceholder(record.Resolution),
                ClosureCode = NullIfPlaceholder(record.ClosureCode), ClosureComments = NullIfPlaceholder(record.ClosureComments),
                SourceCreatedAt = ParseSourceDate(record.CreatedTime), SourceDueAt = ParseSourceDate(record.DueByTime),
                SourceCompletedAt = ParseSourceDate(record.CompletedTime), SourceUpdatedAt = ParseSourceDate(record.LastUpdateTime),
                ImportedById = actorId, ImportedAt = now,
            });
            imported++;
        }

        await context.SaveChangesAsync();
        await auditService.LogAsync(actorId, HISTORICAL_PCAR_IMPORTED, new
        {
            SourceSystem = sourceSystem, ImportedCount = imported, SkippedCount = skipped.Count,
            LinkedOwnerCount = linkedOwners, UnmatchedOwnerCount = imported - linkedOwners,
        });
        logger.LogInformation("Imported {Count} historical PCAR records by {UserId}", imported, actorId);
        return Ok(new { success = true, data = new { imported, skipped, linkedOwners, unmatchedOwners = imported - linkedOwners } });
    }

    private async Task<(DmsPageAccessRole? Access, ActionResult<object>? Forbidden)> RequirePcarViewAccessAsync()
    {
        var access = await GetPageAccessRoleAsync(context, GetCurrentUserId());
        if (access?.CanViewPcar != true)
            return (null, StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have permission to view historical PCAR records" }));
        return (access, null);
    }

    private static string? NullIfPlaceholder(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrWhiteSpace(trimmed) || trimmed.Equals("Not Assigned", StringComparison.OrdinalIgnoreCase) ? null : trimmed;
    }

    private static string NormalizeName(string? value) => string.Concat((value ?? string.Empty)
        .Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant));

    private static DateTime? ParseSourceDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Equals("Not Assigned", StringComparison.OrdinalIgnoreCase)) return null;
        var formats = new[] { "dd/MM/yyyy hh:mm tt", "dd/MM/yyyy h:mm tt", "dd/MM/yyyy HH:mm", "dd/MM/yyyy" };
        if (!DateTime.TryParseExact(value.Trim(), formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            return null;

        // The supplied export was generated by the Egypt office. Store an
        // actual UTC instant while retaining the source's wall-clock time.
        var cairo = TimeZoneInfo.FindSystemTimeZoneById("Africa/Cairo");
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(date, DateTimeKind.Unspecified), cairo);
    }
}

public record HistoricalPcarImportRequest(List<HistoricalPcarImportRecord> Records);
public record HistoricalPcarImportRecord(
    string? RequestId, string? Group, string? Requester, string? Department, string? Category,
    string? Subject, string? Technician, string? Description, string? Priority, string? Severity,
    string? RequestStatus, string? CreatedTime, string? DueByTime, string? CompletedTime,
    string? Resolution, string? ClosureCode, string? ClosureComments, string? LastUpdateTime);
