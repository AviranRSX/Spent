import "server-only";

export const MAX_IMPORT_FILES = 20;
export const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_IMPORT_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_REQUEST_BYTES = 52 * 1024 * 1024;

export type ImportUploadLimitCode =
  | "too_many_files"
  | "file_too_large"
  | "upload_too_large"
  | "request_too_large";

export interface ImportUploadLimitViolation {
  code: ImportUploadLimitCode;
  message: string;
}

export function createImportUploadLimitResponse(
  violation: ImportUploadLimitViolation
): Response {
  return Response.json(
    { success: false, message: violation.message },
    { status: 413 }
  );
}

interface UploadSize {
  size: number;
}

export function getImportRequestLimitViolation(
  contentLength: string | null
): ImportUploadLimitViolation | null {
  if (contentLength == null) return null;
  const size = Number(contentLength);
  if (!Number.isFinite(size) || size < 0) return null;
  return size > MAX_IMPORT_REQUEST_BYTES
    ? {
        code: "request_too_large",
        message: "The upload request exceeds the size limit",
      }
    : null;
}

export function getImportUploadLimitViolation(
  files: readonly UploadSize[]
): ImportUploadLimitViolation | null {
  if (files.length > MAX_IMPORT_FILES) {
    return {
      code: "too_many_files",
      message: `Choose no more than ${MAX_IMPORT_FILES} workbooks at a time`,
    };
  }
  if (
    files.some(
      (file) =>
        !Number.isFinite(file.size) ||
        file.size < 0 ||
        file.size > MAX_IMPORT_FILE_BYTES
    )
  ) {
    return {
      code: "file_too_large",
      message: "One or more workbooks exceed the upload size limit",
    };
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  return totalBytes > MAX_IMPORT_TOTAL_BYTES
    ? {
        code: "upload_too_large",
        message: "The selected workbooks exceed the total upload size limit",
      }
    : null;
}
