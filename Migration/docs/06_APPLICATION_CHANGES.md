# Application Changes

The document details header now displays Category beside Department and Owner while preserving `Type = FILE` as a separate field. Category is also a normal configurable Document Library column.

Legacy Metadata History remains separate from native New-DMS History. Each snapshot displays:

- metadata sequence/date/version ID and current/historical label;
- its exact associated legacy content-version ID;
- original filename, legacy version label, physical date, size, and availability;
- read-only View/Download actions for available active or archived content;
- a disabled unavailable state when the export lacks the physical file.

The read endpoints reuse the document's existing access checks and constrain content lookup by both the mapped New-DMS document and legacy document ID. Cross-document archive access is rejected.

## Application UX cleanup (2026-08-24)

- Legacy Metadata History `View` now opens the associated current or historical archive object in the shared read-only preview experience. It never triggers a download or creates a New-DMS version. `Download` remains a separate explicit action, and unsupported formats retain Download while showing the normal preview-unavailable state.
- The Document Library folder tree has compact recursive `Expand All` and `Collapse All` controls. Existing per-folder toggles and folder relationships are unchanged.
- PCAR / Corrective Action records now use the application's reusable tag selector and the shared configured Tag list. Tags are stored as a normalized PostgreSQL `TEXT[]`, returned by the task APIs, editable in PCAR forms, and shown in the register/detail view.
- True application dialogs share a modal overlay policy: Escape closes only the top-most dialog, X and explicit Close/Cancel controls retain their existing actions, and backdrop clicks are inert. Dropdowns, autocomplete lists, popovers, and context menus are not affected.
- The static Compliance heading, ISO items, and On-Premises Vault label were removed from the sidebar. The normal navigation and build/version text remain.

The additive PCAR schema change is `infra/db/init/081_task_tags.sql`. Existing task rows receive an empty tag array and no migration document/archive data is modified.
