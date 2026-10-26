using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Hangfire;
using Hangfire.Server;
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
public record ScheduledBackupConfig(bool Enabled, string[] Frequencies, string Time, string DayOfWeek, int DayOfMonth, int KeepLastN, string? DestinationPath = null, NetworkShareConfig? NetworkShare = null, int? LocalKeepLastN = null)
{
    // Null keeps the previous behavior for saved settings created before the
    // separate MinIO retention control existed.
    public static readonly ScheduledBackupConfig Default = new(false, [], "02:00", "Sunday", 1, 30, null, NetworkShareConfig.Default, 2);
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

public record ManualBackupOutcome(bool Success, string? FileName, string? Warning, string? Error);

public class ScheduledBackupService(
    DmsContext context,
    RecoveryArchiveService recoveryArchiveService,
    MinioService minioService,
    AuditService auditService,
    ILogger<ScheduledBackupService> logger)
{
    // The five-minute Hangfire check can overlap a multi-gigabyte backup.
    // Manual runs use the same gate.
    private static readonly SemaphoreSlim BackupGate = new(1, 1);
    private const long MinimumFreeSpaceBytes = 10L * 1024 * 1024 * 1024;

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

    // Hangfire executes this after the HTTP request returns. The result is
    // stored with the job so the GUI can poll without a long-lived connection.
    [AutomaticRetry(Attempts = 0)]
    public async Task RunManualBackupJobAsync(Guid requestedByUserId, PerformContext performContext)
    {
        var config = await LoadConfigAsync();
        var (success, message, fileName) = await RunAndSaveAsync(config, "manual");
        var outcome = new ManualBackupOutcome(success, fileName, success ? message : null, success ? null : message);
        performContext.SetJobParameter("DmsBackupOutcome", outcome);

        if (!success)
            throw new InvalidOperationException(message ?? "Manual recovery backup failed");

        try
        {
            await auditService.LogAsync(requestedByUserId, AuditActions.DATABASE_BACKUP_EXPORTED, new { fileName, Manual = true });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Recovery backup {FileName} completed, but the requester audit entry failed", fileName);
        }
    }

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

    private static bool TimeHasPassed(DateTime now, string configTime)
    {
        if (!TimeSpan.TryParse(configTime, out var target))
            return false;
        return now.TimeOfDay >= target;
    }

    private async Task<(DateTime Now, string TimeZone)> GetScheduleTimeAsync()
    {
        var general = await PlatformSettingsService.LoadGeneralAsync(context);
        try
        {
            var timeZone = TimeZoneInfo.FindSystemTimeZoneById(general.Timezone);
            return (TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone), general.Timezone);
        }
        catch (TimeZoneNotFoundException ex)
        {
            logger.LogWarning(ex, "Scheduled backup timezone {TimeZone} was not found; falling back to UTC", general.Timezone);
            return (DateTime.UtcNow, "UTC");
        }
        catch (InvalidTimeZoneException ex)
        {
            logger.LogWarning(ex, "Scheduled backup timezone {TimeZone} is invalid; falling back to UTC", general.Timezone);
            return (DateTime.UtcNow, "UTC");
        }
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

            var (now, timeZone) = await GetScheduleTimeAsync();
            var lastRun = await LoadLastRunAsync();
            var updated = lastRun;

            logger.LogInformation(
                "Checking scheduled backups at {LocalTime} ({TimeZone}); enabled frequencies: {Frequencies}",
                now, timeZone, string.Join(", ", config.Frequencies));

            if (config.Frequencies.Contains("hourly"))
            {
                var periodKey = now.ToString("yyyyMMddHH");
                if (lastRun.Hourly != periodKey)
                {
                    var result = await RunAndSaveAsync(config, "hourly");
                    if (result.Success)
                        updated = updated with { Hourly = periodKey };
                }
            }

            if (config.Frequencies.Contains("daily") && TimeHasPassed(now, config.Time))
            {
                var periodKey = now.ToString("yyyyMMdd");
                if (lastRun.Daily != periodKey)
                {
                    var result = await RunAndSaveAsync(config, "daily");
                    if (result.Success)
                        updated = updated with { Daily = periodKey };
                }
            }

            if (config.Frequencies.Contains("weekly") && TimeHasPassed(now, config.Time) &&
                string.Equals(now.DayOfWeek.ToString(), config.DayOfWeek, StringComparison.OrdinalIgnoreCase))
            {
                var periodKey = now.ToString("yyyyMMdd");
                if (lastRun.Weekly != periodKey)
                {
                    var result = await RunAndSaveAsync(config, "weekly");
                    if (result.Success)
                        updated = updated with { Weekly = periodKey };
                }
            }

            if (config.Frequencies.Contains("monthly") && TimeHasPassed(now, config.Time))
            {
                var targetDay = Math.Min(config.DayOfMonth, DateTime.DaysInMonth(now.Year, now.Month));
                if (now.Day == targetDay)
                {
                    var periodKey = now.ToString("yyyyMM");
                    if (lastRun.Monthly != periodKey)
                    {
                        var result = await RunAndSaveAsync(config, "monthly");
                        if (result.Success)
                            updated = updated with { Monthly = periodKey };
                    }
                }
            }

            if (updated != lastRun)
            {
                var setting = await context.AppSettings.FirstOrDefaultAsync(s => s.Key == ScheduledBackupKeys.LastRun)
                    ?? new DmsAppSetting { Key = ScheduledBackupKeys.LastRun };
                setting.Value = JsonSerializer.Serialize(updated);
                setting.UpdatedAt = DateTime.UtcNow;
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

    // Shared by the recurring job and "Run Backup Now". Each saved item is a
    // complete recovery archive: database data plus every DMS object/version.
    public async Task<(bool Success, string? Error, string? FileName)> RunAndSaveAsync(ScheduledBackupConfig config, string frequency)
    {
        if (!await BackupGate.WaitAsync(0))
            return (false, "A recovery backup is already running", null);

        try
        {
            // This process is now the only backup writer in the container.
            // Anything left in /tmp from an earlier interrupted run is stale.
            foreach (var orphan in Directory.GetFiles(Path.GetTempPath(), "dms-recovery-*.zip"))
                RecoveryArchiveService.TryDelete(orphan);

            var tempDrive = new DriveInfo(Path.GetPathRoot(Path.GetTempPath())!);
            if (tempDrive.AvailableFreeSpace < MinimumFreeSpaceBytes)
                return (false, "Less than 10 GB of free disk space is available for a recovery backup", null);

            var (archive, error) = await recoveryArchiveService.CreateAsync();
            if (archive == null)
            {
                logger.LogError("Recovery backup ({Frequency}) failed: {Error}", frequency, error);
                return (false, error, null);
            }

            try
            {
                // MinioService.UploadAsync stages another temporary file,
                // and MinIO stores the resulting object on this same host.
                // Both copies must fit while this archive is still open.
                if (tempDrive.AvailableFreeSpace < 2 * archive.SizeBytes + MinimumFreeSpaceBytes)
                    return (false, "Insufficient free disk space for the recovery backup upload", null);

                var timestamp = DateTime.UtcNow;
                var fileName = $"dms-recovery-{frequency}-{timestamp:yyyyMMdd-HHmmss}.zip";
                var objectKey = $"{ScheduledBackupKeys.ObjectPrefix}{fileName}";

                await using (var stream = File.OpenRead(archive.Path))
                    await minioService.UploadAsync(objectKey, stream, "application/zip");

                await auditService.LogAsync(Guid.Empty, AuditActions.DATABASE_BACKUP_EXPORTED, new { Frequency = frequency, fileName, archive.SizeBytes, archive.ObjectCount, Scheduled = true });
                logger.LogInformation("Recovery backup ({Frequency}) saved as {FileName} ({SizeBytes} bytes, {ObjectCount} objects)", frequency, fileName, archive.SizeBytes, archive.ObjectCount);

                // Optional second copies never invalidate the MinIO recovery point.
                var copyWarnings = new List<string>();
                var destinationCopied = false;
                if (!string.IsNullOrWhiteSpace(config.DestinationPath))
                {
                    destinationCopied = await TryWriteToDestinationPathAsync(config.DestinationPath, fileName, archive.Path);
                    if (!destinationCopied)
                        copyWarnings.Add("the mounted Synology copy failed");
                }

                var smbCopied = false;
                if (config.NetworkShare?.Enabled == true)
                {
                    var (smbSuccess, smbError) = SmbBackupService.SaveBackup(config.NetworkShare, fileName, archive.Path);
                    smbCopied = smbSuccess;
                    if (!smbSuccess)
                    {
                        logger.LogWarning("Failed to write backup {FileName} to network share {Host}\\{ShareName} - {Error}", fileName, config.NetworkShare.Host, config.NetworkShare.ShareName, smbError);
                        copyWarnings.Add("the direct SMB copy failed");
                    }
                    else
                        logger.LogInformation("Backup {FileName} also written to network share {Host}\\{ShareName}", fileName, config.NetworkShare.Host, config.NetworkShare.ShareName);
                }

                var localKeepLastN = config.LocalKeepLastN ?? config.KeepLastN;
                if (localKeepLastN > 0)
                    await EnforceRetentionAsync(localKeepLastN);

                if (config.KeepLastN > 0)
                {
                    if (destinationCopied)
                        EnforceDestinationPathRetention(config.DestinationPath!, config.KeepLastN);
                    if (smbCopied)
                        SmbBackupService.EnforceRetention(config.NetworkShare!, config.KeepLastN);
                }

                return (true, copyWarnings.Count > 0 ? $"Local backup saved, but {string.Join(" and ", copyWarnings)}. Check the API logs and the Synology destination." : null, fileName);
            }
            finally
            {
                RecoveryArchiveService.TryDelete(archive.Path);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Recovery backup ({Frequency}) failed", frequency);
            return (false, "Recovery backup failed - see server logs", null);
        }
        finally
        {
            BackupGate.Release();
        }
    }

    private async Task<bool> TryWriteToDestinationPathAsync(string destinationPath, string fileName, string archivePath)
    {
        string? partialPath = null;
        try
        {
            Directory.CreateDirectory(destinationPath);
            partialPath = Path.Combine(destinationPath, $".{fileName}.{Guid.NewGuid():N}.partial");
            await using (var source = File.OpenRead(archivePath))
            await using (var destination = File.Create(partialPath))
                await source.CopyToAsync(destination);
            File.Move(partialPath, Path.Combine(destinationPath, fileName), overwrite: true);
            logger.LogInformation("Backup {FileName} also written to destination path {DestinationPath}", fileName, destinationPath);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to write backup {FileName} to destination path {DestinationPath} — the MinIO copy is unaffected", fileName, destinationPath);
            return false;
        }
        finally
        {
            if (partialPath != null)
                RecoveryArchiveService.TryDelete(partialPath);
        }
    }

    private async Task EnforceRetentionAsync(int keepLastN)
    {
        try
        {
            var objectKeys = await minioService.ListAsync(ScheduledBackupKeys.ObjectPrefix);
            var toDelete = objectKeys.Where(key => key.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(BackupTimestamp, StringComparer.Ordinal).Skip(keepLastN);
            foreach (var key in toDelete)
            {
                try { await minioService.DeleteAsync(key); }
                catch (Exception ex) { logger.LogWarning(ex, "Failed to delete old scheduled backup {ObjectKey} during retention cleanup", key); }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to list local recovery archives for retention cleanup");
        }
    }

    private void EnforceDestinationPathRetention(string destinationPath, int keepLastN)
    {
        try
        {
            if (!Directory.Exists(destinationPath)) return;
            var toDelete = Directory.GetFiles(destinationPath, "dms-recovery-*.zip")
                .OrderByDescending(BackupTimestamp, StringComparer.Ordinal)
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

    private static string BackupTimestamp(string path)
    {
        var stem = Path.GetFileNameWithoutExtension(path);
        // The final 15 characters are yyyyMMdd-HHmmss. Frequency comes first
        // and must not decide which backup retention keeps.
        return stem.Length >= 15 ? stem[^15..] : stem;
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
