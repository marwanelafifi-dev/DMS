import { read as readExcel, utils as xlsxUtils } from 'xlsx';
import type { LibraryPreview } from '../fixtures/documentLibrary';

const WORD_PARAGRAPH_LIMIT = 10;
const PRESENTATION_SLIDE_LIMIT = 10;
const SPREADSHEET_ROW_LIMIT = 100;

/**
 * Extract searchable text directly from modern Office files without sending
 * the same upload through the much slower Docling/LibreOffice service. This is
 * intentionally separate from the preview parsers below: previews are capped
 * for rendering, while Document ID detection must inspect the complete file,
 * including Word headers/footers where controlled-document IDs commonly live.
 */
export async function extractOfficeDocumentText(blob: Blob, fileName: string): Promise<string | null> {
  try {
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (!extension || !['docx', 'pptx', 'xlsx', 'xlsm'].includes(extension)) return null;

    const buffer = await readBlobAsArrayBuffer(blob);

    if (extension === 'xlsx' || extension === 'xlsm') {
      const workbook = readExcel(buffer);
      const text = workbook.SheetNames
        .map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          return sheet ? `${sheetName}\n${xlsxUtils.sheet_to_csv(sheet)}` : '';
        })
        .filter(Boolean)
        .join('\n');
      return text.trim() || null;
    }

    const { default: JSZip } = await import('jszip');
    const zip = await new JSZip().loadAsync(buffer);
    const officeXmlPaths = Object.keys(zip.files)
      .filter((path) => extension === 'docx'
        ? /^word\/(?:document|header\d+|footer\d+)\.xml$/i.test(path)
        : /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i.test(path))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const sections: string[] = [];
    for (const path of officeXmlPaths) {
      const xml = await zip.file(path)?.async('text');
      if (!xml) continue;

      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      if (parsed.querySelector('parsererror')) continue;
      const text = Array.from(parsed.getElementsByTagNameNS('*', 't'))
        .map((node) => node.textContent || '')
        .filter(Boolean)
        .join(' ');
      if (text.trim()) sections.push(text.trim());
    }

    const text = sections.join('\n');
    return text || null;
  } catch {
    // A legacy or malformed Office container is expected to fall back to the
    // server-side parser; it is not an upload failure by itself.
    return null;
  }
}

// Some Blob-like sources (older browsers, certain test doubles) don't implement
// `arrayBuffer()` even though they implement the rest of the Blob contract — fall
// back to FileReader so the whole parser doesn't silently throw and get swallowed
// by its own try/catch.
async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('The document could not be read'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function parseWordDocument(blob: Blob, _sourceUrl: string): Promise<LibraryPreview | null> {
  try {
    const buffer = await readBlobAsArrayBuffer(blob);
    const uint8Array = new Uint8Array(buffer);

    // Check for DOCX signature (ZIP file)
    if (uint8Array[0] === 0x50 && uint8Array[1] === 0x4b) {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      await zip.loadAsync(buffer);

      const documentXml = zip.file('word/document.xml');
      if (!documentXml) return null;

      const xmlContent = await documentXml.async('text');
      // `<w:p>` almost always carries attributes in real documents (e.g.
      // `<w:p w:rsidR="..." w:rsidRDefault="...">`) — matching only the
      // attribute-free tag matched zero paragraphs for virtually all real files.
      const paragraphs = xmlContent.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];

      const allParagraphs = paragraphs
        .map((para) => {
          const textElements = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
          return textElements.map((el) => el.replace(/<w:t[^>]*>|<\/w:t>/g, '')).join('');
        })
        .filter((text) => text.trim());

      if (allParagraphs.length === 0) return null;

      return {
        kind: 'word',
        title: 'Document',
        paragraphs: allParagraphs.slice(0, WORD_PARAGRAPH_LIMIT),
        totalParagraphs: allParagraphs.length,
      };
    }

    return null;
  } catch (error) {
    console.error('Failed to parse Word document:', error);
    return null;
  }
}

export async function parseExcelDocument(blob: Blob, _sourceUrl: string): Promise<LibraryPreview | null> {
  try {
    const buffer = await readBlobAsArrayBuffer(blob);
    const workbook = readExcel(buffer);

    if (!workbook.SheetNames.length) return null;

    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) return null;

      if (!worksheet['!ref']) return null;
      const range = xlsxUtils.decode_range(worksheet['!ref']);

      // Render like an actual spreadsheet grid — column letters (A, B, C…) as the
      // header row and real row numbers down the side, cells read by absolute
      // address starting from column A / row 1 — rather than treating row 1 as
      // semantic column headers. That older approach silently dropped any sheet
      // whose only content didn't leave a "data row" beneath an inferred header
      // (e.g. a single populated cell, or content starting several rows down),
      // and mislabeled columns once it did work since sheet_to_json trims blank
      // leading rows/columns instead of keeping them at their real position.
      const totalColumns = range.e.c + 1;
      const totalRows = range.e.r + 1;
      // No cap on columns — a sheet is rarely wide enough for it to matter,
      // and the preview scrolls horizontally same as it does vertically.
      const lastColumn = range.e.c;
      const lastRow = Math.min(range.e.r, SPREADSHEET_ROW_LIMIT - 1);

      const columns = Array.from({ length: lastColumn + 1 }, (_, columnIndex) => xlsxUtils.encode_col(columnIndex));
      const rowNumbers = Array.from({ length: lastRow + 1 }, (_, rowIndex) => rowIndex + 1);
      const tableRows = rowNumbers.map((_, rowIndex) => columns.map((_, columnIndex) => {
        const cell = worksheet[xlsxUtils.encode_cell({ r: rowIndex, c: columnIndex })];
        return cell ? xlsxUtils.format_cell(cell) : '';
      }));

      // A sheet with no populated cells at all (a blank tab) still has a 1x1
      // range from decode_range's fallback — skip it rather than show one empty row.
      if (tableRows.every((row) => row.every((cell) => cell === ''))) return null;

      return {
        name: sheetName,
        columns,
        rowNumbers,
        rows: tableRows,
        totalRows,
        totalColumns,
      };
    }).filter((sheet): sheet is { name: string; columns: string[]; rowNumbers: number[]; rows: string[][]; totalRows: number; totalColumns: number } => sheet !== null);

    if (sheets.length === 0) return null;

    return {
      kind: 'spreadsheet',
      sheets,
    };
  } catch (error) {
    console.error('Failed to parse Excel document:', error);
    return null;
  }
}

// The zip entry names under ppt/slides/ carry no guarantee of matching the deck's
// actual authored order (a slide can be renumbered/reordered by tools other than
// PowerPoint without renaming its file) — the real order lives in
// ppt/presentation.xml's <p:sldIdLst>, resolved through ppt/_rels/presentation.xml.rels.
async function getAuthoredSlideOrder(zip: import('jszip')): Promise<string[] | null> {
  try {
    const presentationXml = await zip.file('ppt/presentation.xml')?.async('text');
    const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('text');
    if (!presentationXml || !relsXml) return null;

    const sldIdListMatch = presentationXml.match(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/);
    if (!sldIdListMatch) return null;
    const rIds = Array.from(sldIdListMatch[0].matchAll(/r:id="([^"]+)"/g)).map((m) => m[1]);
    if (rIds.length === 0) return null;

    const relationshipMap = new Map<string, string>();
    for (const tagMatch of relsXml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const tag = tagMatch[0];
      const id = tag.match(/\bId="([^"]+)"/)?.[1];
      const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) relationshipMap.set(id, target);
    }

    const orderedPaths: string[] = [];
    for (const rId of rIds) {
      const target = relationshipMap.get(rId);
      if (!target) return null;
      const normalized = target.replace(/^\.?\/?/, '');
      orderedPaths.push(normalized.startsWith('slides/') ? `ppt/${normalized}` : normalized);
    }
    return orderedPaths;
  } catch (error) {
    console.error('Failed to resolve authored PowerPoint slide order:', error);
    return null;
  }
}

export async function parsePowerPointDocument(blob: Blob, _sourceUrl: string): Promise<LibraryPreview | null> {
  try {
    const buffer = await readBlobAsArrayBuffer(blob);
    const uint8Array = new Uint8Array(buffer);

    // Check for PPTX signature (ZIP file)
    if (uint8Array[0] !== 0x50 || uint8Array[1] !== 0x4b) return null;

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    await zip.loadAsync(buffer);

    const slides: Array<{ title: string; bullets: string[] }> = [];
    // Use the actual matched filenames (and sort numerically) as a fallback
    // instead of reconstructing `slide${i + 1}.xml` — decks whose internal slide
    // files aren't contiguously numbered from 1 (common after slide deletion/
    // reordering outside PowerPoint) were silently skipping slides.
    const discoveredSlideFiles = Object.keys(zip.files)
      .filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const numA = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
        const numB = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
        return numA - numB;
      });

    // Prefer the deck's true authored order from presentation.xml when it's
    // resolvable and accounts for exactly the same set of slide files — falls
    // back to filename-sorted order for decks with unusual/malformed rels.
    const authoredOrder = await getAuthoredSlideOrder(zip);
    const slideFiles = authoredOrder
      && authoredOrder.length === discoveredSlideFiles.length
      && authoredOrder.every((path) => zip.file(path) !== null)
      ? authoredOrder
      : discoveredSlideFiles;

    const totalSlides = slideFiles.length;

    for (let i = 0; i < Math.min(slideFiles.length, PRESENTATION_SLIDE_LIMIT); i++) {
      const slideFile = zip.file(slideFiles[i]);
      if (!slideFile) continue;

      const xmlContent = await slideFile.async('text');
      const textElements = xmlContent.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const allText = textElements.map((el) => el.replace(/<a:t>|<\/a:t>/g, '')).filter(Boolean);

      if (allText.length > 0) {
        const title = allText[0] || `Slide ${i + 1}`;
        const bullets = allText.slice(1).filter((text) => text.length > 0);
        slides.push({
          title,
          bullets: bullets.length > 0 ? bullets : ['(Content)'],
        });
      }
    }

    if (slides.length === 0) return null;

    return {
      kind: 'presentation',
      slides,
      totalSlides,
    };
  } catch (error) {
    console.error('Failed to parse PowerPoint document:', error);
    return null;
  }
}
