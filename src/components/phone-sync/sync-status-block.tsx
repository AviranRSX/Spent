"use client";

import { useTranslations } from "next-intl";
import { AlertCircle, MoreHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useFormatterLabels } from "@/lib/i18n-data";
import { cn } from "@/lib/utils";
import { formatSyncTime } from "./relative-time";

export type SyncErrorCode =
  | "folder_unavailable"
  | "not_writable"
  | "no_passphrase"
  | "bad_passphrase"
  | "bad_format"
  | "sync_failed"
  | "offline"
  | "update_phone_app"
  | "update_pc"
  | "signed_out";

export interface SyncMenuItem {
  label: string;
  onSelect: () => void;
}

export interface SyncStatusBlockProps {
  state: "idle" | "syncing" | "error";
  lastSyncedAt: string | null;
  pendingCount?: number;
  error: SyncErrorCode | null;
  onSync: () => void;
  menuItems?: SyncMenuItem[];
}

/** Sync button, last-synced line and error line. Shared by the PC and phone sidebars. */
export function SyncStatusBlock({
  state,
  lastSyncedAt,
  pendingCount = 0,
  error,
  onSync,
  menuItems,
}: SyncStatusBlockProps) {
  const t = useTranslations("phoneSync");
  const labels = useFormatterLabels();
  const syncing = state === "syncing";
  const errorMessage = error ? t(`errors.${error}`) : null;
  const lastSynced = lastSyncedAt
    ? t("lastSynced", { time: formatSyncTime(lastSyncedAt, labels) })
    : t("notSyncedYet");
  const summary = errorMessage ?? lastSynced;

  return (
    <>
      <div className="px-1 group-data-[collapsible=icon]:hidden">
        <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2.5">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              disabled={syncing}
              className="h-8 flex-1 justify-center gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              {syncing ? t("syncing") : t("sync")}
            </Button>
            {menuItems && menuItems.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {menuItems.map((item) => (
                    <DropdownMenuItem key={item.label} onClick={item.onSelect}>
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <div
            role={error ? "alert" : undefined}
            className={cn(
              "mt-2 flex items-start gap-1.5 text-xs leading-snug",
              error ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {error ? <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> : null}
            <span className="min-w-0">{summary}</span>
          </div>
          {pendingCount > 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("pendingChanges", { count: pendingCount })}
            </div>
          ) : null}
        </div>
      </div>

      <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={onSync}
            disabled={syncing}
            tooltip={`${t("sync")}: ${summary}`}
            aria-label={t("sync")}
          >
            {error ? (
              <AlertCircle className="text-destructive" />
            ) : (
              <RefreshCw className={cn(syncing && "animate-spin")} />
            )}
            <span>{t("sync")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
