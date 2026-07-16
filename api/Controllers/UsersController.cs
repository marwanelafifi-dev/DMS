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
    // GET /api/users — قائمة المستخدمين
    [HttpGet]
    public async Task<ActionResult<object>> GetUsers([FromQuery] bool? activeOnly = true)
    {
        try
        {
            var query = context.Users.AsQueryable();

            if (activeOnly == true)
                query = query.Where(u => u.IsActive);

            var users = await query
                .Select(u => new
                {
                    u.UserId,
                    u.Email,
                    u.FullName,
                    u.IsActive,
                    u.CreatedAt,
                    u.LastLoginAt
                })
                .OrderBy(u => u.FullName)
                .ToListAsync();

            logger.LogInformation("Retrieved {Count} users", users.Count);
            return Ok(new { success = true, data = users, count = users.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving users");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/users/{id} — تفاصيل مستخدم
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetUser(Guid id)
    {
        try
        {
            var user = await context.Users
                .FirstOrDefaultAsync(u => u.UserId == id);

            if (user == null)
                return NotFound(new { success = false, error = "المستخدم غير موجود" });

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
                    Permissions = permissions,
                    PendingTasks = taskCount,
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

    // POST /api/users — إنشاء مستخدم جديد
    [HttpPost]
    public async Task<ActionResult<object>> CreateUser([FromBody] CreateUserRequest req)
    {
        try
        {
            // التحقق من المدخلات
            if (string.IsNullOrWhiteSpace(req.Email))
                return BadRequest(new { success = false, error = "البريد الإلكتروني مطلوب" });

            if (string.IsNullOrWhiteSpace(req.FullName))
                return BadRequest(new { success = false, error = "الاسم الكامل مطلوب" });

            // التحقق من عدم تكرار البريد
            if (await context.Users.AnyAsync(u => u.Email == req.Email.ToLower()))
                return BadRequest(new { success = false, error = "المستخدم بهذا البريد موجود بالفعل" });

            var user = new DmsUser
            {
                UserId = Guid.NewGuid(),
                Email = req.Email.ToLower().Trim(),
                FullName = req.FullName.Trim(),
                SsoSubject = req.SsoSubject?.Trim(),
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

    // PUT /api/users/{id} — تعديل مستخدم
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateUser(Guid id, [FromBody] UpdateUserRequest req)
    {
        try
        {
            var user = await context.Users
                .FirstOrDefaultAsync(u => u.UserId == id);

            if (user == null)
                return NotFound(new { success = false, error = "المستخدم غير موجود" });

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

    // DELETE /api/users/{id} — تعطيل المستخدم (soft delete - عدم الحذف الحقيقي)
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeactivateUser(Guid id)
    {
        try
        {
            var user = await context.Users
                .FirstOrDefaultAsync(u => u.UserId == id);

            if (user == null)
                return NotFound(new { success = false, error = "المستخدم غير موجود" });

            user.IsActive = false;
            user.UpdatedAt = DateTime.UtcNow;

            context.Users.Update(user);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, USER_DEACTIVATED, new
            {
                user.UserId,
                user.Email,
                user.FullName,
                DeactivatedAt = DateTime.UtcNow
            });

            logger.LogInformation("Deactivated user {UserId}", id);

            return Ok(new { success = true, message = "تم تعطيل المستخدم بنجاح" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deactivating user {UserId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateUserRequest(string Email, string FullName, string? SsoSubject = null);
public record UpdateUserRequest(string? FullName = null, bool? IsActive = null);
