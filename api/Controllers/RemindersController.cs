using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RemindersController(ReminderService reminderService, ILogger<RemindersController> logger) : BaseController
{
    // GET /api/reminders — تذكيراتي
    [HttpGet]
    public async Task<ActionResult<object>> GetMyReminders()
    {
        try
        {
            var userId = GetCurrentUserId();
            var reminders = await reminderService.GetUserRemindersAsync(userId);

            logger.LogInformation("Retrieved {Count} reminders for user {UserId}", reminders.Count, userId);

            return Ok(new { success = true, data = reminders, count = reminders.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving reminders");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/reminders/pending — التذكيرات المنتظرة
    [HttpGet("pending/list")]
    public async Task<ActionResult<object>> GetPendingReminders([FromQuery] int limit = 100)
    {
        try
        {
            var pending = await reminderService.GetPendingRemindersAsync(limit);

            logger.LogInformation("Retrieved {Count} pending reminders", pending.Count);

            return Ok(new { success = true, data = pending, count = pending.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving pending reminders");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/reminders/{id}/send — إرسال يدوي
    [HttpPost("{id}/send")]
    public async Task<ActionResult<object>> SendReminderManually(Guid id, [FromServices] Hangfire.IBackgroundJobClient jobClient)
    {
        try
        {
            // Queue the reminder send job
            jobClient.Enqueue<ReminderService>(service => service.SendPendingRemindersAsync());

            logger.LogInformation("Queued reminder send job");

            return Ok(new
            {
                success = true,
                message = "Reminder send job queued for immediate execution"
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error queueing reminder send");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/reminders — إنشاء تذكير
    [HttpPost]
    public async Task<ActionResult<object>> CreateReminder([FromBody] CreateReminderRequest req)
    {
        try
        {
            var result = await reminderService.CreateReminderAsync(
                req.TaskId,
                req.RecipientId,
                req.ReminderType,
                req.DueDate);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            return CreatedAtAction(nameof(GetMyReminders), new { }, new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating reminder");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateReminderRequest(
    Guid TaskId,
    Guid RecipientId,
    string ReminderType, // APP, EMAIL, BOTH
    DateTime DueDate
);
