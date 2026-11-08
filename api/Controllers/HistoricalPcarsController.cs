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
public class HistoricalPcarsController(DmsContext context, AuditService auditService, NotificationService notificationService, ILogger<HistoricalPcarsController> logger) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> Get([FromQuery] string? search, [FromQuery] string? status, [FromQuery] string? owner, [FromQuery] string? sortBy, [FromQuery] string? sortDirection, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        var (access, forbidden) = await RequireHistoricalPcarAccessAsync();
        if (forbidden != null) return forbidden;

        var query = context.HistoricalPcars.AsNoTracking().AsQueryable();
        if (!access!.CanViewAllHistoricalPcars)
            query = query.Where(p => p.LinkedUserId == GetCurrentUserId());
        var ownerOptions = await query.Where(p => p.HistoricalOwnerName != null)
            .Select(p => p.HistoricalOwnerName!).Distinct().OrderBy(name => name).ToListAsync();
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
        if (!string.IsNullOrWhiteSpace(owner))
            query = query.Where(p => p.HistoricalOwnerName == owner);

        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 50);
        var totalCount = await query.CountAsync();
        var descending = !string.Equals(sortDirection, "asc", StringComparison.OrdinalIgnoreCase);
        var orderedQuery = (sortBy?.ToLowerInvariant(), descending) switch
        {
            ("completed", true) => query.OrderByDescending(p => p.SourceCompletedAt),
            ("completed", false) => query.OrderBy(p => p.SourceCompletedAt),
            ("status", true) => query.OrderByDescending(p => p.SourceStatus),
            ("status", false) => query.OrderBy(p => p.SourceStatus),
            ("priority", true) => query.OrderByDescending(p => p.Priority),
            ("priority", false) => query.OrderBy(p => p.Priority),
            (_, false) => query.OrderBy(p => p.SourceCreatedAt),
            _ => query.OrderByDescending(p => p.SourceCreatedAt),
        };
        var rows = await orderedQuery.ThenBy(p => p.LegacyRequestId)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(p => new
            {
                p.HistoricalPcarId, p.LegacyRequestId, p.GroupName, p.RequesterName, p.Department,
                p.Category, p.Subject, p.Description, p.HistoricalOwnerName,
                LinkedUserName = p.LinkedUser == null ? null : p.LinkedUser.FullName,
                p.MigratedTaskId, p.MigratedAt,
                p.Priority, p.Severity, p.SourceStatus, p.Resolution, p.ClosureCode, p.ClosureComments,
                p.SourceCreatedAt, p.SourceDueAt, p.SourceCompletedAt, p.SourceUpdatedAt, p.ImportedAt,
            })
            .ToListAsync();

        return Ok(new { success = true, data = rows, totalCount, ownerOptions, page, pageSize, totalPages = Math.Max(1, (int)Math.Ceiling(totalCount / (double)pageSize)) });
    }

    [HttpPost("import")]
    public async Task<ActionResult<object>> Import([FromBody] HistoricalPcarImportRequest request)
    {
        var (access, forbidden) = await RequireHistoricalPcarAccessAsync();
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

    // Creates actionable PCARs only for legacy records still marked open and
    // linked to an active DMS account. The archive row is never changed except
    // for its live-task reference, making repeat requests safe.
    [HttpPost("promote-open")]
    public async Task<ActionResult<object>> PromoteOpen()
    {
        var (access, forbidden) = await RequireHistoricalPcarAccessAsync();
        if (forbidden != null) return forbidden;
        if (access!.CanManageAllTasks != true || access.CanImportHistoricalPcars != true)
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have permission to move historical PCARs into the live register" });

        var actorId = GetCurrentUserId();
        var candidates = await context.HistoricalPcars
            .Include(p => p.LinkedUser)
            .Where(p => p.MigratedTaskId == null
                && p.LinkedUserId != null
                && p.LinkedUser != null
                && p.LinkedUser.IsActive
                && p.SourceStatus != null
                && EF.Functions.ILike(p.SourceStatus, "open%"))
            .OrderBy(p => p.SourceCreatedAt)
            .ThenBy(p => p.LegacyRequestId)
            .ToListAsync();

        if (candidates.Count == 0)
            return Ok(new { success = true, data = new { promoted = 0, message = "No eligible open historical PCARs were found." } });

        var now = DateTime.UtcNow;
        await using var transaction = await context.Database.BeginTransactionAsync();
        foreach (var record in candidates)
        {
            var task = new DmsTask
            {
                TaskId = Guid.NewGuid(),
                Title = string.IsNullOrWhiteSpace(record.Subject) ? $"Legacy PCAR #{record.LegacyRequestId}" : record.Subject.Trim(),
                Description = BuildLiveDescription(record),
                Tags = BuildTags(record),
                TaskType = "rca",
                RiskSeverity = NormalizePriority(record.Priority),
                AssignedToId = record.LinkedUserId,
                ManagerId = actorId,
                DueDate = record.SourceDueAt?.Date,
                Status = "open",
                CreatedAt = now,
                UpdatedAt = now,
            };
            context.Tasks.Add(task);
            record.MigratedTaskId = task.TaskId;
            record.MigratedAt = now;
        }

        await context.SaveChangesAsync();
        await transaction.CommitAsync();

        foreach (var record in candidates)
        {
            await notificationService.NotifyAsync(
                record.LinkedUserId!.Value,
                actorId,
                "A historical PCAR was assigned to you",
                $"Legacy PCAR #{record.LegacyRequestId}: {record.Subject ?? "Untitled PCAR"}",
                taskId: record.MigratedTaskId);
        }

        await auditService.LogAsync(actorId, HISTORICAL_PCAR_MIGRATED, new
        {
            PromotedCount = candidates.Count,
            LegacyRequestIds = candidates.Select(p => p.LegacyRequestId).ToArray(),
        });
        logger.LogInformation("Promoted {Count} open historical PCARs into live tasks by {UserId}", candidates.Count, actorId);
        return Ok(new { success = true, data = new { promoted = candidates.Count } });
    }

    private async Task<(DmsPageAccessRole? Access, ActionResult<object>? Forbidden)> RequireHistoricalPcarAccessAsync()
    {
        var access = await GetPageAccessRoleAsync(context, GetCurrentUserId());
        if (access?.CanViewPcar != true || access.CanViewHistoricalPcars != true)
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

    private static string[] BuildTags(DmsHistoricalPcar record) => new[]
        {
            $"Legacy PCAR #{record.LegacyRequestId}",
            record.Category,
            record.GroupName,
        }
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => value!.Trim())
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private static string BuildLiveDescription(DmsHistoricalPcar record)
    {
        var provenance = $"Migrated from historical PCAR #{record.LegacyRequestId}. Original owner: {record.HistoricalOwnerName ?? "Unassigned"}.";
        return string.IsNullOrWhiteSpace(record.Description) ? provenance : $"{provenance}\n\n{record.Description.Trim()}";
    }

    private static string NormalizePriority(string? priority) => priority?.Trim().ToLowerInvariant() switch
    {
        "critical" => "critical",
        "high" => "high",
        "low" => "low",
        _ => "medium",
    };

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
