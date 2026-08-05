namespace DMS.Api.Models;

// Dedup/state row for the "ISO" meeting reminder pipeline — one per Google
// Calendar event (not per DMS user), since reminders go out to every real
// attendee's email pulled from the event itself, not just whichever DMS
// account's connected calendar happened to surface it during a scan.
public class DmsGoogleMeetingReminder
{
    public Guid ReminderId { get; set; }
    public string GoogleEventId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public DateTime MeetingStart { get; set; }
    public List<string> AttendeeEmails { get; set; } = [];
    public bool CreatedReminderSent { get; set; }
    public bool DayBeforeReminderSent { get; set; }
    public bool TenMinReminderSent { get; set; }
    public DateTime CreatedAt { get; set; }
}
