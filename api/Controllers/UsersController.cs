using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController(DmsContext context, AuditService auditService, ILogger<UsersController> logger) : BaseController
{
    // GET /api/users — list of users
    // Pass `page`/`pageSize` to paginate (used by the Users admin table); omit both to get
    // the full list unpaginated (used by lookup/dropdown callers like Audit Trail and Folder Permissions).
    [HttpGet]
    public async Task<ActionResult<object>> GetUsers(
        [FromQuery] bool? activeOnly = true,
        [FromQuery] int? page = null,
        [FromQuery] int? pageSize = null)
    {
        try
        {
            var query = context.Users.AsQueryable();

            if (activeOnly == true)
                query = query.Where(u => u.IsActive);

            query = query.OrderBy(u => u.FullName);

            int? totalCount = null;
            if (page.HasValue || pageSize.HasValue)
            {
                var effectivePage = Math.Max(1, page ?? 1);
                var effectivePageSize = Math.Clamp(pageSize ?? 20, 1, 500);

                totalCount = await query.CountAsync();
                query = query.Skip((effectivePage - 1) * effectivePageSize).Take(effectivePageSize);
                page = effectivePage;
                pageSize = effectivePageSize;
            }

            var pagedUsers = await query
                .Select(u => new
                {
                    u.UserId,
                    u.Email,
                    u.FullName,
                    u.IsActive,
                    u.CreatedAt,
                    u.LastLoginAt,
                    u.LastHeartbeatAt,
                    u.AvatarUrl,
                    u.Role,
                    AuthType = u.SsoSubject != null ? "Google" : "Local"
                })
                .ToListAsync();

            var onlineThreshold = DateTime.UtcNow.AddMinutes(-3);
            var users = pagedUsers.Select(u => new
            {
                u.UserId,
                u.Email,
                u.FullName,
                u.IsActive,
                u.CreatedAt,
                u.LastLoginAt,
                u.AuthType,
                u.AvatarUrl,
                IsOnline = u.LastHeartbeatAt.HasValue && u.LastHeartbeatAt.Value >= onlineThreshold,
                // The user's directly-assigned global role (see PUT /{id}/role),
                // shown as-is on the Users admin page; null means "No Access".
                Role = u.Role,
                AccessLevel = u.Role ?? "No Access",
            }).ToList();

            logger.LogInformation("Retrieved {Count} users", users.Count);

            if (totalCount.HasValue)
            {
                return Ok(new
                {
                    success = true,
                    data = users,
                    count = users.Count,
                    page,
                    pageSize,
                    totalCount = totalCount.Value,
                    totalPages = (int)Math.Ceiling(totalCount.Value / (double)pageSize!.Value)
                });
            }

            return Ok(new { success = true, data = users, count = users.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving users");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/users/{id} — user details
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetUser(Guid id)
    {
        try
        {
            var user = await context.Users
                .FirstOrDefaultAsync(u => u.UserId == id);

            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            var permissions = await context.FolderPermissions
                .Where(p => p.UserId == id)
                .Select(p => new { p.PermissionId, p.FolderId, p.Role, p.GrantedAt })
                .ToListAsync();

            var taskCount = await context.Tasks
                .Where(t => t.AssignedToId == id && t.Status != "completed")
                .CountAsync();

            logger.LogInformation("Retrieved user {UserId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    user.UserId,
                    user.Email,
                    user.FullName,
                    user.IsActive,
                    user.SsoSubject,
                    user.AvatarUrl,
                    Permissions = permissions,
                    PendingTasks = taskCount,
                    user.Role,
                    user.CreatedAt,
                    user.LastLoginAt,
                    user.UpdatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving user {UserId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/users — create a new user
    [HttpPost]
    public async Task<ActionResult<object>> CreateUser([FromBody] CreateUserRequest req)
    {
        try
        {
            // Validate input
            if (string.IsNullOrWhiteSpace(req.Email))
                return BadRequest(new { success = false, error = "Email is required" });

            if (string.IsNullOrWhiteSpace(req.FullName))
                return BadRequest(new { success = false, error = "Full name is required" });

            // Check for duplicate email
            if (await context.Users.AnyAsync(u => u.Email == req.Email.ToLower()))
                return BadRequest(new { success = false, error = "A user with this email already exists" });

            if (!string.IsNullOrEmpty(req.Password))
            {
                var passwordError = PasswordPolicy.Validate(req.Password, await PlatformSettingsService.LoadSecurityAsync(context));
                if (passwordError != null)
                    return BadRequest(new { success = false, error = passwordError });
            }

            var user = new DmsUser
            {
                UserId = Guid.NewGuid(),
                Email = req.Email.ToLower().Trim(),
                FullName = req.FullName.Trim(),
                SsoSubject = req.SsoSubject?.Trim(),
                PasswordHash = string.IsNullOrEmpty(req.Password) ? null : PasswordHasher.Hash(req.Password),
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.Users.Add(user);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, USER_CREATED, new
            {
                user.UserId,
                user.Email,
                user.FullName,
                user.CreatedAt
            });

            logger.LogInformation("Created user {UserId} with email {Email}", user.UserId, user.Email);

            return CreatedAtAction(nameof(GetUser), new { id = user.UserId }, new
            {
                success = true,
                data = new
                {
                    user.UserId,
                    user.Email,
                    user.FullName,
                    user.CreatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating user");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/users/{id} — update user
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateUser(Guid id, [FromBody] UpdateUserRequest req)
    {
        try
        {
            if (req.IsActive == false && id == GetCurrentUserId())
                return BadRequest(new { success = false, error = "You cannot deactivate your own account" });

            var user = await context.Users
                .FirstOrDefaultAsync(u => u.UserId == id);

            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            if (!string.IsNullOrWhiteSpace(req.FullName))
                user.FullName = req.FullName.Trim();

            if (req.IsActive.HasValue)
                user.IsActive = req.IsActive.Value;

            user.UpdatedAt = DateTime.UtcNow;

            context.Users.Update(user);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, USER_UPDATED, new
            {
                user.UserId,
                user.Email,
                user.FullName,
                user.IsActive,
                user.UpdatedAt,
                ChangedFields = req
            });

            logger.LogInformation("Updated user {UserId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    user.UserId,
                    user.Email,
                    user.FullName,
                    user.IsActive,
                    user.UpdatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating user {UserId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/users/{id}/role — assign (or clear) a user's global role
    [HttpPut("{id}/role")]
    public async Task<ActionResult<object>> UpdateUserRole(Guid id, [FromBody] UpdateUserRoleRequest req)
    {
        try
        {
            var currentUserId = GetCurrentUserId();
            if (id == currentUserId)
                return BadRequest(new { success = false, error = "You cannot change your own role" });

            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == id);
            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            var role = string.IsNullOrWhiteSpace(req.Role) ? null : req.Role.Trim();
            if (role != null && !await context.PageAccessRoles.AnyAsync(r => r.Role == role))
                return BadRequest(new { success = false, error = $"Unknown role '{role}'" });

            user.Role = role;
            user.UpdatedAt = DateTime.UtcNow;

            context.Users.Update(user);
            await context.SaveChangesAsync();

            await auditService.LogAsync(currentUserId, USER_ROLE_UPDATED, new
            {
                user.UserId,
                user.Email,
                NewRole = role,
            });

            logger.LogInformation("Updated role for user {UserId} to {Role}", id, role ?? "(none)");

            return Ok(new { success = true, data = new { user.UserId, Role = role } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating role for user {UserId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/users/{id} — deactivate user (soft delete, not a real delete)
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeactivateUser(Guid id)
    {
        try
        {
            var currentUserId = GetCurrentUserId();
            if (id == currentUserId)
                return BadRequest(new { success = false, error = "You cannot deactivate your own account" });

            var user = await context.Users
                .FirstOrDefaultAsync(u => u.UserId == id);

            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            user.IsActive = false;
            user.UpdatedAt = DateTime.UtcNow;

            context.Users.Update(user);
            await context.SaveChangesAsync();

            await auditService.LogAsync(currentUserId, USER_DEACTIVATED, new
            {
                user.UserId,
                user.Email,
                user.FullName,
                DeactivatedAt = DateTime.UtcNow
            });

            logger.LogInformation("Deactivated user {UserId}", id);

            return Ok(new { success = true, message = "User deactivated successfully" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deactivating user {UserId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/users/{id}/reset-password — reset password (for local users)
    [HttpPut("{id}/reset-password")]
    public async Task<ActionResult<object>> ResetPassword(Guid id, [FromBody] ResetPasswordRequest req)
    {
        try
        {
            if (string.IsNullOrEmpty(req.NewPassword))
                return BadRequest(new { success = false, error = "Password is required" });

            var passwordError = PasswordPolicy.Validate(req.NewPassword, await PlatformSettingsService.LoadSecurityAsync(context));
            if (passwordError != null)
                return BadRequest(new { success = false, error = passwordError });

            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == id);
            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            user.PasswordHash = PasswordHasher.Hash(req.NewPassword);
            user.UpdatedAt = DateTime.UtcNow;

            context.Users.Update(user);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, USER_PASSWORD_RESET, new
            {
                user.UserId,
                user.Email,
                ResetAt = DateTime.UtcNow
            });

            logger.LogInformation("Password reset for user {UserId}", id);

            return Ok(new { success = true, message = "Password reset successfully" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error resetting password for user {UserId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/users/{id}/transfer-ownership — hands every folder/document
    // owned, task assigned/managed, in-flight checkout, and other live-work
    // reference held by this user over to a different active user, so the
    // account can then actually be permanently deleted instead of just
    // deactivated. Deliberately does NOT touch dms_esignatures.user_id or
    // dms_reminders.recipient_id — both are WORM-protected (UPDATE is
    // rejected at the DB trigger level) since they're historical compliance
    // records, not live ownership; an account that has ever signed or been
    // reminded about something will still block permanent deletion even
    // after a transfer, by design — that's what Deactivate is for.
    [HttpPost("{id}/transfer-ownership")]
    public async Task<ActionResult<object>> TransferOwnership(Guid id, [FromBody] TransferOwnershipRequest req)
    {
        try
        {
            if (req.ToUserId == Guid.Empty)
                return BadRequest(new { success = false, error = "toUserId is required" });
            if (req.ToUserId == id)
                return BadRequest(new { success = false, error = "Source and destination user must be different" });

            var fromUser = await context.Users.FirstOrDefaultAsync(u => u.UserId == id);
            if (fromUser == null)
                return NotFound(new { success = false, error = "Source user not found" });

            var toUser = await context.Users.FirstOrDefaultAsync(u => u.UserId == req.ToUserId);
            if (toUser == null)
                return NotFound(new { success = false, error = "Destination user not found" });
            if (!toUser.IsActive)
                return BadRequest(new { success = false, error = "Cannot transfer ownership to an inactive user" });

            await using var transaction = await context.Database.BeginTransactionAsync();

            var updatedCounts = new Dictionary<string, int>();
            async Task RunAsync(string label, FormattableString sql)
            {
                var rows = await context.Database.ExecuteSqlInterpolatedAsync(sql);
                if (rows > 0) updatedCounts[label] = rows;
            }

            await RunAsync("foldersOwned", $"UPDATE dms_folders SET owner_id = {req.ToUserId} WHERE owner_id = {id}");
            await RunAsync("folderPermissionsGrantedBy", $"UPDATE dms_folder_permissions SET granted_by_id = {req.ToUserId} WHERE granted_by_id = {id}");
            await RunAsync("documentsOwned", $"UPDATE dms_documents SET owner_id = {req.ToUserId} WHERE owner_id = {id}");
            await RunAsync("versionCheckouts", $"UPDATE dms_document_versions SET checked_out_by = {req.ToUserId} WHERE checked_out_by = {id}");
            await RunAsync("versionSubmissions", $"UPDATE dms_document_versions SET submitted_by_id = {req.ToUserId} WHERE submitted_by_id = {id}");
            await RunAsync("versionApprovals", $"UPDATE dms_document_versions SET approved_by_id = {req.ToUserId} WHERE approved_by_id = {id}");
            await RunAsync("workflowStepsAssigned", $"UPDATE dms_workflow_steps SET assigned_to_id = {req.ToUserId} WHERE assigned_to_id = {id}");
            await RunAsync("workflowStepsCompleted", $"UPDATE dms_workflow_steps SET completed_by_id = {req.ToUserId} WHERE completed_by_id = {id}");
            await RunAsync("tasksAssigned", $"UPDATE dms_tasks SET assigned_to_id = {req.ToUserId} WHERE assigned_to_id = {id}");
            await RunAsync("tasksManaged", $"UPDATE dms_tasks SET manager_id = {req.ToUserId} WHERE manager_id = {id}");
            await RunAsync("tasksCompleted", $"UPDATE dms_tasks SET completed_by_id = {req.ToUserId} WHERE completed_by_id = {id}");
            await RunAsync("tasksQaReviewed", $"UPDATE dms_tasks SET qa_reviewed_by_id = {req.ToUserId} WHERE qa_reviewed_by_id = {id}");
            await RunAsync("approvalsCreated", $"UPDATE dms_approvals SET created_by = {req.ToUserId} WHERE created_by = {id}");
            await RunAsync("accessOverridesCreated", $"UPDATE dms_access_overrides SET created_by = {req.ToUserId} WHERE created_by = {id}");
            await RunAsync("auditCalendarEventsPosted", $"UPDATE dms_audit_calendar_events SET posted_by = {req.ToUserId} WHERE posted_by = {id}");
            await RunAsync("taskAttachmentsUploaded", $"UPDATE dms_task_attachments SET uploaded_by = {req.ToUserId} WHERE uploaded_by = {id}");

            await transaction.CommitAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, USER_OWNERSHIP_TRANSFERRED, new
            {
                FromUserId = id,
                FromEmail = fromUser.Email,
                ToUserId = req.ToUserId,
                ToEmail = toUser.Email,
                Updated = updatedCounts,
            });

            logger.LogInformation("Transferred ownership from user {FromUserId} to {ToUserId}", id, req.ToUserId);

            var remainingEsignatures = await context.Database.SqlQuery<int>($"SELECT COUNT(*)::int AS \"Value\" FROM dms_esignatures WHERE user_id = {id}").FirstOrDefaultAsync();
            var remainingReminders = await context.Database.SqlQuery<int>($"SELECT COUNT(*)::int AS \"Value\" FROM dms_reminders WHERE recipient_id = {id}").FirstOrDefaultAsync();
            string? note = null;
            if (remainingEsignatures > 0 || remainingReminders > 0)
                note = "This user still has e-signatures and/or reminders on record — those are permanent compliance history and can't be reassigned, so this account still can't be permanently deleted. Deactivate it instead.";

            return Ok(new { success = true, updated = updatedCounts, note });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error transferring ownership from user {FromUserId} to {ToUserId}", id, req.ToUserId);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/users/{id}/permanent — permanent delete (cannot be undone)
    [HttpDelete("{id}/permanent")]
    public async Task<ActionResult<object>> DeleteUserPermanently(Guid id)
    {
        try
        {
            var currentUserId = GetCurrentUserId();
            if (id == currentUserId)
                return BadRequest(new { success = false, error = "You cannot delete your own account" });

            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == id);
            if (user == null)
                return NotFound(new { success = false, error = "User not found" });

            await auditService.LogAsync(currentUserId, USER_DELETED, new
            {
                user.UserId,
                user.Email,
                user.FullName,
                DeletedAt = DateTime.UtcNow
            });

            context.Users.Remove(user);
            await context.SaveChangesAsync();

            logger.LogInformation("Permanently deleted user {UserId}", id);

            return Ok(new { success = true, message = "User permanently deleted" });
        }
        catch (DbUpdateException)
        {
            return Conflict(new
            {
                success = false,
                error = "This user cannot be deleted because they still have documents, tasks, or signatures associated with them. Deactivate them instead."
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error permanently deleting user {UserId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateUserRequest(string Email, string FullName, string? SsoSubject = null, string? Password = null);
public record UpdateUserRequest(string? FullName = null, bool? IsActive = null);
public record UpdateUserRoleRequest(string? Role);
public record ResetPasswordRequest(string NewPassword);
public record TransferOwnershipRequest(Guid ToUserId);
