import { useEffect, useState } from 'react';
import { Card, CardBody, Button } from '../ui';
import { ChevronLeft, AlertCircle } from 'lucide-react';

interface ApprovalDetailViewProps {
  approvalId: string;
  users: Array<{ userId: string; fullName: string }>;
  onClose: () => void;
  onChanged: () => void;
}

export function ApprovalDetailView({ approvalId, onClose, onChanged }: ApprovalDetailViewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isActionInProgress, setIsActionInProgress] = useState(false);

  useEffect(() => {
    // Load approval details
    setIsLoading(false);
  }, [approvalId]);

  const handleApprove = async () => {
    setIsActionInProgress(true);
    try {
      // Call appropriate approval API
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsActionInProgress(false);
    }
  };

  const handleReject = async () => {
    setIsActionInProgress(true);
    try {
      // Call appropriate rejection API
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsActionInProgress(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <h2 className="text-xl font-semibold">Approval Details</h2>
      </div>

      {error && (
        <Card className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
          <CardBody>
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 dark:text-red-300">{error}</p>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex gap-4">
            <Button
              onClick={handleApprove}
              disabled={isActionInProgress}
              className="flex-1"
            >
              Approve
            </Button>
            <Button
              onClick={handleReject}
              disabled={isActionInProgress}
              variant="secondary"
              className="flex-1"
            >
              Reject
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
