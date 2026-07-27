namespace DMS.Api.Services;

public record GoogleTokenResult(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc);

// The one seam that actually talks to Google — everything else (persistence,
// the sync button, the daily 6 AM job, per-event tracking) is already built and
// wired against this interface. To make real per-user sync work:
//
//   1. In Google Cloud Console: enable the Calendar API, configure an OAuth
//      consent screen, and create an OAuth 2.0 Client ID (type: Web application)
//      with an authorized redirect URI pointing at
//      GET /api/googlecalendar/callback on this API's public URL.
//   2. Add the client ID/secret to configuration (appsettings/.env — not source
//      control) and read them in your implementation of this interface.
//   3. Implement each method below, most easily via the Google.Apis.Auth and
//      Google.Apis.Calendar.v3 NuGet packages:
//        - BuildAuthorizationUrl: GoogleAuthorizationCodeFlow or a manually built
//          https://accounts.google.com/o/oauth2/v2/auth URL with
//          scope=https://www.googleapis.com/auth/calendar.events.
//        - ExchangeCodeForTokensAsync / RefreshAccessTokenAsync: token endpoint
//          calls (GoogleAuthorizationCodeFlow.ExchangeCodeForTokenAsync /
//          RefreshTokenAsync).
//        - UpsertEventAsync / DeleteEventAsync: CalendarService.Events.Insert /
//          Update / Delete against calendarId "primary" for the connected user.
//   4. In Program.cs, replace the DI registration:
//        builder.Services.AddSingleton<IGoogleOAuthCalendarClient, GoogleOAuthCalendarClient>();
//      (currently NotConfiguredGoogleOAuthCalendarClient).
//
// SECURITY NOTE for the OAuth callback: the `state` parameter passed through
// GoogleCalendarController.Connect/Callback currently carries the raw user ID.
// That is enough to prove "sync for this user" once Google redirects back, but
// it does NOT protect against CSRF (an attacker could trick a victim's browser
// into completing an OAuth flow initiated with a different state). Before
// shipping this to production, replace it with a short-lived, server-generated
// nonce stored against the user's session and validated on callback.
public interface IGoogleOAuthCalendarClient
{
    bool IsConfigured { get; }

    string BuildAuthorizationUrl(string state);

    Task<GoogleTokenResult> ExchangeCodeForTokensAsync(string code);

    Task<GoogleTokenResult> RefreshAccessTokenAsync(string refreshToken);

    // Creates the event if existingGoogleEventId is null, otherwise updates it in place.
    // Returns the Google event ID (unchanged on update).
    Task<string> UpsertEventAsync(string accessToken, string? existingGoogleEventId, string title, DateOnly date, string? notes);

    Task DeleteEventAsync(string accessToken, string googleEventId);
}

public class NotConfiguredGoogleOAuthCalendarClient : IGoogleOAuthCalendarClient
{
    public bool IsConfigured => false;

    private static Exception NotConfigured() =>
        new InvalidOperationException("Google Calendar sync is not configured yet — see IGoogleOAuthCalendarClient.cs.");

    public string BuildAuthorizationUrl(string state) => throw NotConfigured();
    public Task<GoogleTokenResult> ExchangeCodeForTokensAsync(string code) => throw NotConfigured();
    public Task<GoogleTokenResult> RefreshAccessTokenAsync(string refreshToken) => throw NotConfigured();
    public Task<string> UpsertEventAsync(string accessToken, string? existingGoogleEventId, string title, DateOnly date, string? notes) => throw NotConfigured();
    public Task DeleteEventAsync(string accessToken, string googleEventId) => throw NotConfigured();
}
