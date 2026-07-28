import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sampleFileDefinitions } from './sampleFiles';

const expectedFileNames = [
  'DMS-Sample-Text.txt',
  'DMS-Sample-Document.docx',
  'DMS-Sample-Spreadsheet.xlsx',
  'DMS-Sample-Presentation.pptx',
  'DMS-Sample-Report.pdf',
  'DMS-Sample-Image.png',
  'DMS-Sample-Photo.jpg',
];

describe('sample document pack', () => {
  it('publishes every supported sample type', () => {
    expect(sampleFileDefinitions.map((sample) => sample.fileName)).toEqual(expectedFileNames);
  });

  it.each([
    ['DMS-Sample-Text.txt', Buffer.from('DMS - Enterprise Document Management System')],
    ['DMS-Sample-Document.docx', Buffer.from('PK')],
    ['DMS-Sample-Spreadsheet.xlsx', Buffer.from('PK')],
    ['DMS-Sample-Presentation.pptx', Buffer.from('PK')],
    ['DMS-Sample-Report.pdf', Buffer.from('%PDF-')],
    ['DMS-Sample-Image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['DMS-Sample-Photo.jpg', Buffer.from([0xff, 0xd8, 0xff])],
  ])('%s is a real file with the expected signature', (fileName, signature) => {
    const contents = readFileSync(resolve(process.cwd(), 'public', 'sample-files', fileName));
    expect(contents.subarray(0, signature.length)).toEqual(signature);
    expect(contents.length).toBeGreaterThan(signature.length);
  });
});
