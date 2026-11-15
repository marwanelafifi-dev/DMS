import type { Task, User } from '../types';

export type ReadinessEvidence = {
  documentId: string;
  processFolderId?: string | null;
  assignedById?: string | null;
  isAssignedToSelectedCycle?: boolean;
};

export type ReadinessContact = { departmentFolderId: string; userId: string };
export type ReadinessCoveredFolder = { folderId: string; departmentFolderId: string; departmentFolderName: string };

export type ReadinessRequirement = {
  evidenceRequirementId: string;
  folderId: string;
  relatedDocumentId: string;
  documentTitle: string;
  documentOwnerId?: string | null;
  folderName?: string | null;
  departmentFolderId?: string | null;
  departmentFolderName?: string | null;
  folderOwnerUserIds?: string[];
  folderManagerUserIds?: string[];
  evidenceFolderId?: string | null;
  hasEvidence: boolean;
};

export type Responsibility = 'Folder owner' | 'Folder manager' | 'Process document owner' | 'Evidence uploader' | 'Readiness contact';

export type PersonReadiness = {
  user: User;
  responsibilities: Responsibility[];
  tasks: Task[];
  pcars: Task[];
  missingRequirements: ReadinessRequirement[];
  uploadedEvidence: ReadinessEvidence[];
};

export type DepartmentReadiness = {
  id: string;
  name: string;
  people: PersonReadiness[];
  requirementCount: number;
  taskCount: number;
  pcarCount: number;
  missingEvidenceCount: number;
  evidenceUploadCount: number;
  missingWithoutOwner: ReadinessRequirement[];
};

export type DepartmentReadinessResult = {
  departments: DepartmentReadiness[];
  unassignedTasks: Task[];
  unassignedPcars: Task[];
  unassignedRequirements: ReadinessRequirement[];
  unattributedEvidenceCount: number;
};

type DepartmentBuilder = DepartmentReadiness & { peopleById: Map<string, PersonReadiness> };
const isOpen = (task: Task) => task.status !== 'done' && task.status !== 'completed';
const key = (id: string) => id.toLowerCase();

export function buildDepartmentReadiness(
  users: User[],
  tasks: Task[],
  evidence: ReadinessEvidence[],
  requirements: ReadinessRequirement[],
  standard: 'ISO 9001:2015' | 'ISO 27001:2022',
  activeCycleId: string | null,
  contacts: ReadinessContact[],
  coveredFolders: ReadinessCoveredFolder[] = [],
): DepartmentReadinessResult {
  const usersById = new Map(users.map(user => [key(user.userId), user]));
  const contactsByFolder = new Map<string, Set<string>>();
  for (const contact of contacts) {
    const folderId = key(contact.departmentFolderId);
    if (!contactsByFolder.has(folderId)) contactsByFolder.set(folderId, new Set());
    contactsByFolder.get(folderId)!.add(key(contact.userId));
  }
  const departmentsById = new Map<string, DepartmentBuilder>();
  const departmentByProcessFolder = new Map<string, DepartmentBuilder>();
  const departmentByDocument = new Map<string, DepartmentBuilder>();
  const unassignedRequirements: ReadinessRequirement[] = [];

  for (const folder of coveredFolders) {
    const id = key(folder.departmentFolderId);
    let department = departmentsById.get(id);
    if (!department) {
      department = { id, name: folder.departmentFolderName, people: [], peopleById: new Map(), requirementCount: 0, taskCount: 0, pcarCount: 0, missingEvidenceCount: 0, evidenceUploadCount: 0, missingWithoutOwner: [] };
      departmentsById.set(id, department);
    }
    departmentByProcessFolder.set(key(folder.folderId), department);
  }

  const personFor = (department: DepartmentBuilder, userId: string | null | undefined, responsibility?: Responsibility) => {
    if (!userId) return undefined;
    const id = key(userId);
    const user = usersById.get(id);
    if (!user || !contactsByFolder.get(department.id)?.has(id)) return undefined;
    let person = department.peopleById.get(id);
    if (!person) {
      person = { user, responsibilities: [], tasks: [], pcars: [], missingRequirements: [], uploadedEvidence: [] };
      department.peopleById.set(id, person);
      department.people.push(person);
    }
    if (responsibility && !person.responsibilities.includes(responsibility)) person.responsibilities.push(responsibility);
    return person;
  };

  for (const requirement of requirements) {
    if (!requirement.departmentFolderId || !requirement.departmentFolderName) {
      if (!requirement.hasEvidence) unassignedRequirements.push(requirement);
      continue;
    }
    const id = key(requirement.departmentFolderId);
    let department = departmentsById.get(id);
    if (!department) {
      department = { id, name: requirement.departmentFolderName, people: [], peopleById: new Map(), requirementCount: 0, taskCount: 0, pcarCount: 0, missingEvidenceCount: 0, evidenceUploadCount: 0, missingWithoutOwner: [] };
      departmentsById.set(id, department);
    }
    department.requirementCount += 1;
    departmentByProcessFolder.set(key(requirement.folderId), department);
    departmentByDocument.set(key(requirement.relatedDocumentId), department);
    for (const ownerId of requirement.folderOwnerUserIds ?? []) personFor(department, ownerId, 'Folder owner');
    for (const managerId of requirement.folderManagerUserIds ?? []) personFor(department, managerId, 'Folder manager');
    personFor(department, requirement.documentOwnerId, 'Process document owner');
    if (!requirement.hasEvidence) {
      department.missingEvidenceCount += 1;
      const responsibleIds = contactsByFolder.get(department.id) ?? new Set<string>();
      let assigned = false;
      for (const userId of responsibleIds) {
        const person = personFor(department, userId, 'Readiness contact');
        if (!person) continue;
        person.missingRequirements.push(requirement);
        assigned = true;
      }
      if (!assigned) department.missingWithoutOwner.push(requirement);
    }
  }

  for (const department of departmentsById.values())
    for (const userId of contactsByFolder.get(department.id) ?? [])
      if (!department.peopleById.has(userId)) personFor(department, userId, 'Readiness contact');

  let unattributedEvidenceCount = 0;
  for (const item of evidence) {
    if (!item.isAssignedToSelectedCycle || !item.processFolderId) continue;
    const department = departmentByProcessFolder.get(key(item.processFolderId));
    if (!department) continue;
    department.evidenceUploadCount += 1;
    departmentByDocument.set(key(item.documentId), department);
    const uploader = personFor(department, item.assignedById, 'Evidence uploader');
    if (uploader) uploader.uploadedEvidence.push(item);
    else unattributedEvidenceCount += 1;
  }

  const unassignedTasks: Task[] = [];
  const unassignedPcars: Task[] = [];
  for (const task of tasks.filter(isOpen)) {
    const isPcar = task.taskType === 'pcar';
    if (isPcar && (!activeCycleId || task.auditStandard !== standard || task.auditCycleId !== activeCycleId)) continue;
    let department = task.documentId ? departmentByDocument.get(key(task.documentId)) : undefined;
    if (!department && task.folderId) department = departmentByProcessFolder.get(key(task.folderId));
    if (!department && task.assignedTo) {
      const candidates = [...departmentsById.values()].filter(item => item.peopleById.has(key(task.assignedTo!)));
      if (candidates.length === 1) department = candidates[0];
    }
    const person = department ? personFor(department, task.assignedTo) : undefined;
    if (person) (isPcar ? person.pcars : person.tasks).push(task);
    else (isPcar ? unassignedPcars : unassignedTasks).push(task);
  }

  const departments = [...departmentsById.values()];
  for (const department of departments) {
    department.people.sort((left, right) => left.user.fullName.localeCompare(right.user.fullName));
    department.taskCount = department.people.reduce((sum, person) => sum + person.tasks.length, 0);
    department.pcarCount = department.people.reduce((sum, person) => sum + person.pcars.length, 0);
  }
  departments.sort((left, right) => {
    const leftBlockers = left.taskCount + left.pcarCount + left.missingEvidenceCount;
    const rightBlockers = right.taskCount + right.pcarCount + right.missingEvidenceCount;
    return rightBlockers - leftBlockers || left.name.localeCompare(right.name);
  });

  return { departments, unassignedTasks, unassignedPcars, unassignedRequirements, unattributedEvidenceCount };
}
