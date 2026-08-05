using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Calendar.v3;
using Google.Apis.Calendar.v3.Data;
using Google.Apis.Services;

namespace DMS.Api.Services;

// Real implementation of the one seam IGoogleOAuthCalendarClient.cs describes —
// everything else (persistence, the sync button, the daily job) was already
// built against this interface and needed no changes.
public class GoogleOAuthCalendarClient : IGoogleOAuthCalendarClient
{
    private const string CalendarScope = "https://www.googleapis.com/auth/calendar.events";

    private readonly string? _clientId;
    private readonly string? _clientSecret;
    private readonly string? _redirectUri;
    private readonly GoogleAuthorizationCodeFlow? _flow;

    public GoogleOAuthCalendarClient(IConfiguration configuration)
    {
        _clientId = configuration["Google:ClientId"];
        _clientSecret = configuration["Google:ClientSecret"];
        _redirectUri = configuration["Google:CalendarRedirectUri"];

        if (IsConfigured)
        {
            _flow = new GoogleAuthorizationCodeFlow(new GoogleAuthorizationCodeFlow.Initializer
            {
                ClientSecrets = new ClientSecrets { ClientId = _clientId, ClientSecret = _clientSecret },
                Scopes = [CalendarScope],
            });
        }
    }

    public bool IsConfigured =>
        !string.IsNullOrEmpty(_clientId) && !string.IsNullOrEmpty(_clientSecret) && !string.IsNullOrEmpty(_redirectUri);

    private Exception NotConfigured() =>
        new InvalidOperationException("Google Calendar sync is not configured yet — see IGoogleOAuthCalendarClient.cs.");

    public string BuildAuthorizationUrl(string state)
    {
        if (_flow == null) throw NotConfigured();

        // GoogleAuthorizationCodeFlow's request builder already sets
        // access_type=offline by default. prompt=consent still needs adding
        // by hand — without it Google only issues a refresh token the very
        // first time a given account ever consents to this app, so a
        // reconnect after a disconnect would silently come back with none.
        var request = _flow.CreateAuthorizationCodeRequest(_redirectUri);
        request.State = state;
        var builder = new UriBuilder(request.Build());
        var query = System.Web.HttpUtility.ParseQueryString(builder.Query);
        query["prompt"] = "consent";
        builder.Query = query.ToString();
        return builder.Uri.ToString();
    }

    public async Task<GoogleTokenResult> ExchangeCodeForTokensAsync(string code)
    {
        if (_flow == null) throw NotConfigured();

        TokenResponse token = await _flow.ExchangeCodeForTokenAsync(
            userId: "unused", code: code, redirectUri: _redirectUri, taskCancellationToken: default);

        if (string.IsNullOrEmpty(token.RefreshToken))
            throw new InvalidOperationException(
                "Google did not return a refresh token. Disconnect this Google account's access to the app at https://myaccount.google.com/permissions and reconnect.");

        return new GoogleTokenResult(
            token.AccessToken,
            token.RefreshToken,
            DateTime.UtcNow.AddSeconds(token.ExpiresInSeconds ?? 3600));
    }

    public async Task<GoogleTokenResult> RefreshAccessTokenAsync(string refreshToken)
    {
        if (_flow == null) throw NotConfigured();

        var token = await _flow.RefreshTokenAsync(userId: "unused", refreshToken: refreshToken, taskCancellationToken: default);

        return new GoogleTokenResult(
            token.AccessToken,
            token.RefreshToken ?? refreshToken,
            DateTime.UtcNow.AddSeconds(token.ExpiresInSeconds ?? 3600));
    }

    public async Task<string> UpsertEventAsync(string accessToken, string? existingGoogleEventId, string title, DateOnly date, string? notes)
    {
        using var service = BuildCalendarService(accessToken);

        var eventBody = new Event
        {
            Summary = title,
            Description = notes,
            Start = new EventDateTime { Date = date.ToString("yyyy-MM-dd") },
            // A single all-day event spans [Start.Date, End.Date) per Google's API.
            End = new EventDateTime { Date = date.AddDays(1).ToString("yyyy-MM-dd") },
        };

        Event result = string.IsNullOrEmpty(existingGoogleEventId)
            ? await service.Events.Insert(eventBody, "primary").ExecuteAsync()
            : await service.Events.Update(eventBody, "primary", existingGoogleEventId).ExecuteAsync();

        return result.Id;
    }

    public async Task DeleteEventAsync(string accessToken, string googleEventId)
    {
        using var service = BuildCalendarService(accessToken);
        await service.Events.Delete("primary", googleEventId).ExecuteAsync();
    }

    public async Task<List<GoogleCalendarEventSummary>> ListEventsAsync(string accessToken, DateTime timeMinUtc, DateTime timeMaxUtc, int maxResults = 250)
    {
        using var service = BuildCalendarService(accessToken);

        var request = service.Events.List("primary");
        request.TimeMinDateTimeOffset = new DateTimeOffset(DateTime.SpecifyKind(timeMinUtc, DateTimeKind.Utc));
        request.TimeMaxDateTimeOffset = new DateTimeOffset(DateTime.SpecifyKind(timeMaxUtc, DateTimeKind.Utc));
        request.SingleEvents = true;
        request.OrderBy = EventsResource.ListRequest.OrderByEnum.StartTime;
        request.MaxResults = maxResults;

        var response = await request.ExecuteAsync();

        return response.Items
            .Where(e => e.Start != null && e.End != null)
            .Select(e =>
            {
                var isAllDay = !string.IsNullOrEmpty(e.Start.Date);
                var start = isAllDay ? DateTime.Parse(e.Start.Date!) : (e.Start.DateTimeDateTimeOffset?.UtcDateTime ?? DateTime.UtcNow);
                var end = isAllDay ? DateTime.Parse(e.End.Date!) : (e.End.DateTimeDateTimeOffset?.UtcDateTime ?? start);

                // Native Google Meet links land on HangoutLink; third-party
                // conferencing (Zoom, Teams, etc. added via a Calendar add-on)
                // shows up as a video entry point in ConferenceData instead —
                // check both rather than assuming every meeting is Meet.
                var videoEntryPoint = e.ConferenceData?.EntryPoints?.FirstOrDefault(ep => ep.EntryPointType == "video");
                var conferenceLink = e.HangoutLink ?? videoEntryPoint?.Uri;
                var conferenceLabel = e.ConferenceData?.ConferenceSolution?.Name;

                var attachments = e.Attachments?
                    .Where(a => !string.IsNullOrEmpty(a.FileUrl))
                    .Select(a => new GoogleCalendarAttachment(a.Title ?? "Attachment", a.FileUrl, a.IconLink, a.MimeType))
                    .ToList();

                // Booked meeting rooms/equipment show up as attendees whose
                // Resource flag is true (email ending in
                // @resource.calendar.google.com) — not real guests, and
                // already surfaced via Location, so they're excluded here to
                // match what Google's own UI counts as "N guests".
                var attendees = e.Attendees?
                    .Where(a => a.Resource != true)
                    .Select(a => new GoogleCalendarAttendee(a.Email, a.DisplayName, a.ResponseStatus ?? "needsAction", a.Organizer == true))
                    .ToList();

                return new GoogleCalendarEventSummary(
                    e.Id, e.Summary ?? "(no title)", start, end, isAllDay, e.Description,
                    e.Location, conferenceLink, conferenceLabel, attachments, attendees);
            })
            .ToList();
    }

    private static CalendarService BuildCalendarService(string accessToken) => new(new BaseClientService.Initializer
    {
        HttpClientInitializer = GoogleCredential.FromAccessToken(accessToken),
        ApplicationName = "Si-Ware DMS",
    });
}
