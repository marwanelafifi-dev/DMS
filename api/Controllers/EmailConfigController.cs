using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Backs the Admin Panel's "Notification Configuration" page — how outbound
// emails (announcements, ISO meeting reminders, ...) are actually sent.
// Reads/writes reuse the generic dms_app_settings key/value table (same one
// AppSettingsController exposes generically); this controller adds the one
// thing that table alone can't do — sending a real test email.
[ApiController]
[Route("api/email-config")]
public class EmailConfigController(DmsContext context, EmailService emailService, AuditService auditService, ILogger<EmailConfigController> logger) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> GetConfig()
    {
        var config = await emailService.LoadConfigAsync();
        return Ok(new { success = true, data = config });
    }

    [HttpPut]
    public async Task<ActionResult<object>> UpdateConfig([FromBody] EmailNotificationConfig req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (pageAccessRole?.BypassFolderPermissions != true)
                return StatusCode(403, new { success = false, error = "Only a Full Access role can change this setting" });

            if (req.Method != EmailNotificationConfig.GmailAppPassword && req.Method != EmailNotificationConfig.GoogleWorkspaceSmtpRelay)
                return BadRequest(new { success = false, error = "Unknown sending method" });

            var setting = await context.AppSettings.FirstOrDefaultAsync(s => s.Key == EmailService.SettingKey);
            if (setting == null)
            {
                setting = new DmsAppSetting { Key = EmailService.SettingKey };
                context.AppSettings.Add(setting);
            }

            setting.Value = JsonSerializer.Serialize(req);
            setting.UpdatedAt = DateTime.UtcNow;
            setting.UpdatedById = userId;
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, EMAIL_NOTIFICATION_CONFIG_UPDATED, new { req.Method, req.Email, req.SenderName });

            logger.LogInformation("Email notification config updated ({Method}) by {UserId}", req.Method, userId);

            return Ok(new { success = true, data = req });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating email notification config");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // Sends against whatever config is in the request body — lets an admin
    // verify credentials work before committing to Save Configuration.
    [HttpPost("test")]
    public async Task<ActionResult<object>> SendTestEmail([FromBody] EmailNotificationConfig req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            if (pageAccessRole?.BypassFolderPermissions != true)
                return StatusCode(403, new { success = false, error = "Only a Full Access role can send a test email" });

            var recipient = await context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            if (string.IsNullOrWhiteSpace(recipient?.Email))
                return BadRequest(new { success = false, error = "Your account has no email address to send the test to" });

            var html = EmailService.BuildBrandedHtml(
                "Test email",
                "#3f8bca",
                """<p style="margin:0;font-size:14px;color:#3c4043;">This is a test email from the Si-Ware DMS Notification Configuration page. If you received this, your settings are working.</p>""");

            var (success, error) = await emailService.SendWithConfigAsync(req, recipient.Email, "Si-Ware DMS — Test email", html);

            await auditService.LogAsync(userId, EMAIL_NOTIFICATION_TEST_SENT, new { req.Method, req.Email, success });

            if (!success)
                return BadRequest(new { success = false, error = error ?? "Failed to send test email" });

            return Ok(new { success = true, message = $"Test email sent to {recipient.Email}" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error sending test email");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}
