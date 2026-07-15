using DMS.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class DatabaseTestController(DmsContext context) : ControllerBase
{
    [HttpGet("check")]
    public async Task<ActionResult<object>> CheckDatabase()
    {
        try
        {
            // Try to ping the database
            var canConnect = await context.Database.CanConnectAsync();
            return Ok(new
            {
                message = "Database check completed",
                canConnect,
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new
            {
                error = ex.Message,
                innerError = ex.InnerException?.Message
            });
        }
    }

    [HttpGet("schema")]
    public async Task<ActionResult<object>> CheckSchema()
    {
        try
        {
            // Try to count users in the database
            var count = await context.Users.CountAsync();
            return Ok(new
            {
                message = "Schema check successful",
                userCount = count,
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new
            {
                error = ex.Message,
                innerError = ex.InnerException?.Message
            });
        }
    }
}
