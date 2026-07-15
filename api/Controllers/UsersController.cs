using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController(DmsContext context) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetUsers()
    {
        var users = await context.Users
            .Where(u => u.IsActive)
            .Select(u => new
            {
                u.UserId,
                u.Email,
                u.FullName,
                u.CreatedAt,
                u.LastLoginAt
            })
            .ToListAsync();
        return Ok(users);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetUser(Guid id)
    {
        var user = await context.Users
            .Include(u => u.Permissions)
            .FirstOrDefaultAsync(u => u.UserId == id);

        if (user == null)
            return NotFound();

        return Ok(new
        {
            user.UserId,
            user.Email,
            user.FullName,
            user.IsActive,
            Permissions = user.Permissions.Select(p => new { p.FolderId, p.Role }),
            user.CreatedAt,
            user.LastLoginAt
        });
    }

    [HttpPost]
    public async Task<ActionResult<object>> CreateUser(CreateUserRequest req)
    {
        // Check if user already exists
        if (await context.Users.AnyAsync(u => u.Email == req.Email))
            return BadRequest("User with this email already exists");

        var user = new DmsUser
        {
            UserId = Guid.NewGuid(),
            Email = req.Email,
            FullName = req.FullName,
            SsoSubject = req.SsoSubject,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        context.Users.Add(user);
        await context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetUser), new { id = user.UserId }, new
        {
            user.UserId,
            user.Email,
            user.FullName,
            user.CreatedAt
        });
    }
}

public record CreateUserRequest(string Email, string FullName, string? SsoSubject = null);
