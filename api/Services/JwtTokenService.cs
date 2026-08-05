using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace DMS.Api.Services;

// Issues and validates the JWT bearer tokens login sessions run on. Kept
// deliberately separate from ASP.NET's built-in authentication scheme —
// JwtAuthMiddleware validates the token directly and forwards the resulting
// user id into the existing X-User-Id-based RBAC pipeline, so none of the
// existing permission-checking code had to change.
public class JwtTokenService(IConfiguration configuration, IServiceScopeFactory scopeFactory)
{
    public const string ForceSignOutSettingKey = "global_signout_before";

    private readonly string _secret = configuration["Jwt:Secret"]
        ?? throw new InvalidOperationException("Jwt:Secret is not configured");
    private readonly string _issuer = configuration["Jwt:Issuer"] ?? "dms-api";
    private readonly string _audience = configuration["Jwt:Audience"] ?? "dms-web";
    private readonly int _expiryMinutes = configuration.GetValue<int?>("Jwt:ExpiryMinutes") ?? 480;

    // expiryMinutesOverride lets callers apply the admin-configured Session
    // Timeout (Settings -> Security) instead of the fixed Jwt:ExpiryMinutes
    // env default — see AuthController.GetSessionTimeoutMinutesAsync.
    public string GenerateToken(DmsUser user, int? expiryMinutesOverride = null)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var issuedAt = DateTime.UtcNow;

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.UserId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim("name", user.FullName),
            // Explicit custom claim (not the standard "iat") since
            // JwtSecurityTokenHandler doesn't surface the auto-added
            // registered "iat" back out as a friendly ClaimsPrincipal entry —
            // this is what "Force sign-out all users" compares against.
            new Claim("issued_at", new DateTimeOffset(issuedAt).ToUnixTimeSeconds().ToString()),
        };

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            notBefore: issuedAt,
            expires: issuedAt.AddMinutes(expiryMinutesOverride ?? _expiryMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public async Task<Guid?> ValidateTokenAndGetUserIdAsync(string token)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        // Without this, ValidateToken silently renames the "sub" claim to the long
        // ClaimTypes.NameIdentifier URI, so FindFirst(JwtRegisteredClaimNames.Sub)
        // below would always return null post-validation.
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };

        try
        {
            var principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = _issuer,
                ValidateAudience = true,
                ValidAudience = _audience,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = key,
                ClockSkew = TimeSpan.FromSeconds(30),
            }, out _);

            var subject = principal.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
            if (!Guid.TryParse(subject, out var userId))
                return null;

            // "Force sign-out all users" works by recording the moment it was
            // pressed — any token issued before that moment is treated as
            // expired, without needing a per-token revocation list.
            var issuedAtClaim = principal.FindFirst("issued_at")?.Value;
            if (long.TryParse(issuedAtClaim, out var issuedAtUnix))
            {
                using var scope = scopeFactory.CreateScope();
                var context = scope.ServiceProvider.GetRequiredService<DmsContext>();
                var setting = await context.AppSettings.AsNoTracking()
                    .FirstOrDefaultAsync(s => s.Key == ForceSignOutSettingKey);

                if (DateTime.TryParse(setting?.Value, null, System.Globalization.DateTimeStyles.RoundtripKind, out var cutoff))
                {
                    var issuedAt = DateTimeOffset.FromUnixTimeSeconds(issuedAtUnix).UtcDateTime;
                    if (issuedAt < cutoff)
                        return null;
                }
            }

            return userId;
        }
        catch
        {
            return null;
        }
    }
}
