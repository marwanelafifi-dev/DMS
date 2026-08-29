using System.Text.Json;
using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public sealed record AiProviderConfig(string Provider, string Endpoint, string Model, string? ApiKey, bool Enabled, bool IsConfigured);
public sealed record AiChatProviderSettings(string PrimaryProvider, IReadOnlyList<AiProviderConfig> Providers, DateTime? UpdatedAt = null);
public record AiProviderUpdate(string Provider, string Endpoint, string Model, bool Enabled, string? ApiKey = null, bool ClearApiKey = false);

public class AiChatSettingsService(DmsContext context, IConfiguration configuration, IDataProtectionProvider dataProtectionProvider)
{
    public const string SettingKey = "ai_chat_provider_config";
    public const string OpenAiProvider = "openai-compatible";
    public const string AnthropicProvider = "anthropic";
    private readonly IDataProtector protector = dataProtectionProvider.CreateProtector("DMS.AiChat.ApiKey.v1");

    public async Task<AiChatProviderSettings> LoadAsync()
    {
        var setting = await context.AppSettings.AsNoTracking().FirstOrDefaultAsync(item => item.Key == SettingKey);
        if (setting != null)
        {
            try
            {
                var saved = JsonSerializer.Deserialize<StoredAiChatSettings>(setting.Value);
                if (saved?.Providers?.Count > 0)
                {
                    var providers = saved.Providers.Select(ToRuntime).ToList();
                    EnsureBothProviders(providers);
                    var primary = NormalizeProvider(saved.PrimaryProvider);
                    if (primary == null || providers.All(item => item.Provider != primary || !item.Enabled))
                        primary = providers.First(item => item.Enabled).Provider;
                    return new(primary, providers, setting.UpdatedAt);
                }

                // Backward compatibility with the original one-provider JSON.
                if (!string.IsNullOrWhiteSpace(saved?.Endpoint))
                {
                    var legacyProvider = NormalizeProvider(saved.Provider) ?? OpenAiProvider;
                    var legacy = ToRuntime(new StoredProvider
                    {
                        Provider = legacyProvider, Endpoint = saved.Endpoint, Model = saved.Model,
                        ProtectedApiKey = saved.ProtectedApiKey, Enabled = true,
                    });
                    var providers = new List<AiProviderConfig> { legacy };
                    EnsureBothProviders(providers);
                    return new(legacyProvider, providers, setting.UpdatedAt);
                }
            }
            catch (Exception exception) when (exception is JsonException or System.Security.Cryptography.CryptographicException)
            {
                // Fail closed if the encrypted payload or key ring is invalid.
            }
        }

        var environmentProvider = NormalizeProvider(configuration["AiChat:Provider"]) ?? OpenAiProvider;
        var environmentKey = configuration["AiChat:ApiKey"];
        var defaults = DefaultProviders().ToList();
        var selected = defaults.FindIndex(item => item.Provider == environmentProvider);
        defaults[selected] = defaults[selected] with
        {
            Endpoint = configuration["AiChat:Endpoint"] ?? defaults[selected].Endpoint,
            Model = configuration["AiChat:Model"] ?? defaults[selected].Model,
            ApiKey = environmentKey, Enabled = true, IsConfigured = !string.IsNullOrWhiteSpace(environmentKey),
        };
        return new(environmentProvider, defaults);
    }

    public async Task<AiChatProviderSettings> SaveAsync(string primaryProvider, IEnumerable<AiProviderUpdate> updates, Guid userId)
    {
        var normalizedPrimary = NormalizeProvider(primaryProvider) ?? throw new ArgumentException("Invalid primary provider");
        var current = await LoadAsync();
        var updateMap = updates.ToDictionary(item => NormalizeProvider(item.Provider) ?? throw new ArgumentException("Invalid provider"));
        var storedProviders = new List<StoredProvider>();

        foreach (var existing in current.Providers)
        {
            if (!updateMap.TryGetValue(existing.Provider, out var update))
                throw new ArgumentException($"Missing configuration for {existing.Provider}");
            var apiKey = update.ClearApiKey ? null : string.IsNullOrWhiteSpace(update.ApiKey) ? existing.ApiKey : update.ApiKey.Trim();
            storedProviders.Add(new StoredProvider
            {
                Provider = existing.Provider, Endpoint = update.Endpoint.Trim(), Model = update.Model.Trim(), Enabled = update.Enabled,
                ProtectedApiKey = string.IsNullOrWhiteSpace(apiKey) ? null : protector.Protect(apiKey),
            });
        }

        if (!storedProviders.Any(item => item.Enabled)) throw new ArgumentException("Enable at least one AI provider");
        if (!storedProviders.Any(item => item.Provider == normalizedPrimary && item.Enabled)) throw new ArgumentException("The primary provider must be enabled");

        var payload = new StoredAiChatSettings { PrimaryProvider = normalizedPrimary, Providers = storedProviders };
        var setting = await context.AppSettings.FirstOrDefaultAsync(item => item.Key == SettingKey);
        if (setting == null) { setting = new DmsAppSetting { Key = SettingKey }; context.AppSettings.Add(setting); }
        setting.Value = JsonSerializer.Serialize(payload);
        setting.UpdatedAt = DateTime.UtcNow;
        setting.UpdatedById = userId;
        await context.SaveChangesAsync();
        return new(normalizedPrimary, storedProviders.Select(ToRuntime).ToList(), setting.UpdatedAt);
    }

    public IEnumerable<AiProviderConfig> GetEnabledInPriorityOrder(AiChatProviderSettings settings) =>
        settings.Providers.Where(item => item.Enabled && item.IsConfigured).OrderBy(item => item.Provider == settings.PrimaryProvider ? 0 : 1);

    private AiProviderConfig ToRuntime(StoredProvider saved)
    {
        string? key = null;
        if (!string.IsNullOrWhiteSpace(saved.ProtectedApiKey)) key = protector.Unprotect(saved.ProtectedApiKey);
        var provider = NormalizeProvider(saved.Provider) ?? OpenAiProvider;
        var defaults = DefaultProviders().First(item => item.Provider == provider);
        return new(provider, saved.Endpoint ?? defaults.Endpoint, saved.Model ?? defaults.Model, key, saved.Enabled, !string.IsNullOrWhiteSpace(key));
    }

    private static IEnumerable<AiProviderConfig> DefaultProviders()
    {
        yield return new(OpenAiProvider, "https://api.openai.com/v1/chat/completions", "gpt-4.1-mini", null, true, false);
        yield return new(AnthropicProvider, "https://api.anthropic.com/v1/messages", "claude-sonnet-5", null, false, false);
    }

    private static void EnsureBothProviders(List<AiProviderConfig> providers)
    {
        foreach (var missing in DefaultProviders().Where(item => providers.All(saved => saved.Provider != item.Provider))) providers.Add(missing);
        if (!providers.Any(item => item.Enabled)) providers[0] = providers[0] with { Enabled = true };
    }

    public static string? NormalizeProvider(string? provider) => provider?.Trim().ToLowerInvariant() switch
    {
        OpenAiProvider => OpenAiProvider, AnthropicProvider => AnthropicProvider, _ => null,
    };

    private sealed class StoredAiChatSettings
    {
        public string? PrimaryProvider { get; set; }
        public List<StoredProvider>? Providers { get; set; }
        public string? Provider { get; set; }
        public string? Endpoint { get; set; }
        public string? Model { get; set; }
        public string? ProtectedApiKey { get; set; }
    }
    private sealed class StoredProvider
    {
        public string? Provider { get; set; }
        public string? Endpoint { get; set; }
        public string? Model { get; set; }
        public string? ProtectedApiKey { get; set; }
        public bool Enabled { get; set; }
    }
}
