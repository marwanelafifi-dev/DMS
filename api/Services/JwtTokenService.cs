using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using DMS.Api.Models;
using Microsoft.IdentityModel.Tokens;

namespace DMS.Api.Services;

// Issues and validates the JWT bearer tokens login sessions run on. Kept
// deliberately separate from ASP.NET's built-in authentication scheme —
// JwtAuthMiddleware validates the token directly and forwards the resulting
// user id into the existing X-User-Id-based RBAC pipeline, so none of the
// existing permission-checking code had to change.
public class JwtTokenService(IConfiguration configuration)
{
    private readonly string _secret = configuration["Jwt:Secret"]
        ?? throw new InvalidOperationException("Jwt:Secret is not configured");
    private readonly string _issuer = configuration["Jwt:Issuer"] ?? "dms-api";
    private readonly string _audience = configuration["Jwt:Audience"] ?? "dms-web";
    private readonly int _expiryMinutes = configuration.GetValue<int?>("Jwt:ExpiryMinutes") ?? 480;

    public string GenerateToken(DmsUser user)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.UserId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim("name", user.FullName),
        };

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_expiryMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public Guid? ValidateTokenAndGetUserId(string token)
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
            return Guid.TryParse(subject, out var userId) ? userId : null;
        }
        catch
        {
            return null;
        }
    }
}
