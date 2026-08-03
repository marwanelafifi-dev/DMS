import type { MockLibraryDocument } from '../fixtures/documentLibrary';

export const statusLabels: Record<MockLibraryDocument['status'], string> = {
  draft: 'Draft',
  pending_approval: 'In Review',
  qa_review: 'QA Review',
  manager_review: 'Manager Review',
  correction_in_progress: 'Correction Needed',
  qa_final_review: 'Final Review',
  released: 'Released',
  rejected: 'Rejected',
  archived: 'Archived',
};
