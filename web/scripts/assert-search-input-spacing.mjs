import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pageUrl = process.env.DMS_WEB_URL || 'http://localhost:5174/approvals';
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);

if (!chromePath) {
  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run this check.');
}

const profilePath = await mkdtemp(join(tmpdir(), 'dms-search-spacing-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--force-dark-mode',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    pageUrl,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const chromeExited = new Promise((resolve) => chrome.once('exit', resolve));

let browserSocketUrl = '';
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', (chunk) => {
  const match = chunk.match(/DevTools listening on (ws:\/\/[^\s]+)/);
  if (match) browserSocketUrl = match[1];
});

const waitFor = async (predicate, message, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

try {
  await waitFor(() => browserSocketUrl, 'Chrome did not expose a DevTools endpoint');
  const { port } = new URL(browserSocketUrl);
  let targets = [];

  await waitFor(async () => {
    try {
      targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      return targets.some((target) => target.type === 'page');
    } catch {
      return false;
    }
  }, 'The browser page target did not become available');

  const pageTarget = targets.find((target) => target.type === 'page');
  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let commandId = 0;
  const pendingCommands = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const pending = pendingCommands.get(message.id);
    if (!pending) return;
    pendingCommands.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++commandId;
      pendingCommands.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluationOptions = {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const startedAt = Date.now();
      let input;
      while (!(input = document.querySelector('input[aria-label="Search approvals"]'))) {
        if (Date.now() - startedAt > 10000) throw new Error('Approval search input was not rendered');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const icon = input.parentElement.querySelector('svg');
      const inputRect = input.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      const textStart = inputRect.left + Number.parseFloat(getComputedStyle(input).paddingLeft);
      return {
        iconRight: iconRect.right,
        textStart,
        gap: textStart - iconRect.right,
        paddingLeft: getComputedStyle(input).paddingLeft,
      };
    })()`,
  };
  let evaluation;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      evaluation = await send('Runtime.evaluate', evaluationOptions);
      break;
    } catch (error) {
      if (!error.message.includes('Execution context was destroyed') || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const measurement = evaluation.result.value;
  if (!measurement || measurement.gap < 8) {
    throw new Error(
      `Search icon overlaps its text: padding=${measurement?.paddingLeft}, gap=${measurement?.gap}px (expected at least 8px)`,
    );
  }

  console.log(
    `Search spacing OK: padding=${measurement.paddingLeft}, icon-to-text gap=${measurement.gap}px`,
  );
  socket.close();
} finally {
  if (chrome.exitCode === null) chrome.kill();
  await Promise.race([
    chromeExited,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    await rm(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
  }
}
