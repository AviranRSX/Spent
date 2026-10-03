"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CircleHelp, Flag, type LucideIcon } from "lucide-react";
import { CardShell } from "./card-shell";
import {
  buildNeedsAttentionRows,
  type NeedsAttentionRowId,
} from "@/lib/home-needs-attention";
import type { HomeNeedsAttention } from "@/lib/types";

const ROW_META: Record<NeedsAttentionRowId, { icon: LucideIcon; labelKey: string }> = {
  uncategorized: { icon: CircleHelp, labelKey: "needsAttentionUncategorized" },
  lowConfidence: { icon: AlertTriangle, labelKey: "needsAttentionLowConfidence" },
  flagged: { icon: Flag, labelKey: "needsAttentionFlagged" },
};

interface Props {
  data: HomeNeedsAttention;
  /** "YYYY-MM"; row links open /transactions for this month. */
  month: string;
}

export function NeedsAttentionCard({ data, month }: Props) {
  const t = useTranslations("home");
  const rows = buildNeedsAttentionRows(data, month);
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return (
      <CardShell label={t("needsAttention")}>
        <div className="flex flex-1 items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--status-on-track)]" />
          {t("allClear")}
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell label={t("needsAttention")}>
      <ul className="flex flex-1 flex-col gap-2">
        {rows.map((row) => {
          const meta = ROW_META[row.id];
          return (
            <Row
              key={row.id}
              icon={<meta.icon className="h-4 w-4" />}
              label={t(meta.labelKey)}
              count={row.count}
              href={row.href}
            />
          );
        })}
      </ul>
    </CardShell>
  );
}

function Row({
  icon,
  label,
  count,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  href: string;
}) {
  if (count === 0) {
    return (
      <li className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-2.5">
          <span className="text-muted-foreground/60">{icon}</span>
          {label}
        </span>
        <span className="text-xs tabular-nums">0</span>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors hover:bg-accent/50"
      >
        <span className="flex items-center gap-2.5">
          <span className="text-foreground/80">{icon}</span>
          {label}
        </span>
        <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium tabular-nums group-hover:bg-foreground/15">
          {count}
        </span>
      </Link>
    </li>
  );
}
