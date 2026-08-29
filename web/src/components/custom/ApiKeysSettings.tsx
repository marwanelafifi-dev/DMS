import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, PlugZap, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, type AiChatProviderSettings, type AiProviderConfig } from '../../utils/api';
import { Button } from '../ui';

type ProviderName = AiProviderConfig['provider'];
type DraftProvider = AiProviderConfig & { newKey: string; clearApiKey: boolean; showKey: boolean };

const labels: Record<ProviderName, { name: string; description: string }> = {
  'openai-compatible': { name: 'OpenAI-compatible', description: 'Chat Completions API and compatible gateways' },
  anthropic: { name: 'Anthropic Claude', description: 'Native Claude Messages API' },
};

export function ApiKeysSettings() {
  const [settings, setSettings] = useState<AiChatProviderSettings | null>(null);
  const [primaryProvider, setPrimaryProvider] = useState<ProviderName>('openai-compatible');
  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<ProviderName | null>(null);

  const apply = (value: AiChatProviderSettings) => {
    setSettings(value);
    setPrimaryProvider(value.primaryProvider);
    setProviders(value.providers.map((provider) => ({ ...provider, newKey: '', clearApiKey: false, showKey: false })));
  };

  useEffect(() => {
    apiClient.getAiApiKeySettings()
      .then((response) => { if (response.data) apply(response.data); })
      .catch((error) => toast.error(error?.response?.data?.error || 'Could not load API key settings'))
      .finally(() => setLoading(false));
  }, []);

  const updateProvider = (name: ProviderName, update: Partial<DraftProvider>) => {
    setProviders((current) => current.map((provider) => provider.provider === name ? { ...provider, ...update } : provider));
  };

  const toggleEnabled = (name: ProviderName, enabled: boolean) => {
    updateProvider(name, { enabled });
    if (!enabled && primaryProvider === name) {
      const alternative = providers.find((provider) => provider.provider !== name && provider.enabled);
      if (alternative) setPrimaryProvider(alternative.provider);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!providers.some((provider) => provider.enabled)) return toast.error('Enable at least one provider');
    if (!providers.find((provider) => provider.provider === primaryProvider)?.enabled) return toast.error('The primary provider must be enabled');
    setSaving(true);
    try {
      const response = await apiClient.updateAiApiKeySettings({
        primaryProvider,
        providers: providers.map((provider) => ({
          provider: provider.provider, endpoint: provider.endpoint, model: provider.model, enabled: provider.enabled,
          ...(provider.newKey ? { apiKey: provider.newKey } : {}), ...(provider.clearApiKey ? { clearApiKey: true } : {}),
        })),
      });
      if (response.data) apply(response.data);
      toast.success('AI provider settings saved');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not save API provider settings');
    } finally {
      setSaving(false);
    }
  };

  const test = async (provider: ProviderName) => {
    setTesting(provider);
    try {
      await apiClient.testAiApiKey(provider);
      toast.success(`${labels[provider].name} connection successful`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Connection test failed');
    } finally {
      setTesting(null);
    }
  };

  const removeKey = (provider: ProviderName) => {
    if (!window.confirm(`Remove the saved ${labels[provider].name} API key? Save settings to confirm the change.`)) return;
    updateProvider(provider, { newKey: '', clearApiKey: true, isConfigured: false });
  };

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#3f8bca]" /></div>;

  return (
    <div className="space-y-5">
      <div><h1 className="page-heading">API Keys</h1><p className="page-subtitle">Configure both AI providers and choose the preferred response order.</p></div>
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
        <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><p>Keys are encrypted and never returned to the browser. When both providers are enabled, the chatbot tries the primary provider first and automatically falls back to the other provider if necessary.</p></div>
      </div>

      <form onSubmit={save} className="space-y-4">
        {providers.map((provider) => {
          const meta = labels[provider.provider];
          const isPrimary = primaryProvider === provider.provider;
          return (
            <section key={provider.provider} className={`overflow-hidden rounded-lg border bg-white dark:bg-slate-900 ${isPrimary ? 'border-[#3f8bca] ring-1 ring-[#3f8bca]/20' : 'border-[#dbe2ec] dark:border-white/10'}`}>
              <header className="flex flex-wrap items-center gap-3 border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e8f0f8] text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300"><KeyRound className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1"><h2 className="section-heading">{meta.name}</h2><p className="text-xs text-[#718198]">{meta.description}</p></div>
                <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={provider.enabled} onChange={(event) => toggleEnabled(provider.provider, event.target.checked)} className="h-4 w-4 accent-[#3f8bca]" />Enabled</label>
                <label className={`flex items-center gap-2 text-sm ${provider.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}><input type="radio" name="primary-provider" checked={isPrimary} disabled={!provider.enabled} onChange={() => setPrimaryProvider(provider.provider)} className="h-4 w-4 accent-[#3f8bca]" />Primary</label>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${provider.isConfigured && !provider.clearApiKey ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>{provider.isConfigured && !provider.clearApiKey && <CheckCircle2 className="h-3.5 w-3.5" />}{provider.isConfigured && !provider.clearApiKey ? 'Key configured' : 'No saved key'}</span>
              </header>

              <div className="grid gap-5 p-5 lg:grid-cols-2">
                <label className="block lg:col-span-2"><span className="mb-1.5 block text-sm font-medium">API endpoint</span><input required type="url" value={provider.endpoint} onChange={(event) => updateProvider(provider.provider, { endpoint: event.target.value })} className="h-11 w-full rounded-md border border-[#cbd5e3] bg-white px-3 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="block"><span className="mb-1.5 block text-sm font-medium">Model</span><input required value={provider.model} onChange={(event) => updateProvider(provider.provider, { model: event.target.value })} className="h-11 w-full rounded-md border border-[#cbd5e3] bg-white px-3 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950" /></label>
                <label className="block"><span className="mb-1.5 block text-sm font-medium">API key</span><div className="relative"><input type={provider.showKey ? 'text' : 'password'} value={provider.newKey} onChange={(event) => updateProvider(provider.provider, { newKey: event.target.value, clearApiKey: false })} autoComplete="new-password" className="h-11 w-full rounded-md border border-[#cbd5e3] bg-white px-3 pr-11 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950" placeholder={provider.isConfigured && !provider.clearApiKey ? 'Leave blank to keep saved key' : `Enter ${meta.name} API key`} /><button type="button" onClick={() => updateProvider(provider.provider, { showKey: !provider.showKey })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={provider.showKey ? 'Hide API key' : 'Show API key'}>{provider.showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
              </div>
              <footer className="flex flex-wrap justify-end gap-2 border-t border-[#e2e8f0] bg-slate-50 px-5 py-3 dark:border-white/10 dark:bg-slate-950/40">
                {provider.isConfigured && !provider.clearApiKey && <Button type="button" variant="danger" size="sm" onClick={() => removeKey(provider.provider)}><Trash2 className="h-4 w-4" />Remove key</Button>}
                <Button type="button" variant="secondary" size="sm" onClick={() => test(provider.provider)} disabled={testing !== null || !provider.isConfigured || provider.clearApiKey}>{testing === provider.provider ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}Test saved connection</Button>
              </footer>
            </section>
          );
        })}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900">
          <p className="text-sm text-[#718198]">Primary: <strong className="text-[#26334d] dark:text-white">{labels[primaryProvider].name}</strong>{providers.filter((provider) => provider.enabled).length === 2 ? ' • Automatic fallback enabled' : ''}</p>
          <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save all providers</Button>
        </div>
      </form>
      {settings?.updatedAt && <p className="text-xs text-[#718198]">Last updated {new Date(settings.updatedAt).toLocaleString()}</p>}
    </div>
  );
}
