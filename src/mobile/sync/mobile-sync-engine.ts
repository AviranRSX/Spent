// The phone's sync engine: boot from the local encrypted snapshot, then push
// the outbox to Drive and pull a newer snapshot when there is one. Every
// platform dependency is injected so node tests run it with fakes; the
// Capacitor wiring lives in src/mobile/boot/.
import { encodeChangeFile, type PhoneChange } from "@/lib/phone-sync/changes";
import { decryptPayload, encryptPayload, PhoneSyncCryptoError } from "@/lib/phone-sync/crypto";
import { changeFileName, SNAPSHOT_FILE } from "@/lib/phone-sync/format";
import { pruneAcked } from "@/lib/phone-sync/outbox";
import { createSyncScheduler, type SchedulerClock } from "@/lib/phone-sync/scheduler";
import { APP_SCHEMA_VERSION, MIN_SNAPSHOT_SCHEMA_VERSION } from "@/lib/phone-sync/schema-version";
import type { DriveClient, DriveFolder } from "@/mobile/drive/drive-client";
import type { LocalFiles } from "@/mobile/storage/local-files";
import type { EncryptedOutboxStore } from "@/mobile/storage/outbox-store";
import type { SecretKey } from "@/mobile/storage/secure-store";
import type { SnapshotInfo } from "./inspect-snapshot";

export type MobileSyncError =
  | "offline"
  | "bad_passphrase"
  | "folder_unavailable"
  | "signed_out"
  | "update_phone_app"
  | "update_pc"
  | "bad_format"
  // Drive answered with an unexpected error, or something else failed.
  | "sync_failed";

export type MobileSyncState = {
  state: "idle" | "syncing" | "error";
  lastSyncedAt: string | null;
  pendingCount: number;
  error: MobileSyncError | null;
};

export type BootResult = "needs_onboarding" | "ready" | "needs_passphrase";

export interface SecretStore {
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface MobileSyncDeps {
  drive: Pick<DriveClient, "findSpentFolders" | "getFileMeta" | "download" | "upsertFile">;
  files: Pick<LocalFiles, "readSnapshotBlob" | "writeSnapshotBlob" | "wipeLocalData">;
  secrets: SecretStore;
  outbox: EncryptedOutboxStore;
  loadDatabase(bytes: Uint8Array): Promise<void>;
  /** Reads version, acks, language and workspaces from snapshot bytes without loading them. */
  inspectSnapshot(bytes: Uint8Array): Promise<SnapshotInfo>;
  reapplyOutbox(changes: PhoneChange[]): void;
  invalidateAll(): void;
  now(): Date;
  setLocale(locale: "en" | "he"): void;
  workspace: { get(): number | null; set(id: number): void };
  signOut(): Promise<void>;
  clock?: SchedulerClock<unknown>;
  /** A new device id: 32 lowercase hex characters. */
  randomId?: () => string;
}

export interface MobileSyncEngine {
  boot(): Promise<BootResult>;
  sync(): Promise<void>;
  notifyChange(): void;
  onForeground(): void;
  onBackground(): void;
  getState(): MobileSyncState;
  subscribe(listener: () => void): () => void;
  /** The PC's ack for this phone in the loaded snapshot (outbox entries at or below it are done). */
  getAck(): number;
  /** The passphrase of the connected session (the outbox store encrypts with it). */
  getPassphrase(): string | null;
  /** True once a snapshot is loaded into the database. */
  hasData(): boolean;
  /** Verifies a new passphrase against the snapshot, re-keys the outbox and syncs. */
  submitPassphrase(passphrase: string): Promise<"ok" | MobileSyncError>;
  listFolders(): Promise<DriveFolder[]>;
  /** Onboarding: checks that `passphrase` opens the folder's snapshot. Saves nothing. */
  prepareConnection(folder: DriveFolder, passphrase: string): Promise<"ok" | MobileSyncError>;
  /** Onboarding: stores the prepared connection under `deviceName`, then boots. */
  completeConnection(deviceName: string): Promise<BootResult>;
  disconnect(): Promise<void>;
}

const DEFAULT_DEVICE_NAME = "Phone";
const MAX_DEVICE_NAME = 64;
const ERROR_CODES: MobileSyncError[] = [
  "offline",
  "bad_passphrase",
  "folder_unavailable",
  "signed_out",
  "update_phone_app",
  "update_pc",
  "bad_format",
  "sync_failed",
];

/** A failure the engine raises itself, already mapped to a UI code. */
class SyncFailure extends Error {
  constructor(readonly code: MobileSyncError) {
    super(code);
    this.name = "SyncFailure";
  }
}

/** Thrown inside a sync run whose session was replaced; the run then stops quietly. */
class StaleRun extends Error {
  constructor() {
    super("stale_run");
    this.name = "StaleRun";
  }
}

export function errorCode(error: unknown): MobileSyncError {
  if (error instanceof SyncFailure) return error.code;
  if (error instanceof PhoneSyncCryptoError) {
    if (error.code === "bad_passphrase") return "bad_passphrase";
    if (error.code === "unsupported_version") return "update_phone_app";
    return "bad_format";
  }
  // DriveError messages are their codes; the token source throws plain
  // Error("offline") / Error("signed_out").
  const message = error instanceof Error ? error.message : "";
  if (message === "drive_error") return "sync_failed";
  return (ERROR_CODES as string[]).includes(message) ? (message as MobileSyncError) : "sync_failed";
}

/** Newer than this build gives update_phone_app; older than the minimum gives update_pc. */
export function checkSchema(version: string | null): MobileSyncError | null {
  if (!version) return "bad_format";
  if (version > APP_SCHEMA_VERSION) return "update_phone_app";
  if (version < MIN_SNAPSHOT_SCHEMA_VERSION) return "update_pc";
  return null;
}

function defaultRandomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").toLowerCase();
}

interface Session {
  passphrase: string;
  deviceId: string;
  deviceName: string;
  folderId: string;
}

interface Download {
  blob: Uint8Array;
  plain: Uint8Array;
  info: SnapshotInfo;
  md5: string;
}

const INITIAL_STATE: MobileSyncState = {
  state: "idle",
  lastSyncedAt: null,
  pendingCount: 0,
  error: null,
};

export function createMobileSyncEngine(deps: MobileSyncDeps): MobileSyncEngine {
  let session: Session | null = null;
  let loaded = false;
  let ack = 0;
  let lastMd5: string | null = null;
  let lastUploaded: string | null = null;
  /** A snapshot already downloaded and verified, for the next sync run to apply. */
  let prefetched: Download | null = null;
  /** An error worth showing even after the next sync succeeds (a set-aside outbox). */
  let notice: MobileSyncError | null = null;
  let pendingConnection: { folder: DriveFolder; passphrase: string; download: Download } | null =
    null;
  let state: MobileSyncState = INITIAL_STATE;
  const listeners = new Set<() => void>();

  function setState(patch: Partial<MobileSyncState>) {
    const next = { ...state, ...patch };
    next.state = next.state === "syncing" ? "syncing" : next.error ? "error" : "idle";
    state = next;
    for (const listener of listeners) listener();
  }

  async function refreshPending() {
    try {
      const changes = await deps.outbox.load();
      setState({ pendingCount: pruneAcked(changes, ack).length });
    } catch {
      // The outbox is locked; keep the last known count.
    }
  }

  async function verify(blob: Uint8Array, passphrase: string, md5: string): Promise<Download> {
    const plain = await decryptPayload(blob, passphrase);
    const info = await deps.inspectSnapshot(plain);
    const problem = checkSchema(info.schemaVersion);
    if (problem) throw new SyncFailure(problem);
    return { blob, plain, info, md5 };
  }

  async function downloadSnapshot(folderId: string, passphrase: string): Promise<Download> {
    const meta = await deps.drive.getFileMeta(folderId, SNAPSHOT_FILE);
    if (!meta) throw new SyncFailure("folder_unavailable");
    return verify(await deps.drive.download(meta.id), passphrase, meta.md5Checksum);
  }

  function adoptSnapshotInfo(info: SnapshotInfo, current: Session) {
    ack = info.acks[current.deviceId] ?? 0;
    deps.setLocale(info.language === "he" ? "he" : "en");
    const active = deps.workspace.get();
    if (info.workspaceIds.length > 0 && (active === null || !info.workspaceIds.includes(active))) {
      deps.workspace.set(Math.min(...info.workspaceIds));
    }
  }

  /** Loads the outbox and re-applies what the snapshot has not acked yet. */
  async function replayOutbox(prune: boolean): Promise<void> {
    let pending: PhoneChange[] = [];
    try {
      pending = prune
        ? await deps.outbox.update((changes) => pruneAcked(changes, ack))
        : pruneAcked(await deps.outbox.load(), ack);
    } catch (error) {
      // A locked outbox stays on disk untouched; the passphrase flow re-keys it.
      if (deps.outbox.isLocked()) {
        setState({ error: "bad_passphrase" });
        return;
      }
      throw error;
    }
    deps.reapplyOutbox(pending);
    setState({ pendingCount: pending.length });
    if (deps.outbox.takeCorruption()) {
      notice = "bad_format";
      setState({ error: notice });
    }
  }

  // Every side effect below calls `guard` first: once the session changed
  // (new passphrase, Disconnect) a run that started before is a no-op.
  async function applyDownload(
    download: Download,
    current: Session,
    guard: () => void
  ): Promise<void> {
    guard();
    // Load first: if the bytes don't open, the blob on disk stays the old one.
    await deps.loadDatabase(download.plain);
    loaded = true;
    guard();
    await deps.files.writeSnapshotBlob(download.blob);
    guard();
    adoptSnapshotInfo(download.info, current);
    await replayOutbox(true);
    if (download.md5) {
      guard();
      lastMd5 = download.md5;
      await deps.secrets.set("snapshotMd5", download.md5);
    }
    deps.invalidateAll();
  }

  async function uploadOutbox(current: Session, guard: () => void): Promise<void> {
    if (deps.outbox.isLocked()) return;
    const pending = pruneAcked(await deps.outbox.load(), ack);
    if (pending.length === 0) return;
    // Skip re-uploading the same entries. A new passphrase clears
    // lastUploaded, and a run from an older session never sets it.
    const signature = JSON.stringify(pending);
    if (signature === lastUploaded) return;
    const plain = encodeChangeFile({
      formatVersion: 1,
      deviceId: current.deviceId,
      deviceName: current.deviceName,
      changes: pending,
    });
    const encrypted = await encryptPayload(plain, current.passphrase);
    guard();
    await deps.drive.upsertFile(current.folderId, changeFileName(current.deviceId), encrypted);
    if (session === current) lastUploaded = signature;
  }

  async function runSync(): Promise<void> {
    const current = session;
    if (!current) return;
    const guard = () => {
      if (session !== current) throw new StaleRun();
    };
    setState({ state: "syncing" });
    let error: MobileSyncError | null = null;
    try {
      await uploadOutbox(current, guard);
      guard();
      let download = prefetched;
      prefetched = null;
      if (!download) {
        const meta = await deps.drive.getFileMeta(current.folderId, SNAPSHOT_FILE);
        if (!meta) throw new SyncFailure("folder_unavailable");
        if (!loaded || !meta.md5Checksum || meta.md5Checksum !== lastMd5) {
          download = await verify(
            await deps.drive.download(meta.id),
            current.passphrase,
            meta.md5Checksum
          );
        }
      }
      if (download) await applyDownload(download, current, guard);
      if (deps.outbox.isLocked()) error = "bad_passphrase";
      else {
        // Shown through one full sync, then cleared.
        error = notice;
        notice = null;
      }
      guard();
      const syncedAt = deps.now().toISOString();
      setState({ lastSyncedAt: syncedAt });
      await deps.secrets.set("lastSyncedAt", syncedAt).catch(() => undefined);
    } catch (failure) {
      // A stale run leaves the state to whoever replaced the session.
      if (failure instanceof StaleRun || session !== current) return;
      error = errorCode(failure);
    }
    if (session !== current) return;
    // Clears an earlier error (such as a set-aside outbox) only on success.
    setState({ state: "idle", error });
    await refreshPending();
  }

  /** The run in progress, so Disconnect can wait for it to settle. */
  let inFlight: Promise<void> | null = null;
  const scheduler = createSyncScheduler({
    run: () => {
      const run = runSync();
      inFlight = run;
      return run;
    },
    clock: deps.clock,
  });

  async function readSession(): Promise<Session | null> {
    const [passphrase, deviceId, deviceName, folderId] = await Promise.all([
      deps.secrets.get("passphrase"),
      deps.secrets.get("deviceId"),
      deps.secrets.get("deviceName"),
      deps.secrets.get("folderId"),
    ]);
    if (!passphrase || !deviceId || !deviceName || !folderId) return null;
    return { passphrase, deviceId, deviceName, folderId };
  }

  /** Opens the local snapshot. "unusable" covers a missing, damaged or incompatible copy. */
  async function loadLocal(current: Session): Promise<"ok" | "bad_passphrase" | "unusable"> {
    const blob = await deps.files.readSnapshotBlob();
    if (!blob) return "unusable";
    let local: Download;
    try {
      local = await verify(blob, current.passphrase, "");
    } catch (failure) {
      const code = errorCode(failure);
      if (code === "bad_passphrase") return "bad_passphrase";
      if (code === "update_phone_app" || code === "update_pc") setState({ error: code });
      return "unusable";
    }
    await deps.loadDatabase(local.plain);
    loaded = true;
    adoptSnapshotInfo(local.info, current);
    await replayOutbox(false);
    return "ok";
  }

  async function boot(): Promise<BootResult> {
    const current = await readSession();
    session = current;
    if (!current) return "needs_onboarding";
    lastMd5 = await deps.secrets.get("snapshotMd5");
    const syncedAt = await deps.secrets.get("lastSyncedAt");
    if (syncedAt) setState({ lastSyncedAt: syncedAt });

    const local = await loadLocal(current);
    if (local === "bad_passphrase") return "needs_passphrase";
    if (local === "unusable") {
      // No usable local copy: fetch one now. The UI shows the error if this fails.
      lastMd5 = null;
      await scheduler.syncNow();
      if (!loaded && state.error === "bad_passphrase") return "needs_passphrase";
      return "ready";
    }
    void scheduler.syncNow();
    return "ready";
  }

  /** A passphrase submit in progress, so Disconnect can wait for it to settle. */
  let submitting: Promise<unknown> | null = null;

  function submitPassphrase(passphrase: string): Promise<"ok" | MobileSyncError> {
    const run = runSubmit(passphrase);
    submitting = run;
    return run;
  }

  // Each await is followed by a session check: a submit superseded by
  // Disconnect stops before its next side effect, and Disconnect waits for it
  // before wiping, so anything it already wrote is wiped too.
  async function runSubmit(passphrase: string): Promise<"ok" | MobileSyncError> {
    const current = session;
    if (!current) return "signed_out";
    let download: Download | null = null;
    try {
      download = await downloadSnapshot(current.folderId, passphrase);
    } catch (failure) {
      const code = errorCode(failure);
      if (code === "bad_passphrase" || code === "bad_format") return code;
      // Drive is unreachable or the snapshot needs a different app version:
      // the local copy can still confirm the passphrase.
      const blob = await deps.files.readSnapshotBlob();
      if (!blob) return code;
      try {
        await decryptPayload(blob, passphrase);
      } catch {
        return code;
      }
    }

    if (session !== current) return "signed_out";
    try {
      // Also switches the store's key, in the same queue as saves.
      await deps.outbox.rekey([current.passphrase, passphrase], passphrase);
    } catch {
      // Opens with neither passphrase: it stays on disk, locked, and the
      // error stays visible. Never discard it.
    }
    if (session !== current) return "signed_out";
    await deps.secrets.set("passphrase", passphrase);
    if (session !== current) return "signed_out";
    const updated: Session = { ...current, passphrase };
    session = updated;
    lastUploaded = null;

    if (!download && !loaded) {
      const local = await loadLocal(updated);
      if (local === "bad_passphrase") return "bad_passphrase";
      if (session !== updated) return "signed_out";
    }
    prefetched = download;
    await scheduler.syncNow();
    return "ok";
  }

  async function prepareConnection(
    folder: DriveFolder,
    passphrase: string
  ): Promise<"ok" | MobileSyncError> {
    pendingConnection = null;
    try {
      const download = await downloadSnapshot(folder.id, passphrase);
      pendingConnection = { folder, passphrase, download };
      return "ok";
    } catch (failure) {
      return errorCode(failure);
    }
  }

  async function completeConnection(deviceName: string): Promise<BootResult> {
    const pending = pendingConnection;
    if (!pending) return "needs_onboarding";
    const name = deviceName.trim().slice(0, MAX_DEVICE_NAME) || DEFAULT_DEVICE_NAME;
    // Keep an existing id so an outbox left on the phone stays this device's.
    const deviceId = (await deps.secrets.get("deviceId")) ?? (deps.randomId ?? defaultRandomId)();

    await deps.files.writeSnapshotBlob(pending.download.blob);
    await deps.secrets.set("deviceId", deviceId);
    await deps.secrets.set("deviceName", name);
    await deps.secrets.set("folderId", pending.folder.id);
    await deps.secrets.set("folderName", pending.folder.name);
    if (pending.download.md5) await deps.secrets.set("snapshotMd5", pending.download.md5);
    // Last: boot treats the phone as connected only once the passphrase is stored.
    await deps.secrets.set("passphrase", pending.passphrase);
    pendingConnection = null;
    deps.outbox.reset();
    lastUploaded = null;
    return boot();
  }

  async function disconnect(): Promise<void> {
    scheduler.cancel();
    // Makes any running sync stale, then waits for it (and queued follow-ups,
    // which return at once without a session) before wiping.
    session = null;
    // The submit may still write the outbox or the passphrase secret; let it
    // finish (it stops at its next session check) so the wipe below removes it.
    await (submitting ?? Promise.resolve()).catch(() => undefined);
    submitting = null;
    while (scheduler.isRunning()) {
      await (inFlight ?? Promise.resolve()).catch(() => undefined);
    }
    await deps.files.wipeLocalData();
    await deps.secrets.clearAll();
    await deps.signOut();
    deps.outbox.reset();
    loaded = false;
    ack = 0;
    lastMd5 = null;
    lastUploaded = null;
    prefetched = null;
    notice = null;
    pendingConnection = null;
    state = INITIAL_STATE;
    for (const listener of listeners) listener();
  }

  return {
    boot,
    sync: () => scheduler.syncNow(),
    notifyChange() {
      scheduler.notifyChange();
      void refreshPending();
    },
    onForeground() {
      if (session) void scheduler.syncNow();
    },
    onBackground() {
      scheduler.cancel();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getAck: () => ack,
    getPassphrase: () => session?.passphrase ?? null,
    hasData: () => loaded,
    submitPassphrase,
    listFolders: () => deps.drive.findSpentFolders(),
    prepareConnection,
    completeConnection,
    disconnect,
  };
}
