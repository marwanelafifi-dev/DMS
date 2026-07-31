export interface ParsedDocument {
  id: number;
  filename: string;
  content: string;
  created_at?: string;
}

export type ConvertedDocument = Pick<ParsedDocument, 'filename' | 'content'>;

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

const HEALTH_CHECK_TIMEOUT_MS = 2500;

export const doclingApi = {
  /**
   * Cheap up-front probe for the local Docling/LibreOffice sidecar so callers can
   * skip straight to a text-based fallback with a clear message instead of waiting
   * out a multi-second conversion timeout only to fail anyway.
   */
  async isAvailable(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(`${DOCLING_API_ORIGIN}/health`, { signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  },

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

  async convertDocument(file: File, signal?: AbortSignal): Promise<ConvertedDocument> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `${DOCLING_API_ORIGIN}/api/documents/convert`,
      {
        method: 'POST',
        body: formData,
        signal,
      },
    );
    return readJsonResponse<ConvertedDocument>(response);
  },

  async convertToPdf(file: File | Blob, filename: string, signal?: AbortSignal): Promise<Blob> {
    const formData = new FormData();
    formData.append('file', file, filename);

    const response = await fetch(
      `${DOCLING_API_ORIGIN}/api/documents/convert-to-pdf`,
      {
        method: 'POST',
        body: formData,
        signal,
      },
    );

    if (!response.ok) {
      let message = `Local PDF conversion returned ${response.status}`;
      try {
        const payload = await response.json() as { detail?: string };
        message = payload.detail || message;
      } catch {
        // Preserve the status-based fallback when the service returns a non-JSON error.
      }
      throw new Error(message);
    }

    return response.blob();
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
