import axios, { AxiosInstance, AxiosError } from 'axios';
import type { ApiResponse } from '../types';

const API_BASE = '/api';

// Dev-only bootstrap user until Google Workspace SSO is wired up (see CLAUDE.md).
// Every protected endpoint requires X-User-Id to match an active dms_users row —
// this must match the GUID seeded in infra/db/init/003_dev_seed_admin.sql.
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';

class APIClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': DEV_USER_ID,
      },
      timeout: 30000,
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
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return data;
  }

  async downloadDocument(documentId: string, versionId: string) {
    const response = await this.client.get(`/documents/${documentId}/versions/${versionId}/download`, {
      responseType: 'blob',
    });
    return response.data;
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
    const { data } = await this.client.post<ApiResponse>(`/tasks/${taskId}/complete`);
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

  // OCR
  async triggerOcr(documentId: string, versionId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/versions/${versionId}/ocr`);
    return data;
  }

  async getOcrStatus(documentId: string, versionId: string) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}/versions/${versionId}/ocr-status`);
    return data;
  }

  async getOcrText(documentId: string, versionId: string) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}/versions/${versionId}/ocr-text`);
    return data;
  }

  // E-Signatures
  async signDocument(documentId: string, versionId: string, signatureData: any) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/versions/${versionId}/sign`, signatureData);
    return data;
  }

  async getSignatures(documentId: string, versionId: string) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}/versions/${versionId}/signatures`);
    return data;
  }

  // Search & Filtering
  async searchDocuments(query: string, params?: any) {
    const { data } = await this.client.get<ApiResponse>('/documents/search', {
      params: { ...params, q: query },
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
  async updateReminder(reminderId: string, reminderData: any) {
    const { data } = await this.client.put<ApiResponse>(`/reminders/${reminderId}`, reminderData);
    return data;
  }

  async deleteReminder(reminderId: string) {
    const { data } = await this.client.delete<ApiResponse>(`/reminders/${reminderId}`);
    return data;
  }

  async markReminderAsRead(reminderId: string) {
    const { data } = await this.client.post<ApiResponse>(`/reminders/${reminderId}/mark-read`);
    return data;
  }

  // Audit
  async getAuditTrail(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/audittrails', { params });
    return data;
  }

  // Health
  async getHealth() {
    const { data } = await this.client.get<ApiResponse>('/health');
    return data;
  }
}

export const apiClient = new APIClient();
