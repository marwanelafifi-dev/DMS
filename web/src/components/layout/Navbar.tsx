import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

// Icon components (svg)
const Menu = ({ className }: { className?: string }) => <svg className={className || "w-6 h-6"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>;
const Bell = ({ className }: { className?: string }) => <svg className={className || "w-6 h-6"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>;
const Settings = ({ className }: { className?: string }) => <svg className={className || "w-6 h-6"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
const LogOut = ({ className }: { className?: string }) => <svg className={className || "w-6 h-6"} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>;

interface NavbarProps {
  onMenuClick?: () => void;
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <nav className="h-navbar-height bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-40">
      <div className="flex items-center justify-between h-full px-4 md:px-6 max-w-[1920px] mx-auto">
        {/* Left: Logo & Menu */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="hidden md:inline-flex lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-2">
            <img
              src="https://www.si-ware.com/en/_next/static/media/horizontal-logo.efdc2b40.svg"
              alt="Si-Ware"
              className="h-8"
            />
            <h1 className="hidden sm:block text-lg font-semibold text-primary-600 dark:text-primary-400">
              DMS
            </h1>
          </div>
        </div>

        {/* Center: Breadcrumb (Optional) */}
        <div className="flex-1 mx-8 hidden md:block">
          {/* Will be populated with breadcrumb from router */}
        </div>

        {/* Right: User Menu */}
        <div className="flex items-center gap-4">
          {/* Notifications */}
          <button
            className="relative p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-6 h-6" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full"></span>
          </button>

          {/* Settings */}
          <button
            onClick={() => navigate('/settings')}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-6 h-6" />
          </button>

          {/* User Menu */}
          <div className="flex items-center gap-3 pl-4 border-l border-gray-200 dark:border-gray-700">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium">{user?.fullName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{user?.role}</p>
            </div>

            <button
              onClick={logout}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              aria-label="Logout"
              title="Logout"
            >
              <LogOut className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
