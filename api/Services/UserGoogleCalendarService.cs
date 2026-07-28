using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class UserGoogleCalendarService(
    DmsContext context,
    IGoogleOAuthCalendarClient googleClient,
    AuditService auditService,
    ILogger<UserGoogleCalendarService> logger)
{
    public async Task<object> GetStatusAsync(Guid userId)
    {
        var connection = await context.UserCalendarConnections
            .FirstOrDefaultAsync(c => c.UserId == userId && c.IsActive);

        return new
        {
            Connected = connection != null,
            connection?.ConnectedAt,
            connection?.LastSyncedAt,
            connection?.LastSyncError,
            GoogleConfigured = googleClient.IsConfigured,
        };
    }

    public GoogleCalendarResult GetAuthorizationUrl(Guid userId)
    {
        if (!googleClient.IsConfigured)
            return GoogleCalendarResult.NotConfigured();

        // See the security note in IGoogleOAuthCalendarClient.cs — state should
        // become a signed/opaque nonce before this goes to production.
        var url = googleClient.BuildAuthorizationUrl(userId.ToString());
        return GoogleCalendarResult.Ok(new { authUrl = url });
    }

    public async Task<GoogleCalendarResult> HandleCallbackAsync(string state, string code)
    {
        if (!Guid.TryParse(state, out var userId))
            return GoogleCalendarResult.Invalid("Invalid OAuth state");

        try
        {
            var tokens = await googleClient.ExchangeCodeForTokensAsync(code);

            var connection = await context.UserCalendarConnections.FirstOrDefaultAsync(c => c.UserId == userId);
            if (connection == null)
            {
                connection = new DmsUserCalendarConnection
                {
                    ConnectionId = Guid.NewGuid(),
                    UserId = userId,
                    ConnectedAt = DateTime.UtcNow,
                };
                context.UserCalendarConnections.Add(connection);
            }

            connection.AccessToken = tokens.AccessToken;
            connection.RefreshToken = tokens.RefreshToken;
            connection.TokenExpiresAt = tokens.ExpiresAtUtc;
            connection.IsActive = true;
            connection.LastSyncError = null;

            await context.SaveChangesAsync();
            await auditService.LogAsync(userId, AuditActions.GOOGLE_CALENDAR_CONNECTED, new { userId });

            logger.LogInformation("User {UserId} connected their Google Calendar", userId);
            return GoogleCalendarResult.Ok(new { connected = true });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Google Calendar OAuth callback failed for user {UserId}", userId);
            return GoogleCalendarResult.Fail(ex.Message);
        }
    }

    public async Task<GoogleCalendarResult> DisconnectAsync(Guid userId)
    {
        var connection = await context.UserCalendarConnections.FirstOrDefaultAsync(c => c.UserId == userId);
        if (connection == null)
            return GoogleCalendarResult.NotFound("No calendar connection to remove");

        context.UserCalendarConnections.Remove(connection);
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, AuditActions.GOOGLE_CALENDAR_DISCONNECTED, new { userId });

        logger.LogInformation("User {UserId} disconnected their Google Calendar", userId);
        return GoogleCalendarResult.Ok(new { connected = false });
    }

    // Pushes every upcoming audit event into this one user's Google Calendar,
    // creating new entries or updating ones already synced. Called by the
    // "Sync Now" button and by the daily 6 AM Hangfire sweep.
    public async Task<GoogleCalendarResult> SyncUserAsync(Guid userId)
    {
        var connection = await context.UserCalendarConnections.FirstOrDefaultAsync(c => c.UserId == userId && c.IsActive);
        if (connection == null)
            return GoogleCalendarResult.NotFound("Google Calendar is not connected for this user");

        if (!googleClient.IsConfigured)
        {
            connection.LastSyncError = "Google Calendar sync is not configured on the server";
            await context.SaveChangesAsync();
            return GoogleCalendarResult.NotConfigured();
        }

        try
        {
            var accessToken = await EnsureFreshAccessTokenAsync(connection);

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var upcomingEvents = await context.AuditCalendarEvents
                .Where(e => e.EventDate >= today)
                .ToListAsync();

            var existingSyncs = await context.UserCalendarEventSyncs
                .Where(s => s.UserId == userId)
                .ToDictionaryAsync(s => s.EventId);

            var pushed = 0;
            var errors = new List<string>();

            foreach (var auditEvent in upcomingEvents)
            {
                try
                {
                    existingSyncs.TryGetValue(auditEvent.EventId, out var existingSync);
                    var googleEventId = await googleClient.UpsertEventAsync(
                        accessToken, existingSync?.GoogleEventId, auditEvent.Title, auditEvent.EventDate, auditEvent.Notes);

                    if (existingSync != null)
                    {
                        existingSync.GoogleEventId = googleEventId;
                        existingSync.SyncedAt = DateTime.UtcNow;
                    }
                    else
                    {
                        context.UserCalendarEventSyncs.Add(new DmsUserCalendarEventSync
                        {
                            SyncId = Guid.NewGuid(),
                            UserId = userId,
                            EventId = auditEvent.EventId,
                            GoogleEventId = googleEventId,
                            SyncedAt = DateTime.UtcNow,
                        });
                    }
                    pushed++;
                }
                catch (Exception ex)
                {
                    errors.Add($"{auditEvent.Title}: {ex.Message}");
                    logger.LogWarning(ex, "Failed to sync audit event {EventId} for user {UserId}", auditEvent.EventId, userId);
                }
            }

            connection.LastSyncedAt = DateTime.UtcNow;
            connection.LastSyncError = errors.Count > 0 ? string.Join("; ", errors) : null;
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.GOOGLE_CALENDAR_SYNCED, new
            {
                userId,
                Pushed = pushed,
                Failed = errors.Count,
                SyncedAt = connection.LastSyncedAt,
            });

            logger.LogInformation("Synced {Pushed} audit events to user {UserId}'s Google Calendar ({Failed} failed)", pushed, userId, errors.Count);
            return GoogleCalendarResult.Ok(new { pushed, failed = errors.Count, errors });
        }
        catch (Exception ex)
        {
            connection.LastSyncError = ex.Message;
            await context.SaveChangesAsync();
            logger.LogError(ex, "Google Calendar sync failed for user {UserId}", userId);
            return GoogleCalendarResult.Fail(ex.Message);
        }
    }

    // Used by the daily Hangfire job to sweep every connected user. Failures for
    // one user (expired refresh token, revoked access, etc.) don't stop the rest.
    public async Task SyncAllActiveUsersAsync()
    {
        var userIds = await context.UserCalendarConnections
            .Where(c => c.IsActive)
            .Select(c => c.UserId)
            .ToListAsync();

        logger.LogInformation("Starting daily Google Calendar sync for {Count} connected users", userIds.Count);

        var succeeded = 0;
        foreach (var userId in userIds)
        {
            var result = await SyncUserAsync(userId);
            if (result.Success) succeeded++;
        }

        logger.LogInformation("Daily Google Calendar sync complete: {Succeeded}/{Total} users synced", succeeded, userIds.Count);
    }

    private async Task<string> EnsureFreshAccessTokenAsync(DmsUserCalendarConnection connection)
    {
        if (connection.TokenExpiresAt > DateTime.UtcNow.AddMinutes(2))
            return connection.AccessToken;

        var refreshed = await googleClient.RefreshAccessTokenAsync(connection.RefreshToken);
        connection.AccessToken = refreshed.AccessToken;
        connection.TokenExpiresAt = refreshed.ExpiresAtUtc;
        // Google does not always return a new refresh token on refresh — keep the
        // existing one unless a new one was actually issued.
        if (!string.IsNullOrEmpty(refreshed.RefreshToken))
            connection.RefreshToken = refreshed.RefreshToken;

        return connection.AccessToken;
    }
}

public class GoogleCalendarResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static GoogleCalendarResult Ok(object data) => new() { Success = true, Data = data };
    public static GoogleCalendarResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static GoogleCalendarResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static GoogleCalendarResult Fail(string message) => new() { Success = false, Message = message, Error = "InternalError" };
    public static GoogleCalendarResult NotConfigured() => new() { Success = false, Message = "Google Calendar sync is not configured on the server yet", Error = "NotConfigured" };
}
