const apiBaseUrl = process.env.DMS_API_BASE_URL || 'http://localhost:8080/api';
const email = process.env.DMS_TEST_EMAIL;
const password = process.env.DMS_TEST_PASSWORD;
const documentId = process.env.DMS_MIGRATED_DOCUMENT_ID;
const versionId = process.env.DMS_MIGRATED_VERSION_ID;
const expectedSha256 = process.env.DMS_EXPECTED_SHA256;

if (!email || !password || !documentId || !versionId || !expectedSha256) {
  throw new Error(
    'DMS_TEST_EMAIL, DMS_TEST_PASSWORD, DMS_MIGRATED_DOCUMENT_ID, DMS_MIGRATED_VERSION_ID, and DMS_EXPECTED_SHA256 are required.',
  );
}

const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const loginBody = await loginResponse.json();

if (!loginResponse.ok || !loginBody?.data?.token) {
  throw new Error(`Login failed with status ${loginResponse.status}.`);
}

const deleteResponse = await fetch(`${apiBaseUrl}/documents/${documentId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${loginBody.data.token}` },
});
const deleteBody = await deleteResponse.json();

if (deleteResponse.status !== 409) {
  throw new Error(
    `Expected migrated-document delete to return 409, received ${deleteResponse.status}: ${JSON.stringify(deleteBody)}`,
  );
}

if (!deleteBody?.error?.includes('legacy migration history')) {
  throw new Error(`Expected a legacy-history protection message, received: ${JSON.stringify(deleteBody)}`);
}

const bulkDeleteResponse = await fetch(`${apiBaseUrl}/documents/bulk-delete`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${loginBody.data.token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ documentIds: [documentId] }),
});
const bulkDeleteBody = await bulkDeleteResponse.json();
const bulkFailure = bulkDeleteBody?.data?.failed?.[0];

if (
  !bulkDeleteResponse.ok
  || bulkDeleteBody?.data?.succeeded?.length !== 0
  || bulkFailure?.documentId !== documentId
  || !bulkFailure?.error?.includes('legacy migration history')
) {
  throw new Error(`Bulk delete did not report protected legacy history correctly: ${JSON.stringify(bulkDeleteBody)}`);
}

const migratedFileResponse = await fetch(
  `${apiBaseUrl}/documents/${documentId}/versions/${versionId}/download`,
  { headers: { Authorization: `Bearer ${loginBody.data.token}` } },
);
const migratedFile = new Uint8Array(await migratedFileResponse.arrayBuffer());
const migratedFileDigest = await crypto.subtle.digest('SHA-256', migratedFile);
const migratedFileSha256 = Array.from(new Uint8Array(migratedFileDigest))
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

if (!migratedFileResponse.ok || migratedFileSha256 !== expectedSha256.toLowerCase()) {
  throw new Error(
    `Protected migrated file is not readable with the expected hash (status ${migratedFileResponse.status}, SHA-256 ${migratedFileSha256}).`,
  );
}

const authHeaders = {
  Authorization: `Bearer ${loginBody.data.token}`,
  'Content-Type': 'application/json',
};
const documentsResponse = await fetch(`${apiBaseUrl}/documents`, { headers: authHeaders });
const documentsBody = await documentsResponse.json();
const referenceDocument = documentsBody?.data?.find((item) => item.folderId);

if (!documentsResponse.ok || !referenceDocument) {
  throw new Error('Could not find an accessible folder for the normal-delete regression check.');
}

const temporaryTitle = `delete-regression-${crypto.randomUUID()}.txt`;
const createResponse = await fetch(`${apiBaseUrl}/documents`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    title: temporaryTitle,
    folderId: referenceDocument.folderId,
    ownerId: loginBody.data.user.userId,
    description: 'Temporary document used by the delete endpoint regression test.',
    department: referenceDocument.department || 'Corporate',
    category: referenceDocument.category || 'Business',
  }),
});
const createBody = await createResponse.json();

if (!createResponse.ok || !createBody?.data?.documentId) {
  throw new Error(`Could not create the normal-delete fixture: ${JSON.stringify(createBody)}`);
}

const temporaryDocumentId = createBody.data.documentId;
const uploadBody = new FormData();
uploadBody.append('file', new Blob(['delete regression fixture'], { type: 'text/plain' }), temporaryTitle);
uploadBody.append('versionLabel', '1.0');

const uploadResponse = await fetch(`${apiBaseUrl}/documents/${temporaryDocumentId}/upload`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${loginBody.data.token}` },
  body: uploadBody,
});

if (!uploadResponse.ok) {
  throw new Error(`Could not upload the normal-delete fixture: ${await uploadResponse.text()}`);
}

const normalDeleteResponse = await fetch(`${apiBaseUrl}/documents/${temporaryDocumentId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${loginBody.data.token}` },
});
const normalDeleteBody = await normalDeleteResponse.json();

if (!normalDeleteResponse.ok || normalDeleteBody?.success !== true) {
  throw new Error(`Normal document delete regressed: ${JSON.stringify(normalDeleteBody)}`);
}

const deletedDocumentResponse = await fetch(`${apiBaseUrl}/documents/${temporaryDocumentId}`, {
  headers: { Authorization: `Bearer ${loginBody.data.token}` },
});

if (deletedDocumentResponse.status !== 404) {
  throw new Error(`Deleted fixture is still readable (status ${deletedDocumentResponse.status}).`);
}

console.log('Migrated-document protection and normal-document deletion: PASS');
