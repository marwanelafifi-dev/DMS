export interface ParsedDocument {
  id: number;
  filename: string;
  content: string;
  created_at?: string;
}

const DOCLING_API_ORIGIN = 'http://127.0.0.1:8000';

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;

  let message = `Local document parser returned ${response.status}`;
  try {
    const payload = await response.json() as { detail?: string; error?: string };
    message = payload.detail || payload.error || message;
  } catch {
    // Preserve the status-based fallback when the service returns a non-JSON error.
  }
  throw new Error(message);
}

export const doclingApi = {
  async uploadDocument(file: File): Promise<ParsedDocument> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `${DOCLING_API_ORIGIN}/api/documents/upload`,
      {
        method: 'POST',
        body: formData,
      },
    );
    return readJsonResponse<ParsedDocument>(response);
  },

  async searchDocuments(query: string, signal?: AbortSignal): Promise<ParsedDocument[]> {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(
      `${DOCLING_API_ORIGIN}/api/documents/search?${params.toString()}`,
      { signal },
    );
    return readJsonResponse<ParsedDocument[]>(response);
  },
};
