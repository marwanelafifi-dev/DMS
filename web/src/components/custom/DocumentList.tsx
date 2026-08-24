import { useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { ChevronLeft, ChevronRight, Copy, Download, Eye, FilePen, FileText, FolderInput, MoreVertical, Pencil, PencilLine, ShieldCheck, Trash2 } from 'lucide-react';
import type { MockLibraryDocument } from '../../fixtures/documentLibrary';
import type { RolePermissionFlags } from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';
import { statusLabels, statusStyles } from '../../utils/documentStatus';

const rowMenuContentClass = 'z-[95] min-w-[210px] rounded-[5px] border border-[#dbe2ec] bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900';
const rowMenuItemClass = 'flex h-9 select-none items-center gap-2 rounded-[4px] px-2.5 text-sm text-[#34425b] outline-none data-[highlighted]:bg-[#edf2f8] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800';

// Excel-style "click a cell to see what got cut off" — every truncated cell in this
// table is one of these instead of a plain <span title="...">, since a hover tooltip
// disappears the moment the mouse moves and doesn't work at all on touch devices.
// Plain wrapping text — for columns like Department/Owner where the whole point is
// to always show the full value, not to truncate-then-click-to-reveal.
function WrappingCellText({ value, monospace }: { value?: string | null; monospace?: boolean }) {
  if (!value) return <span className="text-[#93a4bd]">—</span>;
  return <span className={`block whitespace-normal break-words ${monospace ? 'font-mono text-xs' : ''}`}>{value}</span>;
}

function ExpandableCellText({ value, monospace }: { value?: string | null; monospace?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!value) return <span className="text-[#93a4bd]">—</span>;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={`block w-full truncate text-left hover:underline ${monospace ? 'font-mono text-xs' : ''}`}
        >
          {value}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
          className={`z-[100] max-w-sm rounded-[5px] border border-[#dbe2ec] bg-white px-3 py-2 text-sm text-[#26334d] shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-white ${monospace ? 'font-mono text-xs' : ''}`}
        >
          <p className="whitespace-pre-wrap break-words">{value}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type OptionalDocumentColumn = 'department' | 'category' | 'owner' | 'modifiedAt' | 'tags' | 'status';

export const defaultVisibleDocumentColumns: ReadonlySet<OptionalDocumentColumn> = new Set([
  'department',
  'category',
  'owner',
  'modifiedAt',
  'tags',
  'status',
]);

interface DocumentListProps {
  documents: MockLibraryDocument[];
  isLoading?: boolean;
  selectedDocumentIds?: Set<string>;
  visibleColumns?: Set<OptionalDocumentColumn>;
  onSelectedDocumentIdsChange?: (ids: Set<string>) => void;
  onDocumentClick: (docId: string) => void;
  onDownload?: (docId: string) => void;
  onDownloadForEditing?: (docId: string) => void;
  onFilePermissions?: (docId: string) => void;
  onEdit?: (docId: string) => void;
  onDocumentAction?: (action: 'copy' | 'cut' | 'rename' | 'delete', docId: string) => void;
  canDownloadForEditing?: boolean;
  // The effective permissions for the folder currently being browsed — every
  // row here belongs to that same folder, so one fetch covers all of them.
  permissions?: RolePermissionFlags | null;
}

type SortKey = 'fileName' | 'extension' | 'folderName' | 'department' | 'category' | 'owner' | 'modifiedAt' | 'tags' | 'status';

const extensionStyles: Record<MockLibraryDocument['extension'], string> = {
  txt: 'bg-slate-100 text-slate-600',
  doc: 'bg-blue-50 text-blue-700',
  docx: 'bg-blue-50 text-blue-700',
  xlsx: 'bg-emerald-50 text-emerald-700',
  pptx: 'bg-orange-50 text-orange-700',
  pdf: 'bg-red-50 text-red-700',
  png: 'bg-violet-50 text-violet-700',
  jpg: 'bg-violet-50 text-violet-700',
  jpeg: 'bg-violet-50 text-violet-700',
  file: 'bg-slate-100 text-slate-600',
};

function SelectionCheckbox({ checked, indeterminate = false, onChange, label }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 rounded border-slate-300 accent-[#3f8bca]"
    />
  );
}

export function DocumentList({
  documents,
  isLoading = false,
  selectedDocumentIds = new Set(),
  visibleColumns = new Set(defaultVisibleDocumentColumns),
  onSelectedDocumentIdsChange,
  onDocumentClick,
  onDownload,
  onDownloadForEditing,
  onFilePermissions,
  onEdit,
  onDocumentAction,
  canDownloadForEditing = false,
  permissions,
}: DocumentListProps) {
  const [sortBy, setSortBy] = useState<SortKey>('fileName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Display-only pagination: search/sort/selection/folder-scoping are all
  // unchanged and still operate on the full `documents` list exactly as
  // before — this only limits how many <tr> rows get drawn into the DOM at
  // once, which is what actually made a large folder feel heavy to scroll.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);

  const sortedDocuments = useMemo(() => [...documents].sort((a, b) => {
    const values: Record<SortKey, [string | number, string | number]> = {
      fileName: [a.fileName, b.fileName],
      extension: [a.extension, b.extension],
      folderName: [a.folderName, b.folderName],
      department: [a.department, b.department],
      category: [a.category ?? '', b.category ?? ''],
      owner: [a.owner.fullName, b.owner.fullName],
      modifiedAt: [new Date(a.modifiedAt).getTime(), new Date(b.modifiedAt).getTime()],
      tags: [a.tags.join(' '), b.tags.join(' ')],
      status: [a.status, b.status],
    };
    const [left, right] = values[sortBy];
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right));
    return sortDirection === 'asc' ? comparison : -comparison;
  }), [documents, sortBy, sortDirection]);

  // Clamp against the current filtered/sorted length rather than resetting
  // via an effect — if a search or folder change shrinks the list below the
  // page you were on, this just falls back to the last valid page instead of
  // rendering a blank one, with no extra state-reset logic to get wrong.
  const totalPages = Math.max(1, Math.ceil(sortedDocuments.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedDocuments = sortedDocuments.slice(pageStart, pageStart + PAGE_SIZE);

  // Selection semantics are unchanged on purpose: "select all" still means
  // every document matching the current filter/folder, not just this page —
  // otherwise a bulk delete/move after paging through would silently miss
  // whatever wasn't on the page the user happened to be looking at.
  const selectedVisibleCount = documents.filter((document) => selectedDocumentIds.has(document.documentId)).length;
  const allVisibleSelected = documents.length > 0 && selectedVisibleCount === documents.length;

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(key);
      setSortDirection('asc');
    }
  };

  const toggleSelected = (documentId: string) => {
    const next = new Set(selectedDocumentIds);
    if (next.has(documentId)) next.delete(documentId);
    else next.add(documentId);
    onSelectedDocumentIdsChange?.(next);
  };

  const toggleAll = () => {
    const next = new Set(selectedDocumentIds);
    documents.forEach((document) => {
      if (allVisibleSelected) next.delete(document.documentId);
      else next.add(document.documentId);
    });
    onSelectedDocumentIdsChange?.(next);
  };

  const header = (label: string, key: SortKey) => (
    <button type="button" onClick={() => toggleSort(key)} className={sortBy === key ? 'text-[#283a7a] dark:text-white' : ''}>
      {label}
    </button>
  );

  // table-layout:fixed distributes width strictly by these ratios. Fixed px widths
  // would let the sum exceed the container the moment several optional columns are
  // shown at once, which forces the browser to scale every column down proportionally
  // — including the file name column straight to ~0. Weights recomputed against only
  // the currently-visible columns always sum to exactly 100%, so file name keeps a
  // guaranteed generous share no matter how many optional columns are toggled on.
  const columnWidthPercents = useMemo(() => {
    const weights: Record<string, number> = {
      checkbox: 3, documentId: 10, fileName: 17, folder: 7, actions: 10,
      department: 11, category: 9, owner: 11, modifiedAt: 10, tags: 6, status: 12,
    };
    const activeKeys = ['checkbox', 'documentId', 'fileName', 'folder',
      ...(['department', 'category', 'owner', 'modifiedAt', 'tags', 'status'] as const).filter((c) => visibleColumns.has(c)),
      'actions'];
    const totalWeight = activeKeys.reduce((sum, key) => sum + weights[key], 0);
    return Object.fromEntries(activeKeys.map((key) => [key, (weights[key] / totalWeight) * 100]));
  }, [visibleColumns]);

  if (isLoading) {
    return <div className="space-y-2 p-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded bg-slate-100" />)}</div>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="data-table library-document-table w-full min-w-[720px] table-fixed" aria-label="Documents">
        <colgroup>
          <col style={{ width: `${columnWidthPercents.checkbox}%` }} />
          <col style={{ width: `${columnWidthPercents.documentId}%` }} />
          <col style={{ width: `${columnWidthPercents.fileName}%` }} />
          <col style={{ width: `${columnWidthPercents.folder}%` }} />
          {visibleColumns.has('department') && <col style={{ width: `${columnWidthPercents.department}%` }} />}
          {visibleColumns.has('category') && <col style={{ width: `${columnWidthPercents.category}%` }} />}
          {visibleColumns.has('owner') && <col style={{ width: `${columnWidthPercents.owner}%` }} />}
          {visibleColumns.has('modifiedAt') && <col style={{ width: `${columnWidthPercents.modifiedAt}%` }} />}
          {visibleColumns.has('tags') && <col style={{ width: `${columnWidthPercents.tags}%` }} />}
          {visibleColumns.has('status') && <col style={{ width: `${columnWidthPercents.status}%` }} />}
          <col style={{ width: `${columnWidthPercents.actions}%` }} />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="px-3">
              <SelectionCheckbox
                checked={allVisibleSelected}
                indeterminate={selectedVisibleCount > 0 && !allVisibleSelected}
                onChange={toggleAll}
                label="Select all visible documents"
              />
            </th>
            <th>Doc ID</th>
            <th>{header('File name', 'fileName')}</th>
            <th>{header('Folder', 'folderName')}</th>
            {visibleColumns.has('department') && <th>{header('Department', 'department')}</th>}
            {visibleColumns.has('category') && <th>{header('Category', 'category')}</th>}
            {visibleColumns.has('owner') && <th>{header('Owner', 'owner')}</th>}
            {visibleColumns.has('modifiedAt') && <th>{header('Modified date', 'modifiedAt')}</th>}
            {visibleColumns.has('tags') && <th>{header('Tags', 'tags')}</th>}
            {visibleColumns.has('status') && <th>{header('Status', 'status')}</th>}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pagedDocuments.map((document, index) => (
            <tr key={document.documentId} className={`${index % 2 ? 'bg-[#f8fafc] dark:bg-slate-800/35' : 'bg-white dark:bg-slate-900'} hover:bg-[#f2f6fa] dark:hover:bg-slate-800/60`}>
              <td className="px-3">
                <SelectionCheckbox checked={selectedDocumentIds.has(document.documentId)} onChange={() => toggleSelected(document.documentId)} label={`Select ${document.fileName}`} />
              </td>
              <td className="text-[#52627a] dark:text-slate-200">
                <WrappingCellText value={document.originalDocumentId} monospace />
              </td>
              <td className="min-w-0">
                <button type="button" onClick={() => onDocumentClick(document.documentId)} className="flex w-full min-w-0 items-center gap-2 text-left" aria-label={`Open ${document.fileName}${document.description ? ` ${document.description}` : ''}`}>
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded ${extensionStyles[document.extension]}`}><FileText className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#2e4083] dark:text-slate-100" title={document.fileName}>{document.fileName}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#52627a]">{document.description}</span>
                  </span>
                </button>
              </td>
              <td className="text-[#52627a] dark:text-slate-200"><ExpandableCellText value={document.folderName} /></td>
              {visibleColumns.has('department') && <td className="text-[#52627a] dark:text-slate-200"><WrappingCellText value={document.department} /></td>}
              {visibleColumns.has('category') && <td className="text-[#52627a] dark:text-slate-200"><WrappingCellText value={document.category} /></td>}
              {visibleColumns.has('owner') && <td className="text-[#52627a] dark:text-slate-200"><WrappingCellText value={document.owner.fullName} /></td>}
              {visibleColumns.has('modifiedAt') && <td className="text-[11px] text-[#52627a]"><ExpandableCellText value={formatDateTime(document.modifiedAt)} /></td>}
              {visibleColumns.has('tags') && (
                <td>
                  {document.tags.length ? (
                    <div className="flex flex-wrap gap-1">{document.tags.map((tag) => <span key={tag} className="rounded-full bg-[#edf2f8] px-2 py-0.5 text-[11px] font-medium text-[#52627a] dark:bg-slate-800 dark:text-slate-200">{tag}</span>)}</div>
                  ) : <span className="text-[#93a4bd]">—</span>}
                </td>
              )}
              {visibleColumns.has('status') && <td><span className={`inline-block whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${statusStyles[document.status]}`}>{statusLabels[document.status]}</span></td>}
              <td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <button type="button" title="Preview file" onClick={(event) => { event.stopPropagation(); onDocumentClick(document.documentId); }} className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] bg-[#2f3e83] text-white hover:bg-[#263472] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]" aria-label={`Preview ${document.fileName}`}>
                    <Eye className="h-5 w-5" />
                  </button>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        title="More actions"
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] bg-[#f1f4f8] text-[#52627a] hover:bg-[#e7ecf2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        aria-label={`More actions for ${document.fileName}`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className={rowMenuContentClass} sideOffset={6} align="end" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu.Item className={rowMenuItemClass} onSelect={() => onDownload?.(document.documentId)}>
                          <Download className="h-4 w-4" /> Download
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className={rowMenuItemClass}
                          disabled={!canDownloadForEditing}
                          title={!canDownloadForEditing ? 'Your role does not have Download for Editing permission' : undefined}
                          onSelect={() => onDownloadForEditing?.(document.documentId)}
                        >
                          <PencilLine className="h-4 w-4" /> Download for Editing
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className={rowMenuItemClass}
                          disabled={!permissions?.edit}
                          title={!permissions?.edit ? 'Your role does not have permission to edit this' : undefined}
                          onSelect={() => onEdit?.(document.documentId)}
                        >
                          <FilePen className="h-4 w-4" /> Edit
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="my-1 h-px bg-[#e2e8f0] dark:bg-slate-800" />
                        <DropdownMenu.Item
                          className={rowMenuItemClass}
                          disabled={!permissions?.fileCopy}
                          title={!permissions?.fileCopy ? 'Your role does not have permission to copy this' : undefined}
                          onSelect={() => onDocumentAction?.('copy', document.documentId)}
                        >
                          <Copy className="h-4 w-4" /> Copy
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className={rowMenuItemClass}
                          disabled={!permissions?.fileCut}
                          title={!permissions?.fileCut ? 'Your role does not have permission to move this' : undefined}
                          onSelect={() => onDocumentAction?.('cut', document.documentId)}
                        >
                          <FolderInput className="h-4 w-4" /> Move
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className={rowMenuItemClass}
                          disabled={!permissions?.updateFile}
                          title={!permissions?.updateFile ? 'Your role does not have permission to rename this' : undefined}
                          onSelect={() => onDocumentAction?.('rename', document.documentId)}
                        >
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className={`${rowMenuItemClass} text-[#c73c44]`}
                          disabled={!permissions?.deleteFile}
                          title={!permissions?.deleteFile ? 'Your role does not have permission to delete this' : undefined}
                          onSelect={() => onDocumentAction?.('delete', document.documentId)}
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="my-1 h-px bg-[#e2e8f0] dark:bg-slate-800" />
                        <DropdownMenu.Item
                          className={rowMenuItemClass}
                          disabled={!permissions?.fileManagePermissions}
                          title={!permissions?.fileManagePermissions ? 'Your role does not have permission to manage File Permissions here' : undefined}
                          onSelect={() => onFilePermissions?.(document.documentId)}
                        >
                          <ShieldCheck className="h-4 w-4" /> File Permissions
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t border-[#e2e8f0] bg-[#f7f9fc] px-4 py-2.5 dark:border-white/10 dark:bg-slate-950">
        <p className="text-xs text-[#52627a] dark:text-slate-400">
          {sortedDocuments.length === 0
            ? 'No documents'
            : `Showing ${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, sortedDocuments.length)} of ${sortedDocuments.length}`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#52627a] dark:text-slate-400">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={currentPage <= 1}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[#52627a] hover:bg-[#edf2f8] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={currentPage >= totalPages}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[#52627a] hover:bg-[#edf2f8] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
