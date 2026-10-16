import "server-only";

import { getDb } from "@/server/db";
import type { PhoneSyncDevice } from "@/lib/types";

interface DeviceRow {
  deviceId: string;
  deviceName: string;
  lastAppliedSeq: number;
  appliedCount: number;
  skippedNewerCount: number;
  skippedMismatchCount: number;
  lastFileMtimeMs: number | null;
  lastSeenAt: string | null;
  lastError: string | null;
}

const SELECT_DEVICE = `SELECT device_id as deviceId, device_name as deviceName,
  last_applied_seq as lastAppliedSeq, applied_count as appliedCount,
  skipped_newer_count as skippedNewerCount,
  skipped_mismatch_count as skippedMismatchCount,
  last_file_mtime_ms as lastFileMtimeMs, last_seen_at as lastSeenAt,
  last_error as lastError
  FROM phone_sync_devices`;

export function getDevice(deviceId: string): PhoneSyncDevice | null {
  const row = getDb()
    .prepare(`${SELECT_DEVICE} WHERE device_id = ?`)
    .get(deviceId) as DeviceRow | undefined;
  return row ?? null;
}

export function listDevices(): PhoneSyncDevice[] {
  return getDb()
    .prepare(`${SELECT_DEVICE} ORDER BY device_name, device_id`)
    .all() as DeviceRow[];
}

export function upsertDevice(
  deviceId: string,
  deviceName: string,
  mtimeMs: number
): void {
  getDb()
    .prepare(
      `INSERT INTO phone_sync_devices (device_id, device_name, last_file_mtime_ms, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         device_name = excluded.device_name,
         last_file_mtime_ms = excluded.last_file_mtime_ms,
         last_seen_at = excluded.last_seen_at`
    )
    .run(deviceId, deviceName, mtimeMs, new Date().toISOString());
}

/** Adds the counts to the stored totals and records the highest applied seq. */
export function recordApply(
  deviceId: string,
  result: {
    lastAppliedSeq: number;
    applied: number;
    skippedNewer: number;
    skippedMismatch: number;
  }
): void {
  getDb()
    .prepare(
      `UPDATE phone_sync_devices
       SET last_applied_seq = MAX(last_applied_seq, ?),
           applied_count = applied_count + ?,
           skipped_newer_count = skipped_newer_count + ?,
           skipped_mismatch_count = skipped_mismatch_count + ?
       WHERE device_id = ?`
    )
    .run(
      result.lastAppliedSeq,
      result.applied,
      result.skippedNewer,
      result.skippedMismatch,
      deviceId
    );
}

/**
 * Creates a placeholder row (named after the id) for a device seen only through
 * an unreadable change file, so its error can be recorded. Leaves the mtime
 * unset so the file is retried.
 */
export function ensureDevice(deviceId: string): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO phone_sync_devices (device_id, device_name) VALUES (?, ?)"
    )
    .run(deviceId, deviceId);
}

/**
 * Stores the last decrypt or format error for a device, or clears it with
 * null. Writes nothing when the value is unchanged, so a repeated error does
 * not look like a local database change to the phone sync engine.
 */
export function recordDeviceError(deviceId: string, error: string | null): void {
  getDb()
    .prepare(
      "UPDATE phone_sync_devices SET last_error = ? WHERE device_id = ? AND last_error IS NOT ?"
    )
    .run(error, deviceId, error);
}

/** Highest applied seq per device, written back into the snapshot as acks. */
export function getAcks(): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT device_id as deviceId, last_applied_seq as seq FROM phone_sync_devices")
    .all() as { deviceId: string; seq: number }[];
  return Object.fromEntries(rows.map((r) => [r.deviceId, r.seq]));
}
