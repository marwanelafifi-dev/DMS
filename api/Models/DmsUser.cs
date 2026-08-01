namespace DMS.Api.Models;

public class DmsUser
{
    public Guid UserId { get; set; }
    public string Email { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? SsoSubject { get; set; }
    public string? PasswordHash { get; set; }
    public string? AvatarUrl { get; set; }
    public byte[]? MfaSecret { get; set; }
    public string? Role { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? LastLoginAt { get; set; }
    public DateTime? LastHeartbeatAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
