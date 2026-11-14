using System.Net.Http.Headers;
using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Google.Apis.Auth.OAuth2;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// One-way Google Workspace directory synchronization. Existing DMS users are
// matched by email and only their Department can change. Roles, permissions,
// groups, status, passwords, and authentication settings are deliberately out
// of scope for this integration.
public sealed class GoogleDirectoryUserSyncService(
    DmsContext context,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    ILogger<GoogleDirectoryUserSyncService> logger)
{
    public const string StatusSettingKey = "google_directory_user_sync_status";
    public const string ConfigurationSettingKey = "google_directory_user_sync_configuration";
    private const string ScheduledSlotSettingKey = "google_directory_user_sync_last_schedule_slot";
    private const string DirectoryUserReadScope = "https://www.googleapis.com/auth/admin.directory.user.readonly";
    private const string DirectoryOrgUnitReadScope = "https://www.googleapis.com/auth/admin.directory.orgunit.readonly";

    private string? ServiceAccountFilePath => FirstNonEmpty(
        configuration["GoogleDirectory:ServiceAccountFile"],
        configuration["GOOGLE_DIRECTORY_SERVICE_ACCOUNT_FILE"],
        configuration["GOOGLE_SERVICE_ACCOUNT_KEY_FILE"]);

    private string? ServiceAccountJson
    {
        get
        {
            var inlineValue = configuration["GoogleDirectory:ServiceAccountJson"];
            if (!string.IsNullOrWhiteSpace(inlineValue)) return inlineValue;
            // Accept the established server variable name as well as the
            // DMS-specific name, so deployment does not require copying a
            // private key into the UI or changing an existing secret mount.
            var filePath = ServiceAccountFilePath;
            return !string.IsNullOrWhiteSpace(filePath) && File.Exists(filePath) ? File.ReadAllText(filePath) : null;
        }
    }
    private string? DelegatedAdminEmail => FirstNonEmpty(
        configuration["GoogleDirectory:DelegatedAdminEmail"],
        configuration["GOOGLE_DIRECTORY_DELEGATED_ADMIN_EMAIL"],
        configuration["GOOGLE_SYNC_SUBJECT"]);
    private string Customer => configuration["GoogleDirectory:Customer"] ?? "my_customer";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ServiceAccountJson) && !string.IsNullOrWhiteSpace(DelegatedAdminEmail);

    public async Task<object> GetStatusAsync()
    {
        var syncConfiguration = await GetConfigurationAsync();
        var previous = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(setting => setting.Key == StatusSettingKey);
        return new
        {
            configured = IsConfigured,
            diagnostics = new
            {
                credentialFilePathConfigured = !string.IsNullOrWhiteSpace(ServiceAccountFilePath),
                credentialFileReadable = !string.IsNullOrWhiteSpace(ServiceAccountFilePath) && File.Exists(ServiceAccountFilePath),
                delegatedAdminConfigured = !string.IsNullOrWhiteSpace(DelegatedAdminEmail),
            },
            configuration = syncConfiguration,
            schedule = DescribeSchedule(syncConfiguration),
            lastRun = string.IsNullOrWhiteSpace(previous?.Value) ? null : (object)JsonSerializer.Deserialize<JsonElement>(previous.Value),
        };
    }

    public async Task<GoogleDirectorySyncConfiguration> GetConfigurationAsync()
    {
        var saved = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(setting => setting.Key == ConfigurationSettingKey);
        if (string.IsNullOrWhiteSpace(saved?.Value)) return GoogleDirectorySyncConfiguration.Default;
        try
        {
            return NormalizeConfiguration(JsonSerializer.Deserialize<GoogleDirectorySyncConfiguration>(saved.Value) ?? GoogleDirectorySyncConfiguration.Default);
        }
        catch (JsonException)
        {
            return GoogleDirectorySyncConfiguration.Default;
        }
    }

    public async Task<GoogleDirectorySyncConfiguration> SaveConfigurationAsync(GoogleDirectorySyncConfiguration requested, Guid updatedByUserId, CancellationToken cancellationToken = default)
    {
        var syncConfiguration = NormalizeConfiguration(requested);
        var setting = await context.AppSettings.FirstOrDefaultAsync(item => item.Key == ConfigurationSettingKey, cancellationToken);
        if (setting == null)
        {
            setting = new DmsAppSetting { Key = ConfigurationSettingKey };
            context.AppSettings.Add(setting);
        }
        setting.Value = JsonSerializer.Serialize(syncConfiguration);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = updatedByUserId;
        await context.SaveChangesAsync(cancellationToken);
        return syncConfiguration;
    }

    public async Task<IReadOnlyList<GoogleDirectoryOrganizationalUnit>> GetOrganizationalUnitsAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var token = await GetAccessTokenAsync(cancellationToken);
        var client = httpClientFactory.CreateClient("GoogleDirectory");
        var requestUri = $"https://admin.googleapis.com/admin/directory/v1/customer/{Uri.EscapeDataString(Customer)}/orgunits?type=all";
        using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Google Directory API returned {(int)response.StatusCode}: {body}");

        using var json = JsonDocument.Parse(body);
        var organizationalUnits = new List<GoogleDirectoryOrganizationalUnit>();
        if (json.RootElement.TryGetProperty("organizationUnits", out var items))
        {
            foreach (var item in items.EnumerateArray())
            {
                var path = item.TryGetProperty("orgUnitPath", out var pathElement) ? pathElement.GetString() : null;
                var name = item.TryGetProperty("name", out var nameElement) ? nameElement.GetString() : null;
                if (!string.IsNullOrWhiteSpace(path) && !string.IsNullOrWhiteSpace(name))
                    organizationalUnits.Add(new GoogleDirectoryOrganizationalUnit(path, name));
            }
        }
        return organizationalUnits.OrderBy(unit => unit.Path, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task<GoogleDirectorySyncResult> SyncAsync(CancellationToken cancellationToken = default, string initiatedBy = "Manual")
    {
        EnsureConfigured();
        var syncConfiguration = await GetConfigurationAsync();
        if (syncConfiguration.OrganizationalUnitPaths.Count == 0)
            throw new InvalidOperationException("Select at least one Google Workspace organizational unit before synchronizing users.");

        var token = await GetAccessTokenAsync(cancellationToken);
        var googleUsers = await LoadGoogleUsersAsync(token, syncConfiguration.OrganizationalUnitPaths, cancellationToken);
        var existingByEmail = (await context.Users.ToListAsync(cancellationToken))
            .ToDictionary(user => user.Email, StringComparer.OrdinalIgnoreCase);

        var created = 0;
        var departmentsUpdated = 0;
        var skipped = 0;
        var now = DateTime.UtcNow;
        foreach (var googleUser in googleUsers)
        {
            if (googleUser.Suspended || string.IsNullOrWhiteSpace(googleUser.Email))
            {
                skipped++;
                continue;
            }

            var email = googleUser.Email.Trim().ToLowerInvariant();
            if (existingByEmail.TryGetValue(email, out var existing))
            {
                // Do not erase a manually entered department when Google has no value.
                if (!string.IsNullOrWhiteSpace(googleUser.Department) && !string.Equals(existing.Department, googleUser.Department, StringComparison.Ordinal))
                {
                    existing.Department = googleUser.Department;
                    existing.UpdatedAt = now;
                    departmentsUpdated++;
                }
                continue;
            }

            context.Users.Add(new DmsUser
            {
                UserId = Guid.NewGuid(),
                Email = email,
                FullName = string.IsNullOrWhiteSpace(googleUser.FullName) ? email : googleUser.FullName,
                Department = googleUser.Department,
                Role = "User",
                SsoSubject = googleUser.GoogleId,
                PasswordHash = null,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            });
            existingByEmail[email] = new DmsUser { Email = email };
            created++;
        }

        await context.SaveChangesAsync(cancellationToken);
        var result = new GoogleDirectorySyncResult(googleUsers.Count, created, departmentsUpdated, skipped, now, null, initiatedBy);
        await SaveResultAsync(result, cancellationToken);
        logger.LogInformation("Google Directory {InitiatedBy} sync completed: {Created} created, {Updated} departments updated, {Skipped} skipped", initiatedBy, created, departmentsUpdated, skipped);
        return result;
    }

    public async Task RunScheduledSyncAsync()
    {
        var syncConfiguration = await GetConfigurationAsync();
        if (!syncConfiguration.Enabled || !IsDueNow(syncConfiguration, DateTime.UtcNow, out var scheduleSlot)) return;

        var slotSetting = await context.AppSettings.FirstOrDefaultAsync(item => item.Key == ScheduledSlotSettingKey);
        if (slotSetting?.Value == scheduleSlot) return;
        try
        {
            await SyncAsync(default, "Automatic");
            if (slotSetting == null)
            {
                slotSetting = new DmsAppSetting { Key = ScheduledSlotSettingKey };
                context.AppSettings.Add(slotSetting);
            }
            slotSetting.Value = scheduleSlot;
            slotSetting.UpdatedAt = DateTime.UtcNow;
            slotSetting.UpdatedById = null;
            await context.SaveChangesAsync();
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Scheduled Google Directory user sync failed");
            await SaveResultAsync(new GoogleDirectorySyncResult(0, 0, 0, 0, DateTime.UtcNow, exception.Message, "Automatic"));
        }
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        var credential = GoogleCredential.FromJson(ServiceAccountJson!)
            .CreateScoped(new[] { DirectoryUserReadScope, DirectoryOrgUnitReadScope })
            .CreateWithUser(DelegatedAdminEmail!);
        return await credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: cancellationToken);
    }

    private async Task<List<GoogleDirectoryUser>> LoadGoogleUsersAsync(string accessToken, IReadOnlyCollection<string> organizationalUnitPaths, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("GoogleDirectory");
        var usersByEmail = new Dictionary<string, GoogleDirectoryUser>(StringComparer.OrdinalIgnoreCase);
        foreach (var organizationalUnitPath in organizationalUnitPaths)
        {
            string? pageToken = null;
            do
            {
                var requestUri = $"https://admin.googleapis.com/admin/directory/v1/users?customer={Uri.EscapeDataString(Customer)}&orgUnitPath={Uri.EscapeDataString(organizationalUnitPath)}&maxResults=500&orderBy=email&projection=full" + (pageToken == null ? string.Empty : $"&pageToken={Uri.EscapeDataString(pageToken)}");
                using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                using var response = await client.SendAsync(request, cancellationToken);
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException($"Google Directory API returned {(int)response.StatusCode}: {body}");

                using var json = JsonDocument.Parse(body);
                if (json.RootElement.TryGetProperty("users", out var items))
                {
                    foreach (var item in items.EnumerateArray())
                    {
                        var email = item.TryGetProperty("primaryEmail", out var emailElement) ? emailElement.GetString() : null;
                        var googleId = item.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                        var suspended = item.TryGetProperty("suspended", out var suspendedElement) && suspendedElement.GetBoolean();
                        var fullName = item.TryGetProperty("name", out var nameElement) && nameElement.TryGetProperty("fullName", out var fullNameElement) ? fullNameElement.GetString() : null;
                        if (!string.IsNullOrWhiteSpace(email)) usersByEmail[email] = new GoogleDirectoryUser(email, googleId, fullName, ReadDepartment(item), suspended);
                    }
                }
                pageToken = json.RootElement.TryGetProperty("nextPageToken", out var next) ? next.GetString() : null;
            } while (!string.IsNullOrWhiteSpace(pageToken));
        }
        return usersByEmail.Values.ToList();
    }

    private static string? ReadDepartment(JsonElement user)
    {
        if (!user.TryGetProperty("organizations", out var organizations) || organizations.ValueKind != JsonValueKind.Array) return null;
        var rows = organizations.EnumerateArray().ToList();
        var organization = rows.FirstOrDefault(row => row.TryGetProperty("primary", out var primary) && primary.GetBoolean());
        if (organization.ValueKind == JsonValueKind.Undefined) organization = rows.FirstOrDefault();
        return organization.ValueKind != JsonValueKind.Undefined && organization.TryGetProperty("department", out var department)
            ? CleanDepartment(department.GetString())
            : null;
    }

    private async Task SaveResultAsync(GoogleDirectorySyncResult result, CancellationToken cancellationToken = default)
    {
        var setting = await context.AppSettings.FirstOrDefaultAsync(item => item.Key == StatusSettingKey, cancellationToken);
        if (setting == null) { setting = new DmsAppSetting { Key = StatusSettingKey }; context.AppSettings.Add(setting); }
        setting.Value = JsonSerializer.Serialize(result);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = null;
        await context.SaveChangesAsync(cancellationToken);
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured)
            throw new InvalidOperationException("Google Directory sync is not configured on the Ubuntu server. Mount the service-account JSON file and set GOOGLE_SERVICE_ACCOUNT_KEY_FILE and GOOGLE_SYNC_SUBJECT there.");
    }

    private static GoogleDirectorySyncConfiguration NormalizeConfiguration(GoogleDirectorySyncConfiguration requested)
    {
        var frequency = requested.Frequency?.Trim().ToLowerInvariant();
        if (frequency is not ("daily" or "weekly" or "monthly")) throw new ArgumentException("Frequency must be daily, weekly, or monthly.");
        if (!TimeOnly.TryParseExact(requested.Time ?? string.Empty, "HH:mm", out _)) throw new ArgumentException("Time must use HH:mm format.");
        if (requested.DayOfWeek is < 0 or > 6) throw new ArgumentException("Weekly schedules require a valid day of week.");
        if (requested.DayOfMonth is < 1 or > 28) throw new ArgumentException("Monthly schedules require a day between 1 and 28.");
        return new GoogleDirectorySyncConfiguration(
            requested.Enabled,
            frequency,
            requested.Time!,
            requested.DayOfWeek,
            requested.DayOfMonth,
            string.IsNullOrWhiteSpace(requested.TimeZoneId) ? "Africa/Cairo" : requested.TimeZoneId,
            requested.OrganizationalUnitPaths?.Where(path => !string.IsNullOrWhiteSpace(path)).Select(path => path.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList() ?? []);
    }

    private static bool IsDueNow(GoogleDirectorySyncConfiguration syncConfiguration, DateTime utcNow, out string scheduleSlot)
    {
        scheduleSlot = string.Empty;
        try
        {
            var timeZone = TimeZoneInfo.FindSystemTimeZoneById(syncConfiguration.TimeZoneId);
            var localNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), timeZone);
            if (!TimeOnly.TryParseExact(syncConfiguration.Time, "HH:mm", out var scheduledTime) || localNow.Hour != scheduledTime.Hour || localNow.Minute != scheduledTime.Minute) return false;
            if (syncConfiguration.Frequency == "weekly" && (int)localNow.DayOfWeek != syncConfiguration.DayOfWeek) return false;
            if (syncConfiguration.Frequency == "monthly" && localNow.Day != syncConfiguration.DayOfMonth) return false;
            scheduleSlot = $"{syncConfiguration.Frequency}:{localNow:yyyy-MM-dd}:{syncConfiguration.Time}:{syncConfiguration.TimeZoneId}";
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
    }

    private static string DescribeSchedule(GoogleDirectorySyncConfiguration syncConfiguration)
    {
        if (!syncConfiguration.Enabled) return "Automatic sync is disabled";
        var cadence = syncConfiguration.Frequency switch
        {
            "daily" => "Daily",
            "weekly" => $"Weekly on {(DayOfWeek)syncConfiguration.DayOfWeek}",
            "monthly" => $"Monthly on day {syncConfiguration.DayOfMonth}",
            _ => "Scheduled",
        };
        return $"{cadence} at {syncConfiguration.Time} ({syncConfiguration.TimeZoneId})";
    }

    private static string? FirstNonEmpty(params string?[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

    private static string? CleanDepartment(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim()[..Math.Min(value.Trim().Length, 160)];
    private sealed record GoogleDirectoryUser(string? Email, string? GoogleId, string? FullName, string? Department, bool Suspended);
}

public sealed record GoogleDirectorySyncConfiguration(bool Enabled, string Frequency, string Time, int DayOfWeek, int DayOfMonth, string TimeZoneId, List<string> OrganizationalUnitPaths)
{
    public static GoogleDirectorySyncConfiguration Default => new(false, "weekly", "03:00", 0, 1, "Africa/Cairo", []);
}

public sealed record GoogleDirectoryOrganizationalUnit(string Path, string Name);
public sealed record GoogleDirectorySyncResult(int Seen, int Created, int DepartmentsUpdated, int Skipped, DateTime CompletedAt, string? Error, string InitiatedBy);
