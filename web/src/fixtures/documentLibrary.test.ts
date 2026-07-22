import { describe, expect, it } from 'vitest';
import {
  mockLibraryDocuments,
  mockLibraryFolders,
  requiredLibraryExtensions,
} from './documentLibrary';

describe('document library mock data', () => {
  it('contains Folder 1 and Folder 2', () => {
    expect(mockLibraryFolders.map((folder) => folder.name)).toEqual(['Folder 1', 'Folder 2']);
  });

  it.each([
    ['folder-1', 'Folder 1'],
    ['folder-2', 'Folder 2'],
  ])('contains every required file type in %s', (folderId, folderName) => {
    const extensions = mockLibraryDocuments
      .filter((document) => document.folderId === folderId)
      .map((document) => document.extension)
      .sort();

    expect(extensions).toEqual([...requiredLibraryExtensions].sort());
    expect(mockLibraryDocuments.filter((document) => document.folderName === folderName)).toHaveLength(7);
  });
});
