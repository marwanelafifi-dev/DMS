using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// While enabled, only a Full Access role may log in (see AuthController) —
// everyone else's login attempt is rejected with Message.
public record MaintenanceModeSettings(bool Enabled, string Message)
{
    public static readonly MaintenanceModeSettings Default = new(false, "We're doing maintenance — we'll be right back.");
}

// A banner shown to every signed-in user (and on the Login page) starting 72
// hours before StartAt and ending at EndAt — purely informational, doesn't
// block anything by itself.
public record ScheduledMaintenanceNotice(bool Enabled, string Message, DateTime? StartAt, DateTime? EndAt)
{
    public static readonly ScheduledMaintenanceNotice Default = new(false, "", null, null);

    public bool IsCurrentlyActive(DateTime utcNow) =>
        Enabled && StartAt.HasValue && EndAt.HasValue &&
        utcNow >= StartAt.Value.AddHours(-72) && utcNow <= EndAt.Value;
}

public static class SystemControlKeys
{
    public const string MaintenanceMode = "system_maintenance_mode";
    public const string ScheduledNotice = "system_scheduled_notice";
}

public static class SystemControlsService
{
    private static async Task<T> LoadAsync<T>(DmsContext context, string key, T fallback)
    {
        var setting = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key);
        if (string.IsNullOrWhiteSpace(setting?.Value))
            return fallback;

        try
        {
            var parsed = JsonSerializer.Deserialize<T>(setting.Value, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return parsed ?? fallback;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    public static Task<MaintenanceModeSettings> LoadMaintenanceModeAsync(DmsContext context) =>
        LoadAsync(context, SystemControlKeys.MaintenanceMode, MaintenanceModeSettings.Default);

    public static Task<ScheduledMaintenanceNotice> LoadScheduledNoticeAsync(DmsContext context) =>
        LoadAsync(context, SystemControlKeys.ScheduledNotice, ScheduledMaintenanceNotice.Default);

    public static async Task SaveAsync<T>(DmsContext context, string key, T value, Guid userId)
    {
        var setting = await context.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting == null)
        {
            setting = new DmsAppSetting { Key = key };
            context.AppSettings.Add(setting);
        }

        setting.Value = JsonSerializer.Serialize(value);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = userId;
        await context.SaveChangesAsync();
    }
}
