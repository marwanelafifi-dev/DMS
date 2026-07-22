import { useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import type { Folder as FolderType } from '../../types';

interface FolderTreeProps {
  folders: FolderType[];
  selectedFolderId?: string;
  onSelectFolder: (folderId: string) => void;
}

export function FolderTree({
  folders,
  selectedFolderId,
  onSelectFolder,
}: FolderTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['root'])
  );

  const toggleFolder = (folderId: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  const FolderItem = ({ folder, level = 0 }: { folder: FolderType; level?: number }) => {
    const hasChildren = folder.children && folder.children.length > 0;
    const isExpanded = expandedFolders.has(folder.folderId);
    const isSelected = selectedFolderId === folder.folderId;

    return (
      <div key={folder.folderId}>
        <div
          onClick={() => onSelectFolder(folder.folderId)}
          className={`flex cursor-pointer items-center gap-2 rounded-[4px] px-3 py-2 transition-colors ${
            isSelected
              ? 'bg-[#e8f0f8] text-[#3f8bca] dark:bg-blue-500/15 dark:text-white'
              : 'text-[#34425b] hover:bg-[#f4f7fa] dark:text-slate-300 dark:hover:bg-white/5'
          }`}
          style={{ paddingLeft: `${12 + level * 16}px` }}
        >
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(folder.folderId);
              }}
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center"
            >
              <ChevronRight
                className={`h-4 w-4 text-[#718198] transition-transform ${isExpanded ? 'rotate-90' : ''} dark:text-slate-400`}
              />
            </button>
          )}
          {!hasChildren && <div className="w-4" />}

          <Folder className="h-[18px] w-[18px] flex-shrink-0 fill-[#f4bd42] text-[#f4bd42]" />

          <span
            className="flex-1 truncate text-sm font-medium"
          >
            {folder.name}
          </span>
        </div>

        {hasChildren && isExpanded && (
          <div>
            {folder.children?.map((child) => (
              <FolderItem key={child.folderId} folder={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full rounded-[5px] border border-[#dbe2ec] bg-white p-4 dark:border-white/10 dark:bg-slate-900">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#64748b] dark:text-white">
        Folders
      </h3>
      <div className="space-y-1">
        {folders.length > 0 ? (
          folders.map((folder) => <FolderItem key={folder.folderId} folder={folder} />)
        ) : (
          <p className="text-sm text-gray-600 dark:text-navy-400 px-3 py-2">
            No folders yet
          </p>
        )}
      </div>
    </div>
  );
}
