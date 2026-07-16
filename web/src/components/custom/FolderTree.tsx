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
              ? 'bg-cyan-600 dark:bg-cyan-600 text-white dark:text-white border-l-4 border-cyan-600 shadow-md'
              : 'hover:bg-navy-700 dark:hover:bg-navy-700 text-navy-200 dark:text-navy-200 border-l-4 border-transparent'
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
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''} text-cyan-400 dark:text-cyan-400`}
              />
            </button>
          )}
          {!hasChildren && <div className="w-4" />}

          <Folder className="w-5 h-5 flex-shrink-0 text-cyan-400" />

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
    <div className="w-full bg-navy-700 dark:bg-navy-700 rounded-xl border border-navy-600 dark:border-navy-600 p-4 shadow-xl dark:shadow-2xl">
      <h3 className="text-sm font-extrabold mb-4 text-cyan-400 dark:text-cyan-400 uppercase tracking-widest flex items-center gap-2">
        Folders
      </h3>
      <div className="space-y-1">
        {folders.length > 0 ? (
          folders.map((folder) => <FolderItem key={folder.folderId} folder={folder} />)
        ) : (
          <p className="text-sm text-navy-400 dark:text-navy-400 px-3 py-2">
            No folders yet
          </p>
        )}
      </div>
    </div>
  );
}
