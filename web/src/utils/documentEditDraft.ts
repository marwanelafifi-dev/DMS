export interface DocumentEditDraft {
  fileNameBase: string;
  fileNameExtension: string;
  description: string;
  tags: string[];
  versionLabel: string;
  category: string;
  department: string;
  ownerId: string;
}

const ACTIVE_DOCUMENT_EDIT_KEY = 'dms.documentLibrary.activeDocumentEdit';
const DOCUMENT_EDIT_DRAFT_PREFIX = 'dms.documentLibrary.documentEditDraft.';

export function readDocumentEditDraft(documentId: string): DocumentEditDraft | null {
  try {
    const raw = window.sessionStorage.getItem(`${DOCUMENT_EDIT_DRAFT_PREFIX}${documentId}`);
    return raw ? JSON.parse(raw) as DocumentEditDraft : null;
  } catch {
    return null;
  }
}

export function writeDocumentEditDraft(documentId: string, draft: DocumentEditDraft) {
  try {
    window.sessionStorage.setItem(ACTIVE_DOCUMENT_EDIT_KEY, documentId);
    window.sessionStorage.setItem(`${DOCUMENT_EDIT_DRAFT_PREFIX}${documentId}`, JSON.stringify(draft));
  } catch {
    // The form still works when browser storage is unavailable; only draft
    // recovery across page navigation is skipped.
  }
}

export function markDocumentEditActive(documentId: string) {
  try {
    window.sessionStorage.setItem(ACTIVE_DOCUMENT_EDIT_KEY, documentId);
  } catch {
    // Draft recovery is optional when browser storage is unavailable.
  }
}

export function hasActiveDocumentEditDraft(documentId: string): boolean {
  try {
    return window.sessionStorage.getItem(ACTIVE_DOCUMENT_EDIT_KEY) === documentId;
  } catch {
    return false;
  }
}

export function clearDocumentEditDraft(documentId: string) {
  try {
    window.sessionStorage.removeItem(`${DOCUMENT_EDIT_DRAFT_PREFIX}${documentId}`);
    if (window.sessionStorage.getItem(ACTIVE_DOCUMENT_EDIT_KEY) === documentId) {
      window.sessionStorage.removeItem(ACTIVE_DOCUMENT_EDIT_KEY);
    }
  } catch {
    // Nothing to clear when browser storage is unavailable.
  }
}
