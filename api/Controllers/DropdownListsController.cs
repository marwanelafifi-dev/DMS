using ClosedXML.Excel;
using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Admin-editable dropdown lists (Department, Category, Tags) — the Company
// Data admin page manages these; the upload form and Edit Document modal
// read them instead of hardcoding the option list in the frontend. Anyone
// authenticated can read the lists (they're needed just to render the
// upload form), but only a user whose page-access role can view the Admin
// Panel can add/delete/import items.
[ApiController]
[Route("api/dropdown-lists")]
public class DropdownListsController(DmsContext context, AuditService auditService, ILogger<DropdownListsController> logger) : BaseController
{
    // GET /api/dropdown-lists — every list, grouped by key (Company Data page)
    [HttpGet]
    public async Task<ActionResult<object>> GetAll()
    {
        try
        {
            var items = await context.DropdownItems
                .OrderBy(i => i.SortOrder).ThenBy(i => i.Label)
                .ToListAsync();

            var grouped = DropdownListKeys.All.ToDictionary(
                key => key,
                key => items.Where(i => i.ListKey == key).Select(i => new { i.ItemId, i.Label }).ToList());

            return Ok(new { success = true, data = grouped });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving dropdown lists");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/dropdown-lists/{key} — one list (upload form / Edit Document modal)
    [HttpGet("{key}")]
    public async Task<ActionResult<object>> GetOne(string key)
    {
        try
        {
            if (!DropdownListKeys.IsValid(key))
                return NotFound(new { success = false, error = $"Unknown list '{key}'" });

            var items = await context.DropdownItems
                .Where(i => i.ListKey == key)
                .OrderBy(i => i.SortOrder).ThenBy(i => i.Label)
                .Select(i => new { i.ItemId, i.Label })
                .ToListAsync();

            return Ok(new { success = true, data = items });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving dropdown list {Key}", key);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/dropdown-lists/{key}/items — add one item
    [HttpPost("{key}/items")]
    public async Task<ActionResult<object>> AddItem(string key, [FromBody] AddDropdownItemRequest req)
    {
        try
        {
            if (!DropdownListKeys.IsValid(key))
                return NotFound(new { success = false, error = $"Unknown list '{key}'" });

            var forbidden = await RequireAdminPanelAccessAsync();
            if (forbidden != null) return forbidden;

            var label = req.Label?.Trim() ?? string.Empty;
            if (label.Length == 0)
                return BadRequest(new { success = false, error = "Label is required" });

            if (await context.DropdownItems.AnyAsync(i => i.ListKey == key && i.Label.ToLower() == label.ToLower()))
                return BadRequest(new { success = false, error = $"'{label}' already exists in this list" });

            var maxSortOrder = await context.DropdownItems.Where(i => i.ListKey == key).MaxAsync(i => (int?)i.SortOrder) ?? 0;
            var entity = new DmsDropdownItem
            {
                ItemId = Guid.NewGuid(),
                ListKey = key,
                Label = label,
                SortOrder = maxSortOrder + 1,
                CreatedAt = DateTime.UtcNow,
            };

            context.DropdownItems.Add(entity);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), DROPDOWN_ITEM_CREATED, new { ListKey = key, entity.ItemId, entity.Label });

            return Ok(new { success = true, data = new { entity.ItemId, entity.Label } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error adding dropdown item to {Key}", key);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/dropdown-lists/{key}/items/{itemId}
    [HttpDelete("{key}/items/{itemId}")]
    public async Task<ActionResult<object>> DeleteItem(string key, Guid itemId)
    {
        try
        {
            if (!DropdownListKeys.IsValid(key))
                return NotFound(new { success = false, error = $"Unknown list '{key}'" });

            var forbidden = await RequireAdminPanelAccessAsync();
            if (forbidden != null) return forbidden;

            var entity = await context.DropdownItems.FirstOrDefaultAsync(i => i.ItemId == itemId && i.ListKey == key);
            if (entity == null)
                return NotFound(new { success = false, error = "Item not found" });

            context.DropdownItems.Remove(entity);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), DROPDOWN_ITEM_DELETED, new { ListKey = key, entity.ItemId, entity.Label });

            return Ok(new { success = true, message = "Item deleted" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting dropdown item {ItemId} from {Key}", itemId, key);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/dropdown-lists/{key}/import — .csv, .xlsx, or .xls; first column is the item name
    [HttpPost("{key}/import")]
    public async Task<ActionResult<object>> Import(string key, IFormFile file)
    {
        try
        {
            if (!DropdownListKeys.IsValid(key))
                return NotFound(new { success = false, error = $"Unknown list '{key}'" });

            var forbidden = await RequireAdminPanelAccessAsync();
            if (forbidden != null) return forbidden;

            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, error = "File is required" });

            List<string> rawLabels;
            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension == ".csv")
            {
                using var reader = new StreamReader(file.OpenReadStream());
                var text = await reader.ReadToEndAsync();
                rawLabels = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
                    .Select(line => line.Split(',').FirstOrDefault()?.Trim().Trim('"') ?? string.Empty)
                    .ToList();
            }
            else if (extension == ".xlsx" || extension == ".xls")
            {
                using var workbook = new XLWorkbook(file.OpenReadStream());
                var sheet = workbook.Worksheets.First();
                rawLabels = sheet.RowsUsed()
                    .Select(row => row.Cell(1).GetString().Trim())
                    .ToList();
            }
            else
            {
                return BadRequest(new { success = false, error = "Only .csv, .xlsx, or .xls files are supported" });
            }

            // Our own Export writes "Name" as the header — drop it on round-trip import
            // instead of adding it as a bogus item.
            var labels = rawLabels
                .Where(l => !string.IsNullOrWhiteSpace(l) && !l.Equals("Name", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var existing = await context.DropdownItems
                .Where(i => i.ListKey == key)
                .Select(i => i.Label)
                .ToListAsync();
            var existingSet = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);

            var maxSortOrder = await context.DropdownItems.Where(i => i.ListKey == key).MaxAsync(i => (int?)i.SortOrder) ?? 0;
            var toAdd = labels.Where(l => !existingSet.Contains(l)).ToList();
            var nextSortOrder = maxSortOrder + 1;
            foreach (var label in toAdd)
            {
                context.DropdownItems.Add(new DmsDropdownItem
                {
                    ItemId = Guid.NewGuid(),
                    ListKey = key,
                    Label = label,
                    SortOrder = nextSortOrder++,
                    CreatedAt = DateTime.UtcNow,
                });
            }

            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), DROPDOWN_ITEMS_IMPORTED, new { ListKey = key, AddedCount = toAdd.Count, SkippedCount = labels.Count - toAdd.Count });

            return Ok(new { success = true, data = new { added = toAdd.Count, skipped = labels.Count - toAdd.Count } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error importing dropdown items into {Key}", key);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/dropdown-lists/{key}/export — .xlsx, one "Name" column
    [HttpGet("{key}/export")]
    public async Task<IActionResult> Export(string key)
    {
        if (!DropdownListKeys.IsValid(key))
            return NotFound(new { success = false, error = $"Unknown list '{key}'" });

        var labels = await context.DropdownItems
            .Where(i => i.ListKey == key)
            .OrderBy(i => i.SortOrder).ThenBy(i => i.Label)
            .Select(i => i.Label)
            .ToListAsync();

        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add(key);
        sheet.Cell(1, 1).Value = "Name";
        for (var row = 0; row < labels.Count; row++)
            sheet.Cell(row + 2, 1).Value = labels[row];
        sheet.Column(1).AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        return File(stream.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{key}.xlsx");
    }

    private async Task<ActionResult<object>?> RequireAdminPanelAccessAsync()
    {
        var pageAccessRole = await GetPageAccessRoleAsync(context, GetCurrentUserId());
        if (pageAccessRole?.CanViewAdminPanel != true)
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You don't have permission to manage company data" });
        return null;
    }
}

public record AddDropdownItemRequest(string Label);
