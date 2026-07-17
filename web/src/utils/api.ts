import axios, { AxiosInstance, AxiosError } from 'axios';
import type { ApiResponse } from '../types';

const API_BASE = 'http://localhost:8080/api';

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
  async checkoutDocument(documentId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/checkout`);
    return data;
  }

  async checkinDocument(documentId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/checkin`);
    return data;
  }

  async getCheckoutStatus(documentId: string) {
    const { data } = await this.client.get<ApiResponse>(`/documents/${documentId}/checkout-status`);
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

  async downloadDocument(documentId: string) {
    const response = await this.client.get(`/documents/${documentId}/download`, {
      responseType: 'blob',
    });
    return response.data;
  }

  // Document Approval
  async submitForApproval(documentId: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/submit`);
    return data;
  }

  async approveDocument(documentId: string, comments?: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/approve`, {
      comments,
    });
    return data;
  }

  async rejectDocument(documentId: string, reason: string) {
    const { data } = await this.client.post<ApiResponse>(`/documents/${documentId}/reject`, {
      rejectionReason: reason,
    });
    return data;
  }

  async getPendingApprovals(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/approvals/pending', { params });
    return data;
  }

  // Tasks
  async getTasks(params?: any) {
    const { data } = await this.client.get<ApiResponse>('/tasks', { params });
    return data;
  }

  async getTask(taskId: string) {
    const { data } = await this.client.get<ApiResponse>(`/tasks/${taskId}`);
    return data;
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
    const { data } = await this.client.get<ApiResponse>(`/tasks/by-document/${documentId}`);
    return data;
  }

  async getOverdueTasks() {
    const { data } = await this.client.get<ApiResponse>('/tasks/overdue');
    return data;
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
