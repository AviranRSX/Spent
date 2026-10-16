import type { PhoneChange } from "./changes";

export function nextSeq(changes: PhoneChange[], ack: number): number {
  let max = ack;
  for (const change of changes) {
    if (change.seq > max) max = change.seq;
  }
  return max + 1;
}

export function pruneAcked(changes: PhoneChange[], ack: number): PhoneChange[] {
  return changes.filter((change) => change.seq > ack);
}

export function sortForApply(changes: PhoneChange[]): PhoneChange[] {
  return [...changes].sort((a, b) => a.seq - b.seq);
}
