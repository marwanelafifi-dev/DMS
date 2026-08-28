import type { ParsedDocument } from '../services/doclingApi';
import type { Document } from '../types';

const normalize = (value?: string | null) => (value || '').toLowerCase().trim();
const withoutExtension = (value: string) => value.replace(/\.[^/.]+$/, '');

/**
 * OCR uses a separate SQLite index, so its rows can outlive a soft- or
 * permanently-deleted DMS record. Only an active, accessible DMS document may
 * make an OCR match visible. New index rows use the stable document ID; legacy
 * rows fall back to the exact filename so existing active documents keep
 * working after deployment.
 */
export function findActiveDmsDocument(
  parsedDocument: ParsedDocument,
  dmsDocuments: Document[],
): Document | undefined {
  if (parsedDocument.document_id) {
    return dmsDocuments.find((document) => document.documentId === parsedDocument.document_id);
  }

  const filename = normalize(parsedDocument.filename);
  const name = withoutExtension(filename);
  return dmsDocuments.find((document) => {
    if (normalize(document.fileName) === filename) return true;
    return normalize(document.name ?? document.title) === name;
  });
}

export function filterActiveOcrDocuments(
  parsedDocuments: ParsedDocument[],
  dmsDocuments: Document[],
): ParsedDocument[] {
  return parsedDocuments.filter((document) => findActiveDmsDocument(document, dmsDocuments));
}
