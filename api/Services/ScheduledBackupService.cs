using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// "Frequencies" is deliberately a set, not a single choice — per explicit
// request, an admin can turn on e.g. both Daily AND Weekly at once, each
// firing independently on its own schedule.
public record ScheduledBackupConfig(bool Enabled, string[] Frequencies, string Time, string DayOfWeek, int DayOfMonth, int KeepLastN)
{
    public static readonly ScheduledBackupConfig Default = new(false, [], "02:00", "Sunday", 1, 30);
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

        if (config.KeepLastN > 0)
            await EnforceRetentionAsync(config.KeepLastN);

        return (true, null, fileName);
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
}
