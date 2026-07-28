import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useDarkMode } from '../../hooks/useDarkMode';

interface NavbarProps {
  onMenuClick?: () => void;
}

export function Navbar({ onMenuClick: _onMenuClick }: NavbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isDark, toggleDarkMode } = useDarkMode();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  const initials = (user?.fullName || 'System Admin')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="z-30 flex h-[68px] flex-shrink-0 items-center border-b border-[#dbe2ec] bg-white px-4 dark:border-white/10 dark:bg-slate-900 sm:px-6 lg:px-5">
      <button
        onClick={_onMenuClick}
        className="mr-3 rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <form onSubmit={handleSearch} className="relative w-full max-w-[540px]">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-[#8ea0ba]" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="OCR search across document contents..."
          aria-label="Search document contents"
          className="h-10 w-full rounded-[5px] border border-[#cbd5e3] bg-white pl-11 pr-4 text-sm text-slate-800 outline-none placeholder:text-[#9aa7ba] focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </form>

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        <div className="hidden items-center gap-2 text-sm text-[#64748b] md:flex">
          <span>Role</span>
          <div className="flex h-10 min-w-[96px] items-center justify-center rounded-[5px] border border-[#cbd5e3] bg-white px-3 text-[#17213a] dark:border-slate-700 dark:bg-slate-950 dark:text-white">
            <span>{user?.role || 'Manager'}</span>
          </div>
        </div>

        <div className="h-8 w-px bg-[#e2e8f0]" />

        <div className="flex items-center gap-2">
          <button
            onClick={toggleDarkMode}
            className="rounded-md p-2 text-[#52627a] hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          <button
            className="relative rounded-md p-2 text-[#52627a] hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-0.5 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#e34d55] px-1 text-[10px] font-bold text-white ring-2 ring-white">3</span>
          </button>

          <div className="hidden h-9 w-px bg-[#e2e8f0] sm:block" />

          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#2f3e83] text-sm font-bold text-white">
              {initials}
            </div>
            <div className="hidden min-w-[92px] sm:block">
              <div className="truncate text-sm font-semibold leading-5 text-[#17213a] dark:text-white">{user?.fullName}</div>
              <div className="text-xs leading-4 text-[#718198]">{user?.role || 'Full Access'}</div>
            </div>
          </div>

          <button
            onClick={logout}
            className="hidden rounded-md p-2 text-[#718198] hover:bg-red-50 hover:text-red-600 xl:block"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
