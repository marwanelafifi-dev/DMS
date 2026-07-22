import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, Check, Columns3, Copy, FolderInput, MoreVertical, Pencil, Trash2, X } from 'lucide-react';
import type { Folder } from '../../types';
import { Button } from '../ui';
import type { OptionalDocumentColumn } from './DocumentList';

const columnOptions: Array<{ id: OptionalDocumentColumn; label: string }> = [
  { id: 'department', label: 'Department' },
  { id: 'owner', label: 'Owner' },
  { id: 'createdAt', label: 'Creation date' },
  { id: 'modifiedAt', label: 'Modified date' },
  { id: 'tags', label: 'Tags' },
  { id: 'status', label: 'Status' },
];

const menuContentClass = 'z-[95] min-w-[190px] rounded-[5px] border border-[#dbe2ec] bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900';
const menuItemClass = 'flex h-9 select-none items-center gap-2 rounded-[4px] px-2.5 text-sm text-[#34425b] outline-none data-[highlighted]:bg-[#edf2f8] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800';

export function ColumnVisibilityMenu({ visibleColumns, onChange }: {
  visibleColumns: Set<OptionalDocumentColumn>;
  onChange: (columns: Set<OptionalDocumentColumn>) => void;
}) {
  const toggleColumn = (column: OptionalDocumentColumn) => {
    const next = new Set(visibleColumns);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    onChange(next);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="ml-auto inline-flex h-9 items-center gap-2 rounded-[4px] px-2 text-sm text-[#64748b] hover:bg-[#edf2f8] hover:text-[#283a7a] dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white" type="button" aria-label="Columns">
          <Columns3 className="h-4 w-4" /> Columns
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuContentClass} sideOffset={6} align="end">
          <DropdownMenu.Label className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#718198]">Visible columns</DropdownMenu.Label>
          {columnOptions.map((column) => (
            <DropdownMenu.CheckboxItem
              key={column.id}
              checked={visibleColumns.has(column.id)}
              onCheckedChange={() => toggleColumn(column.id)}
              className={menuItemClass}
            >
              <span className="flex h-4 w-4 items-center justify-center"><DropdownMenu.ItemIndicator><Check className="h-3.5 w-3.5" /></DropdownMenu.ItemIndicator></span>
              {column.label}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export type LibraryBulkAction = 'copy' | 'delete' | 'move' | 'rename';

interface LibraryBulkActionsProps {
  selectedCount: number;
  selectedNames: string[];
  canRename: boolean;
  renameCurrentName?: string;
  renameIsFile?: boolean;
  folders: Folder[];
  disabledDestinationIds?: Set<string>;
  containsNonEmptyFolder?: boolean;
  requestedAction?: LibraryBulkAction | null;
  onRequestedActionHandled?: () => void;
  onRequestedActionDismissed?: () => void;
  onConfirm: (action: LibraryBulkAction, value?: string) => string | undefined;
}

function fileExtension(name: string) {
  const match = name.match(/(\.[^./\\]+)$/);
  return match?.[1].toLowerCase() ?? '';
}

export function LibraryBulkActions({
  selectedCount,
  selectedNames,
  canRename,
  renameCurrentName,
  renameIsFile = false,
  folders,
  disabledDestinationIds = new Set(),
  containsNonEmptyFolder = false,
  requestedAction = null,
  onRequestedActionHandled,
  onRequestedActionDismissed,
  onConfirm,
}: LibraryBulkActionsProps) {
  const [action, setAction] = useState<LibraryBulkAction | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [extensionConfirmed, setExtensionConfirmed] = useState(false);
  const [isRequestedAction, setIsRequestedAction] = useState(false);

  useEffect(() => {
    if (!requestedAction || selectedCount === 0) return;
    setIsRequestedAction(true);
    setAction(requestedAction);
    onRequestedActionHandled?.();
  }, [onRequestedActionHandled, requestedAction, selectedCount]);

  useEffect(() => {
    if (action === 'rename') setValue(renameCurrentName ?? '');
    else setValue('');
    setError('');
    setExtensionConfirmed(false);
  }, [action, renameCurrentName]);

  const availableDestinations = useMemo(
    () => folders.filter((folder) => !disabledDestinationIds.has(folder.folderId)),
    [disabledDestinationIds, folders],
  );

  if (selectedCount === 0) return null;

  const confirm = () => {
    if ((action === 'copy' || action === 'move') && !value) {
      setError('Choose a destination folder.');
      return;
    }
    if (action === 'rename') {
      if (!value.trim()) {
        setError('Name is required.');
        return;
      }
      const changedExtension = renameIsFile && fileExtension(value) !== fileExtension(renameCurrentName ?? '');
      if (changedExtension && !extensionConfirmed) {
        setError('Changing the file extension can make the file unreadable. Confirm once more to continue.');
        setExtensionConfirmed(true);
        return;
      }
    }
    if (!action) return;
    const operationError = onConfirm(action, value.trim() || undefined);
    if (operationError) {
      setError(operationError);
      return;
    }
    setIsRequestedAction(false);
    setAction(null);
  };

  const actionTitle = action ? `${action[0].toUpperCase()}${action.slice(1)} selected ${selectedCount === 1 ? 'item' : 'items'}` : '';

  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-xs font-medium text-[#52627a] dark:text-slate-200">{selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label="Actions for selected items" title="Actions for selected items" className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] border border-[#cbd5e3] bg-white text-[#52627a] hover:bg-[#edf2f8] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={menuContentClass} sideOffset={6} align="end">
            <DropdownMenu.Item className={menuItemClass} onSelect={() => setAction('copy')}><Copy className="h-4 w-4" /> Copy</DropdownMenu.Item>
            <DropdownMenu.Item className={`${menuItemClass} text-[#c73c44]`} onSelect={() => setAction('delete')}><Trash2 className="h-4 w-4" /> Delete</DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => setAction('move')}><FolderInput className="h-4 w-4" /> Move</DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItemClass}
              disabled={!canRename}
              aria-label="Rename"
              aria-describedby={!canRename ? 'rename-selection-help' : undefined}
              title={!canRename ? 'Only one item can be renamed at a time' : undefined}
              onSelect={() => setAction('rename')}
            >
              <Pencil className="h-4 w-4" /> Rename
            </DropdownMenu.Item>
            {!canRename && <span id="rename-selection-help" className="sr-only">Only one item can be renamed at a time.</span>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog.Root open={action !== null} onOpenChange={(open) => {
        if (open) return;
        setAction(null);
        if (isRequestedAction) onRequestedActionDismissed?.();
        setIsRequestedAction(false);
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[5px] border border-[#dbe2ec] bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-[#e2e8f0] px-5 py-4 dark:border-white/10">
              <Dialog.Title className="section-heading">{actionTitle}</Dialog.Title>
              <Dialog.Close asChild><button type="button" aria-label="Close bulk action dialog" className="text-[#718198] hover:text-[#26334d]"><X className="h-5 w-5" /></button></Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Configure and confirm the selected library operation.</Dialog.Description>
            <div className="space-y-4 p-5">
              {(action === 'copy' || action === 'move') && (
                <label className="block text-sm font-medium text-[#34425b] dark:text-slate-100">
                  Destination folder
                  <select className="field-control mt-2 w-full" value={value} aria-invalid={Boolean(error)} aria-describedby={error ? 'bulk-action-error' : undefined} onChange={(event) => { setValue(event.target.value); setError(''); }}>
                    <option value="">Choose a folder</option>
                    {availableDestinations.map((folder) => <option key={folder.folderId} value={folder.folderId}>{folder.name}</option>)}
                  </select>
                </label>
              )}
              {action === 'delete' && (
                <div className="space-y-3">
                  <div className="flex gap-3 rounded-[5px] border border-[#efb7ba] bg-[#fff7f7] p-3 text-sm text-[#a83238]">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <span>This permanently removes {selectedCount} selected {selectedCount === 1 ? 'item' : 'items'}.</span>
                  </div>
                  {containsNonEmptyFolder && <p className="text-sm font-medium text-[#b96a08]">Warning: the selection contains a non-empty folder and all of its documents will be deleted.</p>}
                  <ul className="max-h-28 space-y-1 overflow-y-auto text-sm text-[#52627a]">{selectedNames.slice(0, 5).map((name) => <li key={name}>• {name}</li>)}</ul>
                </div>
              )}
              {action === 'rename' && (
                <label className="block text-sm font-medium text-[#34425b] dark:text-slate-100">
                  New name
                  <input autoFocus className="field-control mt-2 w-full" value={value} aria-invalid={Boolean(error)} aria-describedby={error ? 'bulk-action-error' : undefined} onChange={(event) => { setValue(event.target.value); setError(''); setExtensionConfirmed(false); }} />
                </label>
              )}
              {error && <p id="bulk-action-error" role="alert" className="text-sm text-[#c73c44]">{error}</p>}
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild><Button variant="secondary" type="button">Cancel</Button></Dialog.Close>
                <Button variant={action === 'delete' ? 'danger' : 'primary'} type="button" onClick={confirm}>
                  {action === 'rename' && extensionConfirmed ? 'Change extension' : action === 'copy' ? 'Copy items' : action === 'move' ? 'Move items' : action === 'delete' ? 'Delete items' : 'Rename item'}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
