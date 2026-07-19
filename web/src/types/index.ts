// User & Auth
export interface User {
  userId: string;
  fullName: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Writer' | 'Reader' | 'QA';
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
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
  folder?: Folder;
  name: string;
  title?: string; // Alias for name
  description?: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: 'draft' | 'pending_approval' | 'released' | 'rejected' | 'archived';
  uploadedBy: string;
  uploadedByUser?: User;
  uploadedAt: string;
  createdAt?: string; // Alias for uploadedAt
  updatedAt: string;
  checkoutStatus?: 'checked_out' | 'checked_in';
  checkedOutBy?: string;
  checkedOutAt?: string;
  checkedOutExpires?: string;
  approvalStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  department?: string;
  tags?: string[];
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
  documentId: string;
  document?: Document;
  submittedBy: string;
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
  assignedTo: string;
  assignedToUser?: User;
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
export interface Reminder {
  reminderId: string;
  userId: string;
  user?: User;
  taskId?: string;
  task?: Task;
  message: string;
  description?: string; // Alias for message
  reminderType: 'task_due' | 'task_overdue' | 'approval_pending' | 'checkout_expiring';
  isRead: boolean;
  isSent?: boolean; // Alias for tracking if sent
  sentAt: string;
  dueDate?: string; // When the reminder should be sent
  readAt?: string;
  recipientId?: string;
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
