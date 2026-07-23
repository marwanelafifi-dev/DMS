import { useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Folder, MoreVertical, Copy, FolderInput, Trash2, Pencil } from 'lucide-react';
import type { Folder as FolderType } from '../../types';

interface FolderTreeProps {
  folders: FolderType[];
  selectedFolderId?: string;
  onSelectFolder: (folderId: string) => void;
  onFolderAction?: (action: 'rename' | 'copy' | 'cut' | 'delete', folderId: string) => void;
}

const menuContentClass = 'z-[95] min-w-[150px] rounded-[5px] border border-[#dbe2ec] bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900';
const menuItemClass = 'flex h-9 select-none items-center gap-2 rounded-[4px] px-2.5 text-sm text-[#34425b] outline-none data-[highlighted]:bg-[#edf2f8] dark:text-slate-200 dark:data-[highlighted]:bg-slate-800';

export function FolderTree({
  folders,
  selectedFolderId,
  onSelectFolder,
  onFolderAction,
}: FolderTreeProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleMenuClose = () => setOpenMenuId(null);

  return (
    <aside
      className="flex w-56 flex-col gap-2 border-r border-[#dbe2ec] bg-white py-4 dark:border-white/10 dark:bg-slate-900"
      data-testid="folder-section"
      aria-labelledby="folder-section-title"
    >
      <h2 id="folder-section-title" className="px-4 text-xs font-semibold uppercase tracking-wide text-[#64748b] dark:text-white">
        Folders
      </h2>
      {folders.length > 0 ? (
        <nav className="flex flex-col gap-1 px-2">
          {folders.map((folder) => {
            const isCurrent = selectedFolderId === folder.folderId;
            return (
              <div
                key={folder.folderId}
                ref={(el) => el && menuRefs.current.set(folder.folderId, el)}
                data-folder-id={folder.folderId}
                className="group/folder relative flex items-center gap-2 rounded-[5px] px-3 py-2.5 transition-colors hover:bg-[#f0f4f8] dark:hover:bg-slate-800/50"
              >
                <button
                  type="button"
                  onClick={() => onSelectFolder(folder.folderId)}
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={folder.name}
                  className={`flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca] rounded-[4px] px-1 py-0.5 ${
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
                <DropdownMenu.Root open={openMenuId === folder.folderId} onOpenChange={(open) => setOpenMenuId(open ? folder.folderId : null)}>
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
                      <DropdownMenu.Item className={menuItemClass} onSelect={() => { onFolderAction?.('rename', folder.folderId); handleMenuClose(); }}>
                        <Pencil className="h-4 w-4" /> Rename
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={menuItemClass} onSelect={() => { onFolderAction?.('copy', folder.folderId); handleMenuClose(); }}>
                        <Copy className="h-4 w-4" /> Copy
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={menuItemClass} onSelect={() => { onFolderAction?.('cut', folder.folderId); handleMenuClose(); }}>
                        <FolderInput className="h-4 w-4" /> Cut
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className={`${menuItemClass} text-[#c73c44]`} onSelect={() => { onFolderAction?.('delete', folder.folderId); handleMenuClose(); }}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            );
          })}
        </nav>
      ) : (
        <p className="px-4 text-sm text-[#718198] dark:text-slate-400">No folders yet</p>
      )}
    </aside>
  );
}
