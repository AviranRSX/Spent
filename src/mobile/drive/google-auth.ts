// Google sign-in on the phone, through @capgo/capacitor-social-login. The
// plugin is imported lazily so desktop builds and node tests never load it.
import type { SocialLoginPlugin } from "@capgo/capacitor-social-login";

/** Full Drive scope: the snapshot is written by Drive for desktop, not this app, and may sit in a folder shared with the account. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

const WEB_CLIENT_ID = process.env.NEXT_PUBLIC_SPENT_GOOGLE_WEB_CLIENT_ID ?? "";

// Wrapped in an object: a Capacitor plugin is a proxy that answers every
// property, `then` included, so a promise resolved with the plugin itself
// never settles.
let ready: Promise<{ plugin: SocialLoginPlugin }> | null = null;
let cachedToken: string | null = null;

function socialLogin(): Promise<{ plugin: SocialLoginPlugin }> {
  if (!ready) {
    ready = (async () => {
      if (!WEB_CLIENT_ID) {
        throw new Error(
          "google_not_configured: set NEXT_PUBLIC_SPENT_GOOGLE_WEB_CLIENT_ID in .env.mobile and rebuild"
        );
      }
      const { SocialLogin } = await import("@capgo/capacitor-social-login");
      await SocialLogin.initialize({ google: { webClientId: WEB_CLIENT_ID, mode: "online" } });
      return { plugin: SocialLogin };
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Interactive sign-in. Asks for the Drive scope and returns the account email. */
export async function signIn(): Promise<{ email: string }> {
  const { plugin } = await socialLogin();
  const { result } = await plugin.login({
    provider: "google",
    options: { scopes: [DRIVE_SCOPE] },
  });
  if (result.responseType !== "online" || !result.accessToken?.token) {
    throw new Error("signed_out");
  }
  cachedToken = result.accessToken.token;
  return { email: result.profile.email ?? "" };
}

/**
 * A Drive access token. Returns the cached token unless `forceRefresh` is set
 * (the Drive client sets it after a 401). Refreshes silently through the
 * plugin. Throws `offline` when the device is offline and `signed_out` when no
 * token can be had without user interaction.
 */
export async function getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
  if (cachedToken && !options.forceRefresh) return cachedToken;
  cachedToken = null;

  const { plugin } = await socialLogin();
  const refresh = () =>
    plugin.refresh({ provider: "google", options: { scopes: [DRIVE_SCOPE] } });
  try {
    if (options.forceRefresh) await refresh();
    // On Android this validates the stored token and returns null if it expired.
    let { accessToken } = await plugin.getAuthorizationCode({ provider: "google" });
    if (!accessToken) {
      await refresh();
      ({ accessToken } = await plugin.getAuthorizationCode({ provider: "google" }));
    }
    if (!accessToken) throw new Error("signed_out");
    cachedToken = accessToken;
    return accessToken;
  } catch {
    throw new Error(isOffline() ? "offline" : "signed_out");
  }
}

export async function signOut(): Promise<void> {
  cachedToken = null;
  try {
    const { plugin } = await socialLogin();
    await plugin.logout({ provider: "google" });
  } catch {
    // Already signed out, or never configured: nothing to undo.
  }
}
