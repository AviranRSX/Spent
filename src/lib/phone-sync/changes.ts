import { PhoneSyncCryptoError } from "./crypto";

export type PhoneChange = {
  seq: number;
  workspaceId: number;
  transactionId: number;
  dedupHash: string;
  action: "setCategory" | "approve";
  categoryId?: number;
  at: string;
};

export type ChangeFile = {
  formatVersion: 1;
  deviceId: string;
  deviceName: string;
  changes: PhoneChange[];
};

/** The parts of a transaction row that decide whether a change still applies. */
export type ChangeTarget = {
  dedupHash: string;
  categoryDecidedAt: string | null;
};

/**
 * Why `change` must not be applied to `target`, or null when it applies.
 * Shared by the PC applier and the phone's outbox replay so both follow the
 * same rules: a missing or different row is a mismatch, and a decision made
 * after the change wins.
 */
export function changeSkipReason(
  target: ChangeTarget | null,
  change: PhoneChange
): "mismatch" | "newer" | null {
  if (!target || target.dedupHash !== change.dedupHash) return "mismatch";
  if (target.categoryDecidedAt != null && target.categoryDecidedAt > change.at) return "newer";
  return null;
}

const DEVICE_ID_PATTERN = /^[a-z0-9-]{8,64}$/;
const MAX_DEVICE_NAME = 64;

export function encodeChangeFile(file: ChangeFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(file));
}

function bad(message: string): never {
  throw new PhoneSyncCryptoError("bad_format", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    bad(`invalid ${field}`);
  }
  return value;
}

function decodeChange(raw: unknown): PhoneChange {
  if (!isRecord(raw)) bad("invalid change");
  const seq = positiveInt(raw.seq, "seq");
  const workspaceId = positiveInt(raw.workspaceId, "workspaceId");
  const transactionId = positiveInt(raw.transactionId, "transactionId");
  if (typeof raw.dedupHash !== "string" || raw.dedupHash === "") {
    bad("invalid dedupHash");
  }
  if (
    typeof raw.at !== "string" ||
    Number.isNaN(Date.parse(raw.at)) ||
    new Date(raw.at).toISOString() !== raw.at
  ) {
    bad("invalid at");
  }
  const base = { seq, workspaceId, transactionId, dedupHash: raw.dedupHash, at: raw.at };
  if (raw.action === "setCategory") {
    return {
      ...base,
      action: "setCategory",
      categoryId: positiveInt(raw.categoryId, "categoryId"),
    };
  }
  if (raw.action === "approve") return { ...base, action: "approve" };
  return bad("invalid action");
}

/** Validates a list of changes (seq values must be unique). Throws `bad_format`. */
export function decodeChanges(raw: unknown): PhoneChange[] {
  if (!Array.isArray(raw)) bad("invalid changes");
  const seen = new Set<number>();
  return raw.map((entry) => {
    const change = decodeChange(entry);
    if (seen.has(change.seq)) bad("duplicate seq");
    seen.add(change.seq);
    return change;
  });
}

export function decodeChangeFile(bytes: Uint8Array): ChangeFile {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return bad("change file is not valid JSON");
  }
  if (!isRecord(raw)) bad("change file is not an object");
  if (raw.formatVersion !== 1) {
    throw new PhoneSyncCryptoError(
      typeof raw.formatVersion === "number" ? "unsupported_version" : "bad_format",
      "unsupported change file version",
    );
  }
  if (typeof raw.deviceId !== "string" || !DEVICE_ID_PATTERN.test(raw.deviceId)) {
    bad("invalid deviceId");
  }
  const deviceName = typeof raw.deviceName === "string" ? raw.deviceName.trim() : "";
  if (deviceName === "" || deviceName.length > MAX_DEVICE_NAME) bad("invalid deviceName");
  return { formatVersion: 1, deviceId: raw.deviceId, deviceName, changes: decodeChanges(raw.changes) };
}
