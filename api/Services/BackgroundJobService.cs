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

        // Add more jobs here as needed
        // recurringJobManager.AddOrUpdate("job-name", ...);
    }
}
