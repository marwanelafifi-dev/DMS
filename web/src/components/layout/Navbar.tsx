import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useDarkMode } from '../../hooks/useDarkMode';
import { useSearchSuggestions } from '../../hooks/useSearchSuggestions';
import { useAllDmsDocuments } from '../../hooks/useAllDmsDocuments';
import { SearchSuggestionsDropdown } from '../custom/SearchSuggestionsDropdown';
import { NotificationsBell } from '../custom/NotificationsBell';
import type { ParsedDocument } from '../../services/doclingApi';
import { roleLabel } from '../../utils/roleLabels';

interface NavbarProps {
  onMenuClick?: () => void;
}

export function Navbar({ onMenuClick: _onMenuClick }: NavbarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isDark, toggleDarkMode } = useDarkMode();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Loading all document metadata here duplicated the Document Library's own
  // request on every page load. Suggestions only need it after the user has
  // actually entered a searchable query.
  const { documents: allDmsDocuments } = useAllDmsDocuments(searchQuery.trim().length >= 2);
  const { suggestions, isLoading } = useSearchSuggestions(isSuggestionsOpen ? searchQuery : '', allDmsDocuments);
  const searchContainerRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const goToSearch = (query: string) => {
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
    setIsSuggestionsOpen(false);
  };

  const selectSuggestion = (doc: ParsedDocument) => {
    setSearchQuery(doc.filename);
    goToSearch(doc.filename);
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    goToSearch(searchQuery.trim());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isSuggestionsOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setIsSuggestionsOpen(false);
    }
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

      <form ref={searchContainerRef} onSubmit={handleSearch} className="relative w-full max-w-[540px]">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-[#8ea0ba]" />
        <input
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value);
            setIsSuggestionsOpen(true);
          }}
          onFocus={() => setIsSuggestionsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="OCR search across document contents..."
          aria-label="Search document contents"
          role="combobox"
          aria-expanded={isSuggestionsOpen && searchQuery.trim().length >= 2}
          aria-controls="navbar-search-suggestions"
          aria-autocomplete="list"
          autoComplete="off"
          className="h-10 w-full rounded-[5px] border border-[#cbd5e3] bg-white pl-11 pr-4 text-sm text-slate-800 outline-none placeholder:text-[#9aa7ba] focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
        {isSuggestionsOpen && searchQuery.trim().length >= 2 && (
          <SearchSuggestionsDropdown
            id="navbar-search-suggestions"
            query={searchQuery}
            suggestions={suggestions}
            activeIndex={activeIndex}
            isLoading={isLoading}
            onSelect={selectSuggestion}
            onHoverIndex={setActiveIndex}
          />
        )}
      </form>

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
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

          <NotificationsBell />

          <div className="hidden h-9 w-px bg-[#e2e8f0] sm:block" />

          <div className="flex items-center gap-2.5">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.fullName}
                referrerPolicy="no-referrer"
                className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#2f3e83] text-sm font-bold text-white">
                {initials}
              </div>
            )}
            <div className="hidden min-w-[92px] sm:block">
              <div className="truncate text-sm font-semibold leading-5 text-[#17213a] dark:text-white">{user?.fullName}</div>
              <div className="text-xs leading-4 text-[#52627a]">{roleLabel(user?.role ?? 'No Access')}</div>
            </div>
          </div>

          <button
            onClick={logout}
            className="flex-shrink-0 rounded-md p-2 text-[#718198] hover:bg-red-50 hover:text-red-600"
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
