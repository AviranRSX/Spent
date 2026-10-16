import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const { createLocalFiles } = await import(
  pathToFileURL(path.join(process.cwd(), "src", "mobile", "storage", "local-files.ts")).href
);

/** In-memory stand-in for the Filesystem plugin (base64 data, like native). */
function fakeFs() {
  const files = new Map();
  const failures = { renameOnce: false };
  const missing = (p) => Object.assign(new Error(`File does not exist: ${p}`), { code: "OS-PLUG-FILE-0008" });
  const fs = {
    async stat({ path: p }) {
      if (!files.has(p)) throw missing(p);
      return { type: "file", size: files.get(p).length };
    },
    async readFile({ path: p }) {
      if (!files.has(p)) throw missing(p);
      return { data: files.get(p) };
    },
    async writeFile({ path: p, data }) {
      files.set(p, data);
      return { uri: p };
    },
    async deleteFile({ path: p }) {
      if (!files.has(p)) throw missing(p);
      files.delete(p);
    },
    async rename({ from, to }) {
      if (failures.renameOnce) {
        failures.renameOnce = false;
        throw new Error("app killed");
      }
      if (!files.has(from)) throw missing(from);
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
  return { fs, files, failures };
}

function localFiles(fake) {
  return createLocalFiles(async () => ({ fs: fake.fs, directory: "DATA" }));
}

test("blobs round-trip and the temp file does not linger", async () => {
  const fake = fakeFs();
  const local = localFiles(fake);

  assert.equal(await local.readOutboxBlob(), null);
  await local.writeOutboxBlob(new Uint8Array([1, 2, 3]));
  await local.writeOutboxBlob(new Uint8Array([4, 5]));

  assert.deepEqual([...(await local.readOutboxBlob())], [4, 5]);
  assert.deepEqual([...fake.files.keys()], ["outbox.bin"]);
});

test("a write killed between delete and rename is recovered from the temp file", async () => {
  const fake = fakeFs();
  const local = localFiles(fake);
  await local.writeOutboxBlob(new Uint8Array([1]));

  fake.failures.renameOnce = true;
  await assert.rejects(local.writeOutboxBlob(new Uint8Array([7, 8, 9])), /app killed/);
  assert.deepEqual([...fake.files.keys()], ["outbox.bin.tmp"]);

  assert.deepEqual([...(await local.readOutboxBlob())], [7, 8, 9]);
  assert.deepEqual([...fake.files.keys()], ["outbox.bin"], "temp file promoted");

  await local.writeOutboxBlob(new Uint8Array([10]));
  assert.deepEqual([...(await local.readOutboxBlob())], [10]);
});

test("the real file wins over a leftover temp file", async () => {
  const fake = fakeFs();
  const local = localFiles(fake);
  await local.writeSnapshotBlob(new Uint8Array([1, 1]));
  fake.files.set("snapshot.spent.enc.tmp", Buffer.from([2, 2]).toString("base64"));

  assert.deepEqual([...(await local.readSnapshotBlob())], [1, 1]);
});

test("wipeLocalData removes blobs and temp files", async () => {
  const fake = fakeFs();
  const local = localFiles(fake);
  await local.writeSnapshotBlob(new Uint8Array([1]));
  await local.writeOutboxBlob(new Uint8Array([2]));
  fake.files.set("outbox.bin.tmp", "AA==");

  await local.wipeLocalData();

  assert.equal(fake.files.size, 0);
  assert.equal(await local.readOutboxBlob(), null);
  assert.equal(await local.readSnapshotBlob(), null);
});
