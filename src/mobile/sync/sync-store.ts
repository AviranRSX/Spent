"use client";

import { useSyncExternalStore } from "react";
import { isLocale, type Locale } from "@/i18n/routing";
import type {
  BootResult,
  MobileSyncEngine,
  MobileSyncError,
  MobileSyncState,
} from "./mobile-sync-engine";

// The phone's sync state for React. The engine is created by the phone boot
// (src/mobile/boot/mobile-root.tsx) and attached here; components read it
// through useMobileSync(). Nothing here loads a Capacitor plugin, so the
// shared sidebar can import it.

export type BootStatus = "booting" | BootResult;

export interface MobileActions {
  /** Interactive Google sign-in. */
  signIn(): Promise<{ email: string }>;
  /** Runs after Disconnect wiped the phone (resets in-memory caches). */
  afterDisconnect(): void;
}

interface Snapshot {
  boot: BootStatus;
  hasData: boolean;
  locale: Locale;
  sync: MobileSyncState;
}

const LOCALE_KEY = "spent.locale";
const IDLE: MobileSyncState = { state: "idle", lastSyncedAt: null, pendingCount: 0, error: null };
const SERVER_SNAPSHOT: Snapshot = { boot: "booting", hasData: false, locale: "en", sync: IDLE };

function initialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage unavailable: fall through to the device language.
  }
  return navigator.language?.toLowerCase().startsWith("he") ? "he" : "en";
}

let engine: MobileSyncEngine | null = null;
let actions: MobileActions | null = null;
let snapshot: Snapshot = { ...SERVER_SNAPSHOT, locale: initialLocale() };
const listeners = new Set<() => void>();

function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function attachEngine(next: MobileSyncEngine, nextActions: MobileActions): void {
  engine = next;
  actions = nextActions;
  next.subscribe(() => update({ sync: next.getState(), hasData: next.hasData() }));
  update({ sync: next.getState(), hasData: next.hasData() });
}

export function getEngine(): MobileSyncEngine | null {
  return engine;
}

export function setBootStatus(boot: BootStatus): void {
  update({ boot, hasData: engine?.hasData() ?? false });
}

export function setMobileLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Only a startup convenience.
  }
  if (snapshot.locale !== locale) update({ locale });
}

/** Runs a boot and records its result. A crash shows as "ready" with no data and an error. */
export async function runBoot(): Promise<void> {
  if (!engine) return;
  update({ boot: "booting" });
  try {
    setBootStatus(await engine.boot());
  } catch {
    update({
      boot: "ready",
      hasData: engine.hasData(),
      sync: { ...engine.getState(), state: "error", error: "sync_failed" },
    });
  }
}

export function useMobileSync() {
  const current = useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
  return {
    ...current.sync,
    boot: current.boot,
    hasData: current.hasData,
    syncNow: () => {
      void engine?.sync();
    },
    async signInAgain(): Promise<void> {
      if (!actions || !engine) return;
      try {
        await actions.signIn();
      } catch {
        // The block keeps showing signed_out; the user can try again.
        return;
      }
      await engine.sync();
    },
    async submitPassphrase(passphrase: string): Promise<"ok" | MobileSyncError> {
      if (!engine) return "sync_failed";
      const result = await engine.submitPassphrase(passphrase);
      if (result === "ok") setBootStatus("ready");
      return result;
    },
    async disconnect(): Promise<void> {
      if (!engine) return;
      await engine.disconnect();
      actions?.afterDisconnect();
      setBootStatus("needs_onboarding");
    },
  };
}

export function useMobileLocale(): Locale {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.locale,
    () => SERVER_SNAPSHOT.locale
  );
}

export function signInWithGoogle(): Promise<{ email: string }> {
  if (!actions) return Promise.reject(new Error("not_ready"));
  return actions.signIn();
}
