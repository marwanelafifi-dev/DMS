import { Folder } from 'lucide-react';
import type { Folder as FolderType } from '../../types';

interface FolderTreeProps {
  folders: FolderType[];
  selectedFolderId?: string;
  selectedFolderIds?: Set<string>;
  onSelectFolder: (folderId: string) => void;
  onToggleFolderSelection?: (folderId: string) => void;
}

export function FolderTree({
  folders,
  selectedFolderId,
  selectedFolderIds = new Set(),
  onSelectFolder,
  onToggleFolderSelection,
}: FolderTreeProps) {
  return (
    <section
      className="w-full rounded-[5px] border border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900"
      data-testid="folder-section"
      aria-labelledby="folder-section-title"
    >
      <h2 id="folder-section-title" className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#64748b] dark:text-white">
        Folders
      </h2>
      {folders.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {folders.map((folder) => {
            const isCurrent = selectedFolderId === folder.folderId;
            const isSelected = selectedFolderIds.has(folder.folderId);
            const parentFolder = folder.parentFolderId
              ? folders.find((candidate) => candidate.folderId === folder.parentFolderId)
              : undefined;
            return (
              <div
                key={folder.folderId}
                data-folder-id={folder.folderId}
                className={`flex min-w-0 items-center gap-3 rounded-[5px] border px-3 py-3 transition-colors ${
                  isCurrent
                    ? 'border-[#74a8d2] bg-[#e8f0f8] text-[#2f6f9f] dark:border-blue-400 dark:bg-blue-500/15 dark:text-white'
                    : 'border-[#dbe2ec] text-[#34425b] hover:border-[#aebdce] hover:bg-[#f8fafc] dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleFolderSelection?.(folder.folderId)}
                  aria-label={`Select ${folder.name}`}
                  className="h-4 w-4 flex-shrink-0 rounded border-slate-300 accent-[#3f8bca]"
                />
                <button
                  type="button"
                  onClick={() => onSelectFolder(folder.folderId)}
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={folder.name}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3f8bca]"
                >
                  <Folder className="h-5 w-5 flex-shrink-0 fill-[#f4bd42] text-[#f4bd42]" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{folder.name}</span>
                    <span className="block truncate text-xs font-normal text-[#718198] dark:text-slate-400">
                      {parentFolder ? `Inside ${parentFolder.name}` : 'Top level'}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-3 py-2 text-sm text-gray-600 dark:text-slate-400">No folders yet</p>
      )}
    </section>
  );
}
