import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// The plugin's web build keeps values in localStorage. Methods are
// non-enumerable so Object.keys(localStorage) lists only stored keys, as in a browser.
const store = {};
for (const [name, fn] of Object.entries({
  getItem: (key) => (Object.hasOwn(store, key) ? store[key] : null),
  setItem: (key, value) => {
    store[key] = String(value);
  },
  removeItem: (key) => {
    delete store[key];
  },
})) {
  Object.defineProperty(store, name, { value: fn, enumerable: false });
}
globalThis.localStorage = store;

const { getSecret, setSecret, clearAll } = await import(
  pathToFileURL(path.join(process.cwd(), "src", "mobile", "storage", "secure-store.ts")).href
);

/** Fails instead of hanging when a call never settles. */
function settles(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} never settled`)), 2000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Capacitor plugins are proxies that answer every property, `then` included,
// so resolving a promise with one never settles. Boot reads a secret first,
// so a hang here leaves the phone on the splash screen.
test("secrets settle through the real Capacitor plugin proxy", async () => {
  assert.equal(await settles(getSecret("deviceId"), "getSecret"), null);
  await settles(setSecret("deviceId", "device-1"), "setSecret");
  assert.equal(await settles(getSecret("deviceId"), "getSecret"), "device-1");
  await settles(clearAll(), "clearAll");
  assert.equal(await settles(getSecret("deviceId"), "getSecret"), null);
});
