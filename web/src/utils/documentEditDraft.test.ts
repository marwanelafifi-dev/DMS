import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDocumentEditDraft,
  hasActiveDocumentEditDraft,
  markDocumentEditActive,
  readDocumentEditDraft,
  writeDocumentEditDraft,
} from './documentEditDraft';

describe('document edit draft persistence', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('restores an active unsaved draft within the current browser tab', () => {
    markDocumentEditActive('document-1');
    expect(hasActiveDocumentEditDraft('document-1')).toBe(true);

    writeDocumentEditDraft('document-1', {
      fileNameBase: 'Unsaved title',
      fileNameExtension: '.docx',
      description: 'Unsaved description',
      tags: ['ISO 9001'],
      versionLabel: 'Rev B',
      category: 'Procedure',
      department: 'Quality',
      ownerId: 'owner-1',
    });

    expect(readDocumentEditDraft('document-1')).toMatchObject({
      fileNameBase: 'Unsaved title',
      description: 'Unsaved description',
      versionLabel: 'Rev B',
    });
  });

  it('clears the active edit and draft after Save or Cancel', () => {
    markDocumentEditActive('document-1');
    writeDocumentEditDraft('document-1', {
      fileNameBase: 'Draft', fileNameExtension: '.pdf', description: 'Draft', tags: [],
      versionLabel: '1', category: 'Policy', department: 'Quality', ownerId: 'owner-1',
    });

    clearDocumentEditDraft('document-1');

    expect(hasActiveDocumentEditDraft('document-1')).toBe(false);
    expect(readDocumentEditDraft('document-1')).toBeNull();
  });
});
