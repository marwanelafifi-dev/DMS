import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronsDown, ChevronsUp, ChevronDown, ChevronRight, Folder, FolderPlus, MoreVertical, Copy, FolderInput, Trash2, Pencil, Download, ShieldCheck } from 'lucide-react';
import type { Folder as FolderType } from '../../types';
import type { RolePermissionFlags } from '../../utils/api';

interface FolderTreeProps {
  folders: FolderType[];
  selectedFolderId?: string;
  onSelectFolder: (folderId: string) => void;
  onFolderAction?: (action: 'rename' | 'copy' | 'cut' | 'delete' | 'download' | 'permissions', folderId: string) => void;
  onCreateFolder?: (parentFolderId: string | null) => void;
  // Looked up per folder, since each one's overrides can differ from the
  // folder currently being browsed. `undefined` means "not loaded yet" — the
  // menu treats that the same as "no permission" until it resolves, so a
  // button is never enabled before we actually know it's allowed.
  getFolderPermissions?: (folderId: string) => RolePermissionFlags | null | undefined;
  onRequestFolderPermissions?: (folderId: string) => void;
  // Desktop-only panel width in px, driven by the draggable divider in Documents.
  // Applied as a CSS custom property rather than an inline `width` so the mobile
  // layout (a full-width strip above the table) is unaffected.
  widthPx?: number;
}

const menuContentClass = 'z-[95] min-w-[150px] rounded-[5px] border border-[#dbe2ec] bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900';
const menuItemClass = 'flex h-9 select-none items-center gap-2 rounded-[4px] px-2.5 text-sm text-[#34425b] outline-none data-[highlighted]:bg-[#edf2f8] data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 dark:text-slate-200 dark:data-[highlighted]:bg-slate-800';

export function FolderTree({
  folders,
  selectedFolderId,
  onSelectFolder,
  onFolderAction,
  onCreateFolder,
  getFolderPermissions,
  onRequestFolderPermissions,
  widthPx,
}: FolderTreeProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Folders are expanded by default (so a newly created/copied subfolder is
  // immediately visible); track only which ones the user manually collapsed.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const menuRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleMenuClose = () => setOpenMenuId(null);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, FolderType[]>();
    for (const folder of folders) {
      if (!folder.parentFolderId) continue;
      const siblings = map.get(folder.parentFolderId) ?? [];
      siblings.push(folder);
      map.set(folder.parentFolderId, siblings);
    }
    return map;
  }, [folders]);

  const rootFolders = useMemo(
    () => folders.filter((f) => !f.parentFolderId || !folders.some((p) => p.folderId === f.parentFolderId)),
    [folders],
  );

  // Whenever the selection changes, re-expand every ancestor of the selected
  // folder so it's always visible instead of hidden inside a collapsed parent.
  useEffect(() => {
    if (!selectedFolderId) return;
    const ancestors = new Set<string>();
    let current = folders.find((f) => f.folderId === selectedFolderId);
    while (current?.parentFolderId) {
      ancestors.add(current.parentFolderId);
      current = folders.find((f) => f.folderId === current!.parentFolderId);
    }
    if (ancestors.size > 0) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        ancestors.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [selectedFolderId, folders]);

  const toggleExpanded = (folderId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const expandAll = () => setCollapsedIds(new Set());
  const collapseAll = () => setCollapsedIds(new Set(childrenByParent.keys()));

  const renderFolder = (folder: FolderType, depth: number) => {
    const isCurrent = selectedFolderId === folder.folderId;
    const children = childrenByParent.get(folder.folderId) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = !collapsedIds.has(folder.folderId);
    const permissions = getFolderPermissions?.(folder.folderId);
    const isRoot = !folder.parentFolderId;
    const canCreateSubfolder = Boolean(permissions?.createSubfolder);
    const canDownloadZip = Boolean(permissions?.downloadZip);
    const canRename = Boolean(permissions?.updateFolder);
    const canCopy = Boolean(permissions?.copy);
    const canCut = Boolean(permissions?.cut);
    const canDelete = Boolean(isRoot ? permissions?.deleteParentFolder : permissions?.deleteSubfolder);
    const canManagePermissions = Boolean(permissions?.managePermissions);
    const deniedTitle = 'Your role does not have permission to do this';

    return (
      <div key={folder.folderId}>
        <div
          ref={(el) => el && menuRefs.current.set(folder.folderId, el)}
          data-folder-id={folder.folderId}
          style={{ paddingLeft: `${depth * 16}px` }}
          className="group/folder relative flex items-center gap-1 rounded-[5px] py-1 pr-2 transition-colors hover:bg-[#f0f4f8] dark:hover:bg-slate-800/50"
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleExpanded(folder.folderId)}
            aria-label={hasChildren ? (isExpanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`) : undefined}
            className={`flex h-6 w-5 flex-shrink-0 items-center justify-center text-[#94a3b8] ${hasChildren ? 'hover:text-[#3f8bca]' : 'invisible'}`}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            // Clicking the name both opens the folder and toggles its children,
            // so reaching a subfolder no longer requires precisely hitting the
            // small chevron first — the chevron still works on its own for
            // expanding without changing which folder is being browsed.
            onClick={() => {
              onSelectFolder(folder.folderId);
              if (hasChildren) toggleExpanded(folder.folderId);
            }}
            aria-current={isCurrent ? 'page' : undefined}
            aria-label={folder.name}
            className={`flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] rounded-[4px] px-1 py-1.5 ${
              isCurrent
                ? 'text-[#2f6f9f] dark:text-white'
                : 'text-[#34425b] dark:text-slate-300'
            }`}
          >
            <Folder className={`h-4 w-4 flex-shrink-0 ${
              isCurrent
                ? 'fill-[#f4bd42] text-[#f4bd42]'
                : 'fill-[#cbd5e3] text-[#cbd5e3] dark:fill-slate-600 dark:text-slate-600'
            }`} />
            <span className="min-w-0 truncate text-sm font-medium">{folder.name}</span>
          </button>
          <DropdownMenu.Root
            open={openMenuId === folder.folderId}
            onOpenChange={(open) => {
              setOpenMenuId(open ? folder.folderId : null);
              if (open) onRequestFolderPermissions?.(folder.folderId);
            }}
          >
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label={`Actions for ${folder.name}`}
                title={`Actions for ${folder.name}`}
                className="flex-shrink-0 rounded p-1 text-[#64748b] hover:bg-[#e2e8f0] dark:text-slate-400 dark:hover:bg-slate-700"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className={menuContentClass} sideOffset={6} align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenu.Item
                  className={menuItemClass}
                  disabled={!canCreateSubfolder}
                  title={!canCreateSubfolder ? deniedTitle : undefined}
                  onSelect={() => { onCreateFolder?.(folder.folderId); handleMenuClose(); }}
                >
                  <FolderPlus className="h-4 w-4" /> New Subfolder
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={menuItemClass}
                  disabled={!canDownloadZip}
                  title={!canDownloadZip ? deniedTitle : undefined}
                  onSelect={() => { onFolderAction?.('download', folder.folderId); handleMenuClose(); }}
                >
                  <Download className="h-4 w-4" /> Download as ZIP
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-[#dbe2ec] dark:bg-slate-700" />
                <DropdownMenu.Item
                  className={menuItemClass}
                  disabled={!canRename}
                  title={!canRename ? deniedTitle : undefined}
                  onSelect={() => { onFolderAction?.('rename', folder.folderId); handleMenuClose(); }}
                >
                  <Pencil className="h-4 w-4" /> Rename
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={menuItemClass}
                  disabled={!canCopy}
                  title={!canCopy ? deniedTitle : undefined}
                  onSelect={() => { onFolderAction?.('copy', folder.folderId); handleMenuClose(); }}
                >
                  <Copy className="h-4 w-4" /> Copy
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={menuItemClass}
                  disabled={!canCut}
                  title={!canCut ? deniedTitle : undefined}
                  onSelect={() => { onFolderAction?.('cut', folder.folderId); handleMenuClose(); }}
                >
                  <FolderInput className="h-4 w-4" /> Cut
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={`${menuItemClass} text-[#c73c44]`}
                  disabled={!canDelete}
                  title={!canDelete ? deniedTitle : undefined}
                  onSelect={() => { onFolderAction?.('delete', folder.folderId); handleMenuClose(); }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-[#dbe2ec] dark:bg-slate-700" />
                <DropdownMenu.Item
                  className={menuItemClass}
                  disabled={!canManagePermissions}
                  title={!canManagePermissions ? deniedTitle : undefined}
                  onSelect={() => { onFolderAction?.('permissions', folder.folderId); handleMenuClose(); }}
                >
                  <ShieldCheck className="h-4 w-4" /> Folder Permissions
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {children.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className="flex max-h-56 w-full flex-shrink-0 flex-col gap-2 overflow-y-auto border-b border-[#dbe2ec] bg-white py-3 dark:border-white/10 dark:bg-slate-900 md:max-h-none md:w-[var(--dms-folder-pane-width,14rem)] md:border-b-0 md:border-r md:py-4"
      style={widthPx ? ({ '--dms-folder-pane-width': `${widthPx}px` } as CSSProperties) : undefined}
      data-testid="folder-section"
      aria-labelledby="folder-section-title"
    >
      <div className="flex items-center justify-between px-4">
        <h2 id="folder-section-title" className="text-xs font-semibold uppercase tracking-wide text-[#64748b] dark:text-white">
          Folders
        </h2>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={expandAll} aria-label="Expand all folders" title="Expand All" disabled={folders.length === 0} className="rounded p-1 text-[#64748b] hover:bg-[#eef6fd] disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            <ChevronsDown className="h-4 w-4" />
          </button>
          <button type="button" onClick={collapseAll} aria-label="Collapse all folders" title="Collapse All" disabled={childrenByParent.size === 0} className="rounded p-1 text-[#64748b] hover:bg-[#eef6fd] disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800">
            <ChevronsUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onCreateFolder?.(null)}
            aria-label="New folder"
            title="New folder"
            className="rounded p-1 text-[#3f8bca] hover:bg-[#eef6fd] dark:text-[#7dd3fc] dark:hover:bg-slate-800"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
      </div>
      {folders.length > 0 ? (
        <nav className="flex flex-col gap-0.5 px-2">
          {rootFolders.map((folder) => renderFolder(folder, 0))}
        </nav>
      ) : (
        <p className="px-4 text-sm text-[#718198] dark:text-slate-400">No folders yet</p>
      )}
    </aside>
  );
}
