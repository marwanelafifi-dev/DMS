import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { Button, Card } from '../ui';
import { useToast } from '../../hooks/useToast';
import { apiClient } from '../../utils/api';

interface UploadedFile {
  documentId: string;
  filename: string;
  filesize: number;
  uploadedAt: string;
}

interface UploadApprovalModalProps {
  isOpen: boolean;
  files: UploadedFile[];
  // Already known category (chosen when the document was saved as a draft) —
  // when set, the category question is skipped instead of asked again.
  presetCategory?: string;
  onSubmit: (approvalId: string) => void;
  onCancel: () => void;
}

export const UploadApprovalModal: React.FC<UploadApprovalModalProps> = ({
  isOpen,
  files,
  presetCategory,
  onSubmit,
  onCancel,
}) => {
  const hasPresetCategory = Boolean(presetCategory?.trim());
  const [category, setCategory] = useState(presetCategory || '');
  const [customCategory, setCustomCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showSuccess } = useToast();

  const categories = [
    { value: 'POLICY', label: 'Policy' },
    { value: 'PROCESS', label: 'Process' },
    { value: 'STANDARD', label: 'Standard' },
    { value: 'TEMPLATE', label: 'Template' },
    { value: 'WORKING_DOCUMENT', label: 'Working Document' },
    { value: 'OTHER', label: 'Other' },
  ];

  const isOther = category === 'OTHER';
  const effectiveCategory = isOther ? customCategory.trim() : category;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!category) {
      setError('Please select a document category');
      return;
    }
    if (isOther && !customCategory.trim()) {
      setError('Please specify the category');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await apiClient.submitDocumentsForApproval(
        files.map((f) => f.documentId),
        effectiveCategory,
        notes || undefined
      );

      if (response.success) {
        showSuccess(`${files.length} document(s) submitted for approval`);
        onSubmit(response.data.approvalId);
      } else {
        setError(response.error || 'Failed to submit documents');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to submit documents');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveAsDraft = () => {
    showSuccess(`${files.length} document(s) saved as draft`);
    onCancel();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-slate-700 px-6 py-4">
          <h2 className="text-lg font-serif font-bold text-navy-900 dark:text-white">
            Review Uploaded Documents
          </h2>
          <button
            onClick={onCancel}
            className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* File List */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">
              Documents to Submit ({files.length})
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {files.map((file) => (
                <div
                  key={file.documentId}
                  className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700"
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {file.filename}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {formatFileSize(file.filesize)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Category Selection — skipped when already chosen at draft time */}
          {hasPresetCategory ? (
            <div>
              <span className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                Document Category
              </span>
              <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {presetCategory} <span className="text-xs text-gray-500 dark:text-slate-400">(chosen when this document was saved as a draft)</span>
              </p>
            </div>
          ) : (
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                Document Category <span className="text-red-500">*</span>
              </label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                disabled={isSubmitting}
              >
                <option value="">Select a category...</option>
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
              {isOther && (
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Specify the category..."
                  autoFocus
                  className="mt-2 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                  disabled={isSubmitting}
                />
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
              Approval Notes (Optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes for the approver..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Info Box */}
          <div className="p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              <strong>Next Steps:</strong> After submission, your documents will be reviewed by QA, then by a manager, and finally released with a tracking code.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-slate-700">
            <Button
              variant="secondary"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleSaveAsDraft}
              disabled={isSubmitting}
            >
              Save as Draft
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!category || (isOther && !customCategory.trim()) || isSubmitting}
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Submit {files.length} Document{files.length !== 1 ? 's' : ''} for Approval
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
