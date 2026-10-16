# Android Companion App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android app that shows the same Spent UI (Home, Budget, Transactions, Credit card, Trips) from an encrypted database snapshot synced through a Google Drive folder, and lets the household change categories offline, with those changes flowing back to the PC.

**Architecture:**
- **PC:** the Next.js server writes a stripped, gzipped, AES-GCM encrypted snapshot of the database into a Google Drive for desktop folder. It applies per-phone encrypted change files from the same folder.
- **Phone:** a Capacitor Android app built from the same codebase as a Next.js static export. Its API calls are answered in-process by the same query code, running on sql.js over the decrypted snapshot.

**Tech Stack:**
- Next.js 16 (static export for mobile), React 19, TanStack Query, next-intl.
- better-sqlite3 on the PC, sql.js on the phone.
- WebCrypto (PBKDF2, AES-256-GCM) and CompressionStream (gzip). Both platforms use the same code.
- Capacitor (Android), Google Drive REST API v3.

**Spec:** `docs/superpowers/specs/2026-10-16-android-companion-design.md`

## Global Constraints

- No em dashes anywhere (code, comments, docs, commit messages, UI strings).
- Every new user-facing string goes in both `src/i18n/messages/en.json` and `src/i18n/messages/he.json`.
- Every new file under `src/server/` starts with `import "server-only"` (the mobile build aliases it to an empty module).
- **Tests use synthetic data only.**
  - No test reads `/data/` or `/transactions/`.
  - No real Google client IDs, keystores, or `local.properties` are committed.
  - New `scripts/test-phone-sync-*.mjs` files need a `!scripts/test-phone-sync-*.mjs` exception in `.gitignore`.
- **Crypto and format constants:**
  - AES-256-GCM.
  - PBKDF2-HMAC-SHA256 at 600,000 iterations.
  - 16-byte random salt per file, 12-byte IV.
  - Magic bytes `SPNT`, format version byte `1`.
  - The header is authenticated as additional data.
- **File names in the Drive folder:**
  - `snapshot.spent.enc`, written via `snapshot.spent.enc.tmp` and then a rename.
  - `changes-<deviceId>.spent.enc`.
- **Sync timing:**
  - Sync on open/start and on the Sync button.
  - After a change, wait 30 s (`DEBOUNCE_MS = 30_000`), restarting on each further change, capped at 2 minutes from the first pending change (`MAX_WAIT_MS = 120_000`).
  - The PC polls change files every 2 minutes (`CHANGE_POLL_MS = 120_000`).
  - No background sync on the phone and no polling while the phone is open.
- **Phone write scope:** only `setCategory` and `approve`. All other write controls are hidden (not disabled) on the phone.
- **Phone Home** hides:
  - Budget pace (`budget-pace-card.tsx`);
  - Recent activity (`recent-transactions-card.tsx`);
  - the Import button, the scraper Sync button, and the AI Categorize button;
  - the AI-not-connected banner.
- **Phone sidebar:** same nav without Settings and without the GitHub star link. The workspace switcher has no "New workspace" or "Manage workspaces" entries. The footer has the sync block.
- **Snapshot strips:**
  - all `bank_credentials` rows;
  - `settings` rows whose key ends in `_encrypted`, `_iv`, or `_auth_tag`, or starts with `phone_sync_`.
  The PC's `data/.encryption-key` is never read into the snapshot.
- **Conflict rule:** a phone entry is skipped only when the PC row's `category_decided_at` is later than the entry's `at`. Skips and mismatches are acked and counted per device.
- **Timestamps:** `category_decided_at` and change `at` values are ISO 8601 UTC strings from `new Date().toISOString()`, compared as strings.
- **Desktop build safety:** the mobile build uses `distDir: "out-mobile"` and must never write to `.next/`, because the always-on service runs from `.next/`.
- **Next.js:** read the relevant guide in `node_modules/next/dist/docs/` before changing Next.js config or routes:
  - `01-app/02-guides/static-exports.md`
  - `01-app/03-api-reference/05-config/01-next-config-js/pageExtensions.md`
  - `.../turbopack.md` (`resolveAlias`)

## Review Focus

1. **The Drive folder is unavailable on the PC.** Examples: `H:` is not mounted, Drive for desktop is closed, or the path was deleted. Sync must report `folder_unavailable` in status, write nothing anywhere else, and keep the server running. Test owned by Task 9.
2. **A partial or corrupt snapshot reaches the phone.** Drive can serve a half-uploaded file, or a `.tmp` file could be visible. The phone keeps its previous snapshot and outbox untouched and shows an error. Decrypt failures never wipe local data. The phone and the PC only ever read the exact names `snapshot.spent.enc` and `changes-*.spent.enc`. Tests owned by Tasks 4, 9 and 14.
3. **The passphrase changed on the PC while a phone has pending edits.** The phone shows "Passphrase is wrong", prompts for the new one, keeps the outbox, re-encrypts it locally, and uploads it. Test owned by Task 14.
4. **A phone edit targets something that no longer exists.** This covers a deleted transaction, a dedup hash mismatch after a database reset, a deleted category, or a category from another workspace. The edit is acked and counted as a mismatch, never applied to the wrong row. Test owned by Task 8.
5. **The active workspace on the phone disappears from a new snapshot.** The phone falls back to the first workspace, like the desktop switcher, and does not show an empty or crashed screen. Test owned by Task 14.

---

## File Structure

```
src/lib/phone-sync/                 Shared, pure, node-testable (PC and phone)
  format.ts                         constants, file names, header encode/decode
  crypto.ts                         encryptPayload / decryptPayload (WebCrypto + gzip)
  changes.ts                        PhoneChange / ChangeFile types, encode/decode/validate
  outbox.ts                         pruneAcked, nextSeq, reapply ordering
  scheduler.ts                      createSyncScheduler (debounce, cap, single flight)
  schema-version.ts                 APP_SCHEMA_VERSION, MIN_SNAPSHOT_SCHEMA_VERSION
src/lib/platform.ts                 IS_MOBILE build-time constant
src/lib/api-transport.ts            setApiTransport / apiFetch
src/server/db/migrations/028_phone_sync.sql
src/server/lib/category-decisions.ts   applyUserCategory / approveCategory (shared by route, phone apply, mobile)
src/server/api-handlers/            framework-free bodies of in-scope GET routes
src/server/phone-sync/
  snapshot.ts                       buildSnapshotDbBytes
  apply-changes.ts                  applyChangeFile
  devices.ts                        phone_sync_devices queries
  settings.ts                       phone sync settings + encrypted passphrase
  folder.ts                         folder checks, atomic write, change file listing
  engine.ts                         runPhoneSync, status, change watcher, poller
src/app/api/phone-sync/             status, run, settings routes
src/components/phone-sync/          SyncStatusBlock (shared UI), desktop hook
src/app/settings/phone-sync/page.tsx + src/components/settings/phone-sync-section.tsx
src/mobile/
  empty.ts, stubs/*.ts              aliases for the mobile build
  db/sqljs-adapter.ts               better-sqlite3 subset over sql.js
  db/sqljs-db.ts                    getDb / loadDatabase / exportDatabase (alias target)
  router.ts                         handleMobileRequest
  local-writes.ts                   mobile PUT/PATCH transaction handlers + outbox append
  storage/                          secure store, local encrypted files, outbox store
  drive/drive-client.ts             Drive REST v3
  drive/google-auth.ts              getAccessToken via sign-in plugin
  sync/mobile-sync-engine.ts        runMobileSync + status store
  boot/mobile-root.tsx              boot, locale, onboarding gate
  onboarding/*.tsx                  sign in, pick folder, passphrase, device name
src/app/*.mobile.tsx                mobile route entries (layout + 5 pages + onboarding)
capacitor.config.ts, android/       Capacitor shell
scripts/mobile/build.mjs            mobile build pipeline
scripts/phone-sync-test-helpers.mjs synthetic DB + src alias hooks for tests
scripts/test-phone-sync-*.mjs       tests
docs/phone-app.md                   install guide
```

---

### Task 1: sql.js adapter with the better-sqlite3 subset

**Files:**
- Create: `src/mobile/db/sqljs-adapter.ts`
- Create: `scripts/phone-sync-test-helpers.mjs`
- Create: `scripts/test-phone-sync-sqljs.mjs`
- Modify: `package.json` (add `sql.js` dependency pinned to an exact version, `@types/sql.js` dev, and the script `"test:phone-sync": "node --conditions react-server --experimental-transform-types --test scripts/test-phone-sync-*.mjs"`)
- Modify: `.gitignore` (add `!scripts/test-phone-sync-*.mjs` and `/out-mobile/`)

**Interfaces:**
- Produces:
  - `class SqlJsDatabase` with these methods:
    - `prepare(sql: string): SqlJsStatement`
    - `transaction<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R`
    - `exec(sql: string): void`
    - `pragma(source: string): unknown[]`
    - `export(): Uint8Array`
    - `close(): void`
  - `SqlJsStatement` with:
    - `get(...params): Record<string, unknown> | undefined`
    - `all(...params): Record<string, unknown>[]`
    - `run(...params): { changes: number; lastInsertRowid: number }`
  - `createSqlJsDatabase(bytes: Uint8Array): Promise<SqlJsDatabase>`. Loads the WASM itself, via `locateFile` in the browser and the package path in Node.
- Produces (test helper), in `scripts/phone-sync-test-helpers.mjs`:
  - `registerSrcAliases()`: the same `@/` resolve hooks as `scripts/test-trips-db.mjs`.
  - `createTempDataDir(prefix): string`: sets `SPENT_DATA_DIR` under `.tmp-tests/`.
  - `seedSyntheticWorkspace(db): { workspaceId, categoryIds, transactionIds }`. Builds from `scripts/docs-seed/fake-data.mjs`. It covers bank and card rows, a pending row, a Transfers row, an AI-categorized row with `needs_review = 1`, and a confirmed trip.

- [ ] **Step 1: Write the failing tests** in `scripts/test-phone-sync-sqljs.mjs`:
  - `positional params`: `prepare("SELECT ? AS a, ? AS b").get(1, "x")` deep-equals `{ a: 1, b: "x" }`.
  - `named params`: `prepare("SELECT @a AS a").get({ a: 5 })` deep-equals `{ a: 5 }`.
  - `array spread params`: `.all(...[1, 2])` works the same as positional.
  - `run reports changes`: an insert of two rows via `run` returns `changes` of `1` each time, and `lastInsertRowid` increments.
  - `transaction rolls back on throw`: inside `transaction(() => { insert; throw })()`, the insert is gone and the error propagates.
  - `pragma`: `pragma("foreign_keys")` returns an array.
  - `parity with better-sqlite3`: build a DB with `getDb()` (migrations) and `seedSyntheticWorkspace`. Then `VACUUM INTO` a temp file, load its bytes with `createSqlJsDatabase`, and run 5 representative SELECTs from `src/server/db/queries/transactions.ts`, both ways. Results deep-equal.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the adapter.
  - Statements are prepared and freed per call. Named params map `{a}` to `{"@a": ...}`.
  - `transaction` uses `BEGIN` / `COMMIT` / `ROLLBACK` and supports nesting by using SAVEPOINT when already in a transaction.
  - Integers come back as JS numbers.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add sql.js adapter with better-sqlite3 subset for the phone app`.

### Task 2: Extract in-scope GET route bodies into shared handlers

**Files:**
- Create one file per resource in `src/server/api-handlers/`: `home.ts`, `summary.ts`, `transactions.ts`, `categories.ts`, `trips.ts`, `workspaces.ts`, `integrations.ts`.
- Modify the matching `src/app/api/**/route.ts` GET handlers, so each becomes a thin wrapper: parse the request, call the handler, return `NextResponse.json(result.body, { status: result.status })`.
- Create: `scripts/test-phone-sync-handlers.mjs`

**Interfaces:**
- Produces:
  - `type HandlerResult<T> = { status: number; body: T | { error: string } }`
  - `type HandlerContext = { workspaceId: number; query: URLSearchParams; params: Record<string, string>; now: Date; nextScheduledSync: string | null }`
- Each handler takes `(ctx: HandlerContext)` and returns a `HandlerResult`:
  - `getHomeHandler`
  - `getSummaryHandler`
  - `getTransactionsHandler`
  - `getTransactionsSummaryHandler`
  - `getAccountNumbersHandler`
  - `getCategoriesHandler`
  - `getCategoryDetailHandler`
  - `getTripsHandler`
  - `getTripDetailHandler`
  - `getNeedsTripHandler`
  - `getTripMembershipsHandler`
  - `listWorkspacesHandler`
  - `listIntegrationsHandler`
  - `getBudgetsHandler`, if the Budget screen calls `/api/budgets` GET.
- `getHomeHandler` reads `ctx.nextScheduledSync` instead of importing `@/server/sync/scheduler`. The desktop route passes `getNextRunAt()`. The phone passes `null`.
- Endpoint list: exactly the GET endpoints named in the spec's "What the phone shows" plus the sidebar's `/api/trips` and `/api/workspaces`. Confirm by grepping `src/lib/api.ts` callers in `src/components/{home,dashboard,transactions,credit-card,trips,layout}`.

- [ ] **Step 1: Write failing tests:**
  - `home handler matches route output`: the seeded synthetic DB, `getHomeHandler({ workspaceId: ws, query: new URLSearchParams("month=2026-03"), params: {}, now: fixedNow, nextScheduledSync: null })`. Status `200`, and the body has the keys `kpis`, `budgetPace`, `categoryBreakdown`, `historicalTrend`, `recentTransactions`, `spendingStats`, `needsAttention`, `bankHealth`, and `nextScheduledSync: null`.
  - `home handler rejects bad month`: `month=2026-13` gives status `400`.
  - `handlers run on sql.js`: for every handler above, the body from the better-sqlite3 DB deep-equals the body from `createSqlJsDatabase` over the same bytes. Swap by setting `globalThis._db` to the adapter. This is the spec's parity guard.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Move each GET body verbatim into its handler. Routes keep identical responses.
- [ ] **Step 4:** Run `npm run test:phone-sync && npm run test:logic && npm run lint`. Expected: all PASS.
- [ ] **Step 5:** Run `npm run dev` and open `/`, `/budget`, `/transactions`, `/credit-card`, `/trips` with a fake-data workspace. They render as before.
- [ ] **Step 6:** Commit: `refactor: move in-scope GET route bodies into shared api handlers`.

### Task 3: Mobile build target renders Home from a synthetic snapshot (feasibility gate)

This is the spec's spike. If the gate in Step 6 fails, **stop and report to the user**. Explain the failure and propose the spec's fallback (a Vite entry with shims for `next/link`, `next/navigation`, and next-intl). Do not start Task 11 or later until the user picks. Tasks 4 to 10 do not depend on this outcome.

**Files:**
- Create: `src/lib/platform.ts` (`export const IS_MOBILE = process.env.NEXT_PUBLIC_SPENT_TARGET === "mobile"`)
- Create: `src/lib/api-transport.ts`
- Modify: `src/lib/api.ts`. `fetchJSON` and every raw `fetch` call go through `apiFetch`.
- Modify: `next.config.ts`. When `process.env.SPENT_TARGET === "mobile"` it sets:
  - `output: "export"`;
  - `distDir: "out-mobile"`;
  - `pageExtensions: ["mobile.tsx", "mobile.ts"]`;
  - `images: { unoptimized: true }`;
  - no `headers()`;
  - `turbopack.resolveAlias` for: `server-only` to `src/mobile/empty.ts`, `@/server/db/index` to `src/mobile/db/sqljs-db.ts`, `@/server/sync/scheduler` to `src/mobile/stubs/scheduler.ts`, `@/server/lib/encryption` to `src/mobile/stubs/encryption.ts`, and any further Node-only module the build reports (for example `crypto` used by `src/server/lib/dedup.ts`, stubbed to throw if called). Record the final alias list in a comment.
- Create:
  - `src/mobile/empty.ts`
  - `src/mobile/stubs/scheduler.ts`
  - `src/mobile/stubs/encryption.ts`
  - `src/mobile/db/sqljs-db.ts`
  - `src/mobile/router.ts`
- Create: `src/app/layout.mobile.tsx`. Same providers as `src/app/layout.tsx`, but the locale comes from the client (Task 14 fills it in). For now it uses `defaultLocale` and bundled `en` and `he` messages.
- Create: `src/app/page.mobile.tsx`. Renders `AppShell` and `HomePage` with `dataSourceMode="xlsx"`.
- Create: `scripts/mobile/build.mjs`. Sets the env vars, runs `next build`, and copies `node_modules/sql.js/dist/sql-wasm.wasm` into `out-mobile/`.
- Modify: `package.json`, adding `"mobile:build": "node scripts/mobile/build.mjs"`.

**Interfaces:**
- Produces:
  - `type ApiTransport = (url: string, init?: RequestInit) => Promise<Response>`
  - `setApiTransport(t: ApiTransport): void`
  - `apiFetch(url, init): Promise<Response>`, which defaults to `fetch`.
- Produces:
  - `getDb(): SqlJsDatabase`, which throws `"Database not loaded"` before load.
  - `loadDatabase(bytes: Uint8Array): Promise<void>`
  - `exportDatabase(): Uint8Array`
  - `isDatabaseLoaded(): boolean`
- Produces: `handleMobileRequest(url: string, init?: RequestInit): Promise<Response>`.
  - It reads `x-workspace-id` from `init.headers`. If missing, it falls back to the lowest workspace id, the same rule as `getWorkspaceIdFromRequest`.
  - It maps the Task 2 GET handlers by path pattern.
  - `/api/activity` returns the idle `ActivitySnapshot`.
  - Unknown paths return `404` with `{ error: "Not available on the phone: <METHOD> <path>" }`.

- [ ] **Step 1: Write a failing test** in `scripts/test-phone-sync-router.mjs`:
  - `routes home`: with a sql.js DB loaded from the synthetic bytes, `handleMobileRequest("/api/home?month=2026-03", { headers: { "x-workspace-id": String(ws) } })` gives a `200` response whose JSON has `kpis`.
  - `unknown path is 404 with clear message`: `POST /api/imports/commit` gives `404`, and the body error contains `Not available on the phone`.
  - `missing workspace header falls back to lowest id`.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement the transport, platform constant, router, `sqljs-db`, and stubs.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Run `npm run mobile:build`. Expected:
  - The build succeeds.
  - `out-mobile/index.html` exists.
  - `.next/` is unchanged (compare its mtime before and after).
- [ ] **Step 6: Gate.** Add a temporary dev-only boot in `page.mobile.tsx` that fetches `/synthetic.db` (generated into `out-mobile/` by a one-off script from `seedSyntheticWorkspace`, never committed), calls `loadDatabase`, and calls `setApiTransport(handleMobileRequest)`. Serve `out-mobile/` with `npx serve out-mobile` and open it at 390 px width. Expected:
  - The Home page renders KPIs and charts from synthetic data.
  - The console shows no errors.
  - Removing the temporary boot afterwards is part of this step.
- [ ] **Step 7:** Run `npm run build` (desktop) and `npm run test:logic`. Expected: PASS, and the desktop app is unchanged.
- [ ] **Step 8:** Commit: `feat: add mobile static export target with in-process api router`.

### Task 4: Shared encryption and file format

**Files:**
- Create: `src/lib/phone-sync/format.ts`
- Create: `src/lib/phone-sync/crypto.ts`
- Test: `scripts/test-phone-sync-crypto.mjs`

**Interfaces:**
- Produces, in `format.ts`:
  - `FORMAT_MAGIC = "SPNT"`
  - `FORMAT_VERSION = 1`
  - `PBKDF2_ITERATIONS = 600_000`
  - `SALT_BYTES = 16`
  - `IV_BYTES = 12`
  - `SNAPSHOT_FILE = "snapshot.spent.enc"`
  - `SNAPSHOT_TMP_FILE = "snapshot.spent.enc.tmp"`
  - `changeFileName(deviceId: string): string`, which returns `changes-${deviceId}.spent.enc`
  - `parseChangeFileName(name: string): string | null`, which returns the deviceId only for an exact match of `^changes-([a-z0-9-]{8,64})\.spent\.enc$`
- Produces, in `crypto.ts`:
  - `encryptPayload(plain: Uint8Array, passphrase: string): Promise<Uint8Array>`. Gzips, then encrypts.
  - `decryptPayload(blob: Uint8Array, passphrase: string): Promise<Uint8Array>`. Decrypts, then gunzips.
  - `class PhoneSyncCryptoError extends Error { code: "bad_passphrase" | "bad_format" | "unsupported_version" }`
  - It uses only `globalThis.crypto.subtle` and `CompressionStream` / `DecompressionStream`, so the same file runs in Node 22 and the Android WebView.

- [ ] **Step 1: Write failing tests:**
  - `round trip`: random 200 KB bytes, then `encryptPayload`, then `decryptPayload` with the same passphrase. The result deep-equals the input.
  - `header layout`: the first 4 bytes decode to `"SPNT"` and byte 4 equals `1`.
  - `fresh salt and iv`: two encryptions of the same input differ.
  - `wrong passphrase`: rejects with `code === "bad_passphrase"`.
  - `tampered header`: flipping one salt byte rejects (`bad_passphrase`, because the header is AAD).
  - `truncated file`: the first 20 bytes reject with `bad_format`.
  - `future version`: version byte `2` rejects with `unsupported_version`.
  - `parseChangeFileName`: accepts `changes-ab12cd34ef.spent.enc`. Rejects `changes-x.spent.enc.tmp`, `snapshot.spent.enc`, and `changes-../x.spent.enc`.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Key: `importKey("raw", passphrase)` then `deriveKey` with PBKDF2 SHA-256 at `PBKDF2_ITERATIONS` iterations to AES-GCM 256.
  - AAD is the header bytes (magic + version + salt + iv).
  - A GCM `OperationError` maps to `bad_passphrase`.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add shared phone sync encryption and file format`.

### Task 5: Change files, outbox rules, and the sync scheduler

**Files:**
- Create: `src/lib/phone-sync/changes.ts`
- Create: `src/lib/phone-sync/outbox.ts`
- Create: `src/lib/phone-sync/scheduler.ts`
- Test: `scripts/test-phone-sync-changes.mjs`
- Test: `scripts/test-phone-sync-scheduler.mjs`

**Interfaces:**
- Produces, in `changes.ts`:
  - The change type:
    ```ts
    type PhoneChange = {
      seq: number;
      workspaceId: number;
      transactionId: number;
      dedupHash: string;
      action: "setCategory" | "approve";
      categoryId?: number;
      at: string;
    }
    ```
  - The file type:
    ```ts
    type ChangeFile = {
      formatVersion: 1;
      deviceId: string;
      deviceName: string;
      changes: PhoneChange[];
    }
    ```
  - `encodeChangeFile(f: ChangeFile): Uint8Array` (UTF-8 JSON)
  - `decodeChangeFile(bytes: Uint8Array): ChangeFile`. Validates every field and throws `PhoneSyncCryptoError("bad_format")` on anything invalid. A `setCategory` without `categoryId` is invalid.
- Produces, in `outbox.ts`:
  - `nextSeq(changes: PhoneChange[], ack: number): number`, which returns max(seq, ack) + 1.
  - `pruneAcked(changes, ack): PhoneChange[]`, which keeps entries with `seq > ack`.
  - `sortForApply(changes): PhoneChange[]`, ascending by `seq`.
- Produces, in `scheduler.ts`:
  - `DEBOUNCE_MS = 30_000`, `MAX_WAIT_MS = 120_000`.
  - `createSyncScheduler(opts: { run: () => Promise<void>; delayMs?: number; maxWaitMs?: number; clock?: { now(): number; setTimeout; clearTimeout } })`.
  - It returns `{ notifyChange(): void; syncNow(): Promise<void>; cancel(): void; isRunning(): boolean }`.

- [ ] **Step 1: Write failing tests** with a fake clock:
  - `debounce`: `notifyChange` at t=0 runs once at t=30000.
  - `restart`: changes at t=0 and t=20000 run once at t=50000.
  - `cap`: changes every 10 s starting at t=0 still run at t=120000.
  - `single flight`: `syncNow` during a run resolves after exactly one follow-up run. Three triggers during a run still produce only one follow-up.
  - `cancel`: a pending timer never fires.
  - `decode rejects bad input`: a missing `deviceId`, `seq` of `0`, or an unknown `action`.
  - `pruneAcked` and `nextSeq` at ack boundaries (ack = 0, ack = max seq).
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add phone change file format, outbox rules, and sync scheduler`.

### Task 6: `category_decided_at`, the devices table, and the shared category decision service

**Files:**
- Create: `src/server/db/migrations/028_phone_sync.sql`. It adds:
  - `ALTER TABLE transactions ADD COLUMN category_decided_at TEXT`.
  - `CREATE TABLE phone_sync_devices` with these columns:
    - `device_id TEXT PRIMARY KEY`
    - `device_name TEXT NOT NULL`
    - `last_applied_seq INTEGER NOT NULL DEFAULT 0`
    - `applied_count INTEGER NOT NULL DEFAULT 0`
    - `skipped_newer_count INTEGER NOT NULL DEFAULT 0`
    - `skipped_mismatch_count INTEGER NOT NULL DEFAULT 0`
    - `last_file_mtime_ms INTEGER`
    - `last_seen_at TEXT`
    - `last_error TEXT` (the last decrypt or format error for this device's change file, cleared on success)

  The devices table is global like AI settings, because one device syncs all workspaces. Add a SQL comment saying so.
- Create: `src/lib/phone-sync/schema-version.ts` with:
  - `APP_SCHEMA_VERSION = "028_phone_sync.sql"`
  - `MIN_SNAPSHOT_SCHEMA_VERSION = "028_phone_sync.sql"`
- Create: `src/server/lib/category-decisions.ts`
- Modify: `src/server/db/queries/transactions.ts`. Add `setCategoryDecidedAt(workspaceId, id, at: string)`, and add `dedupHash` and `categoryDecidedAt` to what `getTransactionContext` returns.
- Modify: `src/app/api/transactions/[id]/route.ts`. PUT and the PATCH approve branch call the service and keep their responses.
- Create: `src/server/phone-sync/devices.ts`
- Test: `scripts/test-phone-sync-decisions.mjs`

**Interfaces:**
- Produces:
  ```ts
  applyUserCategory(
    workspaceId: number,
    transactionId: number,
    categoryId: number,
    decidedAt?: string,
  ): { ok: true } | { ok: false; reason: "not_found" | "category_not_found" }
  ```
  - Does exactly what the current PUT route does: category with source `user`, `needs_review` false, merchant memory, and a correction when the previous source was `ai`.
  - Also sets `category_decided_at` to `decidedAt ?? new Date().toISOString()`.
  - Rejects a category not in this workspace.
- Produces:
  ```ts
  approveCategory(
    workspaceId: number,
    transactionId: number,
    decidedAt?: string,
  ): { ok: true } | { ok: false; reason: "not_found" }
  ```
  Does exactly what the current PATCH approve branch does, and also sets `category_decided_at`.
- Produces, in `devices.ts`:
  - `getDevice(deviceId)`
  - `upsertDevice(deviceId, deviceName, mtimeMs)`
  - `recordApply(deviceId, { lastAppliedSeq, applied, skippedNewer, skippedMismatch })`
  - `listDevices(): PhoneSyncDevice[]`
  - `getAcks(): Record<string, number>`

- [ ] **Step 1: Write failing tests:**
  - `applyUserCategory matches the old route`:
    - On an AI-categorized synthetic row, `category_id` and `category_source = 'user'` are set and `needs_review = 0`.
    - `merchant_categories` has the user mapping.
    - `category_corrections` has one row.
    - `category_decided_at` equals the passed ISO string.
  - `approveCategory` writes `merchant_categories` with source `approved-ai` and sets `category_decided_at`.
  - `category from another workspace` gives `category_not_found` and changes nothing.
  - `import and AI do not touch category_decided_at`: after `batchUpdateCategories` and `batchSetNeedsReview` on the row, `category_decided_at` is unchanged.
  - `APP_SCHEMA_VERSION equals the last migration file`: reads `src/server/db/migrations`, sorts, and compares with the last entry. This test is what forces a version bump whenever a migration is added.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement the migration, queries, service, and route refactor.
- [ ] **Step 4:** Run `npm run test:phone-sync && npm run test:logic && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: track user category decisions and share the recategorize path`.

### Task 7: PC snapshot builder

**Files:**
- Create: `src/server/phone-sync/snapshot.ts`
- Test: `scripts/test-phone-sync-snapshot.mjs`

**Interfaces:**
- Consumes: `getDb()`, `getAcks()` (Task 6), `encryptPayload` (Task 4).
- Produces:
  - `SNAPSHOT_SECRET_SETTING_PATTERNS = ["%_encrypted", "%_iv", "%_auth_tag", "phone_sync_%"]`
  - `buildSnapshotDbBytes(opts: { acks: Record<string, number>; now?: Date }): Uint8Array`. Its steps:
    1. `VACUUM INTO` a unique file in `os.tmpdir()`.
    2. Open it with better-sqlite3.
    3. `DELETE FROM bank_credentials`.
    4. Delete settings matching the patterns.
    5. Create `phone_sync_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` with `format_version=1`, `created_at`, and `acks` (JSON).
    6. Switch `journal_mode` to `DELETE`, then `VACUUM`.
    7. Read the bytes, and delete the temp file in a `finally`.

- [ ] **Step 1: Write failing tests:**
  - `strips secrets`:
    - Seed `ai_api_key_encrypted`, `ai_api_key_iv`, `ai_api_key_auth_tag`, and `phone_sync_passphrase_encrypted` settings with marker values like `SECRET-MARKER-1`.
    - Seed one `bank_credentials` row with marker bytes.
    - Build. Load the bytes into better-sqlite3 from a temp file: the rows are gone, and `language` is kept.
    - The raw bytes contain none of the marker strings (search with `Buffer.indexOf`).
  - `keeps data`: transaction, category, budget, trip, and workspace counts equal the source.
  - `meta`: `acks` round-trips as `{ "dev-a": 3 }`, and `_migrations` max equals `APP_SCHEMA_VERSION`.
  - `no temp files left` in `os.tmpdir()` with the snapshot prefix, including when an error is injected after `VACUUM INTO`.
  - `live db untouched`: source settings and credentials still exist after the build.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: build stripped database snapshots for phone sync`.

### Task 8: PC change applier

**Files:**
- Create: `src/server/phone-sync/apply-changes.ts`
- Test: `scripts/test-phone-sync-apply.mjs`

**Interfaces:**
- Consumes: `ChangeFile` and `sortForApply` (Task 5), `applyUserCategory` / `approveCategory` and the devices functions (Task 6).
- Produces:
  ```ts
  applyChangeFile(
    file: ChangeFile,
    fileMtimeMs: number,
  ): {
    applied: number;
    skippedNewer: number;
    skippedMismatch: number;
    alreadyApplied: number;
  }
  ```
  Runs in one `db.transaction`. For each entry with `seq > device.last_applied_seq`, in seq order:
  - **Mismatch:** the transaction doesn't exist in `workspaceId`, its `dedup_hash !== entry.dedupHash`, or the service returns `category_not_found`. Increment `skippedMismatch`.
  - **Newer decision exists:** `category_decided_at > entry.at`. Increment `skippedNewer`.
  - **Otherwise:** call the service with `decidedAt = entry.at`.

  It advances `last_applied_seq` to the max seq seen and updates the device name and mtime.

- [ ] **Step 1: Write failing tests:**
  - `applies setCategory as a user correction`: same assertions as the Task 6 first test, made through a change file.
  - `idempotent`: applying the same file twice gives `alreadyApplied` equal to the count and no further DB change.
  - `newer PC decision wins`:
    - Set the row's category on the PC at `2026-03-02T10:00:00.000Z`.
    - An entry at `2026-03-01T10:00:00.000Z` gives `skippedNewer: 1`, and the row is unchanged.
  - `import after phone edit does not block`: run `batchUpdateCategories` and the import upsert on the row after the entry time. The entry is still applied.
  - `mismatch cases` each give `skippedMismatch: 1` and an unchanged DB:
    - a deleted transaction;
    - a wrong `dedupHash`;
    - a category in another workspace;
    - a deleted category.
  - `two devices independent`: device A's ack doesn't affect device B's entries.
  - `counts persisted`: `listDevices()` shows applied and skipped counts.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: apply phone category changes on the PC`.

### Task 9: PC sync engine, folder IO, settings, and API

**Files:**
- Create: `src/server/phone-sync/settings.ts`
- Create: `src/server/phone-sync/folder.ts`
- Create: `src/server/phone-sync/engine.ts`
- Modify: `src/instrumentation.ts`. After `initScheduler()`, dynamically import and call `initPhoneSync()`.
- Create:
  - `src/app/api/phone-sync/route.ts` (GET status)
  - `src/app/api/phone-sync/run/route.ts` (POST)
  - `src/app/api/phone-sync/settings/route.ts` (PUT)
- Modify: `src/lib/api.ts`, adding `getPhoneSyncStatus()`, `runPhoneSyncNow()`, and `updatePhoneSyncSettings(input)`.
- Modify: `src/lib/types.ts`, adding `PhoneSyncStatus` and `PhoneSyncDevice`.
- Test: `scripts/test-phone-sync-engine.mjs`

**Interfaces:**
- Produces, in `settings.ts`:
  - `getPhoneSyncConfig(): { enabled: boolean; folder: string | null; hasPassphrase: boolean }`
  - `setPhoneSyncConfig({ enabled?, folder? })`
  - `setPhoneSyncPassphrase(p: string)`: rejects under 12 characters, and stores the passphrase hex-encrypted under `phone_sync_passphrase_encrypted` / `_iv` / `_auth_tag`, the same pattern as `ai_api_key_*` in `src/app/api/setup/ai/route.ts`.
  - `getPhoneSyncPassphrase(): string | null`
  - Status keys: `phone_sync_last_synced_at`, `phone_sync_last_snapshot_at`, `phone_sync_last_snapshot_bytes`, `phone_sync_last_error`.
- Produces, in `folder.ts`:
  - `checkFolder(folder): { ok: true } | { ok: false; reason: "folder_unavailable" | "not_writable" }`. Never creates the folder's parents.
  - `writeSnapshotAtomic(folder, bytes)`: write the tmp file, rename it, and clean up the tmp file on error.
  - `listChangeFiles(folder): Array<{ deviceId: string; path: string; mtimeMs: number }>`. Uses `parseChangeFileName` only.
- Produces, in `engine.ts`:
  - `initPhoneSync()`:
    - Creates the scheduler.
    - Starts a 5 s interval that reads `SELECT total_changes() AS n` and calls `notifyChange()` when it grows past the baseline.
    - Starts the 2-minute change-file poll.
    - Runs a first sync.
    - Does nothing when disabled.
    - Idempotent across HMR, via `globalThis._phoneSync`.
  - `runPhoneSync(): Promise<PhoneSyncStatus>`:
    1. Check the folder.
    2. For each change file whose mtime differs from the device's `last_file_mtime_ms`, decrypt and `applyChangeFile`.
    3. If anything was applied, or local changes are pending, or no snapshot was written since start: build, encrypt, and `writeSnapshotAtomic`.
    4. Record the status keys.
    5. Reset the `total_changes()` baseline last, so the engine's own status writes don't retrigger it.
  - `getPhoneSyncStatus(): PhoneSyncStatus`
- Produces: the type below.
  ```ts
  PhoneSyncStatus = {
    enabled: boolean;
    folder: string | null;
    hasPassphrase: boolean;
    state: "idle" | "syncing" | "error" | "disabled";
    lastSyncedAt: string | null;
    lastSnapshotAt: string | null;
    lastSnapshotBytes: number | null;
    error: "folder_unavailable" | "not_writable" | "no_passphrase" | "bad_passphrase" | "bad_format" | null;
    devices: PhoneSyncDevice[];
  }
  ```

- [ ] **Step 1: Write failing tests** (temp folder under `.tmp-tests/`):
  - `missing folder`: config points at a non-existent path. `runPhoneSync()` gives `state: "error"`, `error: "folder_unavailable"`. Nothing is created on disk and nothing throws.
  - `writes snapshot atomically`: after a sync, `snapshot.spent.enc` decrypts to a DB whose `phone_sync_meta.acks` is `{}`, and no `.tmp` remains.
  - `applies change files and acks in next snapshot`:
    - Write `changes-<id>.spent.enc` with 2 entries.
    - After a sync, both are applied, and the new snapshot's acks are `{ "<id>": 2 }`.
  - `bad change file does not stop sync`: one corrupt change file and one good one. The good one is applied, the snapshot is written, and `error` is null. The per-device failure is recorded in `phone_sync_devices.last_error`.
  - `ignores other names`: `changes-abc.spent.enc.tmp` and `notes.txt` in the folder are ignored.
  - `passphrase min length`: an 11-character passphrase is rejected.
  - `local change triggers debounce`: with a fake clock scheduler, a DB write increases `total_changes()`, and a sync runs after 30 s, not before.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement. The routes return `PhoneSyncStatus`. The PUT validates input and calls `initPhoneSync()` again when the feature becomes enabled.
- [ ] **Step 4:** Run `npm run test:phone-sync && npm run test:logic && npm run lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add PC phone sync engine with Drive folder snapshots`.

### Task 10: PC phone sync settings page and sidebar sync block

**Files:**
- Create: `src/components/phone-sync/sync-status-block.tsx`. A presentational component used on both platforms.
- Create: `src/components/phone-sync/use-desktop-phone-sync.ts`. A TanStack Query hook: it polls status every 10 s only while the tab is visible and phone sync is enabled.
- Create: `src/app/settings/phone-sync/page.tsx`
- Create: `src/components/settings/phone-sync-section.tsx`. Built from `SectionShell` / `SettingCard`.
- Modify: `src/components/settings/settings-sidebar.tsx`. Add `{ href: "/settings/phone-sync", labelKey: "phoneSync", Icon: Smartphone }` to `groupConnections`.
- Modify: `src/components/layout/app-sidebar.tsx`. Render `SyncStatusBlock` in the footer when the desktop status says `enabled`.
- Modify: `src/i18n/messages/en.json`, `he.json`

**Interfaces:**
- Produces:
  ```tsx
  <SyncStatusBlock
    state
    lastSyncedAt
    pendingCount?
    error
    onSync
    menuItems?
  />
  ```
  - It shows a Sync button (spinner while syncing) and "Last synced: <relative time>", using the same relative-time helper the app already uses (search `src/lib` for it).
  - Errors are mapped to short messages: "Folder not found", "Passphrase is wrong", "Offline", "Update the phone app", "Update Spent on the PC".
  - It shows "N changes waiting" when `pendingCount > 0`.
  - In icon-collapsed sidebar mode, it shows only the icon button with a tooltip.
- Settings page content:
  - an enable switch;
  - the folder path input with a "Check folder" result;
  - passphrase set/change (password input, a 12-character minimum, a strength hint, and a warning that phones will need the new one);
  - last snapshot time and size;
  - a devices table (name, last seen, applied, "skipped: newer decision elsewhere", "skipped: no longer matches");
  - a link to `docs/phone-app.md` on GitHub.

- [ ] **Step 1:** Add en and he strings under `phoneSync.*` and `settings.nav.phoneSync`.
- [ ] **Step 2:** Implement the components and page.
- [ ] **Step 3:** Run `npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 4:** Run `npm run dev` against a fake-data workspace and a temp folder. Check:
  - Enable, set the folder, set the passphrase, then press Sync. "Last synced" updates.
  - A missing folder shows "Folder not found".
  - Check the page in English and Hebrew, light and dark, at desktop and 390 px widths.
- [ ] **Step 5:** Commit: `feat: add phone sync settings page and sidebar sync button`.

### Task 11: Mobile screens and hidden controls

Depends on the Task 3 gate passing.

**Files:**
- Create the route entries `src/app/budget/page.mobile.tsx`, `transactions/page.mobile.tsx`, `credit-card/page.mobile.tsx`, `trips/page.mobile.tsx`. Each renders the same client page component inside `AppShell`, wrapped in `Suspense` where `useSearchParams` is used.
- Modify, gating each change on `IS_MOBILE`:
  - `src/components/home/home-page.tsx`: hide `BudgetPaceCard`, `RecentTransactionsCard`, `ImportXlsxButton`, `SyncButton`, `CategorizeButton`, and `AINotConnectedBanner`.
  - `src/components/layout/app-sidebar.tsx`: hide `FOOTER_NAV` (Settings) and the GitHub star link.
  - `src/components/layout/workspace-switcher.tsx`: hide "New workspace" and "Manage workspaces".
  - Budget detail sheet (`BudgetDetailSheet`, `CategoryGrid` children): hide budget amount editing and the budget mode toggle. Keep transaction recategorize and approve.
  - `src/components/dashboard/transactions-table.tsx`: hide the kind change control, `TripBulkBar`, and `TripCategoryPrompt`. Keep the category picker and approve.
  - `src/components/trips/*`: hide detect, create, edit, confirm/dismiss, delete, assignment actions, and AI recategorize. Keep the views, tabs, totals, breakdowns, and the needs-a-trip list as read-only.
  - The AI-not-connected banner on the Budget, Transactions, and Credit card pages.
- Modify: `src/mobile/router.ts`, if any screen calls a GET not yet routed.

**Interfaces:**
- Consumes: `IS_MOBILE` (Task 3) and `handleMobileRequest` (Task 3).

- [ ] **Step 1: Write a failing test** in `scripts/test-phone-sync-router.mjs`: `every GET used by phone screens is routed`. A static list of the GET paths the five screens and the sidebar call (built in this step from grepping `src/lib/api.ts` callers). Each returns a non-404 status against the synthetic DB.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL for any unrouted path.
- [ ] **Step 3:** Implement the route entries, the gating, and the missing routes. In `layout.mobile.tsx`, pad the shell with `env(safe-area-inset-*)` and make sure interactive targets on the five screens are at least 44 px tall at phone width.
- [ ] **Step 4:** Run `npm run test:phone-sync && npm run lint && npm run build && npm run mobile:build`. Expected: all PASS. Then check that the desktop app still shows every hidden control on all five screens.
- [ ] **Step 5:** Serve `out-mobile/` with a temporary synthetic boot (same as the Task 3 gate, not committed) at 390 px. Check:
  - All five screens render.
  - The sidebar opens as a sheet.
  - Hidden controls are absent.
  - The workspace switcher switches data.
  - In Hebrew, the sheet opens from the right.
- [ ] **Step 6:** Commit: `feat: add phone screens and hide desktop-only controls on mobile`.

### Task 12: Mobile category writes with a local outbox

**Files:**
- Create: `src/mobile/local-writes.ts`
- Create: `src/mobile/storage/outbox-store.ts`
- Modify: `src/mobile/router.ts`. Route `PUT /api/transactions/:id` and `PATCH /api/transactions/:id` with `{ approve: true }` to `local-writes`. A PATCH with `kind` returns 404 with the "Not available on the phone" message.
- Test: `scripts/test-phone-sync-mobile-writes.mjs`

**Interfaces:**
- Consumes: `applyUserCategory` / `approveCategory` (Task 6), `nextSeq` / `pruneAcked` (Task 5).
- Produces, in `outbox-store.ts`:
  - `interface OutboxStore { load(): Promise<PhoneChange[]>; save(changes: PhoneChange[]): Promise<void> }`
  - `createMemoryOutboxStore()`, for tests.
  - The persistent implementation arrives in Task 14.
- Produces, in `local-writes.ts`:
  - `configureLocalWrites({ outbox: OutboxStore; getAck(): number; onChange(): void })`
  - `putTransactionCategory(workspaceId, id, categoryId): Promise<Response>`
  - `approveTransaction(workspaceId, id): Promise<Response>`

  Each one reads `dedup_hash` from the row, applies the change to the in-memory sql.js DB through the same service with `decidedAt = new Date().toISOString()`, appends a `PhoneChange` with `nextSeq`, saves the outbox, calls `onChange()` (which feeds the scheduler), and returns `{ success: true }`.
- Produces: `reapplyOutbox(changes: PhoneChange[]): void`. Applies entries in seq order to a freshly loaded DB, ignoring failures. Used after every snapshot load.

- [ ] **Step 1: Write failing tests:**
  - `PUT records and applies`: the row's category changes in sql.js, the outbox has one entry with the row's `dedupHash`, `action: "setCategory"`, and `seq: 1`, and `onChange` was called once.
  - `approve records`: gives an `action: "approve"` entry.
  - `seq continues after ack`: with ack 5 and an empty outbox, the next seq is 6.
  - `reapply after fresh snapshot`: load the original bytes again, call `reapplyOutbox(outbox)`, and the row shows the phone's category.
  - `kind PATCH is not available`: status 404.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: record phone category edits in a local outbox`.

### Task 13: Capacitor Android shell, device storage, Google sign-in, and Drive client

**Files:**
- Create: `capacitor.config.ts`, with `appId` chosen by the builder (for example `dev.spent.app`), `appName: "Spent"`, and `webDir: "out-mobile"`.
- Create: `android/`, via `npx cap add android`, committed.
- Modify: `.gitignore`. Add `android/app/release/`, `android/local.properties`, `*.jks`, `*.keystore`, `android/app/google-services.json`, and `.env.mobile`.
- Modify: `package.json`. Add pinned `@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, `@capacitor/filesystem`, `@capacitor/app`, a Google sign-in plugin that returns an OAuth access token for custom scopes, and a Keystore-backed secure storage plugin. Add the scripts `"mobile:sync": "npm run mobile:build && npx cap sync android"` and `"mobile:apk": "npm run mobile:sync && node scripts/mobile/assemble-release.mjs"`.
- Create: `scripts/mobile/assemble-release.mjs`. Runs the Gradle `assembleRelease` with the `gradlew.bat` or `gradlew` wrapper, and reads signing settings from env vars (`SPENT_KEYSTORE_PATH`, `SPENT_KEYSTORE_PASSWORD`, `SPENT_KEY_ALIAS`, `SPENT_KEY_PASSWORD`). It fails with a clear message if one is missing.
- Create: `.env.mobile.example` with `NEXT_PUBLIC_SPENT_GOOGLE_WEB_CLIENT_ID=`, and nothing else.
- Create: `src/mobile/storage/secure-store.ts`
- Create: `src/mobile/storage/local-files.ts`
- Create: `src/mobile/drive/google-auth.ts`
- Create: `src/mobile/drive/drive-client.ts`
- Test: `scripts/test-phone-sync-drive-client.mjs`

**Interfaces:**
- Produces, in `secure-store.ts`:
  - `getSecret(key: "passphrase" | "deviceId" | "deviceName" | "folderId" | "folderName"): Promise<string | null>`
  - `setSecret(key, value)`
  - `clearAll()`
- Produces, in `local-files.ts`, all in `Directory.Data`:
  - `readSnapshotBlob(): Promise<Uint8Array | null>`
  - `writeSnapshotBlob(bytes)`: written to a temp name, then renamed.
  - `readOutboxBlob()`
  - `writeOutboxBlob(bytes)`
  - `wipeLocalData()`
- Produces, in `google-auth.ts`:
  - `signIn(): Promise<{ email: string }>`
  - `getAccessToken(): Promise<string>`, with the scope `https://www.googleapis.com/auth/drive`. Refreshes silently, and throws `"signed_out"` if it can't.
  - `signOut()`
- Produces, in `drive-client.ts` (constructor takes `getAccessToken` and a `fetchImpl`, for tests):
  - `findSpentFolders(): Promise<Array<{ id: string; name: string; ownerEmail: string }>>`. Searches `name = 'snapshot.spent.enc' and trashed = false` and returns the parent folders.
  - `getFileMeta(folderId, name): Promise<{ id: string; modifiedTime: string; md5Checksum: string; size: number } | null>`. Exact-name match only.
  - `download(fileId): Promise<Uint8Array>`
  - `upsertFile(folderId, name, bytes): Promise<void>`. Creates the file if missing, otherwise does a media update.
  - All methods map 401 to one token refresh and retry, network errors to `"offline"`, and 404 on the folder to `"folder_unavailable"`.

- [ ] **Step 1: Write failing tests** for `drive-client.ts` with a fake `fetchImpl`:
  - The query strings are escaped.
  - `getFileMeta` ignores `snapshot.spent.enc.tmp`.
  - `upsertFile` creates, then updates.
  - A 401 triggers exactly one retry with a fresh token.
  - A network failure throws `offline`.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement. Pick the plugins, and record each choice and version in a comment in `capacitor.config.ts`.
- [ ] **Step 4:** Run `npm run test:phone-sync`. Expected: PASS.
- [ ] **Step 5:** Run `npm run mobile:sync`, then build a debug APK with `cd android && ./gradlew assembleDebug`. Expected: the APK builds.
- [ ] **Step 6:** Commit: `feat: add Capacitor Android shell, device storage, and Drive client`.

### Task 14: Mobile boot, onboarding, sync engine, and version checks

**Files:**
- Create: `src/mobile/sync/mobile-sync-engine.ts`
- Create: `src/mobile/sync/sync-store.ts`. A small external store with a `useMobileSync()` hook.
- Create: `src/mobile/boot/mobile-root.tsx`
- Create: `src/mobile/onboarding/onboarding-flow.tsx`
- Create: `src/app/onboarding/page.mobile.tsx`
- Modify: `src/app/layout.mobile.tsx`. Wrap children in `MobileRoot`.
- Modify: `src/mobile/storage/outbox-store.ts`. Add a persistent store that encrypts with the passphrase (Task 4) into `local-files`.
- Modify: `src/components/layout/app-sidebar.tsx`. On mobile, render `SyncStatusBlock` from `useMobileSync()`, with menu items "Sync now" and "Disconnect this phone".
- Modify: `src/i18n/messages/en.json`, `he.json`
- Test: `scripts/test-phone-sync-mobile-engine.mjs`

**Interfaces:**
- Consumes: Tasks 3, 4, 5, 12, 13.
- Produces: `createMobileSyncEngine(deps)`. Its deps are `{ drive, files, secrets, outbox, loadDatabase, reapplyOutbox, invalidateAll, now }`. It returns:
  - `boot(): Promise<"needs_onboarding" | "ready" | "needs_passphrase">`
  - `sync(): Promise<void>`
  - `notifyChange(): void`
  - `onForeground(): void`
  - `onBackground(): void`
  - `getState(): MobileSyncState`
- Produces the state type:
  ```ts
  MobileSyncState = {
    state: "idle" | "syncing" | "error";
    lastSyncedAt: string | null;
    pendingCount: number;
    error: "offline" | "bad_passphrase" | "folder_unavailable" | "signed_out" | "update_phone_app" | "update_pc" | "bad_format" | null;
  }
  ```
- Boot:
  1. Read the secrets. If any is missing, return `needs_onboarding`.
  2. Read the local snapshot blob and decrypt it. `bad_passphrase` returns `needs_passphrase`.
  3. Run the version check.
  4. `loadDatabase`, then `reapplyOutbox`.
  5. Set the locale from `settings.language`.
  6. Validate the active workspace id against `workspaces`, resetting to the lowest id if it's missing.
  7. Return `ready`, then run `sync()`.
- `sync()`:
  1. If the outbox is not empty, upsert the change file (with the encrypted `ChangeFile` from the outbox).
  2. `getFileMeta(SNAPSHOT_FILE)`. If `md5Checksum` changed since the last download, download and decrypt it.
  3. Version check: compare the snapshot's `_migrations` max with `APP_SCHEMA_VERSION` / `MIN_SNAPSHOT_SCHEMA_VERSION`. Newer gives `update_phone_app`; older than the minimum gives `update_pc`. In both cases, keep the old DB.
  4. Persist the blob, `loadDatabase`, `pruneAcked` using `acks[deviceId]`, save the outbox, `reapplyOutbox`, then `invalidateAll()`.
  5. Set `lastSyncedAt`.
  6. Any failure sets `error` and leaves the local blob, DB, and outbox untouched.
- Scheduling:
  - Uses `createSyncScheduler` from Task 5.
  - `onForeground` calls `sync()`. `onBackground` calls `cancel()`. These are wired to `@capacitor/app` `appStateChange`.
- Onboarding:
  1. Sign in with Google.
  2. Pick a folder from `findSpentFolders()` (one tap if there is only one).
  3. Enter the passphrase, which is verified by downloading and decrypting the snapshot before saving.
  4. Name the phone (default "Phone").
  5. A random `deviceId` (`crypto.randomUUID()` without dashes, lowercased).
  6. Then boot.
- Disconnect: confirm, `wipeLocalData()`, `clearAll()`, `signOut()`, then go to onboarding.
- Passphrase prompt: `needs_passphrase` shows a single-field screen. On success, the new passphrase is saved, the outbox is re-encrypted, and a sync runs.

- [ ] **Step 1: Write failing tests** with fakes for drive, files, secrets, and clock:
  - `first boot needs onboarding`.
  - `sync uploads outbox before downloading`: the call order is `upsertFile` then `getFileMeta`.
  - `unchanged checksum skips download`.
  - `acks prune outbox`: with the outbox at seq 1..3 and the snapshot acks at `{ [deviceId]: 2 }`, the outbox afterwards holds seq 3 only, and the row shows the seq-3 category.
  - `corrupt snapshot keeps local data`: `decryptPayload` rejects with `bad_format`. The state error is `bad_format`, and the previous DB, blob, and outbox are unchanged (Review Focus 2).
  - `passphrase changed on PC`: the remote decrypt fails with `bad_passphrase`. The state error is `bad_passphrase`, the outbox is preserved, and after a new passphrase is entered the outbox uploads and the snapshot loads (Review Focus 3).
  - `newer schema`: the snapshot `_migrations` max is `"099_future.sql"`. The error is `update_phone_app` and the old DB is kept.
  - `active workspace removed`: a stored workspace id of `99`, which is not in the snapshot, resets to the lowest id (Review Focus 5).
  - `offline`: the drive throws `offline`. The error is `offline`, the pending count is unchanged, and no crash happens.
  - `background cancels timer`: after `notifyChange()` then `onBackground()`, no sync runs after 30 s.
- [ ] **Step 2:** Run `npm run test:phone-sync`. Expected: FAIL.
- [ ] **Step 3:** Implement the engine, store, boot, onboarding, sidebar block, and strings.
- [ ] **Step 4:** Run `npm run test:phone-sync && npm run lint && npm run mobile:build`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: add phone boot, onboarding, and Drive sync`.

### Task 15: Docs, install guide, and the rebuild rule

**Files:**
- Create: `docs/phone-app.md`
- Modify: `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `README.md`

**Content, all decided in the spec's "Required doc updates":**
- **`docs/phone-app.md`**, written against the real commands from Tasks 3, 13, and 14:
  1. What it is and what it does not do.
  2. PC: install Google Drive for desktop, choose a folder, and enable Phone sync in Settings with a passphrase of 12+ characters. Advise a long passphrase.
  3. Google Cloud: create a project, enable the Drive API, and set up the OAuth consent screen (External, set to "In production" without verification, so refresh tokens do not expire after 7 days). Create an Android OAuth client (package name and signing SHA-1, with the `keytool` command) and a Web client. Put the web client id in `.env.mobile`.
  4. Toolchain: JDK 21 and the Android SDK, or Android Studio.
  5. Create a signing keystore, kept out of the repo, and back it up, because losing it means reinstalling.
  6. Build: `npm run mobile:apk` with the signing env vars.
  7. Install on each phone: copy the APK, allow "Install unknown apps" for the file manager, and install.
  8. Second phone: share the Drive folder with that Google account as Editor, and add the account as a test user if the consent screen is in testing.
  9. First run on the phone: sign in, pick the folder, enter the passphrase, and name the phone.
  10. Updating: rebuild and reinstall over the existing app with the same keystore. Data and settings stay.
  11. Changing the passphrase.
  12. Troubleshooting: one line per error message from Task 10 and Task 14.
- **`AGENTS.md`:**
  - A "Phone app" section under Architecture, covering:
    - the mobile target (`SPENT_TARGET=mobile`, `*.mobile.tsx`, the aliases in `next.config.ts`);
    - the on-device router;
    - `src/server/api-handlers/`;
    - the snapshot and change-file flow;
    - `src/lib/phone-sync/`;
    - the sync timing constants.
  - Phone rows in "Pages" and "Key files".
  - Remove "Mobile app (Phase 2)" from "Out of scope".
  - Add to "Agent workflow": "Changes to shared UI components, `src/lib/api.ts`, `src/server/api-handlers/`, query or summary code, money semantics, migrations, i18n messages, or `src/lib/phone-sync/` formats require rebuilding the APK (`npm run mobile:apk`) and reinstalling it on the phones. A new migration also requires updating `APP_SCHEMA_VERSION` (the test enforces this). A change to the snapshot or change-file format requires bumping its version."
  - Add `npm run test:phone-sync` and `npm run mobile:build` to "Running and testing".
- **`CLAUDE.md`:** one bullet saying that at the end of a task whose diff touches anything in the rebuild rule, tell the user the APK needs rebuilding and reinstalling.
- **`SECURITY.md`:**
  - Asset rows: the snapshot and change files in Drive (encrypted); the passphrase on the PC (encrypted with the local key) and on phones (Keystore); Google OAuth tokens on phones.
  - A "Phone sync" section covering what the snapshot strips, the format and KDF parameters, and that the PC makes no new network connections while phones contact `www.googleapis.com` and `oauth2.googleapis.com`.
  - Accepted threats: offline brute force against a weak passphrase, a lost unlocked phone, and a compromised Google account (it exposes only ciphertext unless the passphrase is weak).
  - Update "Transaction data" to say a copy is in Drive, encrypted, when phone sync is enabled.
- **`README.md`:**
  - A feature tile "Android companion" (opt-in, off by default) and a link to `docs/phone-app.md`.
  - Change "Mobile companion (Phase 2)" in the Roadmap to checked "Android companion".
  - Add a sentence in "Why Spent?" or "Security at a glance" saying that phone sync is opt-in and only uploads an encrypted file to your own Drive.

- [ ] **Step 1:** Write the docs. Read each against the build commands actually used in Tasks 13 and 14.
- [ ] **Step 2:** Run `grep -nP "\x{2014}" docs/phone-app.md AGENTS.md CLAUDE.md SECURITY.md README.md`. Expected: no output.
- [ ] **Step 3:** Run `npm run security:sensitive-data`. Expected: no findings.
- [ ] **Step 4:** Commit: `docs: document the Android companion app and the APK rebuild rule`.

### Task 16: End-to-end verification on a device

No code unless the run finds bugs. Each fix gets its own test and commit.

- [ ] **Step 1:** On the PC, with a **fake-data workspace** (never the live database):
  1. Run `SPENT_DATA_DIR=.tmp-tests/e2e npm run dev`.
  2. Seed the workspace.
  3. Enable phone sync to a test subfolder in `H:\My Drive`.
- [ ] **Step 2:** Build a release APK (`npm run mobile:apk`) and install it on an emulator or phone.
- [ ] **Step 3:** Onboard, and check that all five screens match the desktop numbers for the same month.
- [ ] **Step 4:** Go offline (airplane mode), recategorize two transactions, and see "2 changes waiting". Go back online, and the edits reach the PC within about 5 minutes. On the PC: the Transactions page shows them, merchant memory has them, and the devices table shows `applied: 2`.
- [ ] **Step 5:** Change the passphrase on the PC. The phone shows "Passphrase is wrong", and entering the new one keeps pending edits.
- [ ] **Step 6:** Repeat Step 3 in Hebrew and in dark mode.
- [ ] **Step 7:** Close Drive for desktop, then press Sync on the PC. It shows "Folder not found", and the server keeps running.
- [ ] **Step 8:** Run `npm run test:phone-sync && npm run test:logic && npm run test:imports && npm run lint`. Expected: all PASS.
