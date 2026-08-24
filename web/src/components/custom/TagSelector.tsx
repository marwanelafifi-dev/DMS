import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { apiClient } from '../../utils/api';

interface TagSelectorProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

/** Shared New-DMS tag picker backed by the configured `tag` dropdown list. */
export function TagSelector({ value, onChange, disabled = false }: TagSelectorProps) {
  const [options, setOptions] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiClient.getDropdownList('tag')
      .then((response) => {
        if (!cancelled) setOptions((response.data || []).map((item: { label: string }) => item.label));
      })
      .catch(() => { if (!cancelled) setOptions([]); });
    return () => { cancelled = true; };
  }, []);

  const toggle = (tag: string) => {
    if (disabled) return;
    onChange(value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag]);
  };

  const addCustom = () => {
    const next = customTag.trim();
    if (!next || disabled) return;
    if (!value.some((tag) => tag.toLocaleLowerCase() === next.toLocaleLowerCase())) onChange([...value, next]);
    setCustomTag('');
  };

  const visibleOptions = disabled ? options.filter((tag) => value.includes(tag)) : options;

  return (
    <div className="space-y-2">
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded border border-gray-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800">
        {disabled && value.length === 0 && <span className="px-1 py-0.5 text-xs text-gray-400 dark:text-slate-500">No tags</span>}
        {!disabled && options.length === 0 && <span className="px-1 py-0.5 text-xs text-gray-400 dark:text-slate-500">No configured tags</span>}
        {visibleOptions.map((tag) => {
          const selected = value.includes(tag);
          return (
            <button key={tag} type="button" disabled={disabled} onClick={() => toggle(tag)} aria-label={`${selected ? 'Remove' : 'Add'} tag ${tag}`} aria-pressed={selected} className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-300' : 'border-gray-300 bg-white text-gray-600 hover:border-blue-400/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              {tag}
            </button>
          );
        })}
      </div>
      {value.filter((tag) => !options.includes(tag)).length > 0 && (
        <div className="flex flex-wrap gap-1.5">{value.filter((tag) => !options.includes(tag)).map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-[#52627a] dark:bg-slate-800 dark:text-slate-300">{tag}{!disabled && <button type="button" onClick={() => toggle(tag)} aria-label={`Remove tag ${tag}`}><X className="h-3 w-3" /></button>}</span>)}</div>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <input aria-label="Add custom tag" value={customTag} onChange={(event) => setCustomTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} placeholder="Add a custom tag" className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
          <button type="button" onClick={addCustom} disabled={!customTag.trim()} aria-label="Add custom tag value" className="inline-flex items-center gap-1 rounded border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] disabled:opacity-50 dark:border-white/10 dark:text-slate-300"><Plus className="h-3.5 w-3.5" /> Add</button>
        </div>
      )}
    </div>
  );
}
