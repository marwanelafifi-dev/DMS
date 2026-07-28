using DMS.Api.Services;
using Hangfire;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class BackgroundJobsController(ILogger<BackgroundJobsController> logger) : ControllerBase
{
    // GET /api/backgroundjobs/status — حالة الـ background jobs
    [HttpGet("status")]
    public ActionResult<object> GetBackgroundJobStatus()
    {
        try
        {
            var stats = JobStorage.Current.GetMonitoringApi().GetStatistics();

            logger.LogInformation("Retrieved background job statistics");

            return Ok(new
            {
                success = true,
                data = new
                {
                    Enqueued = stats.Enqueued,
                    Failed = stats.Failed,
                    Processing = stats.Processing,
                    Scheduled = stats.Scheduled,
                    Succeeded = stats.Succeeded,
                    Deleted = stats.Deleted,
                    Recurring = stats.Recurring,
                    TimestampUtc = DateTime.UtcNow
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving background job status");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/backgroundjobs/run-auto-unlock — تشغيل يدوي
    [HttpPost("run-auto-unlock")]
    public ActionResult<object> RunAutoUnlockManually([FromServices] BackgroundJobService backgroundJobService)
    {
        try
        {
            // Queue the job immediately
            BackgroundJob.Enqueue(() => backgroundJobService.RunAutoUnlockCheckoutsAsync());

            logger.LogInformation("Queued auto-unlock job manually");

            return Ok(new
            {
                success = true,
                message = "Auto-unlock job queued for immediate execution"
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error queuing auto-unlock job");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/backgroundjobs/dashboard-url — رابط الـ Hangfire dashboard
    [HttpGet("dashboard-url")]
    public ActionResult<object> GetDashboardUrl()
    {
        return Ok(new
        {
            success = true,
            data = new
            {
                dashboardUrl = "/hangfire",
                description = "Hangfire job dashboard (read-only for now)"
            }
        });
    }
}
