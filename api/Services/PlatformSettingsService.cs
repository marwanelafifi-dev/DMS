using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// The 4 setting groups on the Admin Panel's Settings page (General, Login
// Page, Header, Security). Each is a plain JSON blob stored under its own
// dms_app_settings key — same generic table AppSettingsController exposes
// for simple toggles, just with a structured value here instead of "true"/"false".
public record GeneralSettings(string PlatformName, string OrganizationName, string SupportEmail, string Timezone, string DateFormat)
{
    public static readonly GeneralSettings Default = new("Si-Ware DMS", "Si-Ware Systems", "ithelpdesk@si-ware.com", "Africa/Cairo", "DD-MMM-YYYY");
}

public record LoginPageSettings(
    string PageTitle, string PageSubtitle, string CardTitle, string CardSubtitle,
    string FooterLine1, string FooterLine2, string FooterEmail, bool ShowGoogleButton,
    string? LogoObjectKey = null, string? LogoContentType = null)
{
    public static readonly LoginPageSettings Default = new(
        "Document Management System",
        "Secure, compliant, and fully traceable from document creation through final approval.",
        "Sign in securely",
        "Authorized Si-Ware Employees only. Please use your Corporate Account to continue.",
        "Operated by IT Team",
        "For assistance, please contact the IT Helpdesk.",
        "ithelpdesk@si-ware.com",
        true);
}

public record HeaderSettings(bool ShowLogoInHeader, string LogoAltText, string? LogoObjectKey = null, string? LogoContentType = null)
{
    public static readonly HeaderSettings Default = new(true, "Si-Ware Systems");
}

public record SecuritySettings(int SessionTimeoutHours, bool AllowMultipleSessions, bool RequireStrongPasswords, bool PasswordExpiry)
{
    public static readonly SecuritySettings Default = new(8, true, true, false);
}

public static class PlatformSettingKeys
{
    public const string General = "settings_general";
    public const string LoginPage = "settings_login_page";
    public const string Header = "settings_header";
    public const string Security = "settings_security";
}

public static class PasswordPolicy
{
    // Applied wherever a new password is set (create user, reset password,
    // set-initial-password) — gated on the Security -> "Require Strong
    // Passwords" toggle so an admin who turns it off keeps the plain 8-char
    // minimum every account has always required, nothing more.
    public static string? Validate(string password, SecuritySettings security)
    {
        if (password.Length < 8)
            return "Password must be at least 8 characters";

        if (!security.RequireStrongPasswords)
            return null;

        if (!password.Any(char.IsUpper))
            return "Password must contain at least one uppercase letter";
        if (!password.Any(char.IsDigit))
            return "Password must contain at least one number";
        if (password.All(char.IsLetterOrDigit))
            return "Password must contain at least one symbol";

        return null;
    }
}

public static class PlatformSettingsService
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

    public static Task<GeneralSettings> LoadGeneralAsync(DmsContext context) => LoadAsync(context, PlatformSettingKeys.General, GeneralSettings.Default);
    public static Task<LoginPageSettings> LoadLoginPageAsync(DmsContext context) => LoadAsync(context, PlatformSettingKeys.LoginPage, LoginPageSettings.Default);
    public static Task<HeaderSettings> LoadHeaderAsync(DmsContext context) => LoadAsync(context, PlatformSettingKeys.Header, HeaderSettings.Default);
    public static Task<SecuritySettings> LoadSecurityAsync(DmsContext context) => LoadAsync(context, PlatformSettingKeys.Security, SecuritySettings.Default);

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
