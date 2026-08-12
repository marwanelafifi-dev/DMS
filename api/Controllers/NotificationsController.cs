using DMS.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/notifications")]
public class NotificationsController(DmsContext context, ILogger<NotificationsController> logger) : BaseController
{
    // GET /api/notifications?limit=20 — most recent first
    [HttpGet]
    public async Task<ActionResult<object>> GetNotifications([FromQuery] int limit = 20)
    {
        try
        {
            var userId = GetCurrentUserId();
            var notifications = await context.Notifications
                .Where(n => n.UserId == userId)
                .OrderByDescending(n => n.CreatedAt)
                .Take(Math.Clamp(limit, 1, 200))
                .Select(n => new
                {
                    n.NotificationId,
                    n.Title,
                    n.Body,
                    n.DocumentId,
                    n.TaskId,
                    n.AnnouncementId,
                    n.IsRead,
                    n.CreatedAt,
                })
                .ToListAsync();

            var unreadCount = await context.Notifications.CountAsync(n => n.UserId == userId && !n.IsRead);

            return Ok(new { success = true, data = notifications, unreadCount });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving notifications");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/notifications/unread-count — cheap poll target, no row data
    [HttpGet("unread-count")]
    public async Task<ActionResult<object>> GetUnreadCount()
    {
        try
        {
            var userId = GetCurrentUserId();
            var count = await context.Notifications.CountAsync(n => n.UserId == userId && !n.IsRead);
            return Ok(new { success = true, data = count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving unread notification count");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/notifications/{id}/read
    [HttpPut("{id}/read")]
    public async Task<ActionResult<object>> MarkRead(Guid id)
    {
        try
        {
            var userId = GetCurrentUserId();
            var notification = await context.Notifications.FirstOrDefaultAsync(n => n.NotificationId == id && n.UserId == userId);
            if (notification == null)
                return NotFound(new { success = false, error = "Notification not found" });

            notification.IsRead = true;
            await context.SaveChangesAsync();

            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error marking notification {Id} as read", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/notifications/read-all
    [HttpPut("read-all")]
    public async Task<ActionResult<object>> MarkAllRead()
    {
        try
        {
            var userId = GetCurrentUserId();
            await context.Notifications
                .Where(n => n.UserId == userId && !n.IsRead)
                .ExecuteUpdateAsync(setters => setters.SetProperty(n => n.IsRead, true));

            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error marking all notifications as read");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}
