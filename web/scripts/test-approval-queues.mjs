const apiBaseUrl = (process.env.DMS_API_URL || 'http://localhost:8080/api').replace(/\/$/, '');
const email = process.env.DMS_TEST_EMAIL || 'admin@si-ware.com';
const password = process.env.DMS_TEST_PASSWORD || 'Admin@12345';

async function readJson(response) {
  const body = await response.text();

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${response.status} ${response.statusText}: ${body || '<empty response>'}`);
  }
}

const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const login = await readJson(loginResponse);

if (!loginResponse.ok || !login.success || !login.data?.token) {
  throw new Error(`Login failed: ${login.error || loginResponse.statusText}`);
}

const headers = { Authorization: `Bearer ${login.data.token}` };
const queues = [
  'qa-review-queue',
  'manager-review-queue',
  'final-release-queue',
];

for (const queue of queues) {
  const response = await fetch(`${apiBaseUrl}/approvals/${queue}?page=1&pageSize=1`, { headers });
  const result = await readJson(response);

  if (!response.ok || !result.success || !Array.isArray(result.data)) {
    throw new Error(`${queue} failed: ${result.error || response.statusText}`);
  }
}

console.log('PASS: all C-Doc approval queues are queryable');
