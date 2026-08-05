import { useEffect, useRef, useState } from 'react';
import { Globe, LogIn, Monitor, RotateCcw, Save, Shield, Upload } from 'lucide-react';
import { Card, CardBody, Button } from '../ui';
import {
  apiClient,
  type GeneralSettings, type HeaderSettings, type LoginPageSettings, type SecuritySettings,
} from '../../utils/api';
import { useToast } from '../../hooks/useToast';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex h-6 w-11 flex-shrink-0 items-center rounded-full p-0.5 transition-colors ${
        checked ? 'justify-end bg-[#3f66c9]' : 'justify-start bg-[#cbd5e3] dark:bg-slate-700'
      }`}
    >
      <span className="h-5 w-5 flex-shrink-0 rounded-full bg-white shadow" />
    </button>
  );
}

function SectionHeader({ icon: Icon, iconClass, title, description }: { icon: typeof Globe; iconClass: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
      <div className={`rounded p-2 ${iconClass}`}><Icon className="h-4 w-4" /></div>
      <div>
        <h3 className="font-semibold text-[#26334d] dark:text-white">{title}</h3>
        <p className="text-sm text-[#718198] dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

const GENERAL_DEFAULT: GeneralSettings = { platformName: 'Si-Ware DMS', organizationName: 'Si-Ware Systems', supportEmail: 'ithelpdesk@si-ware.com', timezone: 'Africa/Cairo', dateFormat: 'DD-MMM-YYYY' };
const LOGIN_DEFAULT: LoginPageSettings = {
  pageTitle: 'Document Management System',
  pageSubtitle: 'Secure, compliant, and fully traceable from document creation through final approval.',
  cardTitle: 'Sign in securely',
  cardSubtitle: 'Authorized Si-Ware Employees only. Please use your Corporate Account to continue.',
  footerLine1: 'Operated by IT Team',
  footerLine2: 'For assistance, please contact the IT Helpdesk.',
  footerEmail: 'ithelpdesk@si-ware.com',
  showGoogleButton: true,
};
const HEADER_DEFAULT: HeaderSettings = { showLogoInHeader: true, logoAltText: 'Si-Ware Systems' };
const SECURITY_DEFAULT: SecuritySettings = { sessionTimeoutHours: 8, allowMultipleSessions: true, requireStrongPasswords: true, passwordExpiry: false };

export function PlatformSettings() {
  const { showSuccess, showError } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [general, setGeneral] = useState<GeneralSettings>(GENERAL_DEFAULT);
  const [loginPage, setLoginPage] = useState<LoginPageSettings>(LOGIN_DEFAULT);
  const [header, setHeader] = useState<HeaderSettings>(HEADER_DEFAULT);
  const [security, setSecurity] = useState<SecuritySettings>(SECURITY_DEFAULT);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingLogin, setSavingLogin] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [logoCacheBust, setLogoCacheBust] = useState(0);
  const loginLogoInputRef = useRef<HTMLInputElement>(null);
  const headerLogoInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setIsLoading(true);
    apiClient.getPlatformSettings()
      .then((res) => {
        if (!res.success || !res.data) return;
        setGeneral(res.data.general);
        setLoginPage(res.data.loginPage);
        setHeader(res.data.header);
        setSecurity(res.data.security);
      })
      .catch(() => showError('Failed to load platform settings'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveGeneral = async () => {
    setSavingGeneral(true);
    try {
      const res = await apiClient.updateGeneralSettings(general);
      if (!res.success) { showError(res.error || 'Failed to save'); return; }
      showSuccess('General settings saved');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save general settings');
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleSaveLoginPage = async () => {
    setSavingLogin(true);
    try {
      const res = await apiClient.updateLoginPageSettings(loginPage);
      if (!res.success) { showError(res.error || 'Failed to save'); return; }
      showSuccess('Login page settings saved');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save login page settings');
    } finally {
      setSavingLogin(false);
    }
  };

  const handleSaveHeader = async () => {
    setSavingHeader(true);
    try {
      const res = await apiClient.updateHeaderSettings(header);
      if (!res.success) { showError(res.error || 'Failed to save'); return; }
      showSuccess('Header settings saved');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save header settings');
    } finally {
      setSavingHeader(false);
    }
  };

  const handleSaveSecurity = async () => {
    setSavingSecurity(true);
    try {
      const res = await apiClient.updateSecuritySettings(security);
      if (!res.success) { showError(res.error || 'Failed to save'); return; }
      showSuccess('Security settings saved');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save security settings');
    } finally {
      setSavingSecurity(false);
    }
  };

  const handleUploadLogo = async (type: 'login' | 'header', file: File) => {
    try {
      const res = await apiClient.uploadPlatformLogo(type, file);
      if (!res.success) { showError(res.error || 'Failed to upload logo'); return; }
      showSuccess('Logo uploaded');
      setLogoCacheBust((v) => v + 1);
      load();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to upload logo');
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all platform settings (General, Login Page, Header, Security) to their defaults? Uploaded logos will also be removed.')) return;
    setIsResetting(true);
    try {
      const res = await apiClient.resetPlatformSettings();
      if (!res.success) { showError(res.error || 'Failed to reset'); return; }
      setGeneral(res.data.general);
      setLoginPage(res.data.loginPage);
      setHeader(res.data.header);
      setSecurity(res.data.security);
      setLogoCacheBust((v) => v + 1);
      showSuccess('Settings reset to defaults');
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to reset settings');
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return <Card><CardBody className="p-8 text-center text-sm text-[#718198]">Loading…</CardBody></Card>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-serif font-bold text-[#122344] dark:text-white">Settings</h2>
          <p className="mt-1 text-sm text-[#718198]">Platform-wide configuration and preferences</p>
        </div>
        <Button variant="secondary" onClick={handleReset} disabled={isResetting} leftIcon={<RotateCcw className="h-4 w-4" />}>
          {isResetting ? 'Resetting…' : 'Reset to Defaults'}
        </Button>
      </div>

      {/* General */}
      <Card className="overflow-hidden">
        <SectionHeader icon={Globe} iconClass="bg-[#e8f0f8] text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300" title="General" description="Basic platform information and regional settings" />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Platform Name</label>
              <input type="text" value={general.platformName} onChange={(e) => setGeneral({ ...general, platformName: e.target.value })} className="field-control h-10 w-full" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Organization Name</label>
              <input type="text" value={general.organizationName} onChange={(e) => setGeneral({ ...general, organizationName: e.target.value })} className="field-control h-10 w-full" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Support Email</label>
            <input type="email" value={general.supportEmail} onChange={(e) => setGeneral({ ...general, supportEmail: e.target.value })} className="field-control h-10 w-full" />
            <p className="mt-1 text-xs text-[#94a3b8]">Displayed in system emails and notifications</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Timezone</label>
              <select value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })} className="field-control h-10 w-full">
                <option value="Africa/Cairo">Cairo (GMT+2/+3)</option>
                <option value="UTC">UTC</option>
                <option value="Europe/London">London (GMT+0/+1)</option>
                <option value="America/New_York">New York (GMT-5/-4)</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Date Format</label>
              <select value={general.dateFormat} onChange={(e) => setGeneral({ ...general, dateFormat: e.target.value })} className="field-control h-10 w-full">
                <option value="DD-MMM-YYYY">DD-MMM-YYYY (15-May-2026)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (05/15/2026)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (15/05/2026)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2026-05-15)</option>
              </select>
            </div>
          </div>
          <Button variant="primary" onClick={handleSaveGeneral} disabled={savingGeneral} leftIcon={<Save className="h-4 w-4" />}>
            {savingGeneral ? 'Saving…' : 'Save Changes'}
          </Button>
        </CardBody>
      </Card>

      {/* Login Page */}
      <Card className="overflow-hidden">
        <SectionHeader icon={LogIn} iconClass="bg-[#eceafd] text-[#5b4fc7] dark:bg-indigo-900/30 dark:text-indigo-300" title="Login Page" description="Customize the text and content shown on the sign-in page" />
        <CardBody className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Login Page Logo</label>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center rounded border border-dashed border-[#cbd5e3] bg-[#f8fafc] p-2 dark:border-white/10 dark:bg-slate-800">
                {loginPage.logoObjectKey ? (
                  <img key={logoCacheBust} src={`/api/branding/logo/login?v=${logoCacheBust}`} alt="Login logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <img src="/images/si-ware-logo.png" alt="Default Si-Ware logo" className="max-h-full max-w-full object-contain" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-[#26334d] dark:text-white">{loginPage.logoObjectKey ? 'Custom logo' : 'Default Si-Ware logo'}</p>
                <p className="text-xs text-[#718198]">Upload your own logo for the login page.</p>
                <input ref={loginLogoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadLogo('login', f); e.target.value = ''; }} />
                <Button variant="secondary" size="sm" className="mt-1.5" onClick={() => loginLogoInputRef.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>Upload Logo</Button>
                <p className="mt-1 text-xs text-[#94a3b8]">PNG, JPG, SVG or WebP · recommended 200×80px</p>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Page Title</label>
            <input type="text" value={loginPage.pageTitle} onChange={(e) => setLoginPage({ ...loginPage, pageTitle: e.target.value })} className="field-control h-10 w-full" />
            <p className="mt-1 text-xs text-[#94a3b8]">Large heading shown above the sign-in card</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Page Subtitle</label>
            <textarea value={loginPage.pageSubtitle} onChange={(e) => setLoginPage({ ...loginPage, pageSubtitle: e.target.value })} className="field-control min-h-[70px] w-full py-2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Card Title</label>
              <input type="text" value={loginPage.cardTitle} onChange={(e) => setLoginPage({ ...loginPage, cardTitle: e.target.value })} className="field-control h-10 w-full" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Card Subtitle</label>
              <input type="text" value={loginPage.cardSubtitle} onChange={(e) => setLoginPage({ ...loginPage, cardSubtitle: e.target.value })} className="field-control h-10 w-full" />
            </div>
          </div>

          <div className="border-t border-[#e2e8f0] pt-4 dark:border-white/10">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">Footer Text</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Footer Line 1</label>
                <input type="text" value={loginPage.footerLine1} onChange={(e) => setLoginPage({ ...loginPage, footerLine1: e.target.value })} className="field-control h-10 w-full" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Footer Line 2</label>
                <input type="text" value={loginPage.footerLine2} onChange={(e) => setLoginPage({ ...loginPage, footerLine2: e.target.value })} className="field-control h-10 w-full" />
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Footer Email</label>
              <input type="email" value={loginPage.footerEmail} onChange={(e) => setLoginPage({ ...loginPage, footerEmail: e.target.value })} className="field-control h-10 w-full" />
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#e2e8f0] pt-4 dark:border-white/10">
            <div>
              <p className="text-sm font-medium text-[#26334d] dark:text-white">Show &quot;Continue with Google&quot; button</p>
              <p className="text-xs text-[#718198]">Show or hide the Google OAuth login option</p>
            </div>
            <Toggle checked={loginPage.showGoogleButton} onChange={(v) => setLoginPage({ ...loginPage, showGoogleButton: v })} />
          </div>

          <Button variant="primary" onClick={handleSaveLoginPage} disabled={savingLogin} leftIcon={<Save className="h-4 w-4" />}>
            {savingLogin ? 'Saving…' : 'Save Login Settings'}
          </Button>
        </CardBody>
      </Card>

      {/* Header */}
      <Card className="overflow-hidden">
        <SectionHeader icon={Monitor} iconClass="bg-[#e3f6ee] text-[#2f8a5e] dark:bg-green-900/30 dark:text-green-300" title="Header" description="Top bar logo and display options" />
        <CardBody className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Header Logo</label>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center rounded border border-dashed border-[#cbd5e3] bg-[#f8fafc] p-2 dark:border-white/10 dark:bg-slate-800">
                {header.logoObjectKey ? (
                  <img key={logoCacheBust} src={`/api/branding/logo/header?v=${logoCacheBust}`} alt="Header logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  <img src="/images/si-ware-logo.png" alt="Default Si-Ware logo" className="max-h-full max-w-full object-contain" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-[#26334d] dark:text-white">{header.logoObjectKey ? 'Custom logo' : 'Default Si-Ware logo'}</p>
                <p className="text-xs text-[#718198]">Upload your own logo for the top bar.</p>
                <input ref={headerLogoInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadLogo('header', f); e.target.value = ''; }} />
                <Button variant="secondary" size="sm" className="mt-1.5" onClick={() => headerLogoInputRef.current?.click()} leftIcon={<Upload className="h-3.5 w-3.5" />}>Upload Logo</Button>
                <p className="mt-1 text-xs text-[#94a3b8]">PNG, JPG, SVG or WebP · recommended 200×60px</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[#e2e8f0] pt-4 dark:border-white/10">
            <div>
              <p className="text-sm font-medium text-[#26334d] dark:text-white">Show Logo in Header</p>
              <p className="text-xs text-[#718198]">Display the logo centered in the top bar</p>
            </div>
            <Toggle checked={header.showLogoInHeader} onChange={(v) => setHeader({ ...header, showLogoInHeader: v })} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#26334d] dark:text-white">Logo Alt Text</label>
            <input type="text" value={header.logoAltText} onChange={(e) => setHeader({ ...header, logoAltText: e.target.value })} className="field-control h-10 w-full" />
            <p className="mt-1 text-xs text-[#94a3b8]">Accessibility label for the header logo image</p>
          </div>

          <Button variant="primary" onClick={handleSaveHeader} disabled={savingHeader} leftIcon={<Save className="h-4 w-4" />}>
            {savingHeader ? 'Saving…' : 'Save Header Settings'}
          </Button>
        </CardBody>
      </Card>

      {/* Security */}
      <Card className="overflow-hidden">
        <SectionHeader icon={Shield} iconClass="bg-[#fde8e8] text-[#c0392b] dark:bg-red-900/30 dark:text-red-300" title="Security" description="Authentication policies and session management" />
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4 dark:border-white/10">
            <div>
              <p className="text-sm font-medium text-[#26334d] dark:text-white">Session Timeout</p>
              <p className="text-xs text-[#718198]">Automatically log out inactive users after this period</p>
            </div>
            <select
              value={security.sessionTimeoutHours}
              onChange={(e) => setSecurity({ ...security, sessionTimeoutHours: Number(e.target.value) })}
              className="field-control h-9 w-32"
            >
              {[1, 2, 4, 8, 12, 24, 72, 168].map((h) => (
                <option key={h} value={h}>{h < 24 ? `${h} hours` : h === 24 ? '1 day' : `${Math.round(h / 24)} days`}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4 dark:border-white/10">
            <div>
              <p className="text-sm font-medium text-[#26334d] dark:text-white">Allow Multiple Sessions</p>
              <p className="text-xs text-[#718198]">Allow users to be logged in from multiple devices simultaneously</p>
            </div>
            <Toggle checked={security.allowMultipleSessions} onChange={(v) => setSecurity({ ...security, allowMultipleSessions: v })} />
          </div>

          <div className="flex items-center justify-between border-b border-[#e2e8f0] pb-4 dark:border-white/10">
            <div>
              <p className="text-sm font-medium text-[#26334d] dark:text-white">Require Strong Passwords</p>
              <p className="text-xs text-[#718198]">Enforce minimum 8 characters with uppercase, number, and symbol</p>
            </div>
            <Toggle checked={security.requireStrongPasswords} onChange={(v) => setSecurity({ ...security, requireStrongPasswords: v })} />
          </div>

          <div className="flex items-center justify-between pb-1">
            <div>
              <p className="text-sm font-medium text-[#26334d] dark:text-white">Password Expiry</p>
              <p className="text-xs text-[#718198]">Force users to reset their password periodically</p>
            </div>
            <Toggle checked={security.passwordExpiry} onChange={(v) => setSecurity({ ...security, passwordExpiry: v })} />
          </div>

          <Button variant="primary" onClick={handleSaveSecurity} disabled={savingSecurity} leftIcon={<Save className="h-4 w-4" />}>
            {savingSecurity ? 'Saving…' : 'Save Security Settings'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
