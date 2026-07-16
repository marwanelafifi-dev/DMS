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
          className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer rounded-lg transition-all ${
            isSelected
              ? 'bg-gradient-to-r from-primary-100 to-primary-200 dark:from-primary-900/50 dark:to-primary-800/50 text-primary-700 dark:text-primary-200 border-l-4 border-primary-600 shadow-md'
              : 'hover:bg-primary-50 dark:hover:bg-primary-900/20 text-slate-700 dark:text-slate-300 border-l-4 border-transparent'
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
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''} text-navy-900 dark:text-primary-300`}
              />
            </button>
          )}
          {!hasChildren && <div className="w-4" />}

          <Folder className="w-5 h-5 flex-shrink-0 bg-gradient-to-br from-navy-900 to-primary-500" />

          <span
            onClick={() => onSelectFolder(folder.folderId)}
            className="flex-1 text-sm font-semibold truncate"
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
    <div className="w-full bg-white dark:bg-navy-800 rounded-xl border border-slate-200 dark:border-primary-900/30 p-4 shadow-xl dark:shadow-2xl">
      <h3 className="text-sm font-extrabold mb-4 text-navy-900 dark:text-primary-300 uppercase tracking-widest flex items-center gap-2">
        Folders
      </h3>
      <div className="space-y-1">
        {folders.length > 0 ? (
          folders.map((folder) => <FolderItem key={folder.folderId} folder={folder} />)
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400 px-3 py-2">
            No folders yet
          </p>
        )}
      </div>
    </div>
  );
}
