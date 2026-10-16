# Security

Spent is designed to run **only on your own machine**. The threat model
below assumes you are not deploying this as a hosted service. If you do
deploy it, almost none of the assumptions hold.

## Assets

| Asset | Location | How it's protected |
|-------|----------|--------------------|
| Bank credentials | `data/spent.db` (`bank_credentials` table) | Encrypted with AES-256-GCM |
| Claude API key | `data/spent.db` (`settings` table) | Encrypted with AES-256-GCM |
| Encryption key | `data/.encryption-key` | File permissions `0o600` (owner read-write only). **Not encrypted itself.** |
| Transaction data | `data/spent.db` (`transactions` table). With phone sync on, also a copy in your Google Drive folder and on each phone | Plaintext inside the SQLite file on the PC. The Drive and phone copies are encrypted with your passphrase (see "Phone sync") |
| Phone sync snapshot | `snapshot.spent.enc` in the Google Drive folder, and a copy in each phone's app-private storage | AES-256-GCM, key derived from your passphrase |
| Phone change files | `changes-<deviceId>.spent.enc` in the Google Drive folder, and the outbox (`outbox.bin`) in the phone's app-private storage | AES-256-GCM, key derived from your passphrase |
| Phone sync passphrase (PC) | `data/spent.db` (`settings` table, `phone_sync_passphrase_*`) | Encrypted with AES-256-GCM under the local key in `data/.encryption-key` |
| Phone sync passphrase (phone) | App secure storage (with the device id, phone name and folder id) | Encrypted with a key held in the Android Keystore |
| Google OAuth tokens (phone) | Google Play services holds the account authorization. The sign-in plugin keeps the short-lived Drive access token in the app's private storage | App sandbox. Excluded from Android backups. Removed on "Disconnect this phone" |

## What's protected at rest

Bank credentials and the Claude API key never sit on disk in plaintext.
They're encrypted with a 32-byte random key (`data/.encryption-key`)
using AES-256-GCM with a fresh IV per write. Anyone who reads the DB
file alone cannot decrypt them.

## What's NOT protected at rest

- The encryption key file itself is plaintext (hex). Whoever can read
  `data/.encryption-key` AND `data/spent.db` can decrypt your
  credentials.
- Transaction data (merchant, amount, date, category) is plaintext in
  the SQLite file. Someone with disk access can see all your spending.

The right defense for both is **full-disk encryption on your laptop**
(FileVault on macOS, BitLocker on Windows, LUKS on Linux). Turn it on.

## Phone sync

Phone sync is optional and off by default. When you turn it on in
**Settings > Phone sync**, the PC writes an encrypted snapshot of its
database into a folder that Google Drive for desktop syncs, and reads
encrypted change files that phones write there. Install guide:
[docs/phone-app.md](docs/phone-app.md).

**What the snapshot strips.** The snapshot is a `VACUUM INTO` copy of
`data/spent.db`, cleaned before it is encrypted:

- `bank_credentials` rows are kept (transactions and sync history
  reference them), but their `credentials_encrypted`, `iv` and
  `auth_tag` columns are blanked.
- `settings` and `workspace_settings` rows whose key ends in
  `_encrypted`, `_iv` or `_auth_tag` (for example the Claude API key),
  or starts with `phone_sync_` (the passphrase and sync state), are
  deleted.
- The file is rewritten with `VACUUM` so deleted values do not linger
  in free pages.
- `data/.encryption-key` is never read into the snapshot.

Everything else is included: transactions, categories, budgets,
merchant memory, trips, and workspace data. That includes the error
text stored in `sync_runs` (import and scraper run history).

**File format.** Every file in the folder (snapshot and change files)
uses the same envelope: the magic bytes `SPNT`, a format version byte,
a 16-byte random salt, and a 12-byte random IV, followed by the
gzip-compressed payload encrypted with AES-256-GCM. The key is derived
from the passphrase with PBKDF2-HMAC-SHA256 at 600,000 iterations, with
a fresh salt per file. The header is authenticated as additional data,
so tampering with it fails decryption. The snapshot is written to a
`.tmp` file and renamed into place.

**Passphrase.** At least 12 characters. It is the only thing between
the files in your Drive and anyone who obtains them, and they can be
attacked offline, so use a long one (several random words, or a
password manager entry). On the PC it is stored encrypted with the
local key. On phones it is stored in secure storage backed by the
Android Keystore.

**Network.** The PC makes no new network connections: it only writes
and reads files in a local folder, and Google Drive for desktop does
the uploading. Phones contact only `www.googleapis.com` (Drive API)
and `oauth2.googleapis.com` (Google sign-in tokens). Phones never
contact the PC.

**On the phone.** The app's local copy of the snapshot and its outbox
are encrypted with the passphrase in app-private storage. The manifest
sets `android:allowBackup="false"` with backup and data extraction
rules that exclude everything, so none of it goes to Android cloud
backups or device-to-device transfers. While the app is open, the
decrypted database lives in memory. "Disconnect this phone" deletes
the local files, the stored passphrase and ids, and signs out of
Google. The phone can only change a transaction's category or approve
one; the PC applies those edits with the same code as its own UI.

## Network surface

The dev server binds to `127.0.0.1` only. It is not reachable from your
local network or the internet. The library only contacts:

- Your bank's domains (e.g., `digital.isracard.co.il`): via Puppeteer
- `api.anthropic.com`: only if Claude is your AI provider
- `localhost:11434`: only if Ollama is your AI provider
- `www.google.com`: favicon API for bank logos (only the domain
  name leaves your machine, no credentials)

Phone sync adds nothing here: the PC only writes files to a local
folder. The phones, when you install them, contact `www.googleapis.com`
and `oauth2.googleapis.com` (see "Phone sync" above).

Run with `mitmproxy` or Charles to verify this yourself.

## Chromium sandbox

The scraper launches Chromium via Puppeteer. By default we leave Chromium's
renderer sandbox **on**: if a compromised bank page or a chained Chromium
CVE ever triggers RCE in the renderer, the sandbox contains it instead of
giving an attacker the same OS-user privileges as the Spent process.

The sandbox works out of the box on macOS, Windows, and most Linux installs.
It fails to start in two scenarios:

- Running as root on Linux
- Running inside a Docker container without the kernel capabilities the
  Chromium sandbox needs (most off-the-shelf images)

In those cases set `SPENT_DISABLE_CHROMIUM_SANDBOX=1` in your environment.
Prefer running as a non-root user instead when you can; that keeps the
sandbox on.

## CSRF defense

Next.js middleware (`src/middleware.ts`) rejects any mutating API
request (POST/PUT/PATCH/DELETE) whose `Origin` or `Referer` header
doesn't match the app's own host. This prevents a malicious tab in
your browser from triggering syncs / category changes against your
localhost.

## Browser security headers

Configured in `next.config.ts`:

- `X-Frame-Options: DENY`: no embedding in iframes
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: camera, microphone, geolocation, payment all disabled
- `Content-Security-Policy`: restricts script/style/connect sources

## Dependency hygiene

The credential-touching libraries are pinned to exact versions in
`package.json` (no caret prefix):

- `israeli-bank-scrapers`: scrapes your bank with your password
- `better-sqlite3`: reads/writes the DB file
- `@anthropic-ai/sdk`: sends data to Claude

Run `npm run security:audit` to check for known vulnerabilities, and
`npm run security:outdated` to see if anything is out of date. Re-audit
after every upgrade.

## Threats this design accepts

| Threat | Why we accept it |
|--------|------------------|
| Local attacker with file system access | Out of scope for a local app. Use full-disk encryption. |
| Compromised laptop / malware | Out of scope. Don't run untrusted code. |
| Supply chain attack on a transitive dependency | Real, mitigated by pinning + `npm audit`. |
| Bank changes its UI and the scraper breaks | Library updates fix this; we pin so they don't auto-upgrade. |
| Bank blocks/flags automated logins | Possible. Many banks tolerate it; some don't. |
| Memory dump of the Node.js process | If you can do this you've already won. |
| Offline brute force of the Drive files (phone sync) | Anyone with the files can guess passphrases offline. PBKDF2 at 600,000 iterations slows this down, but only a long passphrase stops it. Use one. |
| Lost or stolen unlocked phone (phone sync) | Whoever holds an unlocked phone with Spent open sees your data, as with any app. Use a screen lock. There is no remote disconnect, so change the passphrase on the PC: the lost phone keeps its last copy but cannot read new snapshots. |
| Compromised Google account (phone sync) | The attacker gets the encrypted files only. They learn nothing unless the passphrase is weak. Change the passphrase on the PC and secure the account. |

## What to do if you're more paranoid

In rough order of effort vs. benefit:

1. **Enable full-disk encryption** on your laptop (highest payoff)
2. **Enable login notifications** at your bank
3. **Use a unique strong password** for the bank account (not reused)
4. **Pin dependency versions** (already done for the sensitive libraries)
5. **Audit `node_modules/israeli-bank-scrapers/lib/` once** to convince
   yourself it only touches bank domains. ~300 lines per scraper.
6. **Use a separate, low-limit credit card** for daily spending and only
   track that one in Spent
7. **Run sync with `Show browser during sync` enabled** the first few
   times so you can watch Puppeteer drive the bank's actual login page
8. **Monitor outbound network traffic** with `mitmproxy` or Little Snitch
9. **Move `data/.encryption-key` into your OS keychain** (macOS Keychain,
   Windows DPAPI, Linux Secret Service). Not implemented yet; see the
   roadmap below.

## Roadmap improvements

These would meaningfully harden the app. None of them are required for
a personal local install; each adds friction in exchange for additional
defense.

- **Master password to unlock the app on startup.** Derive the
  encryption key from the password via Argon2id. Removes
  `data/.encryption-key` from disk entirely.
- **OS keychain integration** for the encryption key (macOS Keychain
  via `node-keytar`, etc.).
- **Whole-DB encryption** with SQLCipher instead of just the credential
  columns. Hides transaction data from anyone with disk access.
- **Per-credential key wrapping** (KEK/DEK pattern) so a compromised
  key only exposes one credential at a time.
- **Audit log** of every API mutation with timestamps.

## Always-on service

If you install Spent as a background service (`npm run service:install`),
the server runs from login to logout (or from boot to shutdown). This
changes how some surfaces look. The guarantees:

**The server still binds only to `127.0.0.1`.** The `npm run start`
script hardcodes `-H 127.0.0.1 -p 41234`, and every per-OS template
(LaunchAgent plist, systemd unit, Task Scheduler XML) invokes it with
those flags. The installer runs a post-install check and refuses to
finish if it detects the server listening on a non-loopback address.

**No new daemon runs as root or SYSTEM.** The installer refuses to run
as root. The LaunchAgent and systemd user unit run under your user.
The Windows scheduled task uses `LeastPrivilege` and runs as the
installing user, not as `SYSTEM`.

**The hostname is loopback-only.** Spent uses `spent.localhost`, which
RFC 6761 reserves as loopback. macOS and Linux resolve `*.localhost`
to `127.0.0.1` natively through the system resolver, so no hosts file
edit is needed there. On Windows, `npm run service:install` appends
`127.0.0.1 spent.localhost` to the hosts file as a compatibility
fallback (the only step that requires elevation, and it prompts
interactively). The block is bracketed with markers and removed
cleanly by `npm run service:uninstall`. No mDNS / Bonjour service is
ever registered, and the loopback address never resolves from another
device on your network.

**The health endpoint discloses minimum information.** `GET /api/health`
returns `{ok, version, hasDb}` and nothing else. No transaction counts,
no provider names, no setup status. Add to it only if you have thought
carefully about what a local cross-app attacker could learn.

**The macOS menu bar app has no network entitlements beyond loopback.**
`Spent.app` ships with an `NSAppTransportSecurity > NSExceptionDomains`
entry whitelisting `127.0.0.1` and nothing else. It cannot reach the
internet even if its code were modified to try, without re-signing the
bundle with a different Info.plist.

**Logs do not leak credentials.** macOS LaunchAgent stdout/stderr go to
`~/Library/Logs/Spent/{out,err}.log` (directory mode `0700`). Linux
systemd writes to `~/.local/state/spent/log/`. The app itself already
avoids logging credentials (see "What's protected at rest" above);
the always-on service does not change that.

**The encryption key file's permissions are now asserted at startup.**
`src/server/lib/encryption.ts` reads `data/.encryption-key` and refuses
to start if the file mode is not `0600` (POSIX only; Windows relies on
the user profile ACL). If you ever `chmod 644` the key file by accident,
the server will fail loudly with the fix command.

**What the always-on service does not protect against:**

- A local attacker who can already run code as your user. They can read
  the DB and key file with or without the service running.
- A malicious browser tab on your machine doing a CSRF against
  `127.0.0.1:41234`. The same-origin middleware in
  `src/middleware.ts` already blocks this on every mutating request,
  and that protection works the same whether the server runs on demand
  or always-on.

## Reporting a security issue

This is a personal project. If you find a security issue, open an issue
on the repo. There is no bug bounty.
