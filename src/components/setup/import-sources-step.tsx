"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createImportSource,
  listImportSources,
} from "@/lib/api";
import {
  getImportTemplateLabel,
  getImportTemplatesForKind,
  IMPORT_SOURCE_KIND_OPTIONS,
} from "@/lib/imports/templates";
import type { ImportSourceKind, ImportTemplateType } from "@/lib/types";

interface ImportSourcesStepProps {
  onComplete: () => void;
}

export function ImportSourcesStep({ onComplete }: ImportSourcesStepProps) {
  const queryClient = useQueryClient();
  const { data: sources = [], isPending } = useQuery({
    queryKey: ["import-sources"],
    queryFn: listImportSources,
  });
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<ImportSourceKind>("card");
  const [templateType, setTemplateType] =
    useState<ImportTemplateType>("max_bill");
  const [accountHint, setAccountHint] = useState("");
  const [saving, setSaving] = useState(false);

  const templatesForKind = getImportTemplatesForKind(kind);
  const valid = label.trim().length > 0;

  function handleKindChange(nextKind: ImportSourceKind) {
    const nextTemplates = getImportTemplatesForKind(nextKind);
    setKind(nextKind);
    setTemplateType(nextTemplates[0].templateType);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await createImportSource({
        label: label.trim(),
        kind,
        templateType,
        accountHint: accountHint.trim() || null,
      });
      setLabel("");
      setAccountHint("");
      await queryClient.invalidateQueries({ queryKey: ["import-sources"] });
      toast.success("Import source saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save source");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6">
      <header className="space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Step 1 of 5 · Import sources
        </div>
        <h1 className="font-serif text-4xl leading-[1.08] tracking-tight">
          Which files will Spent import?
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Add each bank account or credit card as a saved source. No credentials
          are stored. You will upload monthly XLSX files later.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="source-label">Source label</Label>
            <Input
              id="source-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Isracard 2437"
            />
          </div>

          <div className="space-y-2">
            <Label>Source kind</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {IMPORT_SOURCE_KIND_OPTIONS.map((option) => {
                const active = kind === option.kind;
                const Icon = option.kind === "card" ? CreditCard : Building2;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => handleKindChange(option.kind)}
                    className={`flex h-12 items-center gap-3 rounded-lg border px-3 text-left text-sm transition ${
                      active
                        ? "border-primary bg-primary/8 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="font-medium">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="source-template">XLSX template</Label>
              <select
                id="source-template"
                value={templateType}
                onChange={(event) =>
                  setTemplateType(event.target.value as ImportTemplateType)
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {templatesForKind.map((template) => (
                  <option
                    key={template.templateType}
                    value={template.templateType}
                  >
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-hint">Account or card hint</Label>
              <Input
                id="source-hint"
                value={accountHint}
                onChange={(event) => setAccountHint(event.target.value)}
                placeholder="Optional, e.g. last 4 digits"
              />
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {getImportTemplateLabel(templateType)} template expects files like{" "}
            {
              templatesForKind.find(
                (template) => template.templateType === templateType
              )?.sampleFile
            }
            .
          </div>

          <Button
            onClick={handleSave}
            disabled={!valid || saving}
            className="mt-2 rounded-full"
          >
            {saving ? "Saving..." : "Save source"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Saved sources · {sources.length}
        </div>
        {isPending ? (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            Loading sources...
          </div>
        ) : sources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Add at least one source to continue.
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div>
                  <div className="font-medium">{source.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {source.kind === "bank" ? "Bank account" : "Credit card"} ·{" "}
                    {getImportTemplateLabel(source.templateType)}
                  </div>
                </div>
                <div className="text-xs font-medium text-primary">Ready</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button
        onClick={onComplete}
        disabled={sources.length === 0}
        className="rounded-full"
      >
        Continue
      </Button>
    </div>
  );
}
