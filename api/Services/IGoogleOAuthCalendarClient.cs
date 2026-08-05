namespace DMS.Api.Services;

public record GoogleTokenResult(string AccessToken, string RefreshToken, DateTime ExpiresAtUtc);

public record GoogleCalendarAttachment(string Title, string FileUrl, string? IconLink, string? MimeType);

// ResponseStatus mirrors Google's own values: "accepted" | "declined" | "tentative" | "needsAction".
public record GoogleCalendarAttendee(string? Email, string? DisplayName, string ResponseStatus, bool IsOrganizer);

public record GoogleCalendarEventSummary(
    string Id, string Title, DateTime Start, DateTime End, bool IsAllDay, string? Description,
    string? Location = null, string? ConferenceLink = null, string? ConferenceLabel = null,
    List<GoogleCalendarAttachment>? Attachments = null, List<GoogleCalendarAttendee>? Attendees = null);

// The seam that actually talks to Google, implemented by GoogleOAuthCalendarClient
// using Google.Apis.Auth's GoogleAuthorizationCodeFlow and Google.Apis.Calendar.v3.
// Requires three config values (Google:ClientId, Google:ClientSecret,
// Google:CalendarRedirectUri — see appsettings.json / GOOGLE_CLIENT_SECRET /
// GOOGLE_CALENDAR_REDIRECT_URI in .env); IsConfigured is false and every method
// throws a clear error until all three are set, so a missing config never looks
// like a silent no-op.
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

    // Read-only pull for the personal "My Google Calendar" view — lists the
    // signed-in user's own events on their primary calendar within
    // [timeMin, timeMax), so the frontend can browse any month like a real
    // calendar rather than only ever seeing "upcoming". Never persisted to
    // the DMS database; fetched fresh on every request.
    Task<List<GoogleCalendarEventSummary>> ListEventsAsync(string accessToken, DateTime timeMinUtc, DateTime timeMaxUtc, int maxResults = 250);
}
