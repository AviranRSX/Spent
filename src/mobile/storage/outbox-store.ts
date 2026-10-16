import { decodeChanges, type PhoneChange } from "@/lib/phone-sync/changes";
import {
  decryptPayload,
  encryptPayload,
  PhoneSyncCryptoError,
} from "@/lib/phone-sync/crypto";
import type { LocalFiles } from "./local-files";

/** Where the phone keeps edits that the PC has not acknowledged yet. */
export interface OutboxStore {
  load(): Promise<PhoneChange[]>;
  save(changes: PhoneChange[]): Promise<void>;
}

/** In-memory store for tests. */
export function createMemoryOutboxStore(initial: PhoneChange[] = []): OutboxStore {
  let current = initial.map((change) => ({ ...change }));
  return {
    async load() {
      return current.map((change) => ({ ...change }));
    },
    async save(changes) {
      current = changes.map((change) => ({ ...change }));
    },
  };
}

/** Thrown by save() while the outbox on disk could not be opened. */
export class OutboxLockedError extends Error {
  constructor() {
    super("outbox_locked");
    this.name = "OutboxLockedError";
  }
}

export interface EncryptedOutboxStore extends OutboxStore {
  /** Applies `fn` to the current entries and saves the result, after any pending save. */
  update(fn: (changes: PhoneChange[]) => PhoneChange[]): Promise<PhoneChange[]>;
  /**
   * Re-encrypts the outbox with `passphrase`. The blob on disk is opened with
   * the first of `candidates` that works. Throws `bad_passphrase` and keeps
   * the blob when none does.
   */
  rekey(candidates: string[], passphrase: string): Promise<void>;
  /** True once load() failed with a passphrase or version error. Saves are refused until rekey or reset. */
  isLocked(): boolean;
  /** True once after load() found an unreadable outbox and set it aside. */
  takeCorruption(): boolean;
  /** Forgets the cache and flags (after Disconnect). */
  reset(): void;
}

type OutboxFiles = Pick<LocalFiles, "readOutboxBlob" | "writeOutboxBlob" | "setAsideOutboxBlob">;

const OUTBOX_FORMAT_VERSION = 1;

function encode(changes: PhoneChange[]): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ formatVersion: OUTBOX_FORMAT_VERSION, changes })
  );
}

function decode(bytes: Uint8Array): PhoneChange[] {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PhoneSyncCryptoError("bad_format", "outbox is not valid JSON");
  }
  const record = raw as { formatVersion?: unknown; changes?: unknown } | null;
  if (!record || record.formatVersion !== OUTBOX_FORMAT_VERSION) {
    throw new PhoneSyncCryptoError("bad_format", "unknown outbox format");
  }
  return decodeChanges(record.changes);
}

function copy(changes: PhoneChange[]): PhoneChange[] {
  return changes.map((change) => ({ ...change }));
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof PhoneSyncCryptoError && error.code === code;
}

/**
 * The phone's outbox on disk, encrypted with the sync passphrase. An outbox
 * that fails with `bad_passphrase` (or a newer format) is never discarded: it
 * stays on disk and saves are refused until the passphrase flow re-keys it.
 * One that can't be decoded at all is set aside and replaced by an empty one.
 */
export function createEncryptedOutboxStore(opts: {
  files: OutboxFiles;
  getPassphrase: () => string | null;
}): EncryptedOutboxStore {
  let cache: PhoneChange[] | null = null;
  let locked = false;
  let corrupted = false;
  // Saves run one at a time, in call order.
  let queue: Promise<unknown> = Promise.resolve();

  function passphrase(): string {
    const value = opts.getPassphrase();
    if (!value) throw new OutboxLockedError();
    return value;
  }

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function readCurrent(): Promise<PhoneChange[]> {
    if (cache) return cache;
    const blob = await opts.files.readOutboxBlob();
    if (!blob) {
      cache = [];
      return cache;
    }
    try {
      cache = decode(await decryptPayload(blob, passphrase()));
      locked = false;
      return cache;
    } catch (error) {
      if (isCode(error, "bad_format")) {
        await opts.files.setAsideOutboxBlob();
        corrupted = true;
        cache = [];
        return cache;
      }
      locked = true;
      throw error;
    }
  }

  async function write(changes: PhoneChange[], key: string): Promise<void> {
    await opts.files.writeOutboxBlob(await encryptPayload(encode(changes), key));
    cache = copy(changes);
  }

  return {
    async load() {
      return copy(await readCurrent());
    },
    save(changes) {
      const next = copy(changes);
      return serial(async () => {
        if (locked) throw new OutboxLockedError();
        await write(next, passphrase());
      });
    },
    update(fn) {
      return serial(async () => {
        if (locked) throw new OutboxLockedError();
        const next = fn(copy(await readCurrent()));
        await write(next, passphrase());
        return copy(next);
      });
    },
    rekey(candidates, nextPassphrase) {
      return serial(async () => {
        const blob = await opts.files.readOutboxBlob();
        if (!blob) {
          cache = [];
          locked = false;
          return;
        }
        let changes: PhoneChange[] | null = null;
        for (const candidate of candidates) {
          try {
            changes = decode(await decryptPayload(blob, candidate));
            break;
          } catch (error) {
            if (isCode(error, "bad_passphrase")) continue;
            if (isCode(error, "bad_format")) {
              await opts.files.setAsideOutboxBlob();
              corrupted = true;
              changes = [];
              break;
            }
            throw error;
          }
        }
        if (!changes) {
          locked = true;
          throw new PhoneSyncCryptoError("bad_passphrase", "outbox opens with no known passphrase");
        }
        await write(changes, nextPassphrase);
        locked = false;
      });
    },
    isLocked: () => locked,
    takeCorruption() {
      const was = corrupted;
      corrupted = false;
      return was;
    },
    reset() {
      cache = null;
      locked = false;
      corrupted = false;
    },
  };
}
