import { afterEach, describe, expect, it, vi } from 'vitest';
import { doclingApi } from './doclingApi';

describe('same-origin Docling API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads the original file as multipart form data to the DMS parser', async () => {
    const parsedDocument = {
      id: 12,
      filename: 'quality policy.pdf',
      content: '# Quality policy',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(parsedDocument), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['local-content'], parsedDocument.filename, {
      type: 'application/pdf',
    });

    await expect(doclingApi.uploadDocument(file)).resolves.toEqual(parsedDocument);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/ocr/api/documents/upload');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get('file')).toBe(file);
    expect(options.headers).toBeUndefined();
  });

  it('converts a stored source for preview without indexing it again', async () => {
    const convertedDocument = {
      filename: 'operations review.pptx',
      content: '# Operations review',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(convertedDocument), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['stored-content'], convertedDocument.filename, {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const controller = new AbortController();

    await expect(doclingApi.convertDocument(file, controller.signal)).resolves.toEqual(convertedDocument);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/ocr/api/documents/convert');
    expect(options.method).toBe('POST');
    expect((options.body as FormData).get('file')).toBe(file);
    expect(options.signal).toBe(controller.signal);
  });

  it('searches parsed document content with an encoded query', async () => {
    const matches = [
      {
        id: 4,
        filename: 'calibration.docx',
        content: 'Torque verification evidence',
        created_at: '2026-07-26 12:00:00',
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(matches), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(doclingApi.searchDocuments('torque & evidence')).resolves.toEqual(matches);

    expect(fetchMock).toHaveBeenCalledWith(
      '/ocr/api/documents/search?q=torque+%26+evidence',
      expect.objectContaining({ signal: undefined }),
    );
  });
});
