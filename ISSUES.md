# Known Issues & Limitations

## Resolved This Session (2026-07-28)

### ~~OCR Results - Limited to Mock Data~~ ✅ FIXED
Uploading a file (or re-running "Extract Text" on an existing one) now indexes it into the mock server's searchable list immediately via `/api/documents/upload` and `/api/documents/convert`. Previously the mock server discarded the uploaded content and returned a hardcoded placeholder that was never searchable.

### ~~Image OCR - Not Real Text Extraction~~ ✅ FIXED
`docling-mock-server.js` now runs real OCR via `tesseract.js` on uploaded images (PNG/JPG/GIF/BMP/WebP) instead of returning mock text. Verified by generating a test image with known text and confirming it round-trips through search correctly.

### ~~File Upload OCR Processing~~ ✅ FIXED
Same fix as above — uploaded files are now added to the searchable OCR index at upload time, not just parsed for the one-time preview.

### Document Library owner always showed "A. Khaled" ✅ FIXED
Real (non-fixture) documents only carry an `ownerId` GUID from the API, not a resolved name — the UI was silently falling back to a hardcoded fixture owner for every real document regardless of who uploaded it. `Documents.tsx` and the OCR search page now resolve the real owner via `/api/users`.

### OCR/metadata search only covered file name & content ✅ FIXED
Added full-metadata search (owner, extension, department, tags, description, tracking code, status — with punctuation/whitespace-tolerant matching) to the Document Library search box, the OCR search page, and the top navbar's live autocomplete. Previously only file name and OCR-extracted content were searchable.

### Uploads to the default folder silently failed ✅ FIXED
The Document Library defaulted to the alphabetically-first folder on load, which the signed-in dev user often has no write permission on — uploads failed with a 403 that was easy to miss. It now defaults to the first folder the current user can actually write to.

### Document preview overlay didn't close on browser Back / sidebar nav ✅ FIXED
Only the explicit ✕ button closed the full-screen preview; navigating away via the browser Back button or the "Document Library" sidebar link (both of which drop the `?preview=` URL param) left the overlay stuck on screen over the library.

### Missing `dms_audit_calendar_events` / `dms_user_calendar_connections` tables ✅ FIXED
These migrations were added to `infra/db/init/` after some environments' Postgres volumes already existed, so they never ran (init scripts only execute on a fresh volume). Every page load's Google Calendar status check was throwing an unhandled 500. Fresh environments are unaffected (the migrations run normally); existing ones need `012_audit_calendar_events.sql` and `013_user_google_calendar_sync.sql` applied manually once.

## Current Issues

### 1. Office File Preview - No Native Embedding
**Severity:** Low  
**Description:** Office files (PPTX, DOCX, XLSX) are displayed with extracted content preview rather than native Office application rendering.  
**Impact:** Users see formatted text/data instead of pixel-perfect Office file representation  
**Workaround:** Download the file to view in native Office application  
**Root Cause:** Microsoft Office Online embed requires publicly accessible URLs; localhost files are not accessible from Office Online servers  

### 2. Legacy DOC Files Not Supported
**Severity:** Medium  
**Description:** Legacy Microsoft Word .doc files (pre-2007) are not previewed  
**Impact:** Users cannot preview legacy Word documents in browser  
**Status:** Fallback to unavailable preview or OCR conversion available  
**Suggestion:** Convert to .docx format or implement legacy DOC parser

### 3. Legacy XLS Files Not Supported
**Severity:** Low  
**Description:** Legacy Excel .xls files (pre-2007) are not previewed  
**Impact:** Users cannot preview legacy Excel files in browser  
**Status:** Fallback to unavailable preview or OCR conversion available  

### 4. Mock OCR Server - Manual Start Required
**Severity:** Medium  
**Description:** Mock Docling API service must be manually started in a separate terminal  
**Impact:** OCR search won't work if server isn't running  
**Workaround:** Run `node docling-mock-server.js` in DMS directory  
**Suggestion:** Integrate as npm script or auto-start with dev server

### 5. No Server-Side Document Persistence
**Severity:** High  
**Description:** Document previews are cached in session; reloading page loses cached previews  
**Impact:** After page reload, Office file previews become "unavailable"  
**Workaround:** Click document again to regenerate preview from blob  
**Status:** As designed - fixtures load from memory, not persistent storage

### 6. Intermittent Vite dev-proxy stalls under concurrent requests
**Severity:** Low  
**Description:** During heavy local testing, the Vite dev server's `/api` proxy occasionally stalled a burst of concurrent requests for several seconds. Confirmed the .NET backend itself responds in ~200ms when hit directly (port 8080); the delay is isolated to the dev-only proxy layer.  
**Impact:** Rare, transient — DMS-metadata enrichment in OCR search could briefly show blank columns on first load  
**Workaround:** `useAllDmsDocuments` degrades gracefully per-endpoint (`Promise.allSettled`) and the OCR search page re-merges metadata once the data does arrive, so it self-corrects without a retry needed  
**Suggestion:** Not reproducible on demand; revisit if it recurs outside of rapid automated testing

### 7. Google Calendar sync — frontend/DB ready, backend auto-sync not wired up
**Severity:** Medium  
**Description:** `GoogleCalendarSyncService` and the per-user OAuth schema exist, but creating an audit calendar event does not yet enqueue a sync job (see `GOOGLE_CALENDAR_AUTO_SYNC.md` for the intended design).  
**Impact:** No calendar sync happens automatically today  
**Suggestion:** Wire `AuditCalendarController`'s create-event action to queue a `SyncAuditEventJob`, per the guide

---

## Performance Considerations

### Office File Parsing
- Large Excel files (>1000 rows) may take time to parse
- Large Word documents may have slower rendering
- No pagination or virtualization for large datasets

### Search Performance
- Mock OCR server does full text scan (no indexing)
- Search queries on large document collections will be slow
- Real production would require Elasticsearch or similar

---

## Browser Compatibility

### Supported
- ✅ Chrome/Edge (Chromium-based)
- ✅ Firefox
- ✅ Safari

### Potential Issues
- Some older browsers may not support all ES2020+ features used in Office parsers
- ZIP parsing via jszip has been tested on modern browsers

---

## Future Improvements

### Priority: High
1. [ ] Integrate real Docling Python service for actual document parsing
2. [ ] Implement document persistence and caching
3. [x] Add full-text search index for uploaded documents — uploads are indexed into the mock OCR server's searchable list immediately (2026-07-28)
4. [ ] Support for legacy Office formats (.doc, .xls)

### Priority: Medium
1. [ ] Auto-start Docling server with dev environment
2. [x] Real OCR for images using Tesseract.js — implemented in `docling-mock-server.js` (2026-07-28)
3. [ ] Document processing background job queue
4. [ ] Pagination for large spreadsheet previews (multi-sheet Excel files now have a sheet-tab switcher, but individual sheets with very large row counts still aren't virtualized)
5. [ ] Wire Google Calendar auto-sync on audit event creation (frontend + DB schema ready, see Issue #7 above)

### Priority: Low
1. [ ] Native Office Online embed when files are publicly hosted
2. [ ] Syntax highlighting for code files
3. [ ] PDF annotations and markup
4. [ ] Version history with diffs

---

## Testing Recommendations

1. Test Office file preview with files of varying sizes
2. Test OCR search with different keywords
3. Test with network disconnected (should gracefully degrade)
4. Test with large Excel files (>5000 rows)
5. Test with non-ASCII filenames and content

---

## Notes for Developers

- The mock Docling server is intentionally simple - it's a proof of concept
- Real Docling integration would require a Python backend
- Consider using a queue (Bull, RabbitMQ) for async document processing
- Implement document persistence layer before production use
