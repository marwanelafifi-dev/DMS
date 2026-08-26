const apiBaseUrl = process.env.DMS_API_BASE_URL || 'http://localhost:8080/api';
const email = process.env.DMS_TEST_EMAIL;
const password = process.env.DMS_TEST_PASSWORD;

if (!email || !password) {
  throw new Error('DMS_TEST_EMAIL and DMS_TEST_PASSWORD are required.');
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

const token = loginBody.data.token;
const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};
const documentsResponse = await fetch(`${apiBaseUrl}/documents`, { headers: authHeaders });
const documentsBody = await documentsResponse.json();
const referenceDocument = documentsBody?.data?.find((item) => item.folderId);

if (!documentsResponse.ok || !referenceDocument) {
  throw new Error('Could not find an accessible folder for the delete regression check.');
}

let temporaryDocumentId;

try {
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
    throw new Error(`Could not create the delete fixture: ${JSON.stringify(createBody)}`);
  }

  temporaryDocumentId = createBody.data.documentId;
  const uploadBody = new FormData();
  uploadBody.append('file', new Blob(['delete regression fixture'], { type: 'text/plain' }), temporaryTitle);
  uploadBody.append('versionLabel', '1.0');

  const uploadResponse = await fetch(`${apiBaseUrl}/documents/${temporaryDocumentId}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: uploadBody,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Could not upload the delete fixture: ${await uploadResponse.text()}`);
  }

  const deleteResponse = await fetch(`${apiBaseUrl}/documents/${temporaryDocumentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const deleteBody = await deleteResponse.json();

  if (!deleteResponse.ok || deleteBody?.success !== true) {
    throw new Error(`Document delete failed: ${JSON.stringify(deleteBody)}`);
  }

  const deletedDocumentResponse = await fetch(`${apiBaseUrl}/documents/${temporaryDocumentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (deletedDocumentResponse.status !== 404) {
    throw new Error(`Deleted fixture is still readable (status ${deletedDocumentResponse.status}).`);
  }

  temporaryDocumentId = undefined;
  console.log('Document API create/upload/delete lifecycle: PASS');
} finally {
  if (temporaryDocumentId) {
    await fetch(`${apiBaseUrl}/documents/${temporaryDocumentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
}
