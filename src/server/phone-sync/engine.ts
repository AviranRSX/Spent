import "server-only";

import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/server/db";
import {
  deleteGlobalSetting,
  getGlobalSetting,
  setGlobalSetting,
} from "@/server/db/queries/settings";
import { decodeChangeFile } from "@/lib/phone-sync/changes";
import {
  PhoneSyncCryptoError,
  decryptPayload,
  encryptPayload,
} from "@/lib/phone-sync/crypto";
import {
  createSyncScheduler,
  type SchedulerClock,
  type SyncScheduler,
} from "@/lib/phone-sync/scheduler";
import type { PhoneSyncError, PhoneSyncStatus } from "@/lib/types";
import { applyChangeFile } from "./apply-changes";
import { ensureDevice, getAcks, getDevice, listDevices, recordDeviceError } from "./devices";
import { checkFolder, listChangeFiles, writeSnapshotAtomic } from "./folder";
import {
  PHONE_SYNC_STATUS_KEYS,
  getPhoneSyncConfig,
  getPhoneSyncPassphrase,
} from "./settings";
import { buildSnapshotDbBytes } from "./snapshot";

export const LOCAL_CHANGE_CHECK_MS = 5_000;
export const CHANGE_POLL_MS = 120_000;

const KNOWN_ERRORS: readonly PhoneSyncError[] = [
  "folder_unavailable",
  "not_writable",
  "no_passphrase",
  "bad_passphrase",
  "bad_format",
  "sync_failed",
];

function isFsErrorOnPath(err: unknown, folder: string | null): boolean {
  const errPath = (err as NodeJS.ErrnoException | null)?.path;
  if (!folder || typeof errPath !== "string") return false;
  return path.resolve(errPath).toLowerCase().startsWith(path.resolve(folder).toLowerCase());
}

interface PhoneSyncState {
  scheduler: SyncScheduler | null;
  timers: ReturnType<typeof setInterval>[];
  /** total_changes() right after the last sync, minus user writes made during it. */
  baseline: number;
  /** Last total_changes() value the watcher reacted to. */
  watchSeen: number;
  snapshotWrittenSinceStart: boolean;
  running: boolean;
}

declare global {
  var _phoneSync: PhoneSyncState | undefined;
}

function totalChanges(): number {
  // Per connection: counts every write made through the app's getDb() handle.
  return (getDb().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
}

function getState(): PhoneSyncState {
  if (!globalThis._phoneSync) {
    const n = totalChanges();
    globalThis._phoneSync = {
      scheduler: null,
      timers: [],
      baseline: n,
      watchSeen: n,
      snapshotWrittenSinceStart: false,
      running: false,
    };
  }
  return globalThis._phoneSync;
}

function storedError(): PhoneSyncError | null {
  const raw = getGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastError);
  return KNOWN_ERRORS.includes(raw as PhoneSyncError) ? (raw as PhoneSyncError) : null;
}

export function getPhoneSyncStatus(): PhoneSyncStatus {
  const config = getPhoneSyncConfig();
  const error = config.enabled ? storedError() : null;
  const bytes = getGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastSnapshotBytes);
  const state: PhoneSyncStatus["state"] = !config.enabled
    ? "disabled"
    : globalThis._phoneSync?.running
      ? "syncing"
      : error
        ? "error"
        : "idle";
  return {
    enabled: config.enabled,
    folder: config.folder,
    hasPassphrase: config.hasPassphrase,
    state,
    lastSyncedAt: getGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastSyncedAt),
    lastSnapshotAt: getGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastSnapshotAt),
    lastSnapshotBytes: bytes != null ? Number(bytes) : null,
    error,
    devices: listDevices(),
  };
}

function errorCode(err: unknown): string {
  return err instanceof PhoneSyncCryptoError ? err.code : "apply_failed";
}

async function applyPendingChangeFiles(folder: string, passphrase: string): Promise<number> {
  let applied = 0;
  for (const file of listChangeFiles(folder)) {
    const known = getDevice(file.deviceId);
    if (known?.lastFileMtimeMs === file.mtimeMs) continue;
    try {
      const blob = new Uint8Array(fs.readFileSync(file.path));
      const change = decodeChangeFile(await decryptPayload(blob, passphrase));
      if (change.deviceId !== file.deviceId) {
        throw new PhoneSyncCryptoError("bad_format", "device id does not match file name");
      }
      // Sets last_file_mtime_ms only when the whole file applies.
      applyChangeFile(change, file.mtimeMs);
      recordDeviceError(file.deviceId, null);
      applied++;
    } catch (err) {
      const code = errorCode(err);
      console.error(`[phone-sync] change file for device ${file.deviceId} failed: ${code}`);
      ensureDevice(file.deviceId);
      recordDeviceError(file.deviceId, code);
    }
  }
  return applied;
}

/**
 * Writes status keys and moves the baseline to `baselineStart` plus those
 * writes, so the engine's own writes never look like a local change while user
 * writes made after `baselineStart` still count as pending.
 */
function finishSync(
  state: PhoneSyncState,
  baselineStart: number,
  write: () => void
): void {
  const beforeStatus = totalChanges();
  write();
  const afterStatus = totalChanges();
  state.baseline = baselineStart + (afterStatus - beforeStatus);
  state.watchSeen = afterStatus;
}

/**
 * Keeps the old baseline, so local changes stay pending until a snapshot is
 * written. The change-file poll retries while an error is stored.
 */
function recordError(state: PhoneSyncState, error: PhoneSyncError): void {
  finishSync(state, state.baseline, () => {
    setGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastError, error);
  });
}

/** One full sync pass. Folder and passphrase problems become status errors, never throws. */
export async function runPhoneSync(): Promise<PhoneSyncStatus> {
  const config = getPhoneSyncConfig();
  if (!config.enabled) return getPhoneSyncStatus();

  const state = getState();
  state.running = true;
  try {
    await syncPass(state, config.folder);
  } catch (err) {
    // Unexpected failures still become a stored error, so the status shows it
    // and the change-file poll retries.
    const folderError = isFsErrorOnPath(err, config.folder);
    console.error(
      "[phone-sync] sync failed:",
      folderError ? (err as NodeJS.ErrnoException).code : (err as Error).message
    );
    recordError(state, folderError ? "folder_unavailable" : "sync_failed");
  } finally {
    state.running = false;
  }
  return getPhoneSyncStatus();
}

async function syncPass(state: PhoneSyncState, folder: string | null): Promise<void> {
  const check = checkFolder(folder);
  if (!check.ok) return recordError(state, check.reason);
  const dir = folder as string;
  const passphrase = getPhoneSyncPassphrase();
  if (!passphrase) return recordError(state, "no_passphrase");

  const applied = await applyPendingChangeFiles(dir, passphrase);

  const changesBeforeSnapshot = totalChanges();
  const pending = changesBeforeSnapshot > state.baseline;
  let snapshot: { at: string; bytes: number } | null = null;
  if (applied > 0 || pending || !state.snapshotWrittenSinceStart) {
    const now = new Date();
    const plain = buildSnapshotDbBytes({ acks: getAcks(), now });
    const blob = await encryptPayload(plain, passphrase);
    try {
      writeSnapshotAtomic(dir, blob);
    } catch {
      return recordError(state, "not_writable");
    }
    state.snapshotWrittenSinceStart = true;
    snapshot = { at: now.toISOString(), bytes: blob.byteLength };
  }

  finishSync(state, changesBeforeSnapshot, () => {
    setGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastSyncedAt, new Date().toISOString());
    if (snapshot) {
      setGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastSnapshotAt, snapshot.at);
      setGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastSnapshotBytes, String(snapshot.bytes));
    }
    deleteGlobalSetting(PHONE_SYNC_STATUS_KEYS.lastError);
  });
  // Writes made while the snapshot was built are not in it: debounce another sync.
  if (totalChanges() > state.baseline) state.scheduler?.notifyChange();
}

/** Watcher tick: schedules a debounced sync when the database changed since the last check. */
export function checkLocalChanges(): void {
  const state = globalThis._phoneSync;
  if (!state?.scheduler) return;
  const n = totalChanges();
  if (n > state.watchSeen) {
    state.watchSeen = n;
    state.scheduler.notifyChange();
  }
}

/**
 * Poll tick: syncs right away when a phone change file is new or updated, or
 * to retry after an error (for example the Drive folder coming back).
 */
export function checkChangeFiles(): void {
  const state = globalThis._phoneSync;
  if (!state?.scheduler || state.running) return;
  if (storedError() !== null) {
    void state.scheduler.syncNow();
    return;
  }
  const { folder } = getPhoneSyncConfig();
  if (!folder) return;
  let files;
  try {
    // Read-only on purpose: no probe file churn in the Drive folder every poll.
    files = listChangeFiles(folder);
  } catch {
    files = null;
  }
  const changed =
    files === null ||
    files.some((file) => getDevice(file.deviceId)?.lastFileMtimeMs !== file.mtimeMs);
  // An unreadable folder also syncs, so the error is recorded in the status.
  if (changed) void state.scheduler.syncNow();
}

/** Stops the timers and scheduler. Safe to call any time. */
export function stopPhoneSync(): void {
  const state = globalThis._phoneSync;
  if (!state) return;
  for (const timer of state.timers) clearInterval(timer);
  state.timers = [];
  state.scheduler?.cancel();
  state.scheduler = null;
}

/**
 * Starts the watcher, the change-file poll and a first sync when phone sync is
 * enabled, and stops them when it is not. Idempotent across HMR reloads, so
 * settings changes can call it again to re-evaluate. Never rejects.
 */
export async function initPhoneSync(
  opts: { clock?: SchedulerClock<unknown> } = {}
): Promise<void> {
  try {
    if (!getPhoneSyncConfig().enabled) {
      stopPhoneSync();
      return;
    }
    const state = getState();
    if (state.scheduler) return;

    state.snapshotWrittenSinceStart = false;
    state.scheduler = createSyncScheduler({
      run: async () => {
        try {
          await runPhoneSync();
        } catch (err) {
          console.error("[phone-sync] sync failed:", (err as Error).message);
        }
      },
      clock: opts.clock,
    });
    const watch = setInterval(() => {
      try {
        checkLocalChanges();
      } catch (err) {
        console.error("[phone-sync] change watcher failed:", (err as Error).message);
      }
    }, LOCAL_CHANGE_CHECK_MS);
    const poll = setInterval(() => {
      try {
        checkChangeFiles();
      } catch (err) {
        console.error("[phone-sync] change file poll failed:", (err as Error).message);
      }
    }, CHANGE_POLL_MS);
    watch.unref?.();
    poll.unref?.();
    state.timers = [watch, poll];
    await state.scheduler.syncNow();
  } catch (err) {
    console.error("[phone-sync] init failed:", (err as Error).message);
  }
}

/**
 * Runs a sync now (used by the Sync button and after settings changes) and
 * returns the resulting status. Starts the engine first if it is not running.
 */
export async function syncPhoneNow(): Promise<PhoneSyncStatus> {
  const state = globalThis._phoneSync;
  if (!getPhoneSyncConfig().enabled || !state?.scheduler) {
    // Starts (with a first sync) when enabled, stops when disabled.
    await initPhoneSync();
  } else {
    await state.scheduler.syncNow();
  }
  return getPhoneSyncStatus();
}
