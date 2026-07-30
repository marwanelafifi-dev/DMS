import axios, { AxiosInstance, AxiosError } from 'axios';
import type { ApiResponse } from '../types';

const API_BASE = '/api';
const TOKEN_STORAGE_KEY = 'dms_session_token';

// The id of whoever is currently logged in. Many components reference this
// directly (as "my user id" for permission checks, default owner, etc.) —
// it starts empty and is populated by useAuth after a successful login/me
// call. Kept as a mutable `let` (not `const`) so those live ESM bindings
// pick up the update without every call site needing to change.
export let DEV_USER_ID = '';

export function setCurrentUserId(userId: string) {
  DEV_USER_ID = userId;
}

export function getSessionToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setSessionToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearSessionToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE,
      timeout: 30000,
    });

    // Attach the current session token fresh on every request rather than at
    // construction time, since the token doesn't exist yet when this
    // singleton is created at module load (before login).
    this.client.interceptors.request.use((config) => {
      const token = getSessionToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiResponse>) => {
        const message = error.response?.data?.error || error.message;
        console.error('API Error:', message);
        return Promise.reject(error);
      }
    );
  }

  // Auth
  async login(email: string, password: string) {
    const { data } = await this.client.post<ApiResponse>('/auth/login', { email, password });
    return data;
  }

  async getCurrentSessionUser() {
    const { data } = await this.client.get<ApiResponse>('/auth/me');
    return data;
  }

  async sendHeartbeat() {
    const { data } = await this.client.post<ApiResponse>('/auth/heartbeat');
    return data;
  }

  // Users
  async getUsers(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/users', { params });
    return data;
  }

  async getUser(userId: string) {
    const { data } = await this.client.get<ApiResponse>(`/users/${userId}`);
    return data;
  }

  async createUser(userData: any) {
    const { data } = await this.client.post<ApiResponse>('/users', userData);
    return data;
  }

  async updateUser(userId: string, userData: any) {
    const { data } = await this.client.put<ApiResponse>(`/users/${userId}`, userData);
    return data;
  }

  async deactivateUser(userId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/users/${userId}`);
    return data;
  }

  async resetPassword(userId: string, newPassword: string) {
    const { data } = await this.client.put<ApiResponse>(`/users/${userId}/reset-password`, { newPassword });
    return data;
  }

  async deleteUserPermanently(userId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/users/${userId}/permanent`);
    return data;
  }

  // Folders
  async getFolders(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/folders', { params });
    return data;
  }

  async getFolder(folderId: string) {
    const { data } = await this.client.get<ApiResponse>(`/folders/${folderId}`);
    return data;
  }

  async createFolder(folderData: any) {
    const { data } = await this.client.post<ApiResponse>('/folders', folderData);
    return data;
  }

  async updateFolder(folderId: string, folderData: any) {
    const { data } = await this.client.put<ApiResponse>(`/folders/${folderId}`, folderData);
    return data;
  }

  async deleteFolder(folderId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/folders/${folderId}`);
    return data;
  }

  // Documents
  async getDocuments(folderId?: string, params?: any) {
    const { data } = await this.client.get<ApiResponse>(
      folderId ? `/documents?folderId=${folderId}` : '/documents',
      { params }
    );
    return data;
  }

  async getDocument(documentId: string) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}`);
    return data;
  }

  async createDocument(documentData: any) {
    const { data } = await this.client.post<ApiResponse>('/documents', documentData);
    return data;
  }

  async updateDocument(documentId: string, documentData: any) {
    const { data } = await this.client.put<ApiResponse>(`/documents/${documentId}`, documentData);
    return data;
  }

  async extractDocId(documentId: string, text: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/extract-doc-id`, { text });
    return data;
  }

  async setDocId(documentId: string, originalDocumentId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/set-doc-id`, { originalDocumentId });
    return data;
  }

  async generateDocId(documentId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/generate-doc-id`, {});
    return data;
  }

  async deleteDocument(documentId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/documents/${documentId}`);
    return data;
  }

  // Document Checkout
  async checkoutDocument(documentId: string, versionId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/versions/${versionId}/checkout`);
    return data;
  }

  async checkinDocument(documentId: string, versionId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/documents/${documentId}/versions/${versionId}/checkout`);
    return data;
  }

  async getCheckoutStatus(documentId: string, versionId: string) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}/versions/${versionId}/checkout`);
    return data;
  }

  // Document Upload/Download
  async uploadDocument(documentId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const { data } = await this.client.post<ApiResponse>(
      `/documents/${documentId}/upload`,
      formData
    );
    return data;
  }

  async getDocumentFile(documentId: string, versionId: string, signal?: AbortSignal) {
    const response = await this.client.get(`/documents/${documentId}/versions/${versionId}/download`, {
      responseType: 'blob',
      signal,
    });
    const disposition = response.headers['content-disposition'] as string | undefined;
    const encodedFileName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const quotedFileName = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
    const fileName = encodedFileName ? decodeURIComponent(encodedFileName) : quotedFileName || `document-${versionId}`;
    return { blob: response.data as Blob, fileName };
  }

  async downloadDocument(documentId: string, versionId: string) {
    const { blob, fileName } = await this.getDocumentFile(documentId, versionId);
    const objectUrl = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
    return blob;
  }

  // Document Approval
  async submitForApproval(documentId: string, versionId: string, comment?: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/submit`, {
      versionId,
      comment,
    });
    return data;
  }

  async approveDocument(documentId: string, versionId: string, comment?: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/approve`, {
      versionId,
      comment,
    });
    return data;
  }

  async rejectDocument(documentId: string, versionId: string, reason: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/reject`, {
      versionId,
      reason,
    });
    return data;
  }

  async getPendingApprovals(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/documents/pending-approvals/list', { params });
    return data;
  }

  // Approval Workflow (C-Doc)
  async submitDocumentsForApproval(documentIds: string[], category: string, notes?: string) {
    const { data } = await this.client.post<ApiResponse>('/approvals/submit-batch', {
      documentIds,
      category,
      approvalNotes: notes,
    });
    return data;
  }

  async getQaReviewQueue(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/approvals/qa-review-queue', { params });
    return data;
  }

  async getManagerReviewQueue(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/approvals/manager-review-queue', { params });
    return data;
  }

  async getFinalReleaseQueue(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/approvals/final-release-queue', { params });
    return data;
  }

  async getApproval(approvalId: string) {
    const { data } = await this.client.get<ApiResponse>(`/approvals/${approvalId}`);
    return data;
  }

  async getApprovalAuditTrail(approvalId: string) {
    const { data } = await this.client.get<ApiResponse>(`/approvals/${approvalId}/audit-trail`);
    return data;
  }

  async qaAcceptApproval(approvalId: string, notes?: string) {
    const { data } = await this.client.post<ApiResponse>(`/approvals/${approvalId}/qa-accept`, {
      notes,
    });
    return data;
  }

  async qaRequestCorrection(approvalId: string, qaNotesComments: string, taskDescription: string, assignToUserId: string, dueDate: string) {
    const { data } = await this.client.post<ApiResponse>(`/approvals/${approvalId}/qa-request-correction`, {
      qaNotesComments,
      taskDescription,
      assignToUserId,
      dueDate,
    });
    return data;
  }

  async managerApprove(approvalId: string, notes?: string) {
    const { data } = await this.client.post<ApiResponse>(`/approvals/${approvalId}/manager-approve`, {
      notes,
    });
    return data;
  }

  async managerRejectWithCorrection(approvalId: string, rejectionReason: string, taskDescription: string, assignToUserId: string, dueDate: string) {
    const { data } = await this.client.post<ApiResponse>(`/approvals/${approvalId}/manager-reject-correction-task`, {
      rejectionReason,
      taskDescription,
      assignToUserId,
      dueDate,
    });
    return data;
  }

  async managerSelfCorrect(approvalId: string, file: File, rejectionReason: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('rejectionReason', rejectionReason);

    const { data } = await this.client.post<ApiResponse>(`/approvals/${approvalId}/manager-self-correct`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  }

  async generateTrackingCode(approvalId: string, deptCode?: string, category?: string) {
    const { data } = await this.client.post<ApiResponse>(`/approvals/${approvalId}/generate-tracking-code`, {
      deptCode,
      category,
    });
    return data;
  }

  async qaFinalRelease(approvalId: string, deptCode?: string, category?: string, releaseNotes?: string) {
    const { data } = await this.client.post<ApiResponse>(`/approvals/${approvalId}/qa-final-release`, {
      deptCode,
      category,
      releaseNotes,
    });
    return data;
  }

  // Tasks
  async getTasks(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/tasks', { params });
    return {
      ...data,
      data: Array.isArray(data.data) ? data.data.map(task => this.normalizeTask(task)) : data.data,
    };
  }

  async getTask(taskId: string) {
    const { data } = await this.client.get<ApiResponse>(`/tasks/${taskId}`);
    return { ...data, data: data.data ? this.normalizeTask(data.data) : data.data };
  }

  async createTask(taskData: any) {
    const { data } = await this.client.post<ApiResponse>('/tasks', taskData);
    return data;
  }

  async updateTask(taskId: string, taskData: any) {
    const { data } = await this.client.put<ApiResponse>(`/tasks/${taskId}`, taskData);
    return data;
  }

  async completeTask(taskId: string) {
    const { data } = await this.client.post<ApiResponse>(`/tasks/${taskId}/complete`, {});
    return data;
  }

  async getTasksByDocument(documentId: string) {
    const { data } = await this.client.get<ApiResponse>(`/tasks/document/${documentId}`);
    return {
      ...data,
      data: Array.isArray(data.data) ? data.data.map(task => this.normalizeTask(task)) : data.data,
    };
  }

  async getOverdueTasks() {
    const { data } = await this.client.get<ApiResponse>('/tasks/overdue/list');
    return {
      ...data,
      data: Array.isArray(data.data) ? data.data.map(task => this.normalizeTask(task)) : data.data,
    };
  }

  private normalizeTask(task: any) {
    return {
      ...task,
      assignedTo: task.assignedToId ?? task.assignedTo?.userId ?? '',
      assignedToUser: task.assignedToUser ?? task.assignedTo,
      assignedBy: task.assignedBy ?? '',
      priority: task.priority ?? task.riskSeverity ?? 'medium',
      status: task.status === 'completed' ? 'done' : task.status,
      dueDate: task.dueDate ?? '',
    };
  }

  // Reminders
  async getReminders(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/reminders', { params });
    return data;
  }

  async getPendingReminders() {
    const { data } = await this.client.get<ApiResponse>('/reminders/pending');
    return data;
  }

  async createReminder(reminderData: any) {
    const { data } = await this.client.post<ApiResponse>('/reminders', reminderData);
    return data;
  }

  // Folder Permissions
  async getFolderPermissions(folderId: string) {
    const { data } = await this.client.get<ApiResponse>(`/folderpermissions/folder/${folderId}`);
    return data;
  }

  async getUserPermissions(userId: string) {
    const { data } = await this.client.get<ApiResponse>(`/folderpermissions/user/${userId}`);
    return data;
  }

  async grantPermission(folderId: string, userId: string, role: string) {
    const { data } = await this.client.post<ApiResponse>('/folderpermissions', {
      folderId,
      userId,
      role,
    });
    return data;
  }

  async revokePermission(permissionId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/folderpermissions/${permissionId}`);
    return data;
  }

  // Groups
  async getGroups() {
    const { data } = await this.client.get<ApiResponse>('/groups');
    return data;
  }

  async getGroup(groupId: string) {
    const { data } = await this.client.get<ApiResponse>(`/groups/${groupId}`);
    return data;
  }

  async createGroup(groupData: { name: string; description?: string }) {
    const { data } = await this.client.post<ApiResponse>('/groups', groupData);
    return data;
  }

  async updateGroup(groupId: string, groupData: { name?: string; description?: string }) {
    const { data } = await this.client.put<ApiResponse>(`/groups/${groupId}`, groupData);
    return data;
  }

  async deleteGroup(groupId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/groups/${groupId}`);
    return data;
  }

  async addGroupMember(groupId: string, userId: string) {
    const { data } = await this.client.post<ApiResponse>(`/groups/${groupId}/members`, { userId });
    return data;
  }

  async removeGroupMember(groupId: string, userId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/groups/${groupId}/members/${userId}`);
    return data;
  }

  async addSubgroup(parentGroupId: string, childGroupId: string) {
    const { data } = await this.client.post<ApiResponse>(`/groups/${parentGroupId}/subgroups`, { childGroupId });
    return data;
  }

  async removeSubgroup(parentGroupId: string, childGroupId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/groups/${parentGroupId}/subgroups/${childGroupId}`);
    return data;
  }

  // Document Versions
  async getDocumentVersions(documentId: string, params?: any) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}/versions`, { params });
    return data;
  }

  async getDocumentVersion(documentId: string, versionId: string) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}/versions/${versionId}`);
    return data;
  }

  async rollbackVersion(documentId: string, versionId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/versions/${versionId}/rollback`);
    return data;
  }

  // Workflows
  async getWorkflows(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/workflows', { params });
    return data;
  }

  async getWorkflow(workflowId: string) {
    const { data } = await this.client.get<ApiResponse>(`/workflows/${workflowId}`);
    return data;
  }

  async createWorkflow(workflowData: any) {
    const { data } = await this.client.post<ApiResponse>('/workflows', workflowData);
    return data;
  }

  async updateWorkflow(workflowId: string, workflowData: any) {
    const { data } = await this.client.put<ApiResponse>(`/workflows/${workflowId}`, workflowData);
    return data;
  }

  async getWorkflowSteps(workflowId: string) {
    const { data } = await this.client.get<ApiResponse>(`/workflows/${workflowId}/steps`);
    return data;
  }

  async completeWorkflowStep(stepId: string, stepData?: any) {
    const { data } = await this.client.post<ApiResponse>(`/workflow-steps/${stepId}/complete`, stepData);
    return data;
  }

  // Search & Filtering
  async searchDocuments(query: string, params?: any) {
    const { data } = await this.client.get<ApiResponse>('/documents', {
      params: { search: query, ...params },
    });
    return data;
  }

  async advancedSearch(searchCriteria: any) {
    const { data } = await this.client.post<ApiResponse>('/documents/advanced-search', searchCriteria);
    return data;
  }

  // Bulk Operations
  async bulkApprove(documentIds: string[], comments?: string) {
    const { data } = await this.client.post<ApiResponse>('/documents/bulk-approve', {
      documentIds,
      comments,
    });
    return data;
  }

  async bulkReject(documentIds: string[], reason: string) {
    const { data } = await this.client.post<ApiResponse>('/documents/bulk-reject', {
      documentIds,
      reason,
    });
    return data;
  }

  async bulkDelete(documentIds: string[]) {
    const { data } = await this.client.post<ApiResponse>('/documents/bulk-delete', {
      documentIds,
    });
    return data;
  }

  async bulkDownload(documentIds: string[]) {
    const response = await this.client.post('/documents/bulk-download', {
      documentIds,
    }, {
      responseType: 'blob',
    });
    return response.data;
  }

  // Reports & Exports
  async exportAuditLog(format: 'csv' | 'pdf', params?: any) {
    const response = await this.client.get(`/audittrails/export`, {
      params: { ...params, format },
      responseType: 'blob',
    });
    return response.data;
  }

  async getComplianceReport(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/reports/compliance', { params });
    return data;
  }

  async getActivityReport(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/reports/activity', { params });
    return data;
  }

  // Reminders - Additional
  async deleteReminder(reminderId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/reminders/${reminderId}`);
    return data;
  }

  // Marks one reminder as sent (RemindersController: POST /reminders/{id}/send).
  async sendReminder(reminderId: string) {
    const { data } = await this.client.post<ApiResponse>(`/reminders/${reminderId}/send`);
    return data;
  }

  // Queues the Hangfire sweep over every due reminder.
  async sendDueReminders() {
    const { data } = await this.client.post<ApiResponse>('/reminders/send-due');
    return data;
  }

  // Audit
  async getAuditTrail(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/audittrails', { params });
    return data;
  }

  // Audit Calendar (ISO certification journey events shown on the Dashboard)
  async getAuditCalendarEvents() {
    const { data } = await this.client.get<ApiResponse>('/auditcalendar');
    return data;
  }

  async createAuditCalendarEvent(eventData: { title: string; phase: string; standard: string; eventDate: string; notes?: string }) {
    const { data } = await this.client.post<ApiResponse>('/auditcalendar', eventData);
    return data;
  }

  async deleteAuditCalendarEvent(eventId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/auditcalendar/${eventId}`);
    return data;
  }

  // Per-user Google Calendar sync
  async getGoogleCalendarStatus() {
    const { data } = await this.client.get<ApiResponse>('/googlecalendar/status');
    return data;
  }

  async getGoogleCalendarAuthUrl() {
    const { data } = await this.client.get<ApiResponse>('/googlecalendar/connect');
    return data;
  }

  async disconnectGoogleCalendar() {
    const { data } = await this.client.delete<ApiResponse>('/googlecalendar/disconnect');
    return data;
  }

  async syncGoogleCalendarNow() {
    const { data } = await this.client.post<ApiResponse>('/googlecalendar/sync');
    return data;
  }

  // Health
  async getHealth() {
    const { data } = await this.client.get<ApiResponse>('/health');
    return data;
  }
}

export const apiClient = new APIClient();
