import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor shell for the Spent Android companion. The web layer is the static
// export from `npm run mobile:build` (out-mobile/).
//
// Native plugins (all pinned with --save-exact; each release was at least two
// weeks old when chosen):
// - @capacitor/core, @capacitor/android, @capacitor/cli 8.5.2: current stable
//   major. 8.5.3 was under two weeks old.
// - @capacitor/filesystem 8.1.3: app-private snapshot and outbox files in
//   Directory.Data (src/mobile/storage/local-files.ts).
// - @capacitor/app 8.1.1: foreground and background events for sync triggers.
// - @capgo/capacitor-social-login 8.5.12: Google sign-in through Android
//   Credential Manager plus AuthorizationClient. It accepts extra scopes at
//   login and returns an OAuth access token, which the Drive REST client
//   needs for the full `drive` scope. Extra scopes require MainActivity to
//   implement ModifiedMainActivityForSocialLoginPlugin and forward the
//   authorization result (see android/app/src/main/java/.../MainActivity.java).
// - capacitor-secure-storage-plugin 0.13.0: values are encrypted with a key
//   kept in the Android Keystore. Chosen over @aparajita/capacitor-secure-storage
//   because that one pulls @capacitor/ios and @capacitor/keyboard in as
//   runtime dependencies, which would add an unused native plugin to the APK.
const config: CapacitorConfig = {
  appId: "dev.spent.app",
  appName: "Spent",
  webDir: "out-mobile",
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;
