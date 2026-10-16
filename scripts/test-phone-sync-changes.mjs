import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      path.extname(specifier) === "" &&
      context.parentURL?.includes("/src/")
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const srcLib = path.join(process.cwd(), "src", "lib", "phone-sync");
const { encodeChangeFile, decodeChangeFile } = await import(
  pathToFileURL(path.join(srcLib, "changes.ts")).href
);
const { nextSeq, pruneAcked, sortForApply } = await import(
  pathToFileURL(path.join(srcLib, "outbox.ts")).href
);
const { PhoneSyncCryptoError } = await import(
  pathToFileURL(path.join(srcLib, "crypto.ts")).href
);

function change(seq, overrides = {}) {
  return {
    seq,
    workspaceId: 1,
    transactionId: 100 + seq,
    dedupHash: `hash-${seq}`,
    action: "setCategory",
    categoryId: 7,
    at: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

function approveChange(seq) {
  const c = change(seq, { action: "approve" });
  delete c.categoryId;
  return c;
}

function file(overrides = {}) {
  return {
    formatVersion: 1,
    deviceId: "device-abc12345",
    deviceName: "Test Phone",
    changes: [change(1), approveChange(2)],
    ...overrides,
  };
}

function encodeRaw(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function assertBad(obj, code = "bad_format") {
  assert.throws(
    () => decodeChangeFile(encodeRaw(obj)),
    (err) => err instanceof PhoneSyncCryptoError && err.code === code,
  );
}

test("change file round trips", () => {
  const f = file();
  const decoded = decodeChangeFile(encodeChangeFile(f));
  assert.deepEqual(decoded, f);
});

test("decode rejects non-JSON bytes", () => {
  assert.throws(
    () => decodeChangeFile(new Uint8Array([1, 2, 3])),
    (err) => err instanceof PhoneSyncCryptoError && err.code === "bad_format",
  );
});

test("decode rejects bad input", () => {
  const noDevice = file();
  delete noDevice.deviceId;
  assertBad(noDevice);
  assertBad(file({ deviceId: "BAD ID" }));
  assertBad(file({ deviceName: "  " }));
  assertBad(file({ deviceName: "x".repeat(65) }));
  assertBad(file({ changes: [change(0)] }));
  assertBad(file({ changes: [change(1.5)] }));
  assertBad(file({ changes: [change(1, { action: "delete" })] }));
  assertBad(file({ changes: [change(1, { categoryId: undefined })] }));
  assertBad(file({ changes: [change(1, { categoryId: 0 })] }));
  assertBad(file({ changes: [change(1, { workspaceId: 0 })] }));
  assertBad(file({ changes: [change(1, { transactionId: -3 })] }));
  assertBad(file({ changes: [change(1, { dedupHash: "" })] }));
  assertBad(file({ changes: [change(1, { at: "not a date" })] }));
  assertBad(file({ changes: [change(1, { at: "2026-01-02" })] }));
  assertBad(file({ changes: [change(1), change(1)] }));
  assertBad(file({ changes: "nope" }));
  assertBad([]);
});

test("decode flags unsupported formatVersion", () => {
  assertBad(file({ formatVersion: 2 }), "unsupported_version");
});

test("approve ignores categoryId and decode drops it", () => {
  const decoded = decodeChangeFile(
    encodeRaw(file({ changes: [change(1, { action: "approve", categoryId: 9 })] })),
  );
  assert.equal("categoryId" in decoded.changes[0], false);
});

test("decode trims deviceName", () => {
  const decoded = decodeChangeFile(encodeRaw(file({ deviceName: "  Pixel  " })));
  assert.equal(decoded.deviceName, "Pixel");
});

test("nextSeq at ack boundaries", () => {
  assert.equal(nextSeq([], 0), 1);
  assert.equal(nextSeq([], 5), 6);
  assert.equal(nextSeq([change(3), change(4)], 0), 5);
  assert.equal(nextSeq([change(3), change(4)], 4), 5);
  assert.equal(nextSeq([change(3)], 9), 10);
});

test("pruneAcked keeps seq greater than ack", () => {
  const list = [change(1), change(2), change(3)];
  assert.deepEqual(pruneAcked(list, 0).map((c) => c.seq), [1, 2, 3]);
  assert.deepEqual(pruneAcked(list, 2).map((c) => c.seq), [3]);
  assert.deepEqual(pruneAcked(list, 3), []);
});

test("sortForApply sorts ascending without mutating", () => {
  const list = [change(3), change(1), change(2)];
  assert.deepEqual(sortForApply(list).map((c) => c.seq), [1, 2, 3]);
  assert.deepEqual(list.map((c) => c.seq), [3, 1, 2]);
});
