namespace DMS.Api.Models;

// Small global key/value settings table for app-wide toggles that don't
// belong on any single role or user — e.g. whether Google Calendar should
// sync automatically on every login, set by a Full Access admin.
public class DmsAppSetting
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; }
    public Guid? UpdatedById { get; set; }
}

public static class AppSettingKeys
{
    public const string SyncCalendarOnLogin = "sync_calendar_on_login";
}
