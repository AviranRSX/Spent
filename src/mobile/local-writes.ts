import { applyUserCategory, approveCategory } from "@/server/lib/category-decisions";
import { getTransactionContext } from "@/server/db/queries/transactions";
import { nextSeq, pruneAcked, sortForApply } from "@/lib/phone-sync/outbox";
import { changeSkipReason, type PhoneChange } from "@/lib/phone-sync/changes";
import type { OutboxStore } from "./storage/outbox-store";

/** The highest seq ever handed out on this install, kept outside the outbox. */
export interface LastSeqStore {
  get(): Promise<number>;
  set(seq: number): Promise<void>;
}

interface LocalWritesConfig {
  outbox: OutboxStore;
  getAck(): number;
  onChange(): void;
  /**
   * Survives an outbox that is set aside as unreadable. Without it, the next
   * edit would reuse a seq the PC may already have applied, and the PC would
   * drop it as already applied.
   */
  lastSeq?: LastSeqStore;
}

let config: LocalWritesConfig | null = null;
// Loaded once from the store, then kept in step with every save.
let cache: PhoneChange[] | null = null;
// Writes run one at a time so each one sees the previous entry's seq.
let queue: Promise<unknown> = Promise.resolve();

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function configureLocalWrites(next: LocalWritesConfig): void {
  config = next;
  cache = null;
}

async function loadCache(current: LocalWritesConfig): Promise<PhoneChange[]> {
  if (!cache) cache = await current.outbox.load();
  return cache;
}

/** Edits still waiting for the PC to acknowledge them. */
export async function getPendingCount(): Promise<number> {
  if (!config) return 0;
  const changes = await loadCache(config);
  return pruneAcked(changes, config.getAck()).length;
}

type Decision =
  | { ok: true }
  | { ok: false; reason: "not_found" | "category_not_found" };

type Entry = { action: "setCategory"; categoryId: number } | { action: "approve" };

function failure(decision: Extract<Decision, { ok: false }>): Response {
  if (decision.reason === "not_found") return json({ error: "not found" }, 404);
  return json({ error: "categoryId is not a category in this workspace" }, 400);
}

async function record(
  workspaceId: number,
  transactionId: number,
  entry: Entry
): Promise<Response> {
  const current = config;
  if (!current) return json({ error: "Phone storage is not ready" }, 503);

  const context = getTransactionContext(workspaceId, transactionId);
  if (!context) return json({ error: "not found" }, 404);
  // An approve carries the category the user saw, so the PC can skip it when
  // the row was recategorized since.
  const categoryId = entry.action === "setCategory" ? entry.categoryId : context.categoryId;
  if (categoryId == null) {
    return json({ error: "transaction has no category to approve" }, 400);
  }

  const at = new Date().toISOString();
  const decision: Decision =
    entry.action === "setCategory"
      ? applyUserCategory(workspaceId, transactionId, entry.categoryId, at)
      : approveCategory(workspaceId, transactionId, at);
  if (!decision.ok) return failure(decision);

  try {
    const existing = pruneAcked(await loadCache(current), current.getAck());
    const floor = Math.max(current.getAck(), (await current.lastSeq?.get()) ?? 0);
    const seq = nextSeq(existing, floor);
    // Stored before the outbox, so a seq that reached the outbox is never reused.
    await current.lastSeq?.set(seq);
    const change: PhoneChange = {
      seq,
      workspaceId,
      transactionId,
      dedupHash: context.dedupHash,
      action: entry.action,
      categoryId,
      at,
    };
    const updated = [...existing, change];
    await current.outbox.save(updated);
    cache = updated;
  } catch {
    return json({ error: "Could not save the change on this phone" }, 500);
  }

  current.onChange();
  return json({ success: true }, 200);
}

function enqueue(task: () => Promise<Response>): Promise<Response> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export function putTransactionCategory(
  workspaceId: number,
  id: number,
  categoryId: number
): Promise<Response> {
  return enqueue(() => record(workspaceId, id, { action: "setCategory", categoryId }));
}

export function approveTransaction(workspaceId: number, id: number): Promise<Response> {
  return enqueue(() => record(workspaceId, id, { action: "approve" }));
}

/**
 * Replays outbox entries onto a freshly loaded snapshot, oldest first. Does not
 * touch the outbox or notify anyone. Entries that no longer apply, by the same
 * rules the PC uses (changeSkipReason), are skipped but stay in the outbox:
 * the PC skips and acks them too.
 */
export function reapplyOutbox(changes: PhoneChange[]): void {
  for (const change of sortForApply(changes)) {
    try {
      const target = getTransactionContext(change.workspaceId, change.transactionId);
      if (changeSkipReason(target, change)) continue;
      if (change.action === "setCategory") {
        applyUserCategory(
          change.workspaceId,
          change.transactionId,
          change.categoryId,
          change.at
        );
      } else {
        approveCategory(change.workspaceId, change.transactionId, change.at);
      }
    } catch {
      // One bad entry must not block the rest.
    }
  }
}
