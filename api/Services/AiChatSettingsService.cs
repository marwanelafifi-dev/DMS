using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public sealed record AiChatProviderSettings(string Provider, string Endpoint, string Model, string? ApiKey, bool IsConfigured, DateTime? UpdatedAt = null);

public class AiChatSettingsService(DmsContext context, IConfiguration configuration, IDataProtectionProvider dataProtectionProvider)
{
    public const string SettingKey = "ai_chat_provider_config";
    private readonly IDataProtector protector = dataProtectionProvider.CreateProtector("DMS.AiChat.ApiKey.v1");

    public async Task<AiChatProviderSettings> LoadAsync()
    {
        var setting = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(item => item.Key == SettingKey);
        if (setting != null)
        {
            try
            {
                var saved = JsonSerializer.Deserialize<StoredAiChatSettings>(setting.Value);
                var key = string.IsNullOrWhiteSpace(saved?.ProtectedApiKey) ? null : protector.Unprotect(saved.ProtectedApiKey);
                return new(saved?.Provider ?? "openai-compatible", saved?.Endpoint ?? DefaultEndpoint(), saved?.Model ?? DefaultModel(), key, !string.IsNullOrWhiteSpace(key), setting.UpdatedAt);
            }
            catch (Exception exception) when (exception is JsonException or System.Security.Cryptography.CryptographicException)
            {
                // A rotated/lost data-protection key must fail closed: never treat
                // unreadable ciphertext as a provider credential.
            }
        }

        var environmentKey = configuration["AiChat:ApiKey"];
        return new(configuration["AiChat:Provider"] ?? "openai-compatible", configuration["AiChat:Endpoint"] ?? DefaultEndpoint(), configuration["AiChat:Model"] ?? DefaultModel(), environmentKey, !string.IsNullOrWhiteSpace(environmentKey));
    }

    public async Task<AiChatProviderSettings> SaveAsync(string provider, string endpoint, string model, string? newApiKey, bool clearApiKey, Guid userId)
    {
        var current = await LoadAsync();
        var apiKey = clearApiKey
            ? null
            : string.IsNullOrWhiteSpace(newApiKey)
                ? string.Equals(current.Provider, provider, StringComparison.OrdinalIgnoreCase) ? current.ApiKey : null
                : newApiKey.Trim();
        var stored = new StoredAiChatSettings { Provider = provider, Endpoint = endpoint.Trim(), Model = model.Trim(), ProtectedApiKey = string.IsNullOrWhiteSpace(apiKey) ? null : protector.Protect(apiKey) };
        var setting = await context.AppSettings.FirstOrDefaultAsync(item => item.Key == SettingKey);
        if (setting == null)
        {
            setting = new DmsAppSetting { Key = SettingKey };
            context.AppSettings.Add(setting);
        }
        setting.Value = JsonSerializer.Serialize(stored);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = userId;
        await context.SaveChangesAsync();
        return new(stored.Provider, stored.Endpoint, stored.Model, apiKey, !string.IsNullOrWhiteSpace(apiKey), setting.UpdatedAt);
    }

    private string DefaultEndpoint() => configuration["AiChat:Endpoint"] ?? "https://api.openai.com/v1/chat/completions";
    private string DefaultModel() => configuration["AiChat:Model"] ?? "gpt-4.1-mini";
    private sealed class StoredAiChatSettings
    {
        public string? Provider { get; set; }
        public string? Endpoint { get; set; }
        public string? Model { get; set; }
        public string? ProtectedApiKey { get; set; }
    }
}
