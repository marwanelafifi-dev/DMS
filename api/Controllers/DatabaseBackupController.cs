using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Text;
using Hangfire;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Backs the Admin Panel's Database page — export/restore of everything this
// app stores in Postgres (users, folders, documents metadata, tasks,
// approvals, notifications, settings, ...). Deliberately data-only: the
// schema itself is owned by infra/db/init/*.sql, not by this backup.
//
// IMPORTANT SCOPE NOTE: this backs up the DATABASE only. The actual bytes of
// uploaded documents/attachments/logos live in MinIO (object storage), not
// Postgres, and are NOT included here — restoring a backup brings back every
// document's metadata (title, folder, version history, owner, ...) but not
// the underlying files themselves.
[ApiController]
[Route("api/database-backup")]
public class DatabaseBackupController(
    DmsContext context, IConfiguration configuration, DatabaseExportService exportService,
    ScheduledBackupService scheduledBackupService, MinioService minioService,
    AuditService auditService, OcrIndexService ocrIndexService, IBackgroundJobClient backgroundJobs,
    ILogger<DatabaseBackupController> logger) : BaseController
{
    private const string LastBackupSettingKey = "database_last_backup_at";
    private sealed record ScheduledBackupFileResponse(string FileName, long SizeBytes, DateTime? LastModified);

    private async Task<bool> IsAdminAsync()
    {
        var role = await GetPageAccessRoleAsync(context, GetCurrentUserId());
        return role?.BypassFolderPermissions == true;
    }

    [HttpGet("ocr-index/status")]
    public async Task<ActionResult<object>> GetOcrIndexStatus(CancellationToken cancellationToken)
    {
        if (!await IsAdminAsync()) return StatusCode(403, new { success = false, error = "Only a Full Access role can manage OCR indexing" });
        var items = await ocrIndexService.GetStatusAsync(cancellationToken);
        return Ok(new { success = true, data = new { items, total = items.Count, indexed = items.Count(item => item.IsIndexed), missing = items.Count(item => !item.IsIndexed) } });
    }

    [HttpPost("ocr-index/reindex")]
    public async Task<ActionResult<object>> QueueOcrReindex([FromBody] OcrReindexRequest request, CancellationToken cancellationToken)
    {
        if (!await IsAdminAsync()) return StatusCode(403, new { success = false, error = "Only a Full Access role can manage OCR indexing" });
        var status = await ocrIndexService.GetStatusAsync(cancellationToken);
        var allowed = status.Select(item => item.DocumentId).ToHashSet();
        var ids = request.AllDocuments
            ? status.Select(item => item.DocumentId).ToList()
            : request.AllMissing
                ? status.Where(item => !item.IsIndexed).Select(item => item.DocumentId).ToList()
                : request.DocumentIds.Where(allowed.Contains).Distinct().ToList();
        if (ids.Count > 0)
            backgroundJobs.Enqueue<OcrIndexService>(service => service.ReindexBatchJobAsync(ids));
        return Ok(new { success = true, data = new { queued = ids.Count }, message = $"Queued {ids.Count} document(s) for OCR indexing" });
    }

    [HttpGet("status")]
    public async Task<ActionResult<object>> GetStatus()
    {
        var setting = await context.AppSettings.FindAsync(LastBackupSettingKey);
        return Ok(new { success = true, data = new { lastBackupAt = setting?.Value } });
    }

    // GET /api/database-backup/export — shells out to pg_dump for a
    // data-only, plain-INSERT SQL dump of the "public" schema. Using the
    // real Postgres tool (rather than hand-rolling per-table serialization
    // for 30+ EF entities) guarantees every table — including ones added in
    // future sessions — is captured automatically and that foreign-key
    // ordering in the dump is correct.
    [HttpGet("export")]
    public async Task<IActionResult> Export()
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can export a backup" });

        try
        {
            var (bytes, exportError) = await exportService.ExportSqlDumpAsync();
            if (bytes == null)
                return StatusCode(500, new { success = false, error = exportError ?? "Backup export failed" });

            var userId = GetCurrentUserId();
            var timestamp = DateTime.UtcNow;

            var setting = await context.AppSettings.FindAsync(LastBackupSettingKey);
            if (setting == null)
            {
                setting = new DmsAppSetting { Key = LastBackupSettingKey };
                context.AppSettings.Add(setting);
            }
            setting.Value = timestamp.ToString("O");
            setting.UpdatedAt = timestamp;
            setting.UpdatedById = userId;
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, DATABASE_BACKUP_EXPORTED, new { SizeBytes = bytes.Length });
            logger.LogInformation("Database backup exported by {UserId} ({SizeBytes} bytes)", userId, bytes.Length);

            var fileName = $"dms-backup-{timestamp:yyyyMMdd-HHmmss}.sql";
            return File(bytes, "application/sql", fileName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error exporting database backup");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/database-backup/documents/export - exports the current metadata
    // for every active document. Recycled documents are deliberately excluded
    // so this administrative report matches the live Document Library.
    [HttpGet("documents/export")]
    public async Task<IActionResult> ExportDocumentMetadata()
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can export document metadata" });

        try
        {
            var documents = await context.Documents
                .AsNoTracking()
                .Include(document => document.Owner)
                .Where(document => document.DeletedAt == null)
                .OrderBy(document => document.OriginalDocumentId)
                .ThenBy(document => document.Title)
                .ToListAsync();

            var currentVersionIds = documents
                .Where(document => document.CurrentVersionId.HasValue)
                .Select(document => document.CurrentVersionId!.Value)
                .Distinct()
                .ToArray();
            var currentVersions = await context.DocumentVersions
                .AsNoTracking()
                .Where(version => currentVersionIds.Contains(version.VersionId))
                .ToDictionaryAsync(version => version.VersionId);

            var folders = await context.Folders
                .AsNoTracking()
                .Select(folder => new { folder.FolderId, folder.ParentFolderId, folder.Name })
                .ToDictionaryAsync(folder => folder.FolderId);

            string ResolveFolderPath(Guid folderId)
            {
                var names = new List<string>();
                var visited = new HashSet<Guid>();
                Guid? currentId = folderId;

                while (currentId.HasValue && visited.Add(currentId.Value) && folders.TryGetValue(currentId.Value, out var folder))
                {
                    names.Add(folder.Name);
                    currentId = folder.ParentFolderId;
                }

                names.Reverse();
                return string.Join(" / ", names);
            }

            static string CsvValue(object? value)
            {
                var text = value?.ToString() ?? string.Empty;
                if (text.Length > 0 && "=+-@".Contains(text[0]))
                    text = $"'{text}";
                return $"\"{text.Replace("\"", "\"\"")}\"";
            }

            var csv = new StringBuilder();
            var headers = new[]
            {
                "Doc ID", "System ID", "Document Name", "File Name", "Owner", "Description", "Path",
                "Department", "Category", "Tags", "Status", "Current Version", "Created Date", "Modified Date"
            };
            csv.AppendLine(string.Join(",", headers.Select(CsvValue)));

            foreach (var document in documents)
            {
                currentVersions.TryGetValue(document.CurrentVersionId ?? Guid.Empty, out var currentVersion);
                var values = new object?[]
                {
                    document.OriginalDocumentId,
                    document.DocumentId,
                    document.Title,
                    currentVersion?.FileName,
                    document.Owner?.FullName,
                    document.Description,
                    ResolveFolderPath(document.FolderId),
                    document.Department,
                    document.Category,
                    string.Join("; ", document.Tags ?? Array.Empty<string>()),
                    document.Status,
                    currentVersion?.VersionLabel ?? currentVersion?.VersionNumber,
                    document.CreatedAt.ToString("O"),
                    document.UpdatedAt.ToString("O")
                };
                csv.AppendLine(string.Join(",", values.Select(CsvValue)));
            }

            await auditService.LogAsync(GetCurrentUserId(), DOCUMENT_METADATA_EXPORTED, new
            {
                DocumentCount = documents.Count,
                Format = "CSV"
            });

            var content = Encoding.UTF8.GetBytes(csv.ToString());
            var preamble = Encoding.UTF8.GetPreamble();
            var bytes = new byte[preamble.Length + content.Length];
            Buffer.BlockCopy(preamble, 0, bytes, 0, preamble.Length);
            Buffer.BlockCopy(content, 0, bytes, preamble.Length, content.Length);

            var fileName = $"dms-document-metadata-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv";
            logger.LogInformation("Document metadata exported by {UserId} ({DocumentCount} documents)", GetCurrentUserId(), documents.Count);
            return File(bytes, "text/csv; charset=utf-8", fileName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error exporting document metadata");
            return StatusCode(500, new { success = false, error = "Failed to export document metadata" });
        }
    }

    // POST /api/database-backup/restore — TRUNCATEs every table in the
    // "public" schema, then replays the uploaded dump's INSERT statements,
    // all inside one transaction (rolled back whole on any failure, so a
    // malformed file can't leave the database half-wiped). This is
    // destructive by design — the frontend requires an explicit confirmation
    // before calling it.
    [HttpPost("restore")]
    public async Task<ActionResult<object>> Restore(IFormFile file)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can restore a backup" });

        if (file == null || file.Length == 0)
            return BadRequest(new { success = false, error = "Backup file is required" });

        if (!file.FileName.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { success = false, error = "Only .sql backup files (from Download Backup) are supported" });

        string rawContent;
        using (var reader = new StreamReader(file.OpenReadStream()))
            rawContent = await reader.ReadToEndAsync();

        if (string.IsNullOrWhiteSpace(rawContent))
            return BadRequest(new { success = false, error = "Backup file is empty" });

        // pg_dump 16+ brackets its output with \restrict/\unrestrict — these
        // are psql-only meta-commands (not real SQL), meaningless/invalid
        // when executed directly through Npgsql, so strip any backslash
        // command line before running the rest as plain SQL.
        var sqlContent = string.Join('\n', rawContent
            .Split('\n')
            .Where(line => !line.TrimStart().StartsWith('\\')));

        try
        {
            var connectionString = configuration.GetConnectionString("Default");
            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync();

            var tableNames = new List<string>();
            await using (var listCmd = new NpgsqlCommand("SELECT tablename FROM pg_tables WHERE schemaname = 'public'", conn))
            await using (var listReader = await listCmd.ExecuteReaderAsync())
            {
                while (await listReader.ReadAsync())
                    tableNames.Add(listReader.GetString(0));
            }

            if (tableNames.Count == 0)
                return StatusCode(500, new { success = false, error = "No tables found to restore into" });

            await using var transaction = await conn.BeginTransactionAsync();
            try
            {
                // Several tables have circular FK pairs (e.g. dms_documents.current_version_id
                // <-> dms_document_versions.document_id) that no single INSERT order can
                // satisfy. Switching to "replica" mode for this session skips FK/trigger
                // enforcement while loading (same mechanism logical replication uses), then
                // reverts before commit so the constraints are back in force for every
                // future request.
                await using (var replicaCmd = new NpgsqlCommand("SET session_replication_role = replica;", conn, transaction))
                    await replicaCmd.ExecuteNonQueryAsync();

                var quotedTables = string.Join(", ", tableNames.Select(t => $"\"{t}\""));
                await using (var truncateCmd = new NpgsqlCommand($"TRUNCATE TABLE {quotedTables} RESTART IDENTITY CASCADE;", conn, transaction))
                    await truncateCmd.ExecuteNonQueryAsync();

                await using (var restoreCmd = new NpgsqlCommand(sqlContent, conn, transaction))
                    await restoreCmd.ExecuteNonQueryAsync();

                await using (var replicaResetCmd = new NpgsqlCommand("SET session_replication_role = DEFAULT;", conn, transaction))
                    await replicaResetCmd.ExecuteNonQueryAsync();

                await transaction.CommitAsync();
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                logger.LogError(ex, "Database restore failed — rolled back");
                return StatusCode(500, new { success = false, error = $"Restore failed and was rolled back, no data was changed: {ex.Message}" });
            }

            var userId = GetCurrentUserId();
            await auditService.LogAsync(userId, DATABASE_BACKUP_RESTORED, new { file.FileName, SizeBytes = file.Length });
            logger.LogWarning("Database restored from backup {FileName} by {UserId}", file.FileName, userId);

            return Ok(new { success = true, message = "Database restored from backup. Some pages may need a refresh." });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error restoring database backup");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/database-backup/clear-options — every clearable group with a
    // live row count, so the admin sees exactly how much each button removes
    // before pressing it.
    [HttpGet("clear-options")]
    public async Task<ActionResult<object>> GetClearOptions()
    {
        try
        {
            var connectionString = configuration.GetConnectionString("Default");
            await using var conn = new NpgsqlConnection(connectionString);
            await conn.OpenAsync();

            var result = new List<object>();
            foreach (var group in ClearDataGroups.All)
            {
                long total = 0;
                foreach (var table in group.Tables)
                {
                    await using var cmd = new NpgsqlCommand($"SELECT count(*) FROM \"{table}\"", conn);
                    total += (long)(await cmd.ExecuteScalarAsync() ?? 0L);
                }
                result.Add(new { group.Key, group.Label, group.Description, RecordCount = total });
            }

            return Ok(new { success = true, data = result });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving clear-data options");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    private async Task TruncateTablesAsync(IEnumerable<string> tables)
    {
        var connectionString = configuration.GetConnectionString("Default");
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        var quoted = string.Join(", ", tables.Select(t => $"\"{t}\""));
        await using var cmd = new NpgsqlCommand($"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE;", conn);
        await cmd.ExecuteNonQueryAsync();
    }

    // POST /api/database-backup/clear/{key} — wipes one named group only.
    // CASCADE means a row referencing something in this group (e.g. a task
    // linked to a document being cleared here) is removed too, even if that
    // row's own table isn't part of this group — real referential integrity,
    // not a bug, but worth the frontend surfacing as a heads-up.
    [HttpPost("clear/{key}")]
    public async Task<ActionResult<object>> ClearGroup(string key)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can clear data" });

        var group = ClearDataGroups.All.FirstOrDefault(g => g.Key == key);
        if (group == null)
            return NotFound(new { success = false, error = "Unknown data group" });

        try
        {
            await TruncateTablesAsync(group.Tables);

            var userId = GetCurrentUserId();
            await auditService.LogAsync(userId, DATABASE_DATA_CLEARED, new { Group = group.Key, group.Tables });
            logger.LogWarning("Cleared data group {Group} by {UserId}", group.Key, userId);

            return Ok(new { success = true, message = $"{group.Label} data cleared" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error clearing data group {Group}", key);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/database-backup/clear-all — every group at once. User
    // accounts and role definitions are still never touched (see
    // ClearDataGroups' file header for why).
    [HttpPost("clear-all")]
    public async Task<ActionResult<object>> ClearAll()
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can clear data" });

        try
        {
            var allTables = ClearDataGroups.All.SelectMany(g => g.Tables).Distinct().ToArray();
            await TruncateTablesAsync(allTables);

            var userId = GetCurrentUserId();
            await auditService.LogAsync(userId, DATABASE_DATA_CLEARED, new { Group = "all", Tables = allTables });
            logger.LogWarning("Cleared ALL data by {UserId}", userId);

            return Ok(new { success = true, message = "All data cleared. User accounts and roles were not affected." });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error clearing all data");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/database-backup/schedule — config + the saved backup files
    // list, each with a real size/date read from MinIO (not just the
    // timestamp baked into the file name).
    [HttpGet("schedule")]
    public async Task<ActionResult<object>> GetSchedule()
    {
        try
        {
            var config = await scheduledBackupService.LoadConfigAsync();
            var generalSettings = await PlatformSettingsService.LoadGeneralAsync(context);
            var objectKeys = await minioService.ListAsync(ScheduledBackupKeys.ObjectPrefix);

            var files = new List<ScheduledBackupFileResponse>();
            foreach (var key in objectKeys)
            {
                var fileName = key[ScheduledBackupKeys.ObjectPrefix.Length..];
                var stat = await minioService.StatAsync(key);
                files.Add(new ScheduledBackupFileResponse(fileName, stat?.SizeBytes ?? 0, stat?.LastModified));
            }

            files = files
                .OrderByDescending(file => file.LastModified)
                .ThenByDescending(file => file.FileName, StringComparer.Ordinal)
                .ToList();

            return Ok(new
            {
                success = true,
                data = new
                {
                    config,
                    scheduleTimeZone = generalSettings.Timezone,
                    files,
                    lastBackup = files.FirstOrDefault(),
                },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving backup schedule");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    [HttpPut("schedule")]
    public async Task<ActionResult<object>> UpdateSchedule([FromBody] ScheduledBackupConfig req)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        var validFrequencies = new[] { "hourly", "daily", "weekly", "monthly" };
        if (req.Frequencies.Any(f => !validFrequencies.Contains(f)))
            return BadRequest(new { success = false, error = "Unknown frequency" });

        if (!TimeSpan.TryParse(req.Time, out _))
            return BadRequest(new { success = false, error = "Time must be in HH:mm format" });

        var pathError = ScheduledBackupService.ValidateDestinationPath(req.DestinationPath);
        if (pathError != null)
            return BadRequest(new { success = false, error = pathError });

        if (req.NetworkShare?.Enabled == true)
        {
            if (string.IsNullOrWhiteSpace(req.NetworkShare.Host) || string.IsNullOrWhiteSpace(req.NetworkShare.ShareName))
                return BadRequest(new { success = false, error = "Network share host and share name are required" });

            var (smbOk, smbError) = SmbBackupService.TestConnection(req.NetworkShare);
            if (!smbOk)
                return BadRequest(new { success = false, error = $"Network share connection failed: {smbError}" });
        }

        await scheduledBackupService.SaveConfigAsync(req, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "scheduled_backup_config", req });

        return Ok(new { success = true, data = req });
    }

    // POST /api/database-backup/schedule/run-now — runs the same backup a
    // scheduled trigger would, saved into the same MinIO-backed file list
    // (distinct from GET .../export, which only downloads to the browser and
    // isn't kept on the server).
    [HttpPost("schedule/run-now")]
    public async Task<ActionResult<object>> RunNow()
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can run a backup" });

        var config = await scheduledBackupService.LoadConfigAsync();
        var (success, error, fileName) = await scheduledBackupService.RunAndSaveAsync(config, "manual");
        if (!success)
            return StatusCode(500, new { success = false, error = error ?? "Backup failed" });

        await auditService.LogAsync(GetCurrentUserId(), DATABASE_BACKUP_EXPORTED, new { fileName, Manual = true });

        return Ok(new { success = true, data = new { fileName } });
    }

    [HttpGet("schedule/files/{fileName}/download")]
    public async Task<IActionResult> DownloadScheduledBackup(string fileName)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can download backups" });

        try
        {
            var objectKey = $"{ScheduledBackupKeys.ObjectPrefix}{fileName}";
            var stream = await minioService.DownloadAsync(objectKey);
            return File(stream, "application/sql", fileName);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to download scheduled backup {FileName}", fileName);
            return NotFound(new { success = false, error = "Backup file not found" });
        }
    }
}

public sealed record OcrReindexRequest(List<Guid> DocumentIds, bool AllMissing = false, bool AllDocuments = false);
