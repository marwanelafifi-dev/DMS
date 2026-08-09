using Hangfire;

namespace DMS.Api.Services;

public class BackgroundJobService(CheckoutService checkoutService, ILogger<BackgroundJobService> logger)
{
    public async Task RunAutoUnlockCheckoutsAsync()
    {
        try
        {
            logger.LogInformation("Starting auto-unlock checkout job at {Time}", DateTime.UtcNow);

            var unlockedCount = await checkoutService.AutoUnlockExpiredCheckoutsAsync();

            if (unlockedCount > 0)
            {
                logger.LogInformation("Auto-unlocked {Count} expired checkouts", unlockedCount);
            }
            else
            {
                logger.LogDebug("No expired checkouts to unlock");
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error in auto-unlock checkout job");
        }
    }
}

/// <summary>
/// Extension methods for Hangfire job configuration
/// </summary>
public static class BackgroundJobExtensions
{
    public static void AddBackgroundJobs(this IServiceCollection services)
    {
        services.AddScoped<BackgroundJobService>();
    }

    public static void ConfigureBackgroundJobs(this IApplicationBuilder app, IRecurringJobManager recurringJobManager)
    {
        // Auto-unlock checkouts every 5 minutes
        recurringJobManager.AddOrUpdate<BackgroundJobService>(
            "auto-unlock-expired-checkouts",
            service => service.RunAutoUnlockCheckoutsAsync(),
            Cron.MinuteInterval(5));

        // Send due reminders every 5 minutes (was 15 — matches the same cadence
        // as auto-unlock-expired-checkouts and the ISO meeting reminder scan;
        // a 15-minute gap made an actually-working reminder feel broken since
        // a reminder due "now" could sit unsent for up to a quarter hour).
        // Previously this only ran when a user manually hit "send-due" —
        // nothing scheduled the sweep at all, so reminders whose due_date
        // passed were never actually delivered.
        recurringJobManager.AddOrUpdate<ReminderService>(
            "send-due-reminders",
            service => service.SendPendingRemindersAsync(),
            Cron.MinuteInterval(5));

        // Push upcoming audit calendar events to every connected user's personal
        // Google Calendar once a day. Runs at 6 AM UTC — adjust the TimeZoneInfo
        // below if the business wants 6 AM in a specific local timezone instead.
        recurringJobManager.AddOrUpdate<UserGoogleCalendarService>(
            "daily-google-calendar-sync",
            service => service.SyncAllActiveUsersAsync(),
            Cron.Daily(6),
            new RecurringJobOptions { TimeZone = TimeZoneInfo.Utc });

        // Scan every connected user's own Google Calendar for "ISO"-titled
        // meetings and fire the created/day-before/10-minutes-before reminder
        // stages. 5-minute cadence is what keeps the 10-minute stage accurate.
        recurringJobManager.AddOrUpdate<GoogleMeetingReminderService>(
            "scan-iso-meeting-reminders",
            service => service.ScanAndSendAsync(),
            Cron.MinuteInterval(5));

        // Checks every 5 minutes whether any enabled Scheduled Backup
        // frequency (Hourly/Daily/Weekly/Monthly) is due right now — see
        // ScheduledBackupService.RunScheduledCheckAsync for the actual
        // per-frequency due logic.
        recurringJobManager.AddOrUpdate<ScheduledBackupService>(
            "scheduled-backup-check",
            service => service.RunScheduledCheckAsync(),
            Cron.MinuteInterval(5));

        // Add more jobs here as needed
        // recurringJobManager.AddOrUpdate("job-name", ...);
    }
}
