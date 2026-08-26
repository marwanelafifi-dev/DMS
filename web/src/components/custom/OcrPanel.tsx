import { useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { Zap, Loader, AlertCircle } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { doclingApi } from '../../services/doclingApi';
import { MarkdownViewer } from './MarkdownViewer';

interface OcrPanelProps {
  documentId: string;
  versionId: string;
  fileName: string;
}

// Re-runs OCR/text extraction for a document that has no cached preview — most
// often after a page reload, since the in-browser Docling parse from upload time
// only lives in component state, not the server. There is no separate .NET OCR
// pipeline; this fetches the stored file and sends it to the same private Docling
// service used at upload time through the same-origin /ocr proxy.
export function OcrPanel({ documentId, versionId, fileName }: OcrPanelProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [content, setContent] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleExtract = async () => {
    setStatus('loading');
    setErrorMessage('');
    try {
      const { blob, fileName: downloadedName } = await apiClient.getDocumentFile(documentId, versionId);
      const file = new File([blob], downloadedName || fileName, { type: blob.type });
      const result = await doclingApi.convertDocument(file);
      setContent(result.content);
      setStatus('done');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to extract text from this document');
      setStatus('error');
    }
  };

  if (status === 'done') {
    return <MarkdownViewer content={content} />;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <Zap className="mx-auto h-8 w-8 text-blue-500" />
      <div>
        <p className="font-medium text-navy-900 dark:text-white">Extract text from this document</p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Runs the local OCR/parsing service on the stored file and shows the extracted content here.
        </p>
      </div>

      {status === 'error' && (
        <Card className="border border-red-200 bg-red-50 text-left dark:border-red-900 dark:bg-red-900/20">
          <CardBody className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
            <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
          </CardBody>
        </Card>
      )}

      <Button variant="primary" onClick={handleExtract} disabled={status === 'loading'}>
        {status === 'loading' ? (
          <span className="flex items-center gap-2"><Loader className="h-4 w-4 animate-spin" /> Extracting...</span>
        ) : status === 'error' ? 'Try again' : 'Extract Text'}
      </Button>
    </div>
  );
}
