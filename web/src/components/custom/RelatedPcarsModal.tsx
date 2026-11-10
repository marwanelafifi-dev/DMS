import { useEffect, useState } from 'react';
import { AlertCircle, ClipboardCheck, X } from 'lucide-react';
import { Button, Badge } from '../ui';
import { apiClient } from '../../utils/api';
import { formatDateTime } from '../../utils/formatters';
import { ModalOverlay } from '../ui/ModalOverlay';

interface RelatedPcarsModalProps {
  documentId: string;
  fileName: string;
  onClose: () => void;
}

export function RelatedPcarsModal({ documentId, fileName, onClose }: RelatedPcarsModalProps) {
  const [pcars, setPcars] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.getPcarsByDocument(documentId)
      .then((res) => setPcars(res.data || []))
      .catch((err: any) => setError(err?.response?.data?.error || 'Failed to load related PCAR findings.'))
      .finally(() => setLoading(false));
  }, [documentId]);

  return (
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0"><h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900 dark:text-white"><ClipboardCheck className="h-5 w-5" /> Related PCARs</h2><p className="truncate text-sm text-gray-500 dark:text-slate-400">Audit findings for {fileName}</p></div>
          <button onClick={onClose} aria-label="Close related PCARs" className="text-gray-500 hover:text-gray-700 dark:text-slate-400"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <div className="flex gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
          {loading ? <p className="text-sm text-gray-500 dark:text-slate-400">Loading audit findings…</p> : pcars.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No PCAR audit findings have been raised for this released file.</p> : <div className="space-y-3">{pcars.map((pcar) => <article key={pcar.taskId} className="rounded border border-gray-200 px-4 py-3 dark:border-slate-700"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold text-navy-900 dark:text-white">{pcar.title}</h3>{pcar.description && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{pcar.description}</p>}</div><Badge status={pcar.status === 'completed' ? 'success' : 'warning'} variant="outline">{pcar.status.replace('_', ' ')}</Badge></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-slate-400"><span>Assigned to: {pcar.assignedToName ?? pcar.assignedToGroupName ?? 'Unassigned'}</span>{pcar.dueDate && <span>Due: {formatDateTime(pcar.dueDate)}</span>}<span>Raised: {formatDateTime(pcar.createdAt)}</span></div></article>)}</div>}
        </div>
        <div className="flex justify-end border-t border-gray-200 px-6 py-4 dark:border-slate-700"><Button onClick={onClose} variant="secondary">Close</Button></div>
      </div>
    </ModalOverlay>
  );
}
