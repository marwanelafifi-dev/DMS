import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = resolve(process.cwd(), '..');
const baseUrl = process.env.DMS_WEB_ORIGIN || 'http://127.0.0.1:5174';
const appSettings = JSON.parse(readFileSync(resolve(repoRoot, 'api/appsettings.json'), 'utf8'));
const envPath = resolve(repoRoot, '.env');
let jwtSecret = appSettings.Jwt.Secret;

if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    if (line.slice(0, separator).trim() === 'JWT_SECRET') {
      jwtSecret = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '') || jwtSecret;
      break;
    }
  }
}

const base64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsignedToken = `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({
  sub: '00000000-0000-0000-0000-000000000001',
  email: 'system@si-ware.com',
  name: 'System Admin',
  issued_at: String(now),
  nbf: now - 1,
  exp: now + 600,
  iss: appSettings.Jwt.Issuer,
  aud: appSettings.Jwt.Audience,
})}`;
const token = `${unsignedToken}.${createHmac('sha256', jwtSecret).update(unsignedToken).digest('base64url')}`;

const pilots = [
  { legacyId: 230, documentId: '4f4cdd06-0ce3-556a-8232-b199898d1941', snapshots: 16, category: 'Process' },
  { legacyId: 177, documentId: 'fde5493c-f00a-52e3-b752-9ac36afa42d6', snapshots: 4, category: 'Review' },
  { legacyId: 238, documentId: 'f88e136e-c9f8-52ab-a67c-4d795e850796', snapshots: 15, category: 'Template' },
  { legacyId: 497, documentId: 'd2d7f714-c34d-53ac-8a63-48dfdb9355a9', snapshots: 5, category: 'Standard' },
  { legacyId: 24, documentId: 'e3155116-692d-519b-b1b2-57188de1e52b', snapshots: 26, category: 'Process' },
];

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find(existsSync);
if (!executablePath) throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run this test.');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const waitFor = async (predicate, message, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
};

const profilePath = await mkdtemp(join(tmpdir(), 'dms-legacy-history-e2e-'));
const chrome = spawn(
  executablePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--window-size=1440,1000',
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

let socket;
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
  }, 'Chrome did not expose a page target');

  const pageTarget = targets.find((target) => target.type === 'page');
  socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  let commandId = 0;
  const pendingCommands = new Map();
  const pageErrors = [];
  const networkRequests = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (message.method === 'Network.requestWillBeSent') {
      networkRequests.push(message.params.request.url);
    }
    const pending = pendingCommands.get(message.id);
    if (!pending) return;
    pendingCommands.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  });

  const send = (method, params = {}) => new Promise((resolveCommand, rejectCommand) => {
    const id = ++commandId;
    pendingCommands.set(id, { resolve: resolveCommand, reject: rejectCommand });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result.value;
      } catch (error) {
        if (!error.message.includes('Execution context was destroyed') || attempt === 19) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
    }
  };

  const waitForPage = (expression, message, timeoutMs) =>
    waitFor(async () => Boolean(await evaluate(expression)), message, timeoutMs);

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('dms_session_token', ${JSON.stringify(token)});`,
  });

  for (const pilot of pilots) {
    const response = await fetch(`${baseUrl}/api/documents/${pilot.documentId}/legacy-metadata-history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert(response.ok, `Legacy ${pilot.legacyId}: API returned ${response.status}`);
    const body = await response.json();
    assert(body.data?.legacyDocumentId === pilot.legacyId, `Legacy ${pilot.legacyId}: archive mapping mismatch`);
    assert(body.data?.snapshots?.length === pilot.snapshots, `Legacy ${pilot.legacyId}: API snapshot count mismatch`);
    assert(body.data.snapshots.every((snapshot) => snapshot.associatedFile?.legacyContentVersionId === snapshot.legacyContentVersionId), `Legacy ${pilot.legacyId}: metadata/content relationship mismatch`);

    await send('Page.navigate', { url: `${baseUrl}/documents?preview=${pilot.documentId}` });
    await waitForPage(
      `location.pathname === '/documents' && Array.from(document.querySelectorAll('button')).some((button) => button.getAttribute('aria-label')?.startsWith('View legacy metadata history of '))`,
      `Legacy ${pilot.legacyId}: Metadata History action did not appear`,
    );
    const headerText = await evaluate(`document.body.innerText`);
    assert(headerText.includes('Category') && headerText.includes(pilot.category), `Legacy ${pilot.legacyId}: Category ${pilot.category} is not visible`);
    const previewTitleLayout = await evaluate(`(() => {
      const title = document.getElementById('document-preview-title');
      if (!title) return null;
      const style = getComputedStyle(title);
      return {
        whiteSpace: style.whiteSpace,
        height: title.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    })()`);
    assert(previewTitleLayout?.whiteSpace === 'nowrap', `Legacy ${pilot.legacyId}: preview filename is not kept on one line`);
    assert(previewTitleLayout.height <= previewTitleLayout.lineHeight * 1.25, `Legacy ${pilot.legacyId}: preview filename wrapped onto multiple lines`);
    const actionRowLayout = await evaluate(`(() => {
      const toolbar = document.querySelector('[data-testid="document-preview-actions"]');
      if (!toolbar) return null;
      const visibleItems = Array.from(toolbar.children).filter((element) => element.getBoundingClientRect().width > 0);
      const centers = visibleItems.map((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top + (rect.height / 2);
      });
      return {
        whiteSpace: getComputedStyle(toolbar).flexWrap,
        centerSpread: Math.max(...centers) - Math.min(...centers),
      };
    })()`);
    assert(actionRowLayout?.whiteSpace === 'nowrap', `Legacy ${pilot.legacyId}: preview actions allow wrapping`);
    assert(actionRowLayout.centerSpread <= 1, `Legacy ${pilot.legacyId}: preview action buttons rendered on multiple lines`);
    if (pilot.legacyId === 230) {
      assert(!['COMPLIANCE', 'ISO 9001:2015', 'ISO 27001:2022', 'On-Premises Vault'].some((label) => headerText.includes(label)), 'Removed sidebar content is still visible');
      assert(await evaluate(`Boolean(document.querySelector('button[aria-label="Expand all folders"]') && document.querySelector('button[aria-label="Collapse all folders"]'))`), 'Folder Expand All / Collapse All controls are unavailable');

      const readPreviewAlignment = `(() => {
        const toggle = document.querySelector('button[aria-label="Collapse navigation"], button[aria-label="Expand navigation"]');
        const sidebar = toggle?.closest('aside');
        const preview = document.querySelector('[data-testid="document-preview-overlay"]');
        if (!sidebar || !preview) return null;
        const sidebarRect = sidebar.getBoundingClientRect();
        const previewRect = preview.getBoundingClientRect();
        return {
          sidebarWidth: sidebarRect.width,
          previewLeft: previewRect.left,
          previewRight: previewRect.right,
          viewportWidth: window.innerWidth,
        };
      })()`;
      const expandedAlignment = await evaluate(readPreviewAlignment);
      assert(expandedAlignment && Math.abs(expandedAlignment.previewLeft - expandedAlignment.sidebarWidth) <= 1, 'Document preview is not aligned beside the expanded sidebar');
      assert(Math.abs(expandedAlignment.previewRight - expandedAlignment.viewportWidth) <= 1, 'Document preview does not use the full available desktop width');

      await evaluate(`document.querySelector('button[aria-label="Collapse navigation"]')?.click()`);
      await waitForPage(`(() => {
        const sidebar = document.querySelector('button[aria-label="Expand navigation"]')?.closest('aside');
        const preview = document.querySelector('[data-testid="document-preview-overlay"]');
        return Boolean(sidebar && preview
          && sidebar.getBoundingClientRect().width < 100
          && Math.abs(sidebar.getBoundingClientRect().right - preview.getBoundingClientRect().left) <= 1);
      })()`, 'Document preview did not resize beside the collapsed sidebar');
      const collapsedAlignment = await evaluate(readPreviewAlignment);
      assert(collapsedAlignment.sidebarWidth < expandedAlignment.sidebarWidth, 'Sidebar did not collapse during document preview');
      assert(Math.abs(collapsedAlignment.previewRight - collapsedAlignment.viewportWidth) <= 1, 'Collapsed-sidebar preview does not fill the remaining viewport');

      await evaluate(`document.querySelector('button[aria-label="Expand navigation"]')?.click()`);
      await waitForPage(`(() => {
        const sidebar = document.querySelector('button[aria-label="Collapse navigation"]')?.closest('aside');
        const preview = document.querySelector('[data-testid="document-preview-overlay"]');
        return Boolean(sidebar && preview
          && sidebar.getBoundingClientRect().width > 250
          && Math.abs(sidebar.getBoundingClientRect().right - preview.getBoundingClientRect().left) <= 1);
      })()`, 'Document preview did not resize after expanding the sidebar again');
    }
    await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label')?.startsWith('View legacy metadata history of '))?.click()`);
    await waitForPage(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="legacy-metadata-history-title"]'))`, `Legacy ${pilot.legacyId}: dialog did not open`);

    if (pilot.legacyId === 230) {
      await evaluate(`document.querySelector('[role="dialog"][aria-labelledby="legacy-metadata-history-title"]')?.parentElement?.click()`);
      assert(await evaluate(`Boolean(document.querySelector('[role="dialog"][aria-labelledby="legacy-metadata-history-title"]'))`), 'Legacy Metadata History closed from a backdrop click');
    }

    const dialogState = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="legacy-metadata-history-title"]');
      const text = dialog?.innerText || '';
      return {
        text,
        snapshotCount: dialog?.querySelectorAll('[data-testid^="legacy-metadata-snapshot-"]').length || 0,
        currentCount: Array.from(dialog?.querySelectorAll('span') || []).filter((node) => node.textContent?.trim() === 'CURRENT AT MIGRATION').length,
        historicalCount: Array.from(dialog?.querySelectorAll('span') || []).filter((node) => node.textContent?.trim() === 'HISTORICAL').length,
        associatedFileCount: Array.from(dialog?.querySelectorAll('span') || []).filter((node) => node.textContent?.startsWith('Content Version ID:')).length,
      };
    })()`);
    assert(dialogState.text.includes(`Legacy document #${pilot.legacyId}`), `Legacy ${pilot.legacyId}: wrong document provenance`);
    assert(dialogState.currentCount === 1, `Legacy ${pilot.legacyId}: current snapshot label missing or duplicated`);
    assert(dialogState.historicalCount === pilot.snapshots - 1, `Legacy ${pilot.legacyId}: historical labels mismatch`);
    assert(dialogState.snapshotCount === pilot.snapshots, `Legacy ${pilot.legacyId}: UI snapshot count mismatch`);
    assert(dialogState.associatedFileCount === pilot.snapshots, `Legacy ${pilot.legacyId}: associated files are not shown for every snapshot`);
    assert(dialogState.text.includes('File status:'), `Legacy ${pilot.legacyId}: file availability is not visible`);
    for (const fieldName of ['Authors', 'IP number', 'Internal/External']) {
      assert(dialogState.text.includes(fieldName), `Legacy ${pilot.legacyId}: ${fieldName} is not visible`);
    }

    if (pilot.legacyId === 230) {
      assert(dialogState.text.includes('Bassem Mortada, Mostafa Medhat'), 'Legacy 230: superseded Authors value is not visible');
      assert(dialogState.text.includes('Legacy description column'), 'Legacy 230: separate base description field is not visible');

      const currentFile = body.data.snapshots.find((snapshot) => snapshot.isCurrentAtMigration && snapshot.associatedFile?.isAvailable);
      const historicalFile = body.data.snapshots.find((snapshot) => !snapshot.isCurrentAtMigration
        && snapshot.associatedFile?.isAvailable
        && snapshot.legacyContentVersionId !== currentFile?.legacyContentVersionId);
      assert(currentFile && historicalFile, 'Legacy 230: current and historical preview samples were not available');

      for (const snapshot of [currentFile, historicalFile]) {
        const requestStart = networkRequests.length;
        const snapshotSelector = `[data-testid="legacy-metadata-snapshot-${snapshot.metadataVersion}"]`;
        await evaluate(`document.querySelector(${JSON.stringify(snapshotSelector)})?.querySelector('button[aria-label^="View "]')?.click()`);
        await waitForPage(`Boolean(document.querySelector('[role="dialog"][aria-label^="Preview "]'))`, `Legacy 230 content ${snapshot.legacyContentVersionId}: preview dialog did not open`);
        await waitForPage(`(() => { const dialog = document.querySelector('[role="dialog"][aria-label^="Preview "]'); return Boolean(dialog && !dialog.querySelector('.animate-spin')); })()`, `Legacy 230 content ${snapshot.legacyContentVersionId}: preview did not resolve`, 120_000);

        const previewState = await evaluate(`(() => { const dialog = document.querySelector('[role="dialog"][aria-label^="Preview "]'); return { text: dialog?.innerText || '', rendered: Boolean(dialog?.querySelector('iframe, img, pre, table')) }; })()`);
        assert(previewState.rendered || previewState.text.includes('Preview unavailable'), `Legacy 230 content ${snapshot.legacyContentVersionId}: neither a viewer nor the normal unavailable state appeared`);
        const actionRequests = networkRequests.slice(requestStart);
        assert(actionRequests.some((url) => url.includes(`/legacy-content/${snapshot.legacyContentVersionId}/view`)), `Legacy 230 content ${snapshot.legacyContentVersionId}: View did not request its exact archive file`);
        assert(!actionRequests.some((url) => url.includes(`/legacy-content/${snapshot.legacyContentVersionId}/download`)), `Legacy 230 content ${snapshot.legacyContentVersionId}: View incorrectly triggered Download`);

        const downloadResponse = await fetch(`${baseUrl}/api/documents/${pilot.documentId}/legacy-content/${snapshot.legacyContentVersionId}/download`, { headers: { Authorization: `Bearer ${token}` } });
        assert(downloadResponse.ok && downloadResponse.headers.get('content-disposition')?.toLowerCase().includes('attachment'), `Legacy 230 content ${snapshot.legacyContentVersionId}: explicit Download is unavailable`);
        await downloadResponse.body?.cancel();

        await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label')?.startsWith('Close preview of '))?.click()`);
        await waitForPage(`!document.querySelector('[role="dialog"][aria-label^="Preview "]')`, `Legacy 230 content ${snapshot.legacyContentVersionId}: preview did not close`);
      }
    }

    await evaluate(`document.querySelector('button[aria-label="Close legacy metadata history"]')?.click()`);
    await waitForPage(`!document.querySelector('[role="dialog"][aria-labelledby="legacy-metadata-history-title"]')`, `Legacy ${pilot.legacyId}: dialog did not close`);
    assert(await evaluate(`Array.from(document.querySelectorAll('button')).some((button) => button.getAttribute('aria-label')?.startsWith('View version history of '))`), `Legacy ${pilot.legacyId}: native History action changed`);
  }

  // Exercise the native New-DMS History once and confirm it remains its own UI.
  await waitForPage(
    `Array.from(document.querySelectorAll('button')).some((button) => button.getAttribute('aria-label')?.startsWith('View version history of ') && !button.disabled)`,
    'Native History action remained disabled after folder permissions loaded',
  );
  const nativeHistoryState = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => candidate.getAttribute('aria-label')?.startsWith('View version history of '));
    return button ? { found: true, disabled: button.disabled, label: button.getAttribute('aria-label') } : { found: false };
  })()`);
  assert(nativeHistoryState.found && !nativeHistoryState.disabled, `Native History action unavailable: ${JSON.stringify(nativeHistoryState)}`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label')?.startsWith('View version history of '))?.click()`);
  await waitForPage(`Array.from(document.querySelectorAll('h2')).some((heading) => heading.textContent?.trim() === 'Version History')`, 'Native Version History did not open');
  assert(!await evaluate(`Array.from(document.querySelectorAll('h2')).some((heading) => heading.textContent?.trim() === 'Legacy Metadata History')`), 'Native and legacy history views were combined');
  assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join('; ')}`);

  console.log('Legacy metadata history browser validation passed for 5/5 pilot documents.');
} finally {
  socket?.close();
  chrome.kill();
  await Promise.race([chromeExited, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
  await rm(profilePath, { recursive: true, force: true });
}
