"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { I18nProvider } from "@/i18n/client-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/query-provider";
import { Button } from "@/components/ui/button";
import { dirFor, type Locale } from "@/i18n/routing";
import en from "@/i18n/messages/en.json";
import he from "@/i18n/messages/he.json";
import { setApiTransport } from "@/lib/api-transport";
import { setActiveWorkspaceId, getActiveWorkspaceIdSync } from "@/lib/workspace-store";
import { loadDatabase } from "@/mobile/db/sqljs-db";
import { DriveClient } from "@/mobile/drive/drive-client";
import { getAccessToken, signIn, signOut } from "@/mobile/drive/google-auth";
import { configureLocalWrites, reapplyOutbox, type LastSeqStore } from "@/mobile/local-writes";
import { handleMobileRequest } from "@/mobile/router";
import * as localFiles from "@/mobile/storage/local-files";
import { createEncryptedOutboxStore, type EncryptedOutboxStore } from "@/mobile/storage/outbox-store";
import { clearAll, getSecret, setSecret } from "@/mobile/storage/secure-store";
import { inspectSnapshot } from "@/mobile/sync/inspect-snapshot";
import { createMobileSyncEngine, type MobileSyncEngine } from "@/mobile/sync/mobile-sync-engine";
import { PassphraseForm } from "@/mobile/sync/passphrase-form";
import {
  attachEngine,
  runBoot,
  setMobileLocale,
  useMobileLocale,
  useMobileSync,
} from "@/mobile/sync/sync-store";
import { MobileScreen, SpentLogo } from "./mobile-screen";

const MESSAGES: Record<Locale, Record<string, unknown>> = { en, he };

// The query client lives inside the provider tree; the engine reaches it here.
let queryClient: QueryClient | null = null;
let started = false;

// Kept in secure storage so it outlives an outbox that had to be set aside.
const lastSeq: LastSeqStore = {
  async get() {
    const value = Number(await getSecret("lastSeq"));
    return Number.isInteger(value) && value > 0 ? value : 0;
  },
  set: (seq) => setSecret("lastSeq", String(seq)),
};

function wireLocalWrites(outbox: EncryptedOutboxStore, engine: MobileSyncEngine) {
  configureLocalWrites({
    outbox,
    getAck: () => engine.getAck(),
    onChange: () => engine.notifyChange(),
    lastSeq,
  });
}

/** Builds the device engine once, installs the in-process API, and boots. */
async function startPhone(): Promise<void> {
  if (started) return;
  started = true;
  setApiTransport(handleMobileRequest);

  let engine: MobileSyncEngine | null = null;
  const outbox = createEncryptedOutboxStore({
    files: localFiles,
    getPassphrase: () => engine?.getPassphrase() ?? null,
  });
  engine = createMobileSyncEngine({
    drive: new DriveClient({ getAccessToken }),
    files: localFiles,
    secrets: { get: getSecret, set: setSecret, clearAll },
    outbox,
    loadDatabase,
    inspectSnapshot,
    reapplyOutbox,
    invalidateAll: () => {
      void queryClient?.invalidateQueries();
    },
    now: () => new Date(),
    setLocale: setMobileLocale,
    workspace: {
      get: getActiveWorkspaceIdSync,
      set: (id) => setActiveWorkspaceId(id),
    },
    signOut,
  });
  const device = engine;
  wireLocalWrites(outbox, device);
  attachEngine(device, {
    signIn,
    afterDisconnect: () => {
      queryClient?.clear();
      wireLocalWrites(outbox, device);
    },
  });

  // Loaded only here so desktop builds and node tests never touch the plugin.
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) device.onForeground();
      else device.onBackground();
    });
  } catch {
    // No app lifecycle events (a plain browser): open and the Sync button still sync.
  }

  await runBoot();
}

function Splash() {
  const t = useTranslations("phoneSync.mobile");
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background">
      <SpentLogo className="h-12 animate-pulse" />
      <span className="sr-only">{t("opening")}</span>
    </div>
  );
}

function PassphraseScreen() {
  const t = useTranslations("phoneSync.mobile");
  const sync = useMobileSync();
  return (
    <MobileScreen title={t("passphraseTitle")} description={t("passphraseDescription")}>
      <PassphraseForm
        onSubmit={sync.submitPassphrase}
        wrongMessage={t("wrongPassphrase")}
        submitLabel={t("unlock")}
        busyLabel={t("unlocking")}
      />
    </MobileScreen>
  );
}

function NoDataScreen() {
  const t = useTranslations("phoneSync");
  const sync = useMobileSync();
  const busy = sync.state === "syncing";
  return (
    <MobileScreen title={t("mobile.noDataTitle")} description={t("mobile.noDataDescription")}>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        {sync.error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{t(`errors.${sync.error}`)}</span>
          </p>
        ) : null}
        <Button
          onClick={() => void runBoot()}
          disabled={busy}
          className="mt-4 h-12 w-full rounded-xl text-base"
        >
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {t("mobile.retry")}
        </Button>
      </div>
    </MobileScreen>
  );
}

function BootGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const { boot, hasData } = useMobileSync();
  const onOnboarding = pathname.startsWith("/onboarding");

  useEffect(() => {
    queryClient = client;
    void startPhone();
  }, [client]);

  useEffect(() => {
    if (boot === "needs_onboarding" && !onOnboarding) router.replace("/onboarding");
    if (boot === "ready" && onOnboarding) router.replace("/");
  }, [boot, onOnboarding, router]);

  if (boot === "booting") return <Splash />;
  if (boot === "needs_onboarding") return onOnboarding ? children : <Splash />;
  if (boot === "needs_passphrase") return <PassphraseScreen />;
  if (onOnboarding) return <Splash />;
  if (!hasData) return <NoDataScreen />;
  return children;
}

/**
 * Phone root: providers with the device-chosen locale, plus the boot gate
 * that shows onboarding, the passphrase prompt or the app.
 */
export function MobileRoot({ children }: { children: ReactNode }) {
  const locale = useMobileLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirFor(locale);
  }, [locale]);

  return (
    <I18nProvider locale={locale} messages={MESSAGES[locale]} timeZone="Asia/Jerusalem">
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <QueryProvider>
          <TooltipProvider>
            <BootGate>{children}</BootGate>
            <Toaster />
          </TooltipProvider>
        </QueryProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
