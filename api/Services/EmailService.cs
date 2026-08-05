using System.Net;
using System.Net.Mail;
using System.Net.Mime;

namespace DMS.Api.Services;

// Thin SMTP wrapper — the only place in the API that actually sends an email.
// Configured via Smtp:Host/Port/User/Password/FromName (see appsettings.json /
// SMTP_* in .env). IsConfigured is false (and every send a no-op logged
// warning, never a thrown exception) until all of Host/User/Password are set,
// so a missing config never blocks whatever feature is trying to notify someone.
public class EmailService
{
    private const string LogoContentId = "siwarelogo";
    private static readonly string LogoPath = Path.Combine(AppContext.BaseDirectory, "Assets", "si-ware-logo-dark.png");

    private readonly string? _host;
    private readonly int _port;
    private readonly string? _user;
    private readonly string? _password;
    private readonly string _fromName;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IConfiguration configuration, ILogger<EmailService> logger)
    {
        _logger = logger;
        _host = configuration["Smtp:Host"];
        _port = int.TryParse(configuration["Smtp:Port"], out var port) ? port : 587;
        _user = configuration["Smtp:User"];
        _password = configuration["Smtp:Password"];
        _fromName = configuration["Smtp:FromName"] ?? "Si-Ware DMS";
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_host) && !string.IsNullOrEmpty(_user) && !string.IsNullOrEmpty(_password);

    // One shared visual identity for every notification email the DMS sends —
    // navy header banner with the actual Si-Ware logo (embedded inline via
    // Content-ID in SendAsync below, not a remote <img src>, since email
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
        if (!IsConfigured)
        {
            _logger.LogWarning("Email not sent to {ToEmail} ({Subject}) — SMTP is not configured", toEmail, subject);
            return false;
        }

        try
        {
            using var message = new MailMessage
            {
                From = new MailAddress(_user!, _fromName),
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
                _logger.LogWarning("Si-Ware logo asset not found at {LogoPath} — email will send without it", LogoPath);
            }

            message.AlternateViews.Add(htmlView);

            using var client = new SmtpClient(_host, _port)
            {
                EnableSsl = true,
                Credentials = new NetworkCredential(_user, _password),
            };

            await client.SendMailAsync(message);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email to {ToEmail} ({Subject})", toEmail, subject);
            return false;
        }
    }
}
