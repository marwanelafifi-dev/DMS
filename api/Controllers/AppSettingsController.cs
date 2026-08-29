using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Small global key/value settings, currently just "sync Google Calendar
// automatically on every login". Reads are open to any authenticated user
// (the frontend toggle needs its current state to render); writes require
// the caller's page-access role to have BypassFolderPermissions — the same
// "Full Access acts as admin everywhere" flag every other blanket admin
// capability in this app keys off, rather than matching the literal role
// name (which a rename could change — see PageAccessRolesController).
[ApiController]
[Route("api/app-settings")]
public class AppSettingsController(DmsContext context, AuditService auditService, ILogger<AppSettingsController> logger) : BaseController
{
    [HttpGet("{key}")]
    public async Task<ActionResult<object>> GetSetting(string key)
    {
        if (key.Equals(AiChatSettingsService.SettingKey, StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new { success = false, error = "Sensitive settings are only available through their dedicated admin endpoint" });
        var setting = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key);
        return Ok(new { success = true, data = new { key, value = setting?.Value ?? "false" } });
    }

    [HttpPut("{key}")]
    public async Task<ActionResult<object>> UpdateSetting(string key, [FromBody] UpdateAppSettingRequest req)
    {
        try
        {
            if (key.Equals(AiChatSettingsService.SettingKey, StringComparison.OrdinalIgnoreCase))
                return StatusCode(403, new { success = false, error = "Use the API Keys admin page to change this setting" });
            var userId = GetCurrentUserId();
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (pageAccessRole?.BypassFolderPermissions != true)
                return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

            var setting = await context.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
            if (setting == null)
            {
                setting = new DmsAppSetting { Key = key };
                context.AppSettings.Add(setting);
            }

            setting.Value = req.Value;
            setting.UpdatedAt = DateTime.UtcNow;
            setting.UpdatedById = userId;
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, APP_SETTING_UPDATED, new { Key = key, req.Value });

            logger.LogInformation("App setting {Key} updated to {Value} by {UserId}", key, req.Value, userId);

            return Ok(new { success = true, data = new { key, value = setting.Value } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating app setting {Key}", key);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record UpdateAppSettingRequest(string Value);
