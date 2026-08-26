import type { Folder } from '../types';

// Full ancestor chain (root-first, including the folder itself) for any folder
// in the tree. Shared by the Document Library's own breadcrumb, its cross-folder
// search results, and the Document Preview header's "Folder" field — all three
// need to answer the same question ("where does this actually live?"), not just
// the bare immediate folder name. A `guard` set stops a corrupt parentFolderId
// cycle from looping forever.
export function buildFolderAncestryPath(folder: Folder, allFolders: Folder[]): Folder[] {
  const path: Folder[] = [];
  const guard = new Set<string>();
  let current: Folder | undefined = folder;
  while (current && !guard.has(current.folderId)) {
    guard.add(current.folderId);
    path.unshift(current);
    current = current.parentFolderId ? allFolders.find((f) => f.folderId === current!.parentFolderId) : undefined;
  }
  return path;
}

export function folderPathLabel(folderId: string | undefined, allFolders: Folder[]): string | undefined {
  if (!folderId) return undefined;
  const folder = allFolders.find((f) => f.folderId === folderId);
  if (!folder) return undefined;
  return buildFolderAncestryPath(folder, allFolders).map((f) => f.name).join(' / ');
}

// Same ancestry lookup as `buildFolderAncestryPath`, but starting from a plain
// folderId (what most callers actually have on hand) instead of an already-
// resolved Folder object.
export function folderAncestryById(folderId: string | undefined, allFolders: Folder[]): Folder[] {
  if (!folderId) return [];
  const folder = allFolders.find((f) => f.folderId === folderId);
  return folder ? buildFolderAncestryPath(folder, allFolders) : [];
}
