# Spent on Android: install guide

This guide sets up the Spent Android companion app: an encrypted, read-mostly copy of your Spent data on your phone, kept up to date through a Google Drive folder.

It is written for someone who is comfortable in a terminal but has never built an Android app or used the Google Cloud Console. Commands are for Windows PowerShell first, with macOS and Linux notes where they differ. Plan on about an hour the first time. Most of it is one-time setup.

## Contents

1. [What the phone app is](#1-what-the-phone-app-is)
2. [Turn on phone sync on the PC](#2-turn-on-phone-sync-on-the-pc)
3. [Set up Google Cloud](#3-set-up-google-cloud)
4. [Install the Android toolchain](#4-install-the-android-toolchain)
5. [Create a signing keystore](#5-create-a-signing-keystore)
6. [Build the APK](#6-build-the-apk)
7. [Install on a phone](#7-install-on-a-phone)
8. [Add a second phone](#8-add-a-second-phone)
9. [First run on the phone](#9-first-run-on-the-phone)
10. [Updating the app](#10-updating-the-app)
11. [Changing the passphrase](#11-changing-the-passphrase)
12. [Disconnecting a phone or turning sync off](#12-disconnecting-a-phone-or-turning-sync-off)
13. [Troubleshooting](#13-troubleshooting)

## 1. What the phone app is

Spent on the PC stays the main app. When you turn on phone sync, the PC writes an encrypted snapshot of its database into a folder that Google Drive for desktop syncs. The phone app downloads that snapshot from Drive, decrypts it with your passphrase, and shows the same pages as the PC: Home, Budget, Transactions, Credit card, and Trips.

On the phone you can:

- browse every page and every workspace, offline too, from the last snapshot;
- change a transaction's category;
- approve a category that needs review.

Those two kinds of edit are the only writes. The phone saves them to an encrypted change file in the same Drive folder, and the PC applies them the next time it checks (about every 2 minutes while Spent runs).

The phone app does **not**:

- import bank or card files;
- run AI categorization;
- show or change settings (AI provider, categories, budgets, bank accounts, phone sync). Those stay on the PC;
- sync in the background. It syncs when you open it, when you tap Sync, and about 30 seconds after an edit while the app is open.

Privacy, in short:

- Phone sync is off by default. Even when it is on, Spent on the PC makes no new network connections: it writes files to a local folder, and Google Drive for desktop does the uploading.
- Everything in the Drive folder is encrypted with your passphrase (AES-256-GCM, key derived with PBKDF2-HMAC-SHA256 at 600,000 iterations). Google sees only ciphertext.
- The snapshot never contains your bank logins, your AI API key, or the PC's encryption key. See [SECURITY.md](../SECURITY.md#phone-sync) for details.
- The phone talks only to Google (`www.googleapis.com` and `oauth2.googleapis.com`).

There is no app store listing. You build the APK yourself, signed with your own key, and sideload it. That is what most of this guide is about.

## 2. Turn on phone sync on the PC

You need Spent already installed and running on the PC.

1. **Install Google Drive for desktop** from <https://www.google.com/drive/download/> and sign in with the Google account that will own the folder.
   - You should see: a new drive in File Explorer (often `G:` or `H:`) with a `My Drive` folder inside. On macOS it appears under `~/Library/CloudStorage/` and in the Finder sidebar.
2. **Create a folder for Spent** inside `My Drive`, for example `Spent`. Use an empty folder that holds nothing else.
3. **Copy its full path.** In File Explorer, click the address bar of the folder and copy it. It looks like `H:\My Drive\Spent`. On macOS it looks like `/Users/you/Library/CloudStorage/GoogleDrive-you@example.com/My Drive/Spent`.
4. In Spent, open **Settings > Phone sync**.
5. Under **Sync folder**, paste the path into **Folder path**, click **Check folder**, then **Save folder**.
   - You should see: "Folder is ready", then "Folder saved".
6. Under **Passphrase**, type a passphrase into **New passphrase** and click **Save passphrase**.
   - The minimum is 12 characters. Use a long one: four or five random words, or a password manager entry. Anyone who gets the files from Drive can try to guess it offline, so length is what protects you.
   - You type this passphrase once on each phone, so pick something you can read and type on a phone keyboard.
   - You should see: "Passphrase saved" and "A passphrase is set."
7. Turn on **Sync with the phone app**.
   - You should see: "Phone sync is on". Under **Status**, "Last synced" and "Last snapshot" fill in within a few seconds, and the sidebar footer shows a sync block.
8. In File Explorer, open the folder. Within a minute you should see `snapshot.spent.enc` with a Drive "synced" check mark.

The PC refreshes the snapshot about 30 seconds after you change anything in Spent (at most 2 minutes after the first change), and checks the folder for phone edits every 2 minutes. Spent and Google Drive for desktop both need to be running for that to happen.

## 3. Set up Google Cloud

The phone signs in to Google and talks to the Drive API directly. Google requires every app that does this to have its own OAuth client, so you create one in your own free Google Cloud project. You need it once, no matter how many phones you install on.

Google renames Console pages from time to time. If a menu name differs, look for the closest match. The OAuth settings live under **Google Auth Platform** (older consoles call it **APIs & Services > OAuth consent screen**).

### 3.1 Create a project

1. Open <https://console.cloud.google.com/> and sign in with the Google account that owns the Drive folder.
2. Click the project picker at the top, then **New project**. Name it `Spent` and click **Create**.
3. Make sure the new project is selected in the project picker for every step below.

No billing account is needed.

### 3.2 Enable the Google Drive API

1. Go to **APIs & Services > Library**.
2. Search for **Google Drive API**, open it, and click **Enable**.
   - You should see: the API's overview page with a **Manage** button.

### 3.3 Configure the consent screen

1. Go to **Google Auth Platform > Branding** (or **OAuth consent screen**). If asked, click **Get started**.
2. App information: app name `Spent`, and your email as the support email.
3. Audience: choose **External**. ("Internal" only exists for Google Workspace organizations and blocks regular Gmail accounts.)
4. Contact information: your email. Agree to the policy and click **Create**.
5. Go to **Data Access** (or the **Scopes** step), click **Add or remove scopes**, and add `https://www.googleapis.com/auth/drive` (listed as "See, edit, create, and delete all of your Google Drive files"). Save.
   - Spent needs the full Drive scope because it reads a folder that Drive for desktop created and that may be shared with you by another account.
6. Go to **Audience** and click **Publish app**, then confirm. The publishing status should now read **In production**.

Why production: while an app is in **Testing**, Google expires its sign-ins after 7 days, so the phone would ask you to sign in again every week. In production it does not.

You do **not** need to submit the app for verification. An unverified app in production works for up to 100 users, which is plenty for a household. The cost is a warning screen at sign-in:

> Google hasn't verified this app

When you see it on the phone, tap **Advanced**, then **Go to Spent (unsafe)**, then allow access. It is your own app, built from your own project, so this is expected. You see it once per Google account.

If you prefer to leave the app in **Testing**, add every Google account that will sign in under **Audience > Test users**, and expect to sign in again each week.

### 3.4 Create the Web client

The sign-in plugin (`@capgo/capacitor-social-login`, which uses Android's Credential Manager) needs a **Web application** client id at runtime, even on Android.

1. Go to **Google Auth Platform > Clients** (or **APIs & Services > Credentials > Create credentials > OAuth client ID**).
2. Click **Create client**. Application type: **Web application**. Name: `Spent web`. Leave the origins and redirect URIs empty. Click **Create**.
3. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`. You do not need the client secret.
4. In the Spent repo folder on the PC, create `.env.mobile` from the example and put the id in it:

   ```powershell
   Copy-Item .env.mobile.example .env.mobile
   notepad .env.mobile
   ```

   macOS and Linux: `cp .env.mobile.example .env.mobile`, then edit it.

   The file should contain one line, with your own id:

   ```
   NEXT_PUBLIC_SPENT_GOOGLE_WEB_CLIENT_ID=123456789012-abcdefghijklmnop.apps.googleusercontent.com
   ```

`.env.mobile` is gitignored. The id is baked into the APK at build time, so if you change it, rebuild.

### 3.5 Create the Android client

The **Android** client is never typed into Spent. It tells Google that an APK with package name `dev.spent.app`, signed by your key, may sign in. Using the Android client id in `.env.mobile` is the most common mistake: that file needs the **Web** client id.

You need the SHA-1 fingerprint of your release keystore, so do [step 5](#5-create-a-signing-keystore) first if you have not, then come back.

1. Print the fingerprint (use your keystore path and alias):

   ```powershell
   keytool -list -v -keystore "$HOME\spent-keys\spent-release.jks" -alias spent
   ```

   Enter the keystore password when asked. Copy the line that starts with `SHA1:`, for example `SHA1: AB:CD:EF:...` (20 pairs of hex digits).

2. In **Clients**, click **Create client**. Application type: **Android**. Name: `Spent Android`.
3. Package name: `dev.spent.app`
4. SHA-1 certificate fingerprint: paste the value from step 1.
5. Click **Create**.

Both clients must live in the same Google Cloud project. If you ever sign the APK with a different keystore, add another Android client with that keystore's SHA-1.

## 4. Install the Android toolchain

Building the APK needs a Java JDK (version 21, which Capacitor 8 targets) and the Android SDK. Android Studio installs both and is the easy path.

1. Download and install **Android Studio** from <https://developer.android.com/studio>.
2. Start it once and finish the setup wizard with the **Standard** install type. It downloads the Android SDK.
   - You should see: the "Welcome to Android Studio" window. You do not need to open a project.
3. Set the environment variables. On Windows, Android Studio ships a JDK 21 in its `jbr` folder and puts the SDK in your local app data:

   ```powershell
   [Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
   $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
   [Environment]::SetEnvironmentVariable("Path", "$userPath;C:\Program Files\Android\Android Studio\jbr\bin", "User")
   ```

   Close and reopen PowerShell so the new values load.

   macOS (zsh), add to `~/.zshrc`:

   ```bash
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$JAVA_HOME/bin:$PATH"
   ```

   Linux, add to `~/.bashrc` (adjust to where you unpacked Android Studio):

   ```bash
   export JAVA_HOME="$HOME/android-studio/jbr"
   export ANDROID_HOME="$HOME/Android/Sdk"
   export PATH="$JAVA_HOME/bin:$PATH"
   ```

4. Check:

   ```powershell
   java -version
   Test-Path "$env:ANDROID_HOME\platform-tools"
   ```

   You should see: a version line that starts with `openjdk version "21`, and `True`. On macOS and Linux use `ls "$ANDROID_HOME/platform-tools"`.

If you already have a JDK 21 and an SDK installed some other way, point `JAVA_HOME` and `ANDROID_HOME` at them instead. `ANDROID_SDK_ROOT`, or `sdk.dir` in `android/local.properties`, also works for the SDK.

## 5. Create a signing keystore

Android only installs signed APKs, and it only lets an update replace an installed app when both are signed with the same key. The keystore holds that key.

1. Create a folder **outside** the repo and generate the keystore in it:

   ```powershell
   New-Item -ItemType Directory -Force "$HOME\spent-keys"
   keytool -genkeypair -v -keystore "$HOME\spent-keys\spent-release.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias spent
   ```

   macOS and Linux: `mkdir -p ~/spent-keys`, then the same `keytool` line with `~/spent-keys/spent-release.jks`.

2. `keytool` asks for a keystore password, your name and organization (anything is fine), and a key password. Pressing Enter at the key password prompt reuses the keystore password.
   - You should see: `Storing ...spent-release.jks` at the end.
3. **Back it up now.** Copy `spent-release.jks` and both passwords into your password manager or another safe place.
   - If you lose the keystore, you cannot update the installed app. You would have to uninstall it, which deletes its local data, install an APK signed with a new key, add a new Android client with the new SHA-1 ([3.5](#35-create-the-android-client)), and connect each phone again.
4. **Never commit it.** Keep it out of the repo folder. The repo also ignores `*.jks` and `*.keystore`, as a safety net.

Now go back and finish [3.5 Create the Android client](#35-create-the-android-client) if you skipped it.

## 6. Build the APK

The build reads the signing settings from four environment variables, so the passwords never appear on a command line or in a file in the repo.

| Variable | Value |
| --- | --- |
| `SPENT_KEYSTORE_PATH` | Path to the keystore, for example `$HOME\spent-keys\spent-release.jks` |
| `SPENT_KEYSTORE_PASSWORD` | The keystore password |
| `SPENT_KEY_ALIAS` | The alias you used, `spent` in this guide |
| `SPENT_KEY_PASSWORD` | The key password (the keystore password if you pressed Enter) |

1. Open PowerShell in the Spent repo folder and make sure dependencies are installed (`npm install`).
2. Set the variables for this session only. `Read-Host -AsSecureString` keeps the passwords out of your shell history:

   ```powershell
   $env:SPENT_KEYSTORE_PATH = "$HOME\spent-keys\spent-release.jks"
   $env:SPENT_KEY_ALIAS = "spent"
   $env:SPENT_KEYSTORE_PASSWORD = [Net.NetworkCredential]::new("", (Read-Host "Keystore password" -AsSecureString)).Password
   $env:SPENT_KEY_PASSWORD = [Net.NetworkCredential]::new("", (Read-Host "Key password" -AsSecureString)).Password
   ```

   macOS and Linux:

   ```bash
   export SPENT_KEYSTORE_PATH="$HOME/spent-keys/spent-release.jks"
   export SPENT_KEY_ALIAS=spent
   read -rs -p "Keystore password: " SPENT_KEYSTORE_PASSWORD; echo; export SPENT_KEYSTORE_PASSWORD
   read -rs -p "Key password: " SPENT_KEY_PASSWORD; echo; export SPENT_KEY_PASSWORD
   ```

3. Build:

   ```powershell
   npm run mobile:apk
   ```

   This runs three stages:
   - `npm run mobile:build`: a static export of the phone pages into `out-mobile/`. It never touches the PC app's `.next/` build, so it is safe while the Spent service is running.
   - `npx cap sync android` (via `npm run mobile:sync`): copies `out-mobile/` into the Android project.
   - `scripts/mobile/assemble-release.mjs`: checks Java, the SDK, the four signing variables and the keystore file, then runs Gradle's `assembleRelease`.

   The first Gradle run downloads its dependencies and can take several minutes.

   You should see, at the end:

   ```
   Release APK: android\app\build\outputs\apk\release\app-release.apk
   ```

If a check fails, the script stops with a line that starts with `Cannot build the release APK:` and says what is missing. See [Troubleshooting](#build-errors).

## 7. Install on a phone

1. **Copy the APK to the phone.** Any way works: a USB cable (the phone shows up as a drive; copy into `Download`), upload to your own Google Drive and open it on the phone, or a message to yourself. The file is `android\app\build\outputs\apk\release\app-release.apk`. You can rename it, for example to `spent.apk`.
2. **Open it on the phone** from the Files app (or the Drive app).
3. **Allow installs from that app.** Android says the app you used to open the file is not allowed to install unknown apps. Tap **Settings**, turn on **Allow from this source**, and go back. The exact wording varies by phone maker. On Samsung it is under **Settings > Apps > Special access > Install unknown apps**.
4. Tap **Install**. If Google Play Protect warns about an unknown developer, tap **More details > Install anyway**. It does not recognize your personal key, which is expected.
   - You should see: "App installed", and a **Spent** icon in the app drawer.
5. Optionally, turn **Allow from this source** off again for the Files app.

With a USB cable and USB debugging enabled you can also run `adb install android\app\build\outputs\apk\release\app-release.apk` (`adb` is in `$env:ANDROID_HOME\platform-tools`).

## 8. Add a second phone

Each phone signs in with its own Google account. A phone whose account does not own the folder needs access to it.

1. On the PC, open <https://drive.google.com> as the account that owns the folder.
2. Right-click the `Spent` folder, choose **Share**, enter the other person's Google account, and set the role to **Editor**. Editor is required: the phone writes its change file into the folder. Click **Send**.
3. If the consent screen is still in **Testing** ([3.3](#33-configure-the-consent-screen)), add that account under **Google Auth Platform > Audience > Test users**. In production you can skip this.
4. Install the same APK on the second phone ([step 7](#7-install-on-a-phone)) and go through the first run below. The shared folder shows up in the folder list with the owner's email.

Both phones use the same passphrase.

## 9. First run on the phone

Make sure the PC has written a snapshot first (`snapshot.spent.enc` in the folder, [step 2](#2-turn-on-phone-sync-on-the-pc)), and give Drive for desktop a minute to upload it.

1. **Sign in.** Open Spent. The "Connect this phone to Spent" screen appears. Tap **Sign in with Google** and pick the Google account. Allow access to Google Drive. If you see "Google hasn't verified this app", tap **Advanced > Go to Spent (unsafe)** ([why](#33-configure-the-consent-screen)).
   - You should see: "Signed in as you@example.com" and the folder step.
2. **Pick the folder.** The list shows every folder in this account's Drive that holds a Spent snapshot, with its owner. Tap your `Spent` folder. If the list is empty, tap **Look again** after a minute, and see [Troubleshooting](#on-the-phone).
3. **Enter the passphrase** you set on the PC and tap **Unlock**. The phone downloads the snapshot and checks the passphrase against it before saving anything.
4. **Name the phone**, for example `Dana's phone`, and tap **Finish**. The PC shows this name in its list of phones.
   - You should see: the Home page with your data, and a sync block in the sidebar footer that reads "Last synced: ...".

After your first category change syncs, the phone appears under **Settings > Phone sync > Phones** on the PC with its last-seen time and the number of changes applied.

### Day-to-day use

- Open the sidebar to see the sync block. **Sync** syncs now. The menu next to it has **Sync now**, **Sign in again** (when Google signed you out), **Enter new passphrase** (when the PC passphrase changed), and **Disconnect this phone**.
- Edits you make show "N changes waiting" until the PC has applied them and written a new snapshot. That usually takes 2 to 5 minutes with the PC on. If the PC is off, edits wait on the phone and in Drive until it is back.
- If the PC also changed the same transaction's category after your phone edit, the PC's later decision wins and your edit is counted as skipped on the PC's Phones table.

## 10. Updating the app

Rebuild and reinstall the APK whenever you update Spent on the PC with changes that affect the phone. The phone tells you when it must be updated: "Update the phone app". To be safe, rebuild after every Spent update.

1. Update the repo and the PC app as usual.
2. Set the four signing variables again ([step 6](#6-build-the-apk)) with the **same keystore**, and run `npm run mobile:apk`.
3. Copy the new `app-release.apk` to each phone and install it over the existing app. Android shows **Update** instead of Install.

Your data, sign-in, passphrase, phone name, and any changes still waiting stay as they were. If Android says "App not installed" or "package conflicts with an existing package", the APK was signed with a different key ([Troubleshooting](#on-the-phone)).

## 11. Changing the passphrase

1. On the PC, open **Settings > Phone sync**, type the new passphrase into **New passphrase**, and click **Save passphrase**. The PC rewrites the snapshot with the new passphrase right away.
2. On each phone, open Spent. After it syncs, the sidebar sync block shows "Passphrase is wrong".
3. Open the sync menu, tap **Enter new passphrase**, type the new one, and tap **Unlock**.
   - You should see: "Last synced" updates. Changes that were waiting on the phone are kept and re-sent under the new passphrase.

Until a phone has the new passphrase, the PC's Phones table may show "Can't read this phone's changes: passphrase differs" for it. That clears once the phone re-sends its changes.

## 12. Disconnecting a phone or turning sync off

**Disconnect a phone** (for example before giving it away):

1. On the phone, open the sidebar sync menu and tap **Disconnect this phone**.
2. Read the dialog. If changes have not reached the PC yet, it says how many will be lost. Tap **Sync** first and wait for "Last synced" if you want to keep them.
3. Tap **Disconnect**. The phone deletes its local copy of the data, its passphrase, and its Google sign-in, and goes back to the setup screen. Nothing on the PC or in Drive is deleted.
4. Optionally, uninstall the app, and remove the app's access at <https://myaccount.google.com/permissions>.

**Turn phone sync off** on the PC: switch off **Sync with the phone app** in **Settings > Phone sync**. The PC stops writing snapshots and reading change files. The files already in the Drive folder stay; delete the folder's contents if you want them gone from Drive. Phones keep showing their last copy until disconnected.

## 13. Troubleshooting

### Build errors

`npm run mobile:apk` stops with `Cannot build the release APK:` followed by one of these:

| Message | Cause | Fix |
| --- | --- | --- |
| `no Java found...` | `JAVA_HOME` is unset or wrong, and `java` is not on `PATH`. | Set `JAVA_HOME` to a JDK 21 ([step 4](#4-install-the-android-toolchain)) and open a new terminal. |
| `no Android SDK found...` | `ANDROID_HOME`, `ANDROID_SDK_ROOT` and `android/local.properties` all missing or wrong. | Set `ANDROID_HOME` to the SDK folder ([step 4](#4-install-the-android-toolchain)) and open a new terminal. |
| `missing signing settings: ...` | One or more of the four `SPENT_*` variables is not set in this terminal. | Set them again ([step 6](#6-build-the-apk)). They last only for the current session. |
| `SPENT_KEYSTORE_PATH points to ..., which does not exist.` | Typo in the path, or the keystore moved. | Fix the path. Use the full path. |
| `Gradle exited with status 1.` | Gradle failed. The real error is in the Gradle output above it. A wrong keystore password shows as `Keystore was tampered with, or password was incorrect`. | Read the Gradle output. For a password error, set the password variables again. |

If the phone build itself fails earlier, during `mobile:build`, run `npm run mobile:build` on its own to see the Next.js error.

### On the PC

The PC shows errors in the **Status** card under **Settings > Phone sync** and in the sidebar sync block.

| Message | Cause | Fix |
| --- | --- | --- |
| Folder not found | The folder path does not exist, or Google Drive for desktop is not running, so its drive letter is gone. | Start Google Drive for desktop, check the path with **Check folder**, and save it again if the drive letter changed. |
| Can't write to the folder | The folder exists but Spent cannot create files in it (read-only, or a permissions problem). | Pick a folder inside `My Drive` that your user can write to. |
| Passphrase needed | No passphrase is set, or the stored one cannot be decrypted on this PC (for example after `data/.encryption-key` was replaced). | Set the passphrase again under **Passphrase**. Use the same one as the phones, or update the phones ([step 11](#11-changing-the-passphrase)). |
| The stored passphrase can't be read on this PC. Set it again. | Same as above, shown under **Passphrase**. | Set it again. |
| Sync failed | An unexpected error while building or writing the snapshot. The service log has the details. | Click **Sync now** to retry. The PC also retries every 2 minutes. If it persists, check the service log. |
| Enter an absolute path | **Check folder** got a relative path, like `Spent` or `.\Spent`. | Paste the full path, like `H:\My Drive\Spent`. |
| Couldn't save. Check the values and try again. | The PC rejected the value, for example a relative folder path or a passphrase under 12 characters. | Use a full folder path and a passphrase of at least 12 characters. |
| Set a folder and a passphrase first. | Sync cannot be turned on until both are set. | Do steps 5 and 6 of [section 2](#2-turn-on-phone-sync-on-the-pc). |

The **Phones** table shows one line per phone when that phone's change file could not be used:

| Message | Cause | Fix |
| --- | --- | --- |
| Can't read this phone's changes: passphrase differs | The phone encrypted its changes with another passphrase, usually right after a passphrase change. | Enter the new passphrase on that phone ([step 11](#11-changing-the-passphrase)). |
| Can't read this phone's changes: file is damaged | The change file is incomplete or corrupt, often because Drive for desktop had not finished downloading it. | Wait a few minutes. The PC retries every 2 minutes, and the phone rewrites the file after its next edit or the next time the app opens. |
| Can't read this phone's changes: update Spent on the PC | The phone app is newer than Spent on the PC and wrote a format the PC does not know. | Update Spent on the PC. |
| Couldn't apply this phone's changes | The file decrypted but applying it failed. The service log has the details. | Retry with **Sync now**. If it persists, check the service log. |
| Couldn't read this phone's changes | Any other failure reading the file. | Retry. Check the service log. |

### On the phone

| Message | Cause | Fix |
| --- | --- | --- |
| This build has no Google sign-in configured. See the phone app guide. | The APK was built without `NEXT_PUBLIC_SPENT_GOOGLE_WEB_CLIENT_ID`. | Create `.env.mobile` with the Web client id ([3.4](#34-create-the-web-client)), rebuild, and reinstall. |
| Couldn't sign in. Check your connection and try again. | No connection, or Google rejected the app. The usual reasons: `.env.mobile` has the Android client id instead of the Web one; the Android client's SHA-1 is not your release keystore's; the package name is not `dev.spent.app`; the clients are in different projects; or the consent screen is in Testing and this account is not a test user. | Check each item in [section 3](#3-set-up-google-cloud). After fixing `.env.mobile`, rebuild. After fixing the Console, wait a few minutes and try again. For details, connect the phone by USB and run `adb logcat \| Select-String GoogleProvider` while signing in; the plugin logs the package name and SHA-1 it used. |
| No Spent folder found yet. ... | This account cannot see a folder with `snapshot.spent.enc` in it. | Check that the PC shows "Last snapshot" and that the file is in Drive at <https://drive.google.com>. For a second account, share the folder as Editor ([step 8](#8-add-a-second-phone)). Tap **Look again**. |
| That passphrase doesn't open this folder's snapshot. | Wrong passphrase during setup. | Use the passphrase from **Settings > Phone sync** on the PC. It is case sensitive. |
| That passphrase doesn't open the snapshot. Use the one set in Spent on the PC under Phone sync. | Wrong passphrase on the unlock screen. | Same as above. |
| Passphrase is wrong | The passphrase changed on the PC. | Sync menu > **Enter new passphrase** ([step 11](#11-changing-the-passphrase)). |
| Offline | The phone has no connection. | Nothing to do. The last copy stays readable and edits wait. Tap **Sync** when back online. |
| Signed out of Google | Google ended the sign-in: the access was removed at myaccount.google.com, the password changed, or the consent screen is in Testing and 7 days passed. | Sync menu > **Sign in again**. If it happens every week, publish the consent screen to production ([3.3](#33-configure-the-consent-screen)). |
| Folder not found | The folder or `snapshot.spent.enc` is gone, it was unshared from this account, or the phone caught the PC mid-write. | Try **Sync** again in a minute. If it persists, check the folder in Drive and the sharing. To pick another folder, **Disconnect this phone** and set it up again. |
| Sync file is damaged | The snapshot in Drive could not be read (often a partial upload), or the phone's own list of waiting changes was damaged and was set aside. | Try again in a few minutes. The phone keeps its last good copy meanwhile. |
| Update the phone app | The PC's Spent is newer than the phone app (for example, a database migration). | Rebuild the APK and install it over the old one ([step 10](#10-updating-the-app)). |
| Update Spent on the PC | The phone app is newer than Spent on the PC. | Update Spent on the PC, or install an APK built from the same version as the PC. |
| Sync failed | An unexpected Drive or app error. | Tap **Sync** again. If it persists, disconnect and set the phone up again. |
| Your data isn't on this phone yet | The first download failed. The reason is shown below it. | Fix the reason using this table, then tap **Try again**. |

Android install problems:

| Problem | Cause | Fix |
| --- | --- | --- |
| "App not installed" or "package conflicts with an existing package" when updating | The new APK was signed with a different keystore than the installed one. | Build with the original keystore. If it is lost, uninstall the old app first (its local data is deleted) and set the phone up again. |
| No **Install** button, or "For your security, your phone is not allowed to install unknown apps" | Unknown-app installs are off for the app that opened the APK. | Allow it for that app ([step 7](#7-install-on-a-phone)). |
| "There was a problem parsing the package" | The APK copy is incomplete. | Copy the file again. |
