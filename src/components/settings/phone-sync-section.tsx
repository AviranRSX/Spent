"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { checkPhoneSyncFolder, updatePhoneSyncSettings } from "@/lib/api";
import { useFormatterLabels } from "@/lib/i18n-data";
import {
  PHONE_SYNC_MIN_PASSPHRASE_LENGTH,
  passphraseStrength,
  type PassphraseStrength,
} from "@/lib/phone-sync/passphrase-strength";
import { cn } from "@/lib/utils";
import type { PhoneSyncDevice, PhoneSyncStatus } from "@/lib/types";
import { formatSyncTime } from "@/components/phone-sync/relative-time";
import { useDesktopPhoneSync } from "@/components/phone-sync/use-desktop-phone-sync";
import { SectionShell, SettingCard } from "./section-shell";

const MIN_PASSPHRASE_LENGTH = PHONE_SYNC_MIN_PASSPHRASE_LENGTH;
const DOCS_URL = "https://github.com/Shaya16/Spent/blob/main/docs/phone-app.md";

const STRENGTH_STYLES: Record<PassphraseStrength, { bar: string; width: string }> = {
  weak: { bar: "bg-destructive", width: "w-1/3" },
  okay: { bar: "bg-amber-500", width: "w-2/3" },
  strong: { bar: "bg-emerald-600", width: "w-full" },
};

function formatBytes(bytes: number, t: ReturnType<typeof useTranslations>) {
  if (bytes < 1024 * 1024) {
    return t("sizeKb", { value: Math.max(1, Math.round(bytes / 1024)) });
  }
  return t("sizeMb", { value: (bytes / (1024 * 1024)).toFixed(1) });
}

export function PhoneSyncSection() {
  const t = useTranslations("phoneSync.page");
  const { status } = useDesktopPhoneSync();
  if (!status) {
    return (
      <SectionShell title={t("title")}>
        <SettingCard>
          <div className="text-sm text-muted-foreground">{t("loading")}</div>
        </SettingCard>
      </SectionShell>
    );
  }
  return (
    <SectionShell title={t("title")} description={t("description")}>
      <PhoneSyncForm status={status} />
    </SectionShell>
  );
}

function PhoneSyncForm({ status }: { status: PhoneSyncStatus }) {
  const t = useTranslations("phoneSync.page");
  const tErrors = useTranslations("phoneSync.errors");
  const { setStatus, sync, isSyncing } = useDesktopPhoneSync();
  const labels = useFormatterLabels();

  const save = useMutation({
    mutationFn: updatePhoneSyncSettings,
    onSuccess: (next) => setStatus(next),
    onError: () => toast.error(t("saveFailed")),
  });

  const canEnable = Boolean(status.folder) && status.hasPassphrase;
  const passphraseUnreadable = status.hasPassphrase && status.error === "no_passphrase";

  return (
    <>
      <SettingCard>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="phone-sync-enabled" className="text-base font-medium">
              {t("enableTitle")}
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("enableDescription")}
            </p>
            {!canEnable && !status.enabled ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("enableNeedsSetup")}
              </p>
            ) : null}
          </div>
          <Switch
            id="phone-sync-enabled"
            checked={status.enabled}
            disabled={save.isPending || (!status.enabled && !canEnable)}
            onCheckedChange={(enabled) =>
              save.mutate(
                { enabled },
                {
                  onSuccess: () =>
                    toast.success(enabled ? t("enabledToast") : t("disabledToast")),
                }
              )
            }
          />
        </div>
      </SettingCard>

      <FolderCard
        key={status.folder ?? ""}
        savedFolder={status.folder}
        saving={save.isPending}
        onSave={(folder) =>
          save.mutate({ folder }, { onSuccess: () => toast.success(t("folderSaved")) })
        }
      />

      <PassphraseCard
        hasPassphrase={status.hasPassphrase}
        unreadable={passphraseUnreadable}
        saving={save.isPending}
        onSave={(passphrase, reset) =>
          save.mutate(
            { passphrase },
            {
              onSuccess: () => {
                reset();
                toast.success(t("passphraseSaved"));
              },
            }
          )
        }
      />

      <SettingCard title={t("statusTitle")}>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("lastSynced")}</dt>
            <dd className="mt-0.5 font-medium">
              {formatSyncTime(status.lastSyncedAt, labels)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("lastSnapshot")}</dt>
            <dd className="mt-0.5 font-medium">
              {status.lastSnapshotAt
                ? `${formatSyncTime(status.lastSnapshotAt, labels)}${
                    status.lastSnapshotBytes != null
                      ? ` · ${formatBytes(status.lastSnapshotBytes, t)}`
                      : ""
                  }`
                : t("snapshotNone")}
            </dd>
          </div>
        </dl>
        {status.error ? (
          <p
            role="alert"
            className="mt-4 flex items-center gap-2 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {tErrors(status.error)}
          </p>
        ) : null}
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={sync}
            disabled={!status.enabled || isSyncing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
            {t("syncNow")}
          </Button>
        </div>
      </SettingCard>

      <SettingCard
        title={t("devicesTitle")}
        description={t("devicesDescription")}
      >
        <DevicesTable devices={status.devices} />
      </SettingCard>

      <SettingCard title={t("docsTitle")} description={t("docsDescription")}>
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("docsLink")}
          <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </a>
      </SettingCard>
    </>
  );
}

function FolderCard({
  savedFolder,
  saving,
  onSave,
}: {
  savedFolder: string | null;
  saving: boolean;
  onSave: (folder: string) => void;
}) {
  const t = useTranslations("phoneSync.page");
  const tErrors = useTranslations("phoneSync.errors");
  const [folder, setFolder] = useState(savedFolder ?? "");
  const trimmed = folder.trim();

  const check = useMutation({ mutationFn: () => checkPhoneSyncFolder(trimmed) });
  const result = check.data;

  return (
    <SettingCard title={t("folderTitle")} description={t("folderDescription")}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="phone-sync-folder">{t("folderLabel")}</Label>
          <Input
            id="phone-sync-folder"
            dir="ltr"
            value={folder}
            placeholder={t("folderPlaceholder")}
            onChange={(e) => {
              setFolder(e.target.value);
              check.reset();
            }}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={trimmed === "" || check.isPending}
            onClick={() => check.mutate()}
          >
            {check.isPending ? t("checking") : t("checkFolder")}
          </Button>
          <Button
            size="sm"
            disabled={trimmed === "" || trimmed === (savedFolder ?? "") || saving}
            onClick={() => onSave(trimmed)}
          >
            {t("saveFolder")}
          </Button>
          <div aria-live="polite" className="text-sm">
            {result?.ok ? (
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                {t("folderOk")}
              </span>
            ) : result ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-4 w-4" />
                {tErrors(result.reason)}
              </span>
            ) : check.isError ? (
              <span className="flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-4 w-4" />
                {t("folderAbsolute")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </SettingCard>
  );
}

function PassphraseCard({
  hasPassphrase,
  unreadable,
  saving,
  onSave,
}: {
  hasPassphrase: boolean;
  unreadable: boolean;
  saving: boolean;
  onSave: (passphrase: string, reset: () => void) => void;
}) {
  const t = useTranslations("phoneSync.page");
  const [value, setValue] = useState("");
  const length = Array.from(value).length;
  const strength = passphraseStrength(value);
  const strengthLabel = {
    weak: t("strengthWeak"),
    okay: t("strengthOkay"),
    strong: t("strengthStrong"),
  }[strength];
  const style = STRENGTH_STYLES[strength];

  const statusText = unreadable
    ? t("passphraseUnreadable")
    : hasPassphrase
      ? t("passphraseSet")
      : t("passphraseNotSet");

  return (
    <SettingCard
      title={t("passphraseTitle")}
      description={t("passphraseDescription")}
    >
      <div className="space-y-3">
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm",
            unreadable ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {unreadable ? <AlertCircle className="h-4 w-4 shrink-0" /> : null}
          {statusText}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="phone-sync-passphrase">{t("passphraseLabel")}</Label>
          <Input
            id="phone-sync-passphrase"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex items-center gap-3 pt-1">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  value === "" ? "w-0" : [style.bar, style.width]
                )}
              />
            </div>
            <span className="w-14 text-end text-xs text-muted-foreground">
              {value === "" ? "" : strengthLabel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("passphraseHint", { min: MIN_PASSPHRASE_LENGTH })}
          </p>
        </div>
        {hasPassphrase ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("passphraseWarning")}
          </p>
        ) : null}
        <Button
          size="sm"
          disabled={length < MIN_PASSPHRASE_LENGTH || saving}
          onClick={() => onSave(value, () => setValue(""))}
        >
          {t("savePassphrase")}
        </Button>
      </div>
    </SettingCard>
  );
}

function DevicesTable({ devices }: { devices: PhoneSyncDevice[] }) {
  const t = useTranslations("phoneSync.page");
  const labels = useFormatterLabels();

  if (devices.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("devicesEmpty")}</p>;
  }

  const errorText = (code: string) => {
    const known = ["bad_passphrase", "bad_format", "unsupported_version", "apply_failed"];
    return known.includes(code)
      ? t(`deviceErrors.${code}`)
      : t("deviceErrorUnknown");
  };

  const lastSeen = (device: PhoneSyncDevice) =>
    device.lastSeenAt ? formatSyncTime(device.lastSeenAt, labels) : t("never");
  const errorLine = (device: PhoneSyncDevice) =>
    device.lastError ? (
      <div className="mt-1 flex items-start gap-1.5 text-xs font-normal text-destructive">
        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
        {errorText(device.lastError)}
      </div>
    ) : null;

  return (
    <>
      <ul className="divide-y divide-border sm:hidden">
        {devices.map((device) => (
          <li key={device.deviceId} className="py-3 first:pt-0 last:pb-0">
            <div className="font-medium">{device.deviceName}</div>
            {errorLine(device)}
            <dl className="mt-2 space-y-1.5 text-sm">
              {[
                [t("colLastSeen"), lastSeen(device)],
                [t("colApplied"), device.appliedCount],
                [t("colSkippedNewer"), device.skippedNewerCount],
                [t("colSkippedMismatch"), device.skippedMismatchCount],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="shrink-0 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colName")}</TableHead>
              <TableHead>{t("colLastSeen")}</TableHead>
              <TableHead className="text-end">{t("colApplied")}</TableHead>
              <TableHead className="max-w-32 text-end whitespace-normal">
                {t("colSkippedNewer")}
              </TableHead>
              <TableHead className="max-w-32 text-end whitespace-normal">
                {t("colSkippedMismatch")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.deviceId}>
                <TableCell className="min-w-44 font-medium whitespace-normal">
                  {device.deviceName}
                  {errorLine(device)}
                </TableCell>
                <TableCell className="text-muted-foreground">{lastSeen(device)}</TableCell>
                <TableCell className="text-end tabular-nums">{device.appliedCount}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {device.skippedNewerCount}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {device.skippedMismatchCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
