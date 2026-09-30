import type { PageAccessRoleFlags } from '../../utils/api';

export interface GuideMedia {
  src: string;
  alt: string;
  caption?: string;
}
export interface GuideSection {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  keywords?: string[];
  media?: GuideMedia[];
}
export interface ConditionalGuideSection extends GuideSection {
  when: (access: PageAccessRoleFlags) => boolean;
}

export interface GuideDefinition {
  key: string;
  version: number;
  title: string;
  matches: (pathname: string) => boolean;
  requiredAccess?: keyof PageAccessRoleFlags;
  commonSections: GuideSection[];
  conditionalSections?: ConditionalGuideSection[];
  keywords?: string[];
  enabled: boolean;
}

const futureGuide = (
  key: string,
  title: string,
  matches: (pathname: string) => boolean,
  requiredAccess?: keyof PageAccessRoleFlags,
): GuideDefinition => ({
  key,
  version: 1,
  title,
  matches,
  requiredAccess,
  commonSections: [],
  enabled: false,
});

export const guideRegistry: GuideDefinition[] = [
  {
    key: 'dashboard',
    version: 2,
    title: 'Dashboard Guide',
    matches: (pathname) => pathname === '/',
    requiredAccess: 'canViewDashboard',
    commonSections: [
      {
        id: 'about',
        title: 'About this page',
        paragraphs: [
          'The Dashboard is your personal workspace in the DMS. It provides a summary of activities and information relevant to you as the signed-in user.',
          'It includes personal work summary information, announcements, My Tasks, My Submitted Documents, approval-related information where applicable, the ISO Certification Journey & Audit Calendar, and access to the DMS AI Assistant. Displayed information and available actions may vary depending on your assigned access and current DMS activity.',
        ],
      },
      {
        id: 'work-summary',
        title: 'Your work summary',
        paragraphs: ['The summary values depend on your current DMS activity.'],
        bullets: [
          'My Open Tasks: Shows tasks currently assigned to you.',
          'My Overdue Tasks: Shows assigned tasks that have passed their due date.',
          'Awaiting My Approval: Shows items waiting for your review when you have approval responsibilities.',
          'My Submitted Documents: Shows documents submitted by you.',
          'My Checked-Out Docs: Shows documents currently checked out by you.',
        ],
      },
      {
        id: 'my-tasks',
        title: 'My Tasks',
        bullets: [
          'The My Tasks panel displays tasks assigned to you.',
          'If no tasks are assigned, an empty-state message is displayed.',
          'Use this area to quickly see whether you currently have assigned work.',
        ],
      },
      {
        id: 'announcements',
        title: 'Announcements',
        bullets: [
          'The Announcements panel displays announcements available to you.',
          'If no announcements are available, the Dashboard displays “No announcements yet.”',
          'Users with the appropriate access may have functions for creating or sending announcements elsewhere in the DMS.',
        ],
      },
      {
        id: 'submitted-documents',
        title: 'My Submitted Documents',
        bullets: [
          'This area summarizes documents you submitted into the DMS workflow.',
          'If there are no applicable submitted documents, an empty state is displayed.',
          'Use it to monitor documents you have already submitted.',
        ],
      },
      {
        id: 'iso-audit-calendar',
        title: 'ISO Certification Journey & Audit Calendar',
        paragraphs: [
          'This area is used for ISO audit meeting information and Google Calendar synchronization.',
        ],
        bullets: [
          'Connect your Si-Ware Google Calendar.',
          'Synchronize calendar information with the DMS.',
          'Display ISO audit meetings from Google Calendar.',
          'Use Sync Now or Disconnect when those controls are available.',
          'A connected Google Calendar can synchronize automatically when you sign in.',
        ],
      },
      {
        id: 'ai-assistant',
        title: 'DMS AI Assistant',
        bullets: [
          'Select the floating control in the lower-right area of the DMS to open the assistant panel.',
          'The assistant can work with authorized DMS information such as tasks, documents, calendar information, announcements, and dashboard information.',
          'The information available to the assistant follows the access available to you as the signed-in user.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'manager-review',
        title: 'Manager review',
        paragraphs: [
          'Users with Manager Review access may see documents in “Awaiting My Approval” when those documents require Manager Review.',
        ],
        when: (access) => access.canViewManagerStage,
      },
      {
        id: 'quality-review-both-stages',
        title: 'Quality review',
        bullets: [
          'QA Review',
          'Final Review / Final Release',
        ],
        when: (access) => access.canViewQaStage && access.canViewFinalReleaseStage,
      },
      {
        id: 'quality-review-qa-only',
        title: 'Quality review',
        bullets: [
          'QA Review',
        ],
        when: (access) => access.canViewQaStage && !access.canViewFinalReleaseStage,
      },
      {
        id: 'quality-review-final-only',
        title: 'Quality review',
        bullets: [
          'Final Review / Final Release',
        ],
        when: (access) => access.canViewFinalReleaseStage && !access.canViewQaStage,
      },
    ],
    keywords: ['dashboard', 'overview', 'tasks', 'documents', 'approvals', 'announcements', 'calendar', 'AI assistant'],
    enabled: true,
  },
  {
    key: 'documents',
    version: 1,
    title: 'Document Library Guide',
    matches: (pathname) => pathname === '/documents',
    requiredAccess: 'canViewDocumentLibrary',
    commonSections: [
      {
        id: 'about-document-library',
        title: 'About Document Library',
        paragraphs: [
          'The Document Library is the main area used to browse folders and work with documents available to you.',
          'The interface includes the Folders panel, current folder/location, Document Library work area, search and filter toolbar, and documents table.',
          'Folders, documents, and available actions depend on assigned access. Users with the same Page Access role may still have different access to individual folders or documents.',
        ],
      },
      {
        id: 'navigating-folders',
        title: 'Navigating folders',
        bullets: [
          'Use the Folders panel to browse the folder structure available to you.',
          'Use the expand control beside a folder to display child folders.',
          'Select a folder to open it and display its contents.',
          'The current location/path identifies the folder you are viewing.',
          'When inside a child folder, use Back to parent folder to return to the folder above.',
        ],
      },
      {
        id: 'searching-filtering',
        title: 'Searching and filtering',
        paragraphs: [
          'Document Library search works within the current library view. It can narrow visible folders and documents using information such as name, extension, owner, and tags.',
          'This is different from the global OCR search in the top Navbar.',
        ],
        bullets: [
          'Status filter',
          'Tag filter',
          'Status options: All statuses, Draft, QA Review, Manager Review, Correction Needed, Final Review, and Released.',
        ],
      },
      {
        id: 'documents-table',
        title: 'Documents table',
        paragraphs: [
          'The table shows the current library contents. Visible results and pagination reflect the current library view.',
          'Status shows the current document workflow state. Actions contains controls available for the individual row.',
        ],
        bullets: [
          'Doc ID',
          'File name',
          'Folder',
          'Department',
          'Category',
          'Owner',
          'Modified date',
          'Tags',
          'Status',
          'Actions',
        ],
      },
      {
        id: 'visible-columns',
        title: 'Choosing visible columns',
        paragraphs: [
          'The Columns control can show or hide optional columns. Changes take effect immediately; no separate Apply or Save action is required.',
        ],
        bullets: [
          'Department',
          'Category',
          'Owner',
          'Modified date',
          'Tags',
          'Status',
        ],
      },
      {
        id: 'folder-management',
        title: 'Folder management',
        paragraphs: [
          'Where permitted, New Folder opens the folder creation dialog.',
          'Some folder actions may be unavailable depending on assigned access. Delete is destructive and should only be used when deletion is intended and permitted.',
        ],
        bullets: [
          'Folder Actions may include New Subfolder, Download as ZIP, Rename, Edit, Copy, Move, Delete, and Folder Permissions.',
        ],
      },
      {
        id: 'uploading-documents',
        title: 'Uploading documents',
        paragraphs: [
          'Where permitted, Upload is available when assigned access allows document creation. Confirm the current folder before uploading.',
          'Save as Draft saves the document without submitting it into the approval workflow.',
        ],
        bullets: [
          'The Upload Documents dialog includes selected file, File name, Description, Tags (Optional), Version, Document Category, Department, Owner, and Approval Notes (Optional).',
          'Available actions include Cancel, Save as Draft, and Submit.',
        ],
      },
      {
        id: 'opening-previewing',
        title: 'Opening and previewing documents',
        paragraphs: [
          'Use Preview where available to open a document. The preview displays document content in View Only mode where applicable.',
          'It also displays document information such as file type, size, status, version, department, category, owner, created/modified information, and description.',
        ],
        bullets: [
          'Search in document',
          'Zoom controls',
          'Page navigation',
          'Close',
        ],
      },
      {
        id: 'document-information-metadata',
        title: 'Document information and metadata',
        paragraphs: [
          'The preview displays document metadata. Where the Edit control is available, the Edit Document dialog can include file name, description, tags, version, category, department, and owner.',
          'Available edit actions depend on access and the document being viewed.',
        ],
      },
      {
        id: 'download-version-history',
        title: 'Download and version history',
        paragraphs: [
          'Where permitted, Download downloads the current document. Download for Editing is a separate control and should not be confused with the normal Download action.',
          'Version History displays available document versions. A version entry can show its version label, current status, file name, file size, and date/time. Available version actions can include reviewing or downloading a version.',
        ],
      },
      {
        id: 'submitting-workflow',
        title: 'Submitting to workflow',
        paragraphs: [
          'Where permitted, Submit for Approval is available from the document preview when applicable. It opens the submission review dialog; review the document and submission details before proceeding.',
          'Available controls can include Submit for Approval, Save as Draft, and Cancel. Detailed review stages belong to the Document Workflow page and its own Page Guide.',
        ],
      },
    ],
    keywords: ['documents', 'folders', 'library', 'preview', 'upload', 'workflow', 'metadata'],
    enabled: true,
  },
  {
    key: 'document-workflow',
    version: 1,
    title: 'Document Workflow Guide',
    matches: (pathname) => pathname === '/approvals',
    requiredAccess: 'canViewApprovals',
    commonSections: [
      {
        id: 'about-document-workflow',
        title: 'About Document Workflow',
        paragraphs: [
          'The Document Workflow page is used to review and follow controlled documents as they move through the applicable approval stages.',
          'The documented workflow contains three stages: QA Review — Stage 1, Manager Review — Stage 2, and Final Release — Stage 3. Selecting an available stage opens its current review queue.',
          'The stages and actions available to you depend on assigned access.',
        ],
      },
      {
        id: 'workflow-path',
        title: 'Workflow path',
        paragraphs: [
          'The normal documented path is QA Review → Manager Review → Final Release.',
          'A document may leave this normal path temporarily when correction is requested. After correction and resubmission, it returns to the stage that requested the correction.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'qa-review-stage',
        title: 'QA Review — Stage 1',
        paragraphs: [
          'At QA Review, authorized Quality-stage users review the submitted document.',
        ],
        bullets: [
          'Accept & Send to Manager advances the document to Manager Review.',
          'Request Correction returns the document for correction and creates an associated correction task.',
        ],
        when: (access) => access.canViewQaStage,
      },
      {
        id: 'document-id-resolution',
        title: 'Document ID resolution',
        paragraphs: [
          'Document ID resolution may be required during QA Review.',
        ],
        when: (access) => access.canViewQaStage && access.canResolveDocumentId,
      },
      {
        id: 'manager-review-stage',
        title: 'Manager Review — Stage 2',
        paragraphs: [
          'At Manager Review, authorized users review the document.',
        ],
        bullets: [
          'Approve advances the document to Final Release.',
          'Reject with a correction task returns the document for correction and creates an associated task.',
          'Reject — Fix It Myself allows the reviewer to upload a corrected file directly; the document then proceeds to Final Release.',
        ],
        when: (access) => access.canViewManagerStage,
      },
      {
        id: 'final-release-stage',
        title: 'Final Review / Final Release — Stage 3',
        paragraphs: [
          'At Final Release, authorized Quality-stage users perform the final review.',
        ],
        bullets: [
          'Release the document.',
          'Request correction. The document returns for correction and, after resubmission, returns to Final Release.',
        ],
        when: (access) => access.canViewFinalReleaseStage,
      },
      {
        id: 'correction-requested',
        title: 'Correction requested',
        bullets: [
          'A correction request creates a task associated with the document.',
          'The task is assigned to the responsible user or group.',
          'The responsible user completes the requested correction.',
          'The corrected document can be uploaded and resubmitted through the associated correction task.',
          'After resubmission, the document returns to the workflow stage that requested the correction.',
        ],
        when: () => true,
      },
      {
        id: 'tracking-workflow-status',
        title: 'Tracking workflow status',
        paragraphs: [
          'The Document Library Status column can show workflow states such as Draft, QA Review, Manager Review, Correction Needed, Final Review, and Released.',
          'Final Review in Document Library corresponds to the Final Release stage in Document Workflow.',
          'You can also follow information relevant to you through Dashboard areas such as My Submitted Documents, My Tasks, and Awaiting My Approval where applicable.',
        ],
        when: () => true,
      },
    ],
    keywords: ['workflow', 'QA Review', 'Manager Review', 'Final Release', 'approval', 'correction'],
    enabled: true,
  },
  {
    key: 'pcar',
    version: 1,
    title: 'PCAR / Corrective Action Guide',
    matches: (pathname) => pathname === '/tasks',
    requiredAccess: 'canViewPcar',
    commonSections: [
      {
        id: 'about-pcar',
        title: 'About PCAR / Corrective Action',
        paragraphs: [
          'The PCAR / Corrective Action page provides access to the PCAR task summary, search and filters, PCAR Register, PCAR task details, and New PCAR when available to your signed-in account.',
          'The page can display summary cards for Total Tasks, Open, In Progress, Completed, and Overdue. Task creation and task-management controls depend on assigned permissions.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'pcar-register',
        title: 'Working with the PCAR Register',
        paragraphs: [
          'The register includes Search tasks, Status filter, and Priority filter. Actions can differ depending on your permissions and the individual task.',
        ],
        bullets: [
          'Status options: Open, In Progress, Submitted for approval, and Completed.',
          'Priority options: Low, Medium, High, and Critical.',
          'Visible columns include Title, Submitted By, Assigned To, Status, Priority, Due Date, Type, and Actions.',
          'If no tasks match the current view, the table may display “No tasks found.”',
        ],
        when: () => true,
      },
      {
        id: 'creating-new-pcar',
        title: 'Creating a new PCAR',
        paragraphs: [
          'When New PCAR is available, it opens the Create New Task dialog. Assignment options and the ability to create a PCAR depend on assigned access.',
        ],
        bullets: [
          'The form can include Task Title, Description, Tags, Document, Type, Priority, Due Date, Assigned To, and Attachment.',
          'Required fields include Task Title, Document, and Due Date.',
          'Type options include Correction, RCA, and Audit Action.',
          'Priority options include Low, Medium, High, and Critical.',
          'Available actions include Cancel and Create Task.',
        ],
        when: (access) => access.canCreateTasks,
      },
      {
        id: 'viewing-pcar-details',
        title: 'Viewing PCAR details',
        paragraphs: [
          'Opening a task available to you can display its task title, issue description, assignee, tags, linked document, attachments, PCAR status, and submission control where applicable.',
          'Access to an individual task depends on assigned permissions; not every task is visible to every user.',
        ],
        when: () => true,
      },
      {
        id: 'root-cause-analysis',
        title: 'Root Cause Analysis',
        paragraphs: [
          'Root Cause Analysis is a required field when preparing the PCAR. The interface instruction states that it is mandatory, requires a minimum of 20 characters, and should use the 5-Whys method.',
        ],
        when: () => true,
      },
      {
        id: 'corrective-preventive-action',
        title: 'Corrective & Preventive Action',
        paragraphs: [
          'PCAR details include required documentation fields such as Immediate correction, Preventive action, and Target closure date. These fields are completed when preparing the PCAR for submission.',
        ],
        when: () => true,
      },
      {
        id: 'linked-documents',
        title: 'Linked documents',
        paragraphs: [
          'The Linked Document area can provide View, Download, Download for Editing, and Upload Updated File controls. Availability depends on assigned access.',
          'When Upload Updated File is available, it opens the Upload New Version dialog, which can include File Name, New Version, Description, Tags, Category, Department, and Owner.',
        ],
        when: () => true,
      },
      {
        id: 'attachments',
        title: 'Attachments',
        paragraphs: [
          'The Attachments area can provide Add Attachment and existing attachment information when present.',
          'When there are no attachments, the interface may display “No attachments yet.”',
        ],
        when: () => true,
      },
      {
        id: 'submitting-following-up',
        title: 'Submitting and following up',
        paragraphs: [
          'Before a required corrected file is uploaded, Submit for approval may be disabled. The interface may instruct you to upload the corrected file before submitting.',
          'After the corrected file is uploaded, PCAR status may remain Not yet submitted until submission. Submit for approval becomes available when the documented requirements are satisfied.',
          'Available submission actions depend on the current PCAR state and assigned access.',
        ],
        when: () => true,
      },
    ],
    keywords: ['PCAR', 'corrective action', 'tasks', 'root cause analysis', 'preventive action'],
    enabled: true,
  },
  {
    key: 'reminders',
    version: 1,
    title: 'Reminders Guide',
    matches: (pathname) => pathname === '/reminders',
    requiredAccess: 'canViewReminders',
    commonSections: [
      {
        id: 'about-reminders',
        title: 'About Reminders',
        paragraphs: [
          'The Reminders page provides a summary of reminders and a results area for reviewing them.',
          'The page can include Total Reminders, Pending, Sent, Search, Status filter, Reminder results, and New Reminder when available to the signed-in account.',
          'Reminder actions may depend on assigned access.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'viewing-filtering-reminders',
        title: 'Viewing and filtering reminders',
        paragraphs: [
          'Use Search reminders... to search the reminder list.',
          'A reminder item can show Task title, Status, Delivery type, and Due date. Selecting an available reminder opens its details.',
          'If no reminders match the current view, the page may display “No reminders found.”',
        ],
        bullets: ['All Reminders', 'Pending', 'Sent'],
        when: () => true,
      },
      {
        id: 'viewing-reminder-details',
        title: 'Viewing reminder details',
        paragraphs: [
          'The Reminder Details dialog can display Reminder status, Delivery type, Task title, Task description, Task status, Recipient, Due Date, and Created date.',
        ],
        when: () => true,
      },
      {
        id: 'creating-reminder',
        title: 'Creating a reminder',
        paragraphs: [
          'If New Reminder is available to your account, selecting it opens the Create New Reminder dialog.',
          'Required fields include Task, Remind / recipient, Delivery, and Due Date. The Remind field is separate from Task; verify the intended recipient before creating the reminder.',
        ],
        bullets: ['Cancel', 'Create'],
        when: () => true,
      },
      {
        id: 'reminder-delivery',
        title: 'Reminder delivery',
        paragraphs: [
          'APP sends an in-app notification. EMAIL sends by email. BOTH uses both delivery channels.',
          'The Due Date determines when the reminder is due. A future-dated reminder is scheduled for that date/time; a reminder whose due date/time has already arrived may be sent immediately.',
        ],
        bullets: ['APP', 'EMAIL', 'BOTH'],
        when: () => true,
      },
      {
        id: 'reminder-status',
        title: 'Reminder status',
        paragraphs: [
          'The Reminders page summarizes records using Total Reminders, Pending, and Sent. The status filter can switch between All Reminders, Pending, and Sent.',
        ],
        when: () => true,
      },
      {
        id: 'reminder-actions-with-delete',
        title: 'Reminder actions',
        paragraphs: ['Available actions depend on your assigned access.'],
        bullets: ['Mark as Sent', 'Delete', 'Close'],
        when: (access) => access.canDeleteReminders,
      },
      {
        id: 'reminder-actions-without-delete',
        title: 'Reminder actions',
        paragraphs: ['Available actions depend on your assigned access.'],
        bullets: ['Mark as Sent', 'Close'],
        when: (access) => !access.canDeleteReminders,
      },
    ],
    keywords: ['reminders', 'pending', 'sent', 'delivery'],
    enabled: true,
  },
  {
    key: 'announcements',
    version: 1,
    title: 'Send Announcement Guide',
    matches: (pathname) => pathname === '/send-announcement',
    requiredAccess: 'canSendAnnouncements',
    commonSections: [
      {
        id: 'about-send-announcement',
        title: 'About Send Announcement',
        paragraphs: [
          'The Send Announcement page is used by authorized users to create and post DMS announcements.',
          'Announcements can be directed to All users or Selected users. Delivery can use in-app notification, email, or both where selected.',
          'Access to this page depends on the permission assigned to the signed-in account.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'creating-announcement',
        title: 'Creating an announcement',
        paragraphs: [
          'Select New Announcement to open the announcement form.',
          'Before posting, enter the announcement title and message, choose the intended recipients and delivery options, and review the details.',
        ],
        bullets: ['Title', 'Message'],
        when: () => true,
      },
      {
        id: 'choosing-announcement-recipients',
        title: 'Choosing recipients',
        paragraphs: [
          'Under Notify, choose All users or Selected users. When Selected users is chosen, a recipient checklist is displayed; select only the intended recipients before posting.',
        ],
        bullets: ['All users', 'Selected users'],
        when: () => true,
      },
      {
        id: 'announcement-delivery-options',
        title: 'Delivery options',
        paragraphs: [
          'The announcement form provides separate controls for Send email and In-app notification. These options can be selected independently.',
          'In-app notification delivers the announcement through the DMS notification experience. Email delivery is optional when available or selected, and both options may be used together.',
        ],
        bullets: ['Send email', 'In-app notification'],
        when: () => true,
      },
      {
        id: 'posting-announcement',
        title: 'Posting the announcement',
        paragraphs: [
          'Before posting, confirm the Title and Message, intended recipients, and selected delivery methods. Select Post Announcement only when the announcement details are ready.',
        ],
        bullets: ['Cancel', 'Post Announcement'],
        when: () => true,
      },
      {
        id: 'viewing-announcements',
        title: 'Viewing announcements',
        paragraphs: [
          'Announcements available to users can be viewed from the Dashboard Announcements panel. Use View all to open the announcement list.',
          'An announcement detail view can show Full message, Who posted it, Date/time, Recipient count, and Delivery method. The detail view provides a way to return to the announcement list.',
          'This viewing experience is separate from the Send Announcement page.',
        ],
        when: () => true,
      },
    ],
    keywords: ['announcements', 'send announcement', 'recipients', 'delivery'],
    enabled: true,
  },
  {
    key: 'search',
    version: 1,
    title: 'Global Search Guide',
    matches: (pathname) => pathname === '/search',
    commonSections: [
      {
        id: 'about-global-search',
        title: 'About Global Search',
        paragraphs: [
          'Global Search is used to search across DMS document content and available document information. It is opened from the search field in the top navigation.',
          'Global Search is different from the search inside Document Library: Document Library search narrows the current library view, while Global Search searches document content across the DMS information available to the signed-in user.',
          'Search does not bypass document access.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'searching-for-documents',
        title: 'Searching for documents',
        paragraphs: [
          'Enter a phrase in the Search documents field, then select Search or press Enter. The field accepts content, file name, or Doc ID searches.',
          'When available, search suggestions can appear as you type; select a suggestion to search for it. More specific search terms can help narrow results.',
        ],
        when: () => true,
      },
      {
        id: 'understanding-search-results',
        title: 'Understanding search results',
        paragraphs: [
          'Search results can show Doc ID, File name, Type, Folder, Department, Owner, Creation date, Modified date, Tags, and Status.',
          'The results area can also show a file-type icon and actions for each result. Results are limited to documents and information available to the signed-in user.',
        ],
        when: () => true,
      },
      {
        id: 'filtering-search-results',
        title: 'Filtering search results',
        paragraphs: [
          'Open Advanced DMS metadata filters to narrow the current result set. The available filters are Status, Owner, File Type, From Date, and To Date.',
          'Use Reset to clear the metadata filters, then select Search DMS metadata to run the filtered metadata search.',
        ],
        bullets: ['Status', 'Owner', 'File Type', 'From Date', 'To Date'],
        when: () => true,
      },
      {
        id: 'opening-search-result',
        title: 'Opening a search result',
        paragraphs: [
          'Select a file name or the Open in Document Library action to open the related document in the normal Document Library preview experience. You can also use Download when an uploaded file version is available.',
          'Opening a result does not grant additional access.',
        ],
        when: () => true,
      },
      {
        id: 'search-and-access',
        title: 'Search and access',
        paragraphs: [
          'Search results follow the access available to the signed-in account. A document that is not available to you should not be treated as accessible simply because its name is known.',
          'Folder and document permissions remain separate from general page access, so different users may receive different results.',
        ],
        when: () => true,
      },
      {
        id: 'if-document-not-found',
        title: 'If you cannot find a document',
        paragraphs: [
          'Check the search term, try a more specific or simpler term, review any active filters, and confirm that you are looking for the intended document.',
          'Remember that the document may not be available to your account. If access is expected but the document remains unavailable, contact your manager or the appropriate DMS administrator.',
        ],
        when: () => true,
      },
    ],
    keywords: ['global search', 'documents', 'metadata', 'filters', 'access'],
    enabled: true,
  },
  {
    key: 'admin-users',
    version: 1,
    title: 'Admin Users Guide',
    matches: (pathname) => pathname === '/admin/users',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-user-management',
        title: 'About User Management',
        paragraphs: [
          'The Users page is used by authorized administrators to manage DMS user accounts and their access.',
          'The page provides user summary information, user search and filtering, user account creation, Role / Page Access assignment, group membership management, account status management, and authentication-related actions where applicable.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'user-summary',
        title: 'User summary',
        paragraphs: ['Summary cards provide a quick overview of current user-account status.'],
        bullets: ['Total Users', 'Active', 'Inactive', 'Online Now', 'Offline'],
        when: () => true,
      },
      {
        id: 'searching-filtering-users',
        title: 'Searching and filtering users',
        paragraphs: [
          'Use Search users to narrow the list. The users table uses server pagination, and Clear filters resets the current search and filters.',
        ],
        bullets: ['Access', 'Auth Type: Local or Google', 'Status: Active or Inactive'],
        when: () => true,
      },
      {
        id: 'users-table',
        title: 'Users table',
        paragraphs: [
          'The table can display User, Access, Auth Type, Status, Session, Joined, and Actions. Available actions depend on the selected user and account type.',
        ],
        when: () => true,
      },
      {
        id: 'adding-user',
        title: 'Adding a user',
        paragraphs: [
          'Select Add User to open the user form. Review the account information and assigned access before creating the user.',
        ],
        bullets: ['Full Name', 'Email', 'Password', 'Role / Page Access', 'Groups'],
        when: () => true,
      },
      {
        id: 'editing-user-access',
        title: 'Editing user access',
        paragraphs: [
          'Administrators can manage supported user information such as Full name, Email where applicable, Role / Page Access, and Active status.',
          'Changing the assigned role changes the Page Access profile associated with that account. A role change does not automatically grant access to every folder or document.',
        ],
        when: () => true,
      },
      {
        id: 'managing-user-groups',
        title: 'Managing user groups',
        paragraphs: [
          "Manage Groups opens the user's group-membership controls. The administrator can review available groups and update the user's group membership.",
          'Group membership is separate from the user\'s Page Access role and does not by itself grant every folder or document permission.',
        ],
        when: () => true,
      },
      {
        id: 'authentication-password',
        title: 'Authentication and password',
        paragraphs: [
          'The Users page identifies whether an account uses Local or Google authentication. For local-authenticated users, Reset Password may be available; Google-authenticated users do not expose the local password-reset action.',
          'The Reset Password dialog includes New Password.',
        ],
        when: () => true,
      },
      {
        id: 'deactivating-user',
        title: 'Deactivating a user',
        paragraphs: [
          'Deactivate User is a separate account-management action and requires confirmation. Before changing a user\'s status, confirm that the action is intended for the correct account.',
        ],
        when: () => true,
      },
      {
        id: 'permanent-user-deletion',
        title: 'Permanent user deletion',
        paragraphs: [
          'Permanent deletion is destructive and requires confirmation. The deletion flow may identify resources owned by the user, such as Documents, Tasks, and E-signatures.',
          'Where ownership transfer is available, the administrator can select an ownership-transfer target before deletion. Permanent deletion should only be used when account removal is intended and the ownership impact has been reviewed.',
        ],
        bullets: ['Transfer & Delete', 'Delete Permanently'],
        when: () => true,
      },
      {
        id: 'importing-users',
        title: 'Importing users',
        paragraphs: [
          'Import CSV can be used to import user information in bulk. After import, the Import Results dialog displays the outcome; review the results before assuming all entries were created successfully.',
        ],
        when: () => true,
      },
    ],
    keywords: ['admin users', 'user management', 'page access', 'groups', 'authentication'],
    enabled: true,
  },
  {
    key: 'admin-roles',
    version: 1,
    title: 'Admin Roles Guide',
    matches: (pathname) => pathname === '/admin/roles',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-roles',
        title: 'About Roles',
        paragraphs: [
          'The Roles page is used by authorized administrators to define Page & Feature Access for DMS roles.',
          'A role can control access to DMS pages, Document Workflow stages, task capabilities, folder/file capabilities, reminder and announcement capabilities, and bulk and OCR-related capabilities.',
          'Roles define platform-level capabilities. Folder and document access can still differ separately from the user\'s role.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'understanding-role-cards',
        title: 'Understanding role cards',
        paragraphs: [
          'The page displays role cards for built-in roles and custom roles. Built-in roles are shown before custom roles.',
          'Role cards can display Can see / page-access badges, feature/capability access, and Document Workflow access. If no page access is enabled, a role may show a “No pages” indication.',
        ],
        bullets: ['Built-in roles', 'Custom roles'],
        when: () => true,
      },
      {
        id: 'creating-role',
        title: 'Creating a role',
        paragraphs: [
          'Select New Role to create a custom role. Before creating a role, choose a clear role name and review the page access, workflow-stage access, and additional capabilities granted.',
        ],
        bullets: ['Role Name', 'Page / feature permission checkboxes', 'Document Workflow permission checkboxes'],
        when: () => true,
      },
      {
        id: 'page-feature-access',
        title: 'Page & Feature Access',
        paragraphs: [
          'Role permissions can include access to Dashboard, Document Library, Document Workflow / Approvals, PCAR, Reminders, Admin Panel, and Send Announcements.',
          'Additional capabilities may include task creation and assignment/reassignment, reminder deletion, folder/file capabilities, bulk actions, OCR re-indexing, and document-version capabilities.',
        ],
        when: () => true,
      },
      {
        id: 'document-workflow-access',
        title: 'Document Workflow access',
        paragraphs: [
          'Role configuration can separately control access to workflow stages such as QA Review, Manager Review, and Final Release. Additional workflow capabilities can include Approve, Reject, and Resolve Document ID.',
          'Giving a user access to the Document Workflow page does not necessarily mean they can access every workflow stage.',
        ],
        when: () => true,
      },
      {
        id: 'editing-role',
        title: 'Editing a role',
        paragraphs: [
          'Edit role allows an administrator to rename the role, update Page & Feature Access, update Document Workflow permissions, and update other supported capability flags.',
          'Role changes affect users assigned to that role. Before saving substantial permission changes, review the enabled capabilities carefully.',
        ],
        when: () => true,
      },
      {
        id: 'built-in-custom-roles',
        title: 'Built-in and custom roles',
        paragraphs: [
          'The DMS distinguishes between built-in and custom roles. Built-in roles can be edited where the current UI permits but cannot be deleted. Custom roles can be deleted where permitted by the Roles page.',
        ],
        when: () => true,
      },
      {
        id: 'deleting-custom-role',
        title: 'Deleting a custom role',
        paragraphs: [
          'Deleting a custom role is an access-impacting action and requires confirmation. The current UI warns that users assigned to the deleted custom role will be reset to No Access.',
          'Before deleting a role, confirm the correct role is selected, review whether users are still assigned to it, and review the access impact. Built-in roles are not deletable.',
        ],
        when: () => true,
      },
      {
        id: 'role-vs-item-access',
        title: 'Role access vs folder and document access',
        paragraphs: [
          'Role permissions and item-level access are separate concepts. A role can make a page or feature available, but individual folders, documents, and actions may still depend on separate permissions.',
          'Two users with the same role may not necessarily see the same folder or document content.',
        ],
        when: () => true,
      },
    ],
    keywords: ['admin roles', 'page access', 'workflow access', 'custom roles', 'permissions'],
    enabled: true,
  },
  {
    key: 'admin-groups',
    version: 1,
    title: 'Admin Groups Guide',
    matches: (pathname) => pathname === '/admin/groups',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-groups',
        title: 'About Groups',
        paragraphs: [
          'The Groups page is used by authorized administrators to organize DMS users into groups.',
          'Groups can be used to manage group information, user membership, and sub-group relationships. Group membership is separate from the user\'s Page Access role.',
          'Belonging to a group does not automatically grant access to every page, folder, or document.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'groups-table',
        title: 'Groups table',
        paragraphs: [
          'The table can display Group Name, Description, Manage Users, Manage Sub-groups, Subgroups, and Actions. The available controls apply to the selected group.',
          'The page can also display No groups yet, a loading state, or an error state with Retry.',
        ],
        bullets: ['Group Name', 'Description', 'Manage Users', 'Manage Sub-groups', 'Subgroups', 'Actions'],
        when: () => true,
      },
      {
        id: 'creating-group',
        title: 'Creating a group',
        paragraphs: [
          'Select Add Group to open the group form. Review the group name and purpose before creating it.',
        ],
        bullets: ['Name', 'Description'],
        when: () => true,
      },
      {
        id: 'editing-group',
        title: 'Editing a group',
        paragraphs: [
          'Edit Group allows an administrator to update the Name and Description. Changing group information does not by itself change a user\'s Page Access role.',
        ],
        when: () => true,
      },
      {
        id: 'managing-group-members',
        title: 'Managing group members',
        paragraphs: [
          'Manage Users opens the membership controls for the selected group. The administrator can review current members, search users, select users to add, and remove existing members.',
          'Before removing a member, confirm that the correct user and group are selected.',
        ],
        bullets: ['Loading members', 'No members', 'No matching users'],
        when: () => true,
      },
      {
        id: 'managing-subgroups',
        title: 'Managing sub-groups',
        paragraphs: [
          'Manage Sub-groups allows an administrator to manage child-group relationships. The controls can include selecting an available child group, adding the subgroup relationship, and removing an existing subgroup.',
          'The interface may display Loading subgroups or No subgroups.',
        ],
        when: () => true,
      },
      {
        id: 'importing-groups',
        title: 'Importing groups',
        paragraphs: [
          'Import CSV can be used to import group information in bulk. After import, the Import Results dialog displays the outcome; review the import results before assuming every record was created successfully.',
        ],
        when: () => true,
      },
      {
        id: 'deleting-group',
        title: 'Deleting a group',
        paragraphs: [
          'Delete Group is a destructive group-management action and requires confirmation.',
          'Before deletion, confirm the correct group is selected, review its current members and subgroup relationships, and confirm that removal of the group is intended. Deleting a group does not state that the user accounts themselves are deleted.',
        ],
        when: () => true,
      },
      {
        id: 'groups-and-access',
        title: 'Groups and access',
        paragraphs: [
          'Group membership and Page Access roles are separate. A user\'s access can also depend on folder/document permissions and other assigned capabilities.',
          'Do not assume that all members of a group have identical Page Access, that group membership alone provides access to every folder or document, or that removing a user from a group changes their Page Access role.',
        ],
        when: () => true,
      },
    ],
    keywords: ['admin groups', 'group membership', 'sub-groups', 'page access'],
    enabled: true,
  },
  {
    key: 'admin-audit',
    version: 1,
    title: 'Admin Audit Trail Guide',
    matches: (pathname) => pathname === '/admin/audit',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-audit-trail',
        title: 'About Audit Trail',
        paragraphs: [
          'The Audit Trail page provides a read-only history of recorded DMS activities available to authorized administrators.',
          'It is used to review recorded activity, search audit entries, filter events, review event details, and export audit log information.',
          'Audit Trail records are viewed here; this page does not provide controls for editing or deleting audit entries.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'audit-summary',
        title: 'Audit summary',
        paragraphs: ['The page includes summary information such as Total Logs, Active Users, and Document Actions. Some summary values relate to the currently loaded page context where applicable.'],
        bullets: ['Total Logs', 'Active Users', 'Document Actions'],
        when: () => true,
      },
      {
        id: 'searching-audit-events',
        title: 'Searching audit events',
        paragraphs: ['Use the search control to narrow audit entries using information such as User, Action, or Details. Search results reflect the current audit-log view.'],
        bullets: ['User', 'Action', 'Details'],
        when: () => true,
      },
      {
        id: 'filtering-audit-events',
        title: 'Filtering audit events',
        paragraphs: ['Available filters include Action Type and a date range. These filters help narrow the audit records being reviewed.'],
        bullets: ['Action Type', 'From', 'To'],
        when: () => true,
      },
      {
        id: 'audit-table',
        title: 'Audit table',
        paragraphs: [
          'The visible table includes Timestamp, User, Action, and Details. The page uses pagination to move through available audit entries.',
          'The table may also display a loading state, an API error with Retry, or No audit logs found.',
        ],
        bullets: ['Timestamp', 'User', 'Action', 'Details'],
        when: () => true,
      },
      {
        id: 'viewing-event-details',
        title: 'Viewing event details',
        paragraphs: ['Long audit details can be opened in a detail popover. The interface presents metadata in a human-readable form.'],
        when: () => true,
      },
      {
        id: 'exporting-audit-logs',
        title: 'Exporting audit logs',
        paragraphs: ['Select Export Logs to export the audit information provided by the current Audit Trail functionality. The export is intended for reviewing or retaining audit information outside the on-screen table.'],
        when: () => true,
      },
      {
        id: 'audit-trail-records',
        title: 'Audit Trail records',
        paragraphs: [
          'Audit Trail is intended for reviewing recorded system activity. The current page does not provide edit or delete controls for audit records.',
          'Use search and filters to locate the event you need before drawing conclusions from a large result set. Review the event details and context when investigating an activity.',
        ],
        when: () => true,
      },
    ],
    keywords: ['admin audit', 'audit trail', 'activity', 'logs', 'events'],
    enabled: true,
  },
  {
    key: 'admin-settings',
    version: 1,
    title: 'Admin Settings Guide',
    matches: (pathname) => pathname === '/admin/settings',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-platform-settings',
        title: 'About Platform Settings',
        paragraphs: [
          'The Settings page is used by authorized administrators to configure platform-wide DMS settings.',
          'The page includes configuration areas for General platform information, Login page appearance/content, Header appearance, Security settings, and Reset to Defaults.',
          'Changes on this page can affect the DMS experience for multiple users. Review settings carefully before saving.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'general-settings',
        title: 'General settings',
        paragraphs: ['The General section controls general platform information and display configuration.'],
        bullets: ['Platform Name', 'Organization Name', 'Support Email', 'Timezone', 'Date Format', 'Save Changes'],
        when: () => true,
      },
      {
        id: 'login-page-settings',
        title: 'Login page settings',
        paragraphs: ['Administrators can configure login-page presentation. These settings affect what users see on the DMS login page.'],
        bullets: [
          'Login logo upload',
          'Page Title',
          'Page Subtitle',
          'Card Title',
          'Card Subtitle',
          'Footer Line 1',
          'Footer Line 2',
          'Footer Email',
          'Show “Continue with Google”',
          'Save Login Settings',
        ],
        when: () => true,
      },
      {
        id: 'header-settings',
        title: 'Header settings',
        paragraphs: ['The Header section controls the top-bar presentation.'],
        bullets: ['Header logo upload', 'Show Logo in Header', 'Logo Alt Text', 'Save Header Settings'],
        when: () => true,
      },
      {
        id: 'security-settings',
        title: 'Security settings',
        paragraphs: [
          'The Security section contains platform-level settings for Session Timeout, Allow Multiple Sessions, Require Strong Passwords, and Password Expiry.',
          'These settings can affect authentication and session behavior across the DMS. Review intended security requirements before saving changes.',
        ],
        bullets: ['Session Timeout', 'Allow Multiple Sessions', 'Require Strong Passwords', 'Password Expiry', 'Save Security Settings'],
        when: () => true,
      },
      {
        id: 'saving-settings',
        title: 'Saving settings',
        paragraphs: [
          'Each settings area provides its own Save action where applicable. After changing values, review the updated fields, use the Save action for that section, and confirm the visible success or error feedback before assuming the change was applied.',
        ],
        when: () => true,
      },
      {
        id: 'reset-to-defaults',
        title: 'Reset to Defaults',
        paragraphs: [
          'Reset to Defaults restores platform settings to their default values and requires confirmation. The current behavior can also remove uploaded branding assets such as the Login logo and Header logo.',
          'Before using Reset to Defaults, confirm that a reset is intended and review the settings and branding that will be affected. Do not use reset as a troubleshooting shortcut without understanding the impact.',
        ],
        bullets: ['Login logo', 'Header logo'],
        when: () => true,
      },
    ],
    keywords: ['admin settings', 'platform settings', 'security', 'branding'],
    enabled: true,
  },
  {
    key: 'admin-notifications',
    version: 1,
    title: 'Admin Notifications Guide',
    matches: (pathname) => pathname === '/admin/notifications',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-notification-configuration',
        title: 'About Notification Configuration',
        paragraphs: [
          'The Notifications page is used by authorized administrators to configure DMS notification delivery.',
          'The page provides controls for Global Notification Delivery, email delivery configuration, In-App delivery status, sending method, sender information, saving configuration, and sending a test email.',
          'Changes on this page can affect notification delivery for DMS users.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'global-notification-delivery',
        title: 'Global Notification Delivery',
        paragraphs: [
          'The page shows whether global notification delivery is Enabled or Disabled and displays the current delivery status for Email and In-App notifications.',
          'Disabling global notification delivery suspends Email and In-App notification delivery while normal DMS business operations can continue.',
        ],
        bullets: ['Enabled', 'Disabled', 'Email', 'In-App notifications'],
        when: () => true,
      },
      {
        id: 'choosing-sending-method',
        title: 'Choosing a sending method',
        paragraphs: [
          'The currently supported sending methods are Gmail App Password and Google Workspace SMTP Relay. The page provides setup guidance for the selected method.',
          'Choose the sending method that matches the organization\'s approved email configuration.',
        ],
        bullets: ['Gmail App Password', 'Google Workspace SMTP Relay'],
        when: () => true,
      },
      {
        id: 'email-configuration',
        title: 'Email configuration',
        paragraphs: [
          'The configuration form can include Gmail / Workspace Email, App Password, and Sender Name.',
          'App Password is sensitive credential information. Enter credentials only in the intended configuration field and do not share them in screenshots, tickets, chat messages, or documentation.',
        ],
        bullets: ['Gmail / Workspace Email', 'App Password', 'Sender Name'],
        when: () => true,
      },
      {
        id: 'saving-notification-configuration',
        title: 'Saving configuration',
        paragraphs: [
          'After reviewing the selected sending method and configuration fields, use Save Configuration. The page provides visible success or error feedback after save attempts.',
          'Before assuming configuration is active, confirm that the save completed successfully.',
        ],
        when: () => true,
      },
      {
        id: 'testing-email-delivery',
        title: 'Testing email delivery',
        paragraphs: [
          'Send Test Email can be used to verify the currently saved email configuration. Confirm the intended configuration is saved and that sending a test email is appropriate before using it, then review the visible success or error feedback.',
        ],
        when: () => true,
      },
      {
        id: 'disabling-notification-delivery',
        title: 'Disabling notification delivery',
        paragraphs: [
          'Disabling notification delivery is a platform-wide action. The current interface requires confirmation by entering Off.',
          'Email delivery and In-App notification delivery are suspended while normal DMS business operations can continue. Before disabling, confirm that the interruption is intended, consider its effect on users, and verify the correct environment is being changed.',
        ],
        bullets: ['Type Off to confirm', 'Email delivery suspended', 'In-App notification delivery suspended'],
        when: () => true,
      },
      {
        id: 'notification-troubleshooting',
        title: 'Notification troubleshooting',
        paragraphs: [
          'If email delivery does not work, review the selected sending method, review the entered configuration, check the visible save/test feedback, and review the SMTP/network troubleshooting guidance shown on the page.',
          'Do not expose SMTP passwords, App Passwords, tokens, secrets, or connection credentials.',
        ],
        when: () => true,
      },
    ],
    keywords: ['admin notifications', 'email delivery', 'in-app notifications', 'SMTP'],
    enabled: true,
  },
  {
    key: 'admin-company-data',
    version: 1,
    title: 'Admin Company Data Guide',
    matches: (pathname) => pathname === '/admin/company-data',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-company-data',
        title: 'About Company Data',
        paragraphs: [
          'The Company Data page is used by authorized administrators to maintain shared reference lists used across the DMS.',
          'The current managed lists are Departments, Document Categories, and Tags. Changes to these lists can affect the options available elsewhere in the DMS.',
          'Review changes carefully before adding or removing values.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'departments',
        title: 'Departments',
        paragraphs: ['The Departments list contains department values available for use in the DMS.'],
        bullets: ['Add item', 'Search', 'Show all / Show less', 'Import', 'Export', 'Remove item'],
        when: () => true,
      },
      {
        id: 'document-categories',
        title: 'Document Categories',
        paragraphs: ['The Document Categories list defines category values available when working with documents.'],
        bullets: ['Add item', 'Search', 'Show all / Show less', 'Import', 'Export', 'Remove item'],
        when: () => true,
      },
      {
        id: 'tags',
        title: 'Tags',
        paragraphs: ['The Tags list contains reusable tag values available in the DMS.'],
        bullets: ['Add item', 'Search', 'Show all / Show less', 'Import', 'Export', 'Remove item'],
        when: () => true,
      },
      {
        id: 'adding-company-data',
        title: 'Adding company data',
        paragraphs: [
          'Use the Add control in the intended list to add a new value. Before adding an item, confirm the correct list is being edited, use a clear value appropriate for DMS users, and review the existing list to avoid unnecessary duplicates.',
        ],
        when: () => true,
      },
      {
        id: 'searching-viewing-lists',
        title: 'Searching and viewing lists',
        paragraphs: [
          'Each managed list provides controls to help review its values. These can include Search, Show all, Show less, and Item count.',
          'The page may display a loading state or No items yet.',
        ],
        bullets: ['Search', 'Show all', 'Show less', 'Item count'],
        when: () => true,
      },
      {
        id: 'importing-company-data',
        title: 'Importing company data',
        paragraphs: [
          'The page supports importing list data from .csv, .xlsx, and .xls files. Before importing, confirm the correct Company Data list, review the source file, and review the result after import.',
        ],
        bullets: ['.csv', '.xlsx', '.xls'],
        when: () => true,
      },
      {
        id: 'exporting-company-data',
        title: 'Exporting company data',
        paragraphs: ['Export can be used to download the values from the relevant managed list using the current page functionality. Use export when a copy of the current list is needed for review or maintenance.'],
        when: () => true,
      },
      {
        id: 'removing-company-data',
        title: 'Removing company data',
        paragraphs: [
          'Remove deletes a value from the selected Company Data list. Before removing an item, confirm the correct list and value, consider whether the value is still used by DMS users or records, and confirm that removal is intended.',
        ],
        when: () => true,
      },
    ],
    keywords: ['company data', 'departments', 'categories', 'tags', 'reference lists'],
    enabled: true,
  },
  {
    key: 'admin-database',
    version: 1,
    title: 'Admin Database Guide',
    matches: (pathname) => pathname === '/admin/database',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-database-administration',
        title: 'About Database Administration',
        paragraphs: [
          'The Database page provides administrative controls for DMS data, backups, OCR indexing, maintenance, and recovery operations.',
          'It includes Document OCR Index, Database Backup, Restore from Backup, Document Metadata Export, Scheduled Backups, Recycle Bin, Clear Data, and System Controls.',
          'Some actions on this page can affect or permanently remove DMS data. Use them only when the intended impact is fully understood.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'document-ocr-index',
        title: 'Document OCR Index',
        paragraphs: [
          'This area shows OCR indexing status for documents. Visible controls can include Refresh, Re-index selected, Re-index all missing, and Re-index all files.',
          'The table can include Document, File, and Status. Re-indexing can trigger processing across one or many documents, so use broad re-index actions only when required.',
        ],
        when: () => true,
      },
      {
        id: 'database-backup',
        title: 'Database backup',
        paragraphs: [
          'The backup area provides controls for creating or downloading database backups, including Download Backup. A backup can be used as a recovery point before significant administrative work.',
        ],
        when: () => true,
      },
      {
        id: 'restore-from-backup',
        title: 'Restore from Backup',
        paragraphs: [
          'Restore from Backup is a high-impact operation. The page supports uploading a .sql backup and restoring from the selected backup. Restoring a backup can overwrite the current DMS database state.',
          'Before restoring, confirm the backup belongs to the intended environment, confirm that restoring current data is intentional, confirm the recovery plan with the appropriate administrator, and ensure a suitable current backup exists when required by procedure.',
        ],
        when: () => true,
      },
      {
        id: 'document-metadata-export',
        title: 'Document Metadata Export',
        paragraphs: ['The page provides Export Documents CSV for document metadata. This export is separate from a database backup.'],
        when: () => true,
      },
      {
        id: 'scheduled-backups',
        title: 'Scheduled Backups',
        paragraphs: [
          'Administrators can configure automatic backups using options such as Enable Automatic Backups, frequency, time, day, retention count, destination path, Save Schedule, Run Backup Now, and downloading saved backup files.',
          'Supported frequencies can include Hourly, Daily, Weekly, and Monthly. Optional network-share configuration may also be available; network-share credentials are sensitive and must not be shared.',
        ],
        when: () => true,
      },
      {
        id: 'recycle-bin',
        title: 'Recycle Bin',
        paragraphs: [
          'The Recycle Bin can contain deleted DMS items that are still available for recovery. Restore recovers an item; Delete Selected permanently and Empty Recycle Bin are destructive.',
          'Permanent deletion should only be used when recovery is no longer required.',
        ],
        bullets: ['Restore item', 'Delete Selected permanently', 'Empty Recycle Bin'],
        when: () => true,
      },
      {
        id: 'clear-data',
        title: 'Clear Data',
        paragraphs: [
          'The Clear Data area contains destructive administrative actions, including per-module Clear controls and Clear All Data — Every Module. These actions use typed confirmation such as DELETE or DELETE ALL.',
          'Clear Data can permanently remove DMS data, and Clear All Data can affect multiple modules across the system. These controls must never be used as a troubleshooting shortcut.',
          'Before any clear operation, confirm the exact scope, the correct environment, that deletion is explicitly intended, and that required backups exist.',
        ],
        when: () => true,
      },
      {
        id: 'system-controls',
        title: 'System Controls',
        paragraphs: [
          'Current system controls can include Maintenance Mode, Maintenance message, Scheduled Maintenance Notice, Announcement message, Start Date & Time, End Date & Time, and Force sign-out all users.',
          'Maintenance-related settings affect system availability or user communication. Force sign-out all users is a broad-impact administrative action. Use these controls only for planned administrative work.',
        ],
        when: () => true,
      },
      {
        id: 'before-high-impact-actions',
        title: 'Before high-impact actions',
        paragraphs: [
          'Before using Restore, permanent deletion, Clear Data, Clear All Data, Force sign-out, or other broad-impact controls, verify the correct environment and intended scope, review the expected impact, confirm that appropriate backups exist where required, and follow the organization\'s approved change and recovery process.',
          'If there is uncertainty, stop before executing the action.',
        ],
        when: () => true,
      },
    ],
    keywords: ['admin database', 'backup', 'restore', 'recycle bin', 'clear data', 'system controls'],
    enabled: true,
  },
  {
    key: 'admin-api-keys',
    version: 1,
    title: 'Admin API Keys Guide',
    matches: (pathname) => pathname === '/admin/api-keys',
    requiredAccess: 'canViewAdminPanel',
    commonSections: [
      {
        id: 'about-ai-provider-settings',
        title: 'About AI Provider Settings',
        paragraphs: [
          'The API Keys page is used by authorized administrators to configure AI providers used by DMS AI functionality.',
          'The current page supports provider configuration and AI Assistant prompt settings. Changes here can affect AI functionality across the DMS.',
          'Review configuration carefully before saving.',
        ],
      },
    ],
    conditionalSections: [
      {
        id: 'ai-providers',
        title: 'AI providers',
        paragraphs: ['The current provider cards include OpenAI-compatible and Anthropic Claude. Each provider can show configuration status and available settings.'],
        bullets: ['OpenAI-compatible', 'Anthropic Claude'],
        when: () => true,
      },
      {
        id: 'provider-settings',
        title: 'Provider settings',
        paragraphs: [
          'Provider configuration can include enabling or disabling a provider, primary provider selection, API endpoint, Model, API key, and Configured / no saved key status.',
          'When both supported providers are enabled, the page can indicate automatic fallback availability.',
        ],
        when: () => true,
      },
      {
        id: 'api-key-safety',
        title: 'API key safety',
        paragraphs: [
          'API keys are sensitive credentials. Enter keys only in the intended API key field and never share them in screenshots, tickets, chat messages, documentation, or source code.',
          'The interface may provide a show/hide control while entering a key. A saved key\'s secret value should not be expected to be displayed back to the user. The current UI states that saved keys are encrypted and are not returned to the browser.',
        ],
        when: () => true,
      },
      {
        id: 'primary-provider-fallback',
        title: 'Primary provider and fallback',
        paragraphs: [
          'Administrators can select a primary AI provider. When multiple providers are enabled, the page may show fallback availability.',
          'Before changing provider priority, confirm the intended provider configuration, confirm the required provider is enabled, and review the selected model and endpoint where applicable.',
        ],
        when: () => true,
      },
      {
        id: 'saving-provider-settings',
        title: 'Saving provider settings',
        paragraphs: [
          'Use Save all providers after reviewing the intended provider configuration. Verify enabled or disabled providers, the primary provider, endpoint and model fields, and the intended credential where required.',
          'Review visible success or error feedback after saving.',
        ],
        when: () => true,
      },
      {
        id: 'testing-saved-connection',
        title: 'Testing a saved connection',
        paragraphs: [
          'Test saved connection can be used to check an already saved provider configuration. Confirm that the intended provider configuration has been saved, that testing the external provider is appropriate, and review the result shown by the page.',
        ],
        when: () => true,
      },
      {
        id: 'removing-saved-key',
        title: 'Removing a saved key',
        paragraphs: [
          'Remove key removes the stored credential for the selected provider and requires confirmation. Removing a key can make that provider unavailable until a valid credential is configured again.',
          'Before removing, confirm the correct provider, confirm the removal is intended, and consider the impact if that provider is currently enabled or primary.',
        ],
        when: () => true,
      },
      {
        id: 'ai-assistant-prompts',
        title: 'AI Assistant prompts',
        paragraphs: [
          'The page also includes configurable prompts for the DMS AI Assistant. Prompt changes can affect how the AI Assistant interprets questions and prepares responses.',
        ],
        bullets: ['Answer Generation', 'Query Understanding', 'Save prompts', 'Reset to default'],
        when: () => true,
      },
      {
        id: 'resetting-prompts',
        title: 'Resetting prompts',
        paragraphs: [
          'Reset to default restores the relevant prompt configuration to its default value. Before resetting, confirm the intended prompt and review whether custom prompt changes are still required.',
        ],
        when: () => true,
      },
    ],
    keywords: ['admin API keys', 'AI providers', 'API key safety', 'AI Assistant prompts'],
    enabled: true,
  },
];

export function resolveGuide(pathname: string): GuideDefinition | null {
  return guideRegistry.find((guide) => guide.matches(pathname)) ?? null;
}

export function selectVisibleSections(
  definition: GuideDefinition,
  access: PageAccessRoleFlags,
): GuideSection[] {
  return [
    ...definition.commonSections,
    ...(definition.conditionalSections ?? []).filter((section) => section.when(access)),
  ];
}
