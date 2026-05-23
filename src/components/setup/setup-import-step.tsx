"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FilePlus2,
  FileSpreadsheet,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  commitImportPreview,
  previewImportFiles,
  type ImportPreviewFile,
} from "@/lib/api";
import {
  appendSelectedImportFiles,
  buildImportProgressPlan,
  summarizeImportPreviews,
  type ImportStagedFile,
} from "@/lib/imports/batch-staging";
import { shouldShowSetupImportProgress } from "@/lib/setup/wizard-flow";
import {
  getImportTemplateLabel,
  getImportTemplatesForKind,
  IMPORT_SOURCE_KIND_OPTIONS,
  IMPORT_WORKBOOK_ACCEPT,
} from "@/lib/imports/templates";
import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

interface SetupImportStepProps {
  onImported: () => void;
  onSkip: () => void;
  onBack: () => void;
}

export function SetupImportStep({
  onImported,
  onSkip,
  onBack,
}: SetupImportStepProps) {
  const [selectedFiles, setSelectedFiles] = useState<ImportStagedFile[]>([]);
  const [preview, setPreview] = useState<ImportPreviewFile[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    label: string;
    percent: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const nextFiles = Array.from(files);
    setSelectedFiles((current) => appendSelectedImportFiles(current, nextFiles));
    setPreview(null);
  }

  function updateKind(id: string, kind: ImportSourceKind) {
    const templateType = getImportTemplatesForKind(kind)[0].templateType;
    setPreview(null);
    setSelectedFiles((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, kind, templateType } : item
      )
    );
  }

  function updateTemplate(id: string, templateType: ImportTemplateType) {
    setPreview(null);
    setSelectedFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, templateType } : item))
    );
  }

  function removeFile(id: string) {
    setPreview(null);
    setSelectedFiles((prev) => prev.filter((item) => item.id !== id));
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

  async function handleImport() {
    if (!preview) return;
    setCommitting(true);
    setImportProgress(null);
    try {
      const shouldShowProgress = shouldShowSetupImportProgress(
        preview.length,
        totals.rows
      );
      if (shouldShowProgress) {
        const plan = buildImportProgressPlan(preview);
        for (let index = 0; index < plan.steps.length; index += 1) {
          const step = plan.steps[index];
          setImportProgress({
            label: step.label,
            percent: Math.round(((index + 1) / plan.totalSteps) * 90),
          });
          await waitForProgressFrame();
        }
        setImportProgress({
          label: "Saving imported transactions",
          percent: 95,
        });
      }
      const result = await commitImportPreview(preview);
      if (shouldShowProgress) {
        setImportProgress({
          label: "Import complete",
          percent: 100,
        });
      }
      toast.success(`Imported ${result.added} new transactions`);
      onImported();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
      setImportProgress(null);
    }
  }

  const totals = preview
    ? summarizeImportPreviews(preview)
    : { rows: 0, duplicates: 0, errors: 0 };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="mx-auto max-w-2xl space-y-3 text-center">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Step 3 of 7 · Import
        </div>
        <h1 className="font-serif text-4xl leading-[1.08] tracking-tight md:text-5xl">
          Import your transaction files
        </h1>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground">
          Add one file, preview it, then add another. Nothing is saved until you
          click Import.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
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
            You can return to this button until the batch is complete.
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

        {selectedFiles.length > 0 && (
          <div className="mt-4 space-y-2">
            {selectedFiles.map((item) => (
              <ImportFileRow
                key={item.id}
                item={item}
                onKindChange={updateKind}
                onTemplateChange={updateTemplate}
                onRemove={removeFile}
              />
            ))}
          </div>
        )}

        {preview && (
          <div className="mt-4 rounded-xl border border-border bg-background p-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Metric label="Rows" value={totals.rows} />
              <Metric label="Duplicates" value={totals.duplicates} />
              <Metric label="Errors" value={totals.errors} />
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

        {importProgress && (
          <ImportProgressBar
            label={importProgress.label}
            percent={importProgress.percent}
          />
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button variant="outline" onClick={onBack} disabled={committing}>
          ← Back
        </Button>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onSkip} disabled={committing}>
            Skip import
          </Button>
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={selectedFiles.length === 0 || previewing || committing}
          >
            {previewing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Preview batch
          </Button>
          <Button
            onClick={handleImport}
            disabled={!preview || totals.errors > 0 || committing}
          >
            {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import
          </Button>
        </div>
      </footer>
    </div>
  );
}

function waitForProgressFrame() {
  return new Promise((resolve) => window.setTimeout(resolve, 35));
}

function ImportProgressBar({
  label,
  percent,
}: {
  label: string;
  percent: number;
}) {
  const clampedPercent = Math.max(0, Math.min(100, percent));
  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-4">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {clampedPercent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedPercent}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
    </div>
  );
}

function ImportFileRow({
  item,
  onKindChange,
  onTemplateChange,
  onRemove,
}: {
  item: ImportStagedFile;
  onKindChange: (id: string, kind: ImportSourceKind) => void;
  onTemplateChange: (id: string, templateType: ImportTemplateType) => void;
  onRemove: (id: string) => void;
}) {
  const templates = useMemo(
    () => getImportTemplatesForKind(item.kind),
    [item.kind]
  );
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_150px_170px_36px]">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          <FileSpreadsheet className="mr-1.5 inline h-3.5 w-3.5" />
          {item.file.name}
        </div>
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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.file.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
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
