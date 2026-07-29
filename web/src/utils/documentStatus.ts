import type { MockLibraryDocument } from '../fixtures/documentLibrary';

export const statusLabels: Record<MockLibraryDocument['status'], string> = {
  draft: 'Draft',
  pending_approval: 'In Review',
  qa_review: 'In Review — QA',
  manager_review: 'In Review — Manager',
  correction_in_progress: 'Correction Needed',
  qa_final_review: 'In Review — Final Release',
  released: 'Released',
  rejected: 'Rejected',
  archived: 'Archived',
};
