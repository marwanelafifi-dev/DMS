import { read as readExcel, utils as xlsxUtils } from 'xlsx';
import type { LibraryPreview } from '../fixtures/documentLibrary';

export async function parseWordDocument(blob: Blob, _sourceUrl: string): Promise<LibraryPreview | null> {
  try {
    const buffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    // Check for DOCX signature (ZIP file)
    if (uint8Array[0] === 0x50 && uint8Array[1] === 0x4b) {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      await zip.loadAsync(buffer);

      const documentXml = zip.file('word/document.xml');
      if (!documentXml) return null;

      const xmlContent = await documentXml.async('text');
      const paragraphs = xmlContent.match(/<w:p>[\s\S]*?<\/w:p>/g) || [];

      const content = paragraphs
        .map((para) => {
          const textElements = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
          return textElements.map((el) => el.replace(/<w:t[^>]*>|<\/w:t>/g, '')).join('');
        })
        .filter((text) => text.trim())
        .join('\n');

      if (!content) return null;

      return {
        kind: 'word',
        title: 'Document',
        paragraphs: content.split('\n').slice(0, 10),
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
    const buffer = await blob.arrayBuffer();
    const workbook = readExcel(buffer);

    if (!workbook.SheetNames.length) return null;

    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) return null;

      const rows = xlsxUtils.sheet_to_json(worksheet) as Array<Record<string, unknown>>;
      if (rows.length === 0) return null;

      const columns = Object.keys(rows[0]).slice(0, 8);
      const tableRows = rows.slice(0, 15).map((row) =>
        columns.map((col) => {
          const value = row[col];
          return value === null || value === undefined ? '' : String(value);
        }),
      );

      return { name: sheetName, columns, rows: tableRows };
    }).filter((sheet): sheet is { name: string; columns: string[]; rows: string[][] } => sheet !== null);

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

export async function parsePowerPointDocument(blob: Blob, _sourceUrl: string): Promise<LibraryPreview | null> {
  try {
    const buffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    // Check for PPTX signature (ZIP file)
    if (uint8Array[0] !== 0x50 || uint8Array[1] !== 0x4b) return null;

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    await zip.loadAsync(buffer);

    const slides: Array<{ title: string; bullets: string[] }> = [];
    const slideFiles = Object.keys(zip.files).filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/));

    for (let i = 0; i < Math.min(slideFiles.length, 10); i++) {
      const slideNum = i + 1;
      const slideFile = zip.file(`ppt/slides/slide${slideNum}.xml`);
      if (!slideFile) continue;

      const xmlContent = await slideFile.async('text');
      const textElements = xmlContent.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      const allText = textElements.map((el) => el.replace(/<a:t>|<\/a:t>/g, '')).filter(Boolean);

      if (allText.length > 0) {
        const title = allText[0] || `Slide ${slideNum}`;
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
    };
  } catch (error) {
    console.error('Failed to parse PowerPoint document:', error);
    return null;
  }
}
