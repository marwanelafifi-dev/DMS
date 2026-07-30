using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(DmsContext context, JwtTokenService jwtTokenService, AuditService auditService, ILogger<AuthController> logger) : BaseController
{
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
                    user = new { user.UserId, user.Email, user.FullName, user.IsActive },
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
                data = new { user.UserId, user.Email, user.FullName, user.IsActive },
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
