import type { MockLibraryDocument } from '../fixtures/documentLibrary';

// The single source of truth for how a document's status renders anywhere in
// the app — DocumentList, DocumentPreview, and the Documents page filter all
// import this instead of keeping their own copy, which is exactly how they
// drifted out of sync before (DocumentPreview's own copy showed "In Review —
// QA" while this one already said "QA Review" for the same status code).
// `pending_approval` itself should never actually reach the UI in practice —
// `resolveLibraryStatus` (documentLibrary.ts) always resolves a submitted
// document into one of the specific stages below before it's ever displayed;
// this entry only exists as a defensive fallback label, never a real target.
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

export const statusStyles: Record<MockLibraryDocument['status'], string> = {
  draft: 'bg-[#edf1f5] text-[#52627a]',
  pending_approval: 'bg-[#fff1c9] text-[#7a4a00]',
  qa_review: 'bg-[#fff1c9] text-[#7a4a00]',
  manager_review: 'bg-[#fde9c8] text-[#754014]',
  correction_in_progress: 'bg-[#fde1e2] text-[#9f2430]',
  qa_final_review: 'bg-[#dbe9fb] text-[#24547a]',
  released: 'bg-[#d8f5e4] text-[#17663f]',
  rejected: 'bg-[#fde1e2] text-[#9f2430]',
  archived: 'bg-slate-100 text-slate-500',
};
