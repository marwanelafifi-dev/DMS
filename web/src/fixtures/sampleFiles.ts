export interface SampleFileDefinition {
  fileName: string;
  url: string;
  contentType: string;
}

export const sampleFileDefinitions: readonly SampleFileDefinition[] = [
  {
    fileName: 'DMS-Sample-Text.txt',
    url: '/sample-files/DMS-Sample-Text.txt',
    contentType: 'text/plain',
  },
  {
    fileName: 'DMS-Sample-Document.docx',
    url: '/sample-files/DMS-Sample-Document.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    fileName: 'DMS-Sample-Spreadsheet.xlsx',
    url: '/sample-files/DMS-Sample-Spreadsheet.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    fileName: 'DMS-Sample-Presentation.pptx',
    url: '/sample-files/DMS-Sample-Presentation.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  {
    fileName: 'DMS-Sample-Report.pdf',
    url: '/sample-files/DMS-Sample-Report.pdf',
    contentType: 'application/pdf',
  },
  {
    fileName: 'DMS-Sample-Image.png',
    url: '/sample-files/DMS-Sample-Image.png',
    contentType: 'image/png',
  },
  {
    fileName: 'DMS-Sample-Photo.jpg',
    url: '/sample-files/DMS-Sample-Photo.jpg',
    contentType: 'image/jpeg',
  },
] as const;

export async function loadSampleDocumentFiles(): Promise<File[]> {
  return Promise.all(sampleFileDefinitions.map(async ({ fileName, url, contentType }) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${fileName} could not be loaded`);
    const blob = await response.blob();
    return new File([blob], fileName, {
      type: contentType,
      lastModified: Date.UTC(2026, 6, 27, 8, 0, 0),
    });
  }));
}
