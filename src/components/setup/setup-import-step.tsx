"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  FilePlus2,
  FileSpreadsheet,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { ImportPreviewPanel } from "@/components/imports/import-preview-panel";
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
import { IMPORT_WORKBOOK_ACCEPT } from "@/lib/imports/templates";

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
        totals.validRows
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
      const fileErrorMessage =
        totals.fileErrors > 0
          ? ` Skipped ${totals.fileErrors} ${totals.fileErrors === 1 ? "file" : "files"} with errors.`
          : "";
      toast.success(
        `Imported ${result.added} new transactions. Skipped ${totals.skippedRows} invalid rows.${fileErrorMessage}`
      );
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
    : {
        validRows: 0,
        duplicates: 0,
        skippedRows: 0,
        fileErrors: 0,
        importableRows: 0,
      };

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
          click Load.
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

        {selectedFiles.length > 0 && !preview && (
          <div className="mt-4 space-y-2">
            {selectedFiles.map((item) => (
              <ImportFileRow
                key={item.id}
                item={item}
                onRemove={removeFile}
              />
            ))}
          </div>
        )}

        {preview && (
          <div className="mt-4">
            <ImportPreviewPanel files={preview} />
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
            disabled={!preview || totals.importableRows === 0 || committing}
          >
            {committing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {preview
              ? `Load ${totals.importableRows} valid rows`
              : "Load valid rows"}
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
  onRemove,
}: {
  item: ImportStagedFile;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          <FileSpreadsheet className="mr-1.5 inline h-3.5 w-3.5" />
          {item.file.name}
        </div>
        <div className="text-xs text-muted-foreground">
          Source detected during preview
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto shrink-0"
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.file.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
