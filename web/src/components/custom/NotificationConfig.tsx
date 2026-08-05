import { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Mail, Globe, Save, Send, Settings as SettingsIcon } from 'lucide-react';
import { Card, CardBody, Button } from '../ui';
import { apiClient, type EmailNotificationConfig, type EmailNotificationMethod } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

const METHODS: {
  key: EmailNotificationMethod;
  title: string;
  icon: typeof Mail;
  badges: { label: string; color: string }[];
  description: string;
}[] = [
  {
    key: 'gmail_app_password',
    title: 'Gmail App Password',
    icon: Mail,
    badges: [
      { label: 'Recommended', color: 'bg-[#e8f0f8] text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300' },
      { label: 'Personal Gmail', color: 'bg-[#eef2f7] text-[#52627a] dark:bg-slate-800 dark:text-slate-300' },
      { label: 'Easy', color: 'bg-[#e6f4ea] text-[#2f7a4a] dark:bg-green-900/30 dark:text-green-300' },
    ],
    description: 'Use a personal Gmail account with a 16-character App Password. Simple to set up, no admin access needed.',
  },
  {
    key: 'google_workspace_smtp_relay',
    title: 'Google Workspace SMTP Relay',
    icon: Globe,
    badges: [
      { label: 'Google Admin', color: 'bg-[#f3ecfb] text-[#7c4fb0] dark:bg-purple-900/30 dark:text-purple-300' },
      { label: 'Medium', color: 'bg-[#fff1c9] text-[#b96a08] dark:bg-amber-900/30 dark:text-amber-300' },
    ],
    description: 'Use smtp-relay.gmail.com with your Workspace account. Requires a one-time setup in Google Admin Console.',
  },
];

const GUIDES: Record<EmailNotificationMethod, { title: string; steps: string[] }> = {
  gmail_app_password: {
    title: 'Setup Guide — Gmail App Password',
    steps: [
      'Open myaccount.google.com/apppasswords (the Gmail account must have 2-Step Verification turned on).',
      'Sign in with the personal Gmail account you want notifications to be sent from.',
      'Create a new App Password — name it "Si-Ware DMS" so it\'s easy to recognize later.',
      'Copy the 16-character password Google generates (spaces don\'t matter).',
      'Paste it into the App Password field below — not your real Gmail login password, Gmail SMTP rejects that.',
      'Save Configuration, then use Send Test Email to confirm it works.',
    ],
  },
  google_workspace_smtp_relay: {
    title: 'Setup Guide — Google Workspace SMTP Relay',
    steps: [
      'Open Google Admin Console at admin.google.com.',
      'Go to Apps → Google Workspace → Gmail → Routing.',
      "Scroll to 'SMTP relay service' → click Configure.",
      'Add a rule: Allow only registered Workspace users, require TLS.',
      'Save the rule — relay is now enabled for si-ware.com.',
      'Use smtp-relay.gmail.com on port 587 with your Workspace account + an App Password below.',
    ],
  },
};

const EMPTY_CONFIG: EmailNotificationConfig = { method: 'gmail_app_password', email: '', appPassword: '', senderName: 'Si-Ware DMS' };

export function NotificationConfig() {
  const { showSuccess, showError } = useToast();
  const [config, setConfig] = useState<EmailNotificationConfig>(EMPTY_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    apiClient.getEmailConfig()
      .then((res) => { if (res.success && res.data) setConfig({ ...EMPTY_CONFIG, ...res.data }); })
      .catch(() => showError('Failed to load notification configuration'))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = METHODS.find((m) => m.key === config.method) ?? METHODS[0];
  const guide = GUIDES[config.method];
  const emailLabel = config.method === 'google_workspace_smtp_relay' ? 'Workspace Email' : 'Gmail Email';

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await apiClient.updateEmailConfig(config);
      if (!res.success) { showError(res.error || 'Failed to save configuration'); return; }
      showSuccess('Notification configuration saved');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const res = await apiClient.sendTestEmail(config);
      if (!res.success) { showError(res.error || 'Failed to send test email'); return; }
      showSuccess(res.message || 'Test email sent');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to send test email');
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return <Card><CardBody className="p-8 text-center text-sm text-[#718198]">Loading…</CardBody></Card>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-serif font-bold text-[#122344] dark:text-white">Notification Configuration</h2>
        <p className="mt-1 text-sm text-[#718198]">Configure how email notifications are sent from the Admin Portal</p>
      </div>

      <div className="flex gap-3 rounded-[6px] border border-[#f4dd9a] bg-[#fff8e6] p-4 dark:border-amber-900 dark:bg-amber-900/15">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#b96a08] dark:text-amber-400" />
        <div className="text-sm text-[#8a6116] dark:text-amber-200">
          <p className="font-semibold">Corporate Network Note</p>
          <p className="mt-1">SMTP ports 465/587 may be blocked by some corporate firewalls (deep packet inspection). If Send Test Email fails, check with IT whether outbound SMTP on port 587 is allowed.</p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
          <SettingsIcon className="h-4 w-4 text-[#52627a] dark:text-slate-300" />
          <h3 className="section-heading">Select Sending Method</h3>
        </div>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {METHODS.map((method) => {
            const Icon = method.icon;
            const isSelected = config.method === method.key;
            return (
              <button
                key={method.key}
                onClick={() => setConfig({ ...config, method: method.key })}
                className={`rounded-[6px] border p-4 text-left transition-colors ${
                  isSelected
                    ? 'border-[#3f8bca] bg-[#eef4fb] dark:border-blue-500 dark:bg-blue-500/10'
                    : 'border-[#e2e8f0] hover:bg-[#f8fafc] dark:border-white/10 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded bg-[#eef2f7] p-2 dark:bg-slate-800"><Icon className="h-4 w-4 text-[#52627a] dark:text-slate-300" /></div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[#26334d] dark:text-white">{method.title}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {method.badges.map((b) => (
                        <span key={b.label} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${b.color}`}>{b.label}</span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-[#718198] dark:text-slate-400">{method.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
          <h3 className="section-heading flex items-center gap-2"><selected.icon className="h-4 w-4" />{selected.title} — Configuration</h3>
        </div>
        <CardBody className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">{emailLabel}</label>
            <input
              type="email"
              value={config.email ?? ''}
              onChange={(e) => setConfig({ ...config, email: e.target.value })}
              placeholder="you@si-ware.com"
              className="field-control h-10 w-full"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">App Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={config.appPassword ?? ''}
                onChange={(e) => setConfig({ ...config, appPassword: e.target.value })}
                placeholder="16-character App Password"
                className="field-control h-10 w-full pr-10"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8]">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-[#94a3b8]">App Password for this {config.method === 'google_workspace_smtp_relay' ? 'Workspace' : 'Gmail'} account</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Sender Name</label>
            <input
              type="text"
              value={config.senderName ?? ''}
              onChange={(e) => setConfig({ ...config, senderName: e.target.value })}
              placeholder="Si-Ware DMS"
              className="field-control h-10 w-full"
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" onClick={handleSave} disabled={isSaving} leftIcon={<Save className="h-4 w-4" />}>
              {isSaving ? 'Saving…' : 'Save Configuration'}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={isTesting} leftIcon={<Send className="h-4 w-4" />}>
              {isTesting ? 'Sending…' : 'Send Test Email'}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
          <h3 className="section-heading">{guide.title}</h3>
        </div>
        <CardBody>
          <ol className="space-y-3">
            {guide.steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-sm text-[#52627a] dark:text-slate-300">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#eef4fb] text-xs font-semibold text-[#3f8bca] dark:bg-blue-500/15 dark:text-blue-300">{index + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
