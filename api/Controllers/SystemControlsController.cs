using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Backs the Admin Panel Database page's "System Controls" (Maintenance Mode,
// Scheduled Maintenance Notice, Force sign-out all users). Admin-only writes
// (Full Access / BypassFolderPermissions), same gate every other blanket
// admin capability in this app uses.
[ApiController]
[Route("api/system-controls")]
public class SystemControlsController(DmsContext context, AuditService auditService, ILogger<SystemControlsController> logger) : BaseController
{
    private async Task<bool> IsAdminAsync()
    {
        var role = await GetPageAccessRoleAsync(context, GetCurrentUserId());
        return role?.BypassFolderPermissions == true;
    }

    [HttpGet]
    public async Task<ActionResult<object>> GetAll()
    {
        return Ok(new
        {
            success = true,
            data = new
            {
                maintenanceMode = await SystemControlsService.LoadMaintenanceModeAsync(context),
                scheduledNotice = await SystemControlsService.LoadScheduledNoticeAsync(context),
            },
        });
    }

    [HttpPut("maintenance-mode")]
    public async Task<ActionResult<object>> UpdateMaintenanceMode([FromBody] MaintenanceModeSettings req)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        await SystemControlsService.SaveAsync(context, SystemControlKeys.MaintenanceMode, req, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "maintenance_mode", req.Enabled });
        logger.LogWarning("Maintenance mode set to {Enabled} by {UserId}", req.Enabled, GetCurrentUserId());

        return Ok(new { success = true, data = req });
    }

    [HttpPut("scheduled-notice")]
    public async Task<ActionResult<object>> UpdateScheduledNotice([FromBody] ScheduledMaintenanceNotice req)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        if (req.Enabled && (req.StartAt == null || req.EndAt == null))
            return BadRequest(new { success = false, error = "Start and end date/time are required to schedule a notice" });

        if (req.Enabled && req.EndAt <= req.StartAt)
            return BadRequest(new { success = false, error = "End time must be after start time" });

        await SystemControlsService.SaveAsync(context, SystemControlKeys.ScheduledNotice, req, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "scheduled_notice", req });

        return Ok(new { success = true, data = req });
    }

    // POST /api/system-controls/force-signout — invalidates every existing
    // session (including the caller's own) by recording "now" as the cutoff;
    // JwtTokenService rejects any token issued before it. Nothing to
    // roll back — the caller simply needs to log back in afterward too.
    [HttpPost("force-signout")]
    public async Task<ActionResult<object>> ForceSignOutAll()
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can force a sign-out" });

        var cutoff = DateTime.UtcNow;
        var setting = await context.AppSettings.FindAsync(JwtTokenService.ForceSignOutSettingKey);
        if (setting == null)
        {
            setting = new DmsAppSetting { Key = JwtTokenService.ForceSignOutSettingKey };
            context.AppSettings.Add(setting);
        }
        setting.Value = cutoff.ToString("O");
        setting.UpdatedAt = cutoff;
        setting.UpdatedById = GetCurrentUserId();
        await context.SaveChangesAsync();

        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "force_signout_all", cutoff });
        logger.LogWarning("Force sign-out of all sessions triggered by {UserId}", GetCurrentUserId());

        return Ok(new { success = true, message = "Every session has been signed out, including this one." });
    }
}
