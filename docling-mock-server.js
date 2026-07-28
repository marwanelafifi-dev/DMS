const http = require('http');
const url = require('url');
const { createWorker } = require('tesseract.js');

let nextDocumentId = 100; // demo docs use ids 1-15; uploads start well above that

// Real OCR for image uploads (PNG/JPG/etc.) — reads actual pixel content via
// Tesseract instead of a filename-based placeholder. Worker is created lazily
// and reused across requests since spinning one up per request is slow.
let ocrWorkerPromise = null;
function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng');
  }
  return ocrWorkerPromise;
}

async function runImageOcr(buffer) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(buffer);
  return (data.text || '').trim();
}

// Minimal multipart/form-data parser — good enough to pull the "file" field's
// filename and raw bytes out of a browser FormData upload without a dependency.
function parseMultipartFile(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
  if (!boundary) return null;

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    const next = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (next === -1) break;
    parts.push(buffer.slice(start + boundaryBuffer.length, next));
    start = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    if (!/name="file"/i.test(headerText)) continue;

    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const filename = filenameMatch ? filenameMatch[1] : 'uploaded-file';
    let content = part.slice(headerEnd + 4);
    // Strip the trailing \r\n before the next boundary delimiter.
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);

    return { filename, buffer: content };
  }
  return null;
}

const textExtensions = new Set(['txt', 'md', 'csv', 'json', 'log']);
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);

async function extractContent(filename, buffer) {
  const ext = filename.toLowerCase().split('.').pop() || '';

  if (textExtensions.has(ext)) {
    return buffer.toString('utf8').slice(0, 5000);
  }

  if (imageExtensions.has(ext)) {
    try {
      const ocrText = await runImageOcr(buffer);
      if (ocrText) return ocrText.slice(0, 5000);
      return `${filename} — image uploaded, OCR found no readable text on it.`;
    } catch (error) {
      return `${filename} — image uploaded, OCR failed (${error.message}).`;
    }
  }

  // Office/PDF binary formats aren't OCR'd by this mock — best effort so the
  // file is still findable by name and type once uploaded.
  return `${filename} — uploaded document (${ext.toUpperCase() || 'unknown type'}, ${buffer.length} bytes). Local Docling extraction placeholder for non-text formats.`;
}

// Adds a freshly extracted document to the searchable index, or refreshes an
// existing entry's content if the same filename was already indexed — so
// re-running "Extract Text" on a document you opened earlier also makes it
// (re-)searchable, not just a first-time upload.
function upsertParsedDocument(filename, content) {
  const existing = parsedDocuments.find((doc) => doc.filename.toLowerCase() === filename.toLowerCase());
  if (existing) {
    existing.content = content;
    existing.created_at = new Date().toISOString();
    return existing;
  }
  const record = { id: nextDocumentId++, filename, content, created_at: new Date().toISOString() };
  parsedDocuments.push(record);
  return record;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Synced from mockLibraryDocuments in documentLibrary.ts
// Each document's content is extracted from the preview field
const parsedDocuments = [
  {
    id: 1,
    filename: 'Production Shift Handover.txt',
    content: 'Production Shift Handover\n\nLine 2 completed calibration without deviations.\nOpen action: verify replacement sensor stock before the next shift.\nOwner: Production Operations.',
    created_at: '2026-07-21T09:42:00.000Z',
  },
  {
    id: 2,
    filename: 'Supplier Audit Checklist.doc',
    content: 'Supplier Audit Checklist\n\nConfirm the supplier quality certificate is current.\nReview incoming inspection records and corrective actions.\nRecord the audit outcome and required follow-up date.',
    created_at: '2026-07-20T16:10:00.000Z',
  },
  {
    id: 3,
    filename: 'Quality Management Manual.docx',
    content: 'Quality Management Manual\n\nPurpose: define the quality management system used across production and laboratories.\nScope: applies to controlled processes, records, suppliers, and internal audits.\nAll printed copies are uncontrolled unless explicitly stamped.\nDocument control: version tracking and change management required.\nReview frequency: annual or upon regulatory change.',
    created_at: '2026-07-18T14:22:00.000Z',
  },
  {
    id: 4,
    filename: 'Production Metrics Q2.xlsx',
    content: 'Production Metrics Q2\n\nMetric\t\tApril\tMay\tJune\nFirst pass yield\t98.1%\t98.6%\t98.9%\nDowntime\t\t4.2 h\t3.8 h\t3.1 h\nUnits inspected\t12,440\t13,090\t13,520\nEquipment availability\t96.5%\t97.2%\t97.8%',
    created_at: '2026-07-17T11:05:00.000Z',
  },
  {
    id: 5,
    filename: 'Operations Review Q2.pptx',
    content: 'Operations Review Q2\n\nQ2 Operations Review\n- Production targets achieved at 99.2%\n- Calibration backlog reduced by 18%\n- Safety record: zero incidents\n\nPerformance Metrics\n- First pass yield: 98.9%\n- Equipment availability: 97.8%\n- On-time delivery: 99.5%\n\nNext Quarter Priorities\n- Automate line clearance records\n- Complete supplier requalification\n- Implement predictive maintenance',
    created_at: '2026-07-16T08:30:00.000Z',
  },
  {
    id: 6,
    filename: 'Calibration Procedure SOP-204.pdf',
    content: 'Calibration Procedure SOP-204 Approved production calibration procedure Quality Assurance controlled document',
    created_at: '2026-07-15T13:05:00.000Z',
  },
  {
    id: 7,
    filename: 'si-ware-brand-reference.png',
    content: 'SI-WARE Systems brand logo reference image corporate identity guidelines approved design',
    created_at: '2026-07-14T10:40:00.000Z',
  },
  {
    id: 8,
    filename: 'Incident Response Notes.txt',
    content: 'Incident Response Tabletop\n\nScenario: suspicious authentication activity detected.\nActions: isolate affected account, preserve logs, notify the incident commander.\nOutcome: escalation path verified successfully.',
    created_at: '2026-07-21T08:15:00.000Z',
  },
  {
    id: 9,
    filename: 'Training Attendance Register.doc',
    content: 'Training Attendance Register\n\nCourse: Controlled Document Handling\nDepartment: Quality Assurance\nAttendance verified by the training coordinator.',
    created_at: '2026-07-19T12:45:00.000Z',
  },
  {
    id: 10,
    filename: 'Records Retention Schedule.docx',
    content: 'Records Retention Schedule\n\nQuality records: retain for seven years after supersession.\nTraining records: retain for the duration of employment plus three years.\nSecurity logs: retain for twelve months unless placed on legal hold.\nFinancial records: retain per regulatory requirement (10 years).\nAudit reports: retain indefinitely for historical reference.',
    created_at: '2026-07-18T09:20:00.000Z',
  },
  {
    id: 11,
    filename: 'Quality KPI Tracker.xlsx',
    content: 'Quality KPI Tracker\n\nKPI\t\t\t\tTarget\tActual\tTrend\t\tOwner\nCAPA closure\t\t\t30 days\t27 days\tImproving\tQuality\nAudit actions overdue\t\t0\t2\tWatch\t\tAudit\nTraining compliance\t\t100%\t99.2%\tStable\t\tHR\nSupplier audits completed\t12\t10\tOn track\tQuality',
    created_at: '2026-07-17T15:30:00.000Z',
  },
  {
    id: 12,
    filename: 'Security Awareness Briefing.pptx',
    content: 'Security Awareness Briefing\n\nProtect Company Information\n- Use approved storage locations\n- Report suspicious requests immediately\n- Do not share credentials\n\nAccess Hygiene\n- Use unique credentials\n- Lock unattended workstations\n- Enable multi-factor authentication\n\nIncident Response\n- Know who to contact\n- Document incident details\n- Preserve evidence and logs',
    created_at: '2026-07-16T14:00:00.000Z',
  },
  {
    id: 13,
    filename: 'Emergency Response Plan.pdf',
    content: 'Emergency Response Plan Approved emergency response plan Operations controlled document training',
    created_at: '2026-07-15T09:10:00.000Z',
  },
  {
    id: 14,
    filename: 'si-ware-brand-reference-dark.png',
    content: 'SI-WARE Systems brand logo dark mode reference approved design specifications corporate identity',
    created_at: '2026-07-14T08:50:00.000Z',
  },
  {
    id: 15,
    filename: 'DMS-Sample-Image.png',
    content: 'DMS SAMPLE IMAGE LOCAL OCR SAMPLE 4729 PNG preview and text extraction from document library system testing',
    created_at: '2026-07-28T10:13:00.000Z',
  },
];

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname === '/api/documents/search' && req.method === 'GET') {
    const searchQuery = (query.q || '').toLowerCase();

    if (!searchQuery) {
      res.writeHead(400);
      res.end(JSON.stringify({ detail: 'Search query is required' }));
      return;
    }

    const results = parsedDocuments.filter((doc) =>
      doc.content.toLowerCase().includes(searchQuery) ||
      doc.filename.toLowerCase().includes(searchQuery),
    );

    res.writeHead(200);
    res.end(JSON.stringify(results));
    return;
  }

  if (pathname === '/api/documents/convert' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const parsed = parseMultipartFile(body, req.headers['content-type']);
      if (!parsed) {
        res.writeHead(400);
        res.end(JSON.stringify({ detail: 'No file field found in upload' }));
        return;
      }
      const content = await extractContent(parsed.filename, parsed.buffer);
      // Re-running "Extract Text" on a document also refreshes/adds it to the
      // searchable index — previously this only ever returned the text without
      // indexing it, so re-extracted documents still never showed up in search.
      upsertParsedDocument(parsed.filename, content);
      res.writeHead(200);
      res.end(JSON.stringify({ filename: parsed.filename, content }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ detail: `Conversion failed: ${error.message}` }));
    }
    return;
  }

  if (pathname === '/api/documents/upload' && req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      const parsed = parseMultipartFile(body, req.headers['content-type']);
      if (!parsed) {
        res.writeHead(400);
        res.end(JSON.stringify({ detail: 'No file field found in upload' }));
        return;
      }
      const content = await extractContent(parsed.filename, parsed.buffer);
      // Real fix: index the uploaded file so it actually shows up in OCR search,
      // instead of the old behaviour which discarded the upload and returned a
      // hardcoded placeholder that was never searchable.
      const record = upsertParsedDocument(parsed.filename, content);
      res.writeHead(200);
      res.end(JSON.stringify(record));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ detail: `Upload failed: ${error.message}` }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ detail: 'Not found' }));
});

const PORT = 8000;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock Docling API server running on http://127.0.0.1:${PORT}`);
  console.log('Press Ctrl+C to stop');
});
