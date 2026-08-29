import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractOfficeDocumentText } from './officeParser';

describe('extractOfficeDocumentText', () => {
  it('reads complete DOCX body, header, and footer text locally', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Procedure body</w:t></w:r></w:p></w:body></w:document>');
    zip.file('word/header1.xml', '<?xml version="1.0"?><w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>DOC.NO:</w:t></w:r><w:r><w:t>SWS-25120002</w:t></w:r></w:p></w:hdr>');
    zip.file('word/footer1.xml', '<?xml version="1.0"?><w:ftr xmlns:w="urn:w"><w:p><w:r><w:t>Controlled copy</w:t></w:r></w:p></w:ftr>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });

    const text = await extractOfficeDocumentText(
      new File([bytes], 'procedure.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      'procedure.docx',
    );

    expect(text).toContain('Procedure body');
    expect(text).toContain('DOC.NO: SWS-25120002');
    expect(text).toContain('Controlled copy');
  });

  it('returns null for formats that require the Docling fallback', async () => {
    await expect(extractOfficeDocumentText(new File(['pdf'], 'procedure.pdf'), 'procedure.pdf')).resolves.toBeNull();
  });
});
