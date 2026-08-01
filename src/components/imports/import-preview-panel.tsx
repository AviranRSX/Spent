import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  buildImportPreviewDisplay,
  summarizeImportPreviews,
} from "@/lib/imports/batch-staging";
import type { ImportPreviewFile } from "@/lib/imports/import-types";

export function ImportPreviewPanel({ files }: { files: ImportPreviewFile[] }) {
  const totals = summarizeImportPreviews(files);
  const displayFiles = buildImportPreviewDisplay(files);

  return (
    <div className="max-w-full space-y-4 overflow-hidden rounded-xl border border-border bg-background p-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <Metric label="Valid rows" value={totals.validRows} />
        <Metric label="New rows" value={totals.importableRows} />
        <Metric label="Duplicates" value={totals.duplicates} />
        <Metric label="Skipped" value={totals.skippedRows} />
        <Metric label="File errors" value={totals.fileErrors} />
      </div>

      <div className="max-h-[min(22rem,48vh)] space-y-3 overflow-y-auto overscroll-contain pr-1">
        {displayFiles.map((file, fileIndex) => {
          const hasIssues = Boolean(file.fileIssue || file.issueLines.length > 0);

          return (
            <section
              key={`${file.fileName}-${fileIndex}`}
              className="min-w-0 rounded-lg border border-border bg-card/40 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words text-sm font-medium">
                    {file.fileName}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {file.providerLabel} | {file.sourceKindLabel}
                  </div>
                </div>
                {hasIssues ? (
                  <AlertCircle
                    className="h-4 w-4 shrink-0 text-destructive"
                    aria-label="Import issues found"
                  />
                ) : (
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-primary"
                    aria-label="Ready to load"
                  />
                )}
              </div>

              <div className="mt-2 text-xs text-muted-foreground">
                {file.validRows} valid | {file.duplicates} duplicates |{" "}
                {file.skippedRows} skipped
              </div>

              {file.fileIssue && (
                <div className="mt-3 break-words rounded-md bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                  {file.fileIssue}
                </div>
              )}

              {file.issueLines.length > 0 && (
                <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto overscroll-contain break-words pr-1 text-xs leading-relaxed text-destructive">
                  {file.issueLines.map((line, issueIndex) => (
                    <li key={`${file.fileName}-${issueIndex}`}>{line}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/50 p-3">
      <div className="break-words text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
