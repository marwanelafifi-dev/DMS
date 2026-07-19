import { useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { PenTool, CheckCircle2, Clock, X } from 'lucide-react';
import { apiClient } from '../../utils/api';
import { useToast } from '../../hooks/useToast';

interface ESignaturePanelProps {
  documentId: string;
  versionId: string;
  onClose?: () => void;
}

interface Signature {
  signatureId: string;
  signedBy: string;
  signedAt: string;
  certificationPath?: string;
}

export function ESignaturePanel({ documentId, versionId, onClose }: ESignaturePanelProps) {
  const { showSuccess, showError } = useToast();
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSignForm, setShowSignForm] = useState(false);
  const [signatureReason, setSignatureReason] = useState('');
  const [isSubmittingSignature, setIsSubmittingSignature] = useState(false);

  const handleGetSignatures = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.getSignatures(documentId, versionId);
      setSignatures(res.data || []);
    } catch (err: any) {
      showError('Failed to retrieve signatures');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSign = async () => {
    if (!signatureReason.trim()) {
      showError('Please provide a reason for signing');
      return;
    }

    setIsSubmittingSignature(true);
    try {
      await apiClient.signDocument(documentId, versionId, {
        reason: signatureReason,
      });
      showSuccess('Document signed successfully');
      setShowSignForm(false);
      setSignatureReason('');
      handleGetSignatures();
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to sign document');
    } finally {
      setIsSubmittingSignature(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PenTool className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-serif font-bold text-navy-900 dark:text-white">E-Signatures</h3>
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

      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() => setShowSignForm(!showSignForm)}
          className="flex-1"
        >
          <PenTool className="w-4 h-4 mr-2 inline" />
          Sign Document
        </Button>
        <Button
          variant="secondary"
          onClick={handleGetSignatures}
          disabled={isLoading}
          className="flex-1"
        >
          Refresh Signatures
        </Button>
      </div>

      {showSignForm && (
        <Card className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-900">
          <CardBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-navy-900 dark:text-white mb-2">
                Reason for Signing *
              </label>
              <textarea
                placeholder="e.g., Document review completed and approved..."
                value={signatureReason}
                onChange={(e) => setSignatureReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-navy-700 rounded-lg bg-white dark:bg-navy-900 text-navy-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent h-20"
              />
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 rounded p-3">
              <p className="text-xs text-blue-700 dark:text-blue-400">
                By signing this document, you certify that you have reviewed it completely and approve its content. Your digital signature will be cryptographically secured.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowSignForm(false);
                  setSignatureReason('');
                }}
                disabled={isSubmittingSignature}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSign}
                disabled={isSubmittingSignature || !signatureReason.trim()}
                className="flex-1"
              >
                {isSubmittingSignature ? 'Signing...' : 'Apply Signature'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {signatures.length === 0 && !isLoading && !showSignForm && (
        <Card className="bg-gray-50 dark:bg-navy-950">
          <CardBody>
            <div className="text-center">
              <Clock className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No signatures yet. Be the first to sign this document.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {signatures.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-navy-900 dark:text-white">
            {signatures.length} Signature{signatures.length !== 1 ? 's' : ''}
          </p>
          {signatures.map((sig) => (
            <Card key={sig.signatureId} className="bg-white dark:bg-navy-950 border-green-200 dark:border-green-900">
              <CardBody>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-navy-900 dark:text-white break-words">{sig.signedBy}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Signed on {new Date(sig.signedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                    {sig.certificationPath && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 truncate">
                        Cert: {sig.certificationPath}
                      </p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
