# Android companion app with encrypted Google Drive sync

Status: design, awaiting user approval
Date: 2026-10-16

## Intent

The household wants to look at Spent on their phones and fix categories there, without carrying the laptop. Importing and AI categorization stay on the PC, because they need the bank export files and a local Ollama model. The phone is a viewer plus a category editor.

The PC remains the single source of truth. The phone gets an encrypted copy of the database through the user's own Google Drive, works fully offline, and sends category changes back through the same folder. Google only ever holds encrypted blobs.

Two phones are in scope from day one (the maintainer and their spouse), each signed in with its own Google account.

## Goals

1. An Android app that looks and behaves like the desktop app: same components, same charts, same sidebar, same English and Hebrew (RTL) support, same light and dark themes.
2. Screens on the phone: Home, Budget, Transactions, Credit card, Trips. The sidebar matches the desktop one, including the workspace switcher, but has no Settings entry.
3. Home on the phone is the desktop Home **without** the "Budget pace" card and the "Recent activity" card.
4. The phone can change a transaction's category and approve an AI category. Those changes reach the PC and count as user corrections there (merchant memory and correction history learn from them).
5. Works offline. The phone keeps the latest snapshot on the device. Edits made offline wait on the phone and upload later.
6. Encrypted end to end with a passphrase the user chooses. Without the passphrase, the files in Drive are unreadable.
7. A **Sync** button with "Last synced" text on both the phone and the PC.
8. A step-by-step guide for building the APK, installing it on both phones, and entering the passphrase.
9. Project docs (`AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, `README.md`) describe the phone app and require rebuilding the APK when shared code or rules change.

## Non-goals

- No importing on the phone (no XLSX upload, no scraper sync).
- No AI categorization on the phone (no "Categorize" button, no trip AI recategorize).
- No Settings pages on the phone.
- No background sync. Nothing runs when the phone app is closed.
- No iOS app, no Play Store listing, no prebuilt APK published by the project.
- No hosted server. The PC never talks to Google APIs directly.

## Anti-goals (failure even if it works)

- **Numbers on the phone differ from the PC for the same snapshot.** The phone must run the same query and summary code as the PC, not a reimplementation.
- **Any plaintext financial data reaches Google Drive**, or the passphrase, Google tokens, or decrypted data get logged.
- **A phone edit is silently lost**, or one phone overwrites the other phone's edits.
- **The phone corrupts the PC database.** The live `data/spent.db` is never placed in a synced folder, and the PC only ever reads phone change files, never a phone-written database.
- **Real data in the public repo.** No real rows, file names, Google client IDs, keystores, or signing keys get committed.
- **A UI that looks like a wrapped website.** It must feel comfortable on a phone screen (touch targets, safe areas, the slide-out sidebar).

## Constraints

- Public repo. Follow "Sensitive financial data" in `AGENTS.md`. All tests use synthetic data.
- The PC side runs inside the existing Next.js 16 server (`npm run start` service on `127.0.0.1`). Read `node_modules/next/dist/docs/` before changing Next.js code.
- Database: `better-sqlite3` in WAL mode at `data/spent.db`. Database size today is a few MB.
- All screens already fetch data from `/api/*` through `src/lib/api.ts` (relative URLs, `x-workspace-id` header). Pages are thin server components that only gate access, then render client components.
- Query code in `src/server/db/queries/*` uses the synchronous better-sqlite3 API and is marked `server-only`.
- `/api/home` and `/api/activity` currently import the scraper scheduler chain (`src/server/sync/scheduler.ts` and `orchestrator`), which cannot run on a phone.
- Every new user-facing string goes into both `src/i18n/messages/en.json` and `he.json`.
- No em dashes anywhere.

## Decisions already made (by the user)

- Android only, installed on two phones by sideloading.
- Same design as desktop. Same sidebar with workspace switcher, no Settings.
- Phone Home drops Budget pace and Recent activity.
- Transport is Google Drive. The PC has Google Drive for desktop installed with the user's personal account mounted as `H:`.
- The whole database is downloaded to the phone for offline use.
- Sync timing, on both phone and PC:
  - on app open,
  - on the Sync button,
  - after a change: wait 30 seconds, collecting further changes, then sync once.
- Sync happens only while the phone app is open and in the foreground.
- PC gets a Sync button and "Last synced" text too.
- The phone app lives in this repo and is part of the open-source project.

## Architecture

```
PC (Next.js server)                 Google Drive folder               Phone (Capacitor app)
-------------------                 -------------------               ---------------------
data/spent.db (live, WAL)
   | VACUUM INTO temp, strip        H:\My Drive\Spent\
   | secrets, gzip, encrypt  ---->  snapshot.spent.enc  ---------->  download, decrypt,
   |                                                                   load into sql.js (memory)
   |                                                                   same React UI + same
   |                                                                   query code answers /api/*
   | read, decrypt, apply    <----  changes-<deviceId>.spent.enc <--  outbox of category edits
   v                                (one file per phone)
merchant memory, corrections
```

### Phone app shell (decided: Capacitor plus the existing React UI)

Rebuilding the UI natively would break the "same design" goal, so the phone reuses the existing React components inside a Capacitor Android WebView.

- **Mobile build target.** A separate build of the same Next.js codebase in static export mode (`output: "export"`), selected by an environment variable (for example `SPENT_TARGET=mobile`). Mobile-only route entry files (for example via a `pageExtensions` value like `mobile.tsx`) render the same client page components without the server-side access gate. The builder confirms the exact Next 16 mechanism from the docs and proves it in a spike first (see "Risks").
- **Module aliasing in the mobile build:** `server-only` resolves to an empty module, `@/server/db/index` resolves to a sql.js adapter, and the scraper chain resolves to inert stubs.
- **On-device API.** `src/lib/api.ts` gains a pluggable transport. On desktop it stays `fetch`. On the phone it calls an in-process router that maps the same paths and methods to handler functions.
  - To avoid two copies of handler logic, the bodies of the in-scope route handlers move into shared, framework-free functions (for example `getHomePayload(workspaceId, month)`). Both `src/app/api/**/route.ts` and the mobile router call those.
  - Only the endpoints the in-scope screens use need this treatment.
- **Database on the phone.** sql.js (SQLite compiled to WASM) loaded in memory. It is synchronous like better-sqlite3, so query modules run unchanged behind a thin adapter exposing `prepare().get/all/run`, `transaction`, and `pragma`. The database is small enough to hold in memory.
- **Locale.** The NEXT_LOCALE cookie and server `getRequestConfig` do not exist in a static build. The phone uses next-intl's client provider with both message files bundled. The phone's language is taken from the PC's `language` setting in the snapshot. Theme follows the phone's system theme by default (next-themes, as today).
- **Phone layout.** The existing shadcn sidebar already becomes a slide-out sheet on narrow screens. Builder ensures safe-area insets, tap target sizes, and that tables and charts on the five screens read well at phone width.

### What the phone shows

- **Sidebar:** Home, Budget, Transactions, Credit card, Trips (with its badge), and the workspace switcher. No Settings link. In the switcher, the "New workspace" and "Manage workspaces" items are hidden. The GitHub star link is hidden. A sync block in the sidebar footer shows the Sync button and "Last synced" time.
- **Home:** as desktop minus `budget-pace-card.tsx` and `recent-transactions-card.tsx`. Also hidden: the Import button, the scraper Sync button, the AI Categorize button, and the "AI not connected" banner. `/api/activity` returns an idle state on the phone.
- **Budget, Transactions, Credit card, Trips:** same views. Controls for writes outside scope (see "Phone write scope" below) are hidden, not disabled.

### Phone write scope (decided by the user)

Allowed on the phone:

- Change a transaction's category (`PUT /api/transactions/:id` with `categoryId`).
- Approve an AI category (`PATCH /api/transactions/:id` with `approve: true`).

Hidden on the phone: budget amount and budget mode edits, transaction kind changes, trip create/edit/confirm/dismiss/delete, trip assignments, trip detection, trip AI recategorize, and category creation.

### Snapshot (PC to phone)

- **Contents.** A consistent copy of the database made with `VACUUM INTO` a temp file. The copy is then stripped of anything the phone does not need and that is secret:
  - delete all rows of `bank_credentials`;
  - delete encrypted or secret `settings` rows (API keys and similar);
  - keep non-secret settings such as `language`;
  - then `VACUUM` again so deleted pages are gone.
  The PC's encryption key file is never included.
- **Metadata** (inside the encrypted payload, in a small `phone_sync_meta` table or a JSON header):
  - format version;
  - schema version (highest applied migration number);
  - created-at time;
  - for each device, the highest change sequence number the PC has applied (the "ack").
- **Pipeline:** temp copy, strip, gzip, encrypt, write to `snapshot.spent.enc.tmp` in the Drive folder, then rename over `snapshot.spent.enc`. Temp files are deleted in all cases.
- **Folder location.** A PC setting, defaulting to empty. The user picks a folder, for example `H:\My Drive\Spent`. The setting is global, not per workspace, and the snapshot holds all workspaces.

### Phone changes (phone to PC)

- Each phone install has a random device ID and a display name (default "Phone", editable at setup, for example "Dana's phone" or "Phone 2").
- **Outbox.** Each edit becomes an entry with:
  - a per-device sequence number;
  - workspace ID;
  - transaction ID and its dedup hash;
  - action (`setCategory` with category ID, or `approve`);
  - the time of the edit.
- **Change file.** The phone writes the full list of not-yet-acknowledged entries to `changes-<deviceId>.spent.enc`, encrypted the same way, overwriting its own file. A phone never writes any other file. Two phones never touch the same file.
- **Acknowledgement.** After downloading a snapshot, the phone drops outbox entries at or below the ack for its device. Unacked entries are re-applied on top of the fresh snapshot, so the UI never flips back.
- **Apply on PC.** For each change file, the PC decrypts it and applies entries with a sequence number above that device's stored ack, in order:
  - `setCategory` goes through the same function path as the desktop recategorize route: `updateTransactionCategory` with source `user`, clear `needs_review`, `recordMerchantCategory`, and `recordCorrection` when the previous source was `ai`. Factor that path into one shared function used by both.
  - `approve` goes through the same path as the desktop approve route.
  - The ack advances and is persisted in the PC database.
- **Conflict rule: latest user decision wins** (builder's call, made during design review).
  - `transactions.updated_at` is not usable for this. Imports, AI categorization, needs-review updates, and kind changes also bump it, so an offline phone edit would lose to an unrelated statement import.
  - Instead, a new migration adds `transactions.category_decided_at`. Only the user decision paths write it: the desktop recategorize, the desktop approve, and phone changes applied on the PC.
  - A phone entry is skipped only when `category_decided_at` on the PC is later than the edit's timestamp, meaning someone made a newer category decision on the PC or on the other phone.
  - A skipped entry is still acked, and it is counted per device as "skipped: newer decision elsewhere" on the PC's phone sync page. Nothing is skipped without a visible count.
  - AI categorization already skips rows whose category source is `user` (`batchUpdateCategories`), so applied phone edits are not overwritten by later AI runs.
- **Mismatch rule.** If the transaction ID does not exist or its dedup hash does not match (for example, the PC database was reset), skip the entry, ack it, and record a count shown on the PC's phone sync page. Nothing is silently dropped.
- **Freshness for the other phone.** An applied change marks the PC as changed, which triggers the PC's 30-second debounce and a fresh snapshot. The other phone sees the change on its next sync.

### Encryption

- AES-256-GCM.
- The key is derived from the user's passphrase with PBKDF2-HMAC-SHA256 at 600,000 iterations and a random 16-byte salt per file. PBKDF2 is available in both Node `crypto` and WebCrypto, so no WASM crypto library is needed. The builder may raise the iteration count if phone unlock time stays under about 1 second.
- File format:
  - magic bytes `SPNT`;
  - format version byte;
  - salt;
  - 12-byte IV;
  - ciphertext;
  - GCM tag.
  The header bytes are authenticated as additional data.
- The PC stores the passphrase in the `settings` table encrypted with the existing `src/server/lib/encryption.ts` helpers, so automatic sync works unattended.
- The phone stores the passphrase in Android Keystore-backed secure storage, through a Capacitor secure storage plugin. On disk, the phone keeps the downloaded snapshot and its outbox **encrypted** in app-private storage. Decryption happens into memory at app start.
- **Passphrase rules.** The PC sync settings require a minimum length (builder's call, at least 12 characters) and show a strength hint. Changing the passphrase on the PC re-encrypts the snapshot. Phones then fail to decrypt and prompt for the new passphrase. Pending outbox entries survive, because the outbox is re-encrypted locally with the new passphrase once it is entered.

### Google Drive on the phone

- Google sign-in on Android plus the Drive REST API v3, with the `https://www.googleapis.com/auth/drive` scope.
- This scope is needed because the snapshot is created by Google Drive for desktop, not by the app, and because a spouse reads a folder shared with them.
- Each self-hoster creates their own Google Cloud project and OAuth client IDs (Android client tied to their package name and signing SHA-1, plus the web client ID that sign-in needs). The project is set to "In production" without verification, so refresh tokens do not expire after 7 days. Users click through the "unverified app" warning once.
- Client IDs are supplied at build time (environment variables or a gitignored local file). They are never committed.
- **Folder discovery.** At setup, the phone lists folders visible to the account that contain `snapshot.spent.enc` and lets the user pick one. The spouse's phone finds the folder after it is shared with her as Editor (Editor is needed to write her change file).
- **Sync on the phone:**
  1. Upload the outbox file if it changed.
  2. Fetch the snapshot's metadata (`modifiedTime`, `md5Checksum`) and download only if it changed.
  3. Decrypt, load, re-apply unacked outbox entries, and refresh all queries (`queryClient.invalidateQueries()`).

### Sync timing

Phone:

- Sync on app open and when the app returns to the foreground.
- Sync on the Sync button.
- After an edit, start a 30-second timer, and restart it on every further edit. Cap at 2 minutes from the first pending edit, so continuous editing still syncs (builder's call).
- When the app goes to the background, cancel the timer. Pending edits go up on next open.
- No periodic polling while open beyond these triggers.

PC:

- Sync runs inside the Next.js server process when phone sync is enabled.
- Sync on server start and on the Sync button.
- After a local change, the same 30-second debounce with a 2-minute cap. Local changes are: import commit, categorization apply, a desktop recategorize or approve, budget, category, or trip edits, and applying phone changes.
- **Picking up phone edits.** The PC checks the Drive folder's change files every 2 minutes, by comparing file modified times on local disk (cheap). It applies them when they changed. The user confirmed that a few minutes of delay is fine, so no file watcher and no extra polling.
- A PC sync is: apply phone change files, then write a fresh snapshot if anything changed since the last snapshot.
- Two syncs never run at the same time on the same device. A trigger during a sync queues one follow-up sync.

### Sync UI

- **Both platforms:** a Sync button with "Last synced: <relative time>" and a small status. States are idle, syncing, error (with a short reason such as "Passphrase is wrong", "Folder not found", "Offline", or "Update the phone app"), and "N changes waiting" on the phone.
- **Desktop placement:** the sidebar footer, visible only when phone sync is enabled.
- **Phone placement:** the sidebar footer.
- **PC settings page:** a new "Phone sync" settings page in the Connections group (`src/app/settings/phone-sync/page.tsx`, built with `SectionShell`). It has:
  - enable or disable;
  - folder path, with a check that the folder exists and is writable;
  - set or change passphrase;
  - last snapshot time and size;
  - a devices table (name, last change file seen, last applied sequence, skipped count);
  - a link to the install guide.
- **Phone first-run setup** (not Settings, just onboarding):
  1. Sign in with Google.
  2. Pick the folder.
  3. Enter the passphrase.
  4. Name this phone.

  Afterward, a "Disconnect" action inside the sync block's menu wipes local data and returns to setup.

### Schema and version compatibility

- The phone app bundles its own copy of the query code and knows the highest migration number it was built with.
- If a snapshot's schema version is newer than the app knows, the phone keeps showing its previous snapshot and shows "Update the phone app".
- If the snapshot is older (the PC hasn't been updated), the phone does not run migrations. It shows the data if the snapshot's schema version is at least the minimum the app supports, otherwise "Update Spent on the PC".
- Change-file format and snapshot format carry version numbers, and both sides reject unknown major versions with a clear message.

## Required doc updates (part of the build)

- **`AGENTS.md`:**
  - Add a "Phone app" architecture section (mobile build target, on-device API router, snapshot and change-file flow, file locations).
  - Remove "Mobile app (Phase 2)" from out of scope.
  - Add a rule under Agent workflow: any change to shared UI components, `src/lib/api.ts`, query or summary code, money semantics, migrations, i18n messages, or the sync formats requires rebuilding the APK and reinstalling it on the phones. Migrations and format changes also require bumping the relevant version numbers.
- **`CLAUDE.md`:** a Claude-specific note to tell the user at the end of a task when a change requires rebuilding and reinstalling the APK.
- **`SECURITY.md`:**
  - New assets: snapshot and change files in Google Drive, passphrase on PC and phones, Google OAuth tokens on phones.
  - What the snapshot strips.
  - New network surface: phones contact Google APIs, while the PC still contacts nothing new.
  - Threats accepted: a weak passphrase allows offline brute force of the Drive files, a lost unlocked phone, and the Google account being compromised.
  - Guidance: use a long passphrase.
- **`README.md`:**
  - Feature entry.
  - Link to the install guide.
  - Roadmap "Mobile companion" checked or reworded as "Android companion".
  - Note that phone sync is opt-in and off by default, so the "local-only" claims stay accurate with that caveat.
- **Install guide** (for example `docs/phone-app.md`, and the docs site if appropriate):
  - Google Cloud project setup.
  - Toolchain install (JDK, Android SDK), creating a signing keystore (kept out of the repo), and building the APK.
  - Enabling sideloading on Android and installing on each phone.
  - Sharing the Drive folder with the second account.
  - Setting the passphrase on the PC and entering it on each phone.
  - Troubleshooting.

## Testing

All with synthetic data. No test reads `/data/` or `/transactions/`.

- **Crypto round trip:** Node encrypt and WebCrypto decrypt, and the reverse. A wrong passphrase fails cleanly. A tampered header fails.
- **Snapshot builder:** secret tables are emptied, no plaintext secrets remain in the file, and metadata and acks are correct.
- **Change apply:**
  - ordering, idempotency (applying the same file twice);
  - the latest-decision skip (including that an import or AI run after the phone edit does **not** cause a skip) and the hash mismatch skip;
  - merchant memory and correction rows written exactly as the desktop route writes them;
  - two devices independently.
- **Outbox:** ack pruning and re-apply on a fresh snapshot.
- **Debounce:** timer reset and the 2-minute cap.
- **Parity:** the shared handler functions return identical payloads under better-sqlite3 and the sql.js adapter for the same synthetic database. This is the guard for "numbers on the phone differ".
- Manual check on a real device or emulator, in English and Hebrew, light and dark, with a workspace seeded from fake data.

## Risks and suggested order

1. **Spike first** (throwaway): prove the Next 16 static-export mobile target can render the Home page with the sql.js adapter and the module aliases in a Capacitor WebView. If static export proves unworkable, the fallback is a small Vite entry that imports the same client components with shims for `next/link`, `next/navigation`, and next-intl. The builder decides after the spike and notes the decision in the plan.
2. Shared crypto and file formats, with tests.
3. PC side: settings page, snapshot writer, change applier, debounce, sidebar sync block.
4. Phone: data layer, router, screens, sync, onboarding.
5. Docs and install guide last, written against the real build steps.

## Left to the builder

- Exact Capacitor plugins (Google sign-in, secure storage, filesystem) and versions.
- Package name and app icon (reuse the Spent logo).
- The exact Next 16 mechanism for the mobile target, after reading `node_modules/next/dist/docs/`.
- Shape of the shared handler functions and the mobile router.
- Exact sync status copy, in both languages.
- Whether `android/` is committed (it usually is with Capacitor), as long as no keystore, client ID, or `local.properties` is committed. Add gitignore entries.

## Answered questions

- **Phone write scope:** only categories. That means changing a transaction's category and approving an AI category. Everything else is view-only on the phone.
- **Propagation speed:** a few minutes from one phone to the PC and the other phone is acceptable. The PC polls the change files every 2 minutes. The phone does not poll while open.

## Calls made during design (not asked of the user)

- Capacitor plus the existing React UI, built as a static-export mobile target, with sql.js on the phone.
- One change file per phone. The PC is the only writer of the snapshot.
- Conflicts: the latest user category decision wins, tracked by a new `category_decided_at` column. Skipped edits are counted and shown.
- 2-minute cap on the 30-second debounce.
- Passphrase-derived key (PBKDF2, 600k iterations) with AES-256-GCM. The passphrase is stored encrypted on the PC and in Android Keystore storage on phones.
- The snapshot strips bank credentials and secret settings.
- The phone language follows the PC's language setting. The theme follows the phone's system theme.
- Each self-hoster builds their own APK with their own Google Cloud OAuth client. No prebuilt APK.
