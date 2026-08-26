using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// "Frequencies" is deliberately a set, not a single choice — per explicit
// request, an admin can turn on e.g. both Daily AND Weekly at once, each
// firing independently on its own schedule.
//
// DestinationPath and NetworkShare are both optional and purely additive —
// every backup always goes to MinIO object storage first (the app's own
// always-available storage, no extra setup needed) regardless of either:
//   - DestinationPath: a second copy written to a plain filesystem path
//     *inside the API container* — for a network location, the share must
//     already be mounted at the infrastructure level (see docker-compose.yml)
//     since this never handles network protocols/credentials itself.
//   - NetworkShare: a second copy written by the app connecting *directly*
//     over SMB2/3 using credentials entered in the GUI — no host-level mount
//     needed, but the credentials are then stored in the database (same
//     plain-JSON pattern already used for the SMTP password), not a
//     locked-down host-only file. Both can be enabled at once if wanted.
public record ScheduledBackupConfig(bool Enabled, string[] Frequencies, string Time, string DayOfWeek, int DayOfMonth, int KeepLastN, string? DestinationPath = null, NetworkShareConfig? NetworkShare = null)
{
    public static readonly ScheduledBackupConfig Default = new(false, [], "02:00", "Sunday", 1, 30, null, NetworkShareConfig.Default);
}

// Tracks the last period each frequency actually fired in (e.g. "2026-08-05"
// for Daily), so the every-5-minutes checker doesn't fire the same day's
// backup 288 times.
public record ScheduledBackupLastRun(string? Hourly, string? Daily, string? Weekly, string? Monthly)
{
    public static readonly ScheduledBackupLastRun Default = new(null, null, null, null);
}

public static class ScheduledBackupKeys
{
    public const string Config = "scheduled_backup_config";
    public const string LastRun = "scheduled_backup_last_run";
    public const string ObjectPrefix = "backups/scheduled/";
}

public class ScheduledBackupService(
    DmsContext context,
    DatabaseExportService exportService,
    MinioService minioService,
    AuditService auditService,
    ILogger<ScheduledBackupService> logger)
{
    private static async Task<T> LoadAsync<T>(DmsContext context, string key, T fallback)
    {
        var setting = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key);
        if (string.IsNullOrWhiteSpace(setting?.Value))
            return fallback;
        try
        {
            return JsonSerializer.Deserialize<T>(setting.Value, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? fallback;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    public Task<ScheduledBackupConfig> LoadConfigAsync() => LoadAsync(context, ScheduledBackupKeys.Config, ScheduledBackupConfig.Default);
    public Task<ScheduledBackupLastRun> LoadLastRunAsync() => LoadAsync(context, ScheduledBackupKeys.LastRun, ScheduledBackupLastRun.Default);

    public async Task SaveConfigAsync(ScheduledBackupConfig config, Guid userId)
    {
        var setting = await context.AppSettings.FirstOrDefaultAsync(s => s.Key == ScheduledBackupKeys.Config);
        if (setting == null)
        {
            setting = new DmsAppSetting { Key = ScheduledBackupKeys.Config };
            context.AppSettings.Add(setting);
        }
        setting.Value = JsonSerializer.Serialize(config);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = userId;
        await context.SaveChangesAsync();
    }

    private static bool TimeMatches(DateTime now, string configTime)
    {
        if (!TimeSpan.TryParse(configTime, out var target))
            return false;
        var diff = Math.Abs((now.TimeOfDay - target).TotalMinutes);
        return diff < 5 || diff > 1435; // handles the midnight wraparound
    }

    // The entry point Hangfire calls every 5 minutes. Checks every enabled
    // frequency independently — Daily and Weekly can both be on and both
    // fire on their own schedules without stepping on each other.
    public async Task RunScheduledCheckAsync()
    {
        try
        {
            var config = await LoadConfigAsync();
            if (!config.Enabled || config.Frequencies.Length == 0)
                return;

            var now = DateTime.UtcNow;
            var lastRun = await LoadLastRunAsync();
            var updated = lastRun;

            if (config.Frequencies.Contains("hourly") && now.Minute < 5)
            {
                var periodKey = now.ToString("yyyyMMddHH");
                if (lastRun.Hourly != periodKey)
                {
                    await RunAndSaveAsync(config, "hourly");
                    updated = updated with { Hourly = periodKey };
                }
            }

            if (config.Frequencies.Contains("daily") && TimeMatches(now, config.Time))
            {
                var periodKey = now.ToString("yyyyMMdd");
                if (lastRun.Daily != periodKey)
                {
                    await RunAndSaveAsync(config, "daily");
                    updated = updated with { Daily = periodKey };
                }
            }

            if (config.Frequencies.Contains("weekly") && TimeMatches(now, config.Time) &&
                string.Equals(now.DayOfWeek.ToString(), config.DayOfWeek, StringComparison.OrdinalIgnoreCase))
            {
                var periodKey = now.ToString("yyyyMMdd");
                if (lastRun.Weekly != periodKey)
                {
                    await RunAndSaveAsync(config, "weekly");
                    updated = updated with { Weekly = periodKey };
                }
            }

            if (config.Frequencies.Contains("monthly") && TimeMatches(now, config.Time))
            {
                var targetDay = Math.Min(config.DayOfMonth, DateTime.DaysInMonth(now.Year, now.Month));
                if (now.Day == targetDay)
                {
                    var periodKey = now.ToString("yyyyMM");
                    if (lastRun.Monthly != periodKey)
                    {
                        await RunAndSaveAsync(config, "monthly");
                        updated = updated with { Monthly = periodKey };
                    }
                }
            }

            if (updated != lastRun)
            {
                var setting = await context.AppSettings.FirstOrDefaultAsync(s => s.Key == ScheduledBackupKeys.LastRun)
                    ?? new DmsAppSetting { Key = ScheduledBackupKeys.LastRun };
                setting.Value = JsonSerializer.Serialize(updated);
                setting.UpdatedAt = now;
                if (context.Entry(setting).State == EntityState.Detached)
                    context.AppSettings.Add(setting);
                await context.SaveChangesAsync();
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error in scheduled backup check");
        }
    }

    // Shared by the recurring job and "Run Backup Now" — runs pg_dump,
    // uploads to MinIO under the scheduled-backups prefix, and enforces
    // KeepLastN retention afterward.
    public async Task<(bool Success, string? Error, string? FileName)> RunAndSaveAsync(ScheduledBackupConfig config, string frequency)
    {
        var (bytes, error) = await exportService.ExportSqlDumpAsync();
        if (bytes == null)
        {
            logger.LogError("Scheduled backup ({Frequency}) failed: {Error}", frequency, error);
            return (false, error, null);
        }

        var timestamp = DateTime.UtcNow;
        var fileName = $"dms-backup-{frequency}-{timestamp:yyyyMMdd-HHmmss}.sql";
        var objectKey = $"{ScheduledBackupKeys.ObjectPrefix}{fileName}";

        using (var stream = new MemoryStream(bytes))
            await minioService.UploadAsync(objectKey, stream, "application/sql");

        await auditService.LogAsync(Guid.Empty, AuditActions.DATABASE_BACKUP_EXPORTED, new { Frequency = frequency, fileName, SizeBytes = bytes.Length, Scheduled = true });
        logger.LogInformation("Scheduled backup ({Frequency}) saved as {FileName} ({SizeBytes} bytes)", frequency, fileName, bytes.Length);

        // Best-effort second copies — the MinIO save above has already
        // succeeded by this point, so a bad/unmounted/unwritable destination
        // path or a bad/unreachable network share only loses that specific
        // extra copy, never the backup itself.
        if (!string.IsNullOrWhiteSpace(config.DestinationPath))
            await TryWriteToDestinationPathAsync(config.DestinationPath, fileName, bytes);

        if (config.NetworkShare?.Enabled == true)
        {
            var (smbSuccess, smbError) = SmbBackupService.SaveBackup(config.NetworkShare, fileName, bytes);
            if (!smbSuccess)
                logger.LogWarning("Failed to write backup {FileName} to network share {Host}\\{ShareName} — {Error}", fileName, config.NetworkShare.Host, config.NetworkShare.ShareName, smbError);
            else
                logger.LogInformation("Backup {FileName} also written to network share {Host}\\{ShareName}", fileName, config.NetworkShare.Host, config.NetworkShare.ShareName);
        }

        if (config.KeepLastN > 0)
        {
            await EnforceRetentionAsync(config.KeepLastN);
            if (!string.IsNullOrWhiteSpace(config.DestinationPath))
                EnforceDestinationPathRetention(config.DestinationPath, config.KeepLastN);
            if (config.NetworkShare?.Enabled == true)
                SmbBackupService.EnforceRetention(config.NetworkShare, config.KeepLastN);
        }

        return (true, null, fileName);
    }

    private async Task TryWriteToDestinationPathAsync(string destinationPath, string fileName, byte[] bytes)
    {
        try
        {
            Directory.CreateDirectory(destinationPath);
            await File.WriteAllBytesAsync(Path.Combine(destinationPath, fileName), bytes);
            logger.LogInformation("Backup {FileName} also written to destination path {DestinationPath}", fileName, destinationPath);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to write backup {FileName} to destination path {DestinationPath} — the MinIO copy is unaffected", fileName, destinationPath);
        }
    }

    private async Task EnforceRetentionAsync(int keepLastN)
    {
        var objectKeys = await minioService.ListAsync(ScheduledBackupKeys.ObjectPrefix);
        // File names embed a sortable timestamp (yyyyMMdd-HHmmss), so a plain
        // descending string sort is newest-first without needing a MinIO stat
        // call per file just to order them.
        var toDelete = objectKeys.OrderByDescending(k => k).Skip(keepLastN);
        foreach (var key in toDelete)
        {
            try { await minioService.DeleteAsync(key); }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to delete old scheduled backup {ObjectKey} during retention cleanup", key); }
        }
    }

    private void EnforceDestinationPathRetention(string destinationPath, int keepLastN)
    {
        try
        {
            if (!Directory.Exists(destinationPath)) return;
            var toDelete = Directory.GetFiles(destinationPath, "dms-backup-*.sql")
                .OrderByDescending(Path.GetFileName)
                .Skip(keepLastN);
            foreach (var path in toDelete)
            {
                try { File.Delete(path); }
                catch (Exception ex) { logger.LogWarning(ex, "Failed to delete old scheduled backup {Path} from destination path during retention cleanup", path); }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to enforce retention on destination path {DestinationPath}", destinationPath);
        }
    }

    // Validates a destination path is actually usable *before* it's saved —
    // so a bad/unmounted/unwritable path surfaces as an immediate, clear
    // error in the GUI right when the admin sets it, instead of silently
    // failing every scheduled run at 2 AM with nothing but a log line no one
    // is watching. A real test file is written and removed, not just an
    // existence check, since a mounted-but-read-only share would otherwise
    // look fine here and then fail for real later.
    public static string? ValidateDestinationPath(string? destinationPath)
    {
        if (string.IsNullOrWhiteSpace(destinationPath))
            return null;

        try
        {
            Directory.CreateDirectory(destinationPath);
            var probePath = Path.Combine(destinationPath, $".dms-write-test-{Guid.NewGuid():N}");
            File.WriteAllText(probePath, string.Empty);
            File.Delete(probePath);
            return null;
        }
        catch (Exception ex)
        {
            return $"'{destinationPath}' is not writable from inside the API container: {ex.Message}. If this is meant to be a network location, make sure it's mounted into the api container first (see docker-compose.yml) — the app writes to it as a plain local folder and never handles network credentials itself.";
        }
    }
}
