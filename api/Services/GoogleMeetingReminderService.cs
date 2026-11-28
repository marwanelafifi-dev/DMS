using System.Net;
using System.Text.RegularExpressions;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// Scans every connected user's own Google Calendar for upcoming meetings
// whose title contains "ISO" (case-insensitive) and fires 3 reminders per
// meeting — on first sight ("created"), 1 day before, and 10 minutes before —
// each as both an email (to every real attendee's address on the event,
// pulled straight from Google — not just the DMS account that happened to
// have its calendar connected) and an in-app notification (for whichever of
// those attendees also happens to be a DMS user). Runs as a Hangfire
// recurring job every 5 minutes (see BackgroundJobService); 5-minute cadence
// is what makes the "10 minutes before" stage land close enough to on-time.
public class GoogleMeetingReminderService(
    DmsContext context,
    UserGoogleCalendarService calendarService,
    NotificationService notificationService,
    EmailService emailService,
    ILogger<GoogleMeetingReminderService> logger)
{
    private const string TitleFilter = "iso";

    public async Task ScanAndSendAsync()
    {
        var connections = await context.UserCalendarConnections
            .Where(c => c.IsActive)
            .Include(c => c.User)
            .ToListAsync();

        if (connections.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var windowEnd = now.AddDays(35);

        // Multiple connected accounts can see the same physical meeting (if
        // both are attendees and both connected their calendars) — dedupe by
        // event ID within this pass so it isn't processed twice in one scan.
        var processedEventIds = new HashSet<string>();

        foreach (var connection in connections)
        {
            if (connection.User == null || !connection.User.IsActive)
                continue;

            try
            {
                var events = await calendarService.TryGetEventsAsync(connection.UserId, now, windowEnd);
                if (events == null)
                    continue;

                var matches = events.Where(e => !e.IsAllDay && e.Title.Contains(TitleFilter, StringComparison.OrdinalIgnoreCase));

                foreach (var meeting in matches)
                {
                    if (!processedEventIds.Add(meeting.Id))
                        continue;

                    await ProcessMeetingAsync(meeting, connection.User, now);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to scan ISO meetings for user {UserId}", connection.UserId);
            }
        }
    }

    private async Task ProcessMeetingAsync(GoogleCalendarEventSummary meeting, DmsUser discoveredByUser, DateTime now)
    {
        var tracking = await context.GoogleMeetingReminders.AsNoTracking()
            .FirstOrDefaultAsync(r => r.GoogleEventId == meeting.Id);

        if (tracking == null)
        {
            // Real attendees pulled from the event; if there are none listed
            // (a solo entry with no guests), fall back to whichever connected
            // account's calendar surfaced it so a reminder still goes somewhere.
            var attendeeEmails = meeting.Attendees?
                .Select(a => a.Email)
                .Where(e => !string.IsNullOrWhiteSpace(e))
                .Select(e => e!.Trim().ToLowerInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList() ?? [];

            if (attendeeEmails.Count == 0 && !string.IsNullOrWhiteSpace(discoveredByUser.Email))
                attendeeEmails.Add(discoveredByUser.Email.Trim().ToLowerInvariant());

            tracking = new DmsGoogleMeetingReminder
            {
                ReminderId = Guid.NewGuid(),
                GoogleEventId = meeting.Id,
                Title = meeting.Title,
                MeetingStart = meeting.Start,
                AttendeeEmails = attendeeEmails,
                CreatedAt = now,
            };
            var created = await context.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO dms_google_meeting_reminders
                    (reminder_id, google_event_id, title, meeting_start, attendee_emails, created_at, created_reminder_sent)
                VALUES ({tracking.ReminderId}, {tracking.GoogleEventId}, {tracking.Title}, {tracking.MeetingStart},
                    {attendeeEmails.ToArray()}, {tracking.CreatedAt}, true)
                ON CONFLICT (google_event_id) DO NOTHING
                """);
            if (created == 1)
                await SendToAllRecipientsAsync(tracking, meeting, "created", "New ISO meeting scheduled",
                    "A new ISO meeting has just been added to the calendar.", AccentNavy);
            return;
        }

        // Keep the tracked title/time current in case the meeting was renamed
        // or rescheduled — doesn't reset which stages already fired, and
        // doesn't touch the attendee snapshot captured at creation.
        var trackedMeeting = context.GoogleMeetingReminders.Where(r => r.ReminderId == tracking.ReminderId);
        if (tracking.Title != meeting.Title || tracking.MeetingStart != meeting.Start)
            await trackedMeeting.ExecuteUpdateAsync(setters => setters
                .SetProperty(r => r.Title, meeting.Title)
                .SetProperty(r => r.MeetingStart, meeting.Start));

        var timeUntil = meeting.Start - now;

        if (!tracking.DayBeforeReminderSent && timeUntil <= TimeSpan.FromDays(1) && timeUntil > TimeSpan.Zero)
        {
            // Claim the stage before SMTP so an overlapping or retried scan
            // cannot send it a second time.
            var claimed = await trackedMeeting.Where(r => !r.DayBeforeReminderSent)
                .ExecuteUpdateAsync(setters => setters.SetProperty(r => r.DayBeforeReminderSent, true));
            if (claimed == 1)
                await SendToAllRecipientsAsync(tracking, meeting, "day_before", "ISO meeting tomorrow",
                    "This ISO meeting is coming up in about a day.", AccentNavy);
        }

        if (!tracking.TenMinReminderSent && timeUntil <= TimeSpan.FromMinutes(10) && timeUntil > TimeSpan.FromMinutes(-2))
        {
            var claimed = await trackedMeeting.Where(r => !r.TenMinReminderSent)
                .ExecuteUpdateAsync(setters => setters.SetProperty(r => r.TenMinReminderSent, true));
            if (claimed == 1)
                await SendToAllRecipientsAsync(tracking, meeting, "ten_minutes_before", "ISO meeting starting soon",
                    "This ISO meeting starts in about 10 minutes.", AccentNavy);
        }
    }

    // One consistent brand accent (matches the template's own navy header)
    // across every reminder stage, instead of varying by urgency.
    private const string AccentNavy = "#002E5C";

    private async Task SendToAllRecipientsAsync(DmsGoogleMeetingReminder tracking, GoogleCalendarEventSummary meeting, string stage, string subject, string leadLine, string accentColor)
    {
        if (tracking.AttendeeEmails.Count == 0)
            return;

        var plainBody = $"{leadLine} \"{meeting.Title}\" — {FormatWhen(meeting.Start)}.";

        // A given attendee's email might also belong to a real DMS user
        // (case-insensitive match) — those get the in-app notification too.
        var matchedUsers = await context.Users
            .Where(u => u.IsActive && tracking.AttendeeEmails.Contains(u.Email.ToLower()))
            .ToListAsync();

        foreach (var user in matchedUsers)
            await notificationService.NotifyAsync(user.UserId, Guid.Empty, subject, plainBody,
                deliveryAudit: new EmailDeliveryAudit(Guid.Empty, "google_meeting_reminder", user.UserId, tracking.ReminderId, stage));

        var html = EmailService.BuildBrandedHtml(meeting.Title, accentColor, BuildMeetingDetailsHtml(meeting, leadLine));
        var usersByEmail = matchedUsers.ToLookup(user => user.Email, StringComparer.OrdinalIgnoreCase);
        var emailCount = 0;
        foreach (var email in tracking.AttendeeEmails.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var recipientId = usersByEmail[email].FirstOrDefault()?.UserId;
            var audit = new EmailDeliveryAudit(Guid.Empty, "google_meeting_reminder", recipientId, tracking.ReminderId, stage);
            if (await emailService.SendAsync(email, subject, html, audit)) emailCount++;
        }

        logger.LogInformation(
            "SMTP accepted ISO meeting reminder '{Subject}' for meeting {MeetingId} for {EmailCount} attendee(s)",
            subject, meeting.Id, emailCount);
    }

    // Full meeting detail block reused by all 3 reminder stages — subject
    // (rendered as the template's headline instead), description, location,
    // attendees, and the online meeting link if one exists.
    private static string BuildMeetingDetailsHtml(GoogleCalendarEventSummary meeting, string leadLine)
    {
        static string Enc(string s) => WebUtility.HtmlEncode(s);

        var rows = new List<string>
        {
            $"""<p style="margin:0 0 16px;font-size:14px;color:#3c4043;">{Enc(leadLine)}</p>""",
            $"""<p style="margin:0 0 4px;font-size:13px;color:#5f6368;"><strong>When:</strong> {Enc(FormatWhen(meeting.Start))} – {Enc(meeting.End.ToLocalTime().ToString("h:mm tt"))}</p>""",
        };

        if (!string.IsNullOrWhiteSpace(meeting.Location))
            rows.Add($"""<p style="margin:0 0 4px;font-size:13px;color:#5f6368;"><strong>Location:</strong> {Enc(meeting.Location)}</p>""");

        if (meeting.Attendees is { Count: > 0 })
        {
            var names = string.Join(", ", meeting.Attendees.Select(a => Enc(a.DisplayName ?? a.Email ?? "Unknown")));
            rows.Add($"""<p style="margin:0 0 4px;font-size:13px;color:#5f6368;"><strong>Attendees ({meeting.Attendees.Count}):</strong> {names}</p>""");
        }

        if (!string.IsNullOrWhiteSpace(meeting.Description))
            rows.Add($"""<div style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#3c4043;">{FormatDescriptionHtml(meeting.Description)}</div>""");

        if (meeting.Attachments is { Count: > 0 })
        {
            var links = string.Join("<br/>", meeting.Attachments.Select(a =>
                $"""<a href="{a.FileUrl}" style="color:#1a73e8;text-decoration:none;">{Enc(a.Title)}</a>"""));
            rows.Add($"""<p style="margin:12px 0 0;font-size:13px;color:#5f6368;"><strong>Attachments:</strong><br/>{links}</p>""");
        }

        if (!string.IsNullOrEmpty(meeting.ConferenceLink))
        {
            rows.Add($"""
                <p style="margin:20px 0 0;">
                  <a href="{meeting.ConferenceLink}" style="display:inline-block;background:#1a73e8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:4px;">
                    Join {Enc(meeting.ConferenceLabel ?? "video meeting")}
                  </a>
                </p>
                """);
        }

        return string.Join("\n", rows);
    }

    // Google Calendar descriptions can be either plain text or HTML. They are
    // external input, so do not place their markup directly into an email.
    // Instead, retain useful paragraph/list structure, discard markup, then
    // encode the resulting text before converting line breaks for email.
    private static string FormatDescriptionHtml(string description)
    {
        var text = Regex.Replace(description, @"<\s*br\s*/?\s*>", "\n", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"</\s*p\s*>", "\n\n", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<\s*li\b[^>]*>", "\n• ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"</\s*li\s*>", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"<[^>]+>", "");
        text = WebUtility.HtmlDecode(text);
        text = Regex.Replace(text, @"[ \t]+\n", "\n");
        text = Regex.Replace(text, @"\n{3,}", "\n\n").Trim();
        return WebUtility.HtmlEncode(text).Replace("\r\n", "<br />").Replace("\n", "<br />");
    }

    private static string FormatWhen(DateTime utc) => utc.ToLocalTime().ToString("dddd, MMM d 'at' h:mm tt");
}
