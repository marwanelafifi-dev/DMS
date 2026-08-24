# Pilot Results

Legacy documents 230, 177, 238, 497, and 24 were not remigrated by the full run. Their deterministic mappings were validated and skipped.

After the application/archive changes, all five passed:

- normal API/application open path;
- active file and MinIO SHA-256;
- owner, department, category, description, tags, and folder;
- PostgreSQL current-version relationships;
- all archived metadata/content relationships;
- Category display in the document header;
- Legacy Metadata History file association and availability display;
- legacy historical View/Download where the archive object exists.

The native New-DMS History action remained separate and operational.
