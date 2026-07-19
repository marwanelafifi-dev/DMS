import { useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { Zap, Loader, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

interface OcrPanelProps {
  documentId: string;
  versionId: string;
  onClose?: () => void;
}

export function OcrPanel({ documentId, versionId, onClose }: OcrPanelProps) {
  const { showSuccess, showError } = useToast();
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [ocrText, setOcrText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleTriggerOcr = async () => {
    setIsProcessing(true);
    setStatus('processing');
    try {
      await apiClient.triggerOcr(documentId, versionId);
      showSuccess('OCR processing started');
      // In a real scenario, would poll for status
      setTimeout(() => {
        setStatus('completed');
        setOcrText('OCR processing completed. Full text would appear here.');
      }, 2000);
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to trigger OCR');
      setStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGetOcrText = async () => {
    try {
      const res = await apiClient.getOcrText(documentId, versionId);
      setOcrText(res.data?.text || '');
      setStatus('completed');
    } catch (err: any) {
      showError('Failed to retrieve OCR text');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-500" />
          <h3 className="text-lg font-serif font-bold text-navy-900 dark:text-white">OCR Processing</h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <Card className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900">
        <CardBody className="flex items-start gap-3">
          <Zap className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-300">Optical Character Recognition</p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              Extract and index text from document images using advanced OCR technology. Enables full-text search across all documents.
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={handleTriggerOcr}
          disabled={isProcessing || status === 'processing'}
          className="flex-1"
        >
          {isProcessing ? 'Processing...' : 'Trigger OCR'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleGetOcrText}
          disabled={status === 'idle'}
          className="flex-1"
        >
          Get Text
        </Button>
      </div>

      {status === 'processing' && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Loader className="w-5 h-5 text-yellow-600 animate-spin flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-900 dark:text-yellow-300">Processing...</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                OCR processing is in progress. This may take a few minutes depending on document size.
              </p>
            </div>
          </div>
        </div>
      )}

      {status === 'completed' && ocrText && (
        <Card className="bg-gray-50 dark:bg-navy-950 border-green-200 dark:border-green-900">
          <div className="p-4 border-b border-gray-200 dark:border-navy-700 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <p className="font-medium text-green-900 dark:text-green-300">OCR Completed</p>
          </div>
          <div className="p-4 max-h-64 overflow-y-auto">
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {ocrText}
            </p>
          </div>
        </Card>
      )}

      {status === 'error' && (
        <Card className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
          <CardBody className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-900 dark:text-red-300">OCR Failed</p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                Unable to process the document. Please try again or contact support.
              </p>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
