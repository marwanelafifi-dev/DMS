using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

// Deliberately public (no auth) — the Login page needs its own copy/logo
// BEFORE a session exists, so this can't sit behind the normal JWT pipeline.
// Added to JwtAuthMiddleware.PublicEndpoints / RBACMiddleware.ShouldSkipAuth.
// Read-only: writes go through the authenticated PlatformSettingsController.
[ApiController]
[Route("api/branding")]
public class BrandingController(DmsContext context, MinioService minioService, ILogger<BrandingController> logger) : ControllerBase
{
    [HttpGet("login-page")]
    public async Task<ActionResult<object>> GetLoginPageConfig()
    {
        var config = await PlatformSettingsService.LoadLoginPageAsync(context);
        return Ok(new { success = true, data = config });
    }

    [HttpGet("header")]
    public async Task<ActionResult<object>> GetHeaderConfig()
    {
        var config = await PlatformSettingsService.LoadHeaderAsync(context);
        return Ok(new { success = true, data = config });
    }

    // GET /api/branding/system-notice — the subset of System Controls every
    // visitor (logged in or not) needs to see: whether Maintenance Mode is
    // blocking logins right now, and the Scheduled Maintenance Notice banner
    // if it's currently inside its active window.
    [HttpGet("system-notice")]
    public async Task<ActionResult<object>> GetSystemNotice()
    {
        var maintenanceMode = await SystemControlsService.LoadMaintenanceModeAsync(context);
        var scheduledNotice = await SystemControlsService.LoadScheduledNoticeAsync(context);
        var now = DateTime.UtcNow;

        return Ok(new
        {
            success = true,
            data = new
            {
                maintenanceModeEnabled = maintenanceMode.Enabled,
                maintenanceMessage = maintenanceMode.Message,
                scheduledNotice = scheduledNotice.IsCurrentlyActive(now)
                    ? new { scheduledNotice.Message, scheduledNotice.StartAt, scheduledNotice.EndAt }
                    : null,
            },
        });
    }

    // GET /api/branding/logo/{type} — streams the admin-uploaded logo image.
    // 404 (not an error toast) means "no custom logo uploaded" — callers fall
    // back to the bundled default asset.
    [HttpGet("logo/{type}")]
    public async Task<IActionResult> GetLogo(string type)
    {
        if (type != "login" && type != "header")
            return NotFound();

        string? objectKey;
        string? contentType;
        if (type == "login")
        {
            var loginPage = await PlatformSettingsService.LoadLoginPageAsync(context);
            (objectKey, contentType) = (loginPage.LogoObjectKey, loginPage.LogoContentType);
        }
        else
        {
            var header = await PlatformSettingsService.LoadHeaderAsync(context);
            (objectKey, contentType) = (header.LogoObjectKey, header.LogoContentType);
        }

        if (string.IsNullOrWhiteSpace(objectKey))
            return NotFound();

        try
        {
            var stream = await minioService.DownloadAsync(objectKey);
            return File(stream, contentType ?? "application/octet-stream");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Logo object {ObjectKey} referenced in settings but not found in storage", objectKey);
            return NotFound();
        }
    }
}
