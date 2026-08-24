# Application Changes

The document details header now displays Category beside Department and Owner while preserving `Type = FILE` as a separate field. Category is also a normal configurable Document Library column.

Legacy Metadata History remains separate from native New-DMS History. Each snapshot displays:

- metadata sequence/date/version ID and current/historical label;
- its exact associated legacy content-version ID;
- original filename, legacy version label, physical date, size, and availability;
- read-only View/Download actions for available active or archived content;
- a disabled unavailable state when the export lacks the physical file.

The read endpoints reuse the document's existing access checks and constrain content lookup by both the mapped New-DMS document and legacy document ID. Cross-document archive access is rejected.
