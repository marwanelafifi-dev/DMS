# 🚀 UPLOAD FEATURE FIX GUIDE

**Status:** Ready for Implementation  
**Complexity:** Medium  
**Time Estimate:** 30-45 minutes  
**Priority:** CRITICAL for production release

---

## The Problem
The Documents page upload modal uses **mock in-memory storage** instead of calling the real API. When users select a file and click "Upload", it stores data in memory only - no file is saved to MinIO.

---

## The Solution

### Step 1: Update API Client Method ✅ (Already correct)
The `uploadDocument()` method in `src/utils/api.ts` already calls the right endpoint:
```typescript
async uploadDocument(documentId: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await this.client.post<ApiResponse>(
    `/documents/${documentId}/upload`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}
```
✅ This is already correct!

---

### Step 2: Fix Documents.tsx Upload Handler

**File:** `web/src/components/pages/Documents.tsx`

**Find:** The `handleFileUpload` or `handleUpload` function (around line ~400-450)

**Replace with:**
```typescript
const handleUpload = async () => {
  if (uploadFiles.length === 0) {
    showError('No files selected');
    return;
  }

  setIsUploading(true);
  try {
    for (const file of uploadFiles) {
      // Create document first
      const docRes = await apiClient.createDocument({
        title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
        folderId: selectedFolderId,
        status: 'draft',
      });

      if (!docRes.success) {
        showError(`Failed to create document for ${file.name}`);
        continue;
      }

      const documentId = docRes.data?.documentId;
      if (!documentId) {
        showError(`No document ID received for ${file.name}`);
        continue;
      }

      // Upload file to the document
      const uploadRes = await apiClient.uploadDocument(documentId, file);
      
      if (uploadRes.success) {
        showSuccess(`${file.name} uploaded successfully`);
        // Add to documents list
        setAllDocuments(prev => [...prev, uploadRes.data]);
        setUploadProgress(prev => ({
          ...prev,
          complete: prev.complete + 1,
        }));
      } else {
        showError(`Failed to upload ${file.name}`);
      }
    }

    // Clear upload state
    setUploadFiles([]);
    setUploadProgress({ complete: 0, total: 0 });
    setShowUploadModal(false);
  } catch (error) {
    showError('Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
  } finally {
    setIsUploading(false);
  }
};
```

---

### Step 3: Update Upload Progress Display

In the upload modal, make sure it shows:
```typescript
<div className="mt-3 text-sm text-gray-600">
  {uploadProgress.complete > 0 && (
    <p>{uploadProgress.complete} of {uploadFiles.length} uploaded</p>
  )}
</div>
```

---

### Step 4: Test the Fix

1. **Refresh browser** (Ctrl+Shift+R)
2. **Go to Document Library**
3. **Click "Upload Documents"**
4. **Select a test file** (PDF, Word, Image, etc.)
5. **Click "Upload 1 file"**
6. **Expected result:**
   - Document created in database
   - File stored in MinIO
   - New document appears in library
   - Success message shown

---

## Verification Checklist

After implementing:

- [ ] Search for uploaded document - should find it
- [ ] Download uploaded file - should work
- [ ] File appears with correct status (Draft)
- [ ] Can approve document workflow
- [ ] Check MinIO console - file is stored
- [ ] Check API logs - upload request logged
- [ ] Check audit trail - upload recorded

---

## Backend Validation

The API endpoint (`POST /api/documents/{id}/upload`) already:
- ✅ Stores file in MinIO
- ✅ Creates document version
- ✅ Validates file type
- ✅ Calculates SHA256 hash
- ✅ Logs audit trail
- ✅ Returns success response

**No backend changes needed!**

---

## Expected Timeline

- **Implementation:** 20-30 minutes
- **Testing:** 10-15 minutes
- **Total:** ~45 minutes

---

## Questions?

Once implemented, test it and report back with:
1. Did the file upload succeed?
2. Can you find the document via search?
3. Can you approve the uploaded document?

Then UPLOAD FEATURE will be FIXED! 🎉
