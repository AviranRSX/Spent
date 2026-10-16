import "server-only";

import { getDb } from "@/server/db";
import { getTransactionContext } from "@/server/db/queries/transactions";
import {
  applyUserCategory,
  approveCategory,
} from "@/server/lib/category-decisions";
import { sortForApply } from "@/lib/phone-sync/outbox";
import type { ChangeFile } from "@/lib/phone-sync/changes";
import { getDevice, recordApply, upsertDevice } from "./devices";

export interface ApplyChangeFileResult {
  applied: number;
  skippedNewer: number;
  skippedMismatch: number;
  alreadyApplied: number;
}

/**
 * Applies a phone change file as user corrections. Every entry ends up counted
 * as applied, skippedNewer, skippedMismatch or alreadyApplied, and the device
 * ack advances past all of them so a skipped edit is never retried forever.
 * All writes happen in one transaction: if anything throws, nothing from this
 * file is applied and the error propagates to the caller.
 */
export function applyChangeFile(
  file: ChangeFile,
  fileMtimeMs: number
): ApplyChangeFileResult {
  const db = getDb();
  const run = db.transaction((): ApplyChangeFileResult => {
    upsertDevice(file.deviceId, file.deviceName, fileMtimeMs);
    const storedSeq = getDevice(file.deviceId)?.lastAppliedSeq ?? 0;

    const result: ApplyChangeFileResult = {
      applied: 0,
      skippedNewer: 0,
      skippedMismatch: 0,
      alreadyApplied: 0,
    };
    let maxSeq = storedSeq;

    for (const entry of sortForApply(file.changes)) {
      if (entry.seq <= storedSeq) {
        result.alreadyApplied++;
        continue;
      }
      maxSeq = Math.max(maxSeq, entry.seq);

      const ctx = getTransactionContext(entry.workspaceId, entry.transactionId);
      if (!ctx || ctx.dedupHash !== entry.dedupHash) {
        result.skippedMismatch++;
        continue;
      }
      if (ctx.categoryDecidedAt != null && ctx.categoryDecidedAt > entry.at) {
        result.skippedNewer++;
        continue;
      }

      const outcome =
        entry.action === "setCategory"
          ? entry.categoryId == null
            ? ({ ok: false } as const)
            : applyUserCategory(
                entry.workspaceId,
                entry.transactionId,
                entry.categoryId,
                entry.at
              )
          : approveCategory(entry.workspaceId, entry.transactionId, entry.at);
      if (outcome.ok) result.applied++;
      else result.skippedMismatch++;
    }

    recordApply(file.deviceId, {
      lastAppliedSeq: maxSeq,
      applied: result.applied,
      skippedNewer: result.skippedNewer,
      skippedMismatch: result.skippedMismatch,
    });
    return result;
  });
  return run();
}
