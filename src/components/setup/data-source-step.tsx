"use client";

import { Landmark, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DataSourceMode } from "@/lib/types";

interface DataSourceStepProps {
  onSelect: (mode: DataSourceMode) => void;
  submitting: boolean;
}

export function DataSourceStep({ onSelect, submitting }: DataSourceStepProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-7">
      <header className="mx-auto max-w-2xl space-y-3 text-center">
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Step 1 of 5 · Data source
        </div>
        <h1 className="font-serif text-4xl leading-[1.08] tracking-tight md:text-5xl">
          How should Spent load your transactions?
        </h1>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground">
          Choose the flow for this workspace. You can keep everything manual with
          XLSX files, or connect local bank scraping for automatic sync.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <ModeCard
          icon={FileSpreadsheet}
          title="Import XLSX files"
          description="Upload bank and credit card exports from the dashboard. No bank credentials are stored."
          details={["Best first setup", "Works fully local", "You control every import"]}
          actionLabel="Use XLSX import"
          disabled={submitting}
          onClick={() => onSelect("xlsx")}
        />
        <ModeCard
          icon={Landmark}
          title="Connect bank scraping"
          description="Store encrypted credentials locally and sync supported Israeli banks from this machine."
          details={["Automatic sync", "Encrypted at rest", "May require bank-side 2FA changes"]}
          actionLabel="Use scraper sync"
          disabled={submitting}
          onClick={() => onSelect("scraper")}
        />
      </div>
    </div>
  );
}

function ModeCard({
  icon: Icon,
  title,
  description,
  details,
  actionLabel,
  disabled,
  onClick,
}: {
  icon: typeof FileSpreadsheet;
  title: string;
  description: string;
  details: string[];
  actionLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex min-h-[340px] flex-col rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-5">
        <h2 className="font-serif text-2xl leading-tight">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="mt-5 space-y-2">
        {details.map((detail) => (
          <div key={detail} className="flex items-center gap-2 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">{detail}</span>
          </div>
        ))}
      </div>
      <Button
        onClick={onClick}
        disabled={disabled}
        className="mt-auto rounded-full"
      >
        {disabled ? "Saving..." : actionLabel}
      </Button>
    </div>
  );
}
