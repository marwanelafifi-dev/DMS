using DMS.Api.Data;
using DMS.Api.Services;
using Hangfire;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RemindersController(ReminderService reminderService, DmsContext context, ILogger<RemindersController> logger) : BaseController
{
    // GET /api/reminders — my reminders
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

    // GET /api/reminders/pending — pending reminders
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

    // POST /api/reminders/{id}/send — send a specific reminder
    [HttpPost("{id}/send")]
    public async Task<ActionResult<object>> SendReminderManually(Guid id)
    {
        try
        {
            var result = await reminderService.MarkReminderSentAsync(id, GetCurrentUserId());

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error sending reminder {ReminderId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/reminders/send-due — run a Hangfire scan for all due reminders
    [HttpPost("send-due")]
    public ActionResult<object> SendDueReminders([FromServices] IBackgroundJobClient jobClient)
    {
        try
        {
            jobClient.Enqueue<ReminderService>(service => service.SendPendingRemindersAsync());

            logger.LogInformation("Queued reminder send job for all due reminders");

            return Ok(new { success = true, message = "Reminder send job queued for immediate execution" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error queueing reminder send");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/reminders/{id} — delete a reminder
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteReminder(Guid id)
    {
        try
        {
            var userId = GetCurrentUserId();
            // Real gap found live: this endpoint had no permission check at
            // all — anyone who could see the Reminders page could delete any
            // reminder, not just their own. Now gated on a dedicated,
            // independently-grantable role flag, same pattern as the other
            // blanket capability flags.
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (pageAccessRole?.CanDeleteReminders != true)
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have permission to delete reminders" });

            var result = await reminderService.DeleteReminderAsync(id, userId);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "NotFound" => NotFound(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message })
                };
            }

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting reminder {ReminderId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/reminders — create a reminder
    [HttpPost]
    public async Task<ActionResult<object>> CreateReminder([FromBody] CreateReminderRequest req)
    {
        try
        {
            var result = await reminderService.CreateReminderAsync(
                req.TaskId,
                req.RecipientId,
                req.ReminderType,
                req.DueDate,
                GetCurrentUserId());

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
