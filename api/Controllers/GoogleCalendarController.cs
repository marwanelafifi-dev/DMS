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
    // GET /api/googlecalendar/status — is the current user linked to a calendar?
    [HttpGet("status")]
    public async Task<ActionResult<object>> GetStatus()
    {
        var status = await calendarService.GetStatusAsync(GetCurrentUserId());
        return Ok(new { success = true, data = status });
    }

    // GET /api/googlecalendar/connect — returns the Google consent URL to start linking
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

    // GET /api/googlecalendar/callback — Google redirects the browser here after consent.
    // There's no X-User-Id here (the user's browser calls this directly) — identity comes from state.
    // RBACMiddleware.ShouldSkipAuth specifically exempts this route.
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

    // POST /api/googlecalendar/sync — "Sync Now" button
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
