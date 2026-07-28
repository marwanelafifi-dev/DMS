# DMS Design System v1.0
## Enterprise Document Management System UI

**Date:** 2026-07-16  
**Status:** ✅ Approved Specifications  
**Framework:** React 18 + TypeScript + Tailwind CSS + shadcn/ui  
**Target:** WCAG 2.1 AA Compliance

---

## 1. Brand Identity

### Color Palette

#### Primary Colors (Si-Ware Brand)
```css
/* Professional Blue */
--primary-50:   #f0f5ff
--primary-100:  #e0ebff
--primary-200:  #c2d7ff
--primary-300:  #a3c3ff
--primary-400:  #84afff
--primary-500:  #5b9bff /* Primary Blue */
--primary-600:  #4682e6
--primary-700:  #3a6dd9
--primary-800:  #2e58cc
--primary-900:  #1f3a8a

/* White & Grays */
--white:        #ffffff
--gray-50:      #f9fafb
--gray-100:     #f3f4f6
--gray-200:     #e5e7eb
--gray-300:     #d1d5db
--gray-400:     #9ca3af
--gray-500:     #6b7280
--gray-600:     #4b5563
--gray-700:     #374151
--gray-800:     #1f2937
--gray-900:     #111827
```

#### Semantic Colors
```css
--success:      #10b981  /* Green - Approved, Complete */
--warning:      #f59e0b  /* Amber - Pending, In Progress */
--error:        #ef4444  /* Red - Rejected, Error */
--info:         #3b82f6  /* Blue - Information, Help */
```

#### Dark Mode (Auto)
```css
/* Auto switches based on system preference */
/* Light mode: light backgrounds, dark text */
/* Dark mode: dark backgrounds, light text */
```

---

## 2. Typography

### Font Family
```css
/* System fonts for better performance */
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", 
             "Helvetica Neue", Arial, sans-serif;
--font-mono: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", 
             Consolas, "Courier New", monospace;
```

### Font Sizes & Weights
```
Heading 1 (H1):  32px / 40px  | Weight: 700 | Letter Spacing: -0.5px
Heading 2 (H2):  28px / 36px  | Weight: 600 | Letter Spacing: -0.3px
Heading 3 (H3):  24px / 32px  | Weight: 600 | Letter Spacing: 0px
Heading 4 (H4):  20px / 28px  | Weight: 600 | Letter Spacing: 0px
Body Large:      18px / 28px  | Weight: 400 | Letter Spacing: 0px
Body:            16px / 24px  | Weight: 400 | Letter Spacing: 0px
Body Small:      14px / 20px  | Weight: 400 | Letter Spacing: 0px
Label:           12px / 16px  | Weight: 500 | Letter Spacing: 0.5px
Caption:         11px / 16px  | Weight: 400 | Letter Spacing: 0px
```

---

## 3. Layout System

### Grid & Spacing
```
Base Unit: 4px
Spacing Scale: 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px

Container Max Width: 1920px (2K+ screens)
Safe Padding: 16px (mobile), 24px (tablet), 32px (desktop)
```

### Responsive Breakpoints
```
sm:   640px   (Small phones)
md:   768px   (Tablets)
lg:  1024px   (Small desktops)
xl:  1280px   (Large desktops)
2xl: 1536px   (4K monitors)
```

### Layout Patterns

#### Desktop (1024px+)
```
┌─────────────────────────────────┐
│  Logo  │  Breadcrumb  │  User   │ ← Top Navbar (64px)
├────────┬─────────────────────────┤
│        │                         │
│ Sidebar│  Main Content Area      │
│        │                         │
│ (280px)│  (1024px - 280px - 32px)│
└────────┴─────────────────────────┘
```

#### Tablet (768px - 1024px)
```
┌─────────────────────────────────┐
│  Logo  │  Menu  │ User          │ ← Top Navbar (56px)
├────────┬─────────────────────────┤
│        │                         │
│ Sidebar│  Main Content Area      │
│Collapsed
└────────┴─────────────────────────┘
```

#### Mobile (< 768px)
```
┌─────────────────────────────────┐
│ ☰ │ Logo │ Search │ User  │     ← Top Navbar (48px)
├─────────────────────────────────┤
│                                 │
│  Main Content Area (full width) │
│                                 │
└─────────────────────────────────┘
※ Sidebar: Drawer/Hamburger Menu
```

---

## 4. Navigation & Sidebar

### Top Navbar
- **Height:** 64px (desktop), 56px (tablet), 48px (mobile)
- **Background:** White / Dark bg (dark mode)
- **Elevation:** Subtle shadow (1-2px blur)
- **Components:**
  - Logo (32x32px) - left-aligned
  - Breadcrumb (if applicable)
  - Search bar (optional, right side)
  - User menu / Notifications (right side)

### Left Sidebar
- **Desktop:** 280px fixed, always visible
- **Tablet:** 280px collapsible (hamburger trigger)
- **Mobile:** 100vw drawer, full-screen on mobile
- **Background:** Gray-50 / Dark gray (dark mode)
- **Sections:**
  1. **My Tasks** (Kanban view badge)
  2. **Vault** (Folder tree)
  3. **Approvals** (Pending count badge)
  4. **Settings** (Bottom section)

### My Tasks Section
```
┌─ My Tasks (3)
├─ Open (2)
├─ In Progress (1)
├─ Done (0)
└─ [View All Tasks] button
```

### Vault Section (Folder Tree)
```
┌─ Vault
├─ 📁 Folder 1
│  ├─ 📁 Subfolder 1.1
│  │  └─ 📄 Document
│  └─ 📁 Subfolder 1.2
├─ 📁 Folder 2
│  └─ 📄 Document
└─ 📁 Folder 3
```

---

## 5. Component Library (shadcn/ui + Tailwind)

### Core Components
```
✅ Button
✅ Input / Textarea
✅ Select / Dropdown
✅ Checkbox / Radio
✅ Switch
✅ Modal / Dialog
✅ Toast / Alert
✅ Tooltip
✅ Badge / Label
✅ Card
✅ Tabs
✅ Progress Bar
✅ Skeleton Loader
✅ Avatar
✅ Icon (Heroicons)
✅ Breadcrumb
✅ Pagination
✅ Table
✅ Sidebar / Navigation
✅ Drawer (Mobile menu)
✅ Popover
✅ Context Menu
```

### Custom Components
```
🔨 DocumentViewer (PDF.js)
🔨 CheckoutBadge (Locked by [user] + timer)
🔨 ApprovalTimeline (Detailed workflow)
🔨 TaskKanban (Open/In Progress/Done)
🔨 FolderTree (Infinite nesting)
🔨 PermissionPanel (Role management)
🔨 AuditTable (With filters)
🔨 WorkflowStatusBadge
🔨 UserAvatar (With fallback)
```

---

## 6. Page Layouts

### 1. Dashboard (Home)
```
Layout: 2 Column
- Left: My Tasks (Kanban view)
- Right: Recent Documents + Approvals

Components:
✅ Task Kanban (Open, In Progress, Done)
✅ Document Recent List
✅ Pending Approvals Count
✅ Quick Stats (Total docs, pending, completed)
```

### 2. Vault (Document Management)
```
Layout: Sidebar + Main Content
- Left: Folder Tree
- Right: Document List / Grid

Components:
✅ Folder Tree (recursive)
✅ Document Table (sortable, filterable)
✅ Breadcrumb navigation
✅ Create button (new folder/document)
```

### 3. Document Viewer
```
Layout: Split Screen
- Left (60%): PDF Viewer (PDF.js)
- Right (40%): Document Details

Components:
✅ PDF Canvas Viewer
✅ Toolbar (zoom, print, download)
✅ Tabs: Basic Info | Details | History
✅ Action Buttons: Checkout, Approve, Reject, Download
✅ Checkout Badge (if locked)
```

### 4. Approvals
```
Layout: Table View
- List of pending approvals
- Filter by status, assignee, date

Components:
✅ Approval Table (sortable)
✅ Workflow Timeline (expandable rows)
✅ Action buttons (approve/reject)
✅ Comments section
```

### 5. Tasks
```
Layout: Kanban Board
- Columns: Open, In Progress, Done
- Cards: Task title, assignee, due date, priority

Components:
✅ Kanban Board
✅ Task Card (drag-and-drop)
✅ Task Modal (details, RCA, preventive actions)
✅ Filter/Sort options
```

### 6. Permissions
```
Layout: Settings Panel
- Folder selection
- Users list with roles
- Add/revoke permissions

Components:
✅ Folder selector
✅ User table
✅ Role dropdown
✅ Add user form
```

---

## 7. Interactions & Animations

### Transitions
```
--transition-fast:    150ms ease-in-out
--transition-normal:  300ms ease-in-out
--transition-slow:    500ms ease-in-out

Spring Animation (Framer Motion):
stiffness: 100, damping: 10, mass: 1
```

### Loading States
```
1. Skeleton Screen (preferred for content)
   - Use gray-200 animated skeleton
   - Match final layout shape

2. Spinner (for actions)
   - Circular spinner in primary color
   - Size: 24px (inline), 40px (modal)

3. Progress Bar
   - For file uploads/downloads
```

### Feedback
```
Toast Notifications:
- Success: Green + Checkmark
- Error: Red + X icon
- Info: Blue + Info icon
- Warning: Amber + Warning icon
- Position: Bottom-right
- Auto-dismiss: 4 seconds
```

---

## 8. Icons

### Icon Library: Heroicons
```
Using: heroicons/react@2
Sizes: 20px (inline), 24px (sidebar), 32px (hero)
Colors: Inherit from text color
```

### Common Icons
```
📁 Folder: folder
📄 Document: document-text
✅ Checkmark: check-circle
❌ Close: x-circle
⚙️ Settings: cog-6-tooth
🔔 Notifications: bell
👤 User: user-circle
🔒 Locked: lock-closed
🔓 Unlocked: lock-open
⬇️ Download: arrow-down-tray
⬆️ Upload: arrow-up-tray
📋 Clipboard: clipboard
🗑️ Trash: trash
✏️ Edit: pencil
⋯ Menu: ellipsis-horizontal
☰ Hamburger: bars-3
🔍 Search: magnifying-glass
```

---

## 9. Accessibility (WCAG 2.1 AA)

### Requirements
```
✅ Keyboard Navigation: Tab, Enter, Escape, Arrow keys
✅ Screen Reader: Semantic HTML, ARIA labels
✅ Color Contrast: 4.5:1 for text, 3:1 for graphics
✅ Focus Indicators: Visible blue outline
✅ Form Labels: Associated with inputs
✅ Alt Text: Images and icons
✅ Error Messages: Clear, associated with input
✅ Focus Management: Trap in modals
```

### Implementation
```
// Always include:
<label htmlFor="input-id">Label</label>
<input id="input-id" aria-required="true" />

// Semantic HTML:
<button>, <input>, <nav>, <main>, <section>, <article>

// ARIA when needed:
aria-label, aria-describedby, aria-expanded, role
```

---

## 10. Dark Mode

### Implementation
```css
/* Auto system preference */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #111827;
    --bg-secondary: #1f2937;
    --text-primary: #f9fafb;
    --text-secondary: #d1d5db;
  }
}
```

### Color Adjustments
```
Light Mode: Blue primary + White bg
Dark Mode: Light blue + Gray-900 bg

All other colors remain accessible in both modes
```

---

## 11. Component Specifications

### Button
```
Types: Primary, Secondary, Danger, Ghost
Sizes: sm (32px), md (40px), lg (48px)
States: Default, Hover, Active, Disabled, Loading
Icon: Left or right aligned
```

### Input
```
Types: Text, Email, Password, Number, Textarea
States: Default, Focus, Error, Disabled
Help Text: Below input
Label: Above input
Required Indicator: Red asterisk
```

### Modal / Dialog
```
Size: sm (400px), md (600px), lg (800px)
Header: Title + close button
Body: Content area
Footer: Action buttons (Cancel, OK)
Focus: Trapped inside modal
Backdrop: Semi-transparent dark overlay
```

### Card
```
Background: White / Dark gray
Padding: 24px
Border Radius: 8px
Elevation: Subtle shadow
Hover: Slight lift effect
```

### Badge
```
Status: success, warning, error, info, default
Sizes: sm, md, lg
Variant: Solid, outline
```

### Table
```
Header: Sticky, sortable columns
Rows: Striped (alternate gray-50)
Actions: Right-aligned action column
Pagination: Bottom
Sorting: Click header, indicator arrow
Filtering: Top toolbar with inputs
```

---

## 12. Design Tokens (Tailwind Config)

```javascript
export const config = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f5ff',
          500: '#5b9bff',
          600: '#4682e6',
          900: '#1f3a8a',
        },
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
      },
      spacing: {
        gutter: '16px',
        'sidebar-width': '280px',
        'navbar-height': '64px',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '300ms',
        slow: '500ms',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
    },
  },
};
```

---

## 13. File Structure

```
/web
├── /src
│   ├── /components
│   │   ├── /ui (shadcn/ui)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── modal.tsx
│   │   │   └── ... (more)
│   │   ├── /layout
│   │   │   ├── Navbar.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── MainLayout.tsx
│   │   ├── /pages
│   │   │   ├── Dashboard.tsx
│   │   │   ├── DocumentViewer.tsx
│   │   │   ├── Approvals.tsx
│   │   │   ├── Tasks.tsx
│   │   │   └── ... (more)
│   │   └── /custom
│   │       ├── DocumentViewer.tsx
│   │       ├── CheckoutBadge.tsx
│   │       ├── ApprovalTimeline.tsx
│   │       └── ... (more)
│   ├── /hooks
│   │   ├── useAuth.ts
│   │   ├── useDocument.ts
│   │   └── ... (more)
│   ├── /utils
│   │   ├── api.ts
│   │   ├── formatters.ts
│   │   └── ... (more)
│   ├── /styles
│   │   ├── globals.css
│   │   ├── variables.css
│   │   └── tailwind.css
│   ├── App.tsx
│   └── main.tsx
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

---

## 14. Performance

### Optimization
```
✅ Code splitting by route (React.lazy)
✅ Image optimization (next/image equivalent)
✅ Lazy loading components
✅ Memoization (React.memo, useMemo)
✅ Virtual scrolling for large lists
✅ Service worker for offline support (future)
```

---

## 15. Browser Support

```
Chrome/Brave: Latest 2 versions
Firefox: Latest 2 versions
Safari: Latest 2 versions
Edge: Latest 2 versions
Mobile: iOS 14+, Android 10+
```

---

**Status:** Ready for Frontend Implementation 🚀

