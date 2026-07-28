import type { MockLibraryDocument } from '../fixtures/documentLibrary';

export const statusLabels: Record<MockLibraryDocument['status'], string> = {
  draft: 'Draft',
  pending_approval: 'In Review',
  released: 'Released',
  rejected: 'Rejected',
  archived: 'Archived',
};
