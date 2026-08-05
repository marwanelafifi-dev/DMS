using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Backs the Admin Panel's Settings page (General / Login Page / Header /
// Security). Reads are open to any authenticated user (Sidebar/Login need
// their current values to render); writes require Full Access
// (BypassFolderPermissions) — same "Full Access acts as admin everywhere"
// gate every other blanket admin capability in this app uses.
[ApiController]
[Route("api/platform-settings")]
public class PlatformSettingsController(DmsContext context, MinioService minioService, AuditService auditService, ILogger<PlatformSettingsController> logger) : BaseController
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
                general = await PlatformSettingsService.LoadGeneralAsync(context),
                loginPage = await PlatformSettingsService.LoadLoginPageAsync(context),
                header = await PlatformSettingsService.LoadHeaderAsync(context),
                security = await PlatformSettingsService.LoadSecurityAsync(context),
            },
        });
    }

    [HttpPut("general")]
    public async Task<ActionResult<object>> UpdateGeneral([FromBody] GeneralSettings req)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        await PlatformSettingsService.SaveAsync(context, PlatformSettingKeys.General, req, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "general", req });
        return Ok(new { success = true, data = req });
    }

    [HttpPut("login-page")]
    public async Task<ActionResult<object>> UpdateLoginPage([FromBody] LoginPageSettings req)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        // The logo is managed exclusively via POST .../logo — preserve whatever
        // is currently saved rather than letting a plain text-field save wipe it.
        var existing = await PlatformSettingsService.LoadLoginPageAsync(context);
        var toSave = req with { LogoObjectKey = existing.LogoObjectKey, LogoContentType = existing.LogoContentType };

        await PlatformSettingsService.SaveAsync(context, PlatformSettingKeys.LoginPage, toSave, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "login_page", req });
        return Ok(new { success = true, data = toSave });
    }

    [HttpPut("header")]
    public async Task<ActionResult<object>> UpdateHeader([FromBody] HeaderSettings req)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        var existing = await PlatformSettingsService.LoadHeaderAsync(context);
        var toSave = req with { LogoObjectKey = existing.LogoObjectKey, LogoContentType = existing.LogoContentType };

        await PlatformSettingsService.SaveAsync(context, PlatformSettingKeys.Header, toSave, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "header", req });
        return Ok(new { success = true, data = toSave });
    }

    [HttpPut("security")]
    public async Task<ActionResult<object>> UpdateSecurity([FromBody] SecuritySettings req)
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        if (req.SessionTimeoutHours < 1 || req.SessionTimeoutHours > 168)
            return BadRequest(new { success = false, error = "Session timeout must be between 1 and 168 hours" });

        await PlatformSettingsService.SaveAsync(context, PlatformSettingKeys.Security, req, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "security", req });
        return Ok(new { success = true, data = req });
    }

    // POST /api/platform-settings/logo?type=login|header — replaces whichever
    // logo is currently saved for that slot; the old object is best-effort
    // deleted afterward so uploads don't accumulate in MinIO forever.
    [HttpPost("logo")]
    public async Task<ActionResult<object>> UploadLogo([FromQuery] string type, IFormFile file)
    {
        try
        {
            if (!await IsAdminAsync())
                return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

            if (type != "login" && type != "header")
                return BadRequest(new { success = false, error = "type must be 'login' or 'header'" });

            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "File is required" });

            var allowedExtensions = new[] { ".png", ".jpg", ".jpeg", ".svg", ".webp" };
            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!allowedExtensions.Contains(extension))
                return BadRequest(new { success = false, error = "Logo must be PNG, JPG, SVG, or WebP" });

            var userId = GetCurrentUserId();
            var previousObjectKey = type == "login"
                ? (await PlatformSettingsService.LoadLoginPageAsync(context)).LogoObjectKey
                : (await PlatformSettingsService.LoadHeaderAsync(context)).LogoObjectKey;

            var newObjectKey = $"branding/{type}-logo-{Guid.NewGuid()}{extension}";
            await minioService.UploadAsync(newObjectKey, file.OpenReadStream(), file.ContentType ?? "application/octet-stream");

            if (type == "login")
            {
                var existing = await PlatformSettingsService.LoadLoginPageAsync(context);
                var updated = existing with { LogoObjectKey = newObjectKey, LogoContentType = file.ContentType };
                await PlatformSettingsService.SaveAsync(context, PlatformSettingKeys.LoginPage, updated, userId);
            }
            else
            {
                var existing = await PlatformSettingsService.LoadHeaderAsync(context);
                var updated = existing with { LogoObjectKey = newObjectKey, LogoContentType = file.ContentType };
                await PlatformSettingsService.SaveAsync(context, PlatformSettingKeys.Header, updated, userId);
            }

            if (!string.IsNullOrWhiteSpace(previousObjectKey))
            {
                try { await minioService.DeleteAsync(previousObjectKey); }
                catch (Exception ex) { logger.LogWarning(ex, "Failed to delete previous logo object {ObjectKey}", previousObjectKey); }
            }

            await auditService.LogAsync(userId, APP_SETTING_UPDATED, new { Group = $"{type}_logo", ObjectKey = newObjectKey });

            return Ok(new { success = true, data = new { objectKey = newObjectKey } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error uploading {Type} logo", type);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/platform-settings/reset — clears all 4 saved groups (GET then
    // falls back to hardcoded defaults) and removes any uploaded logos.
    [HttpPost("reset")]
    public async Task<ActionResult<object>> ResetToDefaults()
    {
        if (!await IsAdminAsync())
            return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

        var loginPage = await PlatformSettingsService.LoadLoginPageAsync(context);
        var header = await PlatformSettingsService.LoadHeaderAsync(context);

        foreach (var key in new[] { PlatformSettingKeys.General, PlatformSettingKeys.LoginPage, PlatformSettingKeys.Header, PlatformSettingKeys.Security })
        {
            var setting = await context.AppSettings.FindAsync(key);
            if (setting != null)
                context.AppSettings.Remove(setting);
        }
        await context.SaveChangesAsync();

        foreach (var objectKey in new[] { loginPage.LogoObjectKey, header.LogoObjectKey })
        {
            if (string.IsNullOrWhiteSpace(objectKey)) continue;
            try { await minioService.DeleteAsync(objectKey); }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to delete logo object {ObjectKey} during reset", objectKey); }
        }

        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "reset_to_defaults" });

        return Ok(new
        {
            success = true,
            data = new
            {
                general = GeneralSettings.Default,
                loginPage = LoginPageSettings.Default,
                header = HeaderSettings.Default,
                security = SecuritySettings.Default,
            },
        });
    }
}
