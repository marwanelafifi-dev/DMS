using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text.Json;
using DMS.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// The two sending methods exposed on the admin Notification Configuration
// page — both are plain Gmail SMTP, just against a different host/account
// type. "Recommended" (personal Gmail + App Password) needs no admin access
// to Google Workspace; the Workspace SMTP relay needs a one-time relay rule
// set up in the Google Admin Console but sends as a real si-ware.com address.
public record EmailNotificationConfig(string Method, string? Email, string? AppPassword, string? SenderName)
{
    public const string GmailAppPassword = "gmail_app_password";
    public const string GoogleWorkspaceSmtpRelay = "google_workspace_smtp_relay";

    public string Host => Method == GoogleWorkspaceSmtpRelay ? "smtp-relay.gmail.com" : "smtp.gmail.com";
    public int Port => 587;
    public bool IsConfigured => !string.IsNullOrWhiteSpace(Email) && !string.IsNullOrWhiteSpace(AppPassword);
}

// Thin SMTP wrapper — the only place in the API that actually sends an email.
// Configuration is loaded fresh from dms_app_settings on every send (not
// cached at startup) so a change saved on the admin Notification
// Configuration page takes effect immediately, no restart needed. Falls back
// to the legacy Smtp:User/Password env vars if nothing has been saved there
// yet. A missing/incomplete config never blocks whatever feature is trying
// to notify someone — every send is a no-op logged warning, never a thrown
// exception.
public class EmailService(IServiceScopeFactory scopeFactory, IConfiguration configuration, ILogger<EmailService> logger)
{
    public const string SettingKey = "email_notification_config";
    private const string LogoContentId = "siwarelogo";
    private static readonly string LogoPath = Path.Combine(AppContext.BaseDirectory, "Assets", "si-ware-logo-dark.png");

    public async Task<EmailNotificationConfig> LoadConfigAsync()
    {
        using var scope = scopeFactory.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<DmsContext>();
        var setting = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == SettingKey);

        if (!string.IsNullOrWhiteSpace(setting?.Value))
        {
            try
            {
                var saved = JsonSerializer.Deserialize<EmailNotificationConfig>(setting.Value, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (saved != null)
                    return saved;
            }
            catch (JsonException ex)
            {
                logger.LogWarning(ex, "Failed to parse saved email notification config — falling back to environment configuration");
            }
        }

        return new EmailNotificationConfig(
            EmailNotificationConfig.GmailAppPassword,
            configuration["Smtp:User"],
            configuration["Smtp:Password"],
            configuration["Smtp:FromName"] ?? "Si-Ware DMS");
    }

    public async Task<bool> IsConfiguredAsync() => (await LoadConfigAsync()).IsConfigured;

    // One shared visual identity for every notification email the DMS sends —
    // navy header banner with the actual Si-Ware logo (embedded inline via
    // Content-ID in SendWithConfigAsync below, not a remote <img src>, since email
    // clients often block/never-fetch images from a URL that isn't a real
    // publicly reachable host), a colored accent bar callers can use to
    // signal urgency (e.g. red for "starting in 10 minutes" vs. blue for
    // "just scheduled"), and a plain-language footer so recipients who don't
    // use the DMS directly still know why they got it. Table-based layout +
    // inline styles only, since email clients strip <style> blocks/external
    // stylesheets.
    public static string BuildBrandedHtml(string headline, string accentColor, string bodyHtml)
    {
        return $$"""
            <div style="background:#eef2f7;padding:32px 16px;font-family:Segoe UI,Arial,sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <tr><td style="height:4px;background:{{accentColor}};line-height:4px;font-size:0;">&nbsp;</td></tr>
                <tr>
                  <td style="background:#002E5C;padding:24px 28px;text-align:center;">
                    <img src="cid:{{LogoContentId}}" alt="Si-Ware DMS" height="44" style="display:inline-block;border:0;" />
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <h1 style="margin:0 0 16px;font-size:20px;color:#122344;font-family:Georgia,serif;">{{headline}}</h1>
                    {{bodyHtml}}
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                    <p style="margin:0;font-size:12px;color:#718198;">This is an automated notification from the Si-Ware Enterprise DMS. Please do not reply directly to this email.</p>
                  </td>
                </tr>
              </table>
            </div>
            """;
    }

    public async Task<bool> SendAsync(string toEmail, string subject, string htmlBody)
    {
        var config = await LoadConfigAsync();
        if (!config.IsConfigured)
        {
            logger.LogWarning("Email not sent to {ToEmail} ({Subject}) — notification email is not configured", toEmail, subject);
            return false;
        }

        var (success, _) = await SendWithConfigAsync(config, toEmail, subject, htmlBody);
        return success;
    }

    // Sends against an explicit config rather than the persisted one — used by
    // the "Send Test Email" action so an admin can verify credentials before
    // saving them.
    public async Task<(bool Success, string? Error)> SendWithConfigAsync(EmailNotificationConfig config, string toEmail, string subject, string htmlBody)
    {
        if (!config.IsConfigured)
            return (false, "Email and App Password are required");

        try
        {
            using var message = new MailMessage
            {
                From = new MailAddress(config.Email!, config.SenderName ?? "Si-Ware DMS"),
                Subject = subject,
            };
            message.To.Add(toEmail);

            var htmlView = AlternateView.CreateAlternateViewFromString(htmlBody, null, "text/html");

            // Embed the logo inline (cid:) rather than linking it, since this
            // API has no publicly reachable URL for email clients to fetch a
            // remote image from — an inline resource always renders, on any
            // network, in any environment.
            if (File.Exists(LogoPath))
            {
                var logo = new LinkedResource(LogoPath, MediaTypeNames.Image.Png)
                {
                    ContentId = LogoContentId,
                    TransferEncoding = TransferEncoding.Base64,
                };
                htmlView.LinkedResources.Add(logo);
            }
            else
            {
                logger.LogWarning("Si-Ware logo asset not found at {LogoPath} — email will send without it", LogoPath);
            }

            message.AlternateViews.Add(htmlView);

            using var client = new SmtpClient(config.Host, config.Port)
            {
                EnableSsl = true,
                Credentials = new NetworkCredential(config.Email, config.AppPassword),
            };

            await client.SendMailAsync(message);
            return (true, null);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to send email to {ToEmail} ({Subject})", toEmail, subject);
            return (false, ex.Message);
        }
    }
}
