import type { Task, Approval, Document } from '../types';

export interface AuditCalendarEvent {
  id: string;
  title: string;
  phase: string;
  standard: string;
  eventDate: string | Date;
  notes?: string;
  createdBy?: string;
}

const GOOGLE_CALENDAR_ID = 'primary';

export interface SyncResult {
  success: boolean;
  message: string;
  eventsCreated?: number;
  error?: string;
}

async function getGoogleAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Google API not available'));
      return;
    }

    const scope = 'https://www.googleapis.com/auth/calendar';
    const clientId = (globalThis as any).VITE_GOOGLE_CLIENT_ID || '';

    if (!clientId) {
      reject(new Error('Google Client ID not configured'));
      return;
    }

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', `${window.location.origin}/auth/google-callback`);
    authUrl.searchParams.append('response_type', 'token');
    authUrl.searchParams.append('scope', scope);

    const authWindow = window.open(authUrl.toString(), 'google-auth', 'width=500,height=600');

    const checkAuth = setInterval(() => {
      try {
        if (authWindow?.closed) {
          clearInterval(checkAuth);
          reject(new Error('Authentication window closed'));
        }
      } catch (e) {
        // Cross-origin check
      }
    }, 1000);

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data.type === 'google-auth-token') {
        clearInterval(checkAuth);
        authWindow?.close();
        resolve(event.data.token);
      }
    }, { once: true });
  });
}

async function createCalendarEvent(
  token: string,
  title: string,
  description: string,
  startTime: Date,
  endTime?: Date,
): Promise<{ id: string; htmlLink: string }> {
  const event = {
    summary: title,
    description,
    start: {
      dateTime: startTime.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    end: {
      dateTime: (endTime || new Date(startTime.getTime() + 60 * 60 * 1000)).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${GOOGLE_CALENDAR_ID}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to create calendar event: ${response.statusText}`);
  }

  return response.json() as Promise<{ id: string; htmlLink: string }>;
}

export const googleCalendarSync = {
  async syncTasks(tasks: Task[], token?: string): Promise<SyncResult> {
    try {
      const authToken = token || await getGoogleAuthToken();
      let eventsCreated = 0;

      for (const task of tasks) {
        if (!task.dueDate) continue;

        try {
          await createCalendarEvent(
            authToken,
            `Task: ${task.title}`,
            `${task.description || ''}\n\nTask ID: ${task.taskId}`,
            new Date(task.dueDate),
            new Date(new Date(task.dueDate).getTime() + 60 * 60 * 1000),
          );
          eventsCreated += 1;
        } catch (err) {
          console.error(`Failed to sync task ${task.taskId}:`, err);
        }
      }

      return {
        success: true,
        message: `Successfully synced ${eventsCreated} task(s) to Google Calendar`,
        eventsCreated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync tasks';
      return {
        success: false,
        message: 'Failed to sync tasks to Google Calendar',
        error: message,
      };
    }
  },

  async syncApprovals(approvals: Approval[], token?: string): Promise<SyncResult> {
    try {
      const authToken = token || await getGoogleAuthToken();
      let eventsCreated = 0;

      for (const approval of approvals) {
        try {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 7); // Default 7 days from now

          await createCalendarEvent(
            authToken,
            `Approval Needed: ${approval.document?.name || 'Document'}`,
            `Submitted by: ${approval.submittedByUser?.fullName || 'Unknown'}\n\nDocument ID: ${approval.document?.documentId}`,
            dueDate,
            new Date(dueDate.getTime() + 60 * 60 * 1000),
          );
          eventsCreated += 1;
        } catch (err) {
          console.error(`Failed to sync approval ${approval.approvalId}:`, err);
        }
      }

      return {
        success: true,
        message: `Successfully synced ${eventsCreated} approval(s) to Google Calendar`,
        eventsCreated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync approvals';
      return {
        success: false,
        message: 'Failed to sync approvals to Google Calendar',
        error: message,
      };
    }
  },

  async syncDocuments(documents: Document[], token?: string): Promise<SyncResult> {
    try {
      const authToken = token || await getGoogleAuthToken();
      let eventsCreated = 0;

      const pendingDocuments = documents.filter((doc) => doc.status === 'pending_approval');

      for (const doc of pendingDocuments) {
        try {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 14); // Default 14 days from now

          await createCalendarEvent(
            authToken,
            `Review: ${doc.fileName}`,
            `Status: ${doc.status}\nDepartment: ${doc.department || 'N/A'}\n\nDocument ID: ${doc.documentId}`,
            dueDate,
            new Date(dueDate.getTime() + 60 * 60 * 1000),
          );
          eventsCreated += 1;
        } catch (err) {
          console.error(`Failed to sync document ${doc.documentId}:`, err);
        }
      }

      return {
        success: true,
        message: `Successfully synced ${eventsCreated} document(s) to Google Calendar`,
        eventsCreated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync documents';
      return {
        success: false,
        message: 'Failed to sync documents to Google Calendar',
        error: message,
      };
    }
  },

  async syncAuditCalendarEvents(events: AuditCalendarEvent[], token?: string): Promise<SyncResult> {
    try {
      const authToken = token || await getGoogleAuthToken();
      let eventsCreated = 0;

      for (const event of events) {
        try {
          const eventDate = new Date(event.eventDate);

          // Create a 1-hour event starting at the scheduled date
          await createCalendarEvent(
            authToken,
            event.title,
            `Phase: ${event.phase}\nStandard: ${event.standard}\n${event.notes ? `Notes: ${event.notes}\n` : ''}\nEvent ID: ${event.id}`,
            eventDate,
            new Date(eventDate.getTime() + 60 * 60 * 1000),
          );
          eventsCreated += 1;
        } catch (err) {
          console.error(`Failed to sync audit event ${event.id}:`, err);
        }
      }

      return {
        success: true,
        message: `Successfully synced ${eventsCreated} audit calendar event(s) to Google Calendar`,
        eventsCreated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync audit events';
      return {
        success: false,
        message: 'Failed to sync audit calendar events to Google Calendar',
        error: message,
      };
    }
  },

  async syncAll(
    tasks: Task[],
    approvals: Approval[],
    documents: Document[],
    auditEvents?: AuditCalendarEvent[],
    token?: string,
  ): Promise<SyncResult> {
    try {
      const authToken = token || await getGoogleAuthToken();
      let totalEvents = 0;

      const tasksResult = await this.syncTasks(tasks, authToken);
      totalEvents += tasksResult.eventsCreated || 0;

      const approvalsResult = await this.syncApprovals(approvals, authToken);
      totalEvents += approvalsResult.eventsCreated || 0;

      const docsResult = await this.syncDocuments(documents, authToken);
      totalEvents += docsResult.eventsCreated || 0;

      if (auditEvents && auditEvents.length > 0) {
        const auditResult = await this.syncAuditCalendarEvents(auditEvents, authToken);
        totalEvents += auditResult.eventsCreated || 0;
      }

      return {
        success: true,
        message: `Successfully synced ${totalEvents} event(s) to Google Calendar`,
        eventsCreated: totalEvents,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync to Google Calendar';
      return {
        success: false,
        message: 'Failed to sync to Google Calendar',
        error: message,
      };
    }
  },
};
