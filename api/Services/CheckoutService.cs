using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public class CheckoutService(DmsContext context, AuditService auditService, ILogger<CheckoutService> logger)
{
    private const int CheckoutTimeoutMinutes = 60; // Automatic unlock after 1 hour

    public async Task<CheckoutResult> CheckoutAsync(Guid versionId, Guid userId, string? reason = null)
    {
        try
        {
            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(v => v.VersionId == versionId);

            if (version == null)
                return CheckoutResult.NotFound("Version not found");

            if (version.IsCheckedOut && version.CheckedOutById != userId)
                return CheckoutResult.AlreadyCheckedOut($"Checked out by another user at {version.CheckedOutAt:g}");

            // Prevent checkout if already approved/released
            if (version.Status == "released" || version.Status == "archived")
                return CheckoutResult.Invalid($"Cannot checkout {version.Status} documents");

            version.IsCheckedOut = true;
            version.CheckedOutById = userId;
            version.CheckedOutAt = DateTime.UtcNow;
            version.CheckoutReason = reason?.Trim();
            version.UpdatedAt = DateTime.UtcNow;

            context.DocumentVersions.Update(version);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.DOCUMENT_CHECKOUT, new
            {
                version.VersionId,
                version.DocumentId,
                version.VersionNumber,
                reason,
                version.CheckedOutAt
            });

            logger.LogInformation("Document version {VersionId} checked out by user {UserId}", versionId, userId);

            return CheckoutResult.Success(new
            {
                version.VersionId,
                version.DocumentId,
                version.VersionNumber,
                version.FileName,
                version.Status,
                version.CheckedOutAt,
                CheckoutTimeoutMinutes,
                UnlockAt = version.CheckedOutAt?.AddMinutes(CheckoutTimeoutMinutes)
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error checking out version {VersionId}", versionId);
            return CheckoutResult.Error(ex.Message);
        }
    }

    public async Task<CheckoutResult> CheckinAsync(Guid versionId, Guid userId)
    {
        try
        {
            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(v => v.VersionId == versionId);

            if (version == null)
                return CheckoutResult.NotFound("Version not found");

            if (!version.IsCheckedOut)
                return CheckoutResult.Invalid("Document is not checked out");

            if (version.CheckedOutById != userId)
                return CheckoutResult.Forbidden("Only the user who checked out can check in");

            version.IsCheckedOut = false;
            version.CheckedOutById = null;
            version.CheckedOutAt = null;
            version.CheckoutReason = null;
            version.UpdatedAt = DateTime.UtcNow;

            context.DocumentVersions.Update(version);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.DOCUMENT_CHECKIN, new
            {
                version.VersionId,
                version.DocumentId,
                version.VersionNumber,
                version.FileName,
                CheckedInAt = DateTime.UtcNow
            });

            logger.LogInformation("Document version {VersionId} checked in by user {UserId}", versionId, userId);

            return CheckoutResult.Success(new
            {
                version.VersionId,
                version.DocumentId,
                version.VersionNumber,
                version.Status,
                Message = "Document checked in successfully"
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error checking in version {VersionId}", versionId);
            return CheckoutResult.Error(ex.Message);
        }
    }

    public async Task<object?> GetCheckoutStatusAsync(Guid versionId)
    {
        try
        {
            var version = await context.DocumentVersions
                .FirstOrDefaultAsync(v => v.VersionId == versionId);

            if (version == null)
                return null;

            if (!version.IsCheckedOut)
                return new
                {
                    IsCheckedOut = false,
                    Message = "Document is not checked out"
                };

            var user = await context.Users
                .FirstOrDefaultAsync(u => u.UserId == version.CheckedOutById);

            var unlockAt = version.CheckedOutAt?.AddMinutes(CheckoutTimeoutMinutes);
            var isExpired = unlockAt < DateTime.UtcNow;

            return new
            {
                IsCheckedOut = true,
                CheckedOutBy = user?.FullName,
                CheckedOutByEmail = user?.Email,
                CheckedOutAt = version.CheckedOutAt,
                CheckoutReason = version.CheckoutReason,
                UnlockAt = unlockAt,
                IsExpired = isExpired,
                TimeRemaining = isExpired ? TimeSpan.Zero : (unlockAt - DateTime.UtcNow)
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error getting checkout status for version {VersionId}", versionId);
            return null;
        }
    }

    public async Task<int> AutoUnlockExpiredCheckoutsAsync()
    {
        try
        {
            var expiredCheckouts = await context.DocumentVersions
                .Where(v => v.IsCheckedOut &&
                           v.CheckedOutAt != null &&
                           v.CheckedOutAt.Value.AddMinutes(CheckoutTimeoutMinutes) < DateTime.UtcNow)
                .ToListAsync();

            if (expiredCheckouts.Count == 0)
                return 0;

            foreach (var version in expiredCheckouts)
            {
                var userId = version.CheckedOutById;
                version.IsCheckedOut = false;
                version.CheckedOutById = null;
                version.CheckedOutAt = null;
                version.CheckoutReason = null;
                version.UpdatedAt = DateTime.UtcNow;

                context.DocumentVersions.Update(version);

                if (userId.HasValue)
                {
                    await auditService.LogAsync(userId.Value, AuditActions.DOCUMENT_CHECKOUT_EXPIRED, new
                    {
                        version.VersionId,
                        version.DocumentId,
                        version.VersionNumber,
                        Message = "Checkout expired (60 min timeout)"
                    });
                }
            }

            await context.SaveChangesAsync();

            logger.LogInformation("Auto-unlocked {Count} expired checkouts", expiredCheckouts.Count);
            return expiredCheckouts.Count;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error auto-unlocking expired checkouts");
            return 0;
        }
    }
}

public class CheckoutResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public object? Data { get; set; }
    public string? Error { get; set; }

    public static CheckoutResult Success(object data) => new() { Success = true, Data = data };
    public static CheckoutResult NotFound(string message) => new() { Success = false, Message = message, Error = "NotFound" };
    public static CheckoutResult AlreadyCheckedOut(string message) => new() { Success = false, Message = message, Error = "AlreadyCheckedOut" };
    public static CheckoutResult Invalid(string message) => new() { Success = false, Message = message, Error = "Invalid" };
    public static CheckoutResult Forbidden(string message) => new() { Success = false, Message = message, Error = "Forbidden" };
    public static CheckoutResult Error(string message) => new() { Success = false, Message = message, Error = "InternalError" };
}
