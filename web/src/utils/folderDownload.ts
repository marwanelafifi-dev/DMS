import JSZip from 'jszip';
import type { Document, Folder } from '../types';
import { apiClient } from './api';

// Zips only documents with a real server-backed version (fixture/sample rows
// have no versionId to fetch). Each file is fetched through the same
// authenticated, permission-gated download endpoint used for a single-file
// download — a file the caller isn't allowed to Download is skipped rather
// than bypassing that check by reusing an already-cached preview blob.
export async function downloadFolderAsZip(
  folder: Folder,
  documents: Document[],
  folderName: string,
): Promise<{ zipped: number; skipped: number }> {
  const zip = new JSZip();
  const folderDocs = documents.filter((doc) => doc.folderId === folder.folderId && doc.currentVersionId);

  if (folderDocs.length === 0) {
    throw new Error('No documents in this folder to download');
  }

  let zipped = 0;
  let skipped = 0;

  for (const doc of folderDocs) {
    try {
      const { blob, fileName } = await apiClient.getDocumentFile(doc.documentId, doc.currentVersionId!);
      zip.file(fileName || doc.fileName, blob);
      zipped++;
    } catch (err) {
      console.warn(`Skipping ${doc.fileName} in ZIP — not permitted or unavailable:`, err);
      skipped++;
    }
  }

  if (zipped === 0) {
    throw new Error('None of the files in this folder could be downloaded');
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });

  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${folderName}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { zipped, skipped };
}

export function downloadFolderAsZipWithMetadata(
  folder: Folder,
  documents: Document[],
  folderName: string,
): Promise<{ zipped: number; skipped: number }> {
  return downloadFolderAsZip(folder, documents, folderName);
}
