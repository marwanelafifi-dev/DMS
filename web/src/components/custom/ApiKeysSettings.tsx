import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, PlugZap, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, type AiChatProviderSettings } from '../../utils/api';
import { Button } from '../ui';

export function ApiKeysSettings() {
  const [settings, setSettings] = useState<AiChatProviderSettings | null>(null);
  const [provider, setProvider] = useState<'openai-compatible' | 'anthropic'>('openai-compatible');
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const apply = (value: AiChatProviderSettings) => {
    setSettings(value);
    setProvider(value.provider);
    setEndpoint(value.endpoint);
    setModel(value.model);
    setApiKey('');
  };

  useEffect(() => {
    apiClient.getAiApiKeySettings()
      .then((response) => { if (response.data) apply(response.data); })
      .catch((error) => toast.error(error?.response?.data?.error || 'Could not load API key settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await apiClient.updateAiApiKeySettings({ provider, endpoint, model, ...(apiKey ? { apiKey } : {}) });
      if (response.data) apply(response.data);
      toast.success('AI provider settings saved');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not save API key settings');
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    if (!window.confirm('Remove the saved AI API key? The chatbot will use search-only fallback answers.')) return;
    setSaving(true);
    try {
      const response = await apiClient.updateAiApiKeySettings({ provider, endpoint, model, clearApiKey: true });
      if (response.data) apply(response.data);
      toast.success('API key removed');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Could not remove the API key');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await apiClient.testAiApiKey();
      toast.success('AI provider connection successful');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#3f8bca]" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">API Keys</h1>
        <p className="page-subtitle">Manage the server-side AI provider used for permission-safe chatbot answers.</p>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
        <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><p>The saved key is encrypted and is never returned to the browser. Entering a blank key keeps the currently saved value.</p></div>
      </div>

      <form onSubmit={save} className="overflow-hidden rounded-lg border border-[#dbe2ec] bg-white dark:border-white/10 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e8f0f8] text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300"><KeyRound className="h-5 w-5" /></span>
            <div><h2 className="section-heading">AI Chat Provider</h2><p className="text-xs text-[#718198]">OpenAI-compatible Chat Completions or Anthropic Claude Messages API</p></div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${settings?.isConfigured ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
            {settings?.isConfigured && <CheckCircle2 className="h-3.5 w-3.5" />}{settings?.isConfigured ? 'Key configured' : 'Search-only mode'}
          </span>
        </div>

        <div className="space-y-5 p-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Provider</span>
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value as 'openai-compatible' | 'anthropic';
                setProvider(next);
                setApiKey('');
                if (next === 'anthropic') {
                  setEndpoint('https://api.anthropic.com/v1/messages');
                  setModel('claude-sonnet-5');
                } else {
                  setEndpoint('https://api.openai.com/v1/chat/completions');
                  setModel('gpt-4.1-mini');
                }
              }}
              className="h-11 w-full rounded-md border border-[#cbd5e3] bg-white px-3 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic Claude</option>
            </select>
          </label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium">API endpoint</span><input required type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} className="h-11 w-full rounded-md border border-[#cbd5e3] bg-white px-3 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950" placeholder="https://api.openai.com/v1/chat/completions" /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium">Model</span><input required value={model} onChange={(event) => setModel(event.target.value)} className="h-11 w-full rounded-md border border-[#cbd5e3] bg-white px-3 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950" placeholder="gpt-4.1-mini" /></label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">API key</span>
            <div className="relative">
              <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" className="h-11 w-full rounded-md border border-[#cbd5e3] bg-white px-3 pr-11 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950" placeholder={settings?.isConfigured ? 'Leave blank to keep the saved key' : provider === 'anthropic' ? 'Enter an Anthropic API key' : 'Enter an API key'} />
              <button type="button" onClick={() => setShowKey((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={showKey ? 'Hide API key' : 'Show API key'}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </div>
            {settings?.updatedAt && <span className="mt-1.5 block text-xs text-[#718198]">Last updated {new Date(settings.updatedAt).toLocaleString()}</span>}
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] bg-slate-50 px-5 py-4 dark:border-white/10 dark:bg-slate-950/40">
          <div>{settings?.isConfigured && <Button type="button" variant="danger" onClick={clearKey} disabled={saving}><Trash2 className="mr-2 h-4 w-4" />Remove key</Button>}</div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={test} disabled={testing || !settings?.isConfigured}>{testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}Test connection</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save settings</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
