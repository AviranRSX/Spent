import type { PhoneChange } from "@/lib/phone-sync/changes";

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
