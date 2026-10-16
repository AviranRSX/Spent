// Builds the phone companion as a static export into out-mobile/.
//
// With `output: "export"` Next always writes its intermediate build to
// `<project>/.next` and only puts the export in `distDir`. The always-on
// desktop service runs from `.next`, so the mobile build must not run in the
// repo root. Instead it runs `next build` in .mobile-build/, a gitignored
// shadow project whose src/ and public/ are junctions to the real ones. Its
// own .next/ and out-mobile/ stay inside it, and out-mobile/ is then copied
// to the repo root.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const shadow = path.join(root, ".mobile-build");
const outDir = path.join(root, "out-mobile");

// Unlinks the junctions first so a recursive delete can never walk into the
// real src/ or public/.
function removeShadow() {
  for (const dir of ["src", "public"]) {
    const link = path.join(shadow, dir);
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
    } catch {
      // Not there.
    }
  }
  rmSync(shadow, { recursive: true, force: true });
}

removeShadow();
mkdirSync(shadow, { recursive: true });

for (const dir of ["src", "public"]) {
  symlinkSync(path.join(root, dir), path.join(shadow, dir), "junction");
}
for (const file of ["next.config.ts", "tsconfig.json", "package.json"]) {
  copyFileSync(path.join(root, file), path.join(shadow, file));
}
// Tailwind scans for class names from its base dir. Point it at the real repo
// so the phone CSS matches the desktop CSS exactly.
writeFileSync(
  path.join(shadow, "postcss.config.mjs"),
  `export default { plugins: { "@tailwindcss/postcss": { base: ${JSON.stringify(root)} } } };\n`
);

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
try {
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: shadow,
    stdio: "inherit",
    env: {
      ...process.env,
      SPENT_TARGET: "mobile",
      SPENT_MOBILE_ROOT: root,
      NEXT_PUBLIC_SPENT_TARGET: "mobile",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    rmSync(outDir, { recursive: true, force: true });
    cpSync(path.join(shadow, "out-mobile"), outDir, { recursive: true });
  }
} finally {
  // Remove the shadow project so its src/ junction never shows up twice to
  // tsc, eslint or the desktop build. Junctions are removed, not followed.
  removeShadow();
}
if (process.exitCode) process.exit(process.exitCode);

copyFileSync(
  path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  path.join(outDir, "sql-wasm.wasm")
);
console.log(`Mobile build written to ${path.relative(root, outDir)}/`);
