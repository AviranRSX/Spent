import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const SECURITY_HEADERS = [
  // Block embedding in iframes from other origins.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop the browser from MIME-sniffing responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak the originating URL on outbound links.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down browser capabilities this app never needs.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // CSP for a local-only app: only same-origin scripts/styles + Google
  // fonts + bank favicons (s2/favicons redirects to *.gstatic.com). Inline
  // styles allowed for shadcn/Tailwind.
  // 'unsafe-inline' on scripts is necessary because Next dev injects them.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com",
      "connect-src 'self' https://api.anthropic.com http://localhost:11434 ws://127.0.0.1:* ws://localhost:*",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const desktopConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "israeli-bank-scrapers"],
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

// Phone companion build. Only scripts/mobile/build.mjs sets SPENT_TARGET,
// and it runs `next build` in a shadow project dir so that Next's
// intermediate .next/ (always used with output: "export") never touches the
// repo's .next/, which the always-on desktop service runs from.
// The export holds only the *.mobile.tsx files. Server modules the
// in-process router (src/mobile/router.ts) pulls in are swapped for phone
// ones. Final alias list:
//   server-only              -> src/mobile/empty.ts
//   @/server/db/index        -> src/mobile/db/sqljs-db.ts
//   @/server/sync/scheduler  -> src/mobile/stubs/scheduler.ts
//   @/server/lib/encryption  -> src/mobile/stubs/encryption.ts
//   fs (browser)             -> src/mobile/empty.ts
// resolveAlias only matches import specifiers, so the same three modules are
// also replaced by file path (they are reached through relative imports
// too), and `import "server-only"` is stripped from src/server/**, via
// scripts/mobile/turbopack-loader.cjs.
const MOBILE_ROOT = process.env.SPENT_MOBILE_ROOT ?? process.cwd();
const MOBILE_LOADER = path.join(MOBILE_ROOT, "scripts", "mobile", "turbopack-loader.cjs");

const MOBILE_MODULE_SWAPS: [RegExp, string][] = [
  [/src\/server\/db\/index\.ts$/, "@/mobile/db/sqljs-db"],
  [/src\/server\/sync\/scheduler\.ts$/, "@/mobile/stubs/scheduler"],
  [/src\/server\/lib\/encryption\.ts$/, "@/mobile/stubs/encryption"],
];

const mobileConfig: NextConfig = {
  output: "export",
  distDir: "out-mobile",
  pageExtensions: ["mobile.tsx", "mobile.ts"],
  images: { unoptimized: true },
  devIndicators: false,
  turbopack: {
    root: MOBILE_ROOT,
    resolveAlias: {
      "server-only": "./src/mobile/empty.ts",
      "@/server/db/index": "./src/mobile/db/sqljs-db.ts",
      "@/server/sync/scheduler": "./src/mobile/stubs/scheduler.ts",
      "@/server/lib/encryption": "./src/mobile/stubs/encryption.ts",
      // sql.js only touches fs in its Node branch.
      fs: { browser: "./src/mobile/empty.ts" },
    },
    rules: {
      "*.ts": [
        ...MOBILE_MODULE_SWAPS.map(([file, replaceWith]) => ({
          condition: { path: file },
          loaders: [{ loader: MOBILE_LOADER, options: { replaceWith } }],
          as: "*.ts",
        })),
        {
          condition: { all: [{ not: "foreign" as const }, { path: /src\/server\// }] },
          loaders: [MOBILE_LOADER],
          as: "*.ts",
        },
      ],
    },
  },
};

const nextConfig =
  process.env.SPENT_TARGET === "mobile" ? mobileConfig : desktopConfig;

export default withNextIntl(nextConfig);
