using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/announcements")]
public class AnnouncementsController(DmsContext context, AnnouncementService announcementService, ILogger<AnnouncementsController> logger) : BaseController
{
    // GET /api/announcements — visible to every authenticated user
    [HttpGet]
    public async Task<ActionResult<object>> GetAnnouncements()
    {
        try
        {
            var announcements = await announcementService.GetAllAsync();
            return Ok(new { success = true, data = announcements, count = announcements.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving announcements");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/announcements — gated on the caller's page-access role having
    // CanSendAnnouncements (editable per role from the Roles admin page),
    // rather than a hardcoded role name — enforced server-side, not just by
    // hiding the button/route on the frontend.
    [HttpPost]
    public async Task<ActionResult<object>> CreateAnnouncement([FromBody] CreateAnnouncementRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (pageAccessRole?.CanSendAnnouncements != true)
                return StatusCode(403, new { success = false, error = "This role is not allowed to post announcements" });

            var result = await announcementService.CreateAsync(
                req.Title, req.Message, userId, req.RecipientUserIds, req.NotifyEmail, req.NotifyApp);

            if (!result.Success)
            {
                return result.Error switch
                {
                    "Invalid" => BadRequest(new { success = false, error = result.Message }),
                    _ => StatusCode(500, new { success = false, error = result.Message }),
                };
            }

            return CreatedAtAction(nameof(GetAnnouncements), new { }, new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating announcement");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/announcements/{id} — the original poster or a Full Access role
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteAnnouncement(Guid id)
    {
        try
        {
            var userId = GetCurrentUserId();
            var announcement = await context.Announcements.AsNoTracking().FirstOrDefaultAsync(a => a.AnnouncementId == id);
            if (announcement == null)
                return NotFound(new { success = false, error = "Announcement not found" });

            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (announcement.PostedById != userId && pageAccessRole?.BypassFolderPermissions != true)
                return StatusCode(403, new { success = false, error = "Only the original poster or a Full Access role can delete this" });

            var result = await announcementService.DeleteAsync(id, userId);
            if (!result.Success)
                return NotFound(new { success = false, error = result.Message });

            return Ok(new { success = true, data = result.Data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting announcement {AnnouncementId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateAnnouncementRequest(string Title, string Message, List<Guid>? RecipientUserIds, bool NotifyEmail, bool NotifyApp);
