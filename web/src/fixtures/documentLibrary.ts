import type { Document, Folder, User } from '../types';

export const requiredLibraryExtensions = ['txt', 'doc', 'docx', 'xlsx', 'pptx', 'pdf', 'png'] as const;

export type RequiredLibraryFileExtension = (typeof requiredLibraryExtensions)[number];
export type LibraryFileExtension = RequiredLibraryFileExtension | 'jpg' | 'jpeg' | 'file';

type TextPreview = { kind: 'text'; content: string };
type WordPreview = { kind: 'word'; title: string; paragraphs: string[] };
type SpreadsheetPreview = { kind: 'spreadsheet'; columns: string[]; rows: string[][] };
type PresentationPreview = { kind: 'presentation'; slides: Array<{ title: string; bullets: string[] }> };
type PdfPreview = { kind: 'pdf'; url: string };
type ImagePreview = { kind: 'image'; url: string; alt: string };
type UnavailablePreview = { kind: 'unavailable'; message: string };

export type LibraryPreview = TextPreview | WordPreview | SpreadsheetPreview | PresentationPreview | PdfPreview | ImagePreview | UnavailablePreview;

export interface MockLibraryDocument extends Document {
  extension: LibraryFileExtension;
  folderName: string;
  preview: LibraryPreview;
  sourceUrl?: string;
  fallbackDownload?: {
    fileName: string;
    content: string;
  };
}

const owner: User = {
  userId: 'user-manager',
  fullName: 'A. Khaled',
  email: 'a.khaled@si-ware.com',
  role: 'Manager',
  isActive: true,
  createdAt: '2025-01-08T08:00:00.000Z',
};

export const mockLibraryFolders: Folder[] = [
  {
    folderId: 'folder-1',
    name: 'Folder 1',
    description: 'Quality and production reference documents',
    ownerId: owner.userId,
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-07-21T09:42:00.000Z',
    isArchived: false,
  },
  {
    folderId: 'folder-2',
    name: 'Folder 2',
    description: 'Security, training, and records documents',
    ownerId: owner.userId,
    createdAt: '2026-02-03T08:00:00.000Z',
    updatedAt: '2026-07-20T16:10:00.000Z',
    isArchived: false,
  },
];

function createPdfDataUrl(title: string, subtitle: string) {
  const content = [
    'BT',
    '/F1 22 Tf',
    '72 720 Td',
    `(${title}) Tj`,
    '0 -34 Td',
    '/F1 12 Tf',
    `(${subtitle}) Tj`,
    'ET',
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj',
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object) => {
    const offset = pdf.length;
    pdf += `${object}\n`;
    return offset;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return `data:application/pdf;charset=utf-8,${encodeURIComponent(pdf)}`;
}

interface DocumentSeed {
  id: string;
  folderId: 'folder-1' | 'folder-2';
  fileName: string;
  extension: RequiredLibraryFileExtension;
  fileSize: number;
  contentType: string;
  status: Document['status'];
  modifiedAt: string;
  description: string;
  preview: LibraryPreview;
}

function createDocument(seed: DocumentSeed): MockLibraryDocument {
  const folderName = mockLibraryFolders.find((folder) => folder.folderId === seed.folderId)?.name;
  if (!folderName) throw new Error(`Unknown fixture folder: ${seed.folderId}`);
  const fallbackContent = seed.preview.kind === 'text'
    ? seed.preview.content
    : seed.preview.kind === 'word'
      ? [seed.preview.title, ...seed.preview.paragraphs].join('\n\n')
      : seed.preview.kind === 'presentation'
        ? seed.preview.slides.map((slide) => `${slide.title}\n${slide.bullets.map((bullet) => `- ${bullet}`).join('\n')}`).join('\n\n')
        : undefined;

  return {
    documentId: seed.id,
    currentVersionId: `${seed.id}-v1`,
    folderId: seed.folderId,
    folderName,
    name: seed.fileName.replace(/\.[^.]+$/, ''),
    fileName: seed.fileName,
    extension: seed.extension,
    fileSize: seed.fileSize,
    contentType: seed.contentType,
    status: seed.status,
    description: seed.description,
    preview: seed.preview,
    fallbackDownload: fallbackContent ? {
      fileName: `${seed.fileName}-preview.txt`,
      content: fallbackContent,
    } : undefined,
    uploadedBy: owner.userId,
    uploadedByUser: owner,
    uploadedAt: seed.modifiedAt,
    updatedAt: seed.modifiedAt,
    checkoutStatus: 'checked_in',
    versions: [{
      versionId: `${seed.id}-v1`,
      documentId: seed.id,
      version: 1,
      versionNumber: 1,
      uploadedBy: owner.userId,
      uploadedByUser: owner,
      uploadedAt: seed.modifiedAt,
      fileSize: seed.fileSize,
    }],
  };
}

const folder1Seeds: DocumentSeed[] = [
  {
    id: 'folder-1-txt', folderId: 'folder-1', fileName: 'Production Shift Handover.txt', extension: 'txt', fileSize: 3480,
    contentType: 'text/plain', status: 'released', modifiedAt: '2026-07-21T09:42:00.000Z', description: 'Daily production handover notes',
    preview: { kind: 'text', content: 'Production Shift Handover\n\nLine 2 completed calibration without deviations.\nOpen action: verify replacement sensor stock before the next shift.\nOwner: Production Operations.' },
  },
  {
    id: 'folder-1-doc', folderId: 'folder-1', fileName: 'Supplier Audit Checklist.doc', extension: 'doc', fileSize: 184320,
    contentType: 'application/msword', status: 'pending_approval', modifiedAt: '2026-07-20T16:10:00.000Z', description: 'Legacy supplier audit checklist',
    preview: { kind: 'word', title: 'Supplier Audit Checklist', paragraphs: ['Confirm the supplier quality certificate is current.', 'Review incoming inspection records and corrective actions.', 'Record the audit outcome and required follow-up date.'] },
  },
  {
    id: 'folder-1-docx', folderId: 'folder-1', fileName: 'Quality Management Manual.docx', extension: 'docx', fileSize: 426240,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'released', modifiedAt: '2026-07-18T14:22:00.000Z', description: 'Controlled quality management manual',
    preview: { kind: 'word', title: 'Quality Management Manual', paragraphs: ['Purpose: define the quality management system used across production and laboratories.', 'Scope: applies to controlled processes, records, suppliers, and internal audits.', 'All printed copies are uncontrolled unless explicitly stamped.'] },
  },
  {
    id: 'folder-1-xlsx', folderId: 'folder-1', fileName: 'Production Metrics Q2.xlsx', extension: 'xlsx', fileSize: 96256,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', status: 'released', modifiedAt: '2026-07-17T11:05:00.000Z', description: 'Quarterly production performance metrics',
    preview: { kind: 'spreadsheet', columns: ['Metric', 'April', 'May', 'June'], rows: [['First pass yield', '98.1%', '98.6%', '98.9%'], ['Downtime', '4.2 h', '3.8 h', '3.1 h'], ['Units inspected', '12,440', '13,090', '13,520']] },
  },
  {
    id: 'folder-1-pptx', folderId: 'folder-1', fileName: 'Operations Review Q2.pptx', extension: 'pptx', fileSize: 2846720,
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', status: 'draft', modifiedAt: '2026-07-16T08:30:00.000Z', description: 'Quarterly operations review deck',
    preview: { kind: 'presentation', slides: [{ title: 'Q2 Operations Review', bullets: ['Production targets achieved', 'Calibration backlog reduced by 18%'] }, { title: 'Next Quarter Priorities', bullets: ['Automate line clearance records', 'Complete supplier requalification'] }] },
  },
  {
    id: 'folder-1-pdf', folderId: 'folder-1', fileName: 'Calibration Procedure SOP-204.pdf', extension: 'pdf', fileSize: 421888,
    contentType: 'application/pdf', status: 'released', modifiedAt: '2026-07-15T13:05:00.000Z', description: 'Approved production calibration procedure',
    preview: { kind: 'pdf', url: createPdfDataUrl('Calibration Procedure SOP-204', 'Controlled copy - view only') },
  },
  {
    id: 'folder-1-png', folderId: 'folder-1', fileName: 'si-ware-brand-reference.png', extension: 'png', fileSize: 58231,
    contentType: 'image/png', status: 'released', modifiedAt: '2026-07-14T10:40:00.000Z', description: 'Approved corporate brand reference',
    preview: { kind: 'image', url: '/images/si-ware-logo.png', alt: 'Si-Ware corporate logo reference' },
  },
];

const folder2Seeds: DocumentSeed[] = [
  {
    id: 'folder-2-txt', folderId: 'folder-2', fileName: 'Incident Response Notes.txt', extension: 'txt', fileSize: 5120,
    contentType: 'text/plain', status: 'draft', modifiedAt: '2026-07-21T08:15:00.000Z', description: 'Security incident tabletop notes',
    preview: { kind: 'text', content: 'Incident Response Tabletop\n\nScenario: suspicious authentication activity detected.\nActions: isolate affected account, preserve logs, notify the incident commander.\nOutcome: escalation path verified successfully.' },
  },
  {
    id: 'folder-2-doc', folderId: 'folder-2', fileName: 'Training Attendance Register.doc', extension: 'doc', fileSize: 147456,
    contentType: 'application/msword', status: 'archived', modifiedAt: '2026-07-19T12:45:00.000Z', description: 'Legacy training attendance register',
    preview: { kind: 'word', title: 'Training Attendance Register', paragraphs: ['Course: Controlled Document Handling', 'Department: Quality Assurance', 'Attendance verified by the training coordinator.'] },
  },
  {
    id: 'folder-2-docx', folderId: 'folder-2', fileName: 'Records Retention Schedule.docx', extension: 'docx', fileSize: 312320,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'released', modifiedAt: '2026-07-18T09:20:00.000Z', description: 'Corporate retention schedule',
    preview: { kind: 'word', title: 'Records Retention Schedule', paragraphs: ['Quality records: retain for seven years after supersession.', 'Training records: retain for the duration of employment plus three years.', 'Security logs: retain for twelve months unless placed on legal hold.'] },
  },
  {
    id: 'folder-2-xlsx', folderId: 'folder-2', fileName: 'Quality KPI Tracker.xlsx', extension: 'xlsx', fileSize: 118784,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', status: 'pending_approval', modifiedAt: '2026-07-17T15:30:00.000Z', description: 'Monthly quality KPI tracker',
    preview: { kind: 'spreadsheet', columns: ['KPI', 'Target', 'Actual', 'Trend'], rows: [['CAPA closure', '30 days', '27 days', 'Improving'], ['Audit actions overdue', '0', '2', 'Watch'], ['Training compliance', '100%', '99.2%', 'Stable']] },
  },
  {
    id: 'folder-2-pptx', folderId: 'folder-2', fileName: 'Security Awareness Briefing.pptx', extension: 'pptx', fileSize: 1974272,
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', status: 'released', modifiedAt: '2026-07-16T14:00:00.000Z', description: 'Staff security awareness briefing',
    preview: { kind: 'presentation', slides: [{ title: 'Protect Company Information', bullets: ['Use approved storage locations', 'Report suspicious requests immediately'] }, { title: 'Access Hygiene', bullets: ['Use unique credentials', 'Lock unattended workstations'] }] },
  },
  {
    id: 'folder-2-pdf', folderId: 'folder-2', fileName: 'Emergency Response Plan.pdf', extension: 'pdf', fileSize: 638976,
    contentType: 'application/pdf', status: 'released', modifiedAt: '2026-07-15T09:10:00.000Z', description: 'Approved emergency response plan',
    preview: { kind: 'pdf', url: createPdfDataUrl('Emergency Response Plan', 'Controlled copy - view only') },
  },
  {
    id: 'folder-2-png', folderId: 'folder-2', fileName: 'si-ware-brand-reference-dark.png', extension: 'png', fileSize: 61440,
    contentType: 'image/png', status: 'released', modifiedAt: '2026-07-14T08:50:00.000Z', description: 'Approved dark-background brand reference',
    preview: { kind: 'image', url: '/images/si-ware-logo-dark.png', alt: 'Si-Ware dark corporate logo reference' },
  },
];

export const mockLibraryDocuments: MockLibraryDocument[] = [
  ...folder1Seeds.map(createDocument),
  ...folder2Seeds.map(createDocument),
];

export function getMockDocumentsByFolder(folderId: string) {
  return mockLibraryDocuments.filter((document) => document.folderId === folderId);
}

export function getMockLibraryDocument(documentId: string) {
  return mockLibraryDocuments.find((document) => document.documentId === documentId);
}

export function createUnavailableLibraryDocument(source: Document, message: string): MockLibraryDocument {
  const candidateExtension = source.fileName.toLowerCase().split('.').pop() ?? 'file';
  const knownExtensions: readonly string[] = [...requiredLibraryExtensions, 'jpg', 'jpeg'];
  const extension = knownExtensions.includes(candidateExtension) ? candidateExtension as LibraryFileExtension : 'file';
  const folderName = source.folder?.name
    ?? mockLibraryFolders.find((folder) => folder.folderId === source.folderId)?.name
    ?? 'Document Library';

  return {
    ...source,
    name: source.name || source.fileName,
    fileName: source.fileName || source.name,
    fileSize: source.fileSize || 0,
    contentType: source.contentType || 'application/octet-stream',
    folderName,
    extension,
    preview: { kind: 'unavailable', message },
  };
}
