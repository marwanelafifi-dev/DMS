import { useState } from 'react';
import type { Folder } from '../../types';

interface FolderTreeProps {
  folders: Folder[];
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

  const FolderItem = ({ folder, level = 0 }: { folder: Folder; level?: number }) => {
    const hasChildren = folder.children && folder.children.length > 0;
    const isExpanded = expandedFolders.has(folder.folderId);
    const isSelected = selectedFolderId === folder.folderId;

    return (
      <div key={folder.folderId}>
        <div
          className={`flex items-center gap-2 px-3 py-2 cursor-pointer rounded transition-colors ${
            isSelected
              ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
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
              <svg
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" />
              </svg>
            </button>
          )}
          {!hasChildren && <div className="w-4" />}

          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>

          <span
            onClick={() => onSelectFolder(folder.folderId)}
            className="flex-1 text-sm font-medium truncate"
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
    <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold mb-3 text-gray-900 dark:text-gray-100">
        Folders
      </h3>
      <div className="space-y-1">
        {folders.length > 0 ? (
          folders.map((folder) => <FolderItem key={folder.folderId} folder={folder} />)
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2">
            No folders yet
          </p>
        )}
      </div>
    </div>
  );
}
