import { useEffect, useRef, useState } from 'react';
import { Briefcase, ChevronDown, Download, FolderKanban, Plus, Tag, Trash2, Upload } from 'lucide-react';
import { Card, CardBody, Button } from '../ui';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

interface DropdownItem {
  itemId: string;
  label: string;
}

// One entry per admin-editable list. Adding a new manageable dropdown to the
// app means adding it here (frontend) and to DropdownListKeys.All (backend).
const LIST_DEFS = [
  { key: 'department', title: 'Departments', description: 'Departments used across the Document Library, upload form, and user admin', icon: Briefcase },
  { key: 'category', title: 'Document Categories', description: 'Categories offered when uploading or editing a document', icon: FolderKanban },
  { key: 'tag', title: 'Tags', description: 'Suggested tags offered when uploading or editing a document', icon: Tag },
];

const PAGE_SIZE = 10;

function DropdownListCard({ listKey, title, description, icon: Icon }: { listKey: string; title: string; description: string; icon: typeof Briefcase }) {
  const { showSuccess, showError } = useToast();
  const [items, setItems] = useState<DropdownItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.getDropdownList(listKey);
      setItems(res.data || []);
    } catch {
      showError(`Failed to load ${title}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setIsAdding(true);
    try {
      const res = await apiClient.addDropdownItem(listKey, label);
      if (!res.success) { showError(res.error || 'Failed to add item'); return; }
      setNewLabel('');
      showSuccess(`Added "${label}"`);
      load();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to add item');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (item: DropdownItem) => {
    try {
      const res = await apiClient.deleteDropdownItem(listKey, item.itemId);
      if (!res.success) { showError(res.error || 'Failed to delete item'); return; }
      setItems((prev) => prev.filter((i) => i.itemId !== item.itemId));
      showSuccess(`Removed "${item.label}"`);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete item');
    }
  };

  const handleImportFile = async (file: File) => {
    setIsImporting(true);
    try {
      const res = await apiClient.importDropdownList(listKey, file);
      if (!res.success) { showError(res.error || 'Import failed'); return; }
      showSuccess(`Imported ${res.data?.added ?? 0} item(s)${res.data?.skipped ? `, skipped ${res.data.skipped} duplicate(s)` : ''}`);
      load();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      await apiClient.exportDropdownList(listKey);
    } catch {
      showError('Export failed');
    }
  };

  const filtered = items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()));
  const visible = showAll ? filtered : filtered.slice(0, PAGE_SIZE);

  return (
    <Card className="overflow-hidden">
      <CardBody className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[5px] bg-[#e8f0f8] text-[#2f5f96] dark:bg-blue-900/30 dark:text-blue-300"><Icon className="h-5 w-5" /></span>
            <div>
              <h3 className="section-heading">{title}</h3>
              <p className="text-xs text-[#718198]">{description}</p>
            </div>
          </div>
          <div className="flex flex-shrink-0 gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImportFile(file); e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Upload className="h-3.5 w-3.5" /> {isImporting ? 'Importing…' : 'Import'}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-[#dbe2ec] px-3 text-xs font-medium text-[#52627a] hover:bg-[#eef2f7] dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder={`Add new ${title.toLowerCase().replace(/s$/, '')}...`}
            disabled={isAdding}
            className="field-control h-10 flex-1 rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
          />
          <Button variant="primary" onClick={handleAdd} isLoading={isAdding} leftIcon={<Plus className="h-4 w-4" />}>Add</Button>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}...`}
          className="field-control h-9 w-full rounded-[4px] border border-[#dbe2ec] bg-white px-3 text-sm text-[#26334d] placeholder-[#8ea0ba] focus-visible:border-[#3f8bca] focus-visible:ring-2 focus-visible:ring-[#3f8bca]/20 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500"
        />

        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
          {filtered.length > PAGE_SIZE && (
            <button type="button" onClick={() => setShowAll((prev) => !prev)} className="flex items-center gap-1 text-xs font-medium text-[#3f8bca] hover:text-[#2f6f9f]">
              {showAll ? 'Show less' : `Show all (${filtered.length})`}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAll ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-[#718198]">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-[4px] border border-dashed border-[#dbe2ec] px-3 py-6 text-center text-sm text-[#94a3b8] dark:border-white/10">No items yet.</p>
        ) : (
          <div className="space-y-1.5">
            {visible.map((item) => (
              <div key={item.itemId} className="group flex items-center justify-between rounded-[4px] border border-[#dbe2ec] px-3 py-2 text-sm text-[#26334d] dark:border-white/10 dark:text-slate-200">
                <span className="truncate">{item.label}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  className="ml-2 flex-shrink-0 rounded p-1 text-[#c1c9d6] opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  title={`Remove "${item.label}"`}
                  aria-label={`Remove ${item.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function CompanyData() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Company Data</h1>
        <p className="page-subtitle">Manage the dropdown lists used across upload forms and document metadata — add, remove, import, or export as an Excel file.</p>
      </div>
      <p className="text-xs text-[#718198]">Import supports <strong>.csv</strong>, <strong>.xlsx</strong>, or <strong>.xls</strong> — the first column is used as the item name.</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {LIST_DEFS.map((def) => (
          <DropdownListCard key={def.key} listKey={def.key} title={def.title} description={def.description} icon={def.icon} />
        ))}
      </div>
    </div>
  );
}
