import { useState, useRef } from 'react';
import { Card, CardBody } from '../ui';

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  isLoading?: boolean;
  maxSize?: number; // bytes
}

export function UploadZone({
  onFilesSelected,
  isLoading = false,
  maxSize = 100 * 1024 * 1024, // 100MB default
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
  };

  const handleFiles = (files: File[]) => {
    const validFiles = files.filter((file) => {
      if (file.size > maxSize) {
        console.warn(`File ${file.name} exceeds size limit`);
        return false;
      }
      return true;
    });

    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card
      className={`border-2 border-dashed transition-all cursor-pointer ${
        isDragging
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-gray-300 dark:border-gray-600'
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => !isLoading && fileInputRef.current?.click()}
    >
      <CardBody className="py-12 text-center">
        <div className="space-y-3">
          {/* Upload Icon */}
          <svg
            className={`w-12 h-12 mx-auto transition-colors ${
              isDragging
                ? 'text-primary-500'
                : 'text-gray-400 dark:text-gray-500'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
            />
          </svg>

          {/* Text */}
          <div>
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {isLoading ? 'Uploading...' : 'Drag and drop files here'}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              or click to browse files
            </p>
          </div>

          {/* File Info */}
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Max file size: {(maxSize / (1024 * 1024)).toFixed(0)}MB
          </p>

          {/* Upload Button (if not loading) */}
          {!isLoading && (
            <button
              type="button"
              className="inline-block mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-md font-medium transition-colors disabled:opacity-50"
              disabled={isLoading}
            >
              Select Files
            </button>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-primary-600">Uploading...</span>
            </div>
          )}
        </div>

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.png,.gif"
          disabled={isLoading}
        />
      </CardBody>
    </Card>
  );
}
