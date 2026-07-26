import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const baseUrl = process.env.DMS_WEB_ORIGIN || 'http://localhost:5174';
const apiUserId = '00000000-0000-0000-0000-000000000001';
const artifactDirectory = resolve(process.cwd(), '../artifacts');
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
  throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to run the critical workflow tests.');
}

const runId = Date.now().toString(36);
const uploadFileName = `e2e-critical-${runId}.txt`;
const uploadTitle = uploadFileName.replace(/\.txt$/, '');
const uploadContents = `DMS critical workflow browser test ${runId}`;
const profilePath = await mkdtemp(join(tmpdir(), 'dms-critical-e2e-'));
const downloadPath = join(profilePath, 'downloads');
const uploadPath = join(profilePath, uploadFileName);
await mkdir(downloadPath, { recursive: true });
await mkdir(artifactDirectory, { recursive: true });
await writeFile(uploadPath, uploadContents, 'utf8');

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
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

const waitFor = async (predicate, message, timeoutMs = 15_000) => {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
};

const apiRequest = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      'X-User-Id': apiUserId,
      ...options.headers,
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
};

let uploadedDocumentId;
let cleanupError;
const cleanupDocumentIds = [];

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
  const browserErrors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      browserErrors.push(message.params.exceptionDetails.text);
    }
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
        const result = await send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (result.exceptionDetails) {
          const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
          throw new Error(description);
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

  const navigate = async (path, readySelector) => {
    await send('Page.navigate', { url: `${baseUrl}${path}` });
    await waitForPage(
      `location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete' && Boolean(document.querySelector(${JSON.stringify(readySelector)}))`,
      `${path} did not finish rendering`,
    );
  };

  const setControlValue = async (selector, value) => {
    const changed = await evaluate(`(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      if (!control) return false;
      const prototype = control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(value)});
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!changed) throw new Error(`Control not found: ${selector}`);
  };

  const clickButton = async (label) => {
    const clicked = await evaluate(`(() => {
      const normalize = (value) => value.replace(/\\s+/g, ' ').trim();
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        normalize(candidate.textContent || '') === ${JSON.stringify(label)}
        && !candidate.disabled
        && candidate.getClientRects().length > 0
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`Enabled visible button not found: ${label}`);
  };

  const captureScreenshot = async (name) => {
    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(join(artifactDirectory, name), Buffer.from(screenshot.data, 'base64'));
  };

  await send('Page.enable');
  await send('DOM.enable');
  await send('Runtime.enable');
  await send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
    eventsEnabled: true,
  });

  console.log(`RUN upload-preview-download-search (${uploadFileName})`);
  await navigate('/documents', 'button[aria-label="Upload files"]');
  await waitForPage(
    `!document.querySelector('button[aria-label="Upload files"]').disabled`,
    'Upload action did not become available',
  );

  const documentTree = await send('DOM.getDocument', { depth: -1, pierce: true });
  const fileInput = await send('DOM.querySelector', {
    nodeId: documentTree.root.nodeId,
    selector: 'input[aria-label="Select documents to upload"]',
  });
  if (!fileInput.nodeId) throw new Error('Upload file input was not found');
  await send('DOM.setFileInputFiles', {
    nodeId: fileInput.nodeId,
    files: [uploadPath],
  });

  await waitForPage(
    `document.body.textContent.includes(${JSON.stringify(uploadFileName)}) && document.body.textContent.includes('1 file ready')`,
    'Selected file did not appear in the upload dialog',
  );
  await clickButton('Upload 1 file');
  await waitForPage(
    `Boolean(document.querySelector('button[aria-label=${JSON.stringify(`Preview ${uploadFileName}`)}]'))`,
    'Uploaded document did not appear in the library',
    30_000,
  );

  const documentsResponse = await apiRequest('/documents');
  const persistedDocument = documentsResponse.data.find((document) => document.title === uploadTitle);
  if (!persistedDocument?.documentId || !persistedDocument.currentVersionId) {
    throw new Error('Uploaded document was not persisted with a downloadable version');
  }
  uploadedDocumentId = persistedDocument.documentId;
  cleanupDocumentIds.push(uploadedDocumentId);

  const previewOpened = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label=${JSON.stringify(`Preview ${uploadFileName}`)}]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!previewOpened) throw new Error('Preview action was not available for the uploaded document');
  await waitForPage(
    `document.querySelector('[data-testid="document-preview-overlay"]')?.textContent.includes(${JSON.stringify(uploadContents)})`,
    'Uploaded text file did not render in the document preview',
  );
  await captureScreenshot('e2e-critical-upload-preview.png');

  const previewClosed = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="Close document preview"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!previewClosed) throw new Error('Document preview close action was not available');
  await waitForPage(
    `!document.querySelector('[data-testid="document-preview-overlay"]')`,
    'Document preview did not close',
  );

  const downloadClicked = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label=${JSON.stringify(`Download ${uploadFileName}`)}]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!downloadClicked) throw new Error('Download action was not available for the uploaded document');
  await waitFor(
    async () => (await readdir(downloadPath)).some((name) => name === uploadFileName),
    'Browser download did not complete',
  );

  await send('Page.reload', { ignoreCache: true });
  await waitForPage(
    `location.pathname === '/documents'
      && document.readyState === 'complete'
      && Boolean(document.querySelector('input[aria-label="Search documents"]'))`,
    'Documents page did not finish reloading',
  );
  await waitForPage(
    `Boolean(document.querySelector('button[aria-label=${JSON.stringify(`Preview ${uploadFileName}`)}]'))`,
    'Uploaded document disappeared after refreshing the Documents page',
    30_000,
  );

  await navigate('/search', '#parsed-document-search');
  await setControlValue('#parsed-document-search', uploadContents);
  await clickButton('Search');
  await waitForPage(
    `!document.body.textContent.includes('Searching...')
      && Boolean(document.querySelector('button[aria-label=${JSON.stringify(`View parsed ${uploadFileName}`)}]'))`,
    'Search results did not render',
    30_000,
  );
  await evaluate(`document.querySelector(
    'button[aria-label=${JSON.stringify(`View parsed ${uploadFileName}`)}]'
  ).click()`);
  await waitForPage(
    `document.querySelector(
      'section[aria-label=${JSON.stringify(`Parsed content for ${uploadFileName}`)}]'
    )?.textContent.includes(${JSON.stringify(uploadContents)})`,
    'Parsed Markdown viewer did not render the uploaded document content',
  );
  await captureScreenshot('e2e-critical-search-results.png');

  await navigate('/documents', 'input[aria-label="Search documents"]');
  await waitForPage(
    `Boolean(document.querySelector('button[aria-label=${JSON.stringify(`Preview ${uploadFileName}`)}]'))`,
    'Uploaded document disappeared after navigating away from and back to the Documents page',
    30_000,
  );
  console.log('PASS upload-preview-download-search');

  const createSubmittedDocument = async (title) => {
    const createResponse = await apiRequest('/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId: persistedDocument.folderId,
        title,
        ownerId: apiUserId,
      }),
    });
    const documentId = createResponse.data?.documentId;
    if (!documentId) throw new Error(`The API did not return an ID for approval fixture "${title}"`);
    cleanupDocumentIds.push(documentId);

    const fileName = `${title}.txt`;
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([`Approval workflow fixture ${title}`], { type: 'text/plain' }),
      fileName,
    );
    const uploadResponse = await apiRequest(`/documents/${documentId}/upload`, {
      method: 'POST',
      body: formData,
    });
    const versionId = uploadResponse.data?.versionId;
    if (!versionId) throw new Error(`The API did not return a version for approval fixture "${title}"`);

    await apiRequest(`/documents/${documentId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versionId,
        comment: `E2E submission ${runId}`,
      }),
    });
    return { documentId, versionId, title };
  };

  const approveFixture = await createSubmittedDocument(`E2E Approve ${runId}`);
  const rejectFixture = await createSubmittedDocument(`E2E Reject ${runId}`);
  const approvalComment = `Approved by critical E2E ${runId}`;
  const rejectionReason = `Rejected by critical E2E ${runId}`;

  console.log(`RUN approval (${approveFixture.title})`);
  await navigate('/approvals', 'input[aria-label="Search approvals"]');
  await waitForPage(
    `document.body.textContent.includes(${JSON.stringify(approveFixture.title)})
      && document.body.textContent.includes(${JSON.stringify(rejectFixture.title)})`,
    'Submitted approval fixtures did not appear in the approval queue',
    30_000,
  );
  await captureScreenshot('e2e-critical-approval-queue.png');

  const approveOpened = await evaluate(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((candidate) =>
      candidate.textContent.includes(${JSON.stringify(approveFixture.title)})
    );
    const button = row?.querySelector('button[title="Approve"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!approveOpened) throw new Error('Approve action was not available for the submitted fixture');
  await waitForPage(
    `document.querySelector('[role="dialog"]')?.textContent.includes('Approve Document')`,
    'Approve dialog did not open',
  );
  await setControlValue(
    '[role="dialog"] textarea[placeholder="Add approval comments..."]',
    approvalComment,
  );
  const approveConfirmed = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const button = [...dialog.querySelectorAll('button')].find((candidate) =>
      candidate.textContent.trim() === 'Approve' && !candidate.disabled
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!approveConfirmed) throw new Error('Approve confirmation action was not available');
  await waitForPage(
    `!document.querySelector('[role="dialog"]')
      && ![...document.querySelectorAll('tbody tr')].some((row) => row.textContent.includes(${JSON.stringify(approveFixture.title)}))`,
    'Approved document did not leave the pending queue',
    30_000,
  );
  const approvedStatus = await apiRequest(
    `/documents/${approveFixture.documentId}/approval-status?versionId=${approveFixture.versionId}`,
  );
  if (
    approvedStatus.data?.status !== 'released'
    || approvedStatus.data?.approvalComment !== approvalComment
  ) {
    throw new Error(`Approval was not persisted correctly: ${JSON.stringify(approvedStatus.data)}`);
  }
  console.log('PASS approval');

  console.log(`RUN rejection (${rejectFixture.title})`);
  const rejectOpened = await evaluate(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((candidate) =>
      candidate.textContent.includes(${JSON.stringify(rejectFixture.title)})
    );
    const button = row?.querySelector('button[title="Reject"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!rejectOpened) throw new Error('Reject action was not available for the submitted fixture');
  await waitForPage(
    `document.querySelector('[role="dialog"]')?.textContent.includes('Reject Document')`,
    'Reject dialog did not open',
  );
  await setControlValue(
    '[role="dialog"] textarea[placeholder="Explain the rejection reason..."]',
    rejectionReason,
  );
  const rejectConfirmed = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const button = [...dialog.querySelectorAll('button')].find((candidate) =>
      candidate.textContent.trim() === 'Reject' && !candidate.disabled
    );
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!rejectConfirmed) throw new Error('Reject confirmation action was not available');
  await waitForPage(
    `!document.querySelector('[role="dialog"]')
      && ![...document.querySelectorAll('tbody tr')].some((row) => row.textContent.includes(${JSON.stringify(rejectFixture.title)}))`,
    'Rejected document did not leave the pending queue',
    30_000,
  );
  const rejectedStatus = await apiRequest(
    `/documents/${rejectFixture.documentId}/approval-status?versionId=${rejectFixture.versionId}`,
  );
  if (
    rejectedStatus.data?.status !== 'rejected'
    || rejectedStatus.data?.approvalComment !== `REJECTED: ${rejectionReason}`
  ) {
    throw new Error(`Rejection was not persisted correctly: ${JSON.stringify(rejectedStatus.data)}`);
  }
  await captureScreenshot('e2e-critical-approval-complete.png');
  console.log('PASS rejection');

  const taskTitle = `E2E Task ${runId}`;
  const taskDescription = `Critical workflow task created by browser test ${runId}`;
  const taskDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  console.log(`RUN task-create-filter-complete (${taskTitle})`);
  await navigate('/tasks', 'input[aria-label="Search PCAR records"]');
  await waitForPage(
    `Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.includes('New PCAR')))`,
    'New PCAR action did not become available',
  );
  await clickButton('New PCAR');
  await waitForPage(
    `document.body.textContent.includes('Create New Task')
      && Boolean(document.querySelector('select:has(option[value=${JSON.stringify(persistedDocument.documentId)}])'))
      && Boolean(document.querySelector('select:has(option[value=${JSON.stringify(apiUserId)}])'))`,
    'Task creation form did not finish loading its document and assignee options',
    30_000,
  );
  await setControlValue('input[placeholder="e.g., Fix QMS documentation"]', taskTitle);
  await setControlValue('textarea[placeholder="Task details..."]', taskDescription);
  await setControlValue(
    `select:has(option[value="${persistedDocument.documentId}"])`,
    persistedDocument.documentId,
  );
  await setControlValue('div.fixed.inset-0 input[type="date"]', taskDueDate);
  const taskFormValues = await evaluate(`(() => {
    const overlay = [...document.querySelectorAll('div.fixed.inset-0')].find((element) =>
      element.textContent.includes('Create New Task')
    );
    return {
      title: overlay?.querySelector('input[placeholder="e.g., Fix QMS documentation"]')?.value,
      documentId: overlay?.querySelector('select:has(option[value=${JSON.stringify(persistedDocument.documentId)}])')?.value,
      dueDate: overlay?.querySelector('input[type="date"]')?.value,
    };
  })()`);
  if (
    taskFormValues.title !== taskTitle
    || taskFormValues.documentId !== persistedDocument.documentId
    || taskFormValues.dueDate !== taskDueDate
  ) {
    throw new Error(`Task form was not populated correctly: ${JSON.stringify(taskFormValues)}`);
  }
  await clickButton('Create Task');

  await waitForPage(
    `!document.body.textContent.includes('Create New Task')
      && [...document.querySelectorAll('tbody tr')].some((row) => row.textContent.includes(${JSON.stringify(taskTitle)}))`,
    'Created task did not appear in the PCAR register',
    30_000,
  );
  await setControlValue('input[aria-label="Search PCAR records"]', taskTitle);
  await waitForPage(
    `[...document.querySelectorAll('tbody tr')].filter((row) => row.textContent.includes(${JSON.stringify(taskTitle)})).length === 1`,
    'Task search did not isolate the created task',
  );

  const tasksResponse = await apiRequest('/tasks?page=1&pageSize=100');
  const persistedTask = tasksResponse.data.find((task) => task.title === taskTitle);
  if (!persistedTask?.taskId || persistedTask.status !== 'open') {
    throw new Error(`Created task was not persisted as open: ${JSON.stringify(persistedTask)}`);
  }

  const completeOpened = await evaluate(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((candidate) =>
      candidate.textContent.includes(${JSON.stringify(taskTitle)})
    );
    const button = row?.querySelector('button[title="Mark as complete"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!completeOpened) throw new Error('Mark-as-complete action was not available for the created task');
  await waitForPage(
    `document.body.textContent.includes('Mark as Complete')
      && document.body.textContent.includes(${JSON.stringify(taskTitle)})`,
    'Task completion confirmation did not open',
  );
  await clickButton('Mark Complete');
  await waitForPage(
    `[...document.querySelectorAll('tbody tr')].some((row) =>
      row.textContent.includes(${JSON.stringify(taskTitle)})
      && row.textContent.toLowerCase().includes('done')
    )`,
    'Completed task did not show the done status',
    30_000,
  );
  const completedTask = await apiRequest(`/tasks/${persistedTask.taskId}`);
  if (completedTask.data?.status !== 'completed') {
    throw new Error(`Task completion was not persisted: ${JSON.stringify(completedTask.data)}`);
  }
  await captureScreenshot('e2e-critical-task-complete.png');
  console.log(`PASS task-create-filter-complete (${persistedTask.taskId})`);

  if (browserErrors.length > 0) {
    throw new Error(`Uncaught browser errors: ${browserErrors.join('; ')}`);
  }
  console.log('PASS all critical workflows');
  socket.close();
} finally {
  for (const documentId of [...cleanupDocumentIds].reverse()) {
    try {
      await apiRequest(`/documents/${documentId}`, { method: 'DELETE' });
    } catch (error) {
      cleanupError ??= new Error(`Could not remove E2E document ${documentId}: ${error.message}`);
    }
  }
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

if (cleanupError) throw cleanupError;
