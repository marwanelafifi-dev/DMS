import JSZip from 'jszip';
import type { Document, Folder } from '../types';

export async function downloadFolderAsZip(
  folder: Folder,
  documents: Document[],
  folderName: string,
): Promise<void> {
  try {
    const zip = new JSZip();

    // Get all documents in this folder
    const folderDocs = documents.filter((doc) => doc.folderId === folder.folderId);

    if (folderDocs.length === 0) {
      throw new Error('No documents in this folder to download');
    }

    // Add each document to the ZIP
    for (const doc of folderDocs) {
      const sourceUrl = (doc as any).sourceUrl;
      if (sourceUrl) {
        try {
          const response = await fetch(sourceUrl);
          if (response.ok) {
            const blob = await response.blob();
            zip.file(doc.fileName, blob);
          }
        } catch (err) {
          console.warn(`Failed to download ${doc.fileName}:`, err);
          // Continue with other files
        }
      }
    }

    // Generate the ZIP file
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Create download link
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folderName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to download folder';
    throw new Error(`Failed to download folder: ${message}`);
  }
}

export function downloadFolderAsZipWithMetadata(
  folder: Folder,
  documents: Document[],
  folderName: string,
): Promise<void> {
  return downloadFolderAsZip(folder, documents, folderName);
}
