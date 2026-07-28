import { requiredLibraryExtensions, type LibraryFileExtension, type MockLibraryDocument } from '../fixtures/documentLibrary';
import type { Folder } from '../types';

export interface LibraryState {
  folders: Folder[];
  documents: MockLibraryDocument[];
}

export interface LibrarySelection {
  folderIds: Set<string>;
  documentIds: Set<string>;
}

let generatedId = 0;

function nextId(prefix: string) {
  generatedId += 1;
  return `${prefix}-${Date.now()}-${generatedId}`;
}

function splitExtension(name: string) {
  const match = name.match(/^(.*?)(\.[^./\\]+)$/);
  return match ? { base: match[1], extension: match[2] } : { base: name, extension: '' };
}

function uniqueName(name: string, existingNames: string[], suffix = 'Copy') {
  const normalized = new Set(existingNames.map((candidate) => candidate.toLowerCase()));
  const { base, extension } = splitExtension(name);
  let candidate = `${base} ${suffix}${extension}`;
  let index = 2;
  while (normalized.has(candidate.toLowerCase())) {
    candidate = `${base} ${suffix} ${index}${extension}`;
    index += 1;
  }
  return candidate;
}

export function getDescendantFolderIds(folders: Folder[], folderId: string): Set<string> {
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    folders.filter((folder) => folder.parentFolderId === parentId).forEach((folder) => {
      if (descendants.has(folder.folderId)) return;
      descendants.add(folder.folderId);
      visit(folder.folderId);
    });
  };
  visit(folderId);
  return descendants;
}

export function getInvalidDestinationIds(folders: Folder[], selectedFolderIds: Set<string>) {
  const invalid = new Set(selectedFolderIds);
  selectedFolderIds.forEach((folderId) => getDescendantFolderIds(folders, folderId).forEach((id) => invalid.add(id)));
  return invalid;
}

function validateDestination(folders: Folder[], selectedFolderIds: Set<string>, destinationFolderId: string) {
  if (!folders.some((folder) => folder.folderId === destinationFolderId)) throw new Error('The destination folder no longer exists.');
  if (getInvalidDestinationIds(folders, selectedFolderIds).has(destinationFolderId)) {
    throw new Error('A folder cannot be placed inside itself or one of its descendants.');
  }
}

export function copyLibraryItems(state: LibraryState, selection: LibrarySelection, destinationFolderId: string): LibraryState {
  validateDestination(state.folders, selection.folderIds, destinationFolderId);
  const destination = state.folders.find((folder) => folder.folderId === destinationFolderId)!;
  const now = new Date().toISOString();
  const folders = [...state.folders];
  const documents = [...state.documents];
  const copiedSourceFolderIds = new Set<string>();

  const copyFolderBranch = (sourceFolderId: string, newParentId: string) => {
    const source = state.folders.find((folder) => folder.folderId === sourceFolderId);
    if (!source) return;
    copiedSourceFolderIds.add(sourceFolderId);
    const siblingNames = folders.filter((folder) => folder.parentFolderId === newParentId).map((folder) => folder.name);
    const newFolderId = nextId('folder-copy');
    const copiedName = uniqueName(source.name, siblingNames);
    folders.push({ ...source, folderId: newFolderId, name: copiedName, parentFolderId: newParentId, createdAt: now, updatedAt: now, children: undefined });

    state.documents.filter((document) => document.folderId === sourceFolderId).forEach((document) => {
      const copiedFileName = uniqueName(document.fileName, documents.filter((candidate) => candidate.folderId === newFolderId).map((candidate) => candidate.fileName));
      documents.push({
        ...document,
        documentId: nextId('document-copy'),
        currentVersionId: undefined,
        folderId: newFolderId,
        folderName: copiedName,
        name: splitExtension(copiedFileName).base,
        fileName: copiedFileName,
        createdAt: now,
        modifiedAt: now,
        uploadedAt: now,
        updatedAt: now,
        tags: [...document.tags],
        versions: [],
      });
    });
    state.folders.filter((folder) => folder.parentFolderId === sourceFolderId).forEach((child) => copyFolderBranch(child.folderId, newFolderId));
  };

  selection.folderIds.forEach((folderId) => copyFolderBranch(folderId, destinationFolderId));
  selection.documentIds.forEach((documentId) => {
    const source = state.documents.find((document) => document.documentId === documentId);
    if (!source || copiedSourceFolderIds.has(source.folderId)) return;
    const copiedFileName = uniqueName(source.fileName, documents.filter((document) => document.folderId === destinationFolderId).map((document) => document.fileName));
    documents.push({
      ...source,
      documentId: nextId('document-copy'),
      currentVersionId: undefined,
      folderId: destinationFolderId,
      folderName: destination.name,
      name: splitExtension(copiedFileName).base,
      fileName: copiedFileName,
      createdAt: now,
      modifiedAt: now,
      uploadedAt: now,
      updatedAt: now,
      tags: [...source.tags],
      versions: [],
    });
  });

  return { folders, documents };
}

export function moveLibraryItems(state: LibraryState, selection: LibrarySelection, destinationFolderId: string): LibraryState {
  validateDestination(state.folders, selection.folderIds, destinationFolderId);
  const destination = state.folders.find((folder) => folder.folderId === destinationFolderId)!;
  const now = new Date().toISOString();
  const movedFolderIds = new Set(selection.folderIds);
  const folders = state.folders.map((folder) => selection.folderIds.has(folder.folderId)
    ? { ...folder, parentFolderId: destinationFolderId, updatedAt: now }
    : folder);
  const documents = state.documents.map((document) => {
    if (!selection.documentIds.has(document.documentId) || movedFolderIds.has(document.folderId)) return document;
    const peers = state.documents.filter((candidate) => candidate.folderId === destinationFolderId && candidate.documentId !== document.documentId);
    const duplicate = peers.some((candidate) => candidate.fileName.toLowerCase() === document.fileName.toLowerCase());
    const fileName = duplicate ? uniqueName(document.fileName, peers.map((candidate) => candidate.fileName), '(2)') : document.fileName;
    return {
      ...document,
      folderId: destinationFolderId,
      folderName: destination.name,
      name: splitExtension(fileName).base,
      fileName,
      modifiedAt: now,
      updatedAt: now,
    };
  });
  return { folders, documents };
}

export function deleteLibraryItems(state: LibraryState, selection: LibrarySelection): LibraryState {
  const deletedFolderIds = new Set(selection.folderIds);
  selection.folderIds.forEach((folderId) => getDescendantFolderIds(state.folders, folderId).forEach((id) => deletedFolderIds.add(id)));
  return {
    folders: state.folders.filter((folder) => !deletedFolderIds.has(folder.folderId)),
    documents: state.documents.filter((document) => !selection.documentIds.has(document.documentId) && !deletedFolderIds.has(document.folderId)),
  };
}

export function renameLibraryItem(state: LibraryState, selection: LibrarySelection, requestedName: string): LibraryState {
  if (selection.folderIds.size + selection.documentIds.size !== 1) throw new Error('Only one item can be renamed at a time.');
  const name = requestedName.trim();
  if (!name) throw new Error('Name is required.');
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(name)) throw new Error('The name contains invalid characters.');
  const now = new Date().toISOString();

  if (selection.documentIds.size === 1) {
    const documentId = [...selection.documentIds][0];
    const document = state.documents.find((candidate) => candidate.documentId === documentId);
    if (!document) throw new Error('The selected document no longer exists.');
    const duplicate = state.documents.some((candidate) => candidate.documentId !== documentId && candidate.folderId === document.folderId && candidate.fileName.toLowerCase() === name.toLowerCase());
    if (duplicate) throw new Error('A document with this name already exists in the folder.');
    const requestedExtension = splitExtension(name).extension.slice(1).toLowerCase();
    const supportedExtensions: readonly string[] = [...requiredLibraryExtensions, 'jpg', 'jpeg'];
    const extension = supportedExtensions.includes(requestedExtension) ? requestedExtension as LibraryFileExtension : 'file';
    return {
      ...state,
      documents: state.documents.map((candidate) => candidate.documentId === documentId
        ? { ...candidate, fileName: name, name: splitExtension(name).base, extension, modifiedAt: now, updatedAt: now }
        : candidate),
    };
  }

  const folderId = [...selection.folderIds][0];
  const folder = state.folders.find((candidate) => candidate.folderId === folderId);
  if (!folder) throw new Error('The selected folder no longer exists.');
  const duplicate = state.folders.some((candidate) => candidate.folderId !== folderId && candidate.parentFolderId === folder.parentFolderId && candidate.name.toLowerCase() === name.toLowerCase());
  if (duplicate) throw new Error('A folder with this name already exists here.');
  return {
    folders: state.folders.map((candidate) => candidate.folderId === folderId ? { ...candidate, name, updatedAt: now } : candidate),
    documents: state.documents.map((document) => document.folderId === folderId ? { ...document, folderName: name, modifiedAt: now, updatedAt: now } : document),
  };
}

export function selectionContainsNonEmptyFolder(state: LibraryState, selection: LibrarySelection) {
  return [...selection.folderIds].some((folderId) => {
    const relevantIds = getDescendantFolderIds(state.folders, folderId);
    relevantIds.add(folderId);
    return state.documents.some((document) => relevantIds.has(document.folderId));
  });
}
