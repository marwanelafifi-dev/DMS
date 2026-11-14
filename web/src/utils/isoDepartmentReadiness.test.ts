import { describe, expect, it } from 'vitest';
import type { Task, User } from '../types';
import { buildDepartmentReadiness, type ReadinessRequirement } from './isoDepartmentReadiness';

const user = (userId: string, fullName: string, department: string | null): User => ({
  userId, fullName, department, email: `${userId}@example.com`, role: 'User', isActive: true, createdAt: '2026-01-01',
});
const task = (taskId: string, changes: Partial<Task> = {}): Task => ({
  taskId, title: taskId, taskType: 'task', status: 'open', assignedBy: 'quality', priority: 'medium', dueDate: '2026-12-01', tags: [], createdAt: '2026-11-01', ...changes,
});
const requirement = (id: string, departmentFolderId: string, departmentFolderName: string, documentOwnerId: string, changes: Partial<ReadinessRequirement> = {}): ReadinessRequirement => ({
  evidenceRequirementId: id, folderId: `${id}-process`, relatedDocumentId: `${id}-document`, documentTitle: `${id} policy`, documentOwnerId,
  departmentFolderId, departmentFolderName, hasEvidence: false, ...changes,
});

describe('department audit readiness', () => {
  it('groups by covered folder, allowing one user to handle several departments and managers to appear', () => {
    const result = buildDepartmentReadiness(
      [user('tamer', 'Tamer', 'Information Technology'), user('marwan', 'Marwan', 'Management'), user('sales', 'Sales Lead', 'Commercial')],
      [], [],
      [
        requirement('quality', 'quality-root', 'Quality Management', 'tamer', { folderManagerUserIds: ['tamer'] }),
        requirement('strategy', 'strategy-root', 'Strategic Management', 'tamer', { folderManagerUserIds: ['tamer'] }),
        requirement('it', 'it-root', 'IT', 'tamer', { folderManagerUserIds: ['marwan'] }),
        requirement('sales', 'sales-root', 'Marketing and Sales', 'sales', { folderOwnerUserIds: ['sales'] }),
      ],
      'ISO 9001:2015', 'current',
    );

    expect(result.departments.map(department => department.name)).toEqual(['IT', 'Marketing and Sales', 'Quality Management', 'Strategic Management']);
    expect(result.departments.find(department => department.name === 'Strategic Management')?.people.find(person => person.user.userId === 'tamer')?.missingRequirements).toHaveLength(1);
    const it = result.departments.find(department => department.name === 'IT')!;
    expect(it.people.find(person => person.user.userId === 'marwan')?.responsibilities).toContain('Folder manager');
    expect(it.people.find(person => person.user.userId === 'marwan')?.responsibilities).not.toContain('Folder owner');
    expect(it.people.find(person => person.user.userId === 'marwan')?.missingRequirements).toHaveLength(0);
    expect(it.people.find(person => person.user.userId === 'tamer')?.responsibilities).toContain('Process document owner');
  });

  it('links work to the right folder and does not duplicate ambiguous tasks across departments', () => {
    const result = buildDepartmentReadiness(
      [user('tamer', 'Tamer', 'Information Technology'), user('marwan', 'Marwan', 'Management')],
      [
        task('strategic-pcar', { taskType: 'pcar', assignedTo: 'tamer', documentId: 'strategy-document', auditStandard: 'ISO 9001:2015', auditCycleId: 'current' }),
        task('old-pcar', { taskType: 'pcar', assignedTo: 'tamer', documentId: 'strategy-document', auditStandard: 'ISO 9001:2015', auditCycleId: 'old' }),
        task('it-task', { assignedTo: 'marwan' }),
        task('ambiguous-task', { assignedTo: 'tamer' }),
      ],
      [{ documentId: 'it-evidence', processFolderId: 'it-process', assignedById: 'marwan', isAssignedToSelectedCycle: true },
        { documentId: 'other-evidence', processFolderId: 'other-process', assignedById: 'marwan', isAssignedToSelectedCycle: true }],
      [
        requirement('strategy', 'strategy-root', 'Strategic Management', 'tamer'),
        requirement('it', 'it-root', 'IT', 'tamer', { folderManagerUserIds: ['marwan'] }),
      ],
      'ISO 9001:2015', 'current',
    );

    expect(result.departments.find(department => department.name === 'Strategic Management')?.pcarCount).toBe(1);
    const it = result.departments.find(department => department.name === 'IT')!;
    expect([it.taskCount, it.evidenceUploadCount]).toEqual([1, 1]);
    expect(result.unassignedTasks.map(item => item.taskId)).toEqual(['ambiguous-task']);
    expect(result.unassignedPcars).toEqual([]);
  });

  it('keeps coverage without a valid Procedures department visible as an unmapped gap', () => {
    const result = buildDepartmentReadiness(
      [user('tamer', 'Tamer', null)], [], [],
      [requirement('unknown', '', '', 'tamer')],
      'ISO 9001:2015', 'current',
    );

    expect(result.departments).toEqual([]);
    expect(result.unassignedRequirements.map(item => item.evidenceRequirementId)).toEqual(['unknown']);
  });
});
