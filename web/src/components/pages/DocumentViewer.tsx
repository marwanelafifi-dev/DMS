import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Activity, CheckCircle2, Download, Eye, History, Lock, ShieldCheck, Unlock, X, XCircle } from 'lucide-react';
import { PDFViewer } from '../custom/PDFViewer';
import { Button, Card, CardBody } from '../ui';
import { SkeletonCard } from '../ui/Skeleton';
import { useToast } from '../../hooks/useToast';
import { apiClient } from '../../utils/api';
import { formatFileSize } from '../../utils/formatters';
import type { Document } from '../../types';

const getCurrentVersionId = (document: Document) => document.currentVersionId ?? document.versions?.[0]?.versionId;

const mockDocuments: Record<string, Document> = {
  'doc-1': {
    documentId: 'doc-1',
    folderId: 'folder-1',
    trackingCode: 'SOP-204',
    name: 'Standard Operating Procedure',
    description: 'Production Line Calibration · Rev 3',
    fileName: 'quality-procedure.pdf',
    fileSize: 412 * 1024,
    contentType: 'application/pdf',
    status: 'released',
    uploadedBy: 'user-2',
    uploadedByUser: { userId: 'user-2', fullName: 'A. Khaled', email: 'ahmed@si-ware.com', role: 'Manager', isActive: true, createdAt: '' },
    uploadedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    checkoutStatus: 'checked_in',
  },
  'doc-2': {
    documentId: 'doc-2',
    folderId: 'folder-1',
    trackingCode: 'WI-118',
    name: 'Document Control Procedure',
    fileName: 'doc-control.pdf',
    fileSize: 1536000,
    contentType: 'application/pdf',
    status: 'pending_approval',
    uploadedBy: 'user-3',
    uploadedByUser: { userId: 'user-3', fullName: 'Mohammed Anwar', email: 'mohamm@si-ware.com', role: 'Writer', isActive: true, createdAt: '' },
    uploadedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    checkoutStatus: 'checked_in',
  },
  'doc-3': {
    documentId: 'doc-3',
    folderId: 'folder-1',
    trackingCode: 'FRM-007',
    name: 'Records Management Policy',
    fileName: 'records-policy.pdf',
    fileSize: 2097152,
    contentType: 'application/pdf',
    status: 'draft',
    uploadedBy: 'user-1',
    uploadedByUser: { userId: 'user-1', fullName: 'You', email: 'you@si-ware.com', role: 'Writer', isActive: true, createdAt: '' },
    uploadedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    checkoutStatus: 'checked_in',
  },
};

interface DecisionDialogProps {
  type: 'approve' | 'reject';
  value: string;
  isSubmitting: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

function DecisionDialog({ type, value, isSubmitting, onChange, onClose, onSubmit }: DecisionDialogProps) {
  const approving = type === 'approve';
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="document-decision-title">
      <Card className="w-full max-w-md">
        <div className="flex items-center justify-between border-b border-[#e2e8f0] p-5 dark:border-white/10">
          <h2 id="document-decision-title" className="section-heading">{approving ? 'Approve Document' : 'Reject Document'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700" aria-label="Close dialog"><X className="h-5 w-5" /></button>
        </div>
        <CardBody className="space-y-4">
          <label className="block text-sm font-medium text-[#26334d] dark:text-white">
            {approving ? 'Comments' : 'Rejection Reason'} {approving ? '(optional)' : '*'}
            <textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder={approving ? 'Add approval comments...' : 'Explain why this document is being rejected...'}
              className="field-control mt-2 h-28 w-full py-3"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button variant={approving ? 'primary' : 'danger'} onClick={onSubmit} disabled={isSubmitting || (!approving && !value.trim())}>
              {isSubmitting ? `${approving ? 'Approving' : 'Rejecting'}...` : approving ? 'Approve' : 'Reject'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export function DocumentViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOperating, setIsOperating] = useState(false);
  const [decision, setDecision] = useState<{ type: 'approve' | 'reject'; value: string } | null>(null);

  const reloadDocument = async (documentId: string) => {
    const response = await apiClient.getDocument(documentId);
    if (response.data) setDocument(response.data);
  };

  useEffect(() => {
    const loadDocument = async () => {
      if (!id) {
        navigate('/documents');
        return;
      }

      setIsLoading(true);
      try {
        if (mockDocuments[id]) {
          setDocument(mockDocuments[id]);
        } else {
          const response = await apiClient.getDocument(id);
          if (!response.data) throw new Error('Document not found');
          setDocument(response.data);
        }
      } catch (error: any) {
        showError(error.response?.data?.error || error.message || 'Failed to load document');
        navigate('/documents');
      } finally {
        setIsLoading(false);
      }
    };

    loadDocument();
  }, [id, navigate, showError]);

  const requireVersionId = () => {
    if (!document) return undefined;
    const versionId = getCurrentVersionId(document);
    if (!versionId) showError('This document does not have an uploaded file version');
    return versionId;
  };

  const runAction = async (action: (documentId: string, versionId: string) => Promise<unknown>, successMessage: string) => {
    if (!document) return;
    const versionId = requireVersionId();
    if (!versionId) return;

    setIsOperating(true);
    try {
      await action(document.documentId, versionId);
      showSuccess(successMessage);
      await reloadDocument(document.documentId);
    } catch (error: any) {
      showError(error.response?.data?.error || 'Document action failed');
    } finally {
      setIsOperating(false);
    }
  };

  const handleDecision = async () => {
    if (!document || !decision) return;
    const versionId = requireVersionId();
    if (!versionId) return;

    setIsOperating(true);
    try {
      if (decision.type === 'approve') await apiClient.approveDocument(document.documentId, versionId, decision.value);
      else await apiClient.rejectDocument(document.documentId, versionId, decision.value);
      showSuccess(`Document ${decision.type === 'approve' ? 'approved' : 'rejected'}`);
      setDecision(null);
      await reloadDocument(document.documentId);
    } catch (error: any) {
      showError(error.response?.data?.error || `Failed to ${decision.type} document`);
    } finally {
      setIsOperating(false);
    }
  };

  const handleDownload = async () => {
    if (!document) return;
    const versionId = requireVersionId();
    if (!versionId) return;
    try {
      await apiClient.downloadDocument(document.documentId, versionId);
      showSuccess('Document download started');
    } catch {
      showError('Failed to download document');
    }
  };

  if (isLoading) return <div className="space-y-4"><h1 className="page-heading">Preview Canvas</h1><SkeletonCard /></div>;

  if (!document) {
    return <Card><CardBody className="py-14 text-center"><h2 className="section-heading">Document Not Found</h2><p className="mt-2 text-sm">The requested document is no longer available.</p><Button className="mt-5" onClick={() => navigate('/documents')}>Back to Documents</Button></CardBody></Card>;
  }

  const isCheckedOut = document.checkoutStatus === 'checked_out';
  const isDraft = document.status === 'draft';
  const isPending = document.status === 'pending_approval';
  const versions = document.versions?.length ? document.versions.slice(0, 4) : [{ version: 1, versionNumber: 1, uploadedAt: document.updatedAt }];

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="page-heading">Preview Canvas</h1>
          <p className="page-subtitle">{document.trackingCode || document.name} · {document.description || document.fileName}</p>
        </div>
        <div className="flex items-center gap-4 text-sm text-[#52627a]">
          <span className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-[#d8f5e4] px-3 font-medium text-[#27885a]"><Lock className="h-4 w-4" />View Only</span>
          <span className="hidden sm:inline">No download · No print · No right-click</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(300px,0.95fr)]">
        <Card className="overflow-hidden">
          <div className="relative flex min-h-[630px] items-center justify-center bg-white p-4">
            <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(45deg,#eef2f7_25%,transparent_25%),linear-gradient(-45deg,#eef2f7_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eef2f7_75%),linear-gradient(-45deg,transparent_75%,#eef2f7_75%)] [background-position:0_0,0_28px,28px_-28px,-28px_0] [background-size:56px_56px]" />
            <div className="relative h-[590px] w-full overflow-hidden rounded-[3px] bg-white/80"><PDFViewer fileUrl="" fileName={document.fileName} readOnly /></div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardBody className="p-4">
              <h2 className="section-heading flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Document Properties</h2>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ['ID', document.trackingCode || document.documentId.slice(0, 12)],
                  ['Version', String(document.versions?.[0]?.versionNumber ?? document.versions?.[0]?.version ?? '1.0')],
                  ['Status', document.status.replace('_', ' ')],
                  ['Owner', document.uploadedByUser?.fullName || 'Unknown'],
                  ['File', document.fileName],
                  ['Size', formatFileSize(document.fileSize)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4"><dt className="text-[#718198]">{label}</dt><dd className="max-w-[65%] break-words text-right font-medium capitalize text-[#26334d]">{value}</dd></div>
                ))}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-4">
              <h2 className="section-heading flex items-center gap-2"><History className="h-4 w-4" />Version History</h2>
              <div className="mt-4 space-y-3 text-sm">
                {versions.map((version, index) => (
                  <div key={index} className="flex items-center justify-between gap-3"><span className="text-[#334155]">v{Number(version.versionNumber ?? version.version).toFixed(1)} · {index === 0 ? document.status.replace('_', ' ') : 'Superseded'}</span><span className="text-xs text-[#94a3b8]">{new Date(version.uploadedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span></div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-4">
              <h2 className="section-heading flex items-center gap-2"><Activity className="h-4 w-4" />Access Log</h2>
              <div className="mt-4 space-y-3 text-sm text-[#52627a]"><div>{document.uploadedByUser?.fullName || 'Owner'} viewed · {new Date(document.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><div className="flex items-center gap-2"><Eye className="h-3.5 w-3.5" />You viewed · Just now</div></div>
            </CardBody>
          </Card>

          {(isDraft || isPending || isCheckedOut) && (
            <Card>
              <CardBody className="space-y-2 p-4">
                <h2 className="section-heading mb-3">Document Actions</h2>
                <Button variant="secondary" size="sm" onClick={handleDownload} disabled={isOperating} className="w-full" leftIcon={<Download className="h-4 w-4" />}>Download read-only</Button>
                {isDraft && !isCheckedOut && <Button variant="secondary" size="sm" onClick={() => runAction((documentId, versionId) => apiClient.checkoutDocument(documentId, versionId), 'Document locked for editing')} disabled={isOperating} className="w-full" leftIcon={<Lock className="h-4 w-4" />}>Lock for Editing</Button>}
                {isCheckedOut && <Button variant="secondary" size="sm" onClick={() => runAction((documentId, versionId) => apiClient.checkinDocument(documentId, versionId), 'Document unlocked')} disabled={isOperating} className="w-full" leftIcon={<Unlock className="h-4 w-4" />}>Unlock</Button>}
                {isDraft && <Button size="sm" onClick={() => runAction((documentId, versionId) => apiClient.submitForApproval(documentId, versionId), 'Document submitted for approval')} disabled={isOperating || isCheckedOut} className="w-full">Submit for Approval</Button>}
                {isPending && <div className="grid grid-cols-2 gap-2"><Button size="sm" onClick={() => setDecision({ type: 'approve', value: '' })} className="bg-[#399a68] hover:bg-[#2f895b]" leftIcon={<CheckCircle2 className="h-4 w-4" />}>Approve</Button><Button variant="danger" size="sm" onClick={() => setDecision({ type: 'reject', value: '' })} leftIcon={<XCircle className="h-4 w-4" />}>Reject</Button></div>}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {decision && <DecisionDialog type={decision.type} value={decision.value} isSubmitting={isOperating} onChange={(value) => setDecision({ ...decision, value })} onClose={() => setDecision(null)} onSubmit={handleDecision} />}
    </div>
  );
}
