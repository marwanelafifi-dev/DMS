import { FileSearch, Loader } from 'lucide-react';
import type { ParsedDocument } from '../../services/doclingApi';

interface SearchSuggestionsDropdownProps {
  query: string;
  suggestions: ParsedDocument[];
  activeIndex: number;
  isLoading: boolean;
  onSelect: (doc: ParsedDocument) => void;
  onHoverIndex: (index: number) => void;
  id: string;
}

function highlightMatch(text: string, query: string) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const index = lowerQuery ? lowerText.indexOf(lowerQuery) : -1;
  if (index === -1 || !lowerQuery) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-[#fde68a] px-0.5 text-inherit dark:bg-amber-500/40">
        {text.slice(index, index + lowerQuery.length)}
      </mark>
      {text.slice(index + lowerQuery.length)}
    </>
  );
}

function buildSnippet(content: string, query: string) {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const matchIndex = lowerQuery ? lowerContent.indexOf(lowerQuery) : -1;
  if (matchIndex === -1) return content.slice(0, 80).replace(/\s+/g, ' ').trim();

  const start = Math.max(0, matchIndex - 30);
  const end = Math.min(content.length, matchIndex + lowerQuery.length + 40);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

export function SearchSuggestionsDropdown({
  query,
  suggestions,
  activeIndex,
  isLoading,
  onSelect,
  onHoverIndex,
  id,
}: SearchSuggestionsDropdownProps) {
  return (
    <div
      id={id}
      role="listbox"
      className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-[6px] border border-[#dbe2ec] bg-white py-1.5 shadow-lg dark:border-white/10 dark:bg-slate-900"
    >
      {isLoading && suggestions.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-[#718198]">
          <Loader className="h-4 w-4 animate-spin" /> Searching...
        </div>
      )}
      {!isLoading && suggestions.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-[#718198]">
          <FileSearch className="h-4 w-4" /> No matches for "{query}"
        </div>
      )}
      {suggestions.map((doc, index) => (
        <button
          key={doc.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseEnter={() => onHoverIndex(index)}
          onMouseDown={(event) => {
            // mousedown fires before the input's blur, so selecting a suggestion
            // doesn't get swallowed by the dropdown closing on blur first.
            event.preventDefault();
            onSelect(doc);
          }}
          className={`flex w-full flex-col gap-0.5 px-4 py-2 text-left ${
            index === activeIndex ? 'bg-[#edf2f8] dark:bg-slate-800' : ''
          }`}
        >
          <span className="truncate text-sm font-medium text-[#26334d] dark:text-white">
            {highlightMatch(doc.filename, query)}
          </span>
          <span className="truncate text-xs text-[#718198] dark:text-slate-400">
            {highlightMatch(buildSnippet(doc.content, query), query)}
          </span>
        </button>
      ))}
    </div>
  );
}
