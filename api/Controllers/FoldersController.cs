using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FoldersController(DmsContext context) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetFolders()
    {
        var folders = await context.Folders
            .Include(f => f.Owner)
            .Select(f => new
            {
                f.FolderId,
                f.Name,
                f.Description,
                f.Classification,
                f.ParentFolderId,
                Owner = f.Owner!.FullName,
                f.CreatedAt
            })
            .ToListAsync();
        return Ok(folders);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetFolder(Guid id)
    {
        var folder = await context.Folders
            .Include(f => f.Owner)
            .Include(f => f.Permissions)
            .FirstOrDefaultAsync(f => f.FolderId == id);

        if (folder == null)
            return NotFound();

        return Ok(new
        {
            folder.FolderId,
            folder.Name,
            folder.Description,
            folder.Classification,
            folder.ParentFolderId,
            Owner = folder.Owner!.FullName,
            Permissions = folder.Permissions.Select(p => new { p.UserId, p.Role }),
            folder.CreatedAt
        });
    }

    [HttpPost]
    public async Task<ActionResult<object>> CreateFolder(CreateFolderRequest req)
    {
        var folder = new DmsFolder
        {
            FolderId = Guid.NewGuid(),
            ParentFolderId = req.ParentFolderId,
            Name = req.Name,
            Description = req.Description,
            Classification = req.Classification ?? "standard",
            OwnerId = req.OwnerId,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        context.Folders.Add(folder);
        await context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetFolder), new { id = folder.FolderId }, new
        {
            folder.FolderId,
            folder.Name,
            folder.CreatedAt
        });
    }
}

public record CreateFolderRequest(string Name, Guid OwnerId, Guid? ParentFolderId = null, string? Description = null, string? Classification = null);
