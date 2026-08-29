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
        return Ok(new { success = true, data = Public(await settingsService.LoadAsync()) });
    }

    [HttpPut]
    public async Task<ActionResult<object>> Update([FromBody] UpdateAiChatSettingsRequest request)
    {
        if (!await IsAdminAsync()) return Forbidden();
        if (request.Providers?.Count != 2) return BadRequest(new { success = false, error = "Both provider configurations are required." });
        foreach (var provider in request.Providers)
        {
            if (AiChatSettingsService.NormalizeProvider(provider.Provider) == null)
                return BadRequest(new { success = false, error = "Unsupported AI provider." });
            if (!Uri.TryCreate(provider.Endpoint?.Trim(), UriKind.Absolute, out var endpoint) || endpoint.Scheme != Uri.UriSchemeHttps)
                return BadRequest(new { success = false, error = $"The {provider.Provider} endpoint must be a valid HTTPS URL." });
            if (string.IsNullOrWhiteSpace(provider.Model) || provider.Model.Length > 100)
                return BadRequest(new { success = false, error = $"A valid model is required for {provider.Provider}." });
            if (provider.ApiKey?.Length > 500) return BadRequest(new { success = false, error = "An API key is too long." });
        }

        try
        {
            var saved = await settingsService.SaveAsync(request.PrimaryProvider, request.Providers, GetCurrentUserId());
            await auditService.LogAsync(GetCurrentUserId(), APP_SETTING_UPDATED, new
            {
                Group = "api_keys", saved.PrimaryProvider,
                Providers = saved.Providers.Select(item => new { item.Provider, item.Endpoint, item.Model, item.Enabled, item.IsConfigured }),
            });
            return Ok(new { success = true, data = Public(saved) });
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { success = false, error = exception.Message });
        }
    }

    [HttpPost("test")]
    public async Task<ActionResult<object>> Test([FromBody] TestAiProviderRequest request, CancellationToken cancellationToken)
    {
        if (!await IsAdminAsync()) return Forbidden();
        var providerName = AiChatSettingsService.NormalizeProvider(request.Provider);
        if (providerName == null) return BadRequest(new { success = false, error = "Unsupported AI provider." });
        var settings = await settingsService.LoadAsync();
        var provider = settings.Providers.First(item => item.Provider == providerName);
        if (!provider.IsConfigured || string.IsNullOrWhiteSpace(provider.ApiKey))
            return BadRequest(new { success = false, error = "Save this provider's API key before testing it." });

        try
        {
            var client = httpClientFactory.CreateClient("AiChat");
            object payload;
            if (provider.Provider == AiChatSettingsService.AnthropicProvider)
            {
                client.DefaultRequestHeaders.Add("x-api-key", provider.ApiKey);
                client.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");
                payload = new { model = provider.Model, max_tokens = 5, temperature = 0, messages = new[] { new { role = "user", content = "Reply OK" } } };
            }
            else
            {
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", provider.ApiKey);
                payload = new { model = provider.Model, temperature = 0, max_tokens = 5, messages = new[] { new { role = "user", content = "Reply OK" } } };
            }
            using var response = await client.PostAsJsonAsync(provider.Endpoint, payload, cancellationToken);
            if (!response.IsSuccessStatusCode)
                return BadRequest(new { success = false, error = $"Provider returned HTTP {(int)response.StatusCode}. Check its endpoint, model, and key." });
            return Ok(new { success = true, data = new { connected = true, provider = provider.Provider }, message = "Connection successful." });
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            return BadRequest(new { success = false, error = "The provider could not be reached. Check its endpoint and network access." });
        }
    }

    private ObjectResult Forbidden() => StatusCode(403, new { success = false, error = "Only a Full Access role can manage API keys." });
    private static object Public(AiChatProviderSettings settings) => new
    {
        settings.PrimaryProvider,
        Providers = settings.Providers.Select(item => new
        {
            item.Provider, item.Endpoint, item.Model, item.Enabled, item.IsConfigured,
            maskedKey = item.IsConfigured ? "••••••••••••" : null,
        }),
        settings.UpdatedAt,
    };
}

public record UpdateAiChatSettingsRequest(string PrimaryProvider, List<AiProviderUpdate> Providers);
public record TestAiProviderRequest(string Provider);
