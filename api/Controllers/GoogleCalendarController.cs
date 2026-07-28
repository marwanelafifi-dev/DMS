using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GoogleCalendarController(
    UserGoogleCalendarService calendarService,
    IConfiguration configuration,
    ILogger<GoogleCalendarController> logger) : BaseController
{
    // GET /api/googlecalendar/status — هل المستخدم الحالي رابط كالندره؟
    [HttpGet("status")]
    public async Task<ActionResult<object>> GetStatus()
    {
        var status = await calendarService.GetStatusAsync(GetCurrentUserId());
        return Ok(new { success = true, data = status });
    }

    // GET /api/googlecalendar/connect — يرجع رابط موافقة Google لبدء الربط
    [HttpGet("connect")]
    public ActionResult<object> Connect()
    {
        var result = calendarService.GetAuthorizationUrl(GetCurrentUserId());
        if (!result.Success)
        {
            return result.Error == "NotConfigured"
                ? StatusCode(501, new { success = false, error = result.Message })
                : BadRequest(new { success = false, error = result.Message });
        }

        return Ok(new { success = true, data = result.Data });
    }

    // GET /api/googlecalendar/callback — Google بيرجّع المتصفح هنا بعد الموافقة.
    // مفيش X-User-Id هنا (متصفح المستخدم بينده مباشرة) — الهوية جاية من state.
    // RBACMiddleware.ShouldSkipAuth معفي المسار ده تحديدًا.
    [HttpGet("callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error)
    {
        var frontendUrl = configuration["Google:FrontendRedirectUrl"] ?? "/";

        if (!string.IsNullOrEmpty(error) || string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
        {
            logger.LogWarning("Google Calendar OAuth callback failed or was denied: {Error}", error);
            return Redirect($"{frontendUrl}?calendarError=denied");
        }

        var result = await calendarService.HandleCallbackAsync(state, code);
        return Redirect(result.Success ? $"{frontendUrl}?calendarConnected=true" : $"{frontendUrl}?calendarError=failed");
    }

    // DELETE /api/googlecalendar/disconnect
    [HttpDelete("disconnect")]
    public async Task<ActionResult<object>> Disconnect()
    {
        var result = await calendarService.DisconnectAsync(GetCurrentUserId());
        if (!result.Success)
            return NotFound(new { success = false, error = result.Message });

        return Ok(new { success = true, data = result.Data });
    }

    // POST /api/googlecalendar/sync — زر "Sync Now"
    [HttpPost("sync")]
    public async Task<ActionResult<object>> SyncNow()
    {
        var result = await calendarService.SyncUserAsync(GetCurrentUserId());
        if (!result.Success)
        {
            return result.Error switch
            {
                "NotFound" => NotFound(new { success = false, error = result.Message }),
                "NotConfigured" => StatusCode(501, new { success = false, error = result.Message }),
                _ => StatusCode(500, new { success = false, error = result.Message }),
            };
        }

        return Ok(new { success = true, data = result.Data });
    }
}
