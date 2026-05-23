"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FilePlus2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
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
  getImportTemplateLabel,
  getImportTemplatesForKind,
  IMPORT_SOURCE_KIND_OPTIONS,
  IMPORT_WORKBOOK_ACCEPT,
} from "@/lib/imports/templates";
import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

interface ImportXlsxButtonProps {
  onComplete: () => void;
}

interface SelectedImportFile {
  id: string;
  file: File;
  kind: ImportSourceKind;
  templateType: ImportTemplateType;
}

export function ImportXlsxButton({ onComplete }: ImportXlsxButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<SelectedImportFile[]>([]);
  const [preview, setPreview] = useState<ImportPreviewFile[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultKind: ImportSourceKind = "card";
  const defaultTemplate = getImportTemplatesForKind(defaultKind)[0].templateType;

  function reset() {
    setSelectedFiles([]);
    setPreview(null);
    setPreviewing(false);
    setCommitting(false);
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    setPreview(null);
    setSelectedFiles(
      Array.from(files).map((file, index) => ({
        id: `${file.name}-${file.lastModified}-${index}`,
        file,
        kind: defaultKind,
        templateType: defaultTemplate,
      }))
    );
  }

  function updateKind(id: string, kind: ImportSourceKind) {
    const templateType = getImportTemplatesForKind(kind)[0].templateType;
    setPreview(null);
    setSelectedFiles((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, kind, templateType }
          : item
      )
    );
  }

  function updateTemplate(id: string, templateType: ImportTemplateType) {
    setPreview(null);
    setSelectedFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, templateType } : item))
    );
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
      toast.success(
        `Imported ${result.added} new transactions, categorized ${result.categorized}`
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

  const totalRows = preview?.reduce((sum, file) => sum + file.rows.length, 0) ?? 0;
  const totalDuplicates =
    preview?.reduce((sum, file) => sum + file.duplicateCount, 0) ?? 0;
  const totalErrors =
    preview?.reduce((sum, file) => sum + file.errors.length, 0) ?? 0;

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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load transactions from files</DialogTitle>
            <DialogDescription>
              Choose local XLS or XLSX files, assign the right source type,
              preview rows, then import.
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
                onChange={(event) => handleFiles(event.target.files)}
              />
            </div>

            {selectedFiles.length > 0 && (
              <div className="space-y-2">
                {selectedFiles.map((item) => (
                  <ImportFileRow
                    key={item.id}
                    item={item}
                    onKindChange={updateKind}
                    onTemplateChange={updateTemplate}
                  />
                ))}
              </div>
            )}

            {preview && (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <Metric label="Rows" value={totalRows} />
                  <Metric label="Duplicates" value={totalDuplicates} />
                  <Metric label="Errors" value={totalErrors} />
                </div>
                <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">File</th>
                        <th className="px-3 py-2">Template</th>
                        <th className="px-3 py-2">Rows</th>
                        <th className="px-3 py-2">Duplicates</th>
                        <th className="px-3 py-2">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((file) => (
                        <tr key={file.fileName} className="border-t border-border">
                          <td className="px-3 py-2">{file.fileName}</td>
                          <td className="px-3 py-2">
                            {getImportTemplateLabel(file.templateType)}
                          </td>
                          <td className="px-3 py-2">{file.rows.length}</td>
                          <td className="px-3 py-2">{file.duplicateCount}</td>
                          <td className="px-3 py-2">{file.errors.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
              disabled={!preview || totalErrors > 0 || committing}
            >
              {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportFileRow({
  item,
  onKindChange,
  onTemplateChange,
}: {
  item: SelectedImportFile;
  onKindChange: (id: string, kind: ImportSourceKind) => void;
  onTemplateChange: (id: string, templateType: ImportTemplateType) => void;
}) {
  const templates = useMemo(
    () => getImportTemplatesForKind(item.kind),
    [item.kind]
  );
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_160px_160px]">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{item.file.name}</div>
        <div className="text-xs text-muted-foreground">
          {item.kind === "bank" ? "Bank account" : "Credit card"} ·{" "}
          {getImportTemplateLabel(item.templateType)}
        </div>
      </div>
      <select
        value={item.kind}
        onChange={(event) =>
          onKindChange(item.id, event.target.value as ImportSourceKind)
        }
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {IMPORT_SOURCE_KIND_OPTIONS.map((option) => (
          <option key={option.kind} value={option.kind}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        value={item.templateType}
        onChange={(event) =>
          onTemplateChange(item.id, event.target.value as ImportTemplateType)
        }
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      >
        {templates.map((template) => (
          <option key={template.templateType} value={template.templateType}>
            {template.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
