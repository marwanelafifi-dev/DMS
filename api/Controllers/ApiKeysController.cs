using System.Net.Http.Headers;
using System.Net.Http.Json;
using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/api-keys")]
public class ApiKeysController(DmsContext context, AiChatSettingsService settingsService, IHttpClientFactory httpClientFactory, AuditService auditService) : BaseController
{
    private async Task<bool> IsAdminAsync() => (await GetPageAccessRoleAsync(context, GetCurrentUserId()))?.BypassFolderPermissions == true;

    [HttpGet]
    public async Task<ActionResult<object>> GetSettings()
    {
        if (!await IsAdminAsync()) return Forbidden();
        var settings = await settingsService.LoadAsync();
        return Ok(new { success = true, data = Public(settings) });
    }

    [HttpPut]
    public async Task<ActionResult<object>> Update([FromBody] UpdateAiChatSettingsRequest request)
    {
        if (!await IsAdminAsync()) return Forbidden();
        var provider = request.Provider?.Trim().ToLowerInvariant();
        if (provider is not ("openai-compatible" or "anthropic"))
            return BadRequest(new { success = false, error = "Provider must be OpenAI-compatible or Anthropic Claude." });
        if (!Uri.TryCreate(request.Endpoint?.Trim(), UriKind.Absolute, out var endpoint) || endpoint.Scheme != Uri.UriSchemeHttps)
            return BadRequest(new { success = false, error = "The provider endpoint must be a valid HTTPS URL." });
        if (string.IsNullOrWhiteSpace(request.Model) || request.Model.Length > 100)
            return BadRequest(new { success = false, error = "A valid model name is required." });
        if (request.ApiKey?.Length > 500)
            return BadRequest(new { success = false, error = "The API key is too long." });

        var saved = await settingsService.SaveAsync(provider, endpoint.ToString(), request.Model, request.ApiKey, request.ClearApiKey, GetCurrentUserId());
        await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new { Group = "api_keys", saved.Provider, saved.Endpoint, saved.Model, saved.IsConfigured });
        return Ok(new { success = true, data = Public(saved) });
    }

    [HttpPost("test")]
    public async Task<ActionResult<object>> Test(CancellationToken cancellationToken)
    {
        if (!await IsAdminAsync()) return Forbidden();
        var settings = await settingsService.LoadAsync();
        if (!settings.IsConfigured || string.IsNullOrWhiteSpace(settings.ApiKey))
            return BadRequest(new { success = false, error = "Save an API key before testing the connection." });
        try
        {
            var client = httpClientFactory.CreateClient("AiChat");
            object payload;
            if (settings.Provider == "anthropic")
            {
                client.DefaultRequestHeaders.Add("x-api-key", settings.ApiKey);
                client.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
                payload = new { model = settings.Model, max_tokens = 5, temperature = 0, messages = new[] { new { role = "user", content = "Reply OK" } } };
            }
            else
            {
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);
                payload = new { model = settings.Model, temperature = 0, max_tokens = 5, messages = new[] { new { role = "user", content = "Reply OK" } } };
            }
            using var response = await client.PostAsJsonAsync(settings.Endpoint, payload, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return BadRequest(new { success = false, error = $"Provider returned HTTP {(int)response.StatusCode}. Check the endpoint, model, and key." });
            return Ok(new { success = true, data = new { connected = true }, message = "Connection successful." });
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return BadRequest(new { success = false, error = "The provider could not be reached. Check the endpoint and network access." });
        }
    }

    private ObjectResult Forbidden() => StatusCode(403, new { success = false, error = "Only a Full Access role can manage API keys." });
    private static object Public(AiChatProviderSettings settings) => new
    {
        settings.Provider,
        settings.Endpoint,
        settings.Model,
        settings.IsConfigured,
        maskedKey = settings.IsConfigured ? "••••••••••••" : null,
        settings.UpdatedAt,
    };
}

public record UpdateAiChatSettingsRequest(string Provider, string Endpoint, string Model, string? ApiKey = null, bool ClearApiKey = false);
