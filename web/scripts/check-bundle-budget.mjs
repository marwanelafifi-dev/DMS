import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const distDir = resolve('dist');
const html = readFileSync(resolve(distDir, 'index.html'), 'utf8');
const entryMatch = html.match(/<script[^>]+src="([^"]+\.js)"/i);

if (!entryMatch) {
  throw new Error('Could not find the production entry script in dist/index.html');
}

const entryPath = resolve(distDir, entryMatch[1].replace(/^\//, ''));
const entryBytes = statSync(entryPath).size;
const entryBudgetBytes = 500 * 1024;

console.log(`Production entry: ${(entryBytes / 1024).toFixed(1)} KiB (budget ${(entryBudgetBytes / 1024).toFixed(0)} KiB)`);

if (entryBytes > entryBudgetBytes) {
  console.error('BUNDLE_BUDGET_FAILED: the initial application entry still eagerly includes route/preview code.');
  process.exit(1);
}
