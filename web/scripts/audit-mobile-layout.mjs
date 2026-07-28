import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const viewport = { width: 390, height: 844 };
const baseUrl = process.env.DMS_WEB_ORIGIN || 'http://localhost:5174';
const artifactDirectory = resolve(process.cwd(), '../artifacts');
const pages = [
  {
    name: 'documents',
    path: '/documents',
    readySelector: 'input[aria-label="Search documents"]',
  },
  {
    name: 'approvals',
    path: '/approvals',
    readySelector: 'input[aria-label="Search approvals"]',
  },
  {
    name: 'tasks',
    path: '/tasks',
    readySelector: 'input[aria-label="Search PCAR records"]',
  },
];
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
  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run this audit.');
}

const profilePath = await mkdtemp(join(tmpdir(), 'dms-mobile-audit-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--force-dark-mode',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const chromeExited = new Promise((resolveExit) => chrome.once('exit', resolveExit));

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
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
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
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
    new Promise((resolveCommand, rejectCommand) => {
      const id = ++commandId;
      pendingCommands.set(id, { resolve: resolveCommand, reject: rejectCommand });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return await send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
      } catch (error) {
        if (!error.message.includes('Execution context was destroyed') || attempt === 19) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const failures = [];
  for (const page of pages) {
    await send('Page.navigate', { url: `${baseUrl}${page.path}` });
    await waitFor(async () => {
      try {
        const result = await evaluate(
          `location.pathname === ${JSON.stringify(page.path)} && document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(page.readySelector)}))`,
        );
        return result.result.value === true;
      } catch {
        return false;
      }
    }, `${page.name} did not finish rendering`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));

    const result = await evaluate(`(() => {
      const rect = (element) => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          top: Math.round(bounds.top),
          bottom: Math.round(bounds.bottom),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        };
      };
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        search: rect(document.querySelector(${JSON.stringify(page.readySelector)})),
        folders: rect(document.querySelector('[data-testid="folder-section"]')),
        upload: rect(document.querySelector('button[aria-label="Upload files"]')),
      };
    })()`);
    const metrics = result.result.value;

    if (metrics.viewportWidth !== viewport.width) {
      failures.push(`${page.name}: viewport is ${metrics.viewportWidth}px, expected ${viewport.width}px`);
    }
    if (metrics.documentWidth > metrics.viewportWidth || metrics.bodyWidth > metrics.viewportWidth) {
      failures.push(
        `${page.name}: page overflows horizontally (viewport=${metrics.viewportWidth}, document=${metrics.documentWidth}, body=${metrics.bodyWidth})`,
      );
    }
    if (!metrics.search || metrics.search.left < 0 || metrics.search.right > metrics.viewportWidth) {
      failures.push(`${page.name}: search control is outside the mobile viewport`);
    }
    if (page.name !== 'documents' && metrics.search.width < viewport.width - 40) {
      failures.push(`${page.name}: search control is only ${metrics.search.width}px wide`);
    }
    if (page.name === 'documents') {
      if (!metrics.folders || metrics.folders.width > viewport.width) {
        failures.push(`${page.name}: folder section does not fit the mobile viewport`);
      }
      if (!metrics.upload || metrics.upload.left < 0 || metrics.upload.right > metrics.viewportWidth) {
        failures.push(`${page.name}: upload action is outside the mobile viewport`);
      }
    }

    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(
      join(artifactDirectory, `mobile-${page.name}-390-emulated.png`),
      Buffer.from(screenshot.data, 'base64'),
    );
    console.log(`${page.name}: ${JSON.stringify(metrics)}`);
  }

  socket.close();
  if (failures.length > 0) {
    throw new Error(`Mobile layout audit failed:\n- ${failures.join('\n- ')}`);
  }
  console.log('Mobile layout audit passed at 390x844.');
} finally {
  if (chrome.exitCode === null) chrome.kill();
  await Promise.race([
    chromeExited,
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  try {
    await rm(profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
  }
}
