import { useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Copy, Download, Eye, FileText, FolderInput, MoreVertical, Pencil, PencilLine, ShieldCheck, Trash2 } from 'lucide-react';
import type { MockLibraryDocument } from '../../fixtures/documentLibrary';
import type { RolePermissionFlags } from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';
import { statusLabels } from '../../utils/documentStatus';

const rowMenuContentClass = 'z-[95] min-w-[210px] rounded-[5px] border border-[#dbe2ec] bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900';
const rowMenuItemClass = 'flex h-9 select-none items-center gap-2 rounded-[4px] px-2.5 text-sm text-[#34425b] outline-none data-[highlighted]:bg-[#edf2f8] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800';

export type OptionalDocumentColumn = 'department' | 'owner' | 'createdAt' | 'modifiedAt' | 'tags' | 'status';

export const defaultVisibleDocumentColumns: ReadonlySet<OptionalDocumentColumn> = new Set([
  'department',
  'owner',
  'createdAt',
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
  onDocumentAction?: (action: 'copy' | 'cut' | 'rename' | 'delete', docId: string) => void;
  canDownloadForEditing?: boolean;
  // The effective permissions for the folder currently being browsed — every
  // row here belongs to that same folder, so one fetch covers all of them.
  permissions?: RolePermissionFlags | null;
}

type SortKey = 'fileName' | 'extension' | 'folderName' | 'department' | 'owner' | 'createdAt' | 'modifiedAt' | 'tags' | 'status';

const statusStyles: Record<MockLibraryDocument['status'], string> = {
  draft: 'bg-[#edf1f5] text-[#62718a]',
  pending_approval: 'bg-[#fff1c9] text-[#b96a08]',
  qa_review: 'bg-[#fff1c9] text-[#b96a08]',
  manager_review: 'bg-[#fde9c8] text-[#a15c1f]',
  correction_in_progress: 'bg-[#fde1e2] text-[#c73c44]',
  qa_final_review: 'bg-[#dbe9fb] text-[#2f6f9f]',
  released: 'bg-[#d8f5e4] text-[#27885a]',
  rejected: 'bg-[#fde1e2] text-[#c73c44]',
  archived: 'bg-slate-100 text-slate-500',
};

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
  onDocumentAction,
  canDownloadForEditing = false,
  permissions,
}: DocumentListProps) {
  const [sortBy, setSortBy] = useState<SortKey>('fileName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const sortedDocuments = useMemo(() => [...documents].sort((a, b) => {
    const values: Record<SortKey, [string | number, string | number]> = {
      fileName: [a.fileName, b.fileName],
      extension: [a.extension, b.extension],
      folderName: [a.folderName, b.folderName],
      department: [a.department, b.department],
      owner: [a.owner.fullName, b.owner.fullName],
      createdAt: [new Date(a.createdAt).getTime(), new Date(b.createdAt).getTime()],
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

  if (isLoading) {
    return <div className="space-y-2 p-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded bg-slate-100" />)}</div>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="data-table library-document-table w-full" aria-label="Documents">
        <colgroup>
          <col className="w-10" />
          <col className="w-[120px]" />
          <col />
          <col className="w-[60px]" />
          <col className="w-[76px]" />
          {visibleColumns.has('department') && <col className="w-[105px]" />}
          {visibleColumns.has('owner') && <col className="w-[100px]" />}
          {visibleColumns.has('createdAt') && <col className="w-[132px]" />}
          {visibleColumns.has('modifiedAt') && <col className="w-[132px]" />}
          {visibleColumns.has('tags') && <col className="w-[120px]" />}
          {visibleColumns.has('status') && <col className="w-[90px]" />}
          <col className="w-[96px]" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="w-10 px-3">
              <SelectionCheckbox
                checked={allVisibleSelected}
                indeterminate={selectedVisibleCount > 0 && !allVisibleSelected}
                onChange={toggleAll}
                label="Select all visible documents"
              />
            </th>
            <th>Document ID</th>
            <th>{header('File name', 'fileName')}</th>
            <th>{header('Type', 'extension')}</th>
            <th>{header('Folder', 'folderName')}</th>
            {visibleColumns.has('department') && <th>{header('Department', 'department')}</th>}
            {visibleColumns.has('owner') && <th>{header('Owner', 'owner')}</th>}
            {visibleColumns.has('createdAt') && <th>{header('Creation date', 'createdAt')}</th>}
            {visibleColumns.has('modifiedAt') && <th>{header('Modified date', 'modifiedAt')}</th>}
            {visibleColumns.has('tags') && <th>{header('Tags', 'tags')}</th>}
            {visibleColumns.has('status') && <th>{header('Status', 'status')}</th>}
            <th className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedDocuments.map((document, index) => (
            <tr key={document.documentId} className={`${index % 2 ? 'bg-[#f8fafc] dark:bg-slate-800/35' : 'bg-white dark:bg-slate-900'} hover:bg-[#f2f6fa] dark:hover:bg-slate-800/60`}>
              <td className="px-3">
                <SelectionCheckbox checked={selectedDocumentIds.has(document.documentId)} onChange={() => toggleSelected(document.documentId)} label={`Select ${document.fileName}`} />
              </td>
              <td className="whitespace-nowrap text-[#52627a] dark:text-slate-200">
                {document.originalDocumentId ? (
                  <span className="font-mono text-xs" title={document.originalDocumentId}>{document.originalDocumentId}</span>
                ) : (
                  <span className="text-[#93a4bd]">—</span>
                )}
              </td>
              <td className="min-w-0">
                <button type="button" onClick={() => onDocumentClick(document.documentId)} className="flex w-full min-w-0 items-center gap-2 text-left" aria-label={`Open ${document.fileName}`}>
                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded ${extensionStyles[document.extension]}`}><FileText className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#2e4083] dark:text-slate-100" title={document.fileName}>{document.fileName}</span>
                    <span className="mt-0.5 block truncate text-xs text-[#718198]">{document.description}</span>
                  </span>
                </button>
              </td>
              <td><span className={`rounded px-2 py-1 text-[11px] font-semibold uppercase ${extensionStyles[document.extension]}`}>{document.extension}</span></td>
              <td className="whitespace-nowrap text-[#52627a] dark:text-slate-200">{document.folderName}</td>
              {visibleColumns.has('department') && <td className="text-[#52627a] dark:text-slate-200"><span className="block max-h-10 overflow-hidden leading-5" title={document.department}>{document.department}</span></td>}
              {visibleColumns.has('owner') && <td className="truncate text-[#52627a] dark:text-slate-200" title={document.owner.fullName}>{document.owner.fullName}</td>}
              {visibleColumns.has('createdAt') && <td className="whitespace-nowrap text-[11px] text-[#718198]" title={new Date(document.createdAt).toLocaleString()}>{formatDateTime(document.createdAt)}</td>}
              {visibleColumns.has('modifiedAt') && <td className="whitespace-nowrap text-[11px] text-[#718198]" title={new Date(document.modifiedAt).toLocaleString()}>{formatDateTime(document.modifiedAt)}</td>}
              {visibleColumns.has('tags') && (
                <td>
                  {document.tags.length ? (
                    <div className="flex flex-wrap gap-1">{document.tags.map((tag) => <span key={tag} className="rounded-full bg-[#edf2f8] px-2 py-0.5 text-[11px] font-medium text-[#52627a] dark:bg-slate-800 dark:text-slate-200">{tag}</span>)}</div>
                  ) : <span className="text-[#93a4bd]">—</span>}
                </td>
              )}
              {visibleColumns.has('status') && <td><span className={`rounded px-2 py-1 text-xs font-medium ${statusStyles[document.status]}`}>{statusLabels[document.status]}</span></td>}
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
                        <DropdownMenu.Item className={rowMenuItemClass} onSelect={() => onFilePermissions?.(document.documentId)}>
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
    </div>
  );
}
