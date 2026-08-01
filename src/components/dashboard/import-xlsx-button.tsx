"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { ImportPreviewPanel } from "@/components/imports/import-preview-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  commitImportPreview,
  previewImportFiles,
  type ImportPreviewFile,
} from "@/lib/api";
import {
  appendSelectedImportFiles,
  summarizeImportPreviews,
  type ImportStagedFile,
} from "@/lib/imports/batch-staging";
import {
  IMPORT_WORKBOOK_ACCEPT,
} from "@/lib/imports/templates";

interface ImportXlsxButtonProps {
  onComplete: () => void;
}

export function ImportXlsxButton({ onComplete }: ImportXlsxButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<ImportStagedFile[]>([]);
  const [preview, setPreview] = useState<ImportPreviewFile[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setSelectedFiles([]);
    setPreview(null);
    setPreviewing(false);
    setCommitting(false);
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    setPreview(null);
    setSelectedFiles(appendSelectedImportFiles([], Array.from(files)));
  }

  async function handlePreview() {
    if (selectedFiles.length === 0) return;
    setPreviewing(true);
    try {
      const result = await previewImportFiles(selectedFiles);
      setPreview(result.files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!preview) return;
    setCommitting(true);
    try {
      const result = await commitImportPreview(preview);
      const fileErrorMessage =
        totals.fileErrors > 0
          ? ` Skipped ${totals.fileErrors} ${totals.fileErrors === 1 ? "file" : "files"} with errors.`
          : "";
      toast.success(
        `Imported ${result.added} new transactions. Skipped ${totals.skippedRows} invalid rows.${fileErrorMessage} Categorized ${result.categorized}.`
      );
      if (result.aiWarning) toast.warning(result.aiWarning);
      reset();
      setOpen(false);
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  const totals = preview
    ? summarizeImportPreviews(preview)
    : {
        validRows: 0,
        duplicates: 0,
        skippedRows: 0,
        fileErrors: 0,
        importableRows: 0,
      };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <FileSpreadsheet className="h-3.5 w-3.5" />
        Load transactions
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Load transactions from files</DialogTitle>
            <DialogDescription>
              Choose local XLS or XLSX files. Spent detects each source when
              you preview the batch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <Button
                type="button"
                variant="outline"
                className="gap-2 rounded-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <FilePlus2 className="h-4 w-4" />
                Choose files
              </Button>
              <span className="text-xs text-muted-foreground">
                The Windows file picker will open. Files are parsed in memory.
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={IMPORT_WORKBOOK_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  handleFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>

            {selectedFiles.length > 0 && !preview && (
              <div className="space-y-2">
                {selectedFiles.map((item) => (
                  <ImportFileRow key={item.id} item={item} />
                ))}
              </div>
            )}

            {preview && <ImportPreviewPanel files={preview} />}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handlePreview}
              disabled={selectedFiles.length === 0 || previewing || committing}
            >
              {previewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Preview
            </Button>
            <Button
              onClick={handleCommit}
              disabled={!preview || totals.importableRows === 0 || committing}
            >
              {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {preview
                ? `Load ${totals.importableRows} valid rows`
                : "Load valid rows"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportFileRow({
  item,
}: {
  item: ImportStagedFile;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
      <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.file.name}</div>
        <div className="text-xs text-muted-foreground">
          Source detected during preview
        </div>
      </div>
    </div>
  );
}
