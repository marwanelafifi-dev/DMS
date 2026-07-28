import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';

const pages = [
  'src/components/pages/Approvals.tsx',
  'src/components/pages/Search.tsx',
  'src/components/pages/Tasks.tsx',
];

describe('dark-mode Tailwind tokens', () => {
  it.each(pages)('uses configured navy shades in %s', (pagePath) => {
    const source = readFileSync(resolve(process.cwd(), pagePath), 'utf8');
    const usedShades = Array.from(
      source.matchAll(/(?:[a-z-]+:)*(?:bg|border(?:-[lrtb])?|fill|text)-navy-(\d+)/g),
      (match) => match[1],
    );
    const extendedColors = tailwindConfig.theme?.extend?.colors;
    if (!extendedColors || typeof extendedColors === 'function') {
      throw new Error('Expected Tailwind extended colors to be a static palette');
    }
    const navyPalette = extendedColors.navy as Record<string, string>;

    expect(usedShades.length).toBeGreaterThan(0);
    usedShades.forEach((shade) => {
      expect(navyPalette, `${pagePath} uses undefined navy-${shade}`).toHaveProperty(shade);
    });
  });
});
