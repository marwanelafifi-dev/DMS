import { useEffect, useState } from 'react';
import { doclingApi, type ParsedDocument } from '../services/doclingApi';
import { matchesDmsMetadata } from '../utils/dmsMetadataSearch';
import type { Document } from '../types';

const DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 8;

// Debounced live suggestions for the OCR search box — reuses the same local
// Docling search endpoint that full search hits, fired as the user types
// instead of on submit. Also merges in DMS documents that match on metadata
// (owner, extension, department, tags, description, status...) so typing
// something like an owner's name suggests results too, not just content matches.
export function useSearchSuggestions(query: string, dmsDocuments: Document[] = []) {
  const [suggestions, setSuggestions] = useState<ParsedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const contentMatches = await doclingApi.searchDocuments(trimmed, controller.signal);
        if (controller.signal.aborted) return;

        // Some DMS records (e.g. metadata-only entries with no uploaded file
        // version yet) have an empty fileName — fall back to their
        // title/name instead of excluding them entirely.
        const matchedFileNames = new Set(contentMatches.map((doc) => doc.filename.toLowerCase()));
        const metadataMatches = dmsDocuments
          .map((doc: any) => ({ doc, displayName: doc.fileName || doc.name || doc.title }))
          .filter(({ doc, displayName }) => displayName && !matchedFileNames.has(displayName.toLowerCase()) && matchesDmsMetadata(doc, trimmed))
          .map(({ doc, displayName }, index): ParsedDocument => ({
            id: -(index + 1),
            filename: displayName,
            content: doc.description || '',
            created_at: doc.createdAt,
          }));

        setSuggestions([...contentMatches, ...metadataMatches].slice(0, MAX_SUGGESTIONS));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, dmsDocuments]);

  return { suggestions, isLoading };
}
