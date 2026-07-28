import { describe, expect, it } from 'vitest';
import { mockLibraryDocuments, mockLibraryFolders } from '../fixtures/documentLibrary';
import {
  copyLibraryItems,
  deleteLibraryItems,
  moveLibraryItems,
  renameLibraryItem,
} from './documentLibraryOperations';

function createState() {
  return {
    folders: mockLibraryFolders.map((folder) => ({ ...folder })),
    documents: mockLibraryDocuments.map((document) => ({ ...document, tags: [...document.tags] })),
  };
}

describe('document library local operations', () => {
  it('copies a selected folder and all of its documents into a destination', () => {
    const result = copyLibraryItems(
      createState(),
      { folderIds: new Set(['folder-1']), documentIds: new Set() },
      'folder-2',
    );

    const copiedFolder = result.folders.find((folder) => folder.name === 'Folder 1 Copy');
    expect(copiedFolder?.parentFolderId).toBe('folder-2');
    expect(result.documents.filter((document) => document.folderId === copiedFolder?.folderId)).toHaveLength(7);
  });

  it('prevents moving a folder into itself', () => {
    expect(() => moveLibraryItems(
      createState(),
      { folderIds: new Set(['folder-1']), documentIds: new Set() },
      'folder-1',
    )).toThrow(/cannot be placed inside itself/i);
  });

  it('prevents copying a folder into one of its descendants', () => {
    const state = createState();
    state.folders.push({
      ...state.folders[0],
      folderId: 'folder-1-child',
      name: 'Folder 1 Child',
      parentFolderId: 'folder-1',
    });

    expect(() => copyLibraryItems(
      state,
      { folderIds: new Set(['folder-1']), documentIds: new Set() },
      'folder-1-child',
    )).toThrow(/descendants/i);
  });

  it('deletes a selected non-empty folder and its documents', () => {
    const result = deleteLibraryItems(createState(), { folderIds: new Set(['folder-1']), documentIds: new Set() });

    expect(result.folders.some((folder) => folder.folderId === 'folder-1')).toBe(false);
    expect(result.documents.some((document) => document.folderId === 'folder-1')).toBe(false);
  });

  it('rejects invalid and duplicate names', () => {
    const state = createState();
    const selection = { folderIds: new Set<string>(), documentIds: new Set(['folder-1-txt']) };

    expect(() => renameLibraryItem(state, selection, 'Invalid?.txt')).toThrow(/invalid characters/i);
    expect(() => renameLibraryItem(state, selection, 'Quality Management Manual.docx')).toThrow(/already exists/i);
  });
});
