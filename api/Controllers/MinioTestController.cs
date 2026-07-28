using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MinioTestController(MinioService minioService, ILogger<MinioTestController> logger) : ControllerBase
{
    [HttpGet("health")]
    public async Task<ActionResult<object>> CheckHealth()
    {
        try
        {
            await minioService.EnsureBucketExistsAsync();
            return Ok(new
            {
                message = "MinIO connection healthy",
                status = "Connected",
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "MinIO health check failed");
            return BadRequest(new
            {
                error = "MinIO connection failed",
                message = ex.Message
            });
        }
    }

    [HttpPost("upload")]
    public async Task<ActionResult<object>> Upload(IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return BadRequest("No file provided");

            var objectKey = $"test/{Guid.NewGuid()}_{file.FileName}";

            using var stream = file.OpenReadStream();
            await minioService.UploadAsync(objectKey, stream, file.ContentType);

            return Ok(new
            {
                message = "File uploaded successfully",
                objectKey = objectKey,
                fileName = file.FileName,
                fileSize = file.Length,
                contentType = file.ContentType,
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "File upload failed");
            return BadRequest(new
            {
                error = "Upload failed",
                message = ex.Message
            });
        }
    }

    [HttpGet("list")]
    public async Task<ActionResult<object>> List([FromQuery] string prefix = "")
    {
        try
        {
            var objects = await minioService.ListAsync(prefix);
            return Ok(new
            {
                message = $"Listed {objects.Count} objects",
                prefix = prefix,
                objects = objects,
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "List objects failed");
            return BadRequest(new
            {
                error = "List failed",
                message = ex.Message
            });
        }
    }

    [HttpGet("download/{objectKey}")]
    public async Task<ActionResult> Download(string objectKey)
    {
        try
        {
            if (string.IsNullOrEmpty(objectKey))
                return BadRequest("Object key is required");

            var stream = await minioService.DownloadAsync(objectKey);
            return File(stream, "application/octet-stream", objectKey.Split('/').Last());
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "File download failed");
            return BadRequest(new
            {
                error = "Download failed",
                message = ex.Message
            });
        }
    }

    [HttpDelete("delete/{objectKey}")]
    public async Task<ActionResult<object>> Delete(string objectKey)
    {
        try
        {
            if (string.IsNullOrEmpty(objectKey))
                return BadRequest("Object key is required");

            await minioService.DeleteAsync(objectKey);
            return Ok(new
            {
                message = "File deleted successfully",
                objectKey = objectKey,
                timestamp = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "File deletion failed");
            return BadRequest(new
            {
                error = "Delete failed",
                message = ex.Message
            });
        }
    }
}
