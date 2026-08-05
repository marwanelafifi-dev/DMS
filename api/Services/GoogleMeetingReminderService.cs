using System.Net;
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
        var tracking = await context.GoogleMeetingReminders
            .FirstOrDefaultAsync(r => r.GoogleEventId == meeting.Id);

        if (tracking == null)
        {
            // Real attendees pulled from the event; if there are none listed
            // (a solo entry with no guests), fall back to whichever connected
            // account's calendar surfaced it so a reminder still goes somewhere.
            var attendeeEmails = meeting.Attendees?
                .Select(a => a.Email)
                .Where(e => !string.IsNullOrWhiteSpace(e))
                .Select(e => e!.ToLowerInvariant())
                .Distinct()
                .ToList() ?? [];

            if (attendeeEmails.Count == 0 && !string.IsNullOrWhiteSpace(discoveredByUser.Email))
                attendeeEmails.Add(discoveredByUser.Email.ToLowerInvariant());

            tracking = new DmsGoogleMeetingReminder
            {
                ReminderId = Guid.NewGuid(),
                GoogleEventId = meeting.Id,
                Title = meeting.Title,
                MeetingStart = meeting.Start,
                AttendeeEmails = attendeeEmails,
                CreatedAt = now,
            };
            context.GoogleMeetingReminders.Add(tracking);
            await context.SaveChangesAsync();

            await SendToAllRecipientsAsync(tracking, meeting, "New ISO meeting scheduled",
                "A new ISO meeting has just been added to the calendar.", AccentNavy);
            tracking.CreatedReminderSent = true;
            await context.SaveChangesAsync();
            return;
        }

        // Keep the tracked title/time current in case the meeting was renamed
        // or rescheduled — doesn't reset which stages already fired, and
        // doesn't touch the attendee snapshot captured at creation.
        tracking.Title = meeting.Title;
        tracking.MeetingStart = meeting.Start;

        var timeUntil = meeting.Start - now;

        if (!tracking.DayBeforeReminderSent && timeUntil <= TimeSpan.FromDays(1) && timeUntil > TimeSpan.Zero)
        {
            await SendToAllRecipientsAsync(tracking, meeting, "ISO meeting tomorrow",
                "This ISO meeting is coming up in about a day.", AccentNavy);
            tracking.DayBeforeReminderSent = true;
        }

        if (!tracking.TenMinReminderSent && timeUntil <= TimeSpan.FromMinutes(10) && timeUntil > TimeSpan.FromMinutes(-2))
        {
            await SendToAllRecipientsAsync(tracking, meeting, "ISO meeting starting soon",
                "This ISO meeting starts in about 10 minutes.", AccentNavy);
            tracking.TenMinReminderSent = true;
        }

        await context.SaveChangesAsync();
    }

    // One consistent brand accent (matches the template's own navy header)
    // across every reminder stage, instead of varying by urgency.
    private const string AccentNavy = "#002E5C";

    private async Task SendToAllRecipientsAsync(DmsGoogleMeetingReminder tracking, GoogleCalendarEventSummary meeting, string subject, string leadLine, string accentColor)
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
            await notificationService.NotifyAsync(user.UserId, Guid.Empty, subject, plainBody);

        if (!await emailService.IsConfiguredAsync())
        {
            logger.LogWarning("Skipped emailing {Count} attendee(s) for meeting {MeetingId} — SMTP not configured", tracking.AttendeeEmails.Count, meeting.Id);
            return;
        }

        var html = EmailService.BuildBrandedHtml(meeting.Title, accentColor, BuildMeetingDetailsHtml(meeting, leadLine));
        foreach (var email in tracking.AttendeeEmails)
            await emailService.SendAsync(email, subject, html);

        logger.LogInformation(
            "Sent ISO meeting reminder '{Subject}' for meeting {MeetingId} to {EmailCount} attendee(s) ({InAppCount} in-app)",
            subject, meeting.Id, tracking.AttendeeEmails.Count, matchedUsers.Count);
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
            rows.Add($"""<p style="margin:12px 0 0;font-size:13px;color:#3c4043;white-space:pre-wrap;">{Enc(meeting.Description)}</p>""");

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

    private static string FormatWhen(DateTime utc) => utc.ToLocalTime().ToString("dddd, MMM d 'at' h:mm tt");
}
