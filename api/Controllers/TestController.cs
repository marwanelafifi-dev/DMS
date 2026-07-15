using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TestController : ControllerBase
{
    [HttpGet]
    public ActionResult<object> Get()
    {
        return Ok(new
        {
            message = "API is running",
            timestamp = DateTime.UtcNow,
            phase = "Phase 1"
        });
    }
}
