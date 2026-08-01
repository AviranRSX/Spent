<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Spent: Codex project context

Context for future Codex sessions working on this codebase.

## Project Context

Spent is a local-only personal finance tracker for Israeli financial institutions. It is an open-source project intended for users to self-host. The user is based in Israel, building this for personal use first and then publishing.

Key priorities, in order:

1. Beautiful, comfortable UI. This is a top concern. Do not ship anything that looks rough.
2. Open-source friendly. Users should be able to clone, run, and customize without code edits.
3. Security. Credentials encrypted at rest, never logged, server-only scraping.
4. Extensibility. Architected for additional banks and AI providers from day one.

## Stack Reminders

- Next.js 16 with App Router. Server components by default. Client components only where state or interactivity is needed.
- TypeScript strict mode. No `any` unless justified with a comment.
- shadcn/ui v4 + base-ui. This uses `base-ui` under the hood, not Radix. The `asChild` prop does not exist; use the `render` prop or style the primitive directly. Select `onValueChange` returns `string | null`, not `string`.
- `better-sqlite3` and `israeli-bank-scrapers` must be in `serverExternalPackages` in `next.config.ts` because native bindings cannot be bundled.
- Tailwind CSS v4 uses the new `@theme` directive in `globals.css`, not `tailwind.config.js`.

## Conventions

- No em dashes anywhere in code, comments, docs, or commit messages.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`.
- Comments only where the why is not obvious.
- Add `import "server-only"` at the top of every file in `src/server/`.

## Codex Workflow

- Never create a Git commit unless the user explicitly commands you to commit.
- When the user explicitly commands a commit, write a clear conventional commit subject and a detailed commit body that explains what changed and why.
- Inspect the exact file, function, command, or error the user names before generalizing.
- Prefer direct edits and runnable verification over conceptual advice.
- Preserve existing schema and user-facing terminology unless the user explicitly asks for a rename.
- Use the repo's existing patterns first. Keep changes scoped and avoid unrelated refactors.
- Before changing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`.
- After frontend changes, run the app and verify the relevant screen in the browser when feasible.

## Architecture

### Data Flow

1. User completes setup wizard at `/setup`: bank, AI, done.
2. Bank credentials are stored encrypted in the `bank_credentials` table.
3. AI provider config is stored in the `settings` table. Claude API key is also encrypted.
4. User clicks "Sync Now" and the SSE stream from `POST /api/sync`:
   - Calls the scraper wrapper in `src/server/scrapers/`.
   - Inserts transactions with count-based dedup in `src/server/lib/dedup.ts`.
   - Calls the AI provider for uncategorized transactions in batches of 50.
5. Dashboard reads via `GET /api/transactions`, `GET /api/summary`, and `GET /api/categories`.

### Key Files

- `src/server/db/index.ts`: SQLite singleton with globalThis pattern for HMR safety and WAL mode.
- `src/server/db/migrations/001_initial.sql`: schema and seed categories.
- `src/server/db/queries/transactions.ts`: dedup-on-insert logic, query functions, and summary functions.
- `src/server/lib/encryption.ts`: AES-256-GCM helpers, auto-generates key file on first use.
- `src/server/lib/dedup.ts`: SHA-256 hash of stable transaction fields.
- `src/server/scrapers/index.ts`: error sanitization, maps provider to `CompanyTypes` enum.
- `src/server/ai/factory.ts`: returns `ClaudeProvider`, `OllamaProvider`, or null.
- `src/server/ai/prompts.ts`: categorization prompt shared between Claude and Ollama.
- `src/app/api/sync/route.ts`: SSE streaming sync route.
- `src/components/dashboard/dashboard.tsx`: top-level dashboard component.
- `src/lib/types.ts`: shared types and `BANK_PROVIDERS` array.

### Adding A New Bank

1. Add the bank to `BANK_PROVIDERS` in `src/lib/types.ts` with credential field schema.
2. Map it to `CompanyTypes` enum in `PROVIDER_MAP` in `src/server/scrapers/index.ts`.
3. Set `enabled: true`. Everything else flows through.

### Adding A New AI Provider

1. Implement the `AIProvider` interface from `src/server/ai/types.ts`.
2. Add it to the `createAIProvider()` factory in `src/server/ai/factory.ts`.
3. Add the provider option to the setup wizard in `src/components/setup/ai-step.tsx`.
4. Add settings key handling to `src/app/api/setup/ai/route.ts`.

## Testing The App

```bash
npm run dev
```

The dev server starts on `127.0.0.1:3000`.

For end-to-end testing without real credentials, call the setup API directly:

```typescript
fetch("/api/setup/bank", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    provider: "isracard",
    credentials: { id: "test", card6Digits: "123456", password: "test" },
  }),
});
```

To reset state, delete `data/spent.db*` and `data/.encryption-key`.

## Known Quirks

- The `israeli-bank-scrapers` library uses Puppeteer with hardcoded Asia/Jerusalem timezone.
- Some banks, such as Yahav, only support 6 months of history.
- Most banks except OneZero do not support 2FA. Users must disable it on the bank side.
- The `identifier` field is not reliably unique across banks. Dedup uses a composite hash plus count, so do not rely on it.
- `claude-haiku-4-5-20251001` is the default Claude model for cost-effective categorization. To upgrade, change it in `src/server/ai/providers/claude.ts`.

## Out Of Scope For Now

- Budgets and budget alerts.
- Transaction exports such as CSV and OFX.
- Multi-user support and auth.
- Mobile app. This is Phase 2.
- Hebrew UI. Phase 1 is English only.
- Custom categories. Only predefined seeded categories are supported for now.

## Original Spec

See `~/.claude/plans/personal-finance-tracker-cozy-reef.md` for the full original design spec.
