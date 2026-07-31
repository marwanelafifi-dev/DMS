using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(DmsContext context, JwtTokenService jwtTokenService, AuditService auditService, IConfiguration configuration, ILogger<AuthController> logger) : BaseController
{
    // Only Google accounts on this Workspace domain may sign in — enforced
    // server-side (never trust the client) against the verified token's email.
    private const string AllowedGoogleDomain = "si-ware.com";

    // Must match TOKEN_STORAGE_KEY in web/src/utils/api.ts — this is the
    // localStorage key the SPA reads its bearer token from on every request.
    private const string SessionTokenStorageKey = "dms_session_token";

    // POST /api/auth/login — local email+password login. Google-SSO-only
    // accounts (no PasswordHash set) can't use this until real Google OAuth
    // login is wired up — see CLAUDE.md for that follow-up.
    [HttpPost("login")]
    public async Task<ActionResult<object>> Login([FromBody] LoginRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                return BadRequest(new { success = false, error = "Email and password are required" });

            var user = await context.Users.FirstOrDefaultAsync(u => u.Email == req.Email.ToLower().Trim());

            if (user == null || string.IsNullOrEmpty(user.PasswordHash) || !PasswordHasher.Verify(req.Password, user.PasswordHash))
            {
                logger.LogWarning("Failed login attempt for {Email}", req.Email);
                return Unauthorized(new { success = false, error = "Invalid email or password" });
            }

            if (!user.IsActive)
                return Unauthorized(new { success = false, error = "This account has been deactivated" });

            var now = DateTime.UtcNow;
            user.LastLoginAt = now;
            user.LastHeartbeatAt = now;
            await context.SaveChangesAsync();

            var token = jwtTokenService.GenerateToken(user);

            await auditService.LogAsync(user.UserId, USER_LOGIN, new { user.UserId, user.Email, LoggedInAt = now });

            return Ok(new
            {
                success = true,
                data = new
                {
                    token,
                    user = new { user.UserId, user.Email, user.FullName, user.IsActive, user.AvatarUrl },
                },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error during login");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/auth/set-initial-password — sets a password for an account that has
    // never had one (e.g. the SQL-seeded admin, or a Google-SSO account adding local
    // login for the first time). Deliberately unauthenticated so there's a way to
    // bootstrap the very first login, but self-closing: once PasswordHash is set,
    // this always 400s for that account and PUT /api/users/{id}/reset-password (which
    // requires being logged in) is the only way to change it after that.
    [HttpPost("set-initial-password")]
    public async Task<ActionResult<object>> SetInitialPassword([FromBody] LoginRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 8)
                return BadRequest(new { success = false, error = "Email and an 8+ character password are required" });

            var user = await context.Users.FirstOrDefaultAsync(u => u.Email == req.Email.ToLower().Trim());
            if (user == null)
                return NotFound(new { success = false, error = "No account with that email" });

            if (!string.IsNullOrEmpty(user.PasswordHash))
                return BadRequest(new { success = false, error = "This account already has a password set — use the reset-password flow instead" });

            user.PasswordHash = PasswordHasher.Hash(req.Password);
            user.UpdatedAt = DateTime.UtcNow;
            await context.SaveChangesAsync();

            logger.LogInformation("Initial password set for {Email}", user.Email);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error setting initial password");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/auth/google — Google Identity Services login for the JS
    // popup flow: the frontend renders Google's own Sign-In button, gets an
    // ID token back via a JS callback, and posts it here as JSON.
    [HttpPost("google")]
    public async Task<ActionResult<object>> GoogleLogin([FromBody] GoogleLoginRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req.IdToken))
                return BadRequest(new { success = false, error = "Missing Google credential" });

            var (success, error, user) = await VerifyGoogleIdTokenAndUpsertUserAsync(req.IdToken);
            if (!success || user == null)
                return Unauthorized(new { success = false, error });

            var token = jwtTokenService.GenerateToken(user);
            return Ok(new
            {
                success = true,
                data = new
                {
                    token,
                    user = new { user.UserId, user.Email, user.FullName, user.IsActive, user.AvatarUrl },
                },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error during Google login");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/auth/google/callback — Google Identity Services "redirect" UX
    // mode. Instead of a JS popup, the whole tab navigates to Google and back;
    // Google posts the ID token here as a real top-level form submission (not
    // a fetch), so there's no JS callback to hand the JWT to directly. Google
    // also sets a same-site g_csrf_token cookie alongside a form field of the
    // same name for exactly this flow — verifying they match is Google's
    // documented anti-CSRF check for this endpoint (double-submit cookie).
    // The response is a tiny same-origin HTML shim that hands the freshly
    // issued JWT to the SPA's own localStorage before redirecting into the
    // app, keeping the whole app on one bearer-token session model instead of
    // introducing a second, cookie-based one just for this path.
    [HttpPost("google/callback")]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> GoogleLoginCallback([FromForm] string? credential, [FromForm(Name = "g_csrf_token")] string? csrfTokenField)
    {
        const string errorPath = "/login?error=google_signin_failed";

        var csrfCookie = Request.Cookies["g_csrf_token"];
        if (string.IsNullOrEmpty(csrfCookie) || string.IsNullOrEmpty(csrfTokenField) || csrfCookie != csrfTokenField)
        {
            logger.LogWarning("Google sign-in callback rejected: CSRF token mismatch");
            return Redirect(errorPath);
        }

        if (string.IsNullOrWhiteSpace(credential))
            return Redirect(errorPath);

        var (success, error, user) = await VerifyGoogleIdTokenAndUpsertUserAsync(credential);
        if (!success || user == null)
        {
            logger.LogWarning("Google sign-in callback failed: {Error}", error);
            return Redirect($"{errorPath}&reason={Uri.EscapeDataString(error ?? "unknown")}");
        }

        var token = jwtTokenService.GenerateToken(user);
        var html = $$"""
            <!doctype html>
            <html><head><meta charset="utf-8"><title>Signing in…</title></head>
            <body>
            <script>
              localStorage.setItem({{JsonSerializer.Serialize(SessionTokenStorageKey)}}, {{JsonSerializer.Serialize(token)}});
              window.location.replace("/");
            </script>
            </body></html>
            """;
        return Content(html, "text/html");
    }

    // Verifies a Google ID token against Google's own keys (never trust the
    // client), gates on the verified email's domain so only si-ware.com
    // Workspace accounts can sign in, and upserts the matching dms_users row.
    // First-time sign-in auto-provisions the account (no roles/permissions —
    // an admin still has to grant those). Shared by both Google login routes.
    private async Task<(bool Success, string? Error, DmsUser? User)> VerifyGoogleIdTokenAndUpsertUserAsync(string idToken)
    {
        var clientId = configuration["Google:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId))
            return (false, "Google sign-in is not configured", null);

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(idToken, new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = [clientId],
            });
        }
        catch (InvalidJwtException)
        {
            return (false, "Invalid Google credential", null);
        }

        var email = payload.Email?.ToLowerInvariant().Trim() ?? "";
        var isAllowedDomain = payload.EmailVerified && email.EndsWith($"@{AllowedGoogleDomain}", StringComparison.Ordinal);
        if (!isAllowedDomain)
        {
            logger.LogWarning("Rejected Google sign-in for {Email} (domain not allowed)", email);
            return (false, $"Only @{AllowedGoogleDomain} Google accounts can sign in", null);
        }

        var now = DateTime.UtcNow;
        var user = await context.Users.FirstOrDefaultAsync(u => u.Email == email);

        if (user == null)
        {
            user = new DmsUser
            {
                UserId = Guid.NewGuid(),
                Email = email,
                FullName = string.IsNullOrWhiteSpace(payload.Name) ? email : payload.Name,
                SsoSubject = payload.Subject,
                AvatarUrl = payload.Picture,
                IsActive = true,
                CreatedAt = now,
            };
            context.Users.Add(user);
            await auditService.LogAsync(user.UserId, USER_CREATED, new { user.UserId, user.Email, user.FullName, Method = "google" });
        }
        else
        {
            if (!user.IsActive)
                return (false, "This account has been deactivated", null);
            if (string.IsNullOrEmpty(user.SsoSubject))
                user.SsoSubject = payload.Subject;
            // Keep the avatar fresh — Google's photo can change over time.
            if (!string.IsNullOrEmpty(payload.Picture))
                user.AvatarUrl = payload.Picture;
        }

        user.LastLoginAt = now;
        user.LastHeartbeatAt = now;
        user.UpdatedAt = now;
        await context.SaveChangesAsync();

        await auditService.LogAsync(user.UserId, USER_LOGIN, new { user.UserId, user.Email, LoggedInAt = now, Method = "google" });

        return (true, null, user);
    }

    // GET /api/auth/me — resolve the current session's user (app bootstrap on reload).
    [HttpGet("me")]
    public async Task<ActionResult<object>> Me()
    {
        try
        {
            var userId = GetCurrentUserId();
            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == userId);
            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            return Ok(new
            {
                success = true,
                data = new { user.UserId, user.Email, user.FullName, user.IsActive, user.AvatarUrl },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error resolving current session");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/auth/heartbeat — called periodically by the frontend while a tab
    // is open so the Users admin page can show real Online/Offline presence.
    [HttpPost("heartbeat")]
    public async Task<ActionResult<object>> Heartbeat()
    {
        try
        {
            var userId = GetCurrentUserId();
            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == userId);
            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            user.LastHeartbeatAt = DateTime.UtcNow;
            await context.SaveChangesAsync();

            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error recording heartbeat");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record LoginRequest(string Email, string Password);
public record GoogleLoginRequest(string IdToken);
