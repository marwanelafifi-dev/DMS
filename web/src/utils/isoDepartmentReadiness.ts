import type { Task, User } from '../types';

export type ReadinessEvidence = {
  documentId: string;
  assignedById?: string | null;
  isAssignedToSelectedCycle?: boolean;
};

export type ReadinessRequirement = {
  evidenceRequirementId: string;
  relatedDocumentId: string;
  documentTitle: string;
  documentOwnerId?: string | null;
  hasEvidence: boolean;
};

export type PersonReadiness = {
  user: User;
  tasks: Task[];
  pcars: Task[];
  missingRequirements: ReadinessRequirement[];
  uploadedEvidence: ReadinessEvidence[];
};

export type DepartmentReadiness = {
  name: string;
  people: PersonReadiness[];
  requirementCount: number;
  taskCount: number;
  pcarCount: number;
  missingEvidenceCount: number;
  evidenceUploadCount: number;
};

export type DepartmentReadinessResult = {
  departments: DepartmentReadiness[];
  unassignedTasks: Task[];
  unassignedPcars: Task[];
  unassignedRequirements: ReadinessRequirement[];
  unattributedEvidenceCount: number;
};

const isOpen = (task: Task) => task.status !== 'done' && task.status !== 'completed';
const departmentName = (user: User) => user.department?.trim() || 'Department not set';

export function buildDepartmentReadiness(
  users: User[],
  tasks: Task[],
  evidence: ReadinessEvidence[],
  requirements: ReadinessRequirement[],
  standard: 'ISO 9001:2015' | 'ISO 27001:2022',
  activeCycleId: string | null,
): DepartmentReadinessResult {
  const peopleById = new Map<string, PersonReadiness>();
  const departmentsByName = new Map<string, DepartmentReadiness>();

  for (const user of users) {
    const name = departmentName(user);
    const key = name.toLocaleLowerCase();
    let department = departmentsByName.get(key);
    if (!department) {
      department = { name, people: [], requirementCount: 0, taskCount: 0, pcarCount: 0, missingEvidenceCount: 0, evidenceUploadCount: 0 };
      departmentsByName.set(key, department);
    }
    const person: PersonReadiness = { user, tasks: [], pcars: [], missingRequirements: [], uploadedEvidence: [] };
    department.people.push(person);
    peopleById.set(user.userId.toLowerCase(), person);
  }

  const unassignedTasks: Task[] = [];
  const unassignedPcars: Task[] = [];
  for (const task of tasks.filter(isOpen)) {
    const isPcar = task.taskType === 'pcar';
    if (isPcar && (!activeCycleId || task.auditStandard !== standard || task.auditCycleId !== activeCycleId)) continue;
    const person = task.assignedTo ? peopleById.get(task.assignedTo.toLowerCase()) : undefined;
    if (person) (isPcar ? person.pcars : person.tasks).push(task);
    else (isPcar ? unassignedPcars : unassignedTasks).push(task);
  }

  const unassignedRequirements: ReadinessRequirement[] = [];
  for (const requirement of requirements) {
    const person = requirement.documentOwnerId ? peopleById.get(requirement.documentOwnerId.toLowerCase()) : undefined;
    if (!person) {
      if (!requirement.hasEvidence) unassignedRequirements.push(requirement);
      continue;
    }
    const department = departmentsByName.get(departmentName(person.user).toLocaleLowerCase())!;
    department.requirementCount += 1;
    if (!requirement.hasEvidence) person.missingRequirements.push(requirement);
  }

  let unattributedEvidenceCount = 0;
  for (const item of evidence.filter(item => item.isAssignedToSelectedCycle)) {
    const person = item.assignedById ? peopleById.get(item.assignedById.toLowerCase()) : undefined;
    if (person) person.uploadedEvidence.push(item);
    else unattributedEvidenceCount += 1;
  }

  const departments = [...departmentsByName.values()];
  for (const department of departments) {
    department.people.sort((left, right) => left.user.fullName.localeCompare(right.user.fullName));
    department.taskCount = department.people.reduce((sum, person) => sum + person.tasks.length, 0);
    department.pcarCount = department.people.reduce((sum, person) => sum + person.pcars.length, 0);
    department.missingEvidenceCount = department.people.reduce((sum, person) => sum + person.missingRequirements.length, 0);
    department.evidenceUploadCount = department.people.reduce((sum, person) => sum + person.uploadedEvidence.length, 0);
  }
  departments.sort((left, right) => {
    if (left.name === 'Department not set') return 1;
    if (right.name === 'Department not set') return -1;
    const leftBlockers = left.taskCount + left.pcarCount + left.missingEvidenceCount;
    const rightBlockers = right.taskCount + right.pcarCount + right.missingEvidenceCount;
    return rightBlockers - leftBlockers || left.name.localeCompare(right.name);
  });

  return { departments, unassignedTasks, unassignedPcars, unassignedRequirements, unattributedEvidenceCount };
}
