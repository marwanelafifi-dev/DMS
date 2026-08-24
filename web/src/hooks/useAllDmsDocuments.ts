import { useEffect, useState } from 'react';
import { apiClient } from '../utils/api';
import { mockLibraryDocuments, resolveLibraryStatus } from '../fixtures/documentLibrary';
import type { Document } from '../types';

// Loads every DMS document (both the fixture library docs used for demo
// previews AND real documents from the .NET backend) so features like OCR
// search and its autocomplete can match on full metadata — owner, extension,
// department, tags, description, status — not just parsed OCR content.
//
// Folders/users are used only to enrich real documents with a friendly folder
// name and owner; if either of those calls fails independently, real
// documents still show up (just with whatever raw data they already carry)
// instead of the whole feature silently degrading to fixture-only data.
export function useAllDmsDocuments(enabled = true) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return undefined;
    }

    let cancelled = false;
    setIsLoading(true);

    const load = async () => {
      const [documentsResult, foldersResult, usersResult] = await Promise.allSettled([
        apiClient.getDocuments(),
        apiClient.getFolders(),
        apiClient.getUsers(),
      ]);
      if (cancelled) return;

      if (documentsResult.status === 'rejected') {
        console.error('Failed to load DMS documents:', documentsResult.reason);
        setDocuments(mockLibraryDocuments as Document[]);
        setIsLoading(false);
        return;
      }

      const folderNameById = new Map(
        (foldersResult.status === 'fulfilled' ? foldersResult.value.data || [] : [])
          .map((folder: any) => [folder.folderId, folder.name]),
      );
      const userById = new Map(
        (usersResult.status === 'fulfilled' ? usersResult.value.data || [] : [])
          .map((user: any) => [user.userId, user]),
      );

      const enrichedRealDocuments = (documentsResult.value.data || []).map((doc: any) => {
        const enriched = {
          ...doc,
          folderName: folderNameById.get(doc.folderId) || doc.folderName,
          extension: doc.fileName?.split('.').pop()?.toLowerCase() || doc.extension,
          owner: userById.get(doc.ownerId) || doc.owner,
          modifiedAt: doc.modifiedAt || doc.updatedAt,
        };
        // Resolve the API's generic "pending_approval" into the actual C-Doc
        // Workflow stage (QA Review / Manager Review / Correction Needed /
        // Final Review) — same resolution Documents.tsx already applies, so
        // this page doesn't show a raw, meaningless "pending approval" status.
        return { ...enriched, status: resolveLibraryStatus(enriched) };
      });

      setDocuments([...(mockLibraryDocuments as Document[]), ...enrichedRealDocuments]);
      setIsLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [enabled]);

  return { documents, isLoading };
}
