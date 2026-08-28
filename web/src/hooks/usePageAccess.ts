import { useEffect, useState } from 'react';
import { apiClient, type PageAccessRoleFlags } from '../utils/api';
import { useAuth } from './useAuth';

// A user with no role assigned ("No Access") can still load the app shell
// and see the Dashboard, but nothing else — same "ask an admin" spirit as
// the rest of the No-Access experience elsewhere in the app.
const NO_ACCESS_FLAGS: PageAccessRoleFlags = {
  canViewDashboard: true,
  canViewDocumentLibrary: false,
  canViewReminders: false,
  canViewApprovals: false,
  canViewPcar: false,
  canViewAdminPanel: false,
  bypassFolderPermissions: false,
  canReadAllFolders: false,
  canReadWriteAllFolders: false,
  canEditFiles: false,
  canManageFolderPermissions: false,
  canManageFilePermissions: false,
  canManageAllTasks: false,
  canCreateTasks: false,
  canReassignTasks: false,
  canReassignMyTasks: false,
  canViewQaStage: false,
  canViewManagerStage: false,
  canViewFinalReleaseStage: false,
  canApprove: false,
  canReject: false,
  canResolveDocumentId: false,
  canSendAnnouncements: false,
  canDeleteReminders: false,
  canDeleteDocumentVersions: false,
  canManageBulkActions: false,
};

// Fetches the current user's page/feature access flags (their global role —
// see api/Models/DmsPageAccessRole.cs). Used to hide sidebar links the user
// can't use and to guard the routes themselves as a second layer.
export function usePageAccess(): PageAccessRoleFlags | null {
  const { user } = useAuth();
  const [access, setAccess] = useState<PageAccessRoleFlags | null>(null);

  useEffect(() => {
    if (!user) {
      setAccess(null);
      return;
    }
    if (!user.role) {
      setAccess(NO_ACCESS_FLAGS);
      return;
    }
    let cancelled = false;
    apiClient.getPageAccessRoles()
      .then((res) => {
        if (cancelled) return;
        const match = (res.data || []).find((r: { role: string }) => r.role === user.role);
        setAccess(match ?? NO_ACCESS_FLAGS);
      })
      .catch(() => {
        if (!cancelled) setAccess(NO_ACCESS_FLAGS);
      });
    return () => { cancelled = true; };
  }, [user]);

  return access;
}
