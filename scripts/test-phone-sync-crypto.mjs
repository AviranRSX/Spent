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
const { encryptPayload, decryptPayload, PhoneSyncCryptoError } = await import(
  pathToFileURL(path.join(srcLib, "crypto.ts")).href
);
const { parseChangeFileName, changeFileName } = await import(
  pathToFileURL(path.join(srcLib, "format.ts")).href
);

const PASS = "correct horse battery staple";

function randomBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  }
  return out;
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof PhoneSyncCryptoError);
    assert.equal(err.code, code);
    return true;
  });
}

test("round trip, header layout, fresh salt and iv", async () => {
  const plain = randomBytes(200 * 1024);
  const a = await encryptPayload(plain, PASS);
  const b = await encryptPayload(plain, PASS);
  assert.equal(new TextDecoder().decode(a.subarray(0, 4)), "SPNT");
  assert.equal(a[4], 1);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a.subarray(5, 33), b.subarray(5, 33));
  assert.deepEqual(await decryptPayload(a, PASS), plain);
});

test("wrong passphrase rejects with bad_passphrase", async () => {
  const blob = await encryptPayload(new Uint8Array([1, 2, 3]), PASS);
  await rejectsWith(decryptPayload(blob, "wrong"), "bad_passphrase");
});

test("tampered header rejects with bad_passphrase", async () => {
  const blob = await encryptPayload(new Uint8Array([1, 2, 3]), PASS);
  const tampered = blob.slice();
  tampered[6] ^= 1;
  await rejectsWith(decryptPayload(tampered, PASS), "bad_passphrase");
});

test("truncated and wrong-magic files reject with bad_format", async () => {
  const blob = await encryptPayload(new Uint8Array([1, 2, 3]), PASS);
  await rejectsWith(decryptPayload(blob.slice(0, 20), PASS), "bad_format");
  const badMagic = blob.slice();
  badMagic[0] = 0x58;
  await rejectsWith(decryptPayload(badMagic, PASS), "bad_format");
});

test("future version rejects with unsupported_version", async () => {
  const blob = await encryptPayload(new Uint8Array([1, 2, 3]), PASS);
  const future = blob.slice();
  future[4] = 2;
  await rejectsWith(decryptPayload(future, PASS), "unsupported_version");
});

test("NFD and NFC forms of a passphrase derive the same key", async () => {
  const nfd = "café secret";
  const nfc = "café secret";
  assert.notEqual(nfd, nfc);
  const blob = await encryptPayload(new Uint8Array([9, 8, 7]), nfd);
  assert.deepEqual(await decryptPayload(blob, nfc), new Uint8Array([9, 8, 7]));
});

test("tampered ciphertext rejects with bad_passphrase", async () => {
  const blob = await encryptPayload(new Uint8Array([1, 2, 3]), PASS);
  const tampered = blob.slice();
  tampered[40] ^= 1;
  await rejectsWith(decryptPayload(tampered, PASS), "bad_passphrase");
});

test("change file names", () => {
  assert.equal(changeFileName("ab12cd34ef"), "changes-ab12cd34ef.spent.enc");
  assert.equal(parseChangeFileName("changes-ab12cd34ef.spent.enc"), "ab12cd34ef");
  assert.equal(parseChangeFileName("changes-x.spent.enc.tmp"), null);
  assert.equal(parseChangeFileName("snapshot.spent.enc"), null);
  assert.equal(parseChangeFileName("changes-../x.spent.enc"), null);
});
