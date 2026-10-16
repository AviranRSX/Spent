import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const { passphraseStrength, PHONE_SYNC_MIN_PASSPHRASE_LENGTH } = await import(
  pathToFileURL(
    path.join(process.cwd(), "src", "lib", "phone-sync", "passphrase-strength.ts")
  ).href
);

test("minimum length is 12", () => {
  assert.equal(PHONE_SYNC_MIN_PASSPHRASE_LENGTH, 12);
});

test("anything under the minimum is weak", () => {
  assert.equal(passphraseStrength(""), "weak");
  assert.equal(passphraseStrength("Ab1!xyz"), "weak");
});

test("long but single class is weak, mixed is okay", () => {
  assert.equal(passphraseStrength("abcdefghijkl"), "weak");
  assert.equal(passphraseStrength("abcdefghijk1"), "okay");
});

test("long with several classes is strong", () => {
  assert.equal(passphraseStrength("Correct-Horse-9-Battery"), "strong");
  assert.equal(passphraseStrength("abcdefghijklmnopqrst"), "strong");
});
