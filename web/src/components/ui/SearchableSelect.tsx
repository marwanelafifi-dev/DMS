import { useMemo, useState } from 'react';

export type SearchableOption = { value: string; label: string; searchText?: string };
export function SearchableSelect({ value, options, onChange, placeholder = 'Select an option', className = '' }: { value: string; options: SearchableOption[]; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  const [query, setQuery] = useState('');
  const selected = options.find(option => option.value === value);
  const matches = useMemo(() => { const term = query.toLowerCase().trim(); return !term ? options : options.filter(option => `${option.label} ${option.searchText ?? ''}`.toLowerCase().includes(term)); }, [options, query]);
  return <div className={`rounded-[5px] border border-[#dbe2ec] bg-white p-1 dark:border-white/10 dark:bg-slate-950 ${className}`}><input value={query} onChange={event => setQuery(event.target.value)} placeholder={selected?.label ?? placeholder} className="h-8 w-full bg-transparent px-2 text-sm text-[#26334d] outline-none placeholder:text-[#718198] dark:text-white" aria-label={placeholder} /><div className="max-h-44 overflow-y-auto border-t border-[#e8eef5] dark:border-white/10">{matches.length ? matches.map(option => <button type="button" key={option.value} onClick={() => { onChange(option.value); setQuery(''); }} className={`block w-full px-2 py-2 text-left text-sm hover:bg-[#eef4fb] dark:hover:bg-slate-800 ${option.value === value ? 'font-semibold text-[#1763a5]' : 'text-[#52627a] dark:text-slate-200'}`}>{option.label}</button>) : <p className="px-2 py-3 text-sm text-[#718198]">No matching options.</p>}</div></div>;
}
