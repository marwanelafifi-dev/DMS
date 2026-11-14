import { describe, expect, it } from 'vitest';
import type { Task, User } from '../types';
import { buildDepartmentReadiness } from './isoDepartmentReadiness';

const user = (userId: string, fullName: string, department: string | null): User => ({
  userId, fullName, department, email: `${userId}@example.com`, role: 'User', isActive: true, createdAt: '2026-01-01',
});
const task = (taskId: string, changes: Partial<Task> = {}): Task => ({
  taskId, title: taskId, taskType: 'task', status: 'open', assignedBy: 'quality', priority: 'medium', dueDate: '2026-12-01', tags: [], createdAt: '2026-11-01', ...changes,
});

describe('department audit readiness', () => {
  it('uses user departments and keeps PCARs inside the active standard and cycle', () => {
    const result = buildDepartmentReadiness(
      [user('hr', 'HR Owner', 'Human Resources'), user('it', 'IT Owner', 'IT')],
      [
        task('hr-task', { assignedTo: 'hr' }),
        task('hr-pcar', { taskType: 'pcar', assignedTo: 'hr', auditStandard: 'ISO 9001:2015', auditCycleId: 'current' }),
        task('old-pcar', { taskType: 'pcar', assignedTo: 'hr', auditStandard: 'ISO 9001:2015', auditCycleId: 'previous' }),
        task('isms-pcar', { taskType: 'pcar', assignedTo: 'it', auditStandard: 'ISO 27001:2022', auditCycleId: 'current' }),
        task('closed-task', { assignedTo: 'hr', status: 'completed' }),
      ],
      [{ documentId: 'evidence-it', processFolderId: 'folder-it', assignedById: 'it', isAssignedToSelectedCycle: true }],
      [
        { evidenceRequirementId: 'required-hr', folderId: 'folder-hr', relatedDocumentId: 'policy-hr', documentTitle: 'Hiring', documentOwnerId: 'hr', hasEvidence: false },
        { evidenceRequirementId: 'required-it', folderId: 'folder-it', relatedDocumentId: 'policy-it', documentTitle: 'Security', documentOwnerId: 'it', hasEvidence: true },
      ],
      'ISO 9001:2015', 'current',
    );

    const hr = result.departments.find(department => department.name === 'Human Resources')!;
    const it = result.departments.find(department => department.name === 'IT')!;
    expect([hr.taskCount, hr.pcarCount, hr.missingEvidenceCount, hr.requirementCount]).toEqual([1, 1, 1, 1]);
    expect([it.taskCount, it.pcarCount, it.missingEvidenceCount, it.evidenceUploadCount]).toEqual([0, 0, 0, 1]);
  });

  it('does not blame a user for shared tasks or evidence gaps without a known owner', () => {
    const result = buildDepartmentReadiness(
      [user('hr', 'HR Owner', null)],
      [task('shared', { assignedToGroupId: 'group-hr' })],
      [{ documentId: 'old-evidence', assignedById: 'hr', isAssignedToSelectedCycle: false }],
      [{ evidenceRequirementId: 'missing', folderId: 'folder-selected', relatedDocumentId: 'policy', documentTitle: 'Policy', hasEvidence: false }],
      'ISO 9001:2015', 'current',
    );

    expect(result.departments).toEqual([]);
    expect(result.unassignedTasks.map(item => item.taskId)).toEqual(['shared']);
    expect(result.unassignedRequirements.map(item => item.evidenceRequirementId)).toEqual(['missing']);
  });

  it('shows only departments tied to selected coverage folders and ignores uploads elsewhere', () => {
    const result = buildDepartmentReadiness(
      [user('hr', 'HR Owner', 'People Team'), user('sales', 'Sales Owner', 'Sales')],
      [task('sales-task', { assignedTo: 'sales' })],
      [
        { documentId: 'hr-evidence', processFolderId: 'folder-hr', assignedById: 'hr', isAssignedToSelectedCycle: true },
        { documentId: 'other-evidence', processFolderId: 'folder-other', assignedById: 'hr', isAssignedToSelectedCycle: true },
      ],
      [{ evidenceRequirementId: 'required-hr', folderId: 'folder-hr', relatedDocumentId: 'policy-hr', documentTitle: 'Hiring', documentOwnerId: 'hr', hasEvidence: true }],
      'ISO 9001:2015', 'current',
    );

    expect(result.departments.map(department => department.name)).toEqual(['People Team']);
    expect(result.departments[0].evidenceUploadCount).toBe(1);
    expect(result.departments[0].missingEvidenceCount).toBe(0);
  });
});
