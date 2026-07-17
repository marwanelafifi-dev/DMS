import { useNavigate } from 'react-router-dom';
import { Bell, Moon, Sun, LogOut } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useDarkMode } from '../../hooks/useDarkMode';

interface NavbarProps {
  onMenuClick?: () => void;
}

export function Navbar({ onMenuClick: _onMenuClick }: NavbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isDark, toggleDarkMode } = useDarkMode();

  return (
    <nav className="h-navbar-height bg-white dark:bg-black border-b border-navy-100/50 dark:border-white/10 shadow-sm dark:shadow-black/40 sticky top-0 z-40 transition-colors duration-300">
      <div className="relative flex items-center h-full w-full">
        {/* Center: Logo (absolutely centered, independent of side content widths) */}
        <button
          onClick={() => navigate('/')}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-opacity hover:opacity-80"
          aria-label="Go to Dashboard"
        >
          <img
            src="/images/si-ware-logo.png"
            alt="Si-Ware DMS"
            className="h-11 w-auto block dark:hidden"
          />
          <img
            src="/images/si-ware-logo-dark.png"
            alt="Si-Ware DMS"
            className="h-11 w-auto hidden dark:block"
          />
        </button>

        {/* Right: Theme Toggle, Notifications, User */}
        <div className="flex items-center gap-1 md:gap-2 ml-auto px-4 sm:px-6 lg:px-8">
          {/* Dark Mode Toggle */}
          <button
            onClick={toggleDarkMode}
            className="relative p-2.5 text-navy-600 dark:text-navy-300 hover:bg-navy-50 dark:hover:bg-navy-800 rounded-lg transition-all duration-200 group"
            aria-label="Toggle dark mode"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Sun
              className={`w-5 h-5 absolute inset-0 m-auto transition-all duration-300 ${
                isDark ? 'opacity-0 -rotate-90 scale-50' : 'opacity-100 rotate-0 scale-100 group-hover:text-navy-900'
              }`}
            />
            <Moon
              className={`w-5 h-5 transition-all duration-300 ${
                isDark ? 'opacity-100 rotate-0 scale-100 group-hover:text-white' : 'opacity-0 rotate-90 scale-50'
              }`}
            />
          </button>

          {/* Notifications Button */}
          <button
            className="relative p-2.5 text-navy-600 dark:text-navy-300 hover:bg-navy-50 dark:hover:bg-navy-800 rounded-lg transition-all duration-200 group"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="w-5 h-5 transition-colors group-hover:text-navy-900 dark:group-hover:text-white" />
            <span className="absolute top-1.5 right-1.5 w-3 h-3 bg-red-500 rounded-full animate-pulse shadow-lg ring-2 ring-white dark:ring-black"></span>
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-navy-200/50 dark:bg-navy-700/50 mx-2" />

          {/* User Identity */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-navy-700 flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0">
              {user?.fullName?.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:flex flex-col items-start gap-0.5">
              <p className="text-sm font-semibold text-navy-900 dark:text-white leading-none">{user?.fullName}</p>
              <p className="text-xs text-navy-500 dark:text-navy-400 font-medium leading-none">{user?.role || 'Full Access'}</p>
            </div>
          </div>

          {/* Sign Out */}
          <button
            onClick={logout}
            className="p-2.5 text-navy-600 dark:text-navy-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-all duration-200"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
