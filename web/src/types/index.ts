// User & Auth
export interface User {
  userId: string;
  fullName: string;
  email: string;
  role: string | null;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
  avatarUrl?: string | null;
}

// Folder
export interface Folder {
  folderId: string;
  name: string;
  description?: string;
  parentFolderId?: string;
  ownerId: string;
  owner?: User;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  children?: Folder[];
}

// Document
export interface Document {
  documentId: string;
  folderId: string;
  currentVersionId?: string;
  trackingCode?: string;
  originalDocumentId?: string | null;
  hasDocId?: boolean;
  ownerId?: string;
  owner?: User;
  folder?: Folder;
  name: string;
  title?: string; // Alias for name
  description?: string;
  fileName: string;
  fileSize: number;
  versionLabel?: string | null;
  contentType: string;
  status: 'draft' | 'pending_approval' | 'qa_review' | 'manager_review' | 'correction_in_progress' | 'qa_final_review' | 'released' | 'rejected' | 'archived';
  uploadedBy: string;
  uploadedByUser?: User;
  uploadedAt: string;
  createdAt?: string; // Alias for uploadedAt
  updatedAt: string;
  modifiedAt?: string; // Display-friendly alias for updatedAt
  checkoutStatus?: 'checked_out' | 'checked_in';
  checkedOutBy?: string;
  checkedOutByName?: string;
  checkedOutAt?: string;
  checkedOutExpires?: string;
  // Populated from the document's most recent approval batch (if any) — tells you
  // which stage of the C-Doc Workflow it's actually sitting in, since `status` above
  // only ever says the generic "pending_approval" for the whole review period.
  approvalStage?: 'qa_review' | 'manager_review' | 'final_release' | 'released' | 'rejected' | null;
  approvalStatus?: 'pending' | 'correction_requested' | 'approved' | 'rejected' | null;
  department?: string;
  category?: string;
  tags?: string[];
  versions?: DocumentVersion[];
}

// Document Version
export interface DocumentVersion {
  versionId: string;
  documentId: string;
  version: number;
  versionNumber?: number; // Alias for version
  uploadedBy: string;
  uploadedByUser?: User;
  uploadedAt: string;
  createdAt?: string; // Alias for uploadedAt
  changeNotes?: string;
  fileSize: number;
}

// Checkout
export interface Checkout {
  checkoutId: string;
  documentId: string;
  document?: Document;
  checkedOutBy: string;
  checkedOutByUser?: User;
  checkedOutAt: string;
  expiresAt: string;
  checkedInAt?: string;
  checkedInBy?: string;
}

// Approval
export interface Approval {
  approvalId: string;
  versionId?: string;
  versionNumber?: string;
  documentId: string;
  document?: Document;
  submittedBy?: string;
  submittedByUser?: User;
  submittedAt: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedByUser?: User;
  approvedAt?: string;
  rejectionReason?: string;
  comments?: string;
}

// Task
export interface Task {
  taskId: string;
  title: string;
  description?: string;
  taskType: 'correction' | 'rca' | 'audit_action';
  documentId?: string;
  document?: Document;
  // Exactly one of assignedTo / assignedToGroupId is ever set — a group
  // assignment is one shared task visible to every member.
  assignedTo?: string;
  assignedToUser?: User;
  assignedToGroupId?: string;
  assignedToGroupName?: string;
  assignedBy: string;
  assignedByUser?: User;
  status: 'open' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high' | 'critical';
  dueDate: string;
  createdAt: string;
  completedAt?: string;
  completedBy?: string;
}

// Reminder
// Mirrors ReminderService.GetUserRemindersAsync — the API has no message/isRead
// concept, only a delivery channel plus sent state.
export type ReminderChannel = 'APP' | 'EMAIL' | 'BOTH';

export interface Reminder {
  reminderId: string;
  taskId: string;
  task?: Pick<Task, 'taskId' | 'title' | 'status'>;
  recipientId?: string;
  recipient?: Pick<User, 'userId' | 'fullName' | 'email'>;
  reminderType: ReminderChannel;
  dueDate: string;
  isSent: boolean;
  sentAt?: string | null;
  createdAt: string;
}

// Folder Permission
export interface FolderPermission {
  permissionId: string;
  folderId: string;
  userId: string;
  role: 'Reader' | 'Writer' | 'Manager';
  grantedAt: string;
  grantedBy?: string;
}

// Audit Trail
export interface AuditTrail {
  logId: string;
  userId: string;
  user?: User;
  action: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

// Workflow Timeline
export interface WorkflowTimeline {
  step: number;
  action: string;
  actor: User;
  timestamp: string;
  status: 'completed' | 'pending' | 'failed';
  comments?: string;
}

// API Response
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  count?: number;
  page?: number;
  pageSize?: number;
  totalCount?: number;
  totalPages?: number;
}

// Pagination
export interface PaginationParams {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Filter
export interface FilterParams {
  status?: string;
  role?: string;
  userId?: string;
  folderId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}
