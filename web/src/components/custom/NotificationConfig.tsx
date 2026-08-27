import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, BellOff, Eye, EyeOff, Mail, Globe, Save, Send, Settings as SettingsIcon } from 'lucide-react';
import { Card, CardBody, Button } from '../ui';
import { ModalOverlay } from '../ui/ModalOverlay';
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isUpdatingToggle, setIsUpdatingToggle] = useState(false);
  const [showDisableConfirmation, setShowDisableConfirmation] = useState(false);
  const [disableConfirmationText, setDisableConfirmationText] = useState('');

  useEffect(() => {
    Promise.all([apiClient.getEmailConfig(), apiClient.getNotificationsEnabled()])
      .then(([configRes, enabledRes]) => {
        if (configRes.success && configRes.data) setConfig({ ...EMPTY_CONFIG, ...configRes.data });
        if (enabledRes.success) setNotificationsEnabled(enabledRes.data?.enabled !== false);
      })
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

  const updateNotificationState = async (next: boolean) => {
    setIsUpdatingToggle(true);
    try {
      const res = await apiClient.updateNotificationsEnabled(next);
      if (!res.success) throw new Error(res.error || 'Failed to update notification status');
      setNotificationsEnabled(next);
      setShowDisableConfirmation(false);
      setDisableConfirmationText('');
      showSuccess(next ? 'Email and in-app notifications enabled' : 'Email and in-app notifications disabled');
    } catch (err: any) {
      showError(err.response?.data?.error || err.message || 'Failed to update notification status');
    } finally {
      setIsUpdatingToggle(false);
    }
  };

  const handleNotificationToggle = () => {
    if (notificationsEnabled) {
      setDisableConfirmationText('');
      setShowDisableConfirmation(true);
      return;
    }
    void updateNotificationState(true);
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

      <Card className={`overflow-hidden border-2 ${notificationsEnabled ? 'border-emerald-200 dark:border-emerald-900' : 'border-red-200 dark:border-red-900'}`}>
        <CardBody className="flex items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`rounded-full p-2 ${notificationsEnabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
              {notificationsEnabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="font-semibold text-[#26334d] dark:text-white">Email and In-App Notifications</h3>
              <p className="mt-1 text-sm text-[#718198] dark:text-slate-400">
                {notificationsEnabled
                  ? 'Enabled — workflow, task, reminder, announcement, and system notifications are being delivered.'
                  : 'Disabled — no new emails or in-app notifications will be sent. Business operations continue normally.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notificationsEnabled}
            aria-label="Enable email and in-app notifications"
            disabled={isUpdatingToggle}
            onClick={handleNotificationToggle}
            className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-60 ${notificationsEnabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </CardBody>
      </Card>

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

      {showDisableConfirmation && (
        <ModalOverlay
          onClose={() => { if (!isUpdatingToggle) setShowDisableConfirmation(false); }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="border-b border-gray-200 px-6 py-4 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-[#122344] dark:text-white">Disable all notifications?</h3>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="flex gap-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <p>No email or in-app notification will be sent while this setting is off. Workflow and business operations will continue normally.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">
                  Type <strong>Off</strong> to confirm
                </label>
                <input
                  autoFocus
                  value={disableConfirmationText}
                  onChange={(e) => setDisableConfirmationText(e.target.value)}
                  className="field-control h-10 w-full"
                  placeholder="Off"
                />
              </div>
            </div>
            <div className="flex gap-3 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
              <Button
                variant="primary"
                className="flex-1 bg-red-600 hover:bg-red-700"
                disabled={disableConfirmationText !== 'Off' || isUpdatingToggle}
                onClick={() => void updateNotificationState(false)}
              >
                {isUpdatingToggle ? 'Disabling…' : 'Disable Notifications'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={isUpdatingToggle}
                onClick={() => setShowDisableConfirmation(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

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
            <Button variant="secondary" onClick={handleTest} disabled={isTesting || !notificationsEnabled} leftIcon={<Send className="h-4 w-4" />}>
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
