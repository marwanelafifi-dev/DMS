using DMS.Api.Services;

namespace DMS.Api.Middleware;

// Validates the JWT issued by AuthController.Login and forwards the resulting
// user id into the existing X-User-Id-based RBAC pipeline (RBACMiddleware,
// BaseController.GetCurrentUserId) — so login is enforced without having to
// rewrite the permission-checking logic that already trusts that header.
public class JwtAuthMiddleware(RequestDelegate next, JwtTokenService jwtTokenService, ILogger<JwtAuthMiddleware> logger)
{
    private static readonly string[] PublicEndpoints =
    {
        "/health",
        "/api/test",
        "/api/miniotest",
        "/api/databasetest",
        "/api/auth/login",
        "/api/auth/set-initial-password",
        // Google redirects the user's browser here directly after OAuth consent —
        // there is no Authorization header on that request.
        "/api/googlecalendar/callback",
    };

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        if (PublicEndpoints.Any(endpoint => path.StartsWith(endpoint, StringComparison.OrdinalIgnoreCase)))
        {
            await next(context);
            return;
        }

        var authHeader = context.Request.Headers.Authorization.ToString();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            logger.LogWarning("Missing or invalid Authorization header for {Path}", path);
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { success = false, error = "Login required" });
            return;
        }

        var token = authHeader["Bearer ".Length..].Trim();
        var userId = jwtTokenService.ValidateTokenAndGetUserId(token);

        if (userId == null)
        {
            logger.LogWarning("Invalid or expired session token for {Path}", path);
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { success = false, error = "Session expired — please log in again" });
            return;
        }

        // RBACMiddleware (next in the pipeline) resolves the current user from this
        // header — overwrite whatever the client sent so the validated token is the
        // only source of truth, not anything the client could spoof.
        context.Request.Headers["X-User-Id"] = userId.Value.ToString();

        await next(context);
    }
}
