# DMS Sample Files

These files exercise the real local upload, Docling conversion, OCR search, preview,
download, persistence, and workflow paths.

- `DMS-Sample-Text.txt` — plain text
- `DMS-Sample-Document.docx` — Microsoft Word
- `DMS-Sample-Spreadsheet.xlsx` — Microsoft Excel
- `DMS-Sample-Presentation.pptx` — Microsoft PowerPoint
- `DMS-Sample-Report.pdf` — browser PDF preview
- `DMS-Sample-Image.png` — PNG image and OCR text
- `DMS-Sample-Photo.jpg` — JPEG image and OCR text

Regenerate the pack from `web/` with:

```powershell
python scripts/generate_sample_files.py
```
