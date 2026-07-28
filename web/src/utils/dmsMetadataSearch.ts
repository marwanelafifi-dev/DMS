import { statusLabels } from './documentStatus';

// Strips spaces/periods so "A.Khaled" matches "A. Khaled" and "AKhaled" alike —
// people type names with inconsistent spacing/punctuation far more often than
// they get file extensions or exact tags wrong.
function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s.]/g, '');
}

// Matches a DMS document against a query across every metadata field, not just
// its parsed OCR content — file name/extension, folder, department, owner,
// tags, description, tracking code, and status (both raw value and label).
// Shared by the OCR search page's results and its live-typing autocomplete.
export function matchesDmsMetadata(doc: any, query: string): boolean {
  const q = query.toLowerCase().replace(/^\./, '');
  if (!q) return false;
  const normalizedQuery = normalize(q);

  const haystacks: Array<string | undefined> = [
    doc.fileName,
    doc.extension,
    doc.department,
    doc.owner?.fullName,
    doc.folderName,
    doc.description,
    doc.trackingCode,
    doc.status,
    doc.status ? statusLabels[doc.status as keyof typeof statusLabels] : undefined,
  ];
  if (haystacks.some((value) => value && (value.toLowerCase().includes(q) || normalize(value).includes(normalizedQuery)))) return true;
  return Array.isArray(doc.tags) && doc.tags.some((tag: string) => tag.toLowerCase().includes(q) || normalize(tag).includes(normalizedQuery));
}
