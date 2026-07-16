import { useNavigate } from 'react-router-dom';
import { Menu, Bell, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';

interface NavbarProps {
  onMenuClick?: () => void;
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <nav className="h-navbar-height bg-gradient-to-r from-navy-900 to-navy-800 dark:from-navy-900 dark:to-navy-800 border-b border-primary-500 shadow-lg sticky top-0 z-40">
      <div className="flex items-center justify-between h-full px-4 md:px-6 max-w-[1920px] mx-auto">
        {/* Left: Logo & Menu */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuClick}
            className="hidden md:inline-flex lg:hidden p-2 hover:bg-navy-700 rounded-lg transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-6 h-6 text-white" />
          </button>

          <div className="flex items-center gap-2">
            <img
              src="https://www.si-ware.com/en/_next/static/media/horizontal-logo.efdc2b40.svg"
              alt="Si-Ware"
              className="h-8"
            />
            <h1 className="hidden sm:block text-lg font-bold text-white">
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
            className="relative p-2 hover:bg-navy-700 rounded-lg transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-6 h-6 text-white" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full"></span>
          </button>

          {/* Settings */}
          <button
            onClick={() => navigate('/settings')}
            className="p-2 hover:bg-navy-700 rounded-lg transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-6 h-6 text-white" />
          </button>

          {/* User Menu */}
          <div className="flex items-center gap-3 pl-4 border-l border-primary-500">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-bold text-white">{user?.fullName}</p>
              <p className="text-xs text-primary-200">{user?.role}</p>
            </div>

            <button
              onClick={logout}
              className="p-2 hover:bg-navy-700 rounded-lg transition-colors"
              aria-label="Logout"
              title="Logout"
            >
              <LogOut className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
