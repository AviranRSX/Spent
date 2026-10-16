// Builds a signed release APK of the Android companion with the Gradle
// wrapper. Run through `npm run mobile:apk`, which syncs the web build first.
//
// Needs a JDK (JAVA_HOME or `java` on PATH), the Android SDK (ANDROID_HOME,
// ANDROID_SDK_ROOT, or sdk.dir in android/local.properties) and the signing
// settings below. android/app/build.gradle reads the same env vars, so the
// passwords never appear on a command line.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const androidDir = path.join(root, "android");
const isWindows = process.platform === "win32";

function fail(message) {
  console.error(`\nCannot build the release APK: ${message}\n`);
  process.exit(1);
}

function hasJava() {
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    return existsSync(path.join(javaHome, "bin", isWindows ? "java.exe" : "java"));
  }
  const probe = spawnSync("java", ["-version"], { stdio: "ignore" });
  return probe.status === 0;
}

function androidSdkDir() {
  for (const name of ["ANDROID_HOME", "ANDROID_SDK_ROOT"]) {
    const dir = process.env[name];
    if (dir && existsSync(dir)) return dir;
  }
  const localProperties = path.join(androidDir, "local.properties");
  if (existsSync(localProperties)) {
    const match = readFileSync(localProperties, "utf8").match(/^sdk\.dir=(.+)$/m);
    if (match) {
      // local.properties escapes ':' and '\' on Windows.
      const dir = match[1].trim().replace(/\\:/g, ":").replace(/\\\\/g, "\\");
      if (existsSync(dir)) return dir;
    }
  }
  return null;
}

if (!hasJava()) {
  fail(
    "no Java found. Install a JDK (version 21 is what Capacitor 8 targets) and set JAVA_HOME, or put `java` on PATH."
  );
}
if (!androidSdkDir()) {
  fail(
    "no Android SDK found. Install it (for example with Android Studio) and set ANDROID_HOME or ANDROID_SDK_ROOT, or add sdk.dir to android/local.properties."
  );
}

const SIGNING_VARS = [
  "SPENT_KEYSTORE_PATH",
  "SPENT_KEYSTORE_PASSWORD",
  "SPENT_KEY_ALIAS",
  "SPENT_KEY_PASSWORD",
];
const missing = SIGNING_VARS.filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(
    `missing signing settings: ${missing.join(", ")}. Set all of ${SIGNING_VARS.join(", ")}. A keystore can be created with: keytool -genkeypair -v -keystore spent-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias spent`
  );
}
const keystore = path.resolve(process.env.SPENT_KEYSTORE_PATH);
if (!existsSync(keystore)) {
  fail(`SPENT_KEYSTORE_PATH points to ${keystore}, which does not exist.`);
}
if (!existsSync(androidDir)) {
  fail("android/ is missing. Run `npx cap add android` first.");
}

// Relative wrapper names with cwd set, so a repo path with spaces is never
// split by the Windows shell that .bat files need.
const options = {
  cwd: androidDir,
  stdio: "inherit",
  env: { ...process.env, SPENT_KEYSTORE_PATH: keystore },
};
const result = isWindows
  ? spawnSync("gradlew.bat assembleRelease", { ...options, shell: true })
  : spawnSync("./gradlew", ["assembleRelease"], options);
if (result.status !== 0) {
  fail(`Gradle exited with status ${result.status ?? "unknown"}.`);
}

console.log(
  `\nRelease APK: ${path.join("android", "app", "build", "outputs", "apk", "release", "app-release.apk")}`
);
