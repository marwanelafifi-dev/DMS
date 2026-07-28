# DMS Updates

## Latest Changes (2026-07-28) — OCR Accuracy, Full Metadata Search, Preview Navigation

### Real OCR (replacing mock/placeholder text)
- `docling-mock-server.js` now runs actual OCR via `tesseract.js` on uploaded images (PNG/JPG/GIF/BMP/WebP) instead of returning hardcoded text
- Uploading a file (or re-running "Extract Text" on an existing one) immediately indexes it into the searchable OCR list — previously uploads were discarded and only ~15 hardcoded demo documents were ever searchable
- Fixed a multipart/form-data parsing gap so the mock server actually reads the uploaded file's bytes and filename instead of ignoring the request body

### Full-Metadata Search
- The Document Library search box, the OCR Document Search page, and the top navbar's live autocomplete now all search **every** metadata field — owner name, file extension (with or without the leading dot), department, tags, description, tracking code, and status (raw value or human label) — not just file name and OCR content
- Matching is punctuation/whitespace-tolerant (typing `A.Khaled` matches "A. Khaled")
- Extracted shared logic into `matchesDmsMetadata` (util) and `useAllDmsDocuments` (hook) so all three search surfaces stay consistent instead of three separate implementations
- Fixed a real owner-name bug found along the way: the Document Library was showing a hardcoded fixture name ("A. Khaled") for every real uploaded document regardless of who actually uploaded it, since the API only returns an owner ID and nothing was resolving it to a name

### Search Autocomplete
- Added a live, debounced autocomplete dropdown to both the top navbar search and the OCR search page's own search box, with keyboard navigation (↑/↓/Enter/Escape), highlighted match text, and a content snippet preview

### Document Preview Navigation Fix
- Closing the document preview via the browser Back button or the "Document Library" sidebar link now actually closes the full-screen preview overlay and returns to the same folder you were browsing — previously only the explicit ✕ button worked, so those other paths left the overlay stuck on screen

### Word / PowerPoint Preview: Zoom & Page Navigation
- Added a zoom control (50%–200%, 10% steps) and page/slide navigation to the Word and PowerPoint previews
- Word documents are now paginated (3 paragraphs per page); PowerPoint shows one slide at a time
- Up/Down arrow keys navigate pages/slides from anywhere in the preview, in addition to on-screen buttons

### Excel Multi-Sheet Support
- Real `.xlsx` uploads now parse **all** sheets, not just the first
- The preview shows an Excel-style sheet-tab bar at the bottom when a file has more than one sheet

### Upload Improvements
- Description is now a required field when uploading — it displays in the document preview's metadata bar
- When uploading exactly one file, a "File name" field lets you rename it before upload (extension stays fixed to match the actual file type)
- Fixed the Document Library defaulting to a folder the signed-in user has no write permission on, which caused uploads to silently fail with a 403 unless "Mock Files" was manually selected first

### Folder Download & Document Description (backend)
- Folders can be downloaded as a ZIP of their contents
- Added a `description` column to documents end-to-end: migration (`014_document_description.sql`), backend model/controller support, and frontend upload flow

### Infrastructure Fix
- Found and fixed two missing database tables (`dms_audit_calendar_events`, `dms_user_calendar_connections`) that were silently causing an unhandled 500 on every page's Google Calendar status check, in environments where the Postgres volume pre-dated those migrations

---

## Previous Changes (2026-07-28)

### Office File Preview Support
- **Added support for previewing Office files directly in the browser**
  - Word documents (.docx) - displays extracted text content in formatted document view
  - Excel spreadsheets (.xlsx) - displays data in table format with columns and rows
  - PowerPoint presentations (.pptx) - displays slides with titles and bullet points
  - Files are parsed client-side using `xlsx`, `docx`, and `pptx` libraries

### OCR Document Search
- **Implemented mock Docling API service for local OCR search**
  - Mock server runs on `http://127.0.0.1:8000`
  - Supports searching parsed document contents
  - Includes OCR results for images (PNG files with text extraction)
  - Search results display document filename, content preview, and creation date

### Bug Fixes
- Fixed Office file preview handling for uploaded files
- Added proper error handling for Office file parsing
- Improved fallback behavior for unsupported file types
- Mock OCR server now includes image file text extraction

### Dependencies Added
- `xlsx` - Excel file parsing and data extraction
- `docx` - Word document parsing
- `pptx` - PowerPoint file parsing
- `jszip` - ZIP file handling for Office Open XML formats

---

## Installation & Setup

### Start the Development Environment

1. **Start the Vite dev server:**
   ```bash
   cd DMS/web
   npm run dev
   ```
   Server will be available at: `http://localhost:5173`

2. **Start the mock Docling API server (in a new terminal):**
   ```bash
   cd DMS
   npm install    # first time only — installs tesseract.js for real OCR
   node docling-mock-server.js
   ```
   Server will be available at: `http://127.0.0.1:8000`

### Features Now Working
- ✅ Word document (.docx) preview in browser, with zoom and page navigation
- ✅ Excel spreadsheet (.xlsx) preview in browser, with multi-sheet tab switching
- ✅ PowerPoint presentation (.pptx) preview in browser, with zoom and slide navigation
- ✅ OCR document search with local mock API, backed by real Tesseract OCR
- ✅ Real image text extraction (OCR for PNG/JPG/GIF/BMP/WebP files)
- ✅ Full-metadata search (owner, extension, department, tags, description, status) across the Document Library, OCR search page, and top navbar
- ✅ Live search autocomplete with keyboard navigation
- ✅ File upload and document library management

---

## File Structure

### New Files Created
- `docling-mock-server.js` - Mock Docling API service for OCR search, now with real Tesseract OCR
- `package.json` / `package-lock.json` (repo root) - `tesseract.js` dependency for the mock server
- `infra/db/init/014_document_description.sql` - Adds `description` column to documents
- `web/src/utils/officeParser.ts` - Office file parsing utilities
- `web/src/utils/dmsMetadataSearch.ts` - Shared full-metadata search predicate
- `web/src/utils/documentStatus.ts` - Shared document status label map
- `web/src/utils/folderDownload.ts` - Folder-as-ZIP download utility
- `web/src/hooks/useAllDmsDocuments.ts` - Shared hook loading fixture + real documents for search/matching
- `web/src/hooks/useSearchSuggestions.ts` - Debounced live search-suggestions hook
- `web/src/components/custom/SearchSuggestionsDropdown.tsx` - Autocomplete dropdown UI
- `web/src/services/googleCalendarSync.ts` - Frontend Google Calendar sync service (backend wiring pending, see ISSUES.md)

### Modified Files
- `web/src/components/pages/Documents.tsx` - Office file preview support, required description + rename-on-upload, writable-folder default, owner-name resolution
- `web/src/components/pages/Search.tsx` - Full-metadata search merge, autocomplete, preview-return fix
- `web/src/components/layout/Navbar.tsx` - Search autocomplete
- `web/src/fixtures/documentLibrary.ts` - Updated preview types for Office files and multi-sheet spreadsheets
- `web/src/components/custom/DocumentPreview.tsx` - office-embed preview type, zoom/pagination for Word & PowerPoint, sheet tabs for Excel
- `web/src/components/custom/FolderTree.tsx` - Folder download action
- `api/Controllers/DocumentsController.cs` / `api/Models/DmsDocument.cs` - Document `description` field
